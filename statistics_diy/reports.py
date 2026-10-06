from datetime import datetime, timedelta, timezone
import frappe


def retention_days():
    return int(frappe.db.get_single_value('Analytics Settings', 'retention_days') or 180)


def enrich_report(names, where, unfiltered_where, params, start, end):
    scope = 'project IN (' + ','.join(['%s'] * len(names)) + ')' if names else '1=0'
    from statistics_diy.identity import visitor_source
    source, identity_params = visitor_source(where, params)
    distinct = "COUNT(DISTINCT project, NULLIF(effective_visitor, ''))"
    categories = {}
    for field in ('device', 'browser', 'operating_system'):
        source, identity_params = visitor_source(where, params, field)
        categories[field] = frappe.db.sql(f'''SELECT IFNULL(NULLIF({field}, ''), 'Unknown') AS label,
            COUNT(*) AS views, {distinct} AS visitors FROM {source}
            WHERE {where} GROUP BY label ORDER BY visitors DESC, views DESC, label LIMIT 15''', identity_params, as_dict=True)
    source, identity_params = visitor_source(where, params)
    returning = frappe.db.sql(f'''SELECT COUNT(*) FROM (SELECT project, effective_visitor
        FROM {source} WHERE {where} AND effective_visitor IS NOT NULL
        GROUP BY project, effective_visitor HAVING COUNT(*) > 1) AS repeated''', identity_params)[0][0]
    recent = frappe.db.sql(f'''SELECT project, occurred_at, path, referrer_host, device, browser,
        operating_system, visitor_timezone, ip_address, LEFT(visitor_id, 10) AS visitor
        FROM {source} WHERE {where} ORDER BY occurred_at DESC, name DESC LIMIT 20''', identity_params, as_dict=True)
    ips = frappe.db.sql(f'''SELECT ip_address, COUNT(*) AS views, {distinct} AS visitors
        FROM {source} WHERE {where} AND ip_address IS NOT NULL AND ip_address!=''
        GROUP BY ip_address ORDER BY views DESC, ip_address LIMIT 15''', identity_params, as_dict=True)
    from statistics_diy.geolocation import decorate_ips
    decorate_ips(ips + recent)
    known = frappe.db.sql(f'''SELECT project, visitor_id, MIN(occurred_at) AS first_seen,
        MAX(occurred_at) AS last_seen, COUNT(*) AS visits,
        COUNT(DISTINCT NULLIF(session_id, '')) AS sessions FROM `tabAnalytics Event`
        WHERE {where} AND visitor_id IS NOT NULL AND visitor_id!=''
        GROUP BY project, visitor_id ORDER BY last_seen DESC, project, visitor_id LIMIT 30''', params, as_dict=True)
    labels = frappe.get_all('Analytics Visitor', filters={'project': ['in', names]}, fields=['project', 'visitor_id', 'label']) if names else []
    label_map = {(row.project, row.visitor_id): row.label for row in labels}
    for row in known:
        row.label = label_map.get((row.project, row.visitor_id), '')
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    today_where = f"{scope} AND occurred_at >= %s AND occurred_at < %s" + (' AND IFNULL(is_bot,0)=0' if 'IFNULL(is_bot' in where else '')
    today_source, today_params = visitor_source(today_where, (*names, today, today + timedelta(days=1)))
    today_stats = frappe.db.sql(f'''SELECT COUNT(*) AS views, {distinct} AS visitors
        FROM {today_source} WHERE {today_where}''', today_params, as_dict=True)[0]
    bots = frappe.db.sql(f'SELECT COUNT(*) FROM `tabAnalytics Event` WHERE {unfiltered_where} AND is_bot=1', params)[0][0]
    stored = frappe.db.sql(f'SELECT COUNT(*) FROM `tabAnalytics Event` WHERE {scope}', tuple(names))[0][0]
    app = frappe.db.sql(f'''SELECT COUNT(DISTINCT project, install_id) AS installs,
        COUNT(DISTINCT CASE WHEN occurred_at >= %s THEN project END, CASE WHEN occurred_at >= %s THEN install_id END) AS dau,
        COUNT(DISTINCT CASE WHEN occurred_at >= %s THEN project END, CASE WHEN occurred_at >= %s THEN install_id END) AS mau,
        COUNT(*) AS pings FROM `tabApp Activity` WHERE {scope} AND occurred_at < %s''',
        (today, today, today - timedelta(days=29), today - timedelta(days=29), *names, today + timedelta(days=1)), as_dict=True)[0]
    platforms = frappe.db.sql(f'''SELECT IFNULL(NULLIF(platform,''),'Unknown') AS label,
        COUNT(DISTINCT project, install_id) AS installs FROM `tabApp Activity` WHERE {scope}
        GROUP BY label ORDER BY installs DESC''', tuple(names), as_dict=True)
    return {'ips': ips, 'breakdowns': categories, 'returning': returning, 'today': today_stats, 'recent': recent,
        'known': known, 'bot_hits': bots, 'stored_events': stored, 'apps': app,
        'app_platforms': platforms, 'retention_days': retention_days()}
