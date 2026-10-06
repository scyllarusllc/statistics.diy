from statistics_diy.reports import retention_days
from statistics_diy.admin import admin_context

no_cache = 1


def get_context(context):
    admin_context(context, 'Settings', '/statistics_diy/admin/settings')

    context.retention_days = retention_days()
