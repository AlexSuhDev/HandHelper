(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let csrfToken = null, snapshot = null, controller = null, revision = 0, authRevision = 0, returnFocus = null;
  const number = value => new Intl.NumberFormat('ru-RU').format(value);
  function setSession(session) {
    authRevision++;
    const admin = session.authenticated === true;
    csrfToken = admin ? session.csrfToken : null;
    document.documentElement.dataset.role = admin ? 'admin' : 'user';
    $('admin-login-button').hidden = admin; $('admin-logout-button').hidden = !admin;
    if (!admin) {
      revision++; if (controller) controller.abort(); snapshot = null;
      ['statistics-recent', 'statistics-trend', 'statistics-levels'].forEach(id => $(id).replaceChildren());
      document.querySelectorAll('[data-statistic]').forEach(el => { el.textContent = '—'; });
      $('export-statistics').disabled = true;
    }
    window.dispatchEvent(new CustomEvent('hh:rolechange', { detail: { isAdmin: admin } }));
    if (admin) refresh();
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options.headers } });
    if (response.status === 401 && path !== '/api/auth/login') setSession({ authenticated: false });
    return response;
  }
  function openLogin() {
    returnFocus = document.activeElement; $('admin-login-error').textContent = '';
    $('admin-login-dialog').showModal(); $('admin-password').focus();
  }
  $('admin-login-button').addEventListener('click', openLogin);
  $('close-admin-login').addEventListener('click', () => $('admin-login-dialog').close());
  $('admin-login-dialog').addEventListener('close', () => { $('admin-password').value = ''; if (returnFocus && returnFocus.isConnected && !returnFocus.hidden) returnFocus.focus({ preventScroll: true }); });
  $('admin-login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('submit-admin-login').disabled = true; $('admin-login-error').textContent = '';
    try {
      const response = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('admin-username').value.trim(), password: $('admin-password').value }) });
      $('admin-password').value = '';
      if (!response.ok) { $('admin-login-error').textContent = response.status === 429 ? 'Слишком много попыток. Повторите вход через пять минут.' : response.status === 401 ? 'Неверный логин или пароль.' : 'Не удалось войти. Проверьте, что сервер сайта запущен.'; return; }
      setSession(await response.json()); $('admin-login-dialog').close(); $('admin-statistics').scrollIntoView({ behavior: 'instant' });
      $('admin-statistics-title').focus({ preventScroll: true });
    } catch (_) { $('admin-login-error').textContent = 'Сервер недоступен. Запустите сайт через Start-Preview.ps1.'; }
    finally { $('submit-admin-login').disabled = false; }
  });
  $('admin-logout-button').addEventListener('click', async () => {
    $('admin-logout-button').disabled = true;
    try {
      const response = await api('/api/auth/logout', { method: 'POST', body: '{}' });
      if (response.ok || response.status === 401) { setSession({ authenticated: false }); $('admin-login-button').focus(); }
      else $('statistics-status').textContent = 'Не удалось завершить сеанс. Повторите выход.';
    } catch (_) { $('statistics-status').textContent = 'Сервер недоступен. Повторите выход после восстановления соединения.'; }
    finally { $('admin-logout-button').disabled = false; }
  });
  function cell(row, value) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
  function render(data) {
    snapshot = data;
    const values = { sessions: data.sessions, minutes: Math.round(data.activeSeconds / 60), keydowns: data.keydowns, clicks: data.clicks, requests: data.totals.requestsCreated, offers: data.totals.offerShown, accepted: data.totals.offerAccepted, services: data.totals.services };
    document.querySelectorAll('[data-statistic]').forEach(el => { el.textContent = number(values[el.dataset.statistic]); });
    $('statistics-trend').replaceChildren();
    const max = Math.max(1, ...data.trend.map(day => day.sessions));
    data.trend.forEach(day => {
      const column = document.createElement('div'); column.className = 'statistics-day';
      const amount = document.createElement('span'); amount.textContent = number(day.sessions);
      const bar = document.createElement('div'); bar.className = 'statistics-day-bar'; bar.style.height = (day.sessions / max * 100) + 'px';
      const date = document.createElement('small'); date.textContent = day.date.slice(8) + '.' + day.date.slice(5, 7);
      column.setAttribute('aria-label', day.date + ': ' + day.sessions + ' сеансов'); column.append(amount, bar, date); $('statistics-trend').append(column);
    });
    $('statistics-levels').replaceChildren();
    ['Немного крупнее', 'Крупные элементы', 'Максимально крупные'].forEach((label, index) => {
      const row = document.createElement('p'); row.textContent = label + ': ' + number(data.totals['level' + (index + 1)]); $('statistics-levels').append(row);
    });
    $('statistics-recent').replaceChildren();
    data.recent.forEach(session => {
      const row = document.createElement('tr');
      cell(row, session.id); cell(row, new Date(session.startedAt).toLocaleString('ru-RU')); cell(row, Math.round(session.activeSeconds / 60)); cell(row, number(session.keydowns)); cell(row, number(session.clicks)); cell(row, number(session.requestsCreated));
      $('statistics-recent').append(row);
    });
    $('statistics-empty').hidden = data.sessions > 0;
    $('statistics-status').textContent = 'Обновлено: ' + new Date(data.generatedAt).toLocaleTimeString('ru-RU') + '. Учитываются только сеансы с согласием на статистику.';
    $('export-statistics').disabled = false;
  }
  async function refresh() {
    if (document.documentElement.dataset.role !== 'admin') return;
    const current = ++revision;
    if (controller) controller.abort(); controller = new AbortController();
    $('statistics-status').textContent = 'Загружаем статистику…';
    try {
      const response = await api('/api/admin/statistics?range=' + $('statistics-period').value, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const data = await response.json(); if (current === revision && document.documentElement.dataset.role === 'admin') render(data);
    } catch (error) { if (error.name !== 'AbortError' && current === revision) { snapshot = null; $('export-statistics').disabled = true; $('statistics-status').textContent = 'Не удалось загрузить статистику. Проверьте подключение и повторите обновление.'; } }
  }
  $('refresh-statistics').addEventListener('click', refresh); $('statistics-period').addEventListener('change', refresh);
  $('export-statistics').addEventListener('click', () => {
    if (!snapshot) return;
    const rows = [['Сеанс', 'Начало (UTC)', 'Активных секунд', 'Нажатий', 'Кликов', 'Созданий обращений'], ...snapshot.recent.map(row => [row.id, row.startedAt, row.activeSeconds, row.keydowns, row.clicks, row.requestsCreated])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'statistics-recent-' + $('statistics-period').value + '.csv'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  async function restore() {
    if (location.protocol === 'file:') return;
    const current = authRevision;
    try { const response = await api('/api/auth/session'); if (response.ok) { const session = await response.json(); if (current === authRevision) setSession(session); } }
    catch (_) { /* The public portal remains available if the server is unavailable. */ }
  }
  window.addEventListener('pageshow', event => { if (event.persisted) { setSession({ authenticated: false }); restore(); } });
  window.HandHelper.authReady = restore();
  if (new URLSearchParams(location.search).get('role') === 'admin') window.HandHelper.authReady.then(() => { if (document.documentElement.dataset.role !== 'admin') openLogin(); });
})();
