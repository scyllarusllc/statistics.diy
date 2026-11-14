document.getElementById('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const language = document.getElementById('site-language').value;
  if (!['en', 'zh-CN'].includes(language)) return;
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    await statisticsRequest('statistics_diy.maintenance.save_settings', {retention_days: document.getElementById('retention-days').value});
    document.cookie = 'statistics_language=' + encodeURIComponent(language) + '; Path=/; Max-Age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    location.reload();
  } catch (error) { document.getElementById('settings-status').textContent = error.message; }
  finally { button.disabled = false; }
});
const clearButton = document.getElementById('clear-analytics');
const confirmation = document.getElementById('clear-confirmation');
confirmation.addEventListener('input', () => { clearButton.disabled = confirmation.value !== 'DELETE ANALYTICS'; });
clearButton.addEventListener('click', async () => {
  clearButton.disabled = true;
  try { await statisticsRequest('statistics_diy.maintenance.clear_data', {confirmation: confirmation.value}); confirmation.value = ''; document.getElementById('clear-status').textContent = statisticsT('Analytics data cleared.'); }
  catch (error) { document.getElementById('clear-status').textContent = error.message; clearButton.disabled = confirmation.value !== 'DELETE ANALYTICS'; }
});
