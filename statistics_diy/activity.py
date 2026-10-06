"""App activity uses timestamped, project-scoped anonymous install events."""
from datetime import datetime, timezone
from hashlib import sha256
from uuid import UUID
import frappe


@frappe.whitelist(allow_guest=True, methods=['POST'])
def ping(token=None, install_id=None, event_id=None, platform=None, app_version=None):
    project = frappe.db.get_value('Analytics Project', {'app_collection_key': token, 'enabled': 1}, 'name') if token else None
    if not project:
        frappe.throw('Invalid app collection token.', frappe.PermissionError)
    try:
        install = sha256(f'{project}:{UUID(install_id)}'.encode()).hexdigest()
        event = f'{project}:{UUID(event_id)}'
    except (ValueError, TypeError, AttributeError):
        frappe.throw('Invalid install or event ID.', frappe.ValidationError)
    if platform not in ('Windows', 'Linux', 'macOS', 'iOS', 'Android', 'Other') or len(app_version or '') > 50:
        frappe.throw('Invalid app metadata.', frappe.ValidationError)
    bucket = int(datetime.now(timezone.utc).timestamp()) // 60
    cache = frappe.cache()
    key = f'statistics-diy:app:{project}:{bucket}'
    count = cache.incr(key)
    if count == 1:
        cache.expire(key, 120)
    if count > 1000:
        frappe.local.response.http_status_code = 429
        return {'accepted': False}
    if frappe.db.exists('App Activity', {'event_id': event}):
        return {'accepted': True, 'duplicate': True}
    try:
        frappe.get_doc({'doctype': 'App Activity', 'project': project, 'event_id': event,
            'install_id': install, 'occurred_at': datetime.now(timezone.utc).replace(tzinfo=None),
            'platform': platform, 'app_version': app_version}).insert(ignore_permissions=True)
    except frappe.UniqueValidationError:
        return {'accepted': True, 'duplicate': True}
    return {'accepted': True}
