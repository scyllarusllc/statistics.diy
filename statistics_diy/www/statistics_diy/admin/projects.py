import frappe
from statistics_diy.admin import admin_context

no_cache = 1


def get_context(context):
    admin_context(context, '项目管理', '/statistics_diy/admin/projects')
    context.projects = frappe.get_list('Analytics Project',
        fields=['name', 'project_name', 'website_origin', 'enabled', 'tracking_snippet'],
        order_by='project_name asc')
