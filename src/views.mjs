import nunjucks from 'nunjucks';
import {fileURLToPath} from 'node:url';
import {languageContext} from './i18n.mjs';
import {retentionDays} from './db.mjs';
import {trackingSnippet} from './collect.mjs';

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(fileURLToPath(new URL('../views/', import.meta.url))), {autoescape: true});
// Safe inside <script type="application/json">: neutralize characters that could close the tag.
env.addFilter('tojson', value => JSON.stringify(value).replace(/[<>&']/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));

export const PAGES = {
  '/statistics_diy/admin/dashboard': ['dashboard', 'Dashboard'],
  '/statistics_diy/admin/projects': ['projects', 'Projects'],
  '/statistics_diy/admin/settings': ['settings', 'Settings']
};

export function renderPage(name, {req, db, auth, host, base = {}}) {
  const context = {...languageContext(req), csrf_token: auth.csrf(req), is_login: false, is_homepage: false, ...base};
  context.signed_in = auth.isAdmin(req);
  context.is_admin = context.signed_in;
  context.title = context.t(context.title || 'Home');
  if (name === 'projects') {
    context.projects = db.prepare('SELECT id AS name, project_name, website_origin, enabled, app_collection_key, collection_key FROM projects ORDER BY project_name').all()
      .map(project => ({...project, tracking_snippet: trackingSnippet(project.collection_key, host)}));
  } else if (name === 'dashboard') {
    context.projects = db.prepare('SELECT id AS name, project_name, website_origin, enabled FROM projects ORDER BY project_name').all();
  } else if (name === 'settings') {
    context.retention_days = retentionDays(db);
  } else if (name === 'home') {
    context.display_name = context.signed_in ? auth.username : null;
  }
  return env.render(name + '.html', context);
}
