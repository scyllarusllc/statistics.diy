export function reportTimezone(value) {
  const timezone = value || 'UTC';
  if (typeof timezone !== 'string' || timezone.length > 100) throw new Error('Invalid timezone.');
  try { return new Intl.DateTimeFormat('en-US', {timeZone: timezone}).resolvedOptions().timeZone; }
  catch { throw new Error('Invalid timezone.'); }
}

const formatters = new Map();

export function localDay(date, timezone) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-US', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}));
  const parts = Object.fromEntries(formatters.get(timezone)
    .formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dayStart(day, timezone) {
  const guess = Date.parse(day + 'T00:00:00Z');
  let low = guess - 36 * 3600000, high = guess + 36 * 3600000;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2000) * 1000;
    if (localDay(new Date(middle), timezone) < day) low = middle;
    else high = middle;
  }
  return new Date(high);
}

export function addDays(day, count) {
  return new Date(Date.parse(day + 'T00:00:00Z') + count * 86400000).toISOString().slice(0, 10);
}
