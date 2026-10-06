const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../statistics_diy/public/js/tracker.js'), 'utf8');
function browser({blocked = false, privacy = false} = {}) {
  const saved = new Map(), sent = [];
  const storage = {getItem: key => {if (blocked) throw new Error('Blocked'); return saved.get(key) || null;}, setItem: (key, value) => {if (blocked) throw new Error('Blocked'); saved.set(key, value);}};
  const context = vm.createContext({document: {currentScript: {dataset: {key: 'project-key'}, src: 'https://statistics.diy/assets/statistics_diy/js/tracker.js'}, referrer: ''},
    navigator: {globalPrivacyControl: privacy}, location: {pathname: '/'}, localStorage: storage, sessionStorage: storage,
    crypto: {randomUUID}, Date, Intl, URL, URLSearchParams,
    fetch: (_, options) => {sent.push(options.body); return Promise.resolve({});}});
  return {sent, run: () => vm.runInContext(source, context)};
}
const normal = browser(); normal.run(); normal.run();
assert.equal(normal.sent.length, 2);
assert.equal(normal.sent[0].get('visitor_id'), normal.sent[1].get('visitor_id'));
assert.notEqual(normal.sent[0].get('event_id'), normal.sent[1].get('event_id'));
const blocked = browser({blocked: true}); blocked.run();
assert.equal(blocked.sent.length, 1); assert.equal(blocked.sent[0].has('visitor_id'), false);
const privateBrowser = browser({privacy: true}); privateBrowser.run(); assert.equal(privateBrowser.sent.length, 0);
console.log('Tracker keeps browser IDs stable across page loads, handles blocked storage and respects privacy opt-outs.');
