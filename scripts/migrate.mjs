// Import an existing Frappe/MariaDB Statistics DIY site into the SQLite database.
//
//   node scripts/migrate.mjs --to /abs/statistics.sqlite \
//     --from-mariadb 'docker exec -i statistics-diy-db-1 mariadb -uroot -pSECRET _site_database'
//
// The MariaDB command is run through `sh -c` with SQL on stdin, so any client invocation that reads
// statements from stdin works (local `mariadb`, `docker exec -i`, `ssh host mariadb`, ...).
// Project IDs, collection keys, app tokens, event IDs and anonymized visitor/session/install hashes are
// copied verbatim, so tracker snippets already embedded in websites keep working. Re-running is safe:
// rows that already exist are skipped.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync, chmodSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync, backup} from 'node:sqlite';
import {openDatabase, RETENTION_OPTIONS} from '../src/db.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const target = arg('--to'), command = arg('--from-mariadb');
if (!target || !path.isAbsolute(target) || !command) {
  console.error('Usage: node scripts/migrate.mjs --to /absolute/path/statistics.sqlite --from-mariadb "<command that reads SQL on stdin>"');
  process.exit(1);
}

const ts = column => `DATE_FORMAT(${column}, '%Y-%m-%d %H:%i:%s')`;
const SOURCES = {
  projects: `SELECT JSON_OBJECT('id', name, 'project_name', project_name, 'website_origin', website_origin, 'enabled', IFNULL(enabled, 1),
    'collection_key', collection_key, 'app_collection_key', app_collection_key, 'created', ${ts('creation')}) FROM \`tabAnalytics Project\` ORDER BY creation`,
  events: `SELECT JSON_OBJECT('project', project, 'event_id', event_id, 'occurred_at', ${ts('occurred_at')}, 'path', path, 'referrer_host', referrer_host,
    'visitor_id', NULLIF(visitor_id, ''), 'session_id', NULLIF(session_id, ''), 'device', device, 'browser', browser, 'operating_system', operating_system,
    'is_bot', IFNULL(is_bot, 0), 'visitor_timezone', NULLIF(visitor_timezone, ''), 'ip_address', NULLIF(ip_address, '')) FROM \`tabAnalytics Event\` ORDER BY occurred_at, creation`,
  visitors: `SELECT JSON_OBJECT('project', project, 'visitor_id', visitor_id, 'label', IFNULL(label, '')) FROM \`tabAnalytics Visitor\``,
  app_activity: `SELECT JSON_OBJECT('project', project, 'event_id', event_id, 'install_id', install_id, 'occurred_at', ${ts('occurred_at')},
    'platform', platform, 'app_version', app_version) FROM \`tabApp Activity\` ORDER BY occurred_at, creation`,
  settings: `SELECT JSON_OBJECT('key', field, 'value', value) FROM tabSingles WHERE doctype = 'Analytics Settings' AND field = 'retention_days'`
};

async function* rows(sql) {
  const child = spawn('sh', ['-c', `${command} --batch --raw --skip-column-names`], {stdio: ['pipe', 'pipe', 'inherit']});
  const exit = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  child.stdin.on('error', () => {});
  child.stdin.end(sql + ';\n');
  for await (const line of createInterface({input: child.stdout, crlfDelay: Infinity})) {
    if (line.trim()) yield JSON.parse(line);
  }
  const code = await exit;
  if (code !== 0) throw new Error(`MariaDB command failed with exit code ${code}`);
}

// Consistent snapshot of an existing target before touching it.
if (existsSync(target)) {
  const source = new DatabaseSync(target, {readOnly: true});
  const snapshot = `${target}.before-frappe-import-${new Date().toISOString().replaceAll(':', '-')}.sqlite`;
  try {
    if (source.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Existing database failed its integrity check.');
    await backup(source, snapshot);
    chmodSync(snapshot, 0o600);
    console.log('Backed up existing database to', snapshot);
  } finally { source.close(); }
}

const db = openDatabase(target);
const text = value => value === undefined || value === null ? null : String(value);
const statements = {
  projects: db.prepare(`INSERT OR IGNORE INTO projects (id, project_name, website_origin, enabled, collection_key, app_collection_key, created)
    VALUES (:id, :project_name, :website_origin, :enabled, :collection_key, :app_collection_key, :created)`),
  events: db.prepare(`INSERT OR IGNORE INTO events (project, event_id, occurred_at, path, referrer_host, visitor_id, session_id, device, browser,
    operating_system, is_bot, visitor_timezone, ip_address) VALUES (:project, :event_id, :occurred_at, :path, :referrer_host, :visitor_id, :session_id,
    :device, :browser, :operating_system, :is_bot, :visitor_timezone, :ip_address)`),
  visitors: db.prepare('INSERT OR IGNORE INTO visitors (project, visitor_id, label) VALUES (:project, :visitor_id, :label)'),
  app_activity: db.prepare(`INSERT OR IGNORE INTO app_activity (project, event_id, install_id, occurred_at, platform, app_version)
    VALUES (:project, :event_id, :install_id, :occurred_at, :platform, :app_version)`)
};
const known = new Set(db.prepare('SELECT id FROM projects').all().map(row => row.id));
const report = {};
const columns = {
  projects: ['id', 'project_name', 'website_origin', 'enabled', 'collection_key', 'app_collection_key', 'created'],
  events: ['project', 'event_id', 'occurred_at', 'path', 'referrer_host', 'visitor_id', 'session_id', 'device', 'browser', 'operating_system', 'is_bot', 'visitor_timezone', 'ip_address'],
  visitors: ['project', 'visitor_id', 'label'],
  app_activity: ['project', 'event_id', 'install_id', 'occurred_at', 'platform', 'app_version']
};

db.exec('BEGIN IMMEDIATE');
try {
  for (const name of ['projects', 'events', 'visitors', 'app_activity']) {
    const stats = report[name] = {read: 0, imported: 0, orphaned: 0};
    for await (const row of rows(SOURCES[name])) {
      stats.read++;
      if (name === 'projects') known.add(row.id);
      else if (!known.has(row.project)) { stats.orphaned++; continue; }
      const values = Object.fromEntries(columns[name].map(key => [key, key === 'enabled' || key === 'is_bot' ? Number(row[key]) || 0 : text(row[key])]));
      if (name === 'projects') values.enabled = row.enabled === 0 || row.enabled === '0' ? 0 : 1;
      stats.imported += Number(statements[name].run(values).changes);
    }
  }
  for await (const row of rows(SOURCES.settings)) {
    if (RETENTION_OPTIONS.includes(String(row.value))) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('retention_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(row.value));
      console.log('Retention period:', row.value, 'days');
    }
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed.');
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  console.error('Migration failed; nothing was imported.', error.message);
  process.exit(1);
}

const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
let ok = true;
for (const [name, stats] of Object.entries(report)) {
  const skipped = stats.read - stats.imported - stats.orphaned;
  console.log(`${name}: read ${stats.read}, imported ${stats.imported}, already present ${skipped}, orphaned ${stats.orphaned}; total now ${count(name)}`);
  if (stats.orphaned) ok = false;
}
if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') ok = false;
db.close();
try { chmodSync(target, 0o600); } catch { /* best effort */ }
console.log(ok ? 'Migration verified.' : 'Migration finished with warnings: orphaned rows were skipped.');
process.exit(ok ? 0 : 2);
