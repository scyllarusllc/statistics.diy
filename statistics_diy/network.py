"""Only accept a proxy-supplied visitor IP when the proxy authenticates it."""
from ipaddress import ip_address
from secrets import compare_digest
import frappe


def normalize_ip(value):
    try:
        address = ip_address(value or '')
        if getattr(address, 'ipv4_mapped', None):
            address = address.ipv4_mapped
        return str(address)
    except ValueError:
        return None


def client_ip():
    request = getattr(frappe.local, 'request', None)
    if not request:
        return None
    secret = frappe.conf.get('statistics_proxy_token')
    supplied = request.headers.get('X-Statistics-Proxy-Token', '')
    if secret and compare_digest(str(secret).encode(), supplied.encode()):
        return normalize_ip(request.headers.get('X-Statistics-Client-IP'))
    # Ignore arbitrary forwarded/Cloudflare headers on direct requests.
    original = request.environ.get('werkzeug.proxy_fix.orig', {})
    address = normalize_ip(original.get('REMOTE_ADDR') or request.environ.get('REMOTE_ADDR'))
    return address if address and ip_address(address).is_global else None
