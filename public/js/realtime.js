(() => {
  const hero = document.getElementById('realtime-hero');
  if (!hero) return;
  const project = hero.dataset.project;
  const storageKey = 'statistics_diy_realtime_window:' + project;
  const allowed = new Set(['1', '10', '30', '60']);
  let minutes = '60';
  try { const saved = localStorage.getItem(storageKey); if (allowed.has(saved)) minutes = saved; } catch { /* Storage may be unavailable. */ }
  let generation = 0;
  let mapData = null;
  let report = null;
  let previousIds = null;
  let newVisitorIds = new Set();
  let newCountryCounts = new Map();
  const mapTarget = document.getElementById('realtime-map');
  const countryTarget = document.getElementById('realtime-countries');
  const visitorTarget = document.getElementById('realtime-visitor-list');
  const status = document.getElementById('realtime-updated');
  const ns = 'http://www.w3.org/2000/svg';
  const t = typeof statisticsT === 'function' ? statisticsT : value => value;
  const fallbackCenters = {MP: [814, 168], GU: [810, 181], PR: [283, 166], SG: [710, 204], HK: [736, 155], MO: [734, 158], BH: [576, 180], MT: [486, 172]};

  function updateButtons() {
    for (const button of hero.querySelectorAll('[data-minutes]')) {
      const active = button.dataset.minutes === minutes;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('bg-indigo-600', active);
      button.classList.toggle('text-white', active);
      button.classList.toggle('border-indigo-600', active);
    }
  }

  function renderMap() {
    if (!mapData || !report) return;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 900 414');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('Visitors seen by country in the last') + ' ' + minutes + ' ' + t('minutes'));
    const background = document.createElementNS(ns, 'rect');
    background.setAttribute('width', '900'); background.setAttribute('height', '414');
    background.setAttribute('fill', '#f8fafc'); svg.append(background);
    const active = new Map(report.countries.map(row => [row.country_code, row]));
    const centers = new Map();
    for (const country of mapData.countries) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', country.path);
      path.setAttribute('fill', active.has(country.code) ? '#a5b4fc' : '#cbd5e1');
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('stroke', '#f8fafc'); path.setAttribute('stroke-width', '0.7');
      svg.append(path);
      if (country.code) centers.set(country.code, country.center);
    }
    for (const row of report.countries) {
      const center = fallbackCenters[row.country_code] || centers.get(row.country_code);
      if (!center) continue;
      if (newCountryCounts.has(row.country_code)) {
        const pulse = document.createElementNS(ns, 'circle');
        pulse.setAttribute('cx', center[0]); pulse.setAttribute('cy', center[1]);
        pulse.setAttribute('r', '10'); pulse.setAttribute('fill', 'none');
        pulse.setAttribute('stroke', '#4f46e5'); pulse.setAttribute('stroke-width', '3');
        pulse.classList.add('live-new-marker'); svg.append(pulse);
      }
      const marker = document.createElementNS(ns, 'circle');
      marker.setAttribute('cx', center[0]); marker.setAttribute('cy', center[1]);
      marker.setAttribute('r', Math.min(17, 4 + Math.sqrt(row.visitors) * 3));
      marker.setAttribute('fill', '#4f46e5'); marker.setAttribute('fill-opacity', '0.82');
      marker.setAttribute('stroke', 'white'); marker.setAttribute('stroke-width', '2');
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${row.country_name}: ${row.visitors} ${t('Visitors seen')}`; marker.append(title);
      svg.append(marker);
    }
    mapTarget.replaceChildren(svg);
  }

  function renderVisitors() {
    visitorTarget.replaceChildren();
    if (!report.recent_visitors.length) {
      const empty = document.createElement('li'); empty.className = 'text-sm text-slate-500';
      empty.textContent = t('No visitors seen in this window.'); visitorTarget.append(empty);
      return;
    }
    for (const visitor of report.recent_visitors) {
      const item = document.createElement('li');
      item.className = 'rounded-lg border border-slate-100 bg-slate-50 p-3';
      if (newVisitorIds.has(visitor.id)) item.classList.add('live-new-visitor');
      const heading = document.createElement('div'); heading.className = 'flex items-center justify-between gap-2';
      const name = document.createElement('strong'); name.className = 'truncate text-xs font-semibold text-slate-800';
      name.textContent = `${visitor.country_flag ? visitor.country_flag + ' ' : ''}${visitor.country_name || t('Unknown')}`;
      const time = document.createElement('time'); time.className = 'shrink-0 text-[11px] tabular-nums text-slate-500';
      time.dateTime = visitor.last_seen.replace(' ', 'T') + 'Z';
      time.textContent = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit'}).format(new Date(time.dateTime));
      heading.append(name, time);
      const path = document.createElement('p'); path.className = 'mt-2 truncate text-xs font-medium text-slate-700';
      path.textContent = visitor.path || '/'; path.title = path.textContent;
      const detail = document.createElement('p'); detail.className = 'mt-1 truncate text-[11px] text-slate-500';
      detail.textContent = [visitor.browser, visitor.device, visitor.operating_system].filter(Boolean).join(' · ') || t('Unknown');
      const source = document.createElement('p'); source.className = 'mt-1 truncate text-[11px] text-slate-500';
      source.textContent = `${visitor.page_views} ${t('views')} · ${visitor.referrer_host || t('Direct / Unknown')}`;
      source.title = source.textContent;
      const id = document.createElement('p'); id.className = 'mt-1 font-mono text-[10px] text-slate-400';
      id.textContent = '#' + visitor.id + (visitor.visitor_timezone ? ' · ' + visitor.visitor_timezone : '');
      item.append(heading, path, detail, source, id); visitorTarget.append(item);
    }
  }

  function renderBreakdown(id, rows) {
    const target = document.getElementById(id); target.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('li'); empty.className = 'text-slate-500';
      empty.textContent = t('No activity in this window.'); target.append(empty); return;
    }
    for (const row of rows) {
      const item = document.createElement('li'); item.className = 'flex min-w-0 items-center justify-between gap-3';
      const label = document.createElement('span'); label.className = 'min-w-0 truncate text-slate-600';
      label.textContent = t(row.label); label.title = label.textContent;
      const count = document.createElement('strong'); count.className = 'shrink-0 tabular-nums text-slate-800';
      count.textContent = row.views;
      item.append(label, count); target.append(item);
    }
  }

  function render() {
    if (!report) return;
    document.getElementById('realtime-visitors').textContent = report.visitors;
    document.getElementById('realtime-views').textContent = `${report.page_views} ${t('page views in the last')} ${minutes} ${t('minutes')}`;
    document.getElementById('realtime-views-per-visitor').textContent = report.visitors > 0
      ? t('Views per visitor') + ': ' + new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format(report.page_views / report.visitors)
      : '';
    document.getElementById('realtime-last-visit').textContent = report.last_visit_at
      ? t('Last activity') + ': ' + new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(report.last_visit_at.replace(' ', 'T') + 'Z'))
      : t('No activity in this window.');
    countryTarget.replaceChildren();
    if (!report.countries.length) {
      const empty = document.createElement('li'); empty.className = 'text-slate-500';
      empty.textContent = t('No visitors seen in this window.'); countryTarget.append(empty);
    }
    for (const row of report.countries) {
      const item = document.createElement('li'); item.className = 'flex items-center justify-between gap-3';
      const name = document.createElement('span'); name.textContent = `${row.country_flag ? row.country_flag + ' ' : ''}${row.country_name}`;
      const count = document.createElement('strong'); count.className = 'tabular-nums'; count.textContent = row.visitors;
      item.append(name, count); countryTarget.append(item);
    }
    renderVisitors();
    renderBreakdown('realtime-pages', report.top_pages);
    renderBreakdown('realtime-sources', report.top_sources);
    renderBreakdown('realtime-devices', report.devices);
    const added = newVisitorIds.size;
    status.textContent = t('Updated') + ' ' + new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(report.updated_at)) + (added ? ` · ${added} ${t('new visitors')}` : '');
    renderMap();
  }

  async function load() {
    const current = ++generation;
    status.textContent = t('Updating…');
    try {
      const response = await fetch('/api/method/statistics_diy.api.realtime?project=' + encodeURIComponent(project) + '&minutes=' + minutes, {credentials: 'same-origin'});
      if (!response.ok) throw new Error('Realtime request failed');
      const {message} = await response.json();
      if (current !== generation) return;
      newVisitorIds = new Set(previousIds ? message.active_ids.filter(id => !previousIds.has(id)) : []);
      previousIds = new Set(message.active_ids);
      newCountryCounts = new Map();
      for (const visitor of message.recent_visitors) {
        if (newVisitorIds.has(visitor.id) && visitor.country_code) newCountryCounts.set(visitor.country_code, (newCountryCounts.get(visitor.country_code) || 0) + 1);
      }
      report = message; render();
    } catch { if (current === generation) status.textContent = t('Unable to update live activity.'); }
  }

  for (const button of hero.querySelectorAll('[data-minutes]')) button.addEventListener('click', () => {
    minutes = button.dataset.minutes;
    previousIds = null;
    try { localStorage.setItem(storageKey, minutes); } catch { /* Storage may be unavailable. */ }
    updateButtons(); load();
  });
  updateButtons();
  fetch('/assets/statistics_diy/data/world-map.json').then(response => {
    if (!response.ok) throw new Error('Map unavailable');
    return response.json();
  }).then(data => { mapData = data; renderMap(); }).catch(() => { mapTarget.textContent = t('Map unavailable.'); });
  load();
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
