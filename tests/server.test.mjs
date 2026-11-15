import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {openDatabase} from '../src/db.mjs';
import {createAuth} from '../src/auth.mjs';
import {classify} from '../src/classify.mjs';
import {isGlobal, normalizeIp} from '../src/network.mjs';
import {flag} from '../src/geo.mjs';

const VISITOR = 'a379bbf9-65b1-4a17-a7ce-569e13674ef9';
assert.equal(flag('MP'), '🇲🇵');
async function boot() {
  const db = openDatabase(':memory:');
  let origin, server;
  const auth = {};
  server = createApp({db, origin: 'http://placeholder', auth: new Proxy(auth, {get: (_, key) => auth.real[key]})});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  auth.real = createAuth(db, origin, {password: 'secret'});
  return {db, base: origin, server};
}

test('admin session, project management, collection and reports', async t => {
  const {db, base, server} = await boot();
  t.after(() => server.close());
  const json = (path, init = {}) => fetch(base + path, init).then(async r => ({status: r.status, body: await r.json().catch(() => null), headers: r.headers}));

  const dashboardRedirect = await fetch(base + '/admin/dashboard', {redirect: 'manual'});
  assert.equal(dashboardRedirect.status, 303);
  assert.equal(dashboardRedirect.headers.get('location'), '/statistics_diy/login?next=%2Fadmin%2Fdashboard');
  const oldDashboard = await fetch(base + '/statistics_diy/admin/dashboard', {redirect: 'manual'});
  assert.equal(oldDashboard.status, 303);
  assert.equal(oldDashboard.headers.get('location'), '/admin/dashboard');
  assert.equal((await json('/api/method/statistics_diy.api.summary')).status, 403);
  const bad = await json('/api/method/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({usr: 'Administrator', pwd: 'nope'})});
  assert.equal(bad.status, 401);
  const login = await fetch(base + '/api/method/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({usr: 'Administrator', pwd: 'secret'})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/admin/dashboard', {headers: {cookie}})).status, 200);
  const csrf = (await (await fetch(base + '/statistics_diy/admin/projects', {headers: {cookie}})).text()).match(/csrf-token" content="([^"]+)"/)[1];
  const admin = (method, body) => json('/api/method/' + method, {method: 'POST', headers: {cookie, 'content-type': 'application/json', 'x-csrf-token': csrf}, body: JSON.stringify(body)});

  assert.equal((await json('/api/method/statistics_diy.api.save_project', {method: 'POST', headers: {cookie, 'content-type': 'application/json'}, body: '{}'})).status, 403, 'CSRF required');
  assert.equal((await admin('statistics_diy.api.save_project', {project_name: 'Bad', website_origin: 'https://example.com/private'})).status, 417);
  const first = (await admin('statistics_diy.api.save_project', {project_name: '<script>x</script>', website_origin: 'https://example.com'})).body.message.name;
  const second = (await admin('statistics_diy.api.save_project', {project_name: 'Other', website_origin: 'https://other.example'})).body.message.name;
  const unauthenticatedProject = await fetch(base + '/admin/dashboard?project=' + first, {redirect: 'manual'});
  assert.equal(unauthenticatedProject.headers.get('location'), '/statistics_diy/login?next=' + encodeURIComponent('/admin/dashboard?project=' + first));
  const legacyProject = await fetch(base + '/admin/dashboard?project=' + first, {headers: {cookie}, redirect: 'manual'});
  assert.equal(legacyProject.status, 303);
  assert.equal(legacyProject.headers.get('location'), '/admin/project/example.com');
  assert.equal((await fetch(base + '/admin/dashboard?project=missing', {headers: {cookie}})).status, 404);
  assert.equal((await fetch(base + '/admin/project/example.com', {redirect: 'manual'})).headers.get('location'), '/statistics_diy/login?next=%2Fadmin%2Fproject%2Fexample.com');
  const projectPage = await fetch(base + '/admin/project/example.com', {headers: {cookie}});
  assert.equal(projectPage.status, 200);
  const projectHtml = await projectPage.text();
  assert.ok(projectHtml.includes('id="realtime-hero"'));
  const mapAsset = await fetch(base + '/assets/statistics_diy/data/world-map.json');
  assert.equal(mapAsset.status, 200);
  assert.ok((await mapAsset.json()).countries.length > 100);
  assert.ok(projectHtml.includes(`data-selected-project="${first}"`));
  assert.ok(projectHtml.includes('data-domain="example.com"'));
  assert.ok(!projectHtml.includes('<option value="">All projects</option>'));
  assert.ok(projectHtml.includes('href="/admin/dashboard"'));
  assert.ok(projectHtml.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.equal((await json('/api/method/statistics_diy.api.realtime?project=' + first)).status, 403);
  assert.equal((await json('/api/method/statistics_diy.api.realtime?project=' + first, {headers: {cookie}})).status, 200);
  assert.equal((await fetch(base + '/admin/project/missing.example', {headers: {cookie}})).status, 404);
  const page = await (await fetch(base + '/statistics_diy/admin/projects', {headers: {cookie}})).text();
  assert.ok(page.includes('href="/admin/project/example.com"'));
  assert.ok(page.includes('&lt;script&gt;x&lt;/script&gt;') && !page.includes('<script>x</script>'));
  const key = db.prepare('SELECT collection_key FROM projects WHERE id = ?').get(first).collection_key;
  assert.ok(page.includes(`&lt;script defer src=&quot;`) && page.includes(`data-key=&quot;${key}&quot;`));

  const collect = (event, extra = {}, origin = 'https://example.com') => json('/api/method/statistics_diy.api.collect', {method: 'POST',
    headers: {origin, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (Windows) Chrome/1'},
    body: new URLSearchParams({key, event_id: event, path: '/test', referrer: 'https://ref.example/p', visitor_id: VISITOR, ...extra})});
  const event = 'a379bbf9-65b1-4a17-a7ce-569e13674ef1';
  assert.deepEqual((await collect(event)).body, {message: {accepted: true}});
  assert.deepEqual((await collect(event)).body, {message: {accepted: true, duplicate: true}});
  assert.equal((await collect('a379bbf9-65b1-4a17-a7ce-569e13674ef2', {path: '/x?y=1'})).status, 417);
  assert.equal((await collect('a379bbf9-65b1-4a17-a7ce-569e13674ef3', {}, 'https://wrong.example')).status, 403);

  const report = path => json('/api/method/statistics_diy.api.summary' + path, {headers: {cookie}});
  assert.equal((await report('?project=' + first)).body.message.total, 1);
  assert.equal((await report('?project=' + second)).body.message.total, 0);
  const all = (await report('?days=7')).body.message;
  assert.equal(all.visitors, 1);
  assert.equal(all.referrers[0].referrer_host, 'ref.example');
  assert.equal((await report('?days=5')).status, 417);

  db.prepare('INSERT INTO events (project, event_id, occurred_at, path, ip_address) VALUES (?, ?, ?, ?, ?)')
    .run(first, 'country-flag-check', new Date().toISOString().slice(0, 19).replace('T', ' '), '/country', '8.8.8.8');
  const countries = (await report('?project=' + first)).body.message.countries;
  assert.equal(countries.reduce((total, row) => total + row.views, 0), 1);
  assert.equal(countries[0].ip_count, 1);

  assert.equal((await admin('statistics_diy.maintenance.clear_data', {confirmation: 'nope'})).status, 417);
  assert.equal((await admin('statistics_diy.maintenance.save_settings', {retention_days: '90'})).status, 200);
  assert.equal((await admin('statistics_diy.maintenance.clear_data', {confirmation: 'DELETE ANALYTICS'})).status, 200);
  assert.equal((await report('?project=' + first)).body.message.total, 0);
});

test('app activity pings are deduplicated and validated', async t => {
  const {db, base, server} = await boot();
  t.after(() => server.close());
  db.prepare("INSERT INTO projects VALUES ('p1','App','https://app.example',1,'k','tok','2026-01-01 00:00:00')").run();
  const ping = body => fetch(base + '/api/method/statistics_diy.activity.ping', {method: 'POST', body: new URLSearchParams(body)}).then(async r => [r.status, await r.json()]);
  const ok = {token: 'tok', install_id: VISITOR, event_id: 'b379bbf9-65b1-4a17-a7ce-569e13674ef9', platform: 'Linux', app_version: '1.0'};
  assert.deepEqual(await ping(ok), [200, {message: {accepted: true}}]);
  assert.deepEqual(await ping(ok), [200, {message: {accepted: true, duplicate: true}}]);
  assert.equal((await ping({...ok, token: 'x'}))[0], 403);
  assert.equal((await ping({...ok, platform: 'Plan9', event_id: 'c379bbf9-65b1-4a17-a7ce-569e13674ef9'}))[0], 417);
});

test('the deployed tracker script path and assets are served', async t => {
  const {base, server} = await boot();
  t.after(() => server.close());
  const script = await fetch(base + '/assets/statistics_diy/js/tracker.js');
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(await script.text(), /statistics_diy\.api\.collect/);
  assert.equal((await fetch(base + '/assets/statistics_diy/../../server.mjs')).status, 404);
});

test('user agent and IP helpers', () => {
  assert.deepEqual(classify('Mozilla/5.0 (iPhone) Mobile Safari/604.1'), {device: 'Mobile', browser: 'Safari', operating_system: 'iOS', is_bot: 0});
  assert.equal(classify('Googlebot/2.1').is_bot, 1);
  assert.equal(normalizeIp('::ffff:8.8.8.8'), '8.8.8.8');
  assert.equal(isGlobal('8.8.8.8'), true);
  assert.equal(isGlobal('192.168.1.5'), false);
  assert.equal(isGlobal('::1'), false);
});
