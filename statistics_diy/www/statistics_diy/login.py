import frappe
from frappe.sessions import get_csrf_token

no_cache = 1


def get_context(context):
    context.title = '登录'
    context.is_login = True
    context.csrf_token = get_csrf_token()
    if frappe.session.user != 'Guest':
        frappe.local.flags.redirect_location = '/statistics_diy/admin/dashboard'
        raise frappe.Redirect
