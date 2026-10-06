import frappe


def resolve(path):
    # Pin the public root even when a user's Frappe workspace sets another home.
    if path in ('', 'index', 'index.html'):
        frappe.local.path = 'statistics_diy/user/homepage'
        return frappe.local.path
    from frappe.website.path_resolver import resolve_path
    return resolve_path(path)
