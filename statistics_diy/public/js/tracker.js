(() => {
  const script = document.currentScript;
  const key = script?.dataset.key;
  if (!key || navigator.doNotTrack === "1") return;
  const endpoint = new URL("/api/method/statistics_diy.api.collect", script.src);
  const form = new URLSearchParams({key, event_id: crypto.randomUUID(), path: location.pathname,
    referrer: document.referrer});
  fetch(endpoint, {method: "POST", body: form, credentials: "omit", keepalive: true}).catch(() => {});
})();
