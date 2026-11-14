import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const LANGUAGES = [['en', 'English'], ['zh-CN', '简体中文']];
const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../locales/zh-CN.json', import.meta.url)), 'utf8'));

export function languageContext(req) {
  const match = /(?:^|;\s*)statistics_language=([^;]*)/.exec(req.headers.cookie || '');
  let language = 'en';
  try { language = match ? decodeURIComponent(match[1]) : 'en'; } catch { /* malformed cookie */ }
  if (!LANGUAGES.some(([code]) => code === language)) language = 'en';
  const translations = language === 'zh-CN' ? catalog : {};
  return {language, translations, languages: LANGUAGES, t: text => translations[text] ?? text};
}
