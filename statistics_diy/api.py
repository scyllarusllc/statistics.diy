"""First-release page-view collection. No cookies, IP storage, or visitor IDs."""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from uuid import UUID
import frappe


def validate_event(event_id, path, referrer):
    event_id = str(UUID(event_id))
    if not isinstance(path, str) or not path.startswith('/') or path.startswith('//') or len(path) > 140 or '?' in path or '#' in path:
        raise ValueError('Path must be a pathname of at most 140 characters.')
    host = urlsplit(referrer or '').hostname or ''
    if len(host) > 140:
        raise ValueError('Referrer hostname is too long.')
    return event_id, path, host


@frappe.whitelist(allow_guest=True, methods=['POST'])
def collect(key=None, event_id=None, path=None, referrer=None):
    project = frappe.db.get_value('Analytics Project', {'collection_key': key, 'enabled': 1}, ['name', 'website_origin'], as_dict=True) if key else None
    if not project or frappe.get_request_header('Origin') != project.website_origin:
        frappe.throw('Invalid project or origin.', frappe.PermissionError)
    try:
        event_id, path, host = validate_event(event_id, path, referrer)
    except (ValueError, TypeError, AttributeError):
        frappe.throw('Invalid event payload.', frappe.ValidationError)
    # The public key identifies a project; it is not a secret authentication token.
    cache = frappe.cache()
    bucket = int(datetime.now(timezone.utc).timestamp()) // 60
    rate_key = f'statistics-diy:collect:{project.name}:{bucket}'
    count = cache.incr(rate_key)
    if count == 1:
        cache.expire(rate_key, 120)
    if count > 1000:
        frappe.local.response.http_status_code = 429
        return {'accepted': False}
    identifier = f'{project.name}:{event_id}'
    if frappe.db.exists('Analytics Event', {'event_id': identifier}):
        return {'accepted': True, 'duplicate': True}
    doc = frappe.get_doc({'doctype': 'Analytics Event', 'project': project.name,
        'event_id': identifier, 'occurred_at': datetime.now(timezone.utc).replace(tzinfo=None),
        'path': path, 'referrer_host': host})
    try:
        doc.insert(ignore_permissions=True)
    except frappe.UniqueValidationError:
        return {'accepted': True, 'duplicate': True}
    return {'accepted': True}


@frappe.whitelist(methods=['GET'])
def summary(project):
    frappe.get_doc('Analytics Project', project).check_permission('read')
    start = (datetime.now(timezone.utc) - timedelta(days=30)).replace(tzinfo=None)
    rows = frappe.db.sql('''SELECT DATE(occurred_at) AS day, COUNT(*) AS views
        FROM `tabAnalytics Event` WHERE project=%s AND occurred_at >= %s
        GROUP BY DATE(occurred_at) ORDER BY day''', (project, start), as_dict=True)
    pages = frappe.db.sql('''SELECT path, COUNT(*) AS views FROM `tabAnalytics Event`
        WHERE project=%s AND occurred_at >= %s GROUP BY path ORDER BY views DESC LIMIT 10''',
        (project, start), as_dict=True)
    return {'timezone': 'UTC', 'window': 'Last 30 days', 'total': sum(r.views for r in rows), 'daily': rows, 'pages': pages}
