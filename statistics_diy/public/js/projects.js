(() => {
  const dialog = document.getElementById('project-dialog');
  const form = document.getElementById('project-form');
  const status = document.getElementById('form-status');
  function open(button) {
    form.reset(); status.textContent = '';
    form.elements.name.value = button?.dataset.id || '';
    form.elements.project_name.value = button?.dataset.title || '';
    form.elements.website_origin.value = button?.dataset.origin || '';
    form.elements.enabled.checked = button ? button.dataset.enabled === '1' : true;
    document.getElementById('editor-title').textContent = button ? statisticsT('Edit project') : statisticsT('Create project');
    dialog.showModal();
  }
  document.getElementById('create-project').addEventListener('click', () => open());
  document.querySelectorAll('.edit-project').forEach(button => button.addEventListener('click', () => open(button)));
  document.getElementById('cancel-project').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault(); const save = document.getElementById('save-project'); save.disabled = true; status.textContent = '';
    try {
      await statisticsRequest('statistics_diy.api.save_project', {name: form.elements.name.value,
        project_name: form.elements.project_name.value, website_origin: form.elements.website_origin.value,
        enabled: Number(form.elements.enabled.checked)});
      location.reload();
    } catch (error) { status.textContent = error.message; } finally { save.disabled = false; }
  });
  document.querySelectorAll('.copy-snippet').forEach(button => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.closest('details').querySelector('code').textContent); button.textContent = statisticsT('Copied'); }
    catch (_) { document.getElementById('project-status').textContent = statisticsT('Unable to copy. Select the code and copy it manually.'); }
  }));
})();
