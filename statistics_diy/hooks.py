app_name = "statistics_diy"
app_title = "Statistics DIY"
app_publisher = "Statistics DIY contributors"
app_description = "Self-hosted website and app analytics"
app_email = ""
app_license = "MIT"

scheduler_events = {'daily': ['statistics_diy.maintenance.purge_expired']}
after_migrate = ['statistics_diy.maintenance.setup_schema']

home_page = 'statistics_diy/user/homepage'
website_path_resolver = ['statistics_diy.routing.resolve']
