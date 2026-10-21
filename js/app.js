(function () {
  'use strict';
  const HH = window.HandHelper;
  const $ = id => document.getElementById(id);
  let isAdmin = document.documentElement.dataset.role === 'admin';
  const comfortClock = new HH.ActivityClock(120000);
  let comfortHandled = false;
  let comfortTrigger = null;
  const demoModel = HH.fit(HH.syntheticRows(), { synthetic: true });
  let model = demoModel;
  let report = null;
  let result = null;
  let resultModel = null;
  let messageTimer;

  let importGeneration = 0;
  let evaluation = null;

  const adaptation = new HH.Adaptation($('demo-site'));
  const collector = new HH.Collector($('demo-site'), data => { report = data; analyze(); updateControls(); });
  HH.statistics.setProvider(() => collector.report());
  function announce(text) {
    clearTimeout(messageTimer); $('app-message').textContent = text;
    messageTimer = setTimeout(() => { $('app-message').textContent = ''; }, 7000);
  }
  function updateControls() {
    $('collection-status').textContent = collector.running ? 'Локальный анализ включён автоматически. Снимите согласие, чтобы остановить его и удалить показатели.' : collector.completed ? 'Локальный анализ завершён. Настройки интерфейса доступны всегда.' : 'Сбор показателей выключен. Настройки интерфейса доступны всегда.';
    $('export-evaluation').disabled = !evaluation;
    $('export-participant').disabled = !report || report.source !== 'observation' || HH.quality(report).length > 0;
    $('export-report').disabled = !report;
    $('apply-adaptation').disabled = !$('adaptation-consent').checked || !result || result.status !== 'ok' || result.level === 0;
    const statisticsState = HH.statistics.state();
    const messages = { connecting: ' Подключаем статистику сайта…', ready: ' Числовые показатели сохраняются для администратора.', error: ' Статистика временно не сохраняется: сервер недоступен.', offline: ' Для сохранения статистики запустите сайт через локальный сервер.', deleting: ' Удаляем числовой сеанс с сервера…', 'delete-error': ' Не удалось удалить числовой сеанс с сервера. Повторите удаление.' };
    $('collection-status').textContent += messages[statisticsState] || '';
    $('retry-statistics-deletion').hidden = statisticsState !== 'delete-error';
  }
  function renderMetrics(data) {
    const f = data && data.features;
    const items = [
      ['corrections', 'correctionRate', 1, v => (v * 100).toFixed(1) + '%'],
      ['repeats', 'repeatRate', 1, v => (v * 100).toFixed(1) + '%'],
      ['holds', 'holdCV', 2, v => v.toFixed(2)],
      ['flights', 'flightCV', 2, v => v.toFixed(2)],
      ['paths', 'pathInefficiency', 6, v => v.toFixed(2) + '×'],
      ['background', 'backgroundClickRate', 1, v => (v * 100).toFixed(1) + '%'],
      ['text', 'textErrorRate', 1, v => (v * 100).toFixed(1) + '%'],
      ['target', 'targetMissRate', 1, v => (v * 100).toFixed(1) + '%']
    ];
    for (const [id, key, max, format] of items) {
      const missing = !f || (key === 'holdCV' && data.counts.holds < 2) || (key === 'flightCV' && data.counts.flights < 2) || (key === 'pathInefficiency' && data.counts.routes === 0) || (key === 'backgroundClickRate' && data.counts.clicks === 0) || (key === 'textErrorRate' && !data.counts.textTasks) || (key === 'targetMissRate' && !data.counts.targetAttempts) || (['correctionRate', 'repeatRate'].includes(key) && data.counts.keydowns === 0);
      $('metric-' + id).textContent = missing ? '—' : format(f[key]);
      $('bar-' + id).style.width = missing ? '0%' : Math.min(100, f[key] / max * 100) + '%';
    }
  }
  function revert() {
    adaptation.revert(); $('adaptation-badge').textContent = 'Стандартный интерфейс';
    $('revert-adaptation').hidden = true;
    $('export-adapted-site').hidden = true;
    $('user-revert').hidden = true;
  }
  function clearResult(preserveAdaptation = true) {
    result = null; resultModel = null;
    if (!preserveAdaptation) revert();
    $('result-title').textContent = 'Сначала — немного данных';
    $('result-description').textContent = 'Показатели появляются во время обычной работы с сервисами, если разрешён локальный анализ.';
    $('result-icon').textContent = '⌁';
    $('adaptation-offer').hidden = true; $('adaptation-consent').checked = false;
    $('quality-problems').replaceChildren(); $('quality-problems').hidden = true;
  }
  function analyze() {
    clearResult();
    resultModel = report.source === 'synthetic' ? demoModel : model;
    result = HH.predict(resultModel, report);
    $('result-title').textContent = result.label;
    $('data-source').textContent = report.source === 'synthetic' ? 'Синтетический сценарий' : 'Реальное наблюдение';
    if (result.status === 'insufficient') {
      $('result-description').textContent = 'Данных пока недостаточно для вывода модели. Продолжайте пользоваться сайтом или настройте интерфейс самостоятельно.';
      $('quality-problems').hidden = false;
      result.problems.forEach(problem => { const li = document.createElement('li'); li.textContent = problem; $('quality-problems').append(li); });
    } else if (result.status === 'out_of_distribution' || result.status === 'unmapped') {
      $('result-icon').textContent = '?';
      $('result-description').textContent = result.status === 'unmapped' ? 'У кластера нет однозначного соответствия независимым меткам. Адаптация не предлагается.' : 'Показатели слишком далеко от обучающих примеров. Нельзя надёжно выбрать профиль, поэтому адаптация не предлагается.';
    } else {
      $('result-icon').textContent = result.level === 0 ? '✓' : '↗';
      const origin = resultModel.synthetic ? 'Демонстрационная модель на синтетических данных. ' : 'Модель на импортированной выборке; клиническая валидация не подтверждена. ';
      $('result-description').textContent = origin + (result.level === 0 ? 'Профиль соответствует кластеру с наименьшей потребностью в поддержке. Адаптация не требуется; это не подтверждение отсутствия нарушений.' : 'Обнаружено сходство с кластером повышенной потребности в поддержке. Можно попробовать предложенный вариант интерфейса.');
      if (result.level > 0) {
        $('adaptation-offer').hidden = false;
        $('adaptation-description').textContent = [null, 'Уровень 1: элементы от 44 px, более крупный текст и увеличенные интервалы.', 'Уровень 2: элементы от 52 px, текст 16 px и расположение вариантов в одну колонку.', 'Уровень 3: элементы от 60 px, текст 18 px, одна колонка и отключение анимаций внутри сайта.'][result.level];
      }
    }
    renderMetrics(report); updateControls();
  }
  $('collection-consent').addEventListener('change', () => {
    if ($('collection-consent').checked) collector.start();
    else {
      collector.stop(); collector.reset();
      if (report && report.source === 'observation') { report = null; clearResult(); renderMetrics(null); $('data-source').textContent = 'Нет данных'; }
    }
    HH.statistics.consent($('collection-consent').checked);
    updateControls();
  });
  window.addEventListener('hh:statistics', updateControls);
  $('retry-statistics-deletion').addEventListener('click', HH.statistics.retryDeletion);
  window.addEventListener('hh:rolechange', event => { isAdmin = event.detail.isAdmin; syncComfortClock(); });
  setInterval(() => {
    if (isAdmin && collector.running && (!report || report.source !== 'synthetic')) {
      report = collector.report(); renderMetrics(report);
      $('data-source').textContent = 'Работа с сайтом'; updateControls();
    }
  }, 1000);
  function applySupport(level) {
    adaptation.apply(level, true);
    HH.statistics.record('level' + level);
    $('adaptation-badge').textContent = 'Адаптация · уровень ' + level;
    $('revert-adaptation').hidden = false;
    $('export-adapted-site').hidden = false;
    $('user-revert').hidden = false;
    announce(isAdmin ? 'Адаптация уровня ' + level + ' применена. Её можно отменить в разделе анализа.' : 'Адаптация применена. Стандартный вид можно вернуть в настройках интерфейса.');
  }
  let comfortAutomatic = false;
  function openComfort(automatic = false) {
    if ($('comfort-dialog').open) return;
    comfortHandled = true;
    comfortAutomatic = automatic === true;
    if (comfortAutomatic) HH.statistics.record('offerShown');
    comfortTrigger = document.activeElement;
    $('comfort-level').value = String(adaptation.level || 1);
    $('comfort-dialog').returnValue = '';
    $('comfort-dialog').showModal();
  }
  function syncComfortClock() {
    const enabled = !isAdmin && document.visibilityState === 'visible' && document.hasFocus();
    if (comfortClock.enabled !== enabled) comfortClock.setEnabled(enabled, performance.now());
  }
  function updateComfort() {
    if (isAdmin || comfortHandled) return;
    syncComfortClock();
    comfortClock.tick(performance.now());
    if (comfortClock.complete && !document.querySelector('dialog[open]')) openComfort(true);
  }
  // Only elapsed active time is used for this offer, independently of collection consent.
  // No keyboard/mouse samples or inferred support levels are needed to try an interface.
  ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel'].forEach(type => {
    $('demo-site').addEventListener(type, () => {
      if (isAdmin || comfortHandled) return;
      syncComfortClock();
      comfortClock.activity(performance.now());
      updateComfort();
    }, { passive: true });
  });
  document.addEventListener('visibilitychange', syncComfortClock);
  window.addEventListener('focus', syncComfortClock);
  window.addEventListener('blur', () => comfortClock.setEnabled(false, performance.now()));
  syncComfortClock();
  setInterval(updateComfort, 1000);
  $('open-comfort').addEventListener('click', openComfort);
  $('comfort-dialog').querySelector('form').addEventListener('submit', event => {
    if (event.submitter && event.submitter.value === 'accept') {
      applySupport(Number($('comfort-level').value));
      if (comfortAutomatic) HH.statistics.record('offerAccepted');
    }
  });
  $('comfort-dialog').addEventListener('close', () => {
    if (comfortAutomatic && $('comfort-dialog').returnValue !== 'accept') HH.statistics.record('offerDeclined');
    HH.statistics.flush(); comfortAutomatic = false;
    if (comfortTrigger && comfortTrigger.isConnected) comfortTrigger.focus({ preventScroll: true });
  });
  $('user-revert').addEventListener('click', () => {
    revert(); $('adaptation-consent').checked = false;
    updateControls(); announce('Восстановлен стандартный интерфейс.');
  });
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
    report = HH.exampleReport(Number(button.dataset.scenario)); analyze();
    announce('Показан синтетический сценарий. Адаптация потребует отдельного согласия.');
    $('analysis').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }));
  $('adaptation-consent').addEventListener('change', () => {
    if (!$('adaptation-consent').checked && adaptation.level > 0) { revert(); announce('Согласие на адаптацию отозвано. Восстановлен стандартный интерфейс.'); }
    updateControls();
  });
  $('apply-adaptation').addEventListener('click', () => {
    if (!result || result.status !== 'ok' || result.level === 0 || !$('adaptation-consent').checked) return;
    applySupport(result.level);
  });
  $('revert-adaptation').addEventListener('click', () => { revert(); $('adaptation-consent').checked = false; updateControls(); announce('Восстановлен стандартный интерфейс.'); });
  function download(name, data, type = 'application/json') {
    const blob = new Blob([type === 'application/json' ? JSON.stringify(data, null, 2) : data], { type });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('export-report').addEventListener('click', () => {
    if (!report) return;
    download('handhelper-report.json', { ...report, result, model: resultModel, notice: 'Оценка взаимодействия, не медицинский диагноз. Синтетические данные не подтверждают клиническую точность.' });
  });
  $('download-training').addEventListener('click', () => download('handhelper-synthetic-training.json', { source: 'synthetic', rows: HH.syntheticRows() }));
  $('download-study').addEventListener('click', () => download('handhelper-synthetic-study.json', HH.studyExample()));
  $('export-model').addEventListener('click', () => download('handhelper-model-v2.json', { kind: 'handhelper-model', model }));
  $('export-evaluation').addEventListener('click', () => { if (evaluation) download('handhelper-evaluation.json', evaluation); });
  $('export-adapted-site').addEventListener('click', () => { if (adaptation.level) download('city-adapted.html', adaptation.exportHTML(), 'text/html'); });
  $('training-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    const generation = ++importGeneration;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Максимальный размер файла — 4 МБ.');
      const parsed = JSON.parse(await file.text());
      if (generation !== importGeneration) return;
      let candidate, nextEvaluation = null;
      if (parsed.kind === 'handhelper-model') candidate = HH.validateModel(parsed.model);
      else if (Array.isArray(parsed.rows) && parsed.rows[0] && parsed.rows[0].participantId !== undefined) {
        const trained = HH.trainStudy(parsed); candidate = trained.model; nextEvaluation = trained.evaluation;
      } else {
        const rows = Array.isArray(parsed) ? parsed : parsed.rows;
        candidate = HH.fit(rows, { synthetic: !Array.isArray(parsed) && parsed.source === 'synthetic' });
      }
      model = candidate; evaluation = nextEvaluation;
      const source = model.synthetic ? 'синтетические данные' : 'импортированные данные';
      $('model-badge').textContent = 'K-means · 4 кластера · ' + source;
      $('training-status').textContent = 'Модель обучена: ' + model.sampleCount + ' сессий, ' + source + '. Клиническая валидация отсутствует.';
      if (evaluation) $('training-status').textContent += ' Проверка: ' + evaluation.testParticipants + ' участников; сбалансированная точность ' + (100 * evaluation.balancedAccuracy).toFixed(1) + '%, покрытие ' + (100 * evaluation.coverage).toFixed(1) + '%. Отказы учитываются как ошибки.';
      if (report) analyze();
      announce('Модель обновлена. Синтетические сценарии по-прежнему используют отдельную демонстрационную модель.');
      updateControls();
    } catch (error) { $('training-status').textContent = 'Файл не принят: ' + error.message; announce('Обучение не выполнено. Предыдущая модель сохранена.'); }
    finally { event.target.value = ''; }
  });
  $('delete-data').addEventListener('click', () => {
    HH.statistics.consent(false);
    importGeneration++; collector.stop(); collector.reset(); report = null; model = demoModel; evaluation = null;
    clearResult(false); renderMetrics(null); $('collection-consent').checked = false;
    $('data-source').textContent = 'Нет данных'; $('training-file').value = '';
    $('model-badge').textContent = 'K-means · 4 кластера · синтетические данные';
    $('training-status').textContent = 'Сейчас: 400 синтетических сессий. Клиническая валидация отсутствует.';
    updateControls(); announce('Числовые показатели и импортированная модель удалены.');
  });
  $('show-live-analysis').addEventListener('click', () => { report = collector.report(); analyze(); });
  const references = ['Улица Мира, дом 12, подъезд 3.', 'Прошу проверить освещение рядом с парком.', 'Обращение принято в работу, номер 204.'];
  let referenceIndex = 0, taskAssisted = false, selectedTarget = 0;
  $('reference-input').addEventListener('beforeinput', event => { if (['insertFromPaste', 'insertFromDrop', 'insertReplacementText', 'insertCompositionText'].includes(event.inputType)) taskAssisted = true; });
  $('reference-input').addEventListener('paste', () => { taskAssisted = true; });
  $('reference-input').addEventListener('drop', () => { taskAssisted = true; });
  $('check-reference').addEventListener('click', event => {
    if (!collector.running || collector.paused) { announce('Разрешите локальный анализ в настройках сайта.'); return; }
    if (taskAssisted) { $('reference-feedback').textContent = 'Образец не учтён: обнаружена вставка, подсказка или IME. Для этой проверки введите текст вручную.'; $('reference-input').value = ''; taskAssisted = false; return; }
    const task = collector.recordTextTask(references[referenceIndex], $('reference-input').value, event);
    if (!task) return;
    $('reference-feedback').textContent = 'Проверок: ' + collector.counts.textTasks + '. Исправлений для совпадения с образцом: ' + task.edits + ' / ' + task.referenceLength + '.';
    $('reference-input').value = ''; referenceIndex = (referenceIndex + 1) % references.length; $('reference-text').textContent = references[referenceIndex];

  });
  $('target-board').addEventListener('click', event => {
    const target = event.target.closest('[data-target]');
    if (!collector.running || collector.paused) { announce('Разрешите локальный анализ в настройках сайта.'); return; }
    const hit = !!target && Number(target.dataset.target) === selectedTarget;
    if (!collector.recordTarget(hit, event)) return;
    $('target-feedback').textContent = (hit ? 'Верно. ' : 'Выбрана другая цель или фон. ') + 'Попыток: ' + collector.counts.targetAttempts + '; ошибок: ' + collector.counts.targetMisses + '.';
    if (hit) { selectedTarget = (selectedTarget + 1 + Math.floor(Math.random() * 5)) % 6; $('target-name').textContent = $('target-board').querySelector('[data-target="' + selectedTarget + '"]').textContent; }

  });
  $('export-participant').addEventListener('click', () => {
    if (!report || report.source !== 'observation' || HH.quality(report).length) return;
    const participantId = $('participant-id').value.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(participantId)) { announce('Укажите обезличенный код: латиница, цифры, дефис или подчёркивание, до 64 символов.'); return; }
    download('handhelper-session-' + participantId + '.json', { version: 2, source: 'observation', participantId, severity: null, features: report.features, activeSeconds: report.activeSeconds, counts: report.counts, notice: 'severity заполняется после независимой оценки. Этот файл — одна сессия, не обучающая выборка.' });
  });
  window.addEventListener('pagehide', () => { comfortClock.setEnabled(false, performance.now()); collector.stop(); });
  window.addEventListener('pageshow', event => {
    syncComfortClock(); if (!event.persisted) return;
    collector.stop(); collector.reset(); $('collection-consent').checked = false;
    HH.statistics.suspend();
    report = null; clearResult(); renderMetrics(null); $('data-source').textContent = 'Нет данных'; updateControls();
  });
  updateControls();
})();
