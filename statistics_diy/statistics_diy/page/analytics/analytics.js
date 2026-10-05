frappe.pages['analytics'].on_page_load = function(wrapper) {
  const page = frappe.ui.make_app_page({parent: wrapper, title: 'Statistics DIY', single_column: true});
  page.set_primary_action(__('Create Project'), () => frappe.new_doc('Analytics Project'));
  const field = page.add_field({fieldname: 'project', label: __('Project'), fieldtype: 'Link', options: 'Analytics Project', change: load});
  const body = $('<div class="p-4"></div>').appendTo(page.main);
  body.text(__('Choose a project to see page views. Copy its tracking snippet to your website to begin collecting.'));
  let generation = 0;
  async function load() {
    const project = field.get_value();
    const current = ++generation;
    if (!project) { body.empty(); return; }
    body.text(__('Loading…'));
    try {
      const {message: data} = await frappe.call({method: 'statistics_diy.api.summary', args: {project}});
      if (current !== generation) return;
      body.empty();
      $('<h3>').text(`${data.total} page views`).appendTo(body);
      $('<p>').text('Last 30 days · UTC · Page views only; unique visitors are not measured.').appendTo(body);
      for (const [title, rows, key] of [['Daily views', data.daily, 'day'], ['Top pages', data.pages, 'path']]) {
        $('<h4>').text(title).appendTo(body);
        if (!rows.length) { $('<p>').text('No events collected yet.').appendTo(body); continue; }
        const table = $('<table class="table"><thead><tr><th>Period / path</th><th>Views</th></tr></thead><tbody></tbody></table>').appendTo(body);
        for (const row of rows) {
          const tr = $('<tr>').appendTo(table.find('tbody'));
          $('<td>').text(row[key]).appendTo(tr); $('<td>').text(row.views).appendTo(tr);
        }
      }
    } catch (error) { if (current === generation) body.text(__('Unable to load statistics.')); }
  }
};
