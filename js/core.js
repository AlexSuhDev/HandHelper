/* Pure numerical model. No DOM, network calls, or text content. */
(function (global) {
  'use strict';
  const FEATURES = ['correctionRate', 'repeatRate', 'holdCV', 'flightCV', 'pathInefficiency', 'backgroundClickRate', 'textErrorRate', 'targetMissRate'];
  const LIMITS = [[0, 1], [0, 1], [0, 5], [0, 5], [1, 20], [0, 1], [0, 1], [0, 1]];
  const LABELS = ['Обычный профиль взаимодействия', 'Небольшая потребность в поддержке', 'Заметная потребность в поддержке', 'Высокая потребность в поддержке'];
  class Moments {
    constructor() { this.n = 0; this.mean = 0; this.m2 = 0; }
    add(value) {
      if (!Number.isFinite(value)) return;
      this.n++;
      const delta = value - this.mean;
      this.mean += delta / this.n;
      this.m2 += delta * (value - this.mean);
    }
    get cv() { return this.n > 1 && this.mean > 0 ? Math.sqrt(this.m2 / (this.n - 1)) / this.mean : 0; }
  }
  class ActivityClock {
    constructor(durationMs = 3600000, idleMs = 30000) {
      this.durationMs = durationMs; this.idleMs = idleMs;
      this.activeMs = 0; this.lastTick = null; this.lastActivity = null; this.enabled = false;
    }
    tick(now) {
      if (this.enabled && this.lastTick !== null && this.lastActivity !== null) {
        this.activeMs = Math.min(this.durationMs, this.activeMs + Math.max(0, Math.min(now, this.lastActivity + this.idleMs) - this.lastTick));
      }
      this.lastTick = now;
      return this.activeMs;
    }
    activity(now) { this.tick(now); if (this.enabled) this.lastActivity = now; }
    setEnabled(enabled, now) { this.tick(now); this.enabled = enabled; this.lastActivity = null; this.lastTick = now; }
    get complete() { return this.activeMs >= this.durationMs; }
  }
  function vector(row) {
    return FEATURES.map((key, i) => {
      const value = row[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < LIMITS[i][0] || value > LIMITS[i][1]) throw new Error('Некорректный показатель: ' + key);
      return value;
    });
  }
  const distance2 = (a, b) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
  const nearest = (point, centers) => centers.reduce((best, center, i) => distance2(point, center) < distance2(point, centers[best]) ? i : best, 0);
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function fit(rows, { synthetic = false, seed = 42 } = {}) {
    if (!Array.isArray(rows) || rows.length < 80 || rows.length > 10000) throw new Error('Для обучения нужно от 80 до 10 000 независимых сессий.');
    const raw = rows.map(vector);
    const means = FEATURES.map((_, j) => raw.reduce((s, row) => s + row[j], 0) / raw.length);
    const scales = means.map((m, j) => Math.sqrt(raw.reduce((s, row) => s + (row[j] - m) ** 2, 0) / raw.length) || 1);
    const points = raw.map(row => row.map((v, j) => (v - means[j]) / scales[j]));
    if (new Set(points.map(p => JSON.stringify(p))).size < 4) throw new Error('Нужно минимум четыре различных профиля.');
    const random = rng(seed);
    let best = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      // k-means++ initialization; the labels have no intrinsic ordering.
      let centers = [points[Math.floor(random() * points.length)].slice()];
      while (centers.length < 4) {
        const weights = points.map(point => Math.min(...centers.map(c => distance2(point, c))));
        let target = random() * weights.reduce((s, v) => s + v, 0);
        let chosen = weights.findIndex(w => (target -= w) < 0);
        if (chosen < 0) chosen = weights.indexOf(Math.max(...weights));
        centers.push(points[chosen].slice());
      }
      for (let iteration = 0; iteration < 100; iteration++) {
        const groups = centers.map(() => []);
        points.forEach(p => groups[nearest(p, centers)].push(p));
        const next = groups.map(group => group.length ? FEATURES.map((_, j) => group.reduce((s, p) => s + p[j], 0) / group.length) : points[Math.floor(random() * points.length)].slice());
        const change = centers.reduce((s, c, i) => s + distance2(c, next[i]), 0);
        centers = next;
        if (change < 1e-8) break;
      }
      const inertia = points.reduce((s, p) => s + distance2(p, centers[nearest(p, centers)]), 0);
      if (!best || inertia < best.inertia) best = { centers, inertia };
    }
    // Explicit engineering interpretation: equal weights on standardized features.
    // This ordering is a support heuristic, never a clinical severity scale.
    const centers = best.centers.slice().sort((a, b) => a.reduce((s, v) => s + v, 0) - b.reduce((s, v) => s + v, 0));
    const radii = centers.map((c, i) => {
      const ds = points.filter(p => nearest(p, centers) === i).map(p => Math.sqrt(distance2(p, c))).sort((a, b) => a - b);
      return Math.max(1, (ds[Math.floor((ds.length - 1) * 0.95)] || 0) * 1.75);
    });
    return { version: 2, features: FEATURES.slice(), synthetic, sampleCount: rows.length, means, scales, centers, radii, inertia: best.inertia };
  }
  function quality(report) {
    const problems = [];
    if (!report || !report.counts || !report.features) return ['Нет отчёта с показателями.'];
    if (!Number.isFinite(report.activeSeconds) || report.activeSeconds < 3600) problems.push('Нужен час активной работы.');
    const minimum = { keydowns: 200, holds: 100, flights: 100, clicks: 30, routes: 20, textTasks: 3, targetAttempts: 10 };
    const names = { keydowns: 'нажатий клавиш', holds: 'удержаний клавиш', flights: 'интервалов набора', clicks: 'кликов мышью', routes: 'маршрутов мыши', textTasks: 'проверок текста по образцу', targetAttempts: 'попыток выбора заданной цели' };
    for (const [key, min] of Object.entries(minimum)) {
      const n = report.counts[key];
      if (!Number.isInteger(n) || n < min) problems.push('Недостаточно ' + names[key] + ': ' + (Number.isInteger(n) && n >= 0 ? n : 0) + ' / ' + min + '.');
    }
    try { vector(report.features); } catch (error) { problems.push(error.message); }
    return problems;
  }
  function predict(model, report) {
    const problems = quality(report);
    if (problems.length) return { status: 'insufficient', problems, level: null, label: 'Недостаточно данных' };
    const point = vector(report.features).map((v, j) => (v - model.means[j]) / model.scales[j]);
    const cluster = nearest(point, model.centers);
    const distance = Math.sqrt(distance2(point, model.centers[cluster]));
    if (distance > model.radii[cluster]) return { status: 'out_of_distribution', level: null, label: 'Профиль вне обучающей выборки', distance, synthetic: model.synthetic };
    const level = model.levels ? model.levels[cluster] : cluster;
    if (level === null) return { status: 'unmapped', level: null, label: 'Кластер без однозначной интерпретации', synthetic: model.synthetic };
    return { status: 'ok', level, cluster, label: LABELS[level], distance, synthetic: model.synthetic, sampleCount: model.sampleCount, interpretation: model.levels ? 'reference_labels' : 'heuristic' };
  }
  const PROTOTYPES = [
    [0.025, 0.008, 0.22, 0.32, 1.12, 0.03, 0.015, 0.02],
    [0.095, 0.035, 0.48, 0.62, 1.70, 0.12, 0.08, 0.12],
    [0.20, 0.09, 0.82, 0.98, 2.70, 0.26, 0.18, 0.28],
    [0.34, 0.18, 1.28, 1.48, 4.30, 0.44, 0.32, 0.45]
  ];
  function syntheticRows() {
    const random = rng(314159);
    return PROTOTYPES.flatMap(center => Array.from({ length: 100 }, () => Object.fromEntries(FEATURES.map((key, j) => {
      const spread = [0.028, 0.015, 0.12, 0.14, 0.3, 0.045, 0.025, 0.03][j];
      return [key, Math.min(LIMITS[j][1], Math.max(LIMITS[j][0], center[j] + (random() + random() + random() - 1.5) * spread))];
    }))));
  }
  function exampleReport(level) {
    if (!Number.isInteger(level) || level < 0 || level > 3) throw new Error('Неизвестный сценарий.');
    return { version: 2, source: 'synthetic', activeSeconds: 3600, counts: { keydowns: 820, holds: 810, flights: 790, clicks: 120, routes: 90, textTasks: 6, targetAttempts: 30 }, features: Object.fromEntries(FEATURES.map((key, j) => [key, PROTOTYPES[level][j]])) };
  }
  function textError(reference, typed) {
    const a = Array.from(reference.normalize('NFC')), b = Array.from(typed.normalize('NFC'));
    if (!a.length || a.length > 500 || b.length > 500) throw new Error('Образец и ответ должны содержать не более 500 символов; образец не пустой.');
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = row;
    }
    return { edits: previous[b.length], referenceLength: a.length, rate: Math.min(1, previous[b.length] / a.length) };
  }
  function validateModel(model) {
    const fail = () => { throw new Error('Некорректная или несовместимая модель (нужна версия 2, восемь признаков).'); };
    if (!model || model.version !== 2 || JSON.stringify(model.features) !== JSON.stringify(FEATURES) || typeof model.synthetic !== 'boolean' || !Number.isInteger(model.sampleCount) || model.sampleCount < 80) fail();
    const numeric = (values, n) => Array.isArray(values) && values.length === n && values.every(Number.isFinite);
    if (!numeric(model.means, 8) || !numeric(model.scales, 8) || model.scales.some(x => x <= 0) || !numeric(model.radii, 4) || model.radii.some(x => x <= 0) || !Array.isArray(model.centers) || model.centers.length !== 4 || !model.centers.every(c => numeric(c, 8))) fail();
    if (model.levels && (!Array.isArray(model.levels) || model.levels.length !== 4 || model.levels.some(x => x !== null && ![0, 1, 2, 3].includes(x)))) fail();
    return JSON.parse(JSON.stringify(model));
  }
  global.HandHelper = { FEATURES, LABELS, Moments, ActivityClock, fit, predict, quality, syntheticRows, exampleReport, textError, validateModel, vector, nearest, distance2, rng };
})(globalThis);
