import frappe
from statistics_diy.translations import TRANSLATIONS

LANGUAGES = {'en': 'English', 'zh-CN': '简体中文'}


def language_context(context):
    request = getattr(frappe.local, 'request', None)
    language = request.cookies.get('statistics_language', 'en') if request else 'en'
    if language not in LANGUAGES:
        language = 'en'
    translations = TRANSLATIONS if language == 'zh-CN' else {}
    context.language = language
    context.t = lambda text: translations.get(text, text)
    context.translations = translations
    context.languages = LANGUAGES
