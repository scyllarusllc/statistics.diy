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
