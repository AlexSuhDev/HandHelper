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
    exportHTML() {
      if (!this.level) throw new Error('Сначала примените адаптацию с согласия пользователя.');
      const clone = this.root.cloneNode(true);
      clone.querySelectorAll('.precision-tasks').forEach(el => el.remove());
      clone.querySelectorAll('[data-portal-only], #comfort').forEach(el => el.remove());
      clone.querySelectorAll('input:not([type="radio"]), textarea').forEach(el => { el.value = ''; el.removeAttribute('value'); if (el.tagName === 'TEXTAREA') el.textContent = ''; });
      const list = clone.querySelector('#requests-list');
      if (list) {
        list.replaceChildren();
        for (const title of ['Освещение на пешеходной дорожке', 'Расписание автобуса № 12']) {
          const item = document.createElement('li'); const label = document.createElement('strong');
          label.textContent = title; item.append(label); list.append(item);
        }
      }
      const count = clone.querySelector('#request-count'); if (count) count.textContent = '2';
      const feedback = clone.querySelector('#request-feedback'); if (feedback) feedback.replaceChildren();
      const size = [38, 44, 52, 60][this.level], font = [13, 14, 16, 18][this.level];
      const css = `*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f5f6f2;color:#293d54;line-height:1.7;margin:0;padding:24px}main{max-width:900px;margin:auto;background:white;padding:24px;border-radius:14px}h1,h2,h3{line-height:1.3}.demo-header{display:flex;gap:12px;align-items:center;border-bottom:1px solid #dae2e8;padding:16px 0}.demo-header-caption{margin-left:auto;font-size:12px}fieldset{border:0;padding:0;margin:24px 0}.categories{display:grid;grid-template-columns:${this.level >= 2 ? '1fr' : 'repeat(auto-fit,minmax(180px,1fr))'};gap:${10 + this.level * 4}px}.category{border:1px solid #a5b9cb;padding:16px;display:flex;align-items:center;gap:12px;border-radius:8px;min-height:${size}px}.category input{width:20px;height:20px}.field-label{display:block;margin:24px 0 8px;font-weight:600}input:not([type=radio]),textarea{width:100%;padding:12px;border:1px solid #a5b9cb;border-radius:8px;min-height:${size}px;font-size:${font}px}button{min-height:${size}px;font-size:${font}px;padding:12px 22px;border:0;border-radius:8px;background:#426c94;color:white;cursor:pointer}input:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #a95515;outline-offset:3px}.form-footer{display:flex;gap:20px;flex-wrap:wrap;justify-content:space-between;margin-top:20px}.requests-heading{display:flex;gap:12px;align-items:center}.requests-list{list-style:none;padding:0}.requests-list li{display:flex;gap:15px;align-items:center;flex-wrap:wrap;padding:20px 0;border-bottom:1px solid #dae2e8}.requests-list strong,.requests-list li div span{display:block;overflow-wrap:anywhere}.request-status{margin-left:auto}.subtle,.muted{color:#637488;font-size:12px}form,fieldset{min-width:0}input,textarea{max-width:100%}.eyebrow{font-size:11px}#request-feedback{margin-top:12px}@media(max-width:500px){body{padding:8px}main{padding:16px}.demo-header{flex-wrap:wrap}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
      const behavior = `(function(){const f=document.getElementById('request-form'),list=document.getElementById('requests-list');f.addEventListener('submit',function(e){e.preventDefault();if(!f.elements.title.value.trim()||!f.elements.description.value.trim())return;const li=document.createElement('li'),s=document.createElement('strong'),d=document.createElement('div'),p=document.createElement('span');s.textContent=f.elements.title.value;d.append(s);p.textContent='Создано локально';li.append(d,p);list.prepend(li);document.getElementById('request-count').textContent=String(list.children.length);f.reset();document.getElementById('request-feedback').textContent='Учебное обращение создано. Данные никуда не отправлены.';});})();`;
      return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Город рядом — адаптированный интерфейс</title><style>' + css + '</style></head><body><main><p class="subtle">Персональный вариант интерфейса · уровень поддержки ' + this.level + '. Учебная форма, без отправки данных.</p>' + clone.outerHTML + '</main><script>' + behavior + '</script></body></html>';
    }
  }
  global.HandHelper.Adaptation = Adaptation;
})(globalThis);
