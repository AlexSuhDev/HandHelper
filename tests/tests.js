(async function () {
  'use strict';
  const HH = globalThis.HandHelper;
  const lines = []; let failed = 0, skipped = 0;
  const assert = (condition, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
  const near = (a, b, eps = 1e-8) => assert(Math.abs(a - b) < eps, a + ' != ' + b);
  function test(name, fn) { try { fn(); lines.push('PASS ' + name); } catch (error) { failed++; lines.push('FAIL ' + name + ': ' + error.message); } }
  const model = HH.fit(HH.syntheticRows(), { synthetic: true });
  test('Online mean and CV match known sample', () => { const m = new HH.Moments(); [2, 4, 6].forEach(v => m.add(v)); near(m.mean, 4); near(m.cv, 0.5); });
  test('Clock excludes idle beyond 30 s', () => { const c = new HH.ActivityClock(); c.setEnabled(true, 0); c.activity(0); c.tick(60000); near(c.activeMs, 30000); c.activity(90000); c.tick(100000); near(c.activeMs, 40000); });
  test('Clock excludes pause and requires fresh activity on resume', () => { const c = new HH.ActivityClock(); c.setEnabled(true, 0); c.activity(0); c.setEnabled(false, 5000); c.tick(30000); c.setEnabled(true, 60000); c.tick(65000); near(c.activeMs, 5000); c.activity(65000); c.tick(70000); near(c.activeMs, 10000); });
  test('Clock clamps at exactly one hour', () => { const c = new HH.ActivityClock(); c.setEnabled(true, 0); for (let i = 0; i < 370; i++) c.activity(i * 10000); assert(c.complete); near(c.activeMs, 3600000); });
  test('Four example profiles map to ordered clusters', () => { for (let level = 0; level < 4; level++) { const r = HH.predict(model, HH.exampleReport(level)); assert(r.status === 'ok'); assert(r.level === level, 'Wrong cluster ' + level); assert(r.synthetic); } });
  test('Model is deterministic for a fixed seed', () => { const other = HH.fit(HH.syntheticRows(), { synthetic: true }); assert(JSON.stringify(model) === JSON.stringify(other)); });
  test('One user cannot train a model', () => { let threw = false; try { HH.fit([HH.exampleReport(0).features]); } catch (_) { threw = true; } assert(threw); });
  test('Identical training rows are rejected', () => { let threw = false; try { HH.fit(Array(80).fill(HH.exampleReport(0).features)); } catch (_) { threw = true; } assert(threw); });
  test('NaN, missing, out-of-range and string features are rejected', () => { for (const value of [NaN, undefined, -1, 1.1, '0.1']) { const row = { ...HH.exampleReport(0).features, correctionRate: value }; let threw = false; try { HH.fit(Array(80).fill(row)); } catch (_) { threw = true; } assert(threw); } });
  test('Early finish never classifies', () => { const r = HH.exampleReport(3); r.activeSeconds = 3599; assert(HH.predict(model, r).status === 'insufficient'); });
  test('One hour without enough keyboard or mouse data never classifies', () => { for (const key of ['keydowns', 'holds', 'flights', 'clicks', 'routes']) { const r = HH.exampleReport(2); r.counts[key] = 0; assert(HH.predict(model, r).status === 'insufficient', key); } });
  test('Invalid active time and malformed counts never classify', () => { for (const time of [NaN, Infinity, undefined]) { const r = HH.exampleReport(1); r.activeSeconds = time; assert(HH.predict(model, r).status === 'insufficient'); } const r = HH.exampleReport(1); r.counts.clicks = 30.5; assert(HH.predict(model, r).status === 'insufficient'); });
  test('Unknown profiles abstain instead of forcing severe result', () => { const r = HH.exampleReport(0); r.features = { correctionRate: 0.9, repeatRate: 0.9, holdCV: 4, flightCV: 4, pathInefficiency: 15, backgroundClickRate: 0.9, textErrorRate: 0.9, targetMissRate: 0.9 }; assert(HH.predict(model, r).status === 'out_of_distribution'); });
  test('Adaptation requires explicit consent; level zero is not adapted', () => { const el = document.createElement('div'); const a = new HH.Adaptation(el); for (const [level, consent] of [[2, false], [0, true]]) { let threw = false; try { a.apply(level, consent); } catch (_) { threw = true; } assert(threw); } assert(!el.hasAttribute('data-hh-support')); });
  test('Adaptation is reversible and scoped', () => { const el = document.createElement('div'); const sibling = document.createElement('div'); const a = new HH.Adaptation(el); a.apply(3, true); assert(el.dataset.hhSupport === '3'); assert(!sibling.hasAttribute('data-hh-support')); a.revert(); assert(!el.hasAttribute('data-hh-support')); });
  test('Existing support attribute is restored exactly', () => { const el = document.createElement('div'); el.setAttribute('data-hh-support', 'custom'); const a = new HH.Adaptation(el); a.apply(1, true); a.revert(); assert(el.getAttribute('data-hh-support') === 'custom'); });
  const collector = new HH.Collector(document.getElementById('fixture'));
  test('Collector starts with no retained events or text', () => { const r = collector.report(); assert(r.counts.keydowns === 0); assert(!JSON.stringify(r).includes('password')); assert(HH.quality(r).length >= 6); });
  test('Synthetic DOM events cannot contaminate observation', () => { collector.start(); document.getElementById('text-input').dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true })); assert(collector.report().counts.keydowns === 0); collector.stop(); });
  // Test processing methods with trusted-shaped inputs; dispatch above verifies the DOM trust boundary.
  function fake(target, extra = {}) { return { isTrusted: true, target, ...extra }; }
  function enable() { collector.running = true; collector.paused = false; collector.clock.enabled = true; }
  test('Password and opt-out fields are excluded', () => { collector.reset(); enable(); assert(!collector.accept(fake(document.getElementById('password')))); assert(!collector.accept(fake(document.getElementById('private')))); collector.running = false; });
  test('Typing aggregates corrections without reading text or values', () => {
    collector.reset(); enable(); const target = document.getElementById('text-input');
    for (const type of ['insertText', 'insertText', 'insertText', 'deleteContentBackward']) {
      const event = fake(target, { inputType: type });
      Object.defineProperty(event, 'data', { get() { throw new Error('Text was accessed'); } });
      collector.onBeforeInput(event);
    }
    const r = collector.report(); near(r.features.correctionRate, 0.25); assert(r.counts.insertions === 3); collector.running = false;
  });
  test('IME and keyboard shortcuts do not create typing samples', () => { collector.reset(); enable(); const target = document.getElementById('text-input'); collector.onKeyDown(fake(target, { key: 'x', code: 'KeyX', isComposing: true })); collector.onKeyDown(fake(target, { key: 'x', code: 'KeyX', ctrlKey: true })); assert(collector.counts.keydowns === 0); collector.running = false; });
  test('Keyboard and touch clicks do not contaminate mouse metrics', () => { collector.reset(); enable(); const target = document.getElementById('target'); collector.onClick(fake(target, { detail: 0, button: 0 })); collector.onClick(fake(target, { detail: 1, button: 0, pointerType: 'touch' })); assert(collector.counts.clicks === 0); collector.running = false; });
  test('Stop clears ephemeral key codes and coordinates', () => { collector.start(); collector.keys.set('KeyZ', 1); collector.route = { first: { x: 1, y: 2 } }; collector.stop(); assert(collector.keys.size === 0); assert(collector.route === null); assert(!collector.running); });
  test('Reset deletes all collected numeric statistics', () => { collector.counts.keydowns = 500; collector.holds.add(100); collector.reset(); assert(collector.report().counts.keydowns === 0); assert(collector.holds.n === 0); });
  test('Reference text uses edit distance including missing and extra characters', () => { near(HH.textError('abc', 'abc').rate, 0); near(HH.textError('abc', 'axc').rate, 1 / 3); near(HH.textError('abc', 'ac').rate, 1 / 3); near(HH.textError('abc', 'abcd').rate, 1 / 3); near(HH.textError('é', 'e\u0301').rate, 0); });
  test('Reference text compares code points and caps extreme errors', () => { near(HH.textError('🙂a', '🙂').rate, 0.5); near(HH.textError('a', 'abcdef').rate, 1); });
  test('Direct text and target measurements retain numbers only', () => {
    collector.reset(); enable(); const target = document.getElementById('text-input'); const event = fake(target, { detail: 1, button: 0, pointerType: 'mouse' });
    collector.recordTextTask('abc', 'axc', event); collector.recordTarget(false, event); collector.recordTarget(true, event);
    near(collector.report().features.textErrorRate, 1 / 3); near(collector.report().features.targetMissRate, 0.5); assert(!JSON.stringify(collector.checkpoint()).includes('axc')); collector.running = false;
  });
  test('Analysis requires actual reference tasks and target attempts', () => { for (const key of ['textTasks', 'targetAttempts']) { const r = HH.exampleReport(0); r.counts[key] = 0; assert(HH.predict(model, r).status === 'insufficient'); } });
  test('Checkpoint roundtrip preserves numeric state but no clock origin or held keys', () => { collector.reset(); collector.clock.activeMs = 12345; collector.counts.keydowns = 20; collector.holds.add(150); collector.keys.set('KeyX', 77); const checkpoint = collector.checkpoint(); const other = new HH.Collector(document.getElementById('fixture')); other.restore(checkpoint); near(other.clock.activeMs, 12345); assert(other.counts.keydowns === 20); assert(other.holds.mean === 150); assert(other.keys.size === 0); assert(other.clock.lastTick === null); });
  test('Malformed checkpoints are rejected before use', () => { const checkpoint = collector.checkpoint(); checkpoint.counts.targetMisses = 20; let threw = false; try { new HH.Collector(document.getElementById('fixture')).restore(checkpoint); } catch (_) { threw = true; } assert(threw); });
  test('Schedule starts and ends exactly once', () => { const s = new HH.WindowSchedule(10000, 20000, 0); assert(s.poll(9999) === 'waiting'); assert(s.poll(10000) === 'start'); assert(s.poll(15000) === 'waiting'); assert(s.poll(20000) === 'finish'); assert(s.poll(30000) === 'none'); });
  test('Missed schedule never starts late after its window', () => { const s = new HH.WindowSchedule(10000, 20000, 0); assert(s.poll(20001) === 'expired'); assert(s.poll(20002) === 'none'); });
  test('Invalid schedule windows are rejected', () => { for (const [a, b] of [[NaN, 100], [50, 40], [1, 90000000], [-5000, 100]]) { let threw = false; try { new HH.WindowSchedule(a, b, 0); } catch (_) { threw = true; } assert(threw); } });
  test('Collector enforces the window deadline and completes only once', () => { let completions = 0; const c = new HH.Collector(document.getElementById('fixture'), () => completions++); c.start(); c.deadline = Date.now() - 1; c.tick(); c.tick(); assert(!c.running); assert(c.endReason === 'window_ended'); assert(completions === 1); });
  test('Persistent storage requires consent and deletes only its own key', () => {
    const values = new Map([['unrelated', 'keep']]); const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; const store = new HH.LocalStore(storage, 'test');
    let threw = false; try { store.write({ version: 2, checkpoint: {} }, false); } catch (_) { threw = true; } assert(threw); assert(!values.has('test'));
    store.write({ version: 2, checkpoint: {} }, true); assert(store.read().version === 2); store.clear(); assert(!values.has('test')); assert(values.get('unrelated') === 'keep');
  });
  test('Exported models roundtrip with strict schema checks', () => { assert(HH.validateModel(model).version === 2); for (const change of [{ version: 1 }, { scales: [1] }, { radii: [0, 0, 0, 0] }, { levels: [0, 1, 2, 7] }]) { let threw = false; try { HH.validateModel({ ...model, ...change }); } catch (_) { threw = true; } assert(threw); } });
  const study = HH.trainStudy(HH.studyExample());
  test('Study split keeps every participant in exactly one partition', () => { const e = study.evaluation; assert(e.trainIds.every(id => !e.testIds.includes(id))); assert(e.trainSessions === 320); assert(e.testSessions === 80); assert(e.testParticipants === 16 && e.testIds.length === 16); });
  test('Study labels are learned and evaluation remains explicitly non-clinical', () => { const e = study.evaluation; assert(e.source === 'synthetic'); assert(e.clinicalValidation === false); assert(e.coverage > 0.9); assert(e.balancedAccuracy > 0.9); assert(e.macroF1 > 0.9); assert(e.binarySensitivity > 0.9); assert(e.binarySpecificity > 0.9); assert(study.model.levels.every((level, i) => level === i)); });
  test('Study rejects contradictory labels for one participant', () => { const data = HH.studyExample(); data.rows[1].severity = 3; let threw = false; try { HH.trainStudy(data); } catch (_) { threw = true; } assert(threw); });
  test('Study requires enough distinct participants, not just many rows', () => { const data = HH.studyExample(); data.rows.forEach(row => { row.participantId = 'same_' + row.severity; }); let threw = false; try { HH.trainStudy(data); } catch (_) { threw = true; } assert(threw); });
  test('Ambiguous training clusters abstain instead of inventing severity', () => { const m = { ...model, levels: [null, null, null, null] }; assert(HH.predict(m, HH.exampleReport(2)).status === 'unmapped'); });
  test('Adapted HTML is self-contained and excludes typed personal data', () => {
    const root = document.createElement('div'); root.innerHTML = '<form id="request-form"><input name="title" value="PRIVATE_TITLE"><textarea name="description">PRIVATE_DESCRIPTION</textarea></form><div class="precision-tasks">PRIVATE_TASK</div><ul id="requests-list"><li>PRIVATE_REQUEST</li><li>Example 1</li><li>Example 2</li></ul><span id="request-count">3</span><div id="request-feedback"></div>';
    const a = new HH.Adaptation(root); a.apply(2, true); const html = a.exportHTML(); assert(html.startsWith('<!doctype html>')); assert(html.includes('<style>')); assert(html.includes('data-hh-support="2"')); assert(!html.includes('PRIVATE_')); assert(!html.includes('src="js/'));
  });
  // Exercise the combined portal through its public controls.
  const frame = document.createElement('iframe'); frame.title = 'Portal integration fixture'; document.body.append(frame);
  async function load(url) {
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('App load timeout')), 10000); frame.onload = () => { clearTimeout(timeout); resolve(); }; frame.onerror = reject; frame.src = url; });
  }
  async function waitFor(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Timed out waiting for application state');
  }
  try {
    await load('../index.html?test=1');
    const d = frame.contentDocument, w = frame.contentWindow, get = id => d.getElementById(id);
    const action = (id, name) => get('requests-list').querySelector('[data-id="' + id + '"][data-action="' + name + '"]');
    test('One resident portal has no manual observation workflow', () => {
      assert(!get('start-session') && !get('pause-session') && !get('arm-schedule'));
      assert(!d.querySelector('.observation-card')); assert(d.documentElement.dataset.role === 'user');
      for (const el of d.querySelectorAll('[data-admin-only]')) assert(w.getComputedStyle(el).display === 'none');
      assert(get('services') && get('city-news') && get('comfort')); assert(!get('collection-consent').checked);
    });
    test('All service buttons fill the actual request form', () => {
      for (const el of d.querySelectorAll('[data-service]')) {
        el.click(); assert(get('request-form').elements.category.value);
        if (el.dataset.service !== 'other') assert(get('request-title').value.length > 0);
      }
    });
    test('Search and filters combine, and reset restores the list', () => {
      get('request-search').value = 'Освещение'; get('request-search').dispatchEvent(new w.Event('input'));
      assert(get('requests-list').children.length === 1);
      d.querySelector('[data-filter="done"]').click(); assert(!get('requests-empty').hidden);
      get('reset-filters').click(); assert(get('requests-list').children.length === 2);
      d.querySelector('[data-summary-filter="active"]').click(); assert(get('requests-list').children.length === 1);
      get('reset-filters').click();
    });
    test('Sorting changes request order', () => {
      const first = get('requests-list').firstElementChild.dataset.requestId; get('sort-requests').click();
      assert(first !== get('requests-list').firstElementChild.dataset.requestId); get('sort-requests').click();
    });
    test('Creating a request safely renders text and supports undo', () => {
      const title = '<img src=x onerror=alert(1)>';
      get('request-title').value = title; get('request-text').value = 'Учебное описание';
      get('request-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      assert(get('request-count').textContent === '3'); assert(!get('requests-list').querySelector('img'));
      assert(get('requests-list').firstElementChild.querySelector('strong').textContent === title);
      get('request-feedback').querySelector('button').click(); assert(get('request-count').textContent === '2');
      assert(get('request-title').value === title);
    });
    test('Favorites and status buttons update counters and filters', () => {
      action(1, 'favorite').click(); assert(get('favorite-requests').textContent === '1');
      d.querySelector('[data-filter="favorites"]').click(); assert(get('requests-list').children.length === 1);
      action(1, 'status').click(); assert(get('done-requests').textContent === '2');
      get('reset-filters').click(); action(1, 'status').click(); action(1, 'favorite').click();
      assert(get('favorite-requests').textContent === '0');
    });
    test('Request details and repeat use the selected request', () => {
      action(1, 'details').click(); assert(get('details-dialog').open);
      assert(get('details-description').textContent.includes('фонари')); get('details-dialog').close();
      action(1, 'repeat').click(); assert(get('request-title').value === 'Освещение на пешеходной дорожке');
      assert(get('request-text').value.includes('фонари'));
    });
    test('Deleting a request and undo preserve the item', () => {
      action(1, 'delete').click(); assert(get('request-count').textContent === '1');
      get('request-feedback').querySelector('button').click(); assert(get('request-count').textContent === '2'); assert(action(1, 'details'));
    });
    test('News, subscription, help, and form reset work', () => {
      d.querySelector('[data-news="park"]').click(); assert(get('details-dialog').open); assert(get('details-title').textContent.includes('дорожки')); get('details-dialog').close();
      get('subscribe-news').click(); assert(get('subscribe-news').getAttribute('aria-pressed') === 'true'); get('subscribe-news').click(); assert(get('subscribe-news').getAttribute('aria-pressed') === 'false');
      get('open-help').click(); assert(get('details-dialog').open); get('details-dialog').close();
      get('request-form').querySelector('[type="reset"]').click(); assert(get('request-title').value === '');
    });
    test('Local collection is automatic after consent and does not require a start button', () => {
      get('collection-consent').click(); assert(get('collection-status').textContent.includes('автоматически'));
      get('collection-consent').click(); assert(get('collection-status').textContent.includes('выключен'));
      assert(!get('demo-site').hasAttribute('data-hh-support'));
    });
    let now = 0, focused = true, visibility = 'visible';
    Object.defineProperty(w.performance, 'now', { value: () => now });
    Object.defineProperty(d, 'hasFocus', { value: () => focused });
    Object.defineProperty(d, 'visibilityState', { get: () => visibility });
    w.dispatchEvent(new w.Event('blur')); w.dispatchEvent(new w.Event('focus'));
    const activity = () => get('demo-site').dispatchEvent(new w.Event('pointermove'));
    activity(); now = 30000; activity(); visibility = 'hidden'; d.dispatchEvent(new w.Event('visibilitychange'));
    now = 90000; activity(); visibility = 'visible'; focused = false; d.dispatchEvent(new w.Event('visibilitychange'));
    now = 150000; activity();
    test('Background time does not trigger adaptation', () => { assert(!get('comfort-dialog').open); });
    focused = true; w.dispatchEvent(new w.Event('focus')); activity();
    for (const time of [180000, 210000, 239999]) { now = time; activity(); }
    test('No offer before two minutes of active use', () => { assert(!get('comfort-dialog').open); });
    get('open-help').click(); now = 240000; activity();
    test('Automatic offer waits until an existing dialog closes', () => { assert(get('details-dialog').open && !get('comfort-dialog').open); });
    get('details-dialog').close(); activity();
    test('Two minutes automatically offers adaptation without a manual start', () => { assert(get('comfort-dialog').open); assert(!get('demo-site').hasAttribute('data-hh-support')); });
    get('comfort-dialog').querySelector('[value="decline"]').click();
    await new Promise(resolve => w.setTimeout(resolve, 30)); now += 120000; activity();
    await new Promise(resolve => w.setTimeout(resolve, 1100));
    test('Declining leaves the site unchanged and does not repeat the popup', () => { assert(!get('comfort-dialog').open); assert(!get('demo-site').hasAttribute('data-hh-support')); });
    get('open-comfort').click(); get('comfort-level').value = '3'; get('accept-comfort').click();
    test('Adaptation increases new portal controls as well as the form', () => {
      assert(get('demo-site').dataset.hhSupport === '3');
      assert(w.getComputedStyle(get('request-title')).minHeight === '60px');
      assert(w.getComputedStyle(d.querySelector('[data-service]')).minHeight === '60px');
    });
    test('The complete portal fits desktop and narrow screens with adaptation', () => {
      for (const width of [1440, 768, 390, 320]) { frame.style.width = width + 'px'; assert(d.documentElement.scrollWidth <= d.documentElement.clientWidth, 'Adapted portal overflows at ' + width); }
      get('user-revert').click(); assert(!get('demo-site').hasAttribute('data-hh-support'));
      for (const width of [1440, 768, 390, 320]) { frame.style.width = width + 'px'; assert(d.documentElement.scrollWidth <= d.documentElement.clientWidth, 'Standard portal overflows at ' + width); }
    });
    get('collection-consent').click();
    await waitFor(() => w.HandHelper.statistics.state() === 'ready');
    d.querySelector('[data-service="lighting"]').click();
    get('request-text').value = 'Private test description';
    get('request-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await w.HandHelper.statistics.flush();
    await load('../index.html?test=1&role=admin');
    const ad = frame.contentDocument, aw = frame.contentWindow, ag = id => ad.getElementById(id);
    await waitFor(() => aw.HandHelper && aw.HandHelper.authReady);
    await aw.HandHelper.authReady;
    test('Administrator URL opens login without granting access', () => {
      assert(ad.documentElement.dataset.role === 'user'); assert(ag('admin-login-dialog').open);
      assert(aw.getComputedStyle(ag('admin-statistics')).display === 'none');
    });
    const anonymous = await aw.fetch('/api/admin/statistics');
    test('Anonymous browser cannot request administrator statistics', () => { assert(anonymous.status === 401); });
    ag('admin-password').value = 'wrong-test-password'; ag('submit-admin-login').click();
    await waitFor(() => ag('admin-login-error').textContent.length > 0);
    test('Wrong credentials keep administrator panels hidden', () => {
      assert(ad.documentElement.dataset.role === 'user'); assert(ag('admin-login-error').textContent.includes('Неверный'));
      assert(ag('admin-password').value === '');
    });
    if (window.__HH_TEST_ADMIN_PASSWORD) {
    ag('admin-password').value = window.__HH_TEST_ADMIN_PASSWORD; ag('submit-admin-login').click();
    await waitFor(() => ad.documentElement.dataset.role === 'admin');
    await waitFor(() => ag('statistics-recent').children.length > 0);
    test('Successful login shows real saved visitor statistics', () => {
      assert(!ag('admin-login-dialog').open && !ag('admin-logout-button').hidden);
      assert(Number(ad.querySelector('[data-statistic="sessions"]').textContent) >= 1);
      assert(Number(ad.querySelector('[data-statistic="requests"]').textContent) >= 1);
      assert(ag('statistics-trend').children.length === 7 && !ag('export-statistics').disabled);
    });
    test('Administrator uses the same portal with extra analytics, without manual starts', () => {
      assert(ad.documentElement.dataset.role === 'admin' && ag('services') && ag('city-news'));
      assert(!ag('start-session') && !ag('arm-schedule'));
      for (const el of ad.querySelectorAll('section[data-admin-only]')) assert(aw.getComputedStyle(el).display !== 'none');
      assert(aw.getComputedStyle(ag('comfort')).display !== 'none');
    });
    test('Live analytics and scenarios work without stopping collection', () => {
      ag('collection-consent').click(); ag('show-live-analysis').click(); assert(ag('result-title').textContent === 'Недостаточно данных');
      ad.querySelector('[data-scenario="3"]').click(); assert(!ag('adaptation-offer').hidden); assert(ag('apply-adaptation').disabled);
      ag('adaptation-consent').click(); ag('apply-adaptation').click(); assert(ag('demo-site').dataset.hhSupport === '3');
      ag('revert-adaptation').click(); assert(!ag('demo-site').hasAttribute('data-hh-support'));
    });
    const transfer = new aw.DataTransfer(); transfer.items.add(new aw.File([JSON.stringify(HH.studyExample())], 'study.json', { type: 'application/json' }));
    ag('training-file').files = transfer.files; ag('training-file').dispatchEvent(new aw.Event('change'));
    await new Promise(resolve => aw.setTimeout(resolve, 100));
    test('Model import still trains while the portal remains usable', () => { assert(ag('training-status').textContent.includes('16')); assert(!ag('export-evaluation').disabled); });
    const adapter = new HH.Adaptation(ag('demo-site')); adapter.apply(2, true);
    const exportFrame = document.createElement('iframe'); exportFrame.title = 'Standalone export fixture';
    const exported = new Promise(resolve => { exportFrame.onload = resolve; }); exportFrame.srcdoc = adapter.exportHTML(); document.body.append(exportFrame); await exported;
    test('Standalone export contains a working form without inactive portal controls or private requests', () => {
      const ed = exportFrame.contentDocument; assert(!ed.querySelector('[data-portal-only]') && !ed.getElementById('comfort'));
      const ef = ed.getElementById('request-form'); ef.elements.title.value = 'Standalone request'; ef.elements.description.value = 'Description'; ef.dispatchEvent(new Event('submit', { cancelable: true }));
      assert(ed.getElementById('request-count').textContent === '3');
    });
    exportFrame.remove(); adapter.revert();
    test('Deleting analytics clears consent and reports without deleting resident requests', () => { ag('delete-data').click(); assert(!ag('collection-consent').checked && ag('export-report').disabled); assert(ag('request-count').textContent === '2'); });
    ag('statistics-period').value = '30'; ag('statistics-period').dispatchEvent(new aw.Event('change'));
    await waitFor(() => ag('statistics-trend').children.length === 30);
    test('Statistics period switches the displayed series', () => { assert(ag('statistics-trend').children.length === 30); });
    test('Administrator dashboard fits narrow viewports', () => {
      for (const width of [1440, 768, 390, 320]) { frame.style.width = width + 'px'; assert(ad.documentElement.scrollWidth <= ad.documentElement.clientWidth, 'Dashboard overflows at ' + width); }
    });
    await load('../index.html?test=1');
    const restored = frame.contentWindow, rd = frame.contentDocument;
    await waitFor(() => restored.HandHelper && restored.HandHelper.authReady); await restored.HandHelper.authReady;
    test('Reload restores administrator role from the server session', () => { assert(rd.documentElement.dataset.role === 'admin'); });
    rd.getElementById('admin-logout-button').click();
    await waitFor(() => rd.documentElement.dataset.role === 'user');
    const loggedOut = await restored.fetch('/api/admin/statistics');
    test('Logout hides and clears statistics and removes server access', () => { assert(loggedOut.status === 401); assert(rd.getElementById('statistics-recent').children.length === 0); assert(!rd.getElementById('admin-login-button').hidden); });
    } else { skipped++; lines.push('SKIP authenticated administrator checks: run tests/Test-Server.ps1 -WithBrowser'); }
  } catch (error) { failed++; lines.push('FAIL portal integration: ' + error.message); }
  frame.remove();
  const passed = lines.length - failed - skipped;
  lines.push('\n' + passed + ' passed, ' + failed + ' failed');
  document.getElementById('results').textContent = lines.join('\n');
  document.body.dataset.testStatus = failed ? 'failed' : 'passed';
})();
