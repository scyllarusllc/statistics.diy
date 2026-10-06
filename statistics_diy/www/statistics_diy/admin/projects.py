import frappe
from statistics_diy.admin import admin_context

no_cache = 1


def get_context(context):
    admin_context(context, 'Projects', '/statistics_diy/admin/projects')
    context.projects = frappe.get_list('Analytics Project',
        fields=['name', 'project_name', 'website_origin', 'enabled', 'tracking_snippet', 'app_collection_key', 'collection_key'],
        order_by='project_name asc', limit_page_length=0)

    for project in context.projects:
        project.tracking_snippet = f'<script defer src="https://statistics.diy/assets/statistics_diy/js/tracker.js" data-key="{project.collection_key}"></script>'
