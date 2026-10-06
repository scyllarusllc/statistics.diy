"""Browser IDs first; unmatched IPs are estimates scoped to a report/project."""


def visitor_source(where, params, context=None):
    expressions = {'day': 'DATE(occurred_at)', 'path': 'path', 'referrer_host': 'referrer_host',
        'device': "IFNULL(NULLIF(device,''),'Unknown')", 'browser': "IFNULL(NULLIF(browser,''),'Unknown')",
        'operating_system': "IFNULL(NULLIF(operating_system,''),'Unknown')", 'ip_address': 'ip_address'}
    expression = expressions.get(context)
    selection = f', {expression} AS bucket' if expression else ''
    grouping = ', bucket' if expression else ''
    if expression:
        import re
        event_expression = re.sub(r'\b(occurred_at|path|referrer_host|device|browser|operating_system|ip_address)\b', r'e.\1', expression)
        matching = f' AND known_ip.bucket <=> {event_expression}'
    else:
        matching = ''
    # A missing-ID event on an IP already seen with a browser ID must not add
    # another visitor. Choose a deterministic representative for this estimate.
    source = f'''(SELECT e.*,
        CASE WHEN NULLIF(e.visitor_id, '') IS NOT NULL THEN CONCAT('browser:', e.visitor_id)
             WHEN NULLIF(e.ip_address, '') IS NOT NULL THEN
                COALESCE(CONCAT('browser:', known_ip.visitor_id), CONCAT('ip:', e.ip_address))
             ELSE NULL END AS effective_visitor
        FROM `tabAnalytics Event` e
        LEFT JOIN (SELECT project, ip_address, MIN(visitor_id) AS visitor_id{selection}
            FROM `tabAnalytics Event` WHERE {where}
            AND NULLIF(visitor_id, '') IS NOT NULL AND NULLIF(ip_address, '') IS NOT NULL
            GROUP BY project, ip_address{grouping}) known_ip
        ON known_ip.project=e.project AND known_ip.ip_address=e.ip_address{matching}) report_events'''
    return source, tuple(params) + tuple(params)
