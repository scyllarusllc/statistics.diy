import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openDatabase, purgeExpired} from './src/db.mjs';
import {createAuth} from './src/auth.mjs';
import {collect, ping, saveProject, ApiError} from './src/collect.mjs';
import {summary} from './src/reports.mjs';
import {saveSettings, labelVisitor, clearData} from './src/maintenance.mjs';
import {renderPage, PAGES} from './src/views.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const types = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json'};
const ADMIN_LANDING = '/statistics_diy/admin/dashboard';

export function createApp({db, origin, auth, root = path.join(here, 'public')}) {
  const hostName = origin;
  const secure = {'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'};

  function send(res, status, body, headers = {}) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', ...secure, ...headers});
    res.end(data);
  }
  const redirect = (res, location) => { res.writeHead(303, {Location: location, 'Cache-Control': 'no-store'}); res.end(); };

  async function readBody(req, limit = 16_384) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new ApiError(413, 'Request body is too large.');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const type = req.headers['content-type'] || '';
    if (!text) return {};
    try {
      if (type.includes('application/json')) return JSON.parse(text);
      return Object.fromEntries(new URLSearchParams(text));
    } catch { throw new ApiError(400, 'Malformed request body.'); }
  }

  const sameOrigin = req => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    return req.headers.origin === origin || req.headers.origin === `${origin.startsWith('https') ? 'https' : 'http'}://${req.headers.host}`;
  };

  function requireAdmin(req, mutating) {
    if (!auth.isAdmin(req)) throw new ApiError(403, 'Administrator access is required.');
    if (mutating && (!sameOrigin(req) || !auth.csrfValid(req))) throw new ApiError(403, 'Invalid CSRF token. Reload the page and try again.');
  }

  // Method names match the original Frappe endpoints so deployed tracker snippets keep working.
  async function method(req, res, name, url) {
    const publicMethods = {'statistics_diy.api.collect': 'collect', 'statistics_diy.activity.ping': 'ping'};
    if (name in publicMethods) {
      const allow = req.headers.origin ? {'Access-Control-Allow-Origin': req.headers.origin, Vary: 'Origin'} : {};
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {...allow, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'});
        res.end();
        return;
      }
      if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
      const params = {...Object.fromEntries(url.searchParams), ...await readBody(req)};
      try {
        const result = name.endsWith('collect') ? collect(db, req, params) : ping(db, params);
        send(res, result.status, {message: result.body}, allow);
      } catch (error) {
        if (error instanceof ApiError) send(res, error.status, {error: error.message}, allow);
        else throw error;
      }
      return;
    }
    if (name === 'login') {
      if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
      if (!sameOrigin(req)) throw new ApiError(403, 'Invalid request origin.');
      const {usr, pwd} = await readBody(req);
      const outcome = auth.login(req, res, usr, pwd);
      if (outcome === 'throttled') throw new ApiError(429, 'Too many failed attempts. Try again later.');
      if (outcome !== 'ok') throw new ApiError(401, 'Incorrect account or password.');
      send(res, 200, {message: 'Logged In'});
      return;
    }
    if (name === 'logout') {
      requireAdmin(req, true);
      auth.logout(req, res);
      send(res, 200, {message: 'Logged Out'});
      return;
    }
    if (name === 'statistics_diy.api.summary') {
      if (req.method !== 'GET') throw new ApiError(405, 'Method not allowed.');
      requireAdmin(req, false);
      send(res, 200, {message: await summary(db, Object.fromEntries(url.searchParams))});
      return;
    }
    const admin = {
      'statistics_diy.api.save_project': saveProject,
      'statistics_diy.maintenance.save_settings': saveSettings,
      'statistics_diy.maintenance.label_visitor': labelVisitor,
      'statistics_diy.maintenance.clear_data': clearData
    }[name];
    if (!admin) throw new ApiError(404, 'Unknown method.');
    if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
    requireAdmin(req, true);
    send(res, 200, {message: admin(db, await readBody(req))});
  }

  async function page(req, res, pathname) {
    const view = (name, base = {}) => send(res, 200, renderPage(name, {req, db, auth, host: hostName, base}), {'X-Frame-Options': 'DENY'});
    if (pathname === '/' || pathname === '/statistics_diy/user/homepage') return view('home', {is_homepage: true});
    if (pathname === '/statistics_diy/login' || pathname === '/login') {
      if (auth.isAdmin(req)) return redirect(res, ADMIN_LANDING);
      return view('login', {title: 'Sign in', is_login: true});
    }
    if (pathname in PAGES) {
      if (!auth.isAdmin(req)) return redirect(res, '/statistics_diy/login?next=' + encodeURIComponent(pathname));
      return view(PAGES[pathname][0], {title: PAGES[pathname][1]});
    }
    return false;
  }

  async function asset(req, res, pathname) {
    const target = path.resolve(root, '.' + pathname.slice('/assets/statistics_diy'.length));
    if (!target.startsWith(root + path.sep)) throw new ApiError(403, 'Forbidden.');
    const data = await readFile(target);
    res.writeHead(200, {'Content-Type': types[path.extname(target)] || 'application/octet-stream', ...secure,
      // Deployed sites embed tracker.js without a version, so keep it fresh; admin assets carry ?v=.
      'Cache-Control': target.endsWith('tracker.js') ? 'public, max-age=3600' : 'public, max-age=86400'});
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/api/health') return send(res, 200, {ok: true});
      if (pathname.startsWith('/api/method/')) return await method(req, res, pathname.slice('/api/method/'.length), url);
      if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'Method not allowed.');
      if (pathname.startsWith('/assets/statistics_diy/')) return await asset(req, res, pathname);
      if (await page(req, res, pathname) !== false) return;
      send(res, 404, '<!doctype html><title>Not found</title><h1>Not found</h1>');
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, {error: error.message});
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return send(res, 404, {error: 'Not found.'});
      console.error('Request failed:', error);
      send(res, 500, {error: 'The server could not complete this request.'});
    }
  });
}

export function startServer(env = process.env) {
  const port = Number(env.PORT || 8080);
  const origin = new URL(env.APP_ORIGIN || `http://127.0.0.1:${port}`).origin;
  const db = openDatabase(env.DATABASE_PATH || path.join(here, 'storage', 'statistics.sqlite'));
  const auth = createAuth(db, origin, {username: env.ADMIN_USERNAME || 'Administrator', passwordHash: env.ADMIN_PASSWORD_HASH, password: env.ADMIN_PASSWORD});
  if (!auth.enabled) console.warn('Set ADMIN_PASSWORD_HASH (see scripts/hash-password.mjs) to enable administrator sign-in.');
  purgeExpired(db);
  const timer = setInterval(() => { try { purgeExpired(db); } catch (error) { console.error('Purge failed:', error.message); } }, 6 * 3600 * 1000);
  timer.unref();
  const server = createApp({db, origin, auth});
  server.listen(port, env.BINDING || '127.0.0.1', () => console.log(`Statistics DIY: ${origin} (port ${server.address().port})`));
  return {server, db};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envFile = path.join(here, '.env');
  if (process.env.LOAD_ENV !== '0' && existsSync(envFile)) process.loadEnvFile(envFile);
  startServer();
}
