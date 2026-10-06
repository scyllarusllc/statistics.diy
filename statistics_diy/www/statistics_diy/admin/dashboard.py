import frappe
from statistics_diy.admin import admin_context

no_cache = 1


def get_context(context):
    admin_context(context, 'Dashboard', '/statistics_diy/admin/dashboard')
    context.projects = frappe.get_list('Analytics Project',
        fields=['name', 'project_name', 'website_origin', 'enabled'], order_by='project_name asc', limit_page_length=0)
