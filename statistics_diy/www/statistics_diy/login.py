import frappe
from frappe.sessions import get_csrf_token
from statistics_diy.i18n import language_context

no_cache = 1


def get_context(context):
    language_context(context)
    context.title = context.t('Sign in')
    context.is_login = True
    context.csrf_token = get_csrf_token()
    if frappe.session.user != 'Guest':
        frappe.local.flags.redirect_location = '/statistics_diy/admin/dashboard'
        raise frappe.Redirect
