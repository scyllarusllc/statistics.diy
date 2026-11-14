// Coarse User-Agent categories. No raw UA or fingerprint is stored.
export function classify(userAgent) {
  const ua = String(userAgent || '').slice(0, 2000).toLowerCase();
  const bot = /bot\b|crawler|spider|headless|slurp|facebookexternalhit|curl\/|wget\//.test(ua);
  const device = ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile')) ? 'Tablet'
    : ['mobile', 'iphone', 'ipod'].some(x => ua.includes(x)) ? 'Mobile' : ua ? 'Desktop' : 'Unknown';
  const find = (table, fallback) => table.find(([token]) => ua.includes(token))?.[1] ?? fallback;
  const browser = find([['edg/', 'Edge'], ['opr/', 'Opera'], ['firefox/', 'Firefox'], ['fxios/', 'Firefox'], ['chrome/', 'Chrome'], ['crios/', 'Chrome'], ['safari/', 'Safari']], 'Other');
  const operating_system = find([['android', 'Android'], ['iphone', 'iOS'], ['ipad', 'iOS'], ['windows', 'Windows'], ['macintosh', 'macOS'], ['mac os', 'macOS'], ['linux', 'Linux']], 'Other');
  return {device, browser, operating_system, is_bot: bot ? 1 : 0};
}
