/* Admin Messages tab: post to any channel (with pings) or DM people / roles (with a mention). Plain text or a full embed, with images. */
(function () {
  'use strict';
  const { $, esc, api, toast } = MTC;
  const md = t => (window.MTCmd ? MTCmd.md(t) : esc(t).replace(/\n/g, '<br>'));
  const blankEmbed = () => ({ title: '', description: '', url: '', color: '#F7931E', timestamp: '', author: { name: '', url: '', icon: '' }, thumbnail: '', footer: { text: '', icon: '' }, fields: [] });
  const blank = () => ({ format: 'plain', content: '', embed: blankEmbed(), image: '' });
  // drafts from older versions / history: fill in missing parts
  const norm = d => { d = d || blank(); const b = blankEmbed(), e = d.embed || {};
    const ft = typeof e.footer === 'string' ? { text: e.footer, icon: '' } : { ...b.footer, ...(e.footer || {}) };
    d.embed = { ...b, ...e, author: { ...b.author, ...(e.author || {}) }, footer: ft, fields: Array.isArray(e.fields) ? e.fields : [] };
    d.image = d.image || ''; d.content = d.content || ''; d.format = d.format === 'embed' ? 'embed' : 'plain'; return d; };
  const PICS = ['image', 'embed.thumbnail', 'embed.author.icon', 'embed.footer.icon'];
  const getP = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
  const setP = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const clone = d => JSON.parse(JSON.stringify(d));
  const S = { sub: 'post', drafts: { post: blank(), dm: blank() }, meta: null, members: null, channelId: '', ping: { everyone: false, here: false, roles: [] },
    showOnSite: false, dmUsers: [], dmRoles: [], dmPing: { mention: false }, job: null };
  try { const saved = JSON.parse(sessionStorage.getItem('mtcMsg') || 'null'); if (saved) Object.assign(S, saved, { meta: null, members: null, job: null }); } catch {}
  S.drafts.post = norm(S.drafts.post); S.drafts.dm = norm(S.drafts.dm); S.dmPing = S.dmPing || { mention: false };
  const keep = () => { try { const { meta, members, job, ...rest } = S; const d = clone(rest); for (const k of ['post', 'dm']) for (const p of PICS) if (String(getP(d.drafts[k], p) || '').startsWith('data:')) setP(d.drafts[k], p, ''); sessionStorage.setItem('mtcMsg', JSON.stringify(d)); } catch {} };

  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const s = document.createElement('style');
    s.textContent = `.mg-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:18px;align-items:start}
@media(max-width:900px){.mg-grid{grid-template-columns:1fr}}
.mg-sub{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.mg-seg{display:inline-flex;border:3px solid #000}.mg-seg button{border:0;padding:8px 14px;background:#2a1d12;color:var(--ink);font:600 14px Archivo,sans-serif;cursor:pointer}
.mg-seg button[aria-pressed=true]{background:var(--accent);color:var(--accent-ink)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:2px solid #000;background:#2a1d12;color:var(--ink);font:600 13px Archivo,sans-serif;cursor:pointer}
.chip[aria-pressed=true]{background:var(--accent);color:var(--accent-ink)}
.chip i{width:10px;height:10px;border-radius:50%;display:inline-block}
.chip img{width:20px;height:20px;border-radius:50%}
.chip .x{font-weight:800;margin-left:2px}
.mg-pick{max-height:220px;overflow:auto;border:3px solid #000;background:#0d0804;margin-top:6px}
.mg-pick button{display:flex;gap:8px;align-items:center;width:100%;padding:7px 10px;border:0;border-bottom:1px solid #2a1d12;background:none;color:var(--ink);text-align:left;cursor:pointer;font:inherit}
.mg-pick button:hover{background:#3a2a1c}.mg-pick img,.mg-pick b.i{width:26px;height:26px;border-radius:50%;flex:none}
.mg-pick b.i{display:grid;place-items:center;background:var(--accent);color:var(--accent-ink);font-size:11px}
.dc{background:#313338;color:#dbdee1;border-radius:8px;padding:16px;font:15px/1.4 "gg sans","Noto Sans",Archivo,sans-serif;position:sticky;top:90px}
.dc .who{display:flex;gap:10px}.dc .av{width:40px;height:40px;border-radius:50%;background:#F7931E url(/assets/logo.png) center/cover;flex:none}
.dc .nm{font-weight:600;color:#fff}.dc .nm span{background:#5865f2;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;margin-left:4px;vertical-align:middle}
.dc .tx{white-space:normal;word-wrap:break-word}.dc .tx p{margin:0 0 4px}
.dc .mention{background:#5865f240;color:#c9cdfb;border-radius:3px;padding:0 2px}
.dc .em{margin-top:6px;background:#2b2d31;border-left:4px solid #F7931E;border-radius:4px;padding:10px 14px;max-width:440px}
.dc .em .t{font-weight:700;color:#fff;margin-bottom:4px}.dc .em .t a{color:#00a8fc}
.dc .em .d{font-size:14px}.dc .em .f{font-size:12px;color:#b5bac1;margin-top:8px}
.dc img.att{max-width:100%;max-height:300px;border-radius:6px;margin-top:8px;display:block}
.mg-img{display:flex;gap:10px;align-items:center;margin-top:6px}.mg-img img{max-height:70px;border:2px solid #000}
.mg-sec{border:3px solid #000;background:#1c130b;padding:12px;margin-top:12px}
.mg-sec>summary{cursor:pointer;font-weight:700}
.mg-pic{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mg-pic input[type=url]{flex:1;min-width:180px}
.mg-pic img{height:44px;max-width:90px;object-fit:cover;border:2px solid #000}
.mg-fld{display:grid;grid-template-columns:1fr 1.4fr auto auto;gap:6px;align-items:center;margin-top:6px}
.mg-fld label{display:flex;gap:4px;align-items:center;margin:0;font-size:13px}.mg-fld label input{width:auto;margin:0}
@media(max-width:600px){.mg-fld{grid-template-columns:1fr 1fr}}
.dc .em{position:relative;display:grid;grid-template-columns:1fr auto;gap:0 14px}
.dc .em>*{grid-column:1}.dc .em .th{grid-column:2;grid-row:1/span 4;width:80px;height:80px;object-fit:cover;border-radius:4px}
.dc .em .au{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;color:#fff;margin-bottom:6px}.dc .em .au img{width:24px;height:24px;border-radius:50%}
.dc .em .fl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}.dc .em .fl div{grid-column:span 3;font-size:14px}.dc .em .fl div.in{grid-column:span 1}
.dc .em .fl b{display:block;color:#fff;font-size:13px}
.dc .em .f{display:flex;gap:6px;align-items:center}.dc .em .f img{width:20px;height:20px;border-radius:50%}
.dc .em img.att{grid-column:1/-1}
.mg-prog{height:14px;border:3px solid #000;background:#0d0804;margin:8px 0}.mg-prog i{display:block;height:100%;background:var(--accent);transition:width .3s}`;
    document.head.appendChild(s);
  }

  async function tab(pane) {
    css();
    pane.innerHTML = '<p class="soft">Loading Discord channels and roles...</p>';
    try {
      [S.meta, S.members] = await Promise.all([S.meta || api('/api/admin/discord/meta'), S.members || api('/api/admin/members').then(d => d.members.filter(m => m.inGuild))]);
    } catch (x) { pane.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
    if (!S.channelId) S.channelId = S.meta.defaultChannel || (S.meta.channels[0] || {}).id || '';
    draw(pane);
  }
  const roleName = id => ((S.meta.roles.find(r => r.id === id) || {}).name || 'role');

  function draw(pane) {
    const d = S.drafts[S.sub === 'dm' ? 'dm' : 'post'];
    pane.innerHTML = `<div class="mg-sub">${[['post', '📢 CHANNEL POST'], ['dm', '✉ DIRECT MESSAGE'], ['history', '🕘 SENT'], ['news', '📰 WEBSITE NEWS'], ['alerts', '🔔 ALERTS']].map(([k, l]) =>
      `<button class="btn sm ${S.sub === k ? '' : 'grey'}" data-sub="${k}">${l}</button>`).join('')}</div><div id="mgBody"></div>`;
    pane.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { S.sub = b.dataset.sub; keep(); draw(pane); });
    if (S.sub === 'history') return history($('#mgBody'), pane);
    if (S.sub === 'alerts') return alerts($('#mgBody'));
    if (S.sub === 'news') return news($('#mgBody'));
    const isPost = S.sub === 'post';
    $('#mgBody').innerHTML = `<div class="mg-grid"><div class="card accent" style="margin:0">
      <h2>${isPost ? 'POST IN A CHANNEL' : 'SEND A DIRECT MESSAGE'}</h2>
      ${isPost ? `<label for="mg_ch">Channel</label><select id="mg_ch">${groupChannels()}</select>
        <label>Ping <span class="soft">(optional)</span></label><div class="chips" id="mg_ping">
          <button type="button" class="chip" data-pg="everyone" aria-pressed="${S.ping.everyone}">@everyone</button><button type="button" class="chip" data-pg="here" aria-pressed="${S.ping.here}">@here</button>
          ${S.meta.roles.map(r => `<button type="button" class="chip" data-pr="${r.id}" aria-pressed="${S.ping.roles.includes(r.id)}"><i style="background:${r.color || '#99aab5'}"></i>@${esc(r.name)}</button>`).join('')}</div>`
      : `<label for="mg_q">People</label><div class="chips" id="mg_people"></div><input type="search" id="mg_q" placeholder="Search a member to add" autocomplete="off"><div class="mg-pick" id="mg_pick" hidden></div>
        <label>Roles <span class="soft">(everyone who has the role)</span></label><div class="chips">${S.meta.roles.map(r => `<button type="button" class="chip" data-dr="${r.id}" aria-pressed="${S.dmRoles.includes(r.id)}"><i style="background:${r.color || '#99aab5'}"></i>${esc(r.name)} <span class="soft">${r.members}</span></button>`).join('')}</div>
        <p class="small" id="mg_count" style="margin:8px 0 0"></p>
        <label>Ping <span class="soft">(in a DM only the person themself can be pinged)</span></label><div class="chips"><button type="button" class="chip" id="mg_dmment" aria-pressed="${S.dmPing.mention}">@mention the person</button></div>`}
      <label>Format</label><div class="mg-seg" role="group"><button type="button" data-fmt="plain" aria-pressed="${d.format === 'plain'}">Plain message</button><button type="button" data-fmt="embed" aria-pressed="${d.format === 'embed'}">Embed</button></div>
      <label for="mg_c">${d.format === 'embed' ? 'Text above the embed <span class="soft">(optional)</span>' : 'Message'}</label>
      <textarea data-md id="mg_c" maxlength="2000" rows="${d.format === 'embed' ? 2 : 6}">${esc(d.content)}</textarea>
      ${d.format === 'embed' ? embedForm(d.embed) : ''}
      <label>${d.format === 'embed' ? 'Big image <span class="soft">(at the bottom of the embed)</span>' : 'Image <span class="soft">(optional)</span>'}</label>${picField('image', d.image)}
      ${isPost ? '' : '<p class="soft small" style="margin:10px 0 0">Tips: <code>{name}</code> becomes each person\'s name, <code>{mention}</code> pings them.</p>'}
      ${isPost ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="mg_site"${S.showOnSite ? ' checked' : ''}> Also show on the website (home page news)</label>` : ''}
      <div class="row" style="margin-top:18px"><button class="btn" id="mg_send" type="button">${isPost ? 'POST' : 'SEND DMs'}</button>
        <button class="btn ghost sm" id="mg_copy" type="button">${isPost ? 'COPY TO DM →' : '← COPY TO CHANNEL POST'}</button>
        <button class="btn ghost sm" id="mg_clear" type="button" style="margin-left:auto">CLEAR</button></div>
      <details class="mg-later" style="margin-top:14px"><summary><b>🕒 SEND LATER</b> <span class="soft small">pick a date and time, the website sends it for you</span></summary>
        <div class="row" style="margin-top:10px;gap:8px"><input type="datetime-local" id="mg_at" aria-label="Send at" style="max-width:260px"><button class="btn sm" id="mg_sched_btn" type="button">SCHEDULE</button></div></details>
      <div id="mg_job"></div>
      <div id="mg_sched"></div>
    </div><div><p class="soft small" style="margin:0 0 6px">Preview</p><div class="dc" id="mg_prev"></div></div></div>`;
    if (window.mdTools) mdTools();
    bind(pane, d, isPost);
    preview(d, isPost); if (!isPost) { people(); count(); }
    if (S.job && !S.job.done) watchJob();
  }
  function picField(path, val) {
    const link = /^https:/.test(val || '') ? val : '';
    return `<div class="mg-pic" data-pic="${path}"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload image">
      <input type="url" placeholder="or paste an image link (https://...)" value="${esc(link)}" aria-label="Image link">
      ${val ? `<img src="${esc(val)}" alt=""><button type="button" class="btn grey sm" data-nopic>REMOVE</button>` : ''}</div>`;
  }
  function embedForm(e) {
    const ts = e.timestamp === 'now' ? 'now' : e.timestamp ? 'at' : '';
    const local = e.timestamp && e.timestamp !== 'now' ? new Date(new Date(e.timestamp) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
    return `<details class="mg-sec"${e.author.name || e.author.icon ? ' open' : ''}><summary>Author <span class="soft small">(small line at the top)</span></summary>
        <div class="fields"><div><label for="mg_an">Name</label><input type="text" id="mg_an" maxlength="256" value="${esc(e.author.name)}"></div>
        <div><label for="mg_au">Link <span class="soft">(optional)</span></label><input type="url" id="mg_au" placeholder="https://..." value="${esc(e.author.url)}"></div></div>
        <label>Icon</label>${picField('embed.author.icon', e.author.icon)}</details>
      <div class="fields">
        <div class="full"><label for="mg_t">Title</label><input type="text" id="mg_t" maxlength="256" value="${esc(e.title)}"></div>
        <div><label for="mg_u">Title link <span class="soft">(optional)</span></label><input type="url" id="mg_u" placeholder="https://..." value="${esc(e.url)}"></div>
        <div><label for="mg_col">Side colour</label><input type="color" id="mg_col" value="${esc(e.color)}" style="height:46px;padding:4px"></div>
        <div class="full"><label for="mg_d">Description</label><textarea data-md id="mg_d" maxlength="4000" rows="6">${esc(e.description)}</textarea></div></div>
      <details class="mg-sec"${e.fields.length ? ' open' : ''}><summary>Fields <span class="soft small">(${e.fields.length}/25, small boxes with a name and value)</span></summary>
        <div id="mg_flds">${e.fields.map((x, i) => `<div class="mg-fld" data-f="${i}"><input type="text" class="fn" maxlength="256" placeholder="Name, e.g. Date" value="${esc(x.name)}" aria-label="Field ${i + 1} name">
          <input type="text" class="fv" maxlength="1024" placeholder="Value, e.g. 1 Feb, 2 pm" value="${esc(x.value)}" aria-label="Field ${i + 1} value">
          <label><input type="checkbox" class="fi"${x.inline ? ' checked' : ''}> Side by side</label><button type="button" class="btn red sm" data-fx="${i}" aria-label="Remove field">✕</button></div>`).join('')}</div>
        <button type="button" class="btn grey sm" id="mg_addf" style="margin-top:8px"${e.fields.length >= 25 ? ' disabled' : ''}>+ ADD FIELD</button></details>
      <details class="mg-sec"${e.thumbnail ? ' open' : ''}><summary>Thumbnail <span class="soft small">(small picture top right)</span></summary>${picField('embed.thumbnail', e.thumbnail)}</details>
      <details class="mg-sec"${e.footer.text || e.footer.icon || e.timestamp ? ' open' : ''}><summary>Footer and time</summary>
        <label for="mg_f">Footer text</label><input type="text" id="mg_f" maxlength="2048" value="${esc(e.footer.text)}">
        <label>Footer icon</label>${picField('embed.footer.icon', e.footer.icon)}
        <label for="mg_ts">Time</label><div class="row"><select id="mg_ts" style="max-width:220px"><option value=""${ts ? '' : ' selected'}>No time</option><option value="now"${ts === 'now' ? ' selected' : ''}>Time of sending</option><option value="at"${ts === 'at' ? ' selected' : ''}>Pick a date and time</option></select>
          <input type="datetime-local" id="mg_tsat" value="${local}" style="max-width:240px"${ts === 'at' ? '' : ' hidden'}></div></details>`;
  }
  function groupChannels() {
    let out = '', cat = null;
    for (const c of S.meta.channels) {
      if (c.category !== cat) { if (cat !== null) out += '</optgroup>'; cat = c.category; out += `<optgroup label="${esc(cat || 'No category')}">`; }
      out += `<option value="${c.id}"${c.id === S.channelId ? ' selected' : ''}>${c.news ? '📢' : '#'} ${esc(c.name)}</option>`;
    }
    return out + (cat !== null ? '</optgroup>' : '');
  }
  function read(d) {
    d.content = $('#mg_c').value;
    if (d.format === 'embed') {
      const e = d.embed;
      Object.assign(e, { title: $('#mg_t').value, description: $('#mg_d').value, url: $('#mg_u').value, color: $('#mg_col').value });
      e.author.name = $('#mg_an').value; e.author.url = $('#mg_au').value; e.footer.text = $('#mg_f').value;
      e.fields = [...document.querySelectorAll('.mg-fld')].map(r => ({ name: r.querySelector('.fn').value, value: r.querySelector('.fv').value, inline: r.querySelector('.fi').checked }));
      const t = $('#mg_ts').value; e.timestamp = t === 'now' ? 'now' : t === 'at' && $('#mg_tsat').value ? new Date($('#mg_tsat').value).toISOString() : '';
    }
    // pasted image links
    document.querySelectorAll('[data-pic]').forEach(w => { const u = w.querySelector('input[type=url]').value.trim(), cur = getP(d, w.dataset.pic) || '';
      if (u) setP(d, w.dataset.pic, u); else if (/^https:/.test(cur)) setP(d, w.dataset.pic, ''); });
  }
  function bind(pane, d, isPost) {
    const upd = () => { read(d); keep(); preview(d, isPost); };
    $('#mgBody').addEventListener('input', e => { if (e.target.id !== 'mg_q') upd(); });
    pane.querySelectorAll('[data-fmt]').forEach(b => b.onclick = () => { read(d); d.format = b.dataset.fmt; keep(); draw(pane); });
    document.querySelectorAll('[data-pic]').forEach(w => {
      const p = w.dataset.pic;
      w.querySelector('input[type=file]').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; read(d);
        if (f.size > 5e6) return toast('Images must be under 5 MB.', true);
        try { setP(d, p, f.type === 'image/gif' ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }) : await MTC.imageToDataUrl(f, p === 'image' ? 1600 : 512)); keep(); draw(pane); } catch (x) { toast(x.message, true); } };
      w.querySelector('input[type=url]').onchange = () => { read(d); keep(); draw(pane); };
      const rm = w.querySelector('[data-nopic]'); if (rm) rm.onclick = () => { read(d); setP(d, p, ''); keep(); draw(pane); };
    });
    if (d.format === 'embed') {
      $('#mg_addf').onclick = () => { read(d); d.embed.fields.push({ name: '', value: '', inline: true }); keep(); draw(pane); const r = document.querySelectorAll('.mg-fld'); r[r.length - 1].querySelector('.fn').focus(); };
      document.querySelectorAll('[data-fx]').forEach(b => b.onclick = () => { read(d); d.embed.fields.splice(+b.dataset.fx, 1); keep(); draw(pane); });
      $('#mg_ts').onchange = () => { $('#mg_tsat').hidden = $('#mg_ts').value !== 'at'; upd(); };
      $('#mgBody').addEventListener('change', e => { if (e.target.classList.contains('fi')) upd(); });
    }
    if (!isPost) $('#mg_dmment').onclick = () => { S.dmPing.mention = !S.dmPing.mention; $('#mg_dmment').setAttribute('aria-pressed', S.dmPing.mention); keep(); preview(d, isPost); };
    $('#mg_clear').onclick = () => { if (confirm('Clear this draft?')) { S.drafts[S.sub] = blank(); keep(); draw(pane); } };
    $('#mg_copy').onclick = () => { read(d); const to = isPost ? 'dm' : 'post';
      const has = S.drafts[to].content || S.drafts[to].embed.title || S.drafts[to].embed.description;
      if (has && !confirm(`Replace the ${to === 'dm' ? 'DM' : 'channel post'} draft with this one?`)) return;
      S.drafts[to] = norm(clone(d)); S.sub = to; keep(); draw(pane); toast('Copied. Pick who gets it, then send.'); };
    if (isPost) {
      $('#mg_ch').onchange = () => { S.channelId = $('#mg_ch').value; keep(); preview(d, isPost); };
      $('#mg_site').onchange = () => { S.showOnSite = $('#mg_site').checked; keep(); };
      pane.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { const k = b.dataset.pg; S.ping[k] = !S.ping[k]; b.setAttribute('aria-pressed', S.ping[k]); keep(); preview(d, isPost); });
      pane.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => { const id = b.dataset.pr, l = S.ping.roles; l.includes(id) ? l.splice(l.indexOf(id), 1) : l.push(id); b.setAttribute('aria-pressed', l.includes(id)); keep(); preview(d, isPost); });
    } else {
      pane.querySelectorAll('[data-dr]').forEach(b => b.onclick = () => { const id = b.dataset.dr, l = S.dmRoles; l.includes(id) ? l.splice(l.indexOf(id), 1) : l.push(id); b.setAttribute('aria-pressed', l.includes(id)); keep(); count(); });
      const q = $('#mg_q'), pick = $('#mg_pick');
      q.oninput = () => { const t = q.value.trim().toLowerCase().replace(/^@/, '');
        const list = t ? S.members.filter(m => !S.dmUsers.includes(m.id) && (m.name.toLowerCase().includes(t) || m.username.toLowerCase().includes(t))).slice(0, 30) : [];
        pick.hidden = !list.length;
        pick.innerHTML = list.map(m => `<button type="button" data-add="${m.id}">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : `<b class="i">${esc([...m.name][0])}</b>`}<span>${esc(m.name)} <span class="soft small">@${esc(m.username)}</span></span></button>`).join(''); };
      pick.onclick = e => { const b = e.target.closest('[data-add]'); if (!b) return; S.dmUsers.push(b.dataset.add); q.value = ''; pick.hidden = true; keep(); people(); count(); q.focus(); };
    }
    $('#mg_send').onclick = () => send(d, isPost, pane);
    $('#mg_sched_btn').onclick = () => schedule(d, isPost);
    loadSched();
  }
  function people() {
    $('#mg_people').innerHTML = S.dmUsers.map(id => { const m = S.members.find(x => x.id === id) || { name: id };
      return `<button type="button" class="chip" aria-pressed="true" data-rm="${id}" title="Remove">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : ''}${esc(m.name)} <span class="x">✕</span></button>`; }).join('') || '<span class="soft small">Nobody picked yet.</span>';
    $('#mg_people').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.dmUsers = S.dmUsers.filter(x => x !== b.dataset.rm); keep(); people(); count(); });
  }
  function count() {
    const roleSum = S.dmRoles.reduce((n, id) => n + ((S.meta.roles.find(r => r.id === id) || {}).members || 0), 0);
    const n = S.dmUsers.length + roleSum;
    $('#mg_count').innerHTML = n ? `About <b>${n}</b> ${n === 1 ? 'person' : 'people'} will get this (people in two picked roles get it once). Takes about ${Math.ceil(n * 1.1 / 60)} min.` : '<span class="soft">Pick people or roles.</span>';
  }
  function preview(d, isPost) {
    const chName = isPost ? ((S.meta.channels.find(c => c.id === S.channelId) || {}).name || '') : '';
    const pings = isPost ? [S.ping.everyone && '@everyone', S.ping.here && '@here', ...S.ping.roles.map(r => '@' + roleName(r))].filter(Boolean) : (S.dmPing.mention ? ['@Evil_GOD_NK'] : []);
    const fill = t => isPost ? String(t || '') : String(t || '').replace(/\{name\}/g, 'Evil_GOD_NK').replace(/\{mention\}/g, '@Evil_GOD_NK');
    const text = (pings.length ? pings.map(p => `<span class="mention">${esc(p)}</span>`).join(' ') + (d.content ? '<br>' : '') : '') + (d.content ? md(fill(d.content)) : '');
    const e = d.embed, flds = e.fields.filter(x => x.name || x.value);
    const tsTxt = e.timestamp === 'now' ? 'Today at ' + new Date().toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'}) : e.timestamp ? new Date(e.timestamp).toLocaleString('en-IN', {day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'}) : '';
    const embed = d.format === 'embed' && (e.title || e.description || d.image || e.thumbnail || flds.length || e.author.name) ? `<div class="em" style="border-left-color:${esc(e.color)}">
      ${e.thumbnail ? `<img class="th" src="${esc(e.thumbnail)}" alt="">` : ''}
      ${e.author.name ? `<div class="au">${e.author.icon ? `<img src="${esc(e.author.icon)}" alt="">` : ''}${esc(fill(e.author.name))}</div>` : ''}
      ${e.title ? `<div class="t">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(fill(e.title))}</a>` : esc(fill(e.title))}</div>` : ''}
      ${e.description ? `<div class="d">${md(fill(e.description))}</div>` : ''}
      ${flds.length ? `<div class="fl">${flds.map(x => `<div class="${x.inline ? 'in' : ''}"><b>${esc(fill(x.name))}</b>${md(fill(x.value))}</div>`).join('')}</div>` : ''}
      ${d.image ? `<img class="att" src="${esc(d.image)}" alt="">` : ''}
      ${e.footer.text || tsTxt ? `<div class="f">${e.footer.icon && e.footer.text ? `<img src="${esc(e.footer.icon)}" alt="">` : ''}${esc(fill(e.footer.text))}${e.footer.text && tsTxt ? ' • ' : ''}${esc(tsTxt)}</div>` : ''}</div>` : '';
    const img = d.format !== 'embed' && d.image ? `<img class="att" src="${esc(d.image)}" alt="">` : '';
    $('#mg_prev').innerHTML = `${isPost ? `<p class="small" style="margin:0 0 10px;color:#949ba4"># ${esc(chName)}</p>` : '<p class="small" style="margin:0 0 10px;color:#949ba4">Direct message</p>'}
      <div class="who"><div class="av"></div><div style="min-width:0;flex:1"><div class="nm">MTC<span>APP</span></div>
      <div class="tx">${text || (embed || img ? '' : '<span style="color:#949ba4">Your message shows here.</span>')}</div>${embed}${img}</div></div>`;
  }
  const msgBody = d => ({ content: d.content, embed: d.format === 'embed' ? d.embed : null, image: d.image });
  // after sending, uploads become server paths: keep them in the draft so it can be sent again without re-uploading
  const adopt = (d, m) => { d.image = m.image || ''; if (m.embed && d.format === 'embed') { d.embed.thumbnail = m.embed.thumbnail; d.embed.author.icon = m.embed.author.icon; d.embed.footer.icon = m.embed.footer.icon; } keep(); };
  async function send(d, isPost, pane) {
    read(d); const btn = $('#mg_send');
    try {
      if (isPost) {
        const ch = (S.meta.channels.find(c => c.id === S.channelId) || {}).name;
        const pings = [S.ping.everyone && '@everyone', S.ping.here && '@here', ...S.ping.roles.map(r => '@' + roleName(r))].filter(Boolean);
        if (!confirm(`Post in #${ch}${pings.length ? ' and ping ' + pings.join(', ') : ''}?`)) return;
        btn.disabled = true;
        const r = await api('/api/admin/messages/channel', {method: 'POST', body: {channelId: S.channelId, ping: S.ping, showOnSite: S.showOnSite, message: msgBody(d)}});
        adopt(d, r.message);
        toast('Posted in #' + ch + '.'); $('#mg_job').innerHTML = `<p class="msg ok small" style="margin-top:12px">Posted. <a href="${esc(r.link)}" target="_blank" rel="noopener">Open in Discord</a></p>`;
      } else {
        const n = $('#mg_count').textContent.match(/\d+/);
        if (!S.dmUsers.length && !S.dmRoles.length) throw new Error('Pick people or roles first.');
        if (!confirm(`Send this DM to ${n ? 'about ' + n[0] : 'the picked'} people?`)) return;
        btn.disabled = true;
        const r = await api('/api/admin/messages/dm', {method: 'POST', body: {users: S.dmUsers, roles: S.dmRoles, ping: S.dmPing, message: msgBody(d)}});
        S.job = r.job; watchJob();
      }
    } catch (x) { toast(x.message, true); } finally { btn.disabled = false; }
  }
  // ---- scheduled posts: the server keeps the request and sends it at the chosen time
  async function schedule(d, isPost) {
    read(d); const at = $('#mg_at').value; if (!at) return toast('Pick the date and time first.', true);
    const when = new Date(at); if (!(when > new Date(Date.now() + 60e3))) return toast('Pick a time at least a minute from now.', true);
    let body, label;
    if (isPost) { if (!S.channelId) return toast('Pick a channel.', true); body = {channelId: S.channelId, ping: S.ping, showOnSite: S.showOnSite, message: msgBody(d)}; label = '#' + ((S.meta.channels.find(c => c.id === S.channelId) || {}).name || 'channel'); }
    else { if (!S.dmUsers.length && !S.dmRoles.length) return toast('Pick people or roles first.', true); body = {users: S.dmUsers, roles: S.dmRoles, ping: S.dmPing, message: msgBody(d)}; label = 'DM: ' + [...S.dmRoles.map(r => '@' + roleName(r)), S.dmUsers.length ? S.dmUsers.length + ' people' : ''].filter(Boolean).join(', '); }
    if (!confirm(`Send this ${isPost ? 'post' : 'DM'} (${label}) on ${when.toLocaleString()}?`)) return;
    try { await api('/api/admin/scheduled', {method: 'POST', body: {kind: isPost ? 'channel' : 'dm', at: when.toISOString(), body, targetLabel: label}}); toast('Scheduled for ' + when.toLocaleString() + '.'); $('#mg_at').value = ''; loadSched(); }
    catch (x) { toast(x.message, true); }
  }
  async function loadSched() {
    const box = $('#mg_sched'); if (!box) return;
    let r; try { r = await api('/api/admin/scheduled'); } catch { return; }
    const items = r.scheduled.filter(s => s.status !== 'sent' || Date.now() - new Date(s.sentAt) < 3 * 864e5);
    box.innerHTML = items.length ? `<h3 style="margin-top:22px">🕒 SCHEDULED</h3><div class="list">${items.map(s => `<div class="item"><div class="grow"><b>${esc(s.summary)}</b> <span class="badge ${s.status === 'sent' ? 'approved' : s.status === 'failed' ? 'rejected' : 'pending'}">${s.status === 'waiting' ? 'WAITING' : s.status.toUpperCase()}</span><br>
      <span class="soft small">${esc(s.target)} · ${s.status === 'sent' ? 'sent ' + new Date(s.sentAt).toLocaleString() : new Date(s.at).toLocaleString()} · by ${esc(s.byName)}${s.error ? ' · ' + esc(s.error) : ''}</span></div>
      ${s.status === 'waiting' || s.status === 'failed' ? `<button class="btn grey sm" data-unsched="${s.id}" type="button">CANCEL</button>` : ''}</div>`).join('')}</div>` : '';
    box.querySelectorAll('[data-unsched]').forEach(b => b.onclick = async () => { if (!confirm('Cancel this scheduled message?')) return; await api('/api/admin/scheduled/' + b.dataset.unsched, {method: 'DELETE'}).catch(x => toast(x.message, true)); loadSched(); });
  }
  function watchJob() {
    const box = $('#mg_job'); if (!box || !S.job) return;
    const paint = j => { box.innerHTML = `<div style="margin-top:14px"><b>${j.done ? 'Finished' : 'Sending DMs...'}</b> ${j.sent} sent${j.failed ? `, ${j.failed} failed` : ''} of ${j.total}
      <div class="mg-prog"><i style="width:${Math.round((j.sent + j.failed) / j.total * 100)}%"></i></div>
      ${j.failures && j.failures.length ? `<details><summary class="small">Who did not get it</summary><ul class="small">${j.failures.map(f => `<li>${esc(f.name)}: ${esc(f.reason)}</li>`).join('')}</ul></details>` : ''}</div>`; };
    paint(S.job);
    clearInterval(window.__mgJob);
    window.__mgJob = setInterval(async () => {
      if (!document.body.contains(box)) return clearInterval(window.__mgJob);
      try { const r = await api('/api/admin/messages/jobs/' + S.job.id); S.job = r.job; paint(r.job); if (r.job.done) { clearInterval(window.__mgJob); toast(`DMs done: ${r.job.sent} sent, ${r.job.failed} failed.`); } }
      catch { clearInterval(window.__mgJob); S.job.done = true; }
    }, 2000);
  }
  async function history(box, pane) {
    box.innerHTML = '<p class="soft">Loading...</p>';
    let d; try { d = await api('/api/admin/messages'); } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
    const fmt = iso => new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}).format(new Date(iso));
    box.innerHTML = d.messages.length ? `<div class="list">${d.messages.map(m => { const t = m.message, e = t.embed;
      const who = m.kind === 'channel' ? `#${esc(m.target.channel)}${m.ping && (m.ping.everyone || m.ping.here || m.ping.roles.length) ? ' · pinged ' + esc([m.ping.everyone && '@everyone', m.ping.here && '@here', ...m.ping.roles.map(r => '@' + roleName(r))].filter(Boolean).join(', ')) : ''}`
        : `DM to ${m.target.count} ${[...m.target.roles.map(r => esc(r) + ' role'), ...m.target.users.map(esc)].slice(0, 6).join(', ')}`;
      const res = m.kind === 'channel' ? (m.result.link ? `<a href="${esc(m.result.link)}" target="_blank" rel="noopener">open</a>` : '') : m.result.sending ? 'sending...' : `${m.result.sent} sent${m.result.failed ? `, ${m.result.failed} failed` : ''}`;
      return `<div class="item" style="align-items:flex-start">${t.image ? `<img src="${esc(t.image)}" alt="" style="width:60px;height:60px;object-fit:cover;border:2px solid #000">` : ''}<div class="grow">
        <b>${esc((e && (e.title || (e.author && e.author.name))) || t.content.split('\n')[0].slice(0, 80) || '(image)')}</b> <span class="badge ${m.kind === 'channel' ? 'live' : 'verified'}">${m.kind === 'channel' ? 'CHANNEL' : 'DM'}${e ? ' · EMBED' : ''}</span><br>
        <span class="soft small">${who} · ${esc(fmt(m.at))} by ${esc(m.by)} · ${res}</span></div>
        <div class="row"><button class="btn grey sm" data-re="${m.id}" data-to="post">USE AS POST</button><button class="btn grey sm" data-re="${m.id}" data-to="dm">USE AS DM</button></div></div>`; }).join('')}</div>` : '<p class="soft">Nothing sent yet.</p>';
    box.querySelectorAll('[data-re]').forEach(b => b.onclick = () => { const m = d.messages.find(x => x.id === b.dataset.re).message, to = b.dataset.to;
      S.drafts[to] = norm({ format: m.embed ? 'embed' : 'plain', content: m.content, embed: m.embed ? clone(m.embed) : blankEmbed(), image: m.image || '' });
      S.sub = to; keep(); draw(pane); toast('Loaded into the ' + (to === 'dm' ? 'DM' : 'channel post') + ' composer.'); });
  }
  async function alerts(box) {
    box.innerHTML = '<p class="soft">Loading...</p>';
    let d; try { d = await api('/api/admin/alerts'); } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
    const a = d.alerts, kinds = Object.entries(d.kinds);
    let cat = null, opts = '<option value="">Off (no staff alerts)</option>';
    for (const c of S.meta.channels) { if (c.category !== cat) { if (cat !== null) opts += '</optgroup>'; cat = c.category; opts += `<optgroup label="${esc(cat || 'No category')}">`; }
      opts += `<option value="${c.id}"${c.id === a.staffChannel ? ' selected' : ''}>${c.news ? '📢' : '#'} ${esc(c.name)}</option>`; }
    const fmt = iso => new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}).format(new Date(iso));
    box.innerHTML = `<div class="grid2"><div class="card accent" style="margin:0"><h2>DM ALERTS TO MEMBERS</h2>
        <p class="soft small">When an admin approves or rejects something, the person gets a Discord DM from the bot, with buttons to the right page.</p>
        ${kinds.map(([k, l]) => `<label class="check"><input type="checkbox" data-dm="${k}"${a.dm[k] ? ' checked' : ''}> ${esc(l)}</label>`).join('')}
        <p class="soft small" style="margin-top:10px">When you reject something you can type a reason; it is included in the DM.</p></div>
      <div class="card accent" style="margin:0"><h2>STAFF ALERTS</h2>
        <p class="soft small">Post a note in a staff channel when something new needs review on the website.</p>
        <label for="al_ch">Staff channel</label><select id="al_ch">${opts}${cat !== null ? '</optgroup>' : ''}</select>
        ${kinds.filter(([k]) => k !== 'member').map(([k, l]) => `<label class="check"><input type="checkbox" data-st="${k}"${a.staff[k] ? ' checked' : ''}> New ${esc(l.toLowerCase())}</label>`).join('')}
        <label class="check" style="margin-top:12px"><input type="checkbox" id="al_fail"${a.reportFails ? ' checked' : ''}> <b>⚠️ Report DMs that could not be delivered</b> <span class="soft small">(goes to the staff channel, or the log channel if no staff channel is set)</span></label></div></div>
      <div class="card accent" style="margin-top:18px"><h2>ACTIVITY LOG CHANNEL</h2>
        <p class="soft small">Every change made on the website, by admins and members (approvals, edits, deletes, posts, DMs, logins, registrations, uploads, applications), is posted here. Use a private staff-only channel. You can also read it in the ACTIVITY tab.</p>
        <label for="al_log">Log channel</label><select id="al_log">${opts.replace('Off (no staff alerts)', 'Off (only keep the log on the website)').replace(/ selected/g, '').replace(`value="${a.logChannel}"`, `value="${a.logChannel}" selected`)}${cat !== null ? '</optgroup>' : ''}</select></div>
      <div class="row" style="margin-top:14px"><button class="btn" id="al_save" type="button">SAVE ALERT SETTINGS</button></div>
      <div class="card" style="margin-top:18px"><div class="row" style="margin-bottom:12px"><h2 style="margin:0;margin-right:auto">DM ALERTS SENT <span class="soft small">${d.log.filter(x => x.ok).length} delivered · ${d.log.filter(x => x.ok === false).length} failed</span></h2>
        <input type="search" id="al_q" placeholder="Search person, event, admin" style="max-width:240px">
        ${[['all', 'All'], ['ok', 'Delivered'], ['fail', 'Failed']].map(([k, l]) => `<button type="button" class="btn sm ${k === 'all' ? '' : 'grey'}" data-af="${k}">${l}</button>`).join('')}</div>
        <div class="list" id="al_list"></div></div>`;
    const KIND = { registration: '📝 Event registration', media: '🎬 Showcase upload', profile: '⭐ Creator profile', application: '🙋 Join application', member: '👤 Member' };
    const fmtLong = iso => new Intl.DateTimeFormat('en-IN', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(iso));
    let af = 'all';
    const drawLog = () => {
      const q = ($('#al_q').value || '').toLowerCase();
      const list = d.log.filter(x => (af === 'all' || (af === 'ok' ? x.ok : x.ok === false)) && (!q || JSON.stringify([x.title, x.text, x.toName, x.toUsername, x.by && x.by.name]).toLowerCase().includes(q)));
      $('#al_list').innerHTML = list.length ? list.map(x => `<details class="item" style="display:block;padding:12px 14px">
        <summary style="display:flex;gap:12px;align-items:center;cursor:pointer;list-style:none">
          ${x.toAvatar ? `<img src="${esc(x.toAvatar)}" alt="" style="width:40px;height:40px;border-radius:50%;border:2px solid #000;flex:none">` : `<b style="width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--accent-ink);flex:none">${esc([...(x.toName || '?')][0])}</b>`}
          <div style="flex:1;min-width:0"><b>${esc(x.title)}</b><br>
            <span class="small">To <b>${esc(x.toName || 'unknown')}</b>${x.toUsername ? ` <span class="soft">@${esc(x.toUsername)}</span>` : ''}${x.by ? ` · <span class="soft">because</span> ${esc(x.by.name)}${x.by.admin ? ' <span class="soft">(admin)</span>' : ''} <span class="soft">acted</span>` : ''}</span><br>
            <span class="soft small">${esc(KIND[x.kind] || x.kind)} · ${esc(fmt(x.at))}${x.tries > 1 ? ` · ${x.tries} tries` : ''}</span></div>
          ${x.ok ? '<span class="badge approved">DELIVERED</span>' : x.ok === false ? '<span class="badge rejected">FAILED</span>' : '<span class="badge pending">SENDING</span>'}
        </summary>
        <div style="margin-top:12px;display:grid;gap:10px">
          ${x.ok === false ? `<p class="msg err small" style="margin:0"><b>Why it failed:</b> ${esc(x.error || 'Unknown error')}</p>` : ''}
          ${x.text || x.buttons ? `<div class="dc" style="position:static;padding:12px"><div class="em" style="display:block;max-width:none;border-left-color:${{ok: '#4c9a2a', no: '#a63a2b', info: '#3a78b8'}[x.color] || '#3a78b8'}">
            <div class="t">${esc(x.title)}</div><div class="d">${window.MTCmd ? MTCmd.md(x.text || '') : esc(x.text || '')}</div></div>
            ${(x.buttons || []).length ? `<div class="row" style="gap:6px;margin-top:8px">${x.buttons.map(btn => `<a href="${esc(btn.url)}" target="_blank" rel="noopener" style="background:#4e5058;color:#fff;padding:6px 12px;border-radius:4px;font-size:13px;text-decoration:none">${esc(btn.label)} ↗</a>`).join('')}</div>` : ''}</div>` : '<p class="soft small" style="margin:0">Older entry: the message text was not kept.</p>'}
          <div class="small soft">Sent ${esc(fmtLong(x.at))}${x.lastTry && x.lastTry !== x.at ? ` · last try ${esc(fmtLong(x.lastTry))}` : ''} · Discord ID ${esc(x.to)}</div>
          ${x.ok === false && x.text ? `<div><button type="button" class="btn sm" data-retry="${esc(x.id)}">RETRY</button></div>` : ''}
        </div></details>`).join('') : '<p class="soft">Nothing here.</p>';
      box.querySelectorAll('[data-retry]').forEach(bt => bt.onclick = async () => { bt.disabled = true;
        try { const r = await api('/api/admin/alerts/' + bt.dataset.retry + '/retry', {method: 'POST'}); toast(r.ok ? 'Delivered this time.' : 'Still failed: ' + r.error, !r.ok); Object.assign(d.log.find(x => x.id === bt.dataset.retry), r.alert); drawLog(); }
        catch (x) { toast(x.message, true); bt.disabled = false; } });
    };
    $('#al_q').oninput = drawLog;
    box.querySelectorAll('[data-af]').forEach(bt => bt.onclick = () => { af = bt.dataset.af; box.querySelectorAll('[data-af]').forEach(o => o.classList.toggle('grey', o !== bt)); drawLog(); });
    drawLog();
    $('#al_save').onclick = async () => {
      const dm = {}, staff = {}; box.querySelectorAll('[data-dm]').forEach(c => dm[c.dataset.dm] = c.checked); box.querySelectorAll('[data-st]').forEach(c => staff[c.dataset.st] = c.checked); staff.member = false;
      try { await api('/api/admin/alerts', {method: 'PUT', body: {dm, staff, staffChannel: $('#al_ch').value, logChannel: $('#al_log').value, reportFails: $('#al_fail').checked}}); toast('Alert settings saved.'); } catch (x) { toast(x.message, true); }
    };
  }
  async function news(box) {
    box.innerHTML = '<p class="soft">Loading...</p>';
    let d; try { d = await api('/api/admin/data'); } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
    const fmt = iso => new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(iso));
    box.innerHTML = `<div class="grid2"><div class="card" style="margin:0"><h2>ON THE WEBSITE (${d.announcements.length})</h2>
        <p class="soft small">The newest one shows on the home page. Delete it here, or with the <b>✕ DELETE NEWS</b> button on the home page while logged in as an admin.</p>
        ${d.announcements.length ? `<div class="list">${d.announcements.map((a, i) => `<div class="item" style="align-items:flex-start">${a.image ? `<img src="${esc(a.image)}" alt="" style="width:64px;height:64px;object-fit:cover;border:2px solid #000">` : ''}
          <div class="grow"><b>${esc(a.title)}</b> ${i === 0 ? '<span class="badge live">ON HOME PAGE</span>' : ''}<div class="md small" style="margin-top:4px">${window.MTCmd ? MTCmd.md(a.body || '') : esc(a.body || '')}</div>
          <span class="soft small">${esc(fmt(a.createdAt))}${a.postedToDiscord ? ' · also posted in Discord' : ''}</span></div>
          <button class="btn red sm" data-delnews="${esc(a.id)}">DELETE</button></div>`).join('')}</div>` : '<p class="soft">No news on the website.</p>'}</div>
      <div class="card accent" style="margin:0"><h2>ADD WEBSITE NEWS</h2><p class="soft small">Shows on the home page only, not in Discord. To post in Discord too, use CHANNEL POST and tick "Also show on the website".</p>
        <label for="wn_t">Title</label><input type="text" id="wn_t" maxlength="120">
        <label for="wn_b">Message</label><textarea data-md id="wn_b" maxlength="2000" rows="5"></textarea>
        <div style="margin-top:14px"><button class="btn" id="wn_go" type="button">PUBLISH ON WEBSITE</button></div></div></div>`;
    box.querySelectorAll('[data-delnews]').forEach(b => b.onclick = async () => { const a = d.announcements.find(x => x.id === b.dataset.delnews);
      if (!confirm(`Delete "${a.title}" from the website?`)) return; b.disabled = true;
      try { await api('/api/admin/announcements/' + a.id, {method: 'DELETE'}); toast('Deleted.'); news(box); } catch (x) { toast(x.message, true); b.disabled = false; } });
    $('#wn_go').onclick = async () => { const t = $('#wn_t').value.trim(); if (!t) return toast('Add a title.', true);
      try { await api('/api/admin/announce', {method: 'POST', body: {title: t, body: $('#wn_b').value, discord: false}}); toast('Published on the website.'); news(box); } catch (x) { toast(x.message, true); } };
  }
  window.MTCMessages = { tab };
})();
