window.statisticsT = text => {
  const catalog = JSON.parse(document.getElementById('statistics-translations').textContent);
  return catalog[text] || text;
};
window.statisticsRequest = async (method, data) => {
  const response = await fetch('/api/method/' + method, {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content},
    body: JSON.stringify(data || {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = statisticsT('Request failed. Check your input or sign in again.');
    if (typeof result.error === 'string') message = statisticsT(result.error);
    throw new Error(message);
  }
  return result.message;
};
document.getElementById('logout')?.addEventListener('click', async () => {
  try { await statisticsRequest('logout'); location.assign('/statistics_diy/login'); }
  catch (_) { alert(statisticsT('Sign out failed. Please try again.')); }
});

const navigationToggle = document.getElementById('nav-toggle');
const navigation = document.getElementById('admin-navigation');
navigationToggle?.addEventListener('click', () => {
  const expanded = navigationToggle.getAttribute('aria-expanded') === 'true';
  navigationToggle.setAttribute('aria-expanded', String(!expanded));
  navigation.classList.toggle('hidden', expanded);
  navigation.classList.toggle('flex', !expanded);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigationToggle?.getAttribute('aria-expanded') === 'true') {
    navigationToggle.click(); navigationToggle.focus();
  }
});
