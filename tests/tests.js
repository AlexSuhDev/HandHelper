(async function () {
  'use strict';
  const HH = globalThis.HandHelper;
  const lines = []; let failed = 0;
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
  // Exercise the actual app through its public controls.
  const frame = document.createElement('iframe'); frame.src = '../index.html?test=1'; frame.title = 'App integration fixture'; document.body.append(frame);
  try {
    await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = () => reject(new Error('Cannot load app')); setTimeout(() => reject(new Error('App load timeout')), 10000); });
    const d = frame.contentDocument; const get = id => d.getElementById(id);
    test('App starts with consent gates closed and site unchanged', () => { assert(get('start-session').disabled); assert(get('adaptation-offer').hidden); assert(!get('demo-site').hasAttribute('data-hh-support')); });
    test('Normal demo never offers adaptation', () => { d.querySelector('[data-scenario="0"]').click(); assert(get('adaptation-offer').hidden); assert(get('result-title').textContent.includes('Обычный')); assert(!get('demo-site').hasAttribute('data-hh-support')); });
    test('Severe demo requires consent, applies and reverts adaptation', () => { d.querySelector('[data-scenario="3"]').click(); assert(!get('adaptation-offer').hidden); assert(get('apply-adaptation').disabled); get('adaptation-consent').click(); assert(!get('apply-adaptation').disabled); get('apply-adaptation').click(); assert(get('demo-site').dataset.hhSupport === '3'); get('revert-adaptation').click(); assert(!get('demo-site').hasAttribute('data-hh-support')); });
    test('Revoking adaptation consent restores the original interface', () => { get('adaptation-consent').click(); get('apply-adaptation').click(); assert(get('demo-site').dataset.hhSupport === '3'); get('adaptation-consent').click(); assert(!get('demo-site').hasAttribute('data-hh-support')); });
    test('Start, pause, finish early and delete follow consent', () => { get('collection-consent').click(); get('start-session').click(); assert(get('start-session').disabled); assert(d.querySelector('[data-scenario="2"]').disabled); get('pause-session').click(); assert(get('pause-session').textContent === 'Продолжить'); get('finish-session').click(); assert(get('result-title').textContent === 'Недостаточно данных'); assert(get('adaptation-offer').hidden); get('delete-data').click(); assert(!get('collection-consent').checked); assert(get('export-report').disabled); });
    test('Local request form safely renders user text and supports undo', () => { const title = '<img src=x onerror=alert(1)>'; get('request-title').value = title; get('request-text').value = 'Учебное описание'; get('request-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); assert(get('request-count').textContent === '3'); assert(get('requests-list').firstElementChild.querySelector('strong').textContent === title); assert(!get('requests-list').querySelector('img')); get('request-feedback').querySelector('button').click(); assert(get('request-count').textContent === '2'); assert(get('request-title').value === title); });
    test('Collection revocation clears result and adaptation', () => { d.querySelector('[data-scenario="2"]').click(); get('adaptation-consent').click(); get('apply-adaptation').click(); get('collection-consent').click(); get('collection-consent').click(); assert(get('data-source').textContent === 'Нет данных'); assert(!get('demo-site').hasAttribute('data-hh-support')); assert(get('export-report').disabled); });
    test('Standard interface fits desktop and narrow viewports', () => {
      for (const width of [1440, 768, 390, 320]) {
        frame.style.width = width + 'px';
        const viewport = d.documentElement.clientWidth;
        assert(d.documentElement.scrollWidth <= viewport, width + 'px viewport overflows: ' + d.documentElement.scrollWidth + ' > ' + viewport);
      }
    });
    test('Highest adaptation remains usable in a narrow viewport', () => {
      frame.style.width = '390px'; d.querySelector('[data-scenario="3"]').click(); get('adaptation-consent').click(); get('apply-adaptation').click();
      assert(d.documentElement.scrollWidth <= d.documentElement.clientWidth, 'Adapted page overflows');
      assert(frame.contentWindow.getComputedStyle(get('request-title')).minHeight === '60px');
      assert(frame.contentWindow.getComputedStyle(get('request-title')).fontSize === '18px');
    });
    test('Scheduled collection cannot be armed without collection consent', () => { get('delete-data').click(); assert(get('arm-schedule').disabled); get('collection-consent').click(); assert(!get('arm-schedule').disabled); });
    test('Actual schedule UI locks conflicting starts and supports cancellation', () => {
      const localValue = ms => { const date = new Date(ms); return new Date(ms - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
      get('window-start').value = localValue(Date.now() + 180000); get('window-end').value = localValue(Date.now() + 7200000); get('arm-schedule').click();
      assert(!get('cancel-schedule').hidden); assert(get('start-session').disabled); assert(d.querySelector('[data-scenario="0"]').disabled); get('cancel-schedule').click(); assert(get('cancel-schedule').hidden); assert(!get('start-session').disabled);
    });
    test('Persistent save and revocation work through the actual app', () => { get('storage-consent').click(); get('start-session').click(); const saved = JSON.parse(frame.contentWindow.localStorage.getItem('handhelper.test.v2')); assert(saved.version === 2); assert(saved.wasRunning); get('storage-consent').click(); assert(frame.contentWindow.localStorage.getItem('handhelper.test.v2') === null); get('delete-data').click(); });
    // Reload the application with a saved numeric session. Consent toggles must not overwrite it.
    const checkpoint = new HH.Collector(document.getElementById('fixture')).checkpoint(); checkpoint.activeMs = 123450;
    frame.contentWindow.localStorage.setItem('handhelper.test.v2', JSON.stringify({ version: 2, checkpoint, model, wasRunning: true, windowEnd: null }));
    await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; frame.src = '../index.html?test=1&reload=1'; });
    const restored = frame.contentDocument; const rg = id => restored.getElementById(id);
    test('Reload never silently resumes collection and preserves the saved checkpoint', () => { assert(!rg('restore-session').hidden); assert(!rg('collection-consent').checked); assert(rg('pause-session').disabled); rg('collection-consent').click(); rg('storage-consent').click(); assert(JSON.parse(frame.contentWindow.localStorage.getItem('handhelper.test.v2')).checkpoint.activeMs === 123450); rg('restore-session').click(); assert(rg('session-timer').textContent.startsWith('02:03')); assert(!rg('pause-session').disabled); rg('delete-data').click(); });
    test('Returning from browser history requires renewed collection consent', () => { rg('collection-consent').click(); rg('start-session').click(); frame.contentWindow.dispatchEvent(new frame.contentWindow.PageTransitionEvent('pageshow', { persisted: true })); assert(!rg('collection-consent').checked); assert(rg('pause-session').disabled); assert(rg('start-session').disabled); rg('delete-data').click(); });
    const adapter = new HH.Adaptation(rg('demo-site')); adapter.apply(2, true);
    const exportFrame = document.createElement('iframe'); exportFrame.title = 'Standalone export fixture';
    const loaded = new Promise((resolve, reject) => { exportFrame.onload = resolve; exportFrame.onerror = reject; });
    exportFrame.srcdoc = adapter.exportHTML(); document.body.append(exportFrame); await loaded;
    test('Exported standalone HTML retains a working local request form', () => {
      const ed = exportFrame.contentDocument, form = ed.getElementById('request-form'); form.elements.title.value = 'Standalone test'; form.elements.description.value = 'No server';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); assert(ed.getElementById('request-count').textContent === '3'); assert(ed.getElementById('requests-list').firstElementChild.textContent.includes('Standalone test')); assert(!ed.querySelector('script[src]')); assert(!ed.querySelector('.precision-tasks'));
    });
    exportFrame.remove(); adapter.revert();
  } catch (error) { failed++; lines.push('FAIL app integration: ' + error.message); }
  frame.remove();
  const passed = lines.length - failed;
  lines.push('\n' + passed + ' passed, ' + failed + ' failed');
  document.getElementById('results').textContent = lines.join('\n');
  document.body.dataset.testStatus = failed ? 'failed' : 'passed';
})();
