import frappe
from frappe.sessions import get_csrf_token


def admin_context(context, title, route):
    if frappe.session.user == 'Guest':
        frappe.local.flags.redirect_location = '/statistics_diy/login?next=' + route
        raise frappe.Redirect
    if 'System Manager' not in frappe.get_roles():
        frappe.throw('Administrator access is required.', frappe.PermissionError)
    context.title = title
    context.csrf_token = get_csrf_token()
    context.is_login = False
