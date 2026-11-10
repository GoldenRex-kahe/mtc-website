/* Shared helpers for the inner pages: API calls, nav with login state, toasts, dates, image shrinking, lightbox. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opt = {}) {
    const o = { method: opt.method || 'GET', headers: { 'X-MTC': '1' }, credentials: 'same-origin' };
    if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    const r = await fetch(path, o);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed (' + r.status + ')'), { status: r.status });
    return data;
  }

  const STATUS = { draft: 'Draft', soon: 'Coming soon', open: 'Registration open', live: 'Live now', completed: 'Completed', unsuccessful: 'Unsuccessful', cancelled: 'Cancelled',
    pending: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn' };
  const badge = s => `<span class="badge ${esc(s)}">${esc((STATUS[s] || s).toUpperCase())}</span>`;
  const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const when = e => {
    if (e.start) return dateFmt.format(new Date(e.start)) + (e.end ? ' to ' + dateFmt.format(new Date(e.end)) : '');
    return e.dateLabel || 'Date to be announced';
  };
  const day = iso => iso ? dayFmt.format(new Date(iso)) : '';

  function toast(msg, isErr) {
    let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 7000 : 4000);
  }

  /* phone photos are often 5-10 MB: shrink to max 1920px JPEG before upload */
  function imageToDataUrl(file, max = 1920) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Please choose a PNG, JPG, WEBP or GIF image.'));
      if (file.type === 'image/gif' && file.size < 4.5e6) { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(file); return; }
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        resolve(c.toDataURL(file.type === 'image/png' && file.size < 2e6 ? 'image/png' : 'image/jpeg', .88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
  }

  function lightbox(m) {
    const lb = document.createElement('div'); lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
    const inner = m.type === 'youtube'
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(m.url.split('v=')[1])}?autoplay=1" title="${esc(m.caption || 'Video')}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : `<img src="${esc(m.url)}" alt="${esc(m.caption || 'Event screenshot')}">`;
    lb.innerHTML = `<div class="box"><button class="btn grey sm x" aria-label="Close">CLOSE ✕</button>${inner}${m.caption || m.creator ? `<p class="small" style="margin-top:10px;color:#ddd">${esc(m.caption || '')}${m.creator ? ' · by ' + esc(m.creator) : ''}</p>` : ''}</div>`;
    const close = () => { lb.remove(); document.removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') close(); };
    lb.addEventListener('click', e => { if (e.target === lb || e.target.closest('.x')) close(); });
    document.addEventListener('keydown', key);
    document.body.appendChild(lb); lb.querySelector('.x').focus();
  }
  function tile(m, showEvent) {
    const cap = [m.caption, showEvent && m.eventTitle].filter(Boolean).join(' · ');
    return `<button class="tile" data-mid="${esc(m.id)}" style="background-image:url('${esc(m.thumb)}')" aria-label="${esc((m.type === 'youtube' ? 'Play video: ' : 'Open screenshot: ') + (m.caption || m.eventTitle || ''))}">
      ${m.type === 'youtube' ? '<span class="play"><i></i></span>' : ''}${cap || m.creator ? `<span class="cap">${esc(cap)}${m.creator || m.published ? `<br><span class="soft">${m.creator ? `by ${esc(m.creator)}` : ''}${m.creator && m.published ? ' · ' : ''}${m.published ? esc(day(m.published)) : ''}</span>` : ''}</span>` : ''}</button>`;
  }
  function bindGallery(root, items) {
    root.addEventListener('click', e => { const t = e.target.closest('.tile'); if (!t) return; const m = items.find(x => x.id === t.dataset.mid); if (m) lightbox(m); });
  }

  /* nav: the shared navbar (assets/nav.js), same on every page */
  function nav() {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/assets/nav.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = '/assets/nav.js'; document.body.appendChild(s);
  }
  let mePromise = null;
  const me = () => (mePromise = mePromise || api('/api/me').catch(() => ({ user: null })));
  function foot() {
    const f = document.createElement('footer'); f.className = 'foot';
    f.innerHTML = '<span>MTC · MC Thamizh Creators</span><span>Hosting partners: <a href="https://pingforge.cloud/" target="_blank" rel="noopener sponsored">PingForge</a> · <a href="https://www.kovaihost.cloud/" target="_blank" rel="noopener sponsored">KovaiHost</a> · <a href="/#about">About</a> · <a href="/account.html">Account</a></span>';
    document.body.appendChild(f);
  }

  /* banner background with the admin's focus point and fit (whole image vs fill) */
  const bannerStyle = e => !e.banner ? '' : `background-image:url('${esc(e.banner)}');background-position:${e.bannerPos || '50% 50%'};background-size:${e.bannerFit === 'contain' ? 'contain' : 'cover'};background-repeat:no-repeat`;
  /* a 3D Minecraft head from a skin URL (size = width in px, a multiple of 8 looks sharpest) */
  // only the three faces that face the viewer, so no browser has to sort hidden faces (some draw them on top)
  const faces = '<i class="fr"></i><i class="lf"></i><i class="rt"></i><i class="bk"></i><i class="tp"></i>';
  const head3d = (skin, size = 32) => `<span class="h3d" style="--u:${size / 8}px;--s:url('${esc(skin)}')" aria-hidden="true"><span class="cube">${faces}</span><span class="cube hat">${faces}</span></span>`;
  /* "Website or other": up to 3 links, stored as website / website2 / website3 */
  const WEB_KEYS = ['website', 'website2', 'website3'];
  const linkRow = v => `<div class="wl-row" style="display:flex;gap:8px;margin-bottom:8px"><input type="url" placeholder="https://..." value="${esc(v)}" aria-label="Website or other link" style="flex:1"><button type="button" class="btn grey sm wl-x" aria-label="Remove this link">✕</button></div>`;
  function linkFields(id, socials = {}) {
    const vals = WEB_KEYS.map(k => socials[k] || '').filter(Boolean); if (!vals.length) vals.push('');
    return `<div class="full" id="${id}"><label>Website or other links <span class="soft">(optional, up to 3)</span></label><div class="wl-list">${vals.map(linkRow).join('')}</div>
      <button type="button" class="btn grey sm wl-add">+ ADD ANOTHER LINK</button></div>`;
  }
  function bindLinkFields(id) {
    const box = document.getElementById(id); if (!box) return;
    const list = box.querySelector('.wl-list'), add = box.querySelector('.wl-add');
    const sync = () => { add.hidden = list.children.length >= 3; };
    add.onclick = () => { if (list.children.length >= 3) return; list.insertAdjacentHTML('beforeend', linkRow('')); list.lastElementChild.querySelector('input').focus(); sync(); };
    list.addEventListener('click', e => { const x = e.target.closest('.wl-x'); if (!x) return; const row = x.closest('.wl-row');
      if (list.children.length > 1) row.remove(); else row.querySelector('input').value = ''; sync(); });
    sync();
  }
  function readLinks(id) {
    const vals = [...document.querySelectorAll('#' + id + ' .wl-row input')].map(i => i.value.trim()).filter(Boolean);
    return Object.fromEntries(WEB_KEYS.map((k, i) => [k, vals[i] || '']));
  }
  // a website link is shown by its site name (e.g. github.com) instead of the word "Website"
  const linkName = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Website'; } };
  /* Minecraft edition: Java (Mojang name) or Bedrock (Xbox gamertag, may contain spaces) */
  const skinUrl = (mc, ed) => !mc ? '' : (ed === 'bedrock' ? '/api/skin-be/' : ed === 'offline' ? '/api/skin-off/' : '/api/skin/') + encodeURIComponent(mc);
  const edPicker = (id, ed) => `<div class="edpick" role="radiogroup" aria-label="Minecraft edition">${[['java', 'Java', 'Premium Java account'], ['offline', 'Offline', 'Cracked / non-premium Java account'], ['bedrock', 'Bedrock', 'Xbox gamertag']].map(([v, l, t]) =>
    `<label title="${t}"><input type="radio" name="${id}" value="${v}"${(['bedrock', 'offline'].includes(ed) ? ed : 'java') === v ? ' checked' : ''}> ${l}</label>`).join('')}</div>`;
  const readEd = id => (document.querySelector(`input[name="${id}"]:checked`) || {}).value || 'java';
  const validMc = (n, ed) => ed === 'bedrock' ? /^[A-Za-z][A-Za-z0-9 _]{1,15}$/.test(n.replace(/^[.*]/, '').trim()) : /^\w{3,16}$/.test(n);
  const edTag = ed => ed === 'bedrock' ? '<span class="edtag" title="Bedrock Edition">BE</span>' : ed === 'offline' ? '<span class="edtag off" title="Offline (non-premium) Java account">OFF</span>' : '';
  /* live countdown: <span data-cd="ISO"> ticks every second; data-done is shown when the time has passed */
  const cdText = iso => { const ms = new Date(iso) - Date.now(); if (!(ms > 0)) return ''; const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), sec = Math.floor(ms % 6e4 / 1e3), p = n => String(n).padStart(2, '0');
    return d ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}h ${p(m)}m ${p(sec)}s`; };
  const countdown = (iso, label = '') => iso && new Date(iso) > Date.now() ? `<span class="cd" data-cd="${esc(iso)}" title="${esc(new Date(iso).toLocaleString())}">${label ? `<small>${esc(label)}</small>` : ''}<b>${cdText(iso)}</b></span>` : '';
  setInterval(() => document.querySelectorAll('[data-cd]').forEach(el => { const t = cdText(el.dataset.cd), b = el.querySelector('b'); if (t) { if (b) b.textContent = t; } else el.remove(); }), 1000);
  /* badge chips (leaderboard, profiles) */
  const badgeIcon = b => b.image ? `<img class="bdg-i${/\.svg$/.test(b.image) ? ' px' : ''}" src="${esc(b.image)}" alt="" loading="lazy">` : `<span class="bdg-e" aria-hidden="true">${esc(b.icon)}</span>`;
  const badgeRow = (list, max = 99) => (list || []).slice(0, max).map(b => `<span class="bdg${b.image ? ' img' : ''}" style="--bc:${esc(b.color || '#666')}" tabindex="0" role="img" aria-label="${esc(b.name + (b.desc ? ': ' + b.desc : ''))}" data-tip="${esc(b.name)}" data-tip2="${esc(b.desc || '')}">${badgeIcon(b)}<span class="bdg-n">${esc(b.name)}</span></span>`).join('');
  /* medals only (profiles, leaderboard): the name shows in a tooltip on hover, keyboard focus or tap */
  const badgeIcons = (list, max = 99) => `<span class="bdgs">${badgeRow(list, max)}</span>`;
  const tip = document.createElement('div'); tip.className = 'mtc-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  let tipFor = null;
  const showTip = el => { if (!document.body.contains(tip)) document.body.appendChild(tip); tipFor = el;
    tip.innerHTML = `<b>${esc(el.dataset.tip)}</b>${el.dataset.tip2 ? `<span>${esc(el.dataset.tip2)}</span>` : ''}`; tip.style.setProperty('--bc', el.style.getPropertyValue('--bc') || '#F7931E'); tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)), above = r.top - h - 10 > 8;
    tip.style.left = x + 'px'; tip.style.top = (above ? r.top - h - 10 : r.bottom + 10) + 'px'; tip.classList.toggle('below', !above);
    tip.style.setProperty('--ax', (r.left + r.width / 2 - x) + 'px'); };
  const hideTip = () => { tip.hidden = true; tipFor = null; };
  document.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && e.pointerType !== 'touch') showTip(el); });
  document.addEventListener('pointerout', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el === tipFor && !el.contains(e.relatedTarget)) hideTip(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('focusout', e => { if (e.target === tipFor) hideTip(); });
  document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { tipFor === el && !tip.hidden ? hideTip() : showTip(el); } else if (!tip.hidden) hideTip(); });
  addEventListener('scroll', hideTip, { passive: true }); addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
  window.MTC = { countdown, badgeRow, badgeIcons, badgeIcon, skinUrl, edPicker, readEd, validMc, edTag, linkFields, bindLinkFields, readLinks, linkName, WEB_KEYS, head3d, bannerStyle, $, esc, api, badge, STATUS, when, day, toast, imageToDataUrl, lightbox, tile, bindGallery, me, nav, foot };
})();
