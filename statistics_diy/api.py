"""First-release page-view collection. Anonymous browser estimates; project-scoped IP records; no device fingerprinting."""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from uuid import UUID
from hashlib import sha256
from statistics_diy.classification import classify
from statistics_diy.network import client_ip
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
def collect(key=None, event_id=None, path=None, referrer=None, visitor_id=None, session_id=None, visitor_timezone=None):
    project = frappe.db.get_value('Analytics Project', {'collection_key': key, 'enabled': 1}, ['name', 'website_origin'], as_dict=True) if key else None
    if not project or frappe.get_request_header('Origin') != project.website_origin:
        frappe.throw('Invalid project or origin.', frappe.PermissionError)
    try:
        event_id, path, host = validate_event(event_id, path, referrer)
        visitor = sha256(f'{project.name}:{UUID(visitor_id)}'.encode()).hexdigest() if visitor_id else None
    except (ValueError, TypeError, AttributeError):
        frappe.throw('Invalid event payload.', frappe.ValidationError)
    try:
        session = sha256(f'{project.name}:{UUID(session_id)}'.encode()).hexdigest() if session_id else None
    except (ValueError, TypeError, AttributeError):
        frappe.throw('Invalid session ID.', frappe.ValidationError)
    if visitor_timezone and len(visitor_timezone) > 100:
        frappe.throw('Invalid timezone.', frappe.ValidationError)
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
        'path': path, 'referrer_host': host, 'visitor_id': visitor, 'session_id': session,
        'visitor_timezone': visitor_timezone, 'ip_address': client_ip(), **classify(frappe.get_request_header('User-Agent'))})
    try:
        doc.insert(ignore_permissions=True)
    except frappe.UniqueValidationError:
        return {'accepted': True, 'duplicate': True}
    return {'accepted': True}


def report_window(days, now=None):
    if str(days) not in ('7', '30', '90', '365'):
        raise ValueError('Report range must be 7, 30, 90 or 365 days.')
    days = int(days)
    now = now or datetime.now(timezone.utc)
    end = now.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None) + timedelta(days=1)
    return days, end - timedelta(days=days), end


@frappe.whitelist(methods=['GET'])
def summary(project=None, days=30, exclude_bots=1, day=None):
    if project:
        doc = frappe.get_doc('Analytics Project', project)
        doc.check_permission('read')
        projects = [frappe._dict(name=doc.name, project_name=doc.project_name,
            website_origin=doc.website_origin, enabled=doc.enabled)]
    else:
        if 'System Manager' not in frappe.get_roles():
            frappe.throw('Administrator access is required.', frappe.PermissionError)
        projects = frappe.get_list('Analytics Project',
            fields=['name', 'project_name', 'website_origin', 'enabled'],
            order_by='project_name asc', limit_page_length=0)
    try:
        days, start, end = report_window(days)
    except ValueError as error:
        frappe.throw(str(error), frappe.ValidationError)
    if day:
        try:
            selected = datetime.strptime(day, '%Y-%m-%d')
            if selected.strftime('%Y-%m-%d') != day or not start <= selected < end:
                raise ValueError()
        except (ValueError, TypeError):
            frappe.throw('Selected day must be within the report range.', frappe.ValidationError)
        start, end, days = selected, selected + timedelta(days=1), 1
    names = [item.name for item in projects]
    scope = 'project IN (' + ','.join(['%s'] * len(names)) + ')' if names else '1=0'
    where = scope + ' AND occurred_at >= %s AND occurred_at < %s'
    from statistics_diy.reports import retention_days
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days())
    where += ' AND occurred_at >= %s'
    params = (*names, start, end, cutoff)
    unfiltered_where = where
    if frappe.utils.cint(exclude_bots):
        where += ' AND IFNULL(is_bot, 0)=0'
    from statistics_diy.identity import visitor_source
    source, identity_params = visitor_source(where, params, 'day')
    rows = frappe.db.sql(f'''SELECT DATE(occurred_at) AS day, COUNT(*) AS views, COUNT(DISTINCT project, NULLIF(effective_visitor, '')) AS visitors
        FROM {source} WHERE {where}
        GROUP BY DATE(occurred_at) ORDER BY day''', identity_params, as_dict=True)
    counts = {str(row.day): row.views for row in rows}
    visitor_counts = {str(row.day): row.visitors for row in rows}
    daily = [{'day': (start + timedelta(days=i)).date().isoformat(),
        'views': counts.get((start + timedelta(days=i)).date().isoformat(), 0),
        'visitors': visitor_counts.get((start + timedelta(days=i)).date().isoformat(), 0)} for i in range(days)]
    for row in daily:
        row['available'] = datetime.fromisoformat(row['day']) + timedelta(days=1) > cutoff
        if not row['available']:
            row['views'] = None
            row['visitors'] = None
    source, identity_params = visitor_source(where, params, 'path')
    pages = frappe.db.sql(f'''SELECT project, path, COUNT(*) AS views, COUNT(DISTINCT project, NULLIF(effective_visitor, '')) AS visitors FROM {source}
        WHERE {where}
        GROUP BY project, path ORDER BY views DESC, project, path LIMIT 10''', identity_params, as_dict=True)
    source, identity_params = visitor_source(where, params, 'referrer_host')
    referrers = frappe.db.sql(f'''SELECT referrer_host, COUNT(*) AS views, COUNT(DISTINCT project, NULLIF(effective_visitor, '')) AS visitors FROM {source}
        WHERE {where}
        GROUP BY referrer_host ORDER BY views DESC, referrer_host LIMIT 10''', identity_params, as_dict=True)
    source, identity_params = visitor_source(where, params)
    totals = frappe.db.sql(f'''SELECT project, COUNT(*) AS views, COUNT(DISTINCT NULLIF(effective_visitor, '')) AS visitors,
        SUM(CASE WHEN effective_visitor IS NULL THEN 1 ELSE 0 END) AS unmeasured,
        COUNT(DISTINCT CASE WHEN LEFT(effective_visitor,3)='ip:' THEN effective_visitor END) AS ip_visitors,
        SUM(CASE WHEN NULLIF(visitor_id,'') IS NULL AND NULLIF(ip_address,'') IS NOT NULL THEN 1 ELSE 0 END) AS ip_views FROM {source}
        WHERE {where} GROUP BY project''', identity_params, as_dict=True)
    by_project = {row.project: row.views for row in totals}
    unique_by_project = {row.project: row.visitors for row in totals}
    missing_by_project = {row.project: int(row.unmeasured) for row in totals}
    labels = {item.name: item.project_name for item in projects}
    for page in pages:
        page.project_name = labels[page.project]
    project_rows = [dict(item, views=by_project.get(item.name, 0), visitors=unique_by_project.get(item.name, 0), unmeasured_views=missing_by_project.get(item.name, 0)) for item in projects]
    from statistics_diy.reports import enrich_report
    extra = enrich_report(names, where, unfiltered_where, params, start, end)
    ip_visitors = sum(int(row.ip_visitors) for row in totals)
    ip_views = sum(int(row.ip_views) for row in totals)
    identified_views = sum(int(row.views) - int(row.unmeasured) for row in totals)
    return {**extra, 'ip_visitors': ip_visitors, 'ip_fallback_views': ip_views, 'identified_views': identified_views, 'visitor_count_complete': not any(row.unmeasured for row in totals), 'selected_day': day, 'visitors': sum(row.visitors for row in totals), 'unmeasured_views': sum(row.unmeasured for row in totals), 'projects': project_rows, 'all_projects': not bool(project), 'timezone': 'UTC' , 'window': f'Last {days} days', 'days': days,
        'retention_start': cutoff.date().isoformat(), 'start': start.date().isoformat(), 'end': (end - timedelta(days=1)).date().isoformat(),
        'total': sum(row['views'] or 0 for row in daily), 'daily': daily, 'pages': pages, 'referrers': referrers}


@frappe.whitelist(methods=['POST'])
def save_project(project_name, website_origin, enabled=1, name=None):
    if 'System Manager' not in frappe.get_roles():
        frappe.throw('Administrator access is required.', frappe.PermissionError)
    if name:
        doc = frappe.get_doc('Analytics Project', name)
        doc.check_permission('write')
    else:
        doc = frappe.new_doc('Analytics Project')
        doc.check_permission('create')
    doc.project_name = (project_name or '').strip()
    doc.website_origin = (website_origin or '').strip()
    doc.enabled = frappe.utils.cint(enabled)
    doc.save()
    return {'name': doc.name}
