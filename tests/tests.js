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
  test('Unknown profiles abstain instead of forcing severe result', () => { const r = HH.exampleReport(0); r.features = { correctionRate: 0.9, repeatRate: 0.9, holdCV: 4, flightCV: 4, pathInefficiency: 15, backgroundClickRate: 0.9 }; assert(HH.predict(model, r).status === 'out_of_distribution'); });
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
  // Exercise the actual app through its public controls.
  const frame = document.createElement('iframe'); frame.src = '../index.html'; frame.title = 'App integration fixture'; document.body.append(frame);
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
  } catch (error) { failed++; lines.push('FAIL app integration: ' + error.message); }
  frame.remove();
  const passed = lines.length - failed;
  lines.push('\n' + passed + ' passed, ' + failed + ' failed');
  document.getElementById('results').textContent = lines.join('\n');
  document.body.dataset.testStatus = failed ? 'failed' : 'passed';
})();
