(function () {
  'use strict';
  const names = ['requestsCreated', 'requestsDeleted', 'statusChanges', 'favorites', 'services', 'offerShown', 'offerAccepted', 'offerDeclined', 'level1', 'level2', 'level3'];
  let counters = Object.fromEntries(names.map(name => [name, 0]));
  let enabled = false, token = null, generation = 0, provider = () => null, state = 'off', sending = false;
  const pendingRevocations = new Set();
  function notify(value) { state = value; window.dispatchEvent(new Event('hh:statistics')); }
  async function post(path, body, sessionToken) {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(sessionToken ? { 'X-Statistics-Token': sessionToken } : {}) }, body: JSON.stringify(body), keepalive: true });
    if (!response.ok) throw new Error('Statistics unavailable');
    return response.json();
  }
  async function retryDeletion() {
    for (const sessionToken of pendingRevocations) {
      try { await post('/api/statistics/revoke', {}, sessionToken); pendingRevocations.delete(sessionToken); }
      catch (_) { notify('delete-error'); return; }
    }
    if (!enabled) notify('off');
  }
  async function consent(allowed) {
    const revision = ++generation; enabled = allowed;
    if (!allowed) {
      if (token) pendingRevocations.add(token);
      token = null; notify(pendingRevocations.size ? 'deleting' : 'off');
      await retryDeletion(); return;
    }
    counters = Object.fromEntries(names.map(name => [name, 0]));
    if (location.protocol === 'file:') { notify('offline'); return; }
    notify('connecting');
    try {
      const session = await post('/api/statistics/sessions', {});
      if (!enabled || revision !== generation) { pendingRevocations.add(session.token); await retryDeletion(); return; }
      token = session.token; notify('ready'); await flush();
    } catch (_) { if (revision === generation && enabled) notify('error'); }
  }
  async function flush() {
    if (!enabled || !token || sending) return;
    const sessionToken = token, revision = generation, report = provider();
    if (!report) return;
    sending = true;
    try {
      await post('/api/statistics/update', { activeSeconds: Math.min(3600, Math.floor(report.activeSeconds)), keydowns: report.counts.keydowns, clicks: report.counts.clicks, counters: { ...counters } }, sessionToken);
      if (revision === generation && enabled) notify('ready');
    } catch (_) { if (revision === generation && enabled) notify('error'); }
    finally { sending = false; }
  }
  function record(name) { if (enabled && names.includes(name)) counters[name]++; }
  function suspend() { enabled = false; token = null; generation++; notify('off'); }
  window.HandHelper.statistics = { consent, flush, record, retryDeletion, suspend, state: () => state, setProvider: callback => { provider = callback; } };
  setInterval(flush, 15000);
  window.addEventListener('pagehide', flush);
  window.addEventListener('online', () => { retryDeletion(); if (enabled && !token) consent(true); else flush(); });
})();
