// Anonymous page-view and app-ping collection. No device fingerprinting.
import {createHash, randomBytes} from 'node:crypto';
import {stamp} from './db.mjs';
import {classify} from './classify.mjs';
import {clientIp} from './network.mjs';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('uuid'); return value.toLowerCase(); };

export function validateEvent(eventId, path, referrer) {
  eventId = uuid(eventId);
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 140 || path.includes('?') || path.includes('#')) {
    throw new Error('Path must be a pathname of at most 140 characters.');
  }
  let host = '';
  try { host = referrer ? new URL(referrer).hostname : ''; } catch { /* no usable referrer */ }
  if (host.length > 140) throw new Error('Referrer hostname is too long.');
  return {eventId, path, host};
}

// Per-project, per-minute ceiling. The public key identifies a project; it is not a secret.
const buckets = new Map();
export function overLimit(scope, limit = 1000, now = Date.now()) {
  const minute = Math.floor(now / 60000), key = scope + ':' + minute;
  for (const old of buckets.keys()) if (!old.endsWith(':' + minute)) buckets.delete(old);
  const count = (buckets.get(key) || 0) + 1;
  buckets.set(key, count);
  return count > limit;
}

export function collect(db, req, params) {
  const key = typeof params.key === 'string' ? params.key : '';
  const project = key ? db.prepare('SELECT id, website_origin FROM projects WHERE collection_key = ? AND enabled = 1').get(key) : null;
  if (!project || req.headers.origin !== project.website_origin) throw new ApiError(403, 'Invalid project or origin.');
  let event, visitor = null, session = null;
  try {
    event = validateEvent(params.event_id, params.path, params.referrer);
    if (params.visitor_id) visitor = sha256(`${project.id}:${uuid(params.visitor_id)}`);
  } catch { throw new ApiError(417, 'Invalid event payload.'); }
  try {
    if (params.session_id) session = sha256(`${project.id}:${uuid(params.session_id)}`);
  } catch { throw new ApiError(417, 'Invalid session ID.'); }
  const timezone = params.visitor_timezone || null;
  if (timezone && (typeof timezone !== 'string' || timezone.length > 100)) throw new ApiError(417, 'Invalid timezone.');
  if (overLimit('collect:' + project.id)) return {status: 429, body: {accepted: false}};
  const agent = classify(req.headers['user-agent']);
  const result = db.prepare(`INSERT OR IGNORE INTO events (project, event_id, occurred_at, path, referrer_host, visitor_id, session_id,
      device, browser, operating_system, is_bot, visitor_timezone, ip_address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(project.id, `${project.id}:${event.eventId}`, stamp(), event.path, event.host, visitor, session,
      agent.device, agent.browser, agent.operating_system, agent.is_bot, timezone, clientIp(req));
  return {status: 200, body: result.changes ? {accepted: true} : {accepted: true, duplicate: true}};
}

export function ping(db, params) {
  const project = typeof params.token === 'string' && params.token
    ? db.prepare('SELECT id FROM projects WHERE app_collection_key = ? AND enabled = 1').get(params.token)?.id : null;
  if (!project) throw new ApiError(403, 'Invalid app collection token.');
  let install, event;
  try {
    install = sha256(`${project}:${uuid(params.install_id)}`);
    event = `${project}:${uuid(params.event_id)}`;
  } catch { throw new ApiError(417, 'Invalid install or event ID.'); }
  const version = params.app_version ?? '';
  if (!['Windows', 'Linux', 'macOS', 'iOS', 'Android', 'Other'].includes(params.platform) || typeof version !== 'string' || version.length > 50) {
    throw new ApiError(417, 'Invalid app metadata.');
  }
  if (overLimit('app:' + project)) return {status: 429, body: {accepted: false}};
  const result = db.prepare('INSERT OR IGNORE INTO app_activity (project, event_id, install_id, occurred_at, platform, app_version) VALUES (?,?,?,?,?,?)')
    .run(project, event, install, stamp(), params.platform, version);
  return {status: 200, body: result.changes ? {accepted: true} : {accepted: true, duplicate: true}};
}

// --- Project administration -------------------------------------------------
export function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
    || /[?#]/.test(String(value))) {
    throw new ApiError(417, 'Website Origin must be an HTTP(S) origin without a path.');
  }
  return url.origin;
}
export const newKey = () => randomBytes(32).toString('base64url');
export const trackingSnippet = (key, host = 'https://statistics.diy') =>
  `<script defer src="${host}/assets/statistics_diy/js/tracker.js" data-key="${key}"></script>`;

export function saveProject(db, {name, project_name, website_origin, enabled = 1}) {
  const title = String(project_name || '').trim();
  if (!title || title.length > 140) throw new ApiError(417, 'Project Name is required and at most 140 characters.');
  const origin = normalizeOrigin(website_origin), flag = Number(enabled) ? 1 : 0;
  if (name) {
    const result = db.prepare('UPDATE projects SET project_name=?, website_origin=?, enabled=? WHERE id=?').run(title, origin, flag, String(name));
    if (!result.changes) throw new ApiError(404, 'Project not found.');
    return {name: String(name)};
  }
  const id = randomBytes(5).toString('hex');
  db.prepare('INSERT INTO projects (id, project_name, website_origin, enabled, collection_key, app_collection_key, created) VALUES (?,?,?,?,?,?,?)')
    .run(id, title, origin, flag, newKey(), newKey(), stamp());
  return {name: id};
}
