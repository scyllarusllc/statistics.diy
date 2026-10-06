import frappe
from frappe.sessions import get_csrf_token
from statistics_diy.i18n import language_context

no_cache = 1


def get_context(context):
    language_context(context)
    context.title = context.t('Home')
    context.csrf_token = get_csrf_token()
    context.is_homepage = True
    context.is_login = False
    context.signed_in = frappe.session.user != 'Guest'
    context.is_admin = context.signed_in and 'System Manager' in frappe.get_roles()
    context.display_name = frappe.db.get_value('User', frappe.session.user, 'full_name') if context.signed_in else None
