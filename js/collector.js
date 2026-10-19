(function (global) {
  'use strict';
  const { Moments, ActivityClock } = global.HandHelper;
  const CLICKABLE = 'button, a[href], input, textarea, select, label, [role="button"]';
  class Collector {
    constructor(root, onComplete = () => {}) {
      if (!(root instanceof Element)) throw new Error('Нужен корневой элемент сайта.');
      this.root = root; this.onComplete = onComplete;
      this.reset();
    }
    reset() {
      this.clock = new ActivityClock();
      this.counts = { keydowns: 0, repeats: 0, corrections: 0, insertions: 0, clicks: 0, backgroundClicks: 0, routes: 0, textTasks: 0, textEdits: 0, referenceCharacters: 0, targetAttempts: 0, targetMisses: 0 };
      this.holds = new Moments(); this.flights = new Moments(); this.paths = new Moments();
      this.keys = new Map(); this.lastDown = null; this.route = null; this.lastMove = -Infinity;
      this.running = false; this.paused = false; this.completed = false; this.composing = false;
      this.deadline = null; this.endReason = null;
    }
    start(checkpoint = null) {
      if (this.running) return;
      this.reset();
      if (checkpoint) this.restore(checkpoint);
      this.running = true;
      this.abort = new AbortController();
      const bind = (node, name, fn) => node.addEventListener(name, fn.bind(this), { capture: true, signal: this.abort.signal });
      bind(this.root, 'keydown', this.onKeyDown); bind(this.root, 'keyup', this.onKeyUp);
      bind(this.root, 'beforeinput', this.onBeforeInput);
      bind(this.root, 'pointermove', this.onMove); bind(this.root, 'click', this.onClick);
      bind(this.root, 'compositionstart', function () { this.composing = true; this.clearTransient(); });
      bind(this.root, 'compositionend', function () { this.composing = false; this.clearTransient(); });
      bind(this.root, 'focusout', this.clearTransient);
      bind(document, 'visibilitychange', this.syncClock);
      bind(window, 'blur', this.syncClock); bind(window, 'focus', this.syncClock);
      this.syncClock();
      this.timer = setInterval(() => this.tick(), 250);
    }
    clearTransient() { this.keys.clear(); this.lastDown = null; this.route = null; }
    clockNow() {
      const now = performance.now();
      return this.deadline === null ? now : Math.min(now, now + this.deadline - Date.now());
    }
    syncClock() {
      this.clearTransient();
      this.clock.setEnabled(this.running && !this.paused && document.visibilityState === 'visible' && document.hasFocus(), this.clockNow());
    }
    pause(paused) { if (!this.running) return; this.paused = paused; this.syncClock(); }
    stop() {
      if (!this.running) return;
      this.clock.setEnabled(false, this.clockNow());
      this.running = false; this.abort.abort(); clearInterval(this.timer); this.clearTransient();
    }
    tick() {
      if (!this.running) return;
      this.clock.tick(this.clockNow());
      if (this.clock.complete && !this.completed) { this.completed = true; this.stop(); this.onComplete(this.report()); }
      else if (this.deadline !== null && Date.now() >= this.deadline) { this.endReason = 'window_ended'; this.stop(); this.onComplete(this.report()); }
    }
    accept(event) {
      this.tick();
      return this.running && !this.paused && this.clock.enabled && event.isTrusted && event.target instanceof Element && this.root.contains(event.target) && !event.target.closest('[data-hh-private], input[type="password"], [autocomplete="one-time-code"], [autocomplete^="cc-"]');
    }
    isText(target) {
      return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ['text', 'search'].includes(target.type)) || target.isContentEditable;
    }
    onKeyDown(event) {
      if (!this.accept(event) || !this.isText(event.target) || this.composing || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      // Only ephemeral key codes match press/release. They are never exported.
      if (!(event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key)) || !event.code) return;
      const now = performance.now(); this.clock.activity(now);
      this.counts.keydowns++;
      if (event.repeat) { this.counts.repeats++; return; }
      if (this.lastDown !== null && now - this.lastDown > 0 && now - this.lastDown <= 2000) this.flights.add(now - this.lastDown);
      this.lastDown = now;
      this.keys.set(event.code, now);
    }
    onKeyUp(event) {
      if (!this.accept(event)) return;
      const start = this.keys.get(event.code);
      if (start !== undefined) {
        const duration = performance.now() - start;
        if (duration > 0 && duration <= 3000) this.holds.add(duration);
        this.keys.delete(event.code);
      }
    }
    onBeforeInput(event) {
      if (!this.accept(event) || !this.isText(event.target) || this.composing || event.isComposing) return;
      this.clock.activity(performance.now());
      // No access to event.data, field.value, selected text, or clipboard.
      if (['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) this.counts.corrections++;
      if (event.inputType === 'insertText') this.counts.insertions++;
    }
    onMove(event) {
      if (!this.accept(event) || event.pointerType !== 'mouse') return;
      const now = performance.now(); this.clock.activity(now);
      if (now - this.lastMove < 50) return;
      this.lastMove = now;
      const point = { x: event.clientX, y: event.clientY, time: now };
      if (!this.route || now - this.route.last.time > 2000) this.route = { first: point, last: point, length: 0, samples: 1 };
      else {
        this.route.length += Math.hypot(point.x - this.route.last.x, point.y - this.route.last.y);
        this.route.last = point; this.route.samples++;
      }
    }
    onClick(event) {
      // detail=0 is keyboard/assistive activation. Do not mix it with mouse use.
      if (!this.accept(event) || event.detail === 0 || event.button !== 0 || (event.pointerType && event.pointerType !== 'mouse')) return;
      const now = performance.now(); this.clock.activity(now);
      this.counts.clicks++;
      if (!event.target.closest(CLICKABLE)) this.counts.backgroundClicks++;
      if (this.route && this.route.samples >= 3 && now - this.route.last.time < 2000) {
        const endLength = Math.hypot(event.clientX - this.route.last.x, event.clientY - this.route.last.y);
        const direct = Math.hypot(event.clientX - this.route.first.x, event.clientY - this.route.first.y);
        if (direct >= 20) {
          this.paths.add(Math.min(20, Math.max(1, (this.route.length + endLength) / direct)));
          this.counts.routes++;
        }
      }
      this.route = null;
    }
    recordTextTask(reference, typed, event) {
      if (!this.accept(event)) return null;
      const result = global.HandHelper.textError(reference, typed);
      this.counts.textTasks++; this.counts.textEdits += result.edits; this.counts.referenceCharacters += result.referenceLength;
      this.clock.activity(performance.now());
      return result;
    }
    recordTarget(hit, event) {
      if (!this.accept(event) || event.detail === 0 || event.button !== 0 || (event.pointerType && event.pointerType !== 'mouse')) return false;
      this.counts.targetAttempts++; if (!hit) this.counts.targetMisses++;
      this.clock.activity(performance.now()); return true;
    }
    checkpoint() {
      this.clock.tick(this.clockNow());
      return { version: 2, activeMs: this.clock.activeMs, counts: { ...this.counts }, moments: Object.fromEntries(['holds', 'flights', 'paths'].map(key => [key, { n: this[key].n, mean: this[key].mean, m2: this[key].m2 }])) };
    }
    restore(data) {
      if (!data || data.version !== 2 || !Number.isFinite(data.activeMs) || data.activeMs < 0 || data.activeMs > 3600000 || !data.counts || !data.moments) throw new Error('Повреждённый сохранённый сеанс.');
      const counts = {};
      for (const key of Object.keys(this.counts)) {
        const value = data.counts[key];
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Некорректный счётчик: ' + key);
        counts[key] = value;
      }
      const moments = {};
      for (const key of ['holds', 'flights', 'paths']) {
        const value = data.moments[key];
        if (!value || !Number.isSafeInteger(value.n) || value.n < 0 || !Number.isFinite(value.mean) || value.mean < 0 || !Number.isFinite(value.m2) || value.m2 < 0) throw new Error('Некорректная статистика: ' + key);
        moments[key] = Object.assign(new Moments(), { n: value.n, mean: value.mean, m2: value.m2 });
      }
      if (counts.repeats > counts.keydowns || counts.backgroundClicks > counts.clicks || counts.targetMisses > counts.targetAttempts || counts.referenceCharacters < counts.textTasks || moments.holds.n > counts.keydowns || moments.paths.n !== counts.routes) throw new Error('Несогласованные счётчики.');
      this.clock.activeMs = data.activeMs; this.counts = counts;
      Object.assign(this, moments); this.clearTransient();
    }
    report() {
      this.clock.tick(this.clockNow());
      return {
        version: 2, source: 'observation', activeSeconds: Math.floor(this.clock.activeMs / 1000),
        counts: { ...this.counts, holds: this.holds.n, flights: this.flights.n },
        features: {
          correctionRate: this.counts.corrections / Math.max(1, this.counts.corrections + this.counts.insertions),
          repeatRate: this.counts.repeats / Math.max(1, this.counts.keydowns),
          holdCV: Math.min(5, this.holds.cv), flightCV: Math.min(5, this.flights.cv),
          pathInefficiency: this.paths.n ? this.paths.mean : 1,
          backgroundClickRate: this.counts.backgroundClicks / Math.max(1, this.counts.clicks),
          textErrorRate: Math.min(1, this.counts.textEdits / Math.max(1, this.counts.referenceCharacters)),
          targetMissRate: this.counts.targetMisses / Math.max(1, this.counts.targetAttempts)
        }
      };
    }
  }
  global.HandHelper.Collector = Collector;
})(globalThis);
