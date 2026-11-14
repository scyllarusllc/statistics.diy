import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export const SCHEMA_VERSION = 1;

// Timestamps are UTC text ("YYYY-MM-DD HH:MM:SS") so they sort and compare lexically.
export const stamp = (date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(file);
  if (db.prepare('PRAGMA user_version').get().user_version > SCHEMA_VERSION) {
    db.close();
    throw new Error('Database schema is newer than this application');
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      website_origin TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      collection_key TEXT NOT NULL UNIQUE,
      app_collection_key TEXT NOT NULL UNIQUE,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL UNIQUE,
      occurred_at TEXT NOT NULL,
      path TEXT,
      referrer_host TEXT,
      visitor_id TEXT,
      session_id TEXT,
      device TEXT,
      browser TEXT,
      operating_system TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      visitor_timezone TEXT,
      ip_address TEXT
    );
    CREATE INDEX IF NOT EXISTS events_project_time ON events(project, occurred_at);
    CREATE INDEX IF NOT EXISTS events_time ON events(occurred_at);
    CREATE INDEX IF NOT EXISTS events_project_visitor ON events(project, visitor_id);
    CREATE INDEX IF NOT EXISTS events_project_ip ON events(project, ip_address);
    CREATE TABLE IF NOT EXISTS visitors (
      project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      visitor_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (project, visitor_id)
    );
    CREATE TABLE IF NOT EXISTS app_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL UNIQUE,
      install_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      platform TEXT,
      app_version TEXT
    );
    CREATE INDEX IF NOT EXISTS app_activity_project_time ON app_activity(project, occurred_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
  return db;
}

export const RETENTION_OPTIONS = ['30', '90', '180', '365'];

export function retentionDays(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key='retention_days'").get();
  return RETENTION_OPTIONS.includes(row?.value) ? Number(row.value) : 180;
}

export function purgeExpired(db) {
  const cutoff = stamp(new Date(Date.now() - retentionDays(db) * 86400000));
  db.prepare('DELETE FROM events WHERE occurred_at < ?').run(cutoff);
  db.prepare('DELETE FROM app_activity WHERE occurred_at < ?').run(cutoff);
  // Labels without retained visitor events no longer need to be stored.
  db.exec(`DELETE FROM visitors WHERE NOT EXISTS
    (SELECT 1 FROM events e WHERE e.project = visitors.project AND e.visitor_id = visitors.visitor_id)`);
}
