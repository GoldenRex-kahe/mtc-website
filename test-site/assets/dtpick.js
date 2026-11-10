/* Swaps every browser date-time box (<input type="datetime-local">) for Date + Hour + Min + AM/PM boxes.
   The original input stays (hidden) and keeps a normal "YYYY-MM-DDTHH:MM" value, so the code that reads it does not change. */
(() => {
  const pad = n => String(n).padStart(2, '0');
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function build(inp) {
    if (inp.dataset.dtp) return; inp.dataset.dtp = '1';
    const start = proto.get.call(inp); inp.type = 'hidden'; proto.set.call(inp, start);
    const box = document.createElement('div'); box.className = 'dt';
    if (inp.getAttribute('style')) box.setAttribute('style', inp.getAttribute('style'));
    box.innerHTML = `<input type="date" aria-label="Date">
      <select aria-label="Hour"><option value="">Hour</option>${Array.from({length: 12}, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
      <select aria-label="Minutes"><option value="">Min</option>${Array.from({length: 60}, (_, i) => `<option value="${i}">${pad(i)}</option>`).join('')}</select>
      <select aria-label="AM or PM"><option>AM</option><option selected>PM</option></select>
      <button type="button" class="btn grey sm clr" aria-label="Clear date and time" title="Clear">✕</button>`;
    const [d, h, m, ap] = [box.querySelector('input'), ...box.querySelectorAll('select')];
    const show = v => {   // hidden value -> boxes
      const x = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)/.exec(v || '');
      if (!x) { d.value = ''; h.value = ''; m.value = ''; return; }
      const H = +x[2]; d.value = x[1]; h.value = String(H % 12 || 12); m.value = String(+x[3]); ap.value = H < 12 ? 'AM' : 'PM';
    };
    const sync = () => {   // boxes -> hidden value
      let v = '';
      if (d.value) { const H = ((+(h.value || 12)) % 12) + (ap.value === 'PM' ? 12 : 0); v = `${d.value}T${pad(H)}:${pad(+(m.value || 0))}`; }
      proto.set.call(inp, v);
      inp.dispatchEvent(new Event('input', {bubbles: true})); inp.dispatchEvent(new Event('change', {bubbles: true}));
    };
    // code that sets inp.value later still updates the boxes
    Object.defineProperty(inp, 'value', { configurable: true, get() { return proto.get.call(inp); }, set(v) { proto.set.call(inp, v); show(v); } });
    show(proto.get.call(inp));
    [d, h, m, ap].forEach(x => x.addEventListener('change', sync));
    box.querySelector('.clr').addEventListener('click', () => { d.value = ''; h.value = ''; m.value = ''; sync(); });
    box.hidden = inp.hidden; inp.after(box);
    new MutationObserver(() => { box.hidden = inp.hidden; }).observe(inp, {attributes: true, attributeFilter: ['hidden']});
    if (inp.id) { const lab = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`); if (lab) lab.htmlFor = ''; }
  }
  const scan = root => (root.querySelectorAll ? root.querySelectorAll('input[type="datetime-local"]') : []).forEach(build);
  new MutationObserver(ms => ms.forEach(r => r.addedNodes.forEach(n => n.nodeType === 1 && (n.matches && n.matches('input[type="datetime-local"]') ? build(n) : scan(n)))))
    .observe(document.documentElement, {childList: true, subtree: true});
  document.addEventListener('DOMContentLoaded', () => scan(document));
  scan(document);
})();
