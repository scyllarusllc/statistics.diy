import secrets
from urllib.parse import urlsplit
import frappe
from frappe.model.document import Document


class AnalyticsProject(Document):
    def validate(self):
        origin = urlsplit(self.website_origin or '')
        if origin.scheme not in ('http', 'https') or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ('', '/'):
            frappe.throw('Website Origin must be an HTTP(S) origin without a path.')
        self.website_origin = f'{origin.scheme}://{origin.netloc}'.rstrip('/')
        if not self.collection_key:
            self.collection_key = secrets.token_urlsafe(32)
        self.tracking_snippet = f'<script defer src="https://statistics.diy/assets/statistics_diy/js/tracker.js" data-key="{self.collection_key}"></script>'
