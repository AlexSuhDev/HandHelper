(function (global) {
  'use strict';
  class Adaptation {
    constructor(root) { this.root = root; this.original = root.getAttribute('data-hh-support'); this.level = 0; }
    apply(level, consent) {
      if (consent !== true) throw new Error('Нужно отдельное согласие на адаптацию.');
      if (![1, 2, 3].includes(level)) throw new Error('Адаптация доступна только при потребности в поддержке.');
      this.level = level; this.root.setAttribute('data-hh-support', String(level));
    }
    revert() {
      this.level = 0;
      if (this.original === null) this.root.removeAttribute('data-hh-support');
      else this.root.setAttribute('data-hh-support', this.original);
    }
  }
  global.HandHelper.Adaptation = Adaptation;
})(globalThis);
