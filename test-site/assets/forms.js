/* Custom forms: the admin builder and the public form. Used for event registration and the join application. */
(function () {
  'use strict';
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPES = { text: 'Short answer', textarea: 'Paragraph', number: 'Number', url: 'Link', select: 'Dropdown', radio: 'Multiple choice', checkbox: 'Checkboxes', yesno: 'Yes / No' };
  const hasOptions = t => t === 'select' || t === 'radio' || t === 'checkbox';
  const newId = () => 'q' + Math.random().toString(36).slice(2, 8);

  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const s = document.createElement('style');
    s.textContent = `.fb-list{display:grid;gap:12px;margin:10px 0}
.fb-q{border:3px solid #000;background:#1c130b;padding:12px;display:grid;gap:8px}
.fb-q .fb-top{display:grid;grid-template-columns:1fr 170px;gap:8px}
.fb-q .fb-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.fb-q .fb-bar label{display:flex;gap:6px;align-items:center;margin:0 auto 0 0;font-weight:600}
.fb-q .fb-bar input{width:auto;margin:0}
.fb-q textarea{min-height:70px}
.fb-q .fb-num{font:10px var(--display,monospace);color:var(--accent,#F7931E)}
.fb-empty{padding:14px;border:3px dashed #3a2a1c;color:var(--soft,#bba)}
@media(max-width:600px){.fb-q .fb-top{grid-template-columns:1fr}}
.cf-opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.cf-opts label{display:flex;align-items:center;gap:6px;margin:0;padding:8px 12px;border:3px solid #000;background:#2a1d12;cursor:pointer;font-weight:600}
.cf-opts input{width:auto;margin:0;accent-color:var(--accent,#F7931E)}
.cf-opts label:has(input:checked){background:var(--accent,#F7931E);color:var(--accent-ink,#1a0f05)}
.cf-help{display:block;font-size:13px;color:var(--soft,#bba);margin-top:2px}
.cf-preview{border:3px dashed var(--accent,#F7931E);padding:14px;margin-top:10px}`;
    document.head.appendChild(s);
  }

  /* admin: edit a list of questions. returns { get() } */
  function builder(root, fields) {
    css();
    let list = (fields || []).map(f => ({ ...f, options: (f.options || []).slice() }));
    root.innerHTML = `<div class="fb-list"></div><div class="row"><button type="button" class="btn grey sm fb-add">+ ADD QUESTION</button><button type="button" class="btn ghost sm fb-prev">PREVIEW</button></div><div class="fb-pv"></div>`;
    const box = root.querySelector('.fb-list');
    const sync = () => { box.querySelectorAll('.fb-q').forEach((q, i) => {
      const f = list[i]; f.label = q.querySelector('.fb-l').value; f.type = q.querySelector('.fb-t').value; f.required = q.querySelector('.fb-r').checked;
      f.help = q.querySelector('.fb-h').value; const o = q.querySelector('.fb-o'); if (o) f.options = o.value.split('\n').map(s => s.trim()).filter(Boolean);
    }); };
    const draw = () => {
      box.innerHTML = list.length ? list.map((f, i) => `<div class="fb-q" data-i="${i}">
        <span class="fb-num">QUESTION ${i + 1}</span>
        <div class="fb-top"><input type="text" class="fb-l" maxlength="120" placeholder="Question, e.g. Which version do you play?" value="${esc(f.label)}" aria-label="Question ${i + 1}">
          <select class="fb-t" aria-label="Answer type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}"${f.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${hasOptions(f.type) ? `<textarea class="fb-o" maxlength="1200" placeholder="One choice per line" aria-label="Choices">${esc((f.options || []).join('\n'))}</textarea>` : ''}
        <input type="text" class="fb-h" maxlength="160" placeholder="Help text (optional)" value="${esc(f.help || '')}" aria-label="Help text">
        <div class="fb-bar"><label><input type="checkbox" class="fb-r"${f.required ? ' checked' : ''}> Required</label>
          <button type="button" class="btn grey sm" data-m="-1" aria-label="Move up"${i ? '' : ' disabled'}>▲</button><button type="button" class="btn grey sm" data-m="1" aria-label="Move down"${i < list.length - 1 ? '' : ' disabled'}>▼</button>
          <button type="button" class="btn red sm" data-x aria-label="Remove question">REMOVE</button></div></div>`).join('')
        : '<div class="fb-empty">No extra questions. Press <b>+ ADD QUESTION</b> to ask something.</div>';
      root.querySelector('.fb-pv').innerHTML = '';
    };
    box.addEventListener('change', e => { if (e.target.classList.contains('fb-t')) { sync(); const f = list[+e.target.closest('.fb-q').dataset.i]; if (hasOptions(f.type) && !f.options.length) f.options = ['Option 1', 'Option 2']; draw(); } });
    box.addEventListener('click', e => {
      const q = e.target.closest('.fb-q'); if (!q) return; const i = +q.dataset.i;
      if (e.target.dataset.m) { sync(); const j = i + +e.target.dataset.m; [list[i], list[j]] = [list[j], list[i]]; draw(); }
      if (e.target.hasAttribute('data-x')) { sync(); if (!list[i].label || confirm('Remove "' + list[i].label + '"?')) { list.splice(i, 1); draw(); } }
    });
    root.querySelector('.fb-add').onclick = () => { sync(); if (list.length >= 20) return alert('20 questions at most.'); list.push({ id: newId(), label: '', type: 'text', required: false, options: [], help: '' }); draw(); box.lastElementChild.querySelector('.fb-l').focus(); };
    root.querySelector('.fb-prev').onclick = () => { sync(); const pv = root.querySelector('.fb-pv'); pv.innerHTML = pv.innerHTML ? '' : `<div class="cf-preview"><p class="soft small" style="margin:0 0 6px">Preview: what people see</p>${render(clean(), 'pv')}</div>`; };
    draw();
    const clean = () => list.filter(f => f.label.trim()).map(f => ({ id: f.id || newId(), label: f.label.trim(), type: f.type, required: !!f.required, help: (f.help || '').trim(), options: hasOptions(f.type) ? f.options : [] }));
    return { get() { sync(); const bad = list.find(f => f.label.trim() && hasOptions(f.type) && f.options.length < 2); if (bad) throw new Error(`"${bad.label}" needs at least 2 choices.`); return clean(); } };
  }

  /* public: the questions as form fields */
  function render(fields, p = 'cf') {
    css();
    return (fields || []).map(f => {
      const id = `${p}_${f.id}`, req = f.required ? ' required' : '', star = f.required ? '' : ' <span class="soft">(optional)</span>';
      const help = f.help ? `<span class="cf-help">${esc(f.help)}</span>` : '';
      const lab = `<label for="${id}">${esc(f.label)}${star}</label>${help}`;
      if (f.type === 'textarea') return `${lab}<textarea id="${id}" maxlength="1000" rows="3"${req}></textarea>`;
      if (f.type === 'number') return `${lab}<input type="number" id="${id}"${req}>`;
      if (f.type === 'url') return `${lab}<input type="url" id="${id}" maxlength="300" placeholder="https://..."${req}>`;
      if (f.type === 'select') return `${lab}<select id="${id}"${req}><option value="">Choose...</option>${f.options.map(o => `<option>${esc(o)}</option>`).join('')}</select>`;
      if (f.type === 'radio' || f.type === 'yesno' || f.type === 'checkbox') {
        const opts = f.type === 'yesno' ? ['Yes', 'No'] : f.options, kind = f.type === 'checkbox' ? 'checkbox' : 'radio';
        return `<fieldset style="border:0;padding:0;margin:16px 0 0" id="${id}"><legend style="font-weight:600">${esc(f.label)}${star}</legend>${help}
          <div class="cf-opts">${opts.map(o => `<label><input type="${kind}" name="${id}" value="${esc(o)}"${kind === 'radio' ? req : ''}> ${esc(o)}</label>`).join('')}</div></fieldset>`;
      }
      return `${lab}<input type="text" id="${id}" maxlength="200"${req}>`;
    }).join('');
  }
  /* public: read the answers; throws if a required checkbox question is empty */
  function read(fields, p = 'cf') {
    const out = {};
    for (const f of fields || []) {
      const id = `${p}_${f.id}`;
      if (f.type === 'checkbox') { out[f.id] = [...document.querySelectorAll(`input[name="${id}"]:checked`)].map(i => i.value); if (f.required && !out[f.id].length) throw new Error(`Answer "${f.label}".`); }
      else if (f.type === 'radio' || f.type === 'yesno') out[f.id] = (document.querySelector(`input[name="${id}"]:checked`) || {}).value || '';
      else out[f.id] = (document.getElementById(id) || {}).value || '';
    }
    return out;
  }
  /* admin: answers as label/value rows */
  const answers = (fields, a) => (fields || []).filter(f => a && a[f.id] !== undefined && String(a[f.id]).length).map(f =>
    `<div class="small"><span class="soft">${esc(f.label)}:</span> <b>${esc(Array.isArray(a[f.id]) ? a[f.id].join(', ') : a[f.id])}</b></div>`).join('');
  window.MTCForms = { builder, render, read, answers, TYPES };
})();
