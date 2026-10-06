window.statisticsRequest = async (method, data) => {
  const response = await fetch('/api/method/' + method, {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content},
    body: JSON.stringify(data || {})
  });
  const result = await response.json();
  if (!response.ok) {
    let message = '请求失败，请检查输入或重新登录。';
    try { const messages = JSON.parse(result._server_messages); message = JSON.parse(messages[0]).message.replace(/<[^>]*>/g, ''); } catch (_) {}
    throw new Error(message);
  }
  return result.message;
};
document.getElementById('logout')?.addEventListener('click', async () => {
  try { await statisticsRequest('logout'); location.assign('/statistics_diy/login'); }
  catch (_) { alert('退出失败，请重试。'); }
});
