// Offline country and city estimates. Visitor IPs never leave the server for lookup.
import {existsSync} from 'node:fs';
import {isGlobal} from './network.mjs';

let opened;
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

export async function decorateIps(rows) {
  const db = await reader();
  const cache = new Map();
  for (const row of rows) {
    const address = row.ip_address;
    if (!cache.has(address)) {
      let record = {};
      try { if (db && address && isGlobal(address)) record = db.get(address) || {}; } catch { /* unknown address */ }
      const code = record.country?.iso_code;
      cache.set(address, {country_code: flag(code) ? code : null, country_name: record.country?.names?.en || 'Unknown',
        country_flag: flag(code), city: record.city?.names?.en ?? null, region: record.subdivisions?.[0]?.names?.en ?? null});
    }
    Object.assign(row, cache.get(address));
  }
}
