(() => {
  const script = document.currentScript;
  const key = script?.dataset.key;
  if (/^\/(?:api|app|desk|statistics_diy\/admin)(?:\/|$)/.test(location.pathname)) return;
  if (!key || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  const endpoint = new URL('/api/method/statistics_diy.api.collect', script.src);
  const form = new URLSearchParams({key, event_id: crypto.randomUUID(), path: location.pathname, referrer: document.referrer});
  if (script.dataset.visitors !== 'off') {
    try {
      const storageKey = 'statistics_diy_visitor:' + endpoint.origin + ':' + key;
      let visitor;
      try { visitor = JSON.parse(localStorage.getItem(storageKey)); } catch (_) {}
      if (!visitor || !/^[0-9a-f-]{36}$/i.test(visitor.id) || !(visitor.expires > Date.now())) {
        visitor = {id: crypto.randomUUID(), expires: Date.now() + 90 * 86400000};
        localStorage.setItem(storageKey, JSON.stringify(visitor));
      }
      form.set('visitor_id', visitor.id);
    } catch (_) { /* Storage unavailable: collect page views without a visitor estimate. */ }
  }
  if (form.has('visitor_id')) try {
    const sessionKey = 'statistics_diy_session:' + endpoint.origin + ':' + key;
    let session;
    try { session = JSON.parse(sessionStorage.getItem(sessionKey)); } catch (_) {}
    if (!session || !(session.expires > Date.now())) session = {id: crypto.randomUUID()};
    session.expires = Date.now() + 30 * 60000;
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    form.set('session_id', session.id);
    form.set('visitor_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch (_) {}
  fetch(endpoint, {method: 'POST', body: form, credentials: 'omit', keepalive: true}).catch(() => {});
})();
