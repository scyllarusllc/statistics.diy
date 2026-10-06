"""Coarse User-Agent categories. No raw UA or fingerprint is stored."""
import re


def classify(user_agent):
    ua = (user_agent or '')[:2000].lower()
    bot = bool(re.search(r'bot\b|crawler|spider|headless|slurp|facebookexternalhit|curl/|wget/', ua))
    device = 'Tablet' if 'ipad' in ua or ('android' in ua and 'mobile' not in ua) else 'Mobile' if any(x in ua for x in ('mobile', 'iphone', 'ipod')) else 'Desktop' if ua else 'Unknown'
    browser = next((label for token, label in [('edg/', 'Edge'), ('opr/', 'Opera'), ('firefox/', 'Firefox'), ('fxios/', 'Firefox'), ('chrome/', 'Chrome'), ('crios/', 'Chrome'), ('safari/', 'Safari')] if token in ua), 'Other')
    system = next((label for token, label in [('android', 'Android'), ('iphone', 'iOS'), ('ipad', 'iOS'), ('windows', 'Windows'), ('macintosh', 'macOS'), ('mac os', 'macOS'), ('linux', 'Linux')] if token in ua), 'Other')
    return {'device': device, 'browser': browser, 'operating_system': system, 'is_bot': int(bot)}
