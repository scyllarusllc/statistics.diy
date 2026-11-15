import {retentionDays, stamp} from './db.mjs';
import {decorateIps} from './geo.mjs';
import {ApiError} from './collect.mjs';
import {reportTimezone, localDay, dayStart, addDays} from './timezone.mjs';
import {createHash} from 'node:crypto';

const DAY = 86400000;
const utcMidnight = date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const isoDay = date => date.toISOString().slice(0, 10);
// SQLite has no multi-column COUNT(DISTINCT): join project and visitor into one value (NULL stays NULL).
const DISTINCT = "COUNT(DISTINCT project || char(31) || NULLIF(effective_visitor, ''))";

export function reportWindow(days, now = new Date()) {
  if (!['7', '30', '90', '365'].includes(String(days))) throw new ApiError(417, 'Report range must be 7, 30, 90 or 365 days.');
  days = Number(days);
  const end = new Date(utcMidnight(now).getTime() + DAY);
  return {days, start: new Date(end.getTime() - days * DAY), end};
}

/** Browser IDs first; unmatched IPs are estimates scoped to a report/project. */
export function visitorSource(where, params, context) {
  const timezone = context?.startsWith('day:') ? context.slice(4).replaceAll("'", "''") : null;
  const expressions = {path: 'path', referrer_host: 'referrer_host',
    device: "IFNULL(NULLIF(device,''),'Unknown')", browser: "IFNULL(NULLIF(browser,''),'Unknown')",
    operating_system: "IFNULL(NULLIF(operating_system,''),'Unknown')", ip_address: 'ip_address'};
  const expression = timezone ? `report_day(occurred_at, '${timezone}')` : expressions[context];
  const selection = expression ? `, ${expression} AS bucket` : '';
  const grouping = expression ? ', bucket' : '';
  const matching = expression ? ` AND known_ip.bucket IS ${expression.replace(/\b(occurred_at|path|referrer_host|device|browser|operating_system|ip_address)\b/g, 'e.$1')}` : '';
  // A missing-ID event on an IP already seen with a browser ID must not add another visitor.
  const source = `(SELECT e.*,
    CASE WHEN NULLIF(e.visitor_id, '') IS NOT NULL THEN 'browser:' || e.visitor_id
         WHEN NULLIF(e.ip_address, '') IS NOT NULL THEN COALESCE('browser:' || known_ip.visitor_id, 'ip:' || e.ip_address)
         ELSE NULL END AS effective_visitor
    FROM events e
    LEFT JOIN (SELECT project, ip_address, MIN(visitor_id) AS visitor_id${selection}
      FROM events WHERE ${where}
      AND NULLIF(visitor_id, '') IS NOT NULL AND NULLIF(ip_address, '') IS NOT NULL
      GROUP BY project, ip_address${grouping}) known_ip
    ON known_ip.project = e.project AND known_ip.ip_address = e.ip_address${matching}) report_events`;
  return [source, [...params, ...params]];
}

const placeholders = list => list.length ? list.map(() => '?').join(',') : null;

export async function realtime(db, {project, minutes = 10} = {}, now = new Date()) {
  if (!['1', '10', '30', '60'].includes(String(minutes))) throw new ApiError(417, 'Realtime window must be 1, 10, 30 or 60 minutes.');
  if (typeof project !== 'string' || !project || !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(project)) {
    throw new ApiError(404, 'Project not found.');
  }
  minutes = Number(minutes);
  const since = stamp(new Date(now.getTime() - minutes * 60000));
  const until = stamp(now);
  const where = 'project = ? AND occurred_at >= ? AND occurred_at <= ? AND IFNULL(is_bot,0)=0';
  const params = [project, since, until];
  const [source, args] = visitorSource(where, params);
  const rows = db.prepare(`SELECT effective_visitor, ip_address, occurred_at, path, referrer_host, device, browser,
      operating_system, visitor_timezone, event_count FROM (
    SELECT effective_visitor, ip_address, occurred_at, path, referrer_host, device, browser,
      operating_system, visitor_timezone, COUNT(*) OVER (PARTITION BY effective_visitor) AS event_count,
      ROW_NUMBER() OVER (PARTITION BY effective_visitor ORDER BY occurred_at DESC, id DESC) AS rank
    FROM ${source} WHERE ${where} AND effective_visitor IS NOT NULL
  ) WHERE rank = 1 ORDER BY occurred_at DESC`).all(...args);
  await decorateIps(rows);
  const visitorId = row => createHash('sha256').update(project + '\0' + row.effective_visitor).digest('hex').slice(0, 12);
  const countries = new Map();
  for (const row of rows) {
    const code = row.country_code || '';
    if (!countries.has(code)) countries.set(code, {country_code: code, country_name: row.country_name || 'Unknown',
      country_flag: row.country_flag || '', visitors: 0});
    countries.get(code).visitors++;
  }
  const activity = db.prepare(`SELECT COUNT(*) AS views, MAX(occurred_at) AS last_visit_at FROM events WHERE ${where}`).get(...params);
  const topPages = db.prepare(`SELECT COALESCE(NULLIF(path,''),'/') AS label, COUNT(*) AS views FROM events WHERE ${where}
    GROUP BY label ORDER BY views DESC, label LIMIT 5`).all(...params);
  const topSources = db.prepare(`SELECT COALESCE(NULLIF(referrer_host,''),'Direct / Unknown') AS label, COUNT(*) AS views
    FROM events WHERE ${where} GROUP BY label ORDER BY views DESC, label LIMIT 5`).all(...params);
  const devices = db.prepare(`SELECT COALESCE(NULLIF(device,''),'Unknown') AS label, COUNT(*) AS views
    FROM events WHERE ${where} GROUP BY label ORDER BY views DESC, label LIMIT 5`).all(...params);
  return {project, minutes, visitors: rows.length, page_views: activity.views, last_visit_at: activity.last_visit_at,
    top_pages: topPages, top_sources: topSources, devices, updated_at: now.toISOString(),
    active_ids: rows.map(visitorId),
    recent_visitors: rows.slice(0, 30).map(row => ({id: visitorId(row), last_seen: row.occurred_at, path: row.path,
      referrer_host: row.referrer_host, device: row.device, browser: row.browser,
      operating_system: row.operating_system, visitor_timezone: row.visitor_timezone, page_views: row.event_count,
      country_code: row.country_code, country_name: row.country_name, country_flag: row.country_flag})),
    countries: [...countries.values()].sort((a, b) => b.visitors - a.visitors || a.country_name.localeCompare(b.country_name))};
}

async function enrich(db, names, where, unfiltered, params, today, tomorrow, timezone) {
  const scope = names.length ? `project IN (${placeholders(names)})` : '1=0';
  const all = (sql, args) => db.prepare(sql).all(...args);
  const query = (context, select, tail) => {
    const [source, args] = visitorSource(where, params, context);
    return all(`SELECT ${select} FROM ${source} WHERE ${where} ${tail}`, args);
  };
  const breakdowns = {};
  for (const field of ['device', 'browser', 'operating_system']) {
    breakdowns[field] = query(field, `IFNULL(NULLIF(${field}, ''), 'Unknown') AS label, COUNT(*) AS views, ${DISTINCT} AS visitors`,
      'GROUP BY label ORDER BY visitors DESC, views DESC, label LIMIT 15');
  }
  const [source, args] = visitorSource(where, params);
  const repeated = all(`SELECT COUNT(*) AS n FROM (SELECT project, effective_visitor FROM ${source}
    WHERE ${where} AND effective_visitor IS NOT NULL GROUP BY project, effective_visitor HAVING COUNT(*) > 1)`, args)[0].n;
  const recent = all(`SELECT project, occurred_at, path, referrer_host, device, browser, operating_system, visitor_timezone, ip_address,
    substr(visitor_id, 1, 10) AS visitor FROM ${source} WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT 20`, args);
  const ips = all(`SELECT ip_address, COUNT(*) AS views, ${DISTINCT} AS visitors FROM ${source}
    WHERE ${where} AND ip_address IS NOT NULL AND ip_address != '' GROUP BY ip_address ORDER BY views DESC, ip_address LIMIT 15`, args);
  const countryIps = all(`SELECT ip_address, COUNT(*) AS views FROM events WHERE ${where}
    AND ip_address IS NOT NULL AND ip_address != '' GROUP BY ip_address`, params);
  await decorateIps([...ips, ...recent, ...countryIps]);
  const countryMap = new Map();
  for (const row of countryIps) {
    const code = row.country_code || '';
    if (!countryMap.has(code)) countryMap.set(code, {country_code: code, country_name: row.country_name,
      country_flag: row.country_flag, views: 0, ip_count: 0});
    const country = countryMap.get(code);
    country.views += row.views;
    country.ip_count++;
  }
  const countries = [...countryMap.values()].sort((a, b) => b.views - a.views || a.country_name.localeCompare(b.country_name));
  const known = all(`SELECT project, visitor_id, MIN(occurred_at) AS first_seen, MAX(occurred_at) AS last_seen, COUNT(*) AS visits,
    COUNT(DISTINCT NULLIF(session_id, '')) AS sessions FROM events WHERE ${where} AND visitor_id IS NOT NULL AND visitor_id != ''
    GROUP BY project, visitor_id ORDER BY last_seen DESC, project, visitor_id LIMIT 30`, params);
  const labels = names.length ? all(`SELECT project, visitor_id, label FROM visitors WHERE project IN (${placeholders(names)})`, names) : [];
  const labelMap = new Map(labels.map(row => [row.project + '\0' + row.visitor_id, row.label]));
  for (const row of known) row.label = labelMap.get(row.project + '\0' + row.visitor_id) || '';
  const todayWhere = `${scope} AND occurred_at >= ? AND occurred_at < ?` + (where.includes('IFNULL(is_bot') ? ' AND IFNULL(is_bot,0)=0' : '');
  const [todaySource, todayArgs] = visitorSource(todayWhere, [...names, stamp(today), stamp(tomorrow)]);
  const todayStats = all(`SELECT COUNT(*) AS views, ${DISTINCT} AS visitors FROM ${todaySource} WHERE ${todayWhere}`, todayArgs)[0];
  const bots = all(`SELECT COUNT(*) AS n FROM events WHERE ${unfiltered} AND is_bot = 1`, params)[0].n;
  const stored = all(`SELECT COUNT(*) AS n FROM events WHERE ${scope}`, names)[0].n;
  const thirty = stamp(dayStart(addDays(localDay(today, timezone), -29), timezone)), start = stamp(today);
  const pair = 'project || char(31) || install_id';
  const apps = all(`SELECT COUNT(DISTINCT ${pair}) AS installs,
    COUNT(DISTINCT CASE WHEN occurred_at >= ? THEN ${pair} END) AS dau,
    COUNT(DISTINCT CASE WHEN occurred_at >= ? THEN ${pair} END) AS mau, COUNT(*) AS pings
    FROM app_activity WHERE ${scope} AND occurred_at < ?`, [start, thirty, ...names, stamp(tomorrow)])[0];
  const platforms = all(`SELECT IFNULL(NULLIF(platform,''),'Unknown') AS label, COUNT(DISTINCT ${pair}) AS installs
    FROM app_activity WHERE ${scope} GROUP BY label ORDER BY installs DESC`, names);
  return {ips, countries, breakdowns, returning: repeated, today: todayStats, recent, known, bot_hits: bots, stored_events: stored,
    apps, app_platforms: platforms, retention_days: retentionDays(db)};
}

export async function summary(db, {project, days = 30, exclude_bots = 1, day, timezone: requestedTimezone} = {}, now = new Date()) {
  let timezone;
  try { timezone = reportTimezone(requestedTimezone); } catch { throw new ApiError(417, 'Invalid timezone.'); }
  let projects;
  if (project) {
    const row = db.prepare('SELECT id AS name, project_name, website_origin, enabled FROM projects WHERE id = ?').get(project);
    if (!row) throw new ApiError(404, 'Project not found.');
    projects = [row];
  } else {
    projects = db.prepare('SELECT id AS name, project_name, website_origin, enabled FROM projects ORDER BY project_name').all();
  }
  let {days: span} = reportWindow(days, now);
  const todayDay = localDay(now, timezone);
  let startDay = addDays(todayDay, 1 - span);
  let endDay = todayDay;
  if (day) {
    const selected = new Date(day + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(selected.getTime()) || isoDay(selected) !== day || day < startDay || day > endDay) {
      throw new ApiError(417, 'Selected day must be within the report range.');
    }
    startDay = endDay = day; span = 1;
  }
  const start = dayStart(startDay, timezone), end = dayStart(addDays(endDay, 1), timezone);
  const names = projects.map(item => item.name);
  const scope = names.length ? `project IN (${placeholders(names)})` : '1=0';
  const cutoff = new Date(now.getTime() - retentionDays(db) * DAY);
  cutoff.setUTCMilliseconds(0);
  let where = `${scope} AND occurred_at >= ? AND occurred_at < ? AND occurred_at >= ?`;
  const params = [...names, stamp(start), stamp(end), stamp(cutoff)];
  const unfiltered = where;
  if (Number(exclude_bots)) where += ' AND IFNULL(is_bot, 0)=0';
  const all = (sql, args) => db.prepare(sql).all(...args);
  const query = (context, select, tail) => {
    const [source, args] = visitorSource(where, params, context);
    return all(`SELECT ${select} FROM ${source} WHERE ${where} ${tail}`, args);
  };

  const dayExpression = `report_day(occurred_at, '${timezone.replaceAll("'", "''")}')`;
  const dayRows = query('day:' + timezone, `${dayExpression} AS day, COUNT(*) AS views, ${DISTINCT} AS visitors`, 'GROUP BY day ORDER BY day');
  const byDay = new Map(dayRows.map(row => [row.day, row]));
  const daily = Array.from({length: span}, (_, i) => {
    const date = addDays(startDay, i), row = byDay.get(date);
    const available = dayStart(addDays(date, 1), timezone).getTime() > cutoff.getTime();
    return {day: date, views: available ? row?.views ?? 0 : null, visitors: available ? row?.visitors ?? 0 : null, available};
  });
  const trendRows = query('day:' + timezone, `project, ${dayExpression} AS day, COUNT(DISTINCT NULLIF(effective_visitor, '')) AS visitors`, 'GROUP BY project, day');
  const trend = new Map(trendRows.map(row => [row.project + '\0' + row.day, row.visitors]));
  const project_trends = projects.map(item => ({name: item.name, project_name: item.project_name,
    visitors: daily.map(row => row.available ? trend.get(item.name + '\0' + row.day) ?? 0 : null)}));
  const pages = query('path', `project, path, COUNT(*) AS views, ${DISTINCT} AS visitors`, 'GROUP BY project, path ORDER BY views DESC, project, path LIMIT 10');
  const referrers = query('referrer_host', `referrer_host, COUNT(*) AS views, ${DISTINCT} AS visitors`, 'GROUP BY referrer_host ORDER BY views DESC, referrer_host LIMIT 10');
  const totals = query(undefined, `project, COUNT(*) AS views, COUNT(DISTINCT NULLIF(effective_visitor, '')) AS visitors,
    SUM(CASE WHEN effective_visitor IS NULL THEN 1 ELSE 0 END) AS unmeasured,
    COUNT(DISTINCT CASE WHEN substr(effective_visitor,1,3)='ip:' THEN effective_visitor END) AS ip_visitors,
    SUM(CASE WHEN NULLIF(visitor_id,'') IS NULL AND NULLIF(ip_address,'') IS NOT NULL THEN 1 ELSE 0 END) AS ip_views`, 'GROUP BY project');
  const stat = (field) => new Map(totals.map(row => [row.project, row[field]]));
  const views = stat('views'), visitors = stat('visitors'), missing = stat('unmeasured');
  const labels = new Map(projects.map(item => [item.name, item.project_name]));
  for (const page of pages) page.project_name = labels.get(page.project);
  const project_rows = projects.map(item => ({...item, views: views.get(item.name) ?? 0, visitors: visitors.get(item.name) ?? 0, unmeasured_views: missing.get(item.name) ?? 0}));
  const extra = await enrich(db, names, where, unfiltered, params, dayStart(todayDay, timezone), dayStart(addDays(todayDay, 1), timezone), timezone);
  const sum = field => totals.reduce((total, row) => total + Number(row[field] || 0), 0);
  return {...extra, ip_visitors: sum('ip_visitors'), ip_fallback_views: sum('ip_views'),
    identified_views: sum('views') - sum('unmeasured'), visitor_count_complete: !totals.some(row => row.unmeasured),
    selected_day: day || null, visitors: sum('visitors'), unmeasured_views: sum('unmeasured'), projects: project_rows,
    all_projects: !project, timezone, window: `Last ${span} days`, days: span,
    retention_start: localDay(cutoff, timezone), start: startDay, end: endDay,
    total: daily.reduce((total, row) => total + (row.views || 0), 0), daily, project_trends, pages, referrers};
}
