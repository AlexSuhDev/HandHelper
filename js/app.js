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
  const adaptation = new HH.Adaptation($('demo-site'));
  const collector = new HH.Collector($('demo-site'), completedReport => {
    report = completedReport; analyze(); updateControls();
    announce('Час наблюдения завершён. Результат доступен в разделе анализа.');
  });
  function announce(text) {
    clearTimeout(messageTimer); $('app-message').textContent = text;
    messageTimer = setTimeout(() => { $('app-message').textContent = ''; }, 7000);
  }
  function updateControls() {
    const running = collector.running;
    $('start-session').disabled = running || !$('collection-consent').checked;
    $('pause-session').disabled = !running;
    $('finish-session').disabled = !running;
    $('pause-session').textContent = collector.paused ? 'Продолжить' : 'Пауза';
    document.querySelectorAll('[data-scenario]').forEach(button => { button.disabled = running; });
    $('training-file').disabled = running;
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
      ['background', 'backgroundClickRate', 1, v => (v * 100).toFixed(1) + '%']
    ];
    for (const [id, key, max, format] of items) {
      const missing = !f || (key === 'holdCV' && data.counts.holds < 2) || (key === 'flightCV' && data.counts.flights < 2) || (key === 'pathInefficiency' && data.counts.routes === 0) || (key === 'backgroundClickRate' && data.counts.clicks === 0) || (['correctionRate', 'repeatRate'].includes(key) && data.counts.keydowns === 0);
      $('metric-' + id).textContent = missing ? '—' : format(f[key]);
      $('bar-' + id).style.width = missing ? '0%' : Math.min(100, f[key] / max * 100) + '%';
    }
  }
  function revert() {
    adaptation.revert(); $('adaptation-badge').textContent = 'Стандартный интерфейс';
    $('revert-adaptation').hidden = true;
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
    } else if (result.status === 'out_of_distribution') {
      $('result-icon').textContent = '?';
      $('result-description').textContent = 'Показатели слишком далеко от обучающих примеров. Нельзя надёжно выбрать профиль, поэтому адаптация не предлагается.';
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
      $('data-source').textContent = 'Нет данных';
      announce('Согласие отозвано. Наблюдение остановлено, показатели удалены, адаптация отменена.');
    }
    updateControls(); updateLive();
  });
  $('start-session').addEventListener('click', () => {
    if (!$('collection-consent').checked || collector.running) return;
    importGeneration++;
    report = null; clearResult(); collector.start();
    $('data-source').textContent = 'Реальное наблюдение';
    updateControls(); updateLive();
    announce('Наблюдение началось. Работайте с демонстрационным сайтом в обычном режиме.');
  });
  $('pause-session').addEventListener('click', () => { collector.pause(!collector.paused); updateControls(); });
  $('finish-session').addEventListener('click', () => {
    collector.stop(); report = collector.report(); analyze(); updateControls();
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
    if (collector.running) return;
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
    announce('Адаптация уровня ' + result.level + ' применена. Её можно отменить в любой момент.');
  });
  $('revert-adaptation').addEventListener('click', () => { revert(); $('adaptation-consent').checked = false; updateControls(); announce('Восстановлен стандартный интерфейс.'); });
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('export-report').addEventListener('click', () => {
    if (!report) return;
    download('handhelper-report.json', { ...report, result, model: resultModel, notice: 'Оценка взаимодействия, не медицинский диагноз. Синтетические данные не подтверждают клиническую точность.' });
  });
  $('download-training').addEventListener('click', () => download('handhelper-synthetic-training.json', { source: 'synthetic', rows: HH.syntheticRows() }));
  $('training-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file || collector.running) return;
    const generation = ++importGeneration;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Максимальный размер файла — 4 МБ.');
      const parsed = JSON.parse(await file.text());
      if (generation !== importGeneration || collector.running) return;
      const rows = Array.isArray(parsed) ? parsed : parsed.rows;
      const candidate = HH.fit(rows, { synthetic: !Array.isArray(parsed) && parsed.source === 'synthetic' });
      model = candidate;
      const source = model.synthetic ? 'синтетические данные' : 'импортированные данные';
      $('model-badge').textContent = 'K-means · 4 кластера · ' + source;
      $('training-status').textContent = 'Модель обучена: ' + model.sampleCount + ' сессий, ' + source + '. Клиническая валидация отсутствует.';
      if (report) analyze();
      announce('Модель обновлена. Синтетические сценарии по-прежнему используют отдельную демонстрационную модель.');
    } catch (error) { $('training-status').textContent = 'Файл не принят: ' + error.message; announce('Обучение не выполнено. Предыдущая модель сохранена.'); }
    finally { event.target.value = ''; }
  });
  $('delete-data').addEventListener('click', () => {
    importGeneration++;
    collector.stop(); collector.reset(); report = null; model = demoModel;
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
  window.addEventListener('pagehide', () => collector.stop());
  updateControls();
})();
