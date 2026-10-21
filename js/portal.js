(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('request-form');
  let nextId = 3, filter = 'all', newestFirst = true, undoTimer;
  let items = [
    { id: 1, title: 'Освещение на пешеходной дорожке', description: 'Просим проверить фонари вдоль дорожки у дома. Вечером часть участка остаётся без освещения.', category: 'Благоустройство', done: false, favorite: false },
    { id: 2, title: 'Расписание автобуса № 12', description: 'На остановке обновили информационный стенд. Расписание снова доступно пассажирам.', category: 'Транспорт', done: true, favorite: false }
  ];
  const services = {
    lighting: ['Благоустройство', 'Не работает освещение', 'Прошу проверить освещение по адресу: '],
    roads: ['Благоустройство', 'Ремонт дороги или тротуара', 'Прошу проверить состояние покрытия по адресу: '],
    transport: ['Транспорт', 'Работа общественного транспорта', 'Маршрут или остановка: '],
    waste: ['Благоустройство', 'Уборка территории', 'Прошу организовать уборку по адресу: '],
    trees: ['Благоустройство', 'Озеленение и уход за парком', 'Парк или территория, где нужна помощь: '],
    other: ['Другое', '', '']
  };
  function jump(id) { $(id).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }
  function fill(category, title, description) {
    form.elements.category.value = category; form.elements.title.value = title; form.elements.description.value = description;
    jump('request-form'); form.elements.description.focus({ preventScroll: true });
  }
  function button(label, action, id, pressed) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'button'; el.textContent = label;
    el.dataset.action = action; el.dataset.id = String(id);
    if (pressed !== undefined) el.setAttribute('aria-pressed', String(pressed));
    return el;
  }
  function render() {
    const search = $('request-search').value.trim().toLocaleLowerCase('ru');
    const shown = items.filter(item => (filter === 'all' || filter === 'active' && !item.done || filter === 'done' && item.done || filter === 'favorites' && item.favorite) && (item.title + ' ' + item.description + ' ' + item.category).toLocaleLowerCase('ru').includes(search));
    shown.sort((a, b) => newestFirst ? b.id - a.id : a.id - b.id);
    $('requests-list').replaceChildren();
    shown.forEach(item => {
      const li = document.createElement('li'); li.dataset.requestId = String(item.id);
      const symbol = document.createElement('span'); symbol.className = 'request-symbol'; symbol.textContent = item.done ? '✓' : '↗'; symbol.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div'); content.className = 'request-content';
      const title = document.createElement('strong'); title.textContent = item.title;
      const info = document.createElement('span'); info.textContent = item.category + ' · № ' + String(item.id).padStart(3, '0');
      const status = document.createElement('span'); status.className = 'request-status' + (item.done ? ' done' : ''); status.textContent = item.done ? 'Решено' : 'В работе';
      content.append(title, info);
      const actions = document.createElement('div'); actions.className = 'request-row-actions'; actions.dataset.portalOnly = '';
      actions.append(button('Подробнее', 'details', item.id), button(item.favorite ? '★ В избранном' : '☆ В избранное', 'favorite', item.id, item.favorite), button(item.done ? 'Вернуть в работу' : 'Отметить решённым', 'status', item.id), button('Повторить', 'repeat', item.id), button('Удалить', 'delete', item.id));
      li.append(symbol, content, status, actions); $('requests-list').append(li);
    });
    $('request-count').textContent = String(items.length);
    $('total-requests').textContent = String(items.length);
    $('active-requests').textContent = String(items.filter(item => !item.done).length);
    $('done-requests').textContent = String(items.filter(item => item.done).length);
    $('favorite-requests').textContent = String(items.filter(item => item.favorite).length);
    $('requests-visible').textContent = 'Показано: ' + shown.length + ' из ' + items.length;
    $('requests-empty').hidden = shown.length > 0;
    document.querySelectorAll('[data-filter]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.filter === filter)));
  }
  function feedback(message, undo) {
    clearTimeout(undoTimer); $('request-feedback').textContent = message;
    if (!undo) return;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Отменить';
    $('request-feedback').append(cancel);
    cancel.addEventListener('click', () => { clearTimeout(undoTimer); undo(); render(); $('request-feedback').textContent = 'Действие отменено.'; }, { once: true });
    undoTimer = setTimeout(() => { $('request-feedback').textContent = ''; }, 20000);
  }
  function chooseFilter(value) { filter = value; render(); }
  document.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => { jump(el.dataset.jump); if (el.dataset.jump === 'request-form') form.elements.title.focus({ preventScroll: true }); }));
  document.querySelectorAll('[data-service]').forEach(el => el.addEventListener('click', () => { window.HandHelper.statistics.record('services'); fill(...services[el.dataset.service]); feedback('Тема выбрана. Уточните адрес и опишите проблему.'); }));
  document.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => chooseFilter(el.dataset.filter)));
  document.querySelectorAll('[data-summary-filter]').forEach(el => el.addEventListener('click', () => { $('request-search').value = ''; chooseFilter(el.dataset.summaryFilter); jump('my-requests'); }));
  $('request-search').addEventListener('input', render);
  $('reset-filters').addEventListener('click', () => { $('request-search').value = ''; chooseFilter('all'); });
  $('sort-requests').addEventListener('click', () => { newestFirst = !newestFirst; $('sort-requests').textContent = newestFirst ? 'Сначала новые ↓' : 'Сначала старые ↑'; render(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const title = form.elements.title.value.trim(), description = form.elements.description.value.trim();
    if (!title || !description) { feedback('Заполните тему и описание обращения.'); return; }
    const item = { id: nextId++, title, description, category: form.elements.category.value, done: false, favorite: false };
    items.push(item); form.reset(); $('request-search').value = ''; filter = 'all'; newestFirst = true; $('sort-requests').textContent = 'Сначала новые ↓'; render();
    window.HandHelper.statistics.record('requestsCreated');
    feedback('Обращение создано в этой вкладке. Данные никуда не отправлены.', () => { items = items.filter(row => row.id !== item.id); fill(item.category, item.title, item.description); });
  });
  let dialogTrigger = null;
  function showDetails(title, description) {
    dialogTrigger = document.activeElement; $('details-title').textContent = title; $('details-description').textContent = description; $('details-dialog').showModal();
  }
  $('details-dialog').addEventListener('close', () => { if (dialogTrigger && dialogTrigger.isConnected) dialogTrigger.focus({ preventScroll: true }); });
  $('requests-list').addEventListener('click', event => {
    const action = event.target.closest('[data-action]'); if (!action) return;
    const item = items.find(row => row.id === Number(action.dataset.id)); if (!item) return;
    switch (action.dataset.action) {
      case 'details': showDetails(item.title, item.category + ' · ' + (item.done ? 'Решено' : 'В работе') + '\n\n' + item.description); break;
      case 'repeat': fill(item.category, item.title, item.description); feedback('Скопировано в форму нового обращения. Измените текст и нажмите «Создать обращение».'); break;
      case 'favorite': window.HandHelper.statistics.record('favorites'); item.favorite = !item.favorite; render(); restoreActionFocus(item.id, 'favorite'); break;
      case 'status': window.HandHelper.statistics.record('statusChanges'); item.done = !item.done; render(); restoreActionFocus(item.id, 'status'); feedback('Статус учебного обращения изменён.'); break;
      case 'delete': window.HandHelper.statistics.record('requestsDeleted'); items = items.filter(row => row.id !== item.id); render(); feedback('Обращение удалено.', () => { items.push(item); }); $('request-feedback').querySelector('button').focus({ preventScroll: true }); break;
    }
  });
  function restoreActionFocus(id, action) {
    const el = $('requests-list').querySelector('[data-id="' + id + '"][data-action="' + action + '"]');
    (el || $('request-search')).focus({ preventScroll: true });
  }
  $('open-help').addEventListener('click', () => showDetails('Как пользоваться сервисом', '1. Выберите услугу или заполните форму самостоятельно.\n2. Создайте обращение: оно появится в списке ниже.\n3. Используйте поиск, фильтры и избранное. В карточке можно посмотреть описание, изменить статус или повторить обращение.\n4. Через две минуты активной работы сайт предложит адаптацию. Её можно открыть и вручную в настройках.\n\nЭто учебный портал: обращения не отправляются в городские службы и хранятся только до перезагрузки вкладки.'));
  const news = {
    park: ['Обновляем прогулочные дорожки', 'Учебная новость: ремонт покрытия, установка скамеек и обновление освещения. Если вашему двору тоже нужны улучшения, создайте обращение в разделе «Парки и озеленение».'],
    bus: ['Удобные остановки рядом с домом', 'Учебная новость: предложения по остановкам и расписанию можно описать в разделе «Транспорт». Укажите маршрут, остановку и время, когда возникает проблема.']
  };
  document.querySelectorAll('[data-news]').forEach(el => el.addEventListener('click', () => showDetails(...news[el.dataset.news])));
  $('subscribe-news').addEventListener('click', () => {
    const subscribed = $('subscribe-news').getAttribute('aria-pressed') !== 'true';
    $('subscribe-news').setAttribute('aria-pressed', String(subscribed)); $('subscribe-news').textContent = subscribed ? '✓ Вы следите за новостями' : 'Следить за новостями';
    $('news-status').textContent = subscribed ? 'Новости отмечены для вас до закрытия вкладки. Внешние уведомления не отправляются.' : 'Учебные новости. Подписка действует только в этой вкладке.';
  });
  render();
})();
