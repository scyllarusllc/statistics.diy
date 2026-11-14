import {RETENTION_OPTIONS} from './db.mjs';
import {ApiError} from './collect.mjs';

export function saveSettings(db, {retention_days}) {
  if (!RETENTION_OPTIONS.includes(String(retention_days))) throw new ApiError(417, 'Invalid retention period.');
  db.prepare("INSERT INTO settings (key, value) VALUES ('retention_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(retention_days));
  return {saved: true};
}

export function labelVisitor(db, {project, visitor_id, label = ''}) {
  const text = String(label ?? '');
  if (typeof project !== 'string' || typeof visitor_id !== 'string' || text.length > 100
    || !db.prepare('SELECT 1 FROM events WHERE project = ? AND visitor_id = ? LIMIT 1').get(project, visitor_id)) {
    throw new ApiError(417, 'Invalid visitor or label.');
  }
  db.prepare('INSERT INTO visitors (project, visitor_id, label) VALUES (?,?,?) ON CONFLICT(project, visitor_id) DO UPDATE SET label = excluded.label')
    .run(project, visitor_id, text.trim());
  return {saved: true};
}

export function clearData(db, {confirmation, project}) {
  if (confirmation !== 'DELETE ANALYTICS') throw new ApiError(417, 'Type DELETE ANALYTICS to confirm.');
  if (project && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(project)) throw new ApiError(404, 'Project not found.');
  for (const table of ['events', 'visitors', 'app_activity']) {
    if (project) db.prepare(`DELETE FROM ${table} WHERE project = ?`).run(project);
    else db.exec(`DELETE FROM ${table}`);
  }
  return {cleared: true};
}
