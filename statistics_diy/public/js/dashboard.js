(() => {
  const select = document.getElementById('analytics-project');
  if (!select) return;
  const requestedProject = new URLSearchParams(location.search).get('project');
  if ([...select.options].some(option => option.value === requestedProject)) select.value = requestedProject;
  const status = document.getElementById('statistics-status');
  const results = document.getElementById('statistics-results');
  let generation = 0;
  let report = null;
  let selectedDay = null;
  let chartRows = [];
  const range = document.getElementById('report-range');
  const exportButton = document.getElementById('export-statistics');
  let activeChartIndex = null;
  function chart(rows) {
    const target = document.getElementById('traffic-chart');
    const hadFocus = target.contains(document.activeElement);
    target.replaceChildren();
    const statusText = document.getElementById('chart-tooltip');
    const viewsToggle = document.getElementById('chart-views');
    const visitorsToggle = document.getElementById('chart-visitors');
    if (!viewsToggle.checked && !visitorsToggle.checked) viewsToggle.checked = true;
    viewsToggle.disabled = viewsToggle.checked && !visitorsToggle.checked;
    visitorsToggle.disabled = visitorsToggle.checked && !viewsToggle.checked;
    const ns = 'http://www.w3.org/2000/svg';
    const selectedIndex = rows.findIndex(row => row.day === selectedDay);
    let active = selectedIndex >= 0 ? selectedIndex : Math.min(activeChartIndex ?? rows.length - 1, rows.length - 1);
    const maximum = Math.max(1, ...rows.map(row => viewsToggle.checked ? row.views || 0 : 0), ...rows.map(row => visitorsToggle.checked ? row.visitors || 0 : 0));
    const ceiling = Math.ceil(maximum / (maximum > 20 ? 10 : 1)) * (maximum > 20 ? 10 : 1);
    const width = 880 / Math.max(1, rows.length);
    const x = index => 10 + (index + 0.5) * width;
    const y = value => 210 - (value || 0) / ceiling * 200;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 900 220'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'group'); svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', statisticsT('Traffic trend'));
    svg.setAttribute('aria-describedby', 'chart-tooltip');
    svg.classList.add('w-full', 'h-[220px]', 'outline-none', 'focus-visible:ring-2', 'focus-visible:ring-indigo-400');
    svg.style.touchAction = 'pan-y'; svg.style.cursor = 'crosshair';
    for (const fraction of [0, 0.5, 1]) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '10'); line.setAttribute('x2', '890');
      line.setAttribute('y1', 210 - fraction * 200); line.setAttribute('y2', 210 - fraction * 200);
      line.setAttribute('stroke', '#e2e8f0'); line.setAttribute('stroke-dasharray', '3 5'); svg.append(line);
      const label = document.createElement('span'); label.className = 'absolute left-0 text-[10px] tabular-nums text-slate-400';
      label.style.top = (210 - fraction * 200 - 6) + 'px'; label.textContent = Math.round(ceiling * fraction); target.append(label);
    }
    rows.forEach((row, index) => {
      if (row.available !== false) return;
      const shade = document.createElementNS(ns, 'rect');
      shade.setAttribute('x', 10 + index * width); shade.setAttribute('y', '10'); shade.setAttribute('width', width);
      shade.setAttribute('height', '200'); shade.setAttribute('fill', '#f1f5f9'); svg.append(shade);
    });
    const series = [[viewsToggle.checked, 'views', '#4f46e5'], [visitorsToggle.checked, 'visitors', '#10b981']].filter(item => item[0]);
    for (const [, key, color] of series) {
      const path = document.createElementNS(ns, 'path'); let connected = false;
      const segments = [];
      rows.forEach((row, index) => {
        if (row.available === false || row[key] == null) { connected = false; return; }
        segments.push(`${connected ? 'L' : 'M'} ${x(index)} ${y(row[key])}`); connected = true;
      });
      path.setAttribute('d', segments.join(' ')); path.setAttribute('fill', 'none'); path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2'); path.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(path);
    }
    const guide = document.createElementNS(ns, 'line'); guide.setAttribute('y1', '10'); guide.setAttribute('y2', '210');
    guide.setAttribute('stroke', '#94a3b8'); guide.setAttribute('stroke-dasharray', '4 4'); guide.style.display = 'none'; svg.append(guide);
    const dots = series.map(([, key, color]) => {
      const point = document.createElementNS(ns, 'circle'); point.setAttribute('r', '4');
      point.setAttribute('fill', color); point.setAttribute('stroke', 'white'); point.setAttribute('stroke-width', '2'); point.style.display = 'none'; svg.append(point);
      return [key, point];
    });
    const bubble = document.createElement('div');
    bubble.className = 'pointer-events-none absolute top-2 z-20 max-w-56 rounded-xl bg-slate-900 px-4 py-3 text-xs leading-6 text-white shadow-lg';
    bubble.hidden = true;
    target.append(svg, bubble);
    const dates = document.createElement('div'); dates.className = 'mt-2 flex justify-between pl-1 text-[10px] tabular-nums text-slate-400';
    for (const index of [0, Math.floor((rows.length - 1) / 2), rows.length - 1]) {
      const label = document.createElement('span'); label.textContent = rows[index]?.day || ''; dates.append(label);
    }
    target.append(dates);
    const describe = row => row.available === false ? `${row.day} · ${statisticsT('Outside retention')}` :
      `${row.day} · ${statisticsT('Page views')}: ${row.views ?? '—'} · ${statisticsT('Unique visitors')}: ${row.visitors ?? '—'}`;
    function show(index, floating = true) {
      if (!rows.length) return;
      active = Math.max(0, Math.min(rows.length - 1, index)); activeChartIndex = active;
      const row = rows[active]; const position = x(active);
      guide.setAttribute('x1', position); guide.setAttribute('x2', position); guide.style.display = '';
      for (const [key, point] of dots) {
        point.style.display = row.available === false || row[key] == null ? 'none' : '';
        point.setAttribute('cx', position); point.setAttribute('cy', y(row[key]));
      }
      bubble.replaceChildren();
      const date = document.createElement('strong'); date.className = 'block'; date.textContent = row.day + ' · UTC'; bubble.append(date);
      const metrics = row.available === false ? [statisticsT('Outside retention')] : series.map(([, key]) => `${statisticsT(key === 'views' ? 'Page views' : 'Unique visitors')}: ${row[key] ?? '—'}`);
      for (const metric of metrics) { const line = document.createElement('span'); line.className = 'block'; line.textContent = metric; bubble.append(line); }
      bubble.hidden = !floating;
      const pixel = 40 + position / 900 * svg.getBoundingClientRect().width;
      bubble.style.left = Math.max(40, Math.min(pixel + 12, target.clientWidth - bubble.offsetWidth - 4)) + 'px';
      statusText.textContent = describe(row);
      svg.setAttribute('aria-label', statisticsT('Traffic trend') + ': ' + describe(row));
    }
    function restore() {
      bubble.hidden = true;
      if (selectedIndex >= 0) show(selectedIndex, false);
      else { guide.style.display = 'none'; dots.forEach(([, dot]) => { dot.style.display = 'none'; }); statusText.textContent = statisticsT('Move across the chart to inspect a day.'); }
    }
    const nearest = event => {
      const bounds = svg.getBoundingClientRect();
      const position = (event.clientX - bounds.left) / Math.max(1, bounds.width) * 900;
      return Math.max(0, Math.min(rows.length - 1, Math.floor((position - 10) / width)));
    };
    let pointerStart = null;
    svg.addEventListener('pointermove', event => show(nearest(event)));
    svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) restore(); });
    svg.addEventListener('pointerdown', event => { pointerStart = {x: event.clientX, y: event.clientY}; show(nearest(event)); });
    const choose = () => {
      if (!rows[active] || rows[active].available === false) return;
      selectedDay = selectedDay === rows[active].day ? null : rows[active].day;
      document.getElementById('clear-day').hidden = !selectedDay;
      document.getElementById('selected-chart-day').textContent = selectedDay ? statisticsT('Selected day:') + ' ' + selectedDay : statisticsT('Full date range');
      load();
    };
    svg.addEventListener('pointerup', event => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 10) { show(nearest(event)); choose(); }
      pointerStart = null;
    });
    svg.addEventListener('pointercancel', () => { pointerStart = null; restore(); });
    svg.addEventListener('focus', () => show(active)); svg.addEventListener('blur', restore);
    svg.addEventListener('keydown', event => {
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowRight') show(active + 1);
      else if (event.key === 'ArrowLeft') show(active - 1);
      else if (event.key === 'Home') show(0);
      else if (event.key === 'End') show(rows.length - 1);
      else if (event.key === 'Enter' || event.key === ' ') choose();
      else if (event.key === 'Escape') { selectedDay = null; load(); }
    });
    document.getElementById('clear-day').hidden = !selectedDay;
    document.getElementById('selected-chart-day').textContent = selectedDay ? statisticsT('Selected day:') + ' ' + selectedDay : statisticsT('Full date range');
    document.getElementById('chart-legend').textContent = statisticsT('Peak daily visitors:') + ' ' + Math.max(0, ...rows.map(row => row.visitors || 0));
    if (selectedIndex >= 0) show(selectedIndex, false); else restore();
    if (hadFocus) svg.focus({preventScroll: true});
  }
  exportButton.addEventListener('click', () => {
    if (!report) return;
    const rows = [['section', 'value', 'views', 'unique_visitors'],
      ...report.projects.map(row => ['projects', `${row.project_name} (${row.name})`, row.views, row.visitors ?? '']),
      ...report.ips.map(row => ['ips', row.ip_address, row.views, row.visitors]),
      ...report.daily.map(row => ['daily', row.day, row.views ?? '', row.visitors ?? '']),
      ...report.pages.map(row => ['pages', `${row.project_name} (${row.project}): ${row.path}`, row.views, row.visitors ?? '']),
      ...report.referrers.map(row => ['referrers', row.referrer_host || 'Direct / Unknown', row.views, row.visitors ?? ''])];
    const cell = value => {
      let text = String(value); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `statistics-${select.value || "all-projects"}-${report.start}-${report.end}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function ipCell(row) {
    const container = document.createElement('span'); container.className = 'block whitespace-nowrap';
    const location = [row.country_flag, row.city || (row.country_name !== 'Unknown' ? row.country_name : '')].filter(Boolean).join(' ');
    if (location) { const place = document.createElement('span'); place.className = 'mb-1 block font-medium text-slate-700'; place.textContent = location; container.append(place); }
    const ip = document.createElement('span'); ip.className = 'block font-mono text-[11px] text-slate-400';
    ip.textContent = row.ip_address || statisticsT('Not recorded'); container.append(ip);
    container.title = [row.city, row.region, row.country_name].filter(Boolean).join(', ');
    return container;
  }
  function table(id, rows, key, heading) {
    const container = document.getElementById(id); container.replaceChildren();
    if (!rows.length) { container.textContent = statisticsT('No page views collected yet.'); return; }
    const element = document.createElement('table'); element.className = 'analytics-table';
    const head = element.createTHead().insertRow();
    [heading, statisticsT('Views'), statisticsT('Unique visitors')].forEach((title, index) => {
      const th = document.createElement('th'); th.scope = 'col'; if (index) th.className = 'analytics-number'; th.textContent = title; head.append(th);
    });
    const body = element.createTBody();
    for (const row of rows) {
      const tr = body.insertRow(); const label = tr.insertCell();
      if (key === 'ip_address') label.append(ipCell(row));
      else { label.className = 'w-full max-w-0'; const text = document.createElement('span'); text.className = 'block truncate'; text.textContent = row[key] ?? statisticsT('Unknown'); text.title = text.textContent; label.append(text); }
      for (const value of [row.views, row.visitors]) { const cell = tr.insertCell(); cell.className = 'analytics-number'; cell.textContent = value ?? '—'; }
    }
    container.append(element);
  }
  function detailsTable(id, rows, columns) {
    const container = document.getElementById(id); container.replaceChildren();
    if (!rows.length) { container.textContent = statisticsT('No data yet.'); return; }
    const element = document.createElement('table'); element.className = 'analytics-table' + (columns.length > 3 ? ' analytics-details-table' : '');
    const header = element.createTHead().insertRow();
    for (const [label] of columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.append(th); }
    const body = element.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const [, value] of columns) {
        const cell = tr.insertCell(); const text = value(row);
        if (text instanceof Node) cell.append(text);
        else { cell.className = 'whitespace-nowrap'; cell.textContent = text ?? '—'; }
      }
    }
    container.append(element);
  }
  function compactTime(value) { return value ? String(value).slice(0, 16).replace('T', ' ') : '—'; }
  async function load() {
    const current = ++generation;
    report = null; exportButton.disabled = true;
    if (!report && !chartRows.length) results.hidden = true; status.textContent = statisticsT('Loading…');
    document.getElementById('manage-project').href = '/statistics_diy/admin/projects';
    try {
      const response = await fetch('/api/method/statistics_diy.api.summary?project=' + encodeURIComponent(select.value) + '&days=' + range.value + '&exclude_bots=' + Number(document.getElementById('exclude-bots').checked), {credentials: 'same-origin'});
      if (!response.ok) throw new Error('Request failed');
      let {message: data} = await response.json();
      const trend = data.daily;
      if (selectedDay) {
        const detail = await fetch('/api/method/statistics_diy.api.summary?project=' + encodeURIComponent(select.value) + '&days=' + range.value + '&exclude_bots=' + Number(document.getElementById('exclude-bots').checked) + '&day=' + selectedDay, {credentials: 'same-origin'});
        if (!detail.ok) throw new Error('Request failed');
        data = (await detail.json()).message;
      }
      if (current !== generation) return;
      report = data; exportButton.disabled = false;
      document.getElementById('total-views').textContent = data.total;
      document.getElementById('visitor-card-label').textContent = statisticsT(!data.visitor_count_complete ? 'Unique visitors (partial)' : data.ip_fallback_views ? 'Estimated unique visitors' : 'Unique visitors');
      document.getElementById('unique-visitors').textContent = data.identified_views || !data.total ? data.visitors : '—';
      document.getElementById('visitor-coverage').textContent = `${data.ip_visitors} ${statisticsT('additional visitors estimated from IPs')} · ${data.ip_fallback_views} ${statisticsT('views used IP fallback')} · ${data.unmeasured_views} ${statisticsT('views have neither a browser ID nor an IP.')}`;
      document.getElementById('report-period').textContent = `${data.start} — ${data.end} · UTC · ${statisticsT('Data available since:')} ${data.retention_start}`;
      chartRows = trend;
      chart(chartRows);
      document.getElementById('event-summary').textContent = data.stored_events + ' ' + statisticsT('events stored') + ' · ' + data.bot_hits + ' ' + statisticsT('detected bot hits in range') + ' · ' + data.retention_days + ' ' + statisticsT('days retained');
      document.getElementById('returning-visitors').textContent = data.returning + ' / ' + data.visitors;
      document.getElementById('today-statistics').textContent = data.today.views + ' / ' + data.today.visitors;
      for (const [key, rows] of Object.entries(data.breakdowns)) table('breakdown-' + key, rows.map(row => ({...row, label: statisticsT(row.label)})), 'label', statisticsT('Category'));
      detailsTable('recent-visits', data.recent, [
        [statisticsT('Time (UTC)'), row => compactTime(row.occurred_at)],
        [statisticsT('Visitor'), row => row.visitor || '—'],
        [statisticsT('IP address'), row => ipCell(row)],
        [statisticsT('Project / Path'), row => {
          const cell = document.createElement('span'); cell.className = 'block max-w-64';
          const project = document.createElement('span'); project.className = 'mb-1 block text-[11px] text-slate-400'; project.textContent = data.projects.find(item => item.name === row.project)?.project_name || row.project;
          const path = document.createElement('span'); path.className = 'block truncate'; path.textContent = row.path; path.title = row.path; cell.append(project, path); return cell;
        }],
        [statisticsT('Device / Browser'), row => statisticsT(row.device || 'Unknown') + ' · ' + (row.browser || 'Unknown')],
        [statisticsT('Operating systems'), row => row.operating_system || 'Unknown'],
        [statisticsT('Visitor timezone'), row => row.visitor_timezone || '—'],
        [statisticsT('Source'), row => row.referrer_host || statisticsT('Direct / Unknown')]]);
      detailsTable('known-visitors', data.known, [
        [statisticsT('Label'), row => {
          const input = document.createElement('input'); input.value = row.label || ''; input.maxLength = 100;
          input.className = 'w-40 rounded-lg border border-slate-200 px-3 py-2'; input.setAttribute('aria-label', statisticsT('Label') + ' ' + row.visitor_id.slice(0, 10));
          input.addEventListener('change', async () => {
            input.disabled = true;
            try { await statisticsRequest('statistics_diy.maintenance.label_visitor', {project: row.project, visitor_id: row.visitor_id, label: input.value}); }
            catch (error) { status.textContent = error.message; }
            finally { input.disabled = false; }
          }); return input;
        }],
        [statisticsT('Visitor'), row => (data.projects.find(item => item.name === row.project)?.project_name || row.project) + ' · ' + row.visitor_id.slice(0, 10)],
        [statisticsT('First seen (UTC)'), row => compactTime(row.first_seen)],
        [statisticsT('Last seen (UTC)'), row => compactTime(row.last_seen)],
        [statisticsT('Views'), row => row.visits], [statisticsT('Sessions'), row => row.sessions || '—']]);
      const appTarget = document.getElementById('app-statistics'); appTarget.replaceChildren();
      for (const [key, title] of [['dau', 'Active today (DAU)'], ['mau', 'Active last 30 days (MAU)'], ['installs', 'Known installs (retained data)'], ['pings', 'Stored app pings']]) {
        const item = document.createElement('div'); item.className = 'rounded-xl border border-slate-100 bg-slate-50 p-4'; const value = document.createElement('strong'); value.className = 'mb-2 block text-2xl font-semibold tabular-nums'; value.textContent = data.apps[key];
        const label = document.createElement('span'); label.className = 'text-sm text-slate-500'; label.textContent = statisticsT(title); item.append(value, label); appTarget.append(item);
      }
      detailsTable('app-platforms', data.app_platforms, [[statisticsT('Platform'), row => row.label], [statisticsT('Installs'), row => row.installs]]);
      document.getElementById('project-overview').hidden = !data.all_projects;
      const totals = document.getElementById('project-totals'); totals.replaceChildren();
      for (const project of data.projects) {
        const row = document.createElement('a');
        row.href = '/statistics_diy/admin/dashboard?project=' + encodeURIComponent(project.name);
        row.className = 'min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-4 hover:border-indigo-200';
        const label = document.createElement('span');
        label.className = 'block truncate text-sm font-semibold'; label.textContent = project.project_name + (project.enabled ? '' : ' ' + statisticsT('(disabled)'));
        const origin = document.createElement('span'); origin.className = 'mt-1 block truncate text-xs text-slate-400'; origin.textContent = project.website_origin; origin.title = project.website_origin;
        const count = document.createElement('strong'); count.className = 'mt-4 block text-xs font-medium tabular-nums text-slate-600'; count.textContent = project.views + ' ' + statisticsT('Views') + ' · ' + (project.unmeasured_views === project.views && project.views > 0 ? '—' : project.visitors) + ' ' + statisticsT(project.unmeasured_views ? 'Unique visitors (partial)' : 'Unique visitors');
        row.append(label, origin, count); totals.append(row);
      }
      table('top-ips', data.ips, 'ip_address', statisticsT('IP address'));
      table('referrers', data.referrers.map(row => ({...row, referrer_host: row.referrer_host || statisticsT('Direct / Unknown')})), 'referrer_host', statisticsT('Source'));
      table('daily-views', data.daily, 'day', statisticsT('Date (UTC)'));
      table('top-pages', data.pages.map(row => ({...row, path: data.all_projects ? `${row.project_name}: ${row.path}` : row.path})), 'path', statisticsT('Path'));
      status.textContent = ''; results.hidden = false;
    } catch (error) { if (current === generation) status.textContent = statisticsT('Unable to load analytics. Refresh or sign in again.'); }
  }
  select.addEventListener('change', () => { selectedDay = null; load(); });
  range.addEventListener('change', () => { selectedDay = null; load(); });
  document.getElementById('exclude-bots').addEventListener('change', () => { selectedDay = null; load(); });
  setInterval(() => { if (!document.hidden && document.getElementById('auto-refresh').checked) load(); }, 60000);
  document.getElementById('refresh-statistics').addEventListener('click', load);
  for (const id of ['chart-views', 'chart-visitors']) document.getElementById(id).addEventListener('change', () => chart(chartRows));
  document.getElementById('clear-day').addEventListener('click', () => { selectedDay = null; load(); });
  load();
})();
