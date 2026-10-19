(function () {
  'use strict';
  const HH = window.HandHelper;
  const $ = id => document.getElementById(id);
  const demoModel = HH.fit(HH.syntheticRows(), { synthetic: true });
  let model = demoModel;
  let report = null;
  let result = null;
  let resultModel = null;
  let messageTimer;
  let requestNumber = 2;
  let undoTimer;
  let importGeneration = 0;
  let evaluation = null;
  let schedule = null;
  let windowEnd = null;
  let savedAvailable = false;
  let browserStorage = null;
  try { browserStorage = window.localStorage; } catch (_) { /* Disabled storage remains optional. */ }
  const store = new HH.LocalStore(browserStorage, new URLSearchParams(location.search).has('test') ? 'handhelper.test.v2' : 'handhelper.v2');
  const adaptation = new HH.Adaptation($('demo-site'));
  const collector = new HH.Collector($('demo-site'), completedReport => {
    report = completedReport; analyze(); updateControls();
    schedule = null; windowEnd = null; persist();
    $('schedule-status').textContent = 'Наблюдение завершено.';
    updateControls();
    announce(collector.completed ? 'Час наблюдения завершён. Результат доступен в разделе анализа.' : 'Временное окно закончилось. Показаны результат и достаточность данных.');
  });
  function announce(text) {
    clearTimeout(messageTimer); $('app-message').textContent = text;
    messageTimer = setTimeout(() => { $('app-message').textContent = ''; }, 7000);
  }
  function updateControls() {
    const running = collector.running;
    $('start-session').disabled = running || !!schedule || !$('collection-consent').checked;
    $('pause-session').disabled = !running;
    $('finish-session').disabled = !running;
    $('pause-session').textContent = collector.paused ? 'Продолжить' : 'Пауза';
    document.querySelectorAll('[data-scenario]').forEach(button => { button.disabled = running || !!schedule; });
    $('training-file').disabled = running || !!schedule;
    $('arm-schedule').disabled = running || !!schedule || !$('collection-consent').checked;
    $('cancel-schedule').hidden = !schedule;
    $('window-start').disabled = running || !!schedule;
    $('window-end').disabled = running || !!schedule;
    $('restore-session').disabled = running || !!schedule;
    $('export-evaluation').disabled = !evaluation;
    $('export-participant').disabled = !report || report.source !== 'observation' || HH.quality(report).length > 0;
    $('export-report').disabled = !report;
    $('apply-adaptation').disabled = !$('adaptation-consent').checked || !result || result.status !== 'ok' || result.level === 0;
    $('status-dot').classList.toggle('recording', running && !collector.paused);
    if (running) $('session-status').textContent = collector.paused ? 'Наблюдение на паузе' : !collector.clock.enabled ? 'Ожидание активного окна' : 'Идёт наблюдение';
    else if (collector.completed) $('session-status').textContent = 'Час наблюдения завершён';
    else if (collector.clock.activeMs > 0 || collector.counts.keydowns || collector.counts.clicks) $('session-status').textContent = 'Наблюдение завершено досрочно';
    else $('session-status').textContent = $('collection-consent').checked ? 'Можно начать наблюдение' : 'Ожидает вашего согласия';
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
  }
  function clearResult() {
    result = null; resultModel = null; revert();
    $('result-title').textContent = 'Сначала — немного данных';
    $('result-description').textContent = 'После часа активной работы система сопоставит показатели с кластерами модели.';
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
      $('result-description').textContent = 'Система воздержалась от вывода. Интерфейс останется стандартным. Для новой попытки начните новый сеанс.';
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
    if (!$('collection-consent').checked) {
      importGeneration++;
      collector.stop(); collector.reset(); report = null; clearResult(); renderMetrics(null);
      cancelSchedule(); eraseSaved(); $('storage-consent').checked = false;
      $('data-source').textContent = 'Нет данных';
      announce('Согласие отозвано. Наблюдение остановлено, показатели удалены, адаптация отменена.');
    }
    updateControls(); updateLive();
  });
  function startObservation(checkpoint = null, scheduled = false) {
    if (!$('collection-consent').checked || collector.running) return;
    importGeneration++;
    savedAvailable = false;
    if (!scheduled) { schedule = null; windowEnd = null; }
    report = null; clearResult(); collector.start(checkpoint);
    collector.deadline = windowEnd;
    $('data-source').textContent = 'Реальное наблюдение';
    updateControls(); updateLive();
    announce('Наблюдение началось. Работайте с демонстрационным сайтом в обычном режиме.');
    persist();
  }
  $('start-session').addEventListener('click', () => startObservation());
  $('pause-session').addEventListener('click', () => { collector.pause(!collector.paused); updateControls(); persist(); });
  $('finish-session').addEventListener('click', () => {
    collector.stop(); report = collector.report(); cancelSchedule(); analyze(); updateControls(); persist();
  });
  function updateLive() {
    const data = collector.report();
    const seconds = Math.floor(data.activeSeconds);
    $('session-timer').replaceChildren(document.createTextNode(String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')));
    const total = document.createElement('span'); total.textContent = ' / 60:00'; $('session-timer').append(total);
    $('session-progress').value = seconds;
    $('key-count').textContent = String(data.counts.keydowns);
    $('click-count').textContent = String(data.counts.clicks);
    if (collector.running) { renderMetrics(data); updateControls(); }
  }
  setInterval(updateLive, 1000);
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
    if (collector.running || schedule) return;
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
    adaptation.apply(result.level, true);
    $('adaptation-badge').textContent = 'Адаптация · уровень ' + result.level;
    $('revert-adaptation').hidden = false;
    $('export-adapted-site').hidden = false;
    announce('Адаптация уровня ' + result.level + ' применена. Её можно отменить в любой момент.');
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
    const file = event.target.files[0]; if (!file || collector.running || schedule) return;
    const generation = ++importGeneration;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Максимальный размер файла — 4 МБ.');
      const parsed = JSON.parse(await file.text());
      if (generation !== importGeneration || collector.running) return;
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
      updateControls(); persist();
    } catch (error) { $('training-status').textContent = 'Файл не принят: ' + error.message; announce('Обучение не выполнено. Предыдущая модель сохранена.'); }
    finally { event.target.value = ''; }
  });
  $('delete-data').addEventListener('click', () => {
    importGeneration++;
    collector.stop(); collector.reset(); report = null; model = demoModel;
    evaluation = null; cancelSchedule(); eraseSaved(); $('storage-consent').checked = false;
    clearResult(); renderMetrics(null); $('collection-consent').checked = false;
    $('data-source').textContent = 'Нет данных'; $('training-file').value = '';
    $('model-badge').textContent = 'K-means · 4 кластера · синтетические данные';
    $('training-status').textContent = 'Сейчас: 400 синтетических сессий. Клиническая валидация отсутствует.';
    updateLive(); updateControls(); announce('Наблюдение остановлено. Показатели и импортированная модель удалены, адаптация отменена.');
  });
  $('request-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    const title = form.elements.title.value.trim();
    if (!title || !form.elements.description.value.trim()) { announce('Заполните тему и описание обращения.'); return; }
    const category = form.elements.category.value;
    const li = document.createElement('li');
    const icon = document.createElement('span'); icon.className = 'request-symbol'; icon.textContent = '↗'; icon.setAttribute('aria-hidden', 'true');
    const detail = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = title;
    const subtitle = document.createElement('span'); subtitle.textContent = category + ' · локальный пример'; detail.append(strong, subtitle);
    const status = document.createElement('span'); status.className = 'request-status'; status.textContent = 'Создано';
    li.append(icon, detail, status); $('requests-list').prepend(li);
    requestNumber++; $('request-count').textContent = String(requestNumber);
    clearTimeout(undoTimer);
    const previousTitle = form.elements.title.value; const previousDescription = form.elements.description.value;
    form.reset();
    const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = 'Отменить';
    $('request-feedback').replaceChildren(document.createTextNode('Учебное обращение создано.'), undo);
    undo.addEventListener('click', () => {
      clearTimeout(undoTimer); li.remove(); requestNumber--; $('request-count').textContent = String(requestNumber);
      form.elements.title.value = previousTitle; form.elements.description.value = previousDescription;
      form.querySelectorAll('[name="category"]').forEach(input => { input.checked = input.value === category; });
      $('request-feedback').textContent = 'Действие отменено. Текст восстановлен.';
    }, { once: true });
    undoTimer = setTimeout(() => { $('request-feedback').textContent = ''; }, 20000);
  });
  function eraseSaved() {
    savedAvailable = false;
    try { store.clear(); $('storage-status').textContent = 'Сохранённые показатели удалены.'; }
    catch (_) { $('storage-status').textContent = 'Браузер запретил доступ к хранилищу. Удалите данные сайта в настройках браузера.'; }
    $('restore-session').hidden = true;
  }
  function persist() {
    if (savedAvailable || !$('storage-consent').checked || !$('collection-consent').checked) return;
    try {
      store.write({ version: 2, checkpoint: collector.checkpoint(), model, wasRunning: collector.running, windowEnd, waitingSchedule: schedule && !schedule.started ? { start: schedule.start, end: schedule.end } : null, savedAt: Date.now() }, true);
      $('storage-status').textContent = 'Числовой сеанс и модель сохранены в этом браузере. Время отсутствия не учитывается.';
      $('restore-session').hidden = collector.running || !!schedule;
    } catch (error) { $('storage-status').textContent = 'Не удалось сохранить: ' + error.message; }
  }
  $('storage-consent').addEventListener('change', () => {
    if ($('storage-consent').checked) {
      if (savedAvailable) $('storage-status').textContent = 'Выберите восстановление сохранённого сеанса или начните новый. Существующие данные пока не перезаписываются.';
      else if (!$('collection-consent').checked) $('storage-status').textContent = 'Сначала дайте согласие на сбор; сохранение начнётся после запуска.';
      else persist();
    } else eraseSaved();
  });
  $('restore-session').addEventListener('click', () => {
    if (collector.running || schedule) return;
    if (!$('collection-consent').checked || !$('storage-consent').checked) { announce('Для восстановления отметьте согласия на сбор и сохранение.'); return; }
    try {
      const saved = store.read(); if (!saved) throw new Error('Сохранённого сеанса нет.');
      const restoredModel = HH.validateModel(saved.model);
      const probe = new HH.Collector($('demo-site')); probe.restore(saved.checkpoint);
      savedAvailable = false;
      model = restoredModel; evaluation = null; clearResult();
      windowEnd = Number.isFinite(saved.windowEnd) ? saved.windowEnd : null;
      if (saved.waitingSchedule && saved.waitingSchedule.end > Date.now()) {
        collector.reset(); collector.restore(saved.checkpoint);
        schedule = new HH.WindowSchedule(Math.max(Date.now(), saved.waitingSchedule.start), saved.waitingSchedule.end);
        windowEnd = schedule.end; $('schedule-status').textContent = 'Ожидание восстановленного временного окна.';
      } else if (saved.wasRunning && saved.checkpoint.activeMs < 3600000 && (windowEnd === null || windowEnd > Date.now())) startObservation(saved.checkpoint, true);
      else {
        collector.reset(); collector.restore(saved.checkpoint); collector.completed = collector.clock.complete;
        report = collector.report(); analyze();
      }
      $('model-badge').textContent = 'K-means · 4 кластера · ' + (model.synthetic ? 'синтетические данные' : 'импортированные данные');
      $('training-status').textContent = 'Восстановлена модель: ' + model.sampleCount + ' сессий. Клиническая валидация отсутствует.';
      updateLive(); updateControls(); announce('Числовой сеанс восстановлен. Текст, прошлые клавиши и координаты не восстанавливаются.');
    } catch (error) { announce('Сеанс не восстановлен: ' + error.message); }
  });
  function cancelSchedule() {
    schedule = null; windowEnd = null; collector.deadline = null;
    $('schedule-status').textContent = 'Расписание не задано. Время — по часам вашего браузера.';
    $('cancel-schedule').hidden = true;
  }
  $('arm-schedule').addEventListener('click', () => {
    if (collector.running || schedule || !$('collection-consent').checked) return;
    try {
      schedule = new HH.WindowSchedule(new Date($('window-start').value).getTime(), new Date($('window-end').value).getTime());
      savedAvailable = false;
      windowEnd = schedule.end;
      $('schedule-status').textContent = 'Ожидание: ' + new Date(schedule.start).toLocaleString() + ' — ' + new Date(schedule.end).toLocaleString() + '. Страница должна оставаться открытой.';
      updateControls(); persist();
    } catch (error) { announce(error.message); }
  });
  $('cancel-schedule').addEventListener('click', () => {
    const running = collector.running;
    if (running) { collector.stop(); report = collector.report(); }
    cancelSchedule(); if (running) analyze(); updateControls(); persist();
  });
  setInterval(() => {
    if (!schedule) return;
    const action = schedule.poll(Date.now());
    if (action === 'start') {
      $('schedule-status').textContent = 'Наблюдение в заданном окне до ' + new Date(schedule.end).toLocaleString();
      startObservation(null, true);
    } else if (action === 'finish') {
      if (collector.running) { collector.stop(); report = collector.report(); analyze(); }
      cancelSchedule(); updateControls(); persist();
    } else if (action === 'expired') {
      cancelSchedule(); updateControls(); announce('Временное окно пропущено. Наблюдение не проводилось.');
    }
  }, 1000);
  setInterval(persist, 5000);
  try {
    if (store.read()) { savedAvailable = true; $('restore-session').hidden = false; $('storage-status').textContent = 'Есть сохранённый сеанс. Для восстановления нужны согласия и нажатие кнопки; сбор автоматически не начинается.'; }
  } catch (error) { $('storage-status').textContent = 'Сохранение недоступно или повреждено: ' + error.message; }
  const references = ['Улица Мира, дом 12, подъезд 3.', 'Прошу проверить освещение рядом с парком.', 'Обращение принято в работу, номер 204.'];
  let referenceIndex = 0, taskAssisted = false, selectedTarget = 0;
  $('reference-input').addEventListener('beforeinput', event => { if (['insertFromPaste', 'insertFromDrop', 'insertReplacementText', 'insertCompositionText'].includes(event.inputType)) taskAssisted = true; });
  $('reference-input').addEventListener('paste', () => { taskAssisted = true; });
  $('reference-input').addEventListener('drop', () => { taskAssisted = true; });
  $('check-reference').addEventListener('click', event => {
    if (!collector.running || collector.paused) { announce('Сначала начните или продолжите наблюдение.'); return; }
    if (taskAssisted) { $('reference-feedback').textContent = 'Образец не учтён: обнаружена вставка, подсказка или IME. Для этой проверки введите текст вручную.'; $('reference-input').value = ''; taskAssisted = false; return; }
    const task = collector.recordTextTask(references[referenceIndex], $('reference-input').value, event);
    if (!task) return;
    $('reference-feedback').textContent = 'Проверок: ' + collector.counts.textTasks + '. Исправлений для совпадения с образцом: ' + task.edits + ' / ' + task.referenceLength + '.';
    $('reference-input').value = ''; referenceIndex = (referenceIndex + 1) % references.length; $('reference-text').textContent = references[referenceIndex];
    persist();
  });
  $('target-board').addEventListener('click', event => {
    const target = event.target.closest('[data-target]');
    if (!collector.running || collector.paused) { announce('Для измерения выбора объекта начните наблюдение.'); return; }
    const hit = !!target && Number(target.dataset.target) === selectedTarget;
    if (!collector.recordTarget(hit, event)) return;
    $('target-feedback').textContent = (hit ? 'Верно. ' : 'Выбрана другая цель или фон. ') + 'Попыток: ' + collector.counts.targetAttempts + '; ошибок: ' + collector.counts.targetMisses + '.';
    if (hit) { selectedTarget = (selectedTarget + 1 + Math.floor(Math.random() * 5)) % 6; $('target-name').textContent = $('target-board').querySelector('[data-target="' + selectedTarget + '"]').textContent; }
    persist();
  });
  $('export-participant').addEventListener('click', () => {
    if (!report || report.source !== 'observation' || HH.quality(report).length) return;
    const participantId = $('participant-id').value.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(participantId)) { announce('Укажите обезличенный код: латиница, цифры, дефис или подчёркивание, до 64 символов.'); return; }
    download('handhelper-session-' + participantId + '.json', { version: 2, source: 'observation', participantId, severity: null, features: report.features, activeSeconds: report.activeSeconds, counts: report.counts, notice: 'severity заполняется после независимой оценки. Этот файл — одна сессия, не обучающая выборка.' });
  });
  window.addEventListener('pagehide', () => { persist(); collector.stop(); });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    collector.stop(); cancelSchedule(); report = null; clearResult();
    $('collection-consent').checked = false; $('storage-consent').checked = false;
    try { savedAvailable = !!store.read(); } catch (_) { savedAvailable = false; }
    $('restore-session').hidden = !savedAvailable;
    $('data-source').textContent = 'Нет данных'; renderMetrics(null); updateLive(); updateControls();
    announce('Страница возвращена из истории. Для продолжения нужны согласие и восстановление сеанса.');
  });
  updateControls();
})();
