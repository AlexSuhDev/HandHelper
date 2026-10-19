(function (global) {
  'use strict';
  class WindowSchedule {
    constructor(start, end, now = Date.now()) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < now - 1000 || end <= start || end - start > 86400000) throw new Error('Укажите будущее начало и окончание окна (до 24 часов).');
      this.start = start; this.end = end; this.started = false; this.done = false;
    }
    poll(now) {
      if (this.done) return 'none';
      if (now >= this.end) { this.done = true; return this.started ? 'finish' : 'expired'; }
      if (!this.started && now >= this.start) { this.started = true; return 'start'; }
      return 'waiting';
    }
  }
  class LocalStore {
    constructor(storage = null, key = 'handhelper.v2') { this.storage = storage; this.key = key; }
    read() {
      if (!this.storage) return null;
      const text = this.storage.getItem(this.key);
      if (!text) return null;
      if (text.length > 1000000) throw new Error('Сохранённые данные слишком велики.');
      const value = JSON.parse(text);
      if (value.version !== 2 || !value.checkpoint) throw new Error('Несовместимый формат сохранения.');
      return value;
    }
    write(value, consent) {
      if (consent !== true) throw new Error('Нужно согласие на сохранение.');
      if (!this.storage) throw new Error('Хранилище браузера недоступно. Используйте экспорт JSON или запуск по HTTP.');
      this.storage.setItem(this.key, JSON.stringify(value));
    }
    clear() { if (this.storage) this.storage.removeItem(this.key); }
  }
  global.HandHelper.WindowSchedule = WindowSchedule;
  global.HandHelper.LocalStore = LocalStore;
})(globalThis);
