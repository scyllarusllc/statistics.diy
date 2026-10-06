"""Run with bench --site SITE execute statistics_diy.verify.run."""
import frappe
from statistics_diy.api import collect, summary


def run():
    previous = frappe.session.user
    original_header = frappe.get_request_header
    frappe.set_user('Administrator')
    try:
        project = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Temporary verification',
            'website_origin': 'https://example.com'}).insert()
        other = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Other project',
            'website_origin': 'https://example.com'}).insert()
        frappe.get_request_header = lambda name: 'https://example.com'
        event = 'a379bbf9-65b1-4a17-a7ce-569e13674ef9'
        assert collect(project.collection_key, event, '/test', 'https://ref.example/path')['accepted']
        assert collect(project.collection_key, event, '/test', None)['duplicate']
        assert summary(project.name)['total'] == 1
        assert summary(other.name)['total'] == 0
        assert collect(other.collection_key, event, '/other', None)['accepted']
        assert summary(project.name)['total'] == 1
        frappe.get_request_header = lambda name: 'https://wrong.example'
        try:
            collect(project.collection_key, event, '/test', None)
        except frappe.PermissionError:
            pass
        else:
            raise AssertionError('Wrong origin accepted')
        # Exercise the browser's cross-origin POST shape through the public proxy.
        import requests
        frappe.db.commit()
        response = requests.post('https://statistics.diy/api/method/statistics_diy.api.collect',
            data={'key': project.collection_key, 'event_id': 'ecba0131-7a22-4dbd-b48f-d9b0d50175b6', 'path': '/http-test'},
            headers={'Origin': 'https://example.com'}, timeout=15)
        assert response.status_code == 200, response.text[:300]
        assert response.json()['message']['accepted']
        frappe.set_user('Guest')
        try:
            summary(project.name)
        except frappe.PermissionError:
            pass
        else:
            raise AssertionError('Guest could read statistics')
        print('Collection, deduplication, project isolation, origin checks and guest permissions passed.')
    finally:
        frappe.db.rollback()
        frappe.set_user('Administrator')
        for item in [locals().get('project'), locals().get('other')]:
            if item and frappe.db.exists('Analytics Project', item.name):
                frappe.db.delete('Analytics Event', {'project': item.name})
                frappe.delete_doc('Analytics Project', item.name, force=True)
        frappe.db.commit()
        frappe.get_request_header = original_header
        frappe.set_user(previous)


def dashboard():
    from statistics_diy.www.statistics_diy.admin.dashboard import get_context
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        frappe.session.data.csrf_token = 'verification-token'
        context = frappe._dict()
        get_context(context)
        from frappe.website.page_renderers.template_page import TemplatePage
        html = TemplatePage('statistics_diy/admin/dashboard').get_html()
        assert 'Statistics DIY' in html
        assert '/assets/frappe' not in html
        assert '/app/' not in html
        assert '/assets/statistics_diy/js/dashboard.js' in html
        print('Administrator dashboard controller and template passed.')
        frappe.set_user('Guest')
        try:
            get_context(frappe._dict())
        except frappe.Redirect:
            print('Guest login redirect passed.')
        else:
            raise AssertionError('Guest was allowed into dashboard')
    finally:
        frappe.set_user(previous)


def projects():
    from statistics_diy.www.statistics_diy.admin.projects import get_context
    from frappe.website.page_renderers.template_page import TemplatePage
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        frappe.session.data.csrf_token = 'verification-token'
        empty_html = TemplatePage('statistics_diy/admin/projects').get_html()
        assert 'Projects' in empty_html
        project = frappe.get_doc({'doctype': 'Analytics Project',
            'project_name': '<script>test</script>', 'website_origin': 'https://example.com'}).insert()
        frappe.db.set_value('Analytics Project', project.name, 'project_name', '<script>test</script>')
        html = TemplatePage('statistics_diy/admin/projects').get_html()
        assert '&lt;script&gt;test&lt;/script&gt;' in html
        assert '<script>test</script>' not in html
        assert '&lt;script defer' in html
        assert '/js/tracker.js?v=' not in html
        assert '?project=' + project.name in html
        assert 'Collection enabled' in html
        print('Projects page renders and escapes project names and tracking snippets.')
        frappe.set_user('Guest')
        try:
            get_context(frappe._dict())
        except frappe.Redirect:
            assert frappe.local.flags.redirect_location.endswith('/statistics_diy/admin/projects')
            print('Guest redirected to login.')
        else:
            raise AssertionError('Guest was allowed into projects')
        frappe.set_user('Guest')
        original_roles = frappe.get_roles
        try:
            frappe.session.user = 'unprivileged-test'
            frappe.get_roles = lambda: ['Website User']
            try:
                get_context(frappe._dict())
            except frappe.PermissionError:
                print('Non-administrator access rejected.')
            else:
                raise AssertionError('Non-administrator was allowed into projects')
        finally:
            frappe.get_roles = original_roles
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def project_editor():
    from statistics_diy.api import save_project
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        result = save_project('Editor verification', 'https://example.com', 1)
        name = result['name']
        key = frappe.db.get_value('Analytics Project', name, 'collection_key')
        assert key
        save_project('Updated project', 'https://updated.example', 0, name)
        doc = frappe.get_doc('Analytics Project', name)
        assert doc.project_name == 'Updated project'
        assert doc.website_origin == 'https://updated.example'
        assert doc.enabled == 0
        assert doc.collection_key == key
        try:
            save_project('Bad origin', 'https://example.com/private', 1)
        except frappe.ValidationError:
            pass
        else:
            raise AssertionError('Invalid website origin accepted')
        frappe.set_user('Guest')
        try:
            save_project('Unauthorized project', 'https://example.com', 1)
        except frappe.PermissionError:
            pass
        else:
            raise AssertionError('Guest could create a project')
        print('Project create, edit, validation, key preservation and authorization passed.')
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def languages():
    from werkzeug.test import EnvironBuilder
    from werkzeug.wrappers import Request
    from frappe.website.page_renderers.template_page import TemplatePage
    from statistics_diy.i18n import language_context
    previous = frappe.session.user
    old_request = getattr(frappe.local, 'request', None)
    try:
        frappe.set_user('Administrator')
        frappe.session.data.csrf_token = 'verification-token'
        for language, expected in [('en', 'Save settings'), ('zh-CN', '保存设置'), ('unknown', 'Save settings')]:
            frappe.local.request = Request(EnvironBuilder(headers={'Cookie': 'statistics_language=' + language}).get_environ())
            html = TemplatePage('statistics_diy/admin/settings').get_html()
            assert expected in html
            assert '/assets/frappe' not in html
            context = frappe._dict()
            language_context(context)
            assert context.language == ('zh-CN' if language == 'zh-CN' else 'en')
        print('Settings renders in English and Chinese; unsupported languages fall back to English.')
    finally:
        frappe.local.request = old_request
        frappe.set_user(previous)


def reports():
    from datetime import datetime, timedelta, timezone
    from statistics_diy.api import report_window, summary
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        _, start, end = report_window(7, datetime(2026, 1, 1, 15, tzinfo=timezone.utc))
        assert start == datetime(2025, 12, 26) and end == datetime(2026, 1, 2)
        for invalid in ['0', '-7', '366', '7.5', None]:
            try:
                report_window(invalid)
            except ValueError:
                pass
            else:
                raise AssertionError('Invalid range accepted')
        project = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Report verification',
            'website_origin': 'https://example.com'}).insert()
        _, start, end = report_window(7)
        for index, (moment, host) in enumerate([(start, ''), (start - timedelta(seconds=1), 'old.example'),
                                               (end - timedelta(seconds=1), 'ref.example'), (end, 'future.example')]):
            frappe.get_doc({'doctype': 'Analytics Event', 'project': project.name,
                'event_id': f'{project.name}:{index}', 'occurred_at': moment,
                'path': '/verification', 'referrer_host': host}).insert()
        result = summary(project.name, 7)
        assert len(result['daily']) == 7
        assert result['total'] == 2
        assert result['daily'][0]['views'] == 1 and result['daily'][-1]['views'] == 1
        assert all(row['views'] == 0 for row in result['daily'][1:-1])
        assert sum(row.views for row in result['referrers']) == 2
        assert summary(project.name, 30)['total'] == 3
        assert len(summary(project.name, 90)['daily']) == 90
        print('UTC date boundaries, zero-filled days, ranges and referral totals passed.')
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def all_projects():
    from datetime import datetime, timezone
    from statistics_diy.api import summary
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        baseline = summary(days=7)['total']
        projects = []
        for index in range(3):
            project = frappe.get_doc({'doctype': 'Analytics Project',
                'project_name': f'Overview verification {index}', 'website_origin': f'https://example{index}.com',
                'enabled': int(index != 2)}).insert()
            projects.append(project)
            for event in range(index):
                frappe.get_doc({'doctype': 'Analytics Event', 'project': project.name,
                    'event_id': f'{project.name}:{event}', 'occurred_at': datetime.now(timezone.utc).replace(tzinfo=None),
                    'path': '/shared-path', 'referrer_host': ''}).insert()
        report = summary(days=7)
        assert report['all_projects']
        assert report['total'] == baseline + 3
        totals = {row['name']: row['views'] for row in report['projects']}
        assert [totals[p.name] for p in projects] == [0, 1, 2]
        assert not summary(projects[1].name, 7)['all_projects']
        assert summary(projects[1].name, 7)['total'] == 1
        assert sum(row['views'] for row in report['daily']) == report['total']
        assert sum(row['views'] for row in report['projects']) == report['total']
        frappe.set_user('Guest')
        try:
            summary(days=7)
        except frappe.PermissionError:
            pass
        else:
            raise AssertionError('Guest could access all-project totals')
        print('Combined totals, zero-traffic and disabled projects, single-project reports and permissions passed.')
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def visitors():
    from datetime import datetime, timedelta, timezone
    from statistics_diy.api import collect, summary
    previous = frappe.session.user
    header = frappe.get_request_header
    try:
        frappe.set_user('Administrator')
        projects = [frappe.get_doc({'doctype': 'Analytics Project', 'project_name': f'Visitor verification {i}',
            'website_origin': 'https://example.com'}).insert() for i in range(2)]
        frappe.get_request_header = lambda key: 'https://example.com'
        visitor = '8417d08e-cc13-4a43-a6d0-0948c2f78d5c'
        for i, project in enumerate([projects[0], projects[0], projects[1]]):
            collect(project.collection_key, f'12345678-1234-4234-8234-{i:012d}', '/test', None, visitor)
        collect(projects[0].collection_key, '12345678-1234-4234-8234-000000000003', '/test', None)
        report = summary(projects[0].name, 7)
        assert report['total'] == 3 and report['visitors'] == 1 and report['unmeasured_views'] == 1
        assert report['identified_views'] == 2 and not report['visitor_count_complete']
        assert sum(row['visitors'] for row in report['daily']) == 1
        first = frappe.db.get_value('Analytics Event', {'project': projects[0].name, 'visitor_id': ['is', 'set']}, 'visitor_id')
        second = frappe.db.get_value('Analytics Event', {'project': projects[1].name}, 'visitor_id')
        assert first and second and first != second and first != visitor
        try:
            collect(projects[0].collection_key, '12345678-1234-4234-8234-000000000004', '/test', None, 'bad-id')
        except frappe.ValidationError:
            pass
        else:
            raise AssertionError('Invalid visitor ID accepted')
        # A repeat visitor on another day counts once in the period, once on each day.
        frappe.get_doc({'doctype': 'Analytics Event', 'project': projects[0].name, 'event_id': projects[0].name + ':earlier',
            'visitor_id': first, 'occurred_at': datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1),
            'path': '/test'}).insert()
        report = summary(projects[0].name, 7)
        assert report['visitors'] == 1 and sum(row['visitors'] for row in report['daily']) == 2
        assert summary(projects[1].name, 7)['visitors'] == 1
        print('Visitor deduplication, daily/period counts, legacy coverage and project-scoped hashing passed.')
    finally:
        frappe.db.rollback()
        frappe.get_request_header = header
        frappe.set_user(previous)


def advanced():
    from datetime import datetime, timedelta, timezone
    from statistics_diy.api import collect, summary
    from statistics_diy.activity import ping
    from statistics_diy.maintenance import label_visitor, clear_data, save_settings
    from statistics_diy.classification import classify
    previous = frappe.session.user
    original_header = frappe.get_request_header
    try:
        frappe.set_user('Administrator')
        project = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Advanced verification',
            'website_origin': 'https://example.com'}).insert()
        visitor = '12345678-1234-4234-8234-000000000001'
        session = '12345678-1234-4234-8234-000000000002'
        ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36'
        frappe.get_request_header = lambda name: 'https://example.com' if name == 'Origin' else ua
        for index in range(2):
            collect(project.collection_key, f'12345678-1234-4234-8234-{index + 10:012d}', '/test', 'https://search.example/', visitor, session, 'Pacific/Saipan')
        ua = 'Googlebot/2.1'
        collect(project.collection_key, '12345678-1234-4234-8234-000000000020', '/bot', None, visitor, session)
        report = summary(project.name, 7)
        assert report['total'] == 2 and report['returning'] == 1 and report['bot_hits'] == 1
        assert report['today']['views'] == 2
        assert report['breakdowns']['browser'][0].label == 'Chrome'
        assert report['breakdowns']['operating_system'][0].label == 'Windows'
        assert report['known'][0].sessions == 1
        assert report['pages'][0].visitors == 1 and report['referrers'][0].visitors == 1
        assert summary(project.name, 7, 0)['total'] == 3
        hashed_visitor = report['known'][0].visitor_id
        label_visitor(project.name, hashed_visitor, 'Test visitor')
        label_visitor(project.name, hashed_visitor, 'Updated label')
        assert summary(project.name, 7)['known'][0].label == 'Updated label'
        assert frappe.db.count('Analytics Visitor', {'project': project.name}) == 1
        install = '12345678-1234-4234-8234-000000000030'
        event = '12345678-1234-4234-8234-000000000031'
        assert ping(project.app_collection_key, install, event, 'Linux', '1.0')['accepted']
        assert ping(project.app_collection_key, install, event, 'Linux', '1.0')['duplicate']
        app = summary(project.name, 7)['apps']
        assert app.installs == 1 and app.dau == 1 and app.mau == 1 and app.pings == 1
        frappe.db.set_value('App Activity', {'project': project.name}, 'occurred_at', datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=10))
        app = summary(project.name, 7)['apps']
        assert app.dau == 0 and app.mau == 1
        try:
            clear_data('no', project.name)
        except frappe.ValidationError:
            pass
        else:
            raise AssertionError('Unconfirmed clear allowed')
        # Target only the temporary project; never clear live project data in tests.
        clear_data('DELETE ANALYTICS', project.name)
        assert summary(project.name, 7)['total'] == 0
        assert summary(project.name, 7)['apps'].installs == 0
        assert frappe.db.exists('Analytics Project', project.name)
        save_settings(180)
        report = summary(project.name, 365)
        assert report['daily'][0]['views'] is None
        assert report['daily'][-1]['available']
        assert classify('Mozilla/5.0 (iPhone) Mobile Safari/605')['operating_system'] == 'iOS'
        assert classify('Mozilla/5.0 (Android) Chrome/123')['device'] == 'Tablet'
        frappe.set_user('Guest')
        for function, args in [(label_visitor, (project.name, hashed_visitor, 'bad')), (clear_data, ('DELETE ANALYTICS', project.name)), (save_settings, (30,))]:
            try:
                function(*args)
            except frappe.PermissionError:
                pass
            else:
                raise AssertionError('Guest mutation allowed')
        print('Bot filtering, dimensions, sessions, labels, app dedup/DAU/MAU, retention coverage and data-clear permissions passed.')
    finally:
        frappe.db.rollback()
        frappe.get_request_header = original_header
        frappe.set_user(previous)


def trend_interactions():
    from datetime import datetime, timedelta, timezone
    from statistics_diy.api import summary
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        project = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Trend verification',
            'website_origin': 'https://example.com'}).insert()
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
        for index in range(2):
            frappe.get_doc({'doctype': 'Analytics Event', 'project': project.name,
                'event_id': f'{project.name}:{index}', 'occurred_at': today - timedelta(days=index),
                'path': f'/day-{index}', 'visitor_id': 'a' * 64}).insert()
        assert summary(project.name, 7)['total'] == 2
        detail = summary(project.name, 7, day=today.date().isoformat())
        assert detail['total'] == 1 and detail['visitors'] == 1
        assert len(detail['daily']) == 1 and detail['pages'][0].path == '/day-0'
        for day in ['2026-02-30', (today + timedelta(days=1)).date().isoformat(), (today - timedelta(days=8)).date().isoformat()]:
            try:
                summary(project.name, 7, day=day)
            except frappe.ValidationError:
                pass
            else:
                raise AssertionError('Invalid trend selection accepted')
        print('Day selection narrows totals and tables; invalid and out-of-range dates rejected.')
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def ip_addresses():
    from werkzeug.test import EnvironBuilder
    from werkzeug.wrappers import Request
    from statistics_diy.network import client_ip, normalize_ip
    from statistics_diy.api import collect, summary
    from uuid import uuid4
    import requests
    import ipaddress
    previous = frappe.session.user
    old_request = getattr(frappe.local, 'request', None)
    original_header = frappe.get_request_header
    old_secret = frappe.conf.get('statistics_proxy_token')
    project = None
    try:
        frappe.conf.statistics_proxy_token = 'verification-secret'
        def request(peer, headers):
            frappe.local.request = Request(EnvironBuilder(headers=headers, environ_base={'REMOTE_ADDR': peer}).get_environ())
        request('8.8.8.8', {'X-Statistics-Client-IP': '1.1.1.1', 'CF-Connecting-IP': '1.1.1.1', 'X-Forwarded-For': '1.1.1.1'})
        assert client_ip() == '8.8.8.8'
        request('127.0.0.1', {'X-Statistics-Client-IP': '2001:4860:4860::8888', 'X-Statistics-Proxy-Token': 'verification-secret'})
        assert client_ip() == '2001:4860:4860::8888'
        request('8.8.8.8', {'X-Statistics-Client-IP': 'invalid', 'X-Statistics-Proxy-Token': 'verification-secret'})
        assert client_ip() is None
        assert normalize_ip('::ffff:8.8.8.8') == '8.8.8.8'
        frappe.conf.statistics_proxy_token = old_secret
        frappe.local.request = old_request
        frappe.set_user('Administrator')
        project = frappe.get_doc({'doctype': 'Analytics Project', 'project_name': 'Temporary IP verification', 'website_origin': 'https://example.com'}).insert()
        frappe.db.commit()
        import os, socket, struct
        from pathlib import Path
        proxy_host = os.environ.get('STATISTICS_PROXY_TEST_HOST', '127.0.0.1')
        if Path('/.dockerenv').exists():
            gateway = next(line.split()[2] for line in Path('/proc/net/route').read_text().splitlines()[1:] if line.split()[1] == '00000000')
            proxy_host = socket.inet_ntoa(struct.pack('<I', int(gateway, 16)))
        response = requests.post(f'http://{proxy_host}:80/api/method/statistics_diy.api.collect',
            headers={'Host': 'statistics.diy', 'Origin': 'https://example.com', 'CF-Connecting-IP': '192.0.2.12', 'X-Statistics-Client-IP': '192.0.2.12', 'X-Statistics-Proxy-Token': 'fake'},
            data={'key': project.collection_key, 'event_id': str(uuid4()), 'path': '/ip-test', 'visitor_id': str(uuid4())}, timeout=15)
        assert response.status_code == 200, response.text[:200]
        frappe.db.rollback()
        recorded = frappe.db.get_value('Analytics Event', {'project': project.name}, 'ip_address')
        assert recorded and ipaddress.ip_address(recorded).is_private and recorded != '192.0.2.12'
        response = requests.post('https://statistics.diy/api/method/statistics_diy.api.collect',
            headers={'Origin': 'https://example.com', 'X-Statistics-Client-IP': '192.0.2.12', 'X-Statistics-Proxy-Token': 'fake'},
            data={'key': project.collection_key, 'event_id': str(uuid4()), 'path': '/public-ip-test', 'visitor_id': str(uuid4())}, timeout=15)
        assert response.status_code == 200, response.text[:200]
        frappe.db.rollback()
        recorded = frappe.db.get_value('Analytics Event', {'project': project.name, 'path': '/public-ip-test'}, 'ip_address')
        assert recorded and ipaddress.ip_address(recorded).is_global and recorded != '192.0.2.12'
        report = summary(project.name, 7)
        assert sum(row.views for row in report['ips']) == 2
        assert all(row.ip_address for row in report['recent'])
        print('IPv4/IPv6 normalization, spoofed-header rejection, direct/public proxy collection and IP totals passed.')
    finally:
        frappe.db.rollback()
        frappe.conf.statistics_proxy_token = old_secret
        frappe.local.request = old_request
        frappe.get_request_header = original_header
        frappe.set_user('Administrator')
        if project and frappe.db.exists('Analytics Project', project.name):
            frappe.db.delete('Analytics Event', {'project': project.name})
            frappe.delete_doc('Analytics Project', project.name, force=True)
            frappe.db.commit()
        frappe.set_user(previous)


def country_flags():
    from statistics_diy.geolocation import decorate_ips, flag
    previous_path = frappe.conf.get('statistics_geoip_database')
    rows = [frappe._dict(ip_address=value) for value in ['8.8.8.8', '2001:4860:4860::8888', '127.0.0.1', 'not-an-ip', None]]
    try:
        decorate_ips(rows)
        assert rows[0].country_code == 'US' and rows[0].country_flag == '🇺🇸'
        assert rows[1].country_code and rows[1].country_flag == flag(rows[1].country_code)
        assert all(not row.country_flag for row in rows[2:])
        assert flag('MP') == '🇲🇵' and flag('us') == '🇺🇸'
        assert not flag('USA') and not flag('<>')
        frappe.conf.statistics_geoip_database = '/nonexistent/country.mmdb'
        decorate_ips(rows)
        assert all(not row.country_flag for row in rows)
        print('Country flags verified for IPv4/IPv6; private, invalid and unavailable lookups safely remain unflagged.')
    finally:
        frappe.conf.statistics_geoip_database = previous_path


def homepage():
    from statistics_diy.routing import resolve
    from frappe.website.page_renderers.template_page import TemplatePage
    previous = frappe.session.user
    try:
        for user in ['Guest', 'Administrator']:
            frappe.set_user(user)
            frappe.session.data.csrf_token = 'verification-token'
            assert resolve('') == 'statistics_diy/user/homepage'
            assert resolve('statistics_diy/user/homepage') == 'statistics_diy/user/homepage'
            assert resolve('statistics_diy/admin/projects') == 'statistics_diy/admin/projects'
            html = TemplatePage(resolve('')).get_html()
            assert 'Built for independent developers' in html
            assert '/assets/frappe' not in html
            if user == 'Guest':
                assert 'Open dashboard' not in html and 'Sign in' in html
            else:
                assert 'Open dashboard' in html
        print('Root and explicit homepage routes verified for guests and administrators; existing routes preserved.')
    finally:
        frappe.set_user(previous)


def audit_visitors():
    from statistics_diy.api import summary
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        for days in [7, 30, 90]:
            report = summary(days=days)
            print({'days': days, 'views': report['total'], 'visitors': report['visitors'], 'missing_visitor_views': report['unmeasured_views'],
                'daily_visitor_sum': sum(row['visitors'] or 0 for row in report['daily']),
                'projects': [{'name': row['name'], 'views': row['views'], 'visitors': row['visitors']} for row in report['projects']]})
        print('Stored identifier coverage:', frappe.db.sql("""SELECT COUNT(*) AS views,
            COUNT(DISTINCT project, NULLIF(visitor_id,'')) AS project_visitors,
            SUM(visitor_id IS NULL OR visitor_id='') AS missing,
            MIN(occurred_at) AS earliest, MAX(occurred_at) AS latest FROM `tabAnalytics Event`""", as_dict=True))
    finally:
        frappe.set_user(previous)


def ip_fallback():
    from datetime import datetime, timedelta, timezone
    from statistics_diy.api import summary
    previous = frappe.session.user
    try:
        frappe.set_user('Administrator')
        projects = [frappe.get_doc({'doctype': 'Analytics Project', 'project_name': f'Fallback verification {i}',
            'website_origin': 'https://example.com'}).insert() for i in range(2)]
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        a, b = 'a' * 64, 'b' * 64
        samples = [(a, '203.0.113.1', 0), (None, '203.0.113.1', 0),
            (a, '203.0.113.2', 0), (b, '203.0.113.1', 0),
            (None, '203.0.113.3', 0), (None, '203.0.113.3', 1), (None, None, 0)]
        for index, (visitor, ip, offset) in enumerate(samples):
            frappe.get_doc({'doctype': 'Analytics Event', 'project': projects[0].name,
                'event_id': projects[0].name + ':' + str(index), 'occurred_at': now - timedelta(days=offset),
                'path': '/fallback', 'visitor_id': visitor, 'ip_address': ip}).insert()
        frappe.get_doc({'doctype': 'Analytics Event', 'project': projects[1].name,
            'event_id': projects[1].name + ':one', 'occurred_at': now,
            'path': '/fallback', 'ip_address': '203.0.113.3'}).insert()
        result = summary(projects[0].name, 7)
        assert result['total'] == 7 and result['visitors'] == 3
        assert result['ip_visitors'] == 1 and result['ip_fallback_views'] == 3
        assert result['unmeasured_views'] == 1 and not result['visitor_count_complete']
        assert result['pages'][0].visitors == 3
        assert result['daily'][-1]['visitors'] == 3
        assert result['daily'][-2]['visitors'] == 1
        assert result['today']['visitors'] == result['daily'][-1]['visitors']
        assert summary(projects[1].name, 7)['visitors'] == 1
        # A day-specific report must use the same fallback scope as the daily row.
        assert summary(projects[0].name, 7, day=(now - timedelta(days=1)).date().isoformat())['visitors'] == 1
        totals = {row['name']: row['visitors'] for row in summary(days=7)['projects']}
        assert totals[projects[0].name] == 3 and totals[projects[1].name] == 1
        print('IP fallback de-duplicates repeated IPs, avoids browser/IP overlap, preserves shared-IP browser IDs and project/day isolation.')
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def cities():
    from statistics_diy.geolocation import decorate_ips
    previous_path = frappe.conf.get('statistics_geoip_database')
    try:
        frappe.conf.statistics_geoip_database = '/workspace/geoip/city.mmdb'
        rows = [frappe._dict(ip_address=value) for value in ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '127.0.0.1']]
        decorate_ips(rows)
        assert any(row.city for row in rows[:3])
        assert all(row.country_flag for row in rows[:3])
        assert rows[-1].city is None and not rows[-1].country_flag
        frappe.conf.statistics_geoip_database = '/workspace/geoip/country.mmdb'
        decorate_ips(rows)
        assert all(row.city is None for row in rows)
        assert rows[0].country_flag
        print('City/region lookup verified; private IPs and country-only databases safely omit cities.')
    finally:
        frappe.conf.statistics_geoip_database = previous_path
