"""Offline country and city estimates. Visitor IPs never leave the server for lookup."""
import os
from ipaddress import ip_address
from pathlib import Path
import frappe
import maxminddb


def flag(code):
    if isinstance(code, str) and len(code) == 2 and code.isascii() and code.isalpha():
        return ''.join(chr(127397 + ord(letter)) for letter in code.upper())
    return ''


def decorate_ips(rows):
    path = frappe.conf.get('statistics_geoip_database') or os.environ.get('STATISTICS_GEOIP_DATABASE', ('/workspace/geoip/city.mmdb' if Path('/workspace/geoip/city.mmdb').is_file() else '/workspace/geoip/country.mmdb'))
    reader = None
    try:
        if Path(path).is_file():
            reader = maxminddb.open_database(path)
        cache = {}
        for row in rows:
            address = row.get('ip_address')
            if address not in cache:
                country = {}
                city = None
                region = None
                try:
                    if address and ip_address(address).is_global and reader:
                        record = reader.get(address) or {}
                        country = record.get('country') or {}
                        city = (record.get('city') or {}).get('names', {}).get('en')
                        subdivisions = record.get('subdivisions') or []
                        region = subdivisions[0].get('names', {}).get('en') if subdivisions else None
                except (ValueError, maxminddb.InvalidDatabaseError):
                    pass
                code = country.get('iso_code')
                cache[address] = {'country_code': code if flag(code) else None,
                    'country_name': country.get('names', {}).get('en') or 'Unknown', 'country_flag': flag(code), 'city': city, 'region': region}
            row.update(cache[address])
    except (OSError, maxminddb.InvalidDatabaseError):
        for row in rows:
            row.update(country_code=None, country_name='Unknown', country_flag='', city=None, region=None)
    finally:
        if reader:
            reader.close()
