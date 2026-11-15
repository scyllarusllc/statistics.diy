import test from 'node:test';
import assert from 'node:assert/strict';
import {decorateIps} from '../src/geo.mjs';

test('IPinfo Lite adds country flags without sending private IPs or exposing the token', async t => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.STATISTICS_IPINFO_TOKEN;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.STATISTICS_IPINFO_TOKEN;
    else process.env.STATISTICS_IPINFO_TOKEN = originalToken;
  });
  process.env.STATISTICS_IPINFO_TOKEN = 'test-secret';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.ipinfo.io/batch/lite');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.deepEqual(JSON.parse(options.body), ['8.8.8.8']);
    return {ok: true, json: async () => ({'8.8.8.8': {country_code: 'US', country: 'United States'}})};
  };
  const rows = [{ip_address: '8.8.8.8'}, {ip_address: '8.8.8.8'}, {ip_address: '127.0.0.1'}];
  await decorateIps(rows);
  assert.equal(rows[0].country_flag, '🇺🇸');
  assert.equal(rows[1].country_name, 'United States');
  assert.equal(rows[2].country_flag, '');
  await decorateIps([{ip_address: '8.8.8.8'}]);
  assert.equal(calls, 1);
});
