// Country estimates from IPinfo Lite, with an optional offline database fallback.
import {existsSync} from 'node:fs';
import {isGlobal} from './network.mjs';

let opened;
const ipinfoCache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;
async function reader() {
  opened ??= (async () => {
    const file = process.env.STATISTICS_GEOIP_DATABASE
      || ['/data/geoip/city.mmdb', '/data/geoip/country.mmdb'].find(existsSync);
    if (!file || !existsSync(file)) return null;
    try { return (await import('maxmind')).default.open(file); } catch { return null; }
  })();
  return opened;
}

export const flag = code => typeof code === 'string' && /^[A-Za-z]{2}$/.test(code)
  ? [...code.toUpperCase()].map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('') : '';

async function ipinfoRecords(addresses) {
  const token = process.env.STATISTICS_IPINFO_TOKEN;
  const records = new Map();
  if (!token || !addresses.length) return records;
  const now = Date.now();
  const missing = addresses.filter(address => {
    const cached = ipinfoCache.get(address);
    if (cached && cached.expires > now) { records.set(address, cached.record); return false; }
    return true;
  });
  for (let index = 0; index < missing.length; index += 1000) {
    const batch = missing.slice(index, index + 1000);
    try {
      const response = await fetch('https://api.ipinfo.io/batch/lite', {
        method: 'POST', headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(batch), signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const address of batch) {
        const result = data[address];
        const code = flag(result?.country_code) ? result.country_code.toUpperCase() : null;
        const record = code ? {country_code: code, country_name: result.country || 'Unknown', country_flag: flag(code)} : null;
        if (record) {
          records.set(address, record);
          ipinfoCache.set(address, {record, expires: now + CACHE_MS});
        }
      }
    } catch { /* Keep the report available when IPinfo cannot be reached. */ }
  }
  if (ipinfoCache.size > 10000) {
    for (const [address, cached] of ipinfoCache) if (cached.expires <= now) ipinfoCache.delete(address);
    while (ipinfoCache.size > 10000) ipinfoCache.delete(ipinfoCache.keys().next().value);
  }
  return records;
}

export async function decorateIps(rows) {
  const db = await reader();
  const addresses = [...new Set(rows.map(row => row.ip_address).filter(address => address && isGlobal(address)))];
  const ipinfo = await ipinfoRecords(addresses);
  const cache = new Map();
  for (const row of rows) {
    const address = row.ip_address;
    if (!cache.has(address)) {
      let record = {};
      try { if (db && address && isGlobal(address)) record = db.get(address) || {}; } catch { /* unknown address */ }
      const code = record.country?.iso_code;
      cache.set(address, {country_code: flag(code) ? code : null, country_name: record.country?.names?.en || 'Unknown',
        country_flag: flag(code), city: record.city?.names?.en ?? null, region: record.subdivisions?.[0]?.names?.en ?? null,
        ...ipinfo.get(address)});
    }
    Object.assign(row, cache.get(address));
  }
}
