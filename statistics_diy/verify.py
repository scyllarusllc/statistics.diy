"""Run with bench --site SITE execute statistics_diy.verify.run."""
import frappe
from statistics_diy.api import collect, summary


def run():
    previous = frappe.session.user
    original_header = frappe.get_request_header
    frappe.set_user('Administrator')
    try:
        project = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Temporary verification',
            'website_origin': 'https://example.com'}).insert()
        other = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Other project',
            'website_origin': 'https://example.com'}).insert()
        frappe.get_request_header = lambda name: 'https://example.com'
        event = 'a379bbf9-65b1-4a17-a7ce-569e13674ef9'
        assert collect(project.collection_key, event, '/test', 'https://ref.example/path')['accepted']
        assert collect(project.collection_key, event, '/test', None)['duplicate']
        assert summary(project.name)['total'] == 1
        assert summary(other.name)['total'] == 0
        assert collect(other.collection_key, event, '/other', None)['accepted']
        assert summary(project.name)['total'] == 1
        frappe.get_request_header = lambda name: 'https://wrong.example'
        try:
            collect(project.collection_key, event, '/test', None)
        except frappe.PermissionError:
            pass
        else:
            raise AssertionError('Wrong origin accepted')
        # Exercise the browser's cross-origin POST shape through the public proxy.
        import requests
        frappe.db.commit()
        response = requests.post('https://statistics.diy/api/method/statistics_diy.api.collect',
            data={'key': project.collection_key, 'event_id': 'ecba0131-7a22-4dbd-b48f-d9b0d50175b6', 'path': '/http-test'},
            headers={'Origin': 'https://example.com'}, timeout=15)
        assert response.status_code == 200, response.text[:300]
        assert response.json()['message']['accepted']
        frappe.set_user('Guest')
        try:
            summary(project.name)
        except frappe.PermissionError:
            pass
        else:
            raise AssertionError('Guest could read statistics')
        print('Collection, deduplication, project isolation, origin checks and guest permissions passed.')
    finally:
        frappe.db.rollback()
        frappe.set_user('Administrator')
        for item in [locals().get('project'), locals().get('other')]:
            if item and frappe.db.exists('Analytics Project', item.name):
                frappe.db.delete('Analytics Event', {'project': item.name})
                frappe.delete_doc('Analytics Project', item.name, force=True)
        frappe.db.commit()
        frappe.get_request_header = original_header
        frappe.set_user(previous)


def dashboard():
    from statistics_diy.www.statistics_diy.admin.dashboard import get_context
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        frappe.session.data.csrf_token = 'verification-token'
        context = frappe._dict()
        get_context(context)
        from frappe.website.page_renderers.template_page import TemplatePage
        html = TemplatePage('statistics_diy/admin/dashboard').get_html()
        assert 'Statistics DIY' in html
        assert '/assets/frappe' not in html
        assert '/app/' not in html
        assert '/assets/statistics_diy/js/dashboard.js' in html
        print('Administrator dashboard controller and template passed.')
        frappe.set_user('Guest')
        try:
            get_context(frappe._dict())
        except frappe.Redirect:
            print('Guest login redirect passed.')
        else:
            raise AssertionError('Guest was allowed into dashboard')
    finally:
        frappe.set_user(previous)


def projects():
    from statistics_diy.www.statistics_diy.admin.projects import get_context
    from frappe.website.page_renderers.template_page import TemplatePage
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        frappe.session.data.csrf_token = 'verification-token'
        empty_html = TemplatePage('statistics_diy/admin/projects').get_html()
        assert '统计项目' in empty_html
        project = frappe.get_doc({'doctype': 'Analytics Project',
            'project_name': '<script>test</script>', 'website_origin': 'https://example.com'}).insert()
        frappe.db.set_value('Analytics Project', project.name, 'project_name', '<script>test</script>')
        html = TemplatePage('statistics_diy/admin/projects').get_html()
        assert '&lt;script&gt;test&lt;/script&gt;' in html
        assert '<script>test</script>' not in html
        assert '&lt;script defer' in html
        assert '?project=' + project.name in html
        assert '采集已启用' in html
        print('Projects page renders and escapes project names and tracking snippets.')
        frappe.set_user('Guest')
        try:
            get_context(frappe._dict())
        except frappe.Redirect:
            assert frappe.local.flags.redirect_location.endswith('/statistics_diy/admin/projects')
            print('Guest redirected to login.')
        else:
            raise AssertionError('Guest was allowed into projects')
        frappe.set_user('Guest')
        original_roles = frappe.get_roles
        try:
            frappe.session.user = 'unprivileged-test'
            frappe.get_roles = lambda: ['Website User']
            try:
                get_context(frappe._dict())
            except frappe.PermissionError:
                print('Non-administrator access rejected.')
            else:
                raise AssertionError('Non-administrator was allowed into projects')
        finally:
            frappe.get_roles = original_roles
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def project_editor():
    from statistics_diy.api import save_project
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        result = save_project('Editor verification', 'https://example.com', 1)
        name = result['name']
        key = frappe.db.get_value('Analytics Project', name, 'collection_key')
        assert key
        save_project('Updated project', 'https://updated.example', 0, name)
        doc = frappe.get_doc('Analytics Project', name)
        assert doc.project_name == 'Updated project'
        assert doc.website_origin == 'https://updated.example'
        assert doc.enabled == 0
        assert doc.collection_key == key
        try:
            save_project('Bad origin', 'https://example.com/private', 1)
        except frappe.ValidationError:
            pass
        else:
            raise AssertionError('Invalid website origin accepted')
        frappe.set_user('Guest')
        try:
            save_project('Unauthorized project', 'https://example.com', 1)
        except frappe.PermissionError:
            pass
        else:
            raise AssertionError('Guest could create a project')
        print('Project create, edit, validation, key preservation and authorization passed.')
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)
