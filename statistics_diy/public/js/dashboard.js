(() => {
  const select = document.getElementById('analytics-project');
  if (!select) return;
  const requestedProject = new URLSearchParams(location.search).get('project');
  if ([...select.options].some(option => option.value === requestedProject)) select.value = requestedProject;
  const status = document.getElementById('statistics-status');
  const results = document.getElementById('statistics-results');
  let generation = 0;
  function table(id, rows, key, heading) {
    const container = document.getElementById(id);
    container.replaceChildren();
    if (!rows.length) { container.textContent = '尚未收到访问事件。'; return; }
    const table = document.createElement('table'); table.className = 'w-full text-left text-sm';
    const head = table.createTHead().insertRow();
    for (const title of [heading, '浏览量']) { const th = document.createElement('th'); th.className = 'border-b border-slate-200 pb-3 text-xs font-medium text-slate-500'; th.textContent = title; head.append(th); }
    const body = table.createTBody();
    for (const row of rows) { const tr = body.insertRow(); const label = tr.insertCell(); label.className = 'break-all border-b border-slate-100 py-3 pr-4'; label.textContent = row[key]; const count = tr.insertCell(); count.className = 'border-b border-slate-100 py-3 font-semibold'; count.textContent = row.views; }
    container.append(table);
  }
  async function load() {
    const current = ++generation;
    results.hidden = true; status.textContent = '正在加载…';
    document.getElementById('manage-project').href = '/statistics_diy/admin/projects';
    try {
      const response = await fetch('/api/method/statistics_diy.api.summary?project=' + encodeURIComponent(select.value), {credentials: 'same-origin'});
      if (!response.ok) throw new Error('Request failed');
      const {message: data} = await response.json();
      if (current !== generation) return;
      document.getElementById('total-views').textContent = data.total;
      table('daily-views', data.daily, 'day', '日期（UTC）');
      table('top-pages', data.pages, 'path', '路径');
      status.textContent = ''; results.hidden = false;
    } catch (error) { if (current === generation) status.textContent = '加载失败，请刷新重试；如果登录已过期，请重新登录。'; }
  }
  select.addEventListener('change', load);
  document.getElementById('refresh-statistics').addEventListener('click', load);
  load();
})();
