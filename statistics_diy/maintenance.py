from datetime import datetime, timedelta, timezone
from hashlib import sha256
import frappe
from statistics_diy.reports import retention_days


def require_admin():
    if 'System Manager' not in frappe.get_roles():
        frappe.throw('Administrator access is required.', frappe.PermissionError)


def purge_expired():
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days())
    for doctype in ('Analytics Event', 'App Activity'):
        frappe.db.delete(doctype, {'occurred_at': ['<', cutoff]})
    # Labels without retained visitor events no longer need to be stored.
    frappe.db.sql('''DELETE v FROM `tabAnalytics Visitor` v LEFT JOIN `tabAnalytics Event` e
        ON e.project=v.project AND e.visitor_id=v.visitor_id WHERE e.name IS NULL''')


@frappe.whitelist(methods=['POST'])
def save_settings(retention_days):
    require_admin()
    if str(retention_days) not in ('30', '90', '180', '365'):
        frappe.throw('Invalid retention period.', frappe.ValidationError)
    settings = frappe.get_single('Analytics Settings')
    settings.retention_days = str(retention_days)
    settings.save()
    return {'saved': True}


@frappe.whitelist(methods=['POST'])
def label_visitor(project, visitor_id, label=''):
    require_admin()
    frappe.get_doc('Analytics Project', project).check_permission('write')
    if len(label) > 100 or not frappe.db.exists('Analytics Event', {'project': project, 'visitor_id': visitor_id}):
        frappe.throw('Invalid visitor or label.', frappe.ValidationError)
    name = sha256(f'{project}:{visitor_id}'.encode()).hexdigest()
    exists = frappe.db.exists('Analytics Visitor', name)
    if exists:
        doc = frappe.get_doc('Analytics Visitor', name)
    else:
        doc = frappe.get_doc({'doctype': 'Analytics Visitor', 'project': project, 'visitor_id': visitor_id})
    doc.label = label.strip()
    if not exists:
        doc.insert(set_name=name)
    else:
        doc.save()
    return {'saved': True}


@frappe.whitelist(methods=['POST'])
def clear_data(confirmation, project=None):
    require_admin()
    if confirmation != 'DELETE ANALYTICS':
        frappe.throw('Type DELETE ANALYTICS to confirm.', frappe.ValidationError)
    if project:
        frappe.get_doc('Analytics Project', project).check_permission('write')
    filters = {'project': project} if project else {}
    for doctype in ('Analytics Event', 'Analytics Visitor', 'App Activity'):
        frappe.db.delete(doctype, filters)
    return {'cleared': True}


def setup_schema():
    import secrets
    for item in frappe.get_all('Analytics Project', fields=['name', 'app_collection_key']):
        collection_key = frappe.db.get_value('Analytics Project', item.name, 'collection_key')
        snippet = f'<script defer src="https://statistics.diy/assets/statistics_diy/js/tracker.js" data-key="{collection_key}"></script>'
        frappe.db.set_value('Analytics Project', item.name, 'tracking_snippet', snippet)
        if not item.app_collection_key:
            frappe.db.set_value('Analytics Project', item.name, 'app_collection_key', secrets.token_urlsafe(32))
    frappe.db.add_index('Analytics Event', ['project', 'occurred_at'], 'analytics_project_time')
    frappe.db.add_index('Analytics Event', ['project', 'visitor_id', 'occurred_at'], 'analytics_project_visitor_time')
    frappe.db.add_index('App Activity', ['project', 'occurred_at'], 'analytics_app_project_time')
