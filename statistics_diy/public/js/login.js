document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button');
  button.disabled = true; document.getElementById('login-status').textContent = '';
  try {
    await statisticsRequest('login', {usr: form.elements.usr.value, pwd: form.elements.pwd.value});
    const next = new URLSearchParams(location.search).get('next');
    const allowed = ['/statistics_diy/admin/dashboard', '/statistics_diy/admin/projects', '/statistics_diy/admin/settings'];
    location.assign(allowed.includes(next) ? next : allowed[0]);
  } catch (error) { document.getElementById('login-status').textContent = error.message; }
  finally { button.disabled = false; }
});
