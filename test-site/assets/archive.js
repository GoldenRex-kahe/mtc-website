/* Admin: the event archive (files people need to recreate an event).
   Normally each file is a LINK to where it is really stored (GitHub Releases, Google Drive, MediaFire...), so downloads
   use none of our server's bandwidth. If ARCHIVE_UPLOADS=on in .env, files can also be uploaded here in 32 MB pieces
   (the Cloudflare tunnel refuses single requests over 100 MB) and a dropped connection resumes from the last piece. */
(function () {
  'use strict';
  const { esc, api, toast } = MTC;
  const TYPES = { world: '🌍 World', plugins: '🔌 Plugins', mods: '🧩 Mods', datapack: '📦 Datapack', resourcepack: '🎨 Resource pack', config: '⚙️ Config', schematic: '🏗️ Schematic', other: '🗃️ Other' };
  const size = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const guessType = n => /\.(mcworld|mctemplate)$/i.test(n) || /world|map|region/i.test(n) ? 'world' : /\.jar$/i.test(n) ? (/mod/i.test(n) ? 'mods' : 'plugins') : /\.(mcpack)$/i.test(n) || /resource|texture/i.test(n) ? 'resourcepack'
    : /datapack|data ?pack/i.test(n) ? 'datapack' : /\.(schem|schematic|litematic|nbt)$/i.test(n) ? 'schematic' : /\.(ya?ml|toml|properties|json)$/i.test(n) ? 'config' : 'other';
  const AR_TYPE = { world: ['🌍', 'World', '#2f6b2a'], plugins: ['🔌', 'Plugins', '#5b3d8a'], mods: ['🧩', 'Mods', '#1f6a6a'], datapack: ['📦', 'Datapack', '#8a5a1c'],
    resourcepack: ['🎨', 'Resource pack', '#8a3d63'], config: ['⚙️', 'Config', '#4a4f57'], schematic: ['🏗️', 'Schematic', '#2b5486'], other: ['🗃️', 'Files', '#6b4a2b'] };
  const HOSTS = [[/(^|\.)github\.com$/, 'GitHub'], [/drive\.google\.com$/, 'Google Drive'], [/mediafire\.com$/, 'MediaFire'], [/workupload\.com$/, 'Workupload'],
    [/modrinth\.com$/, 'Modrinth'], [/kovaihost\.cloud$/, 'KovaiHost'], [/pingforge\.cloud$/, 'PingForge'], [/dropbox\.com$/, 'Dropbox'], [/mega\.(nz|io)$/, 'MEGA'],
    [/curseforge\.com$/, 'CurseForge'], [/planetminecraft\.com$/, 'Planet Minecraft'], [/onedrive\.live\.com|1drv\.ms|sharepoint\.com$/, 'OneDrive']];
  const hostName = f => !f.link ? 'MTC server' : (HOSTS.find(([re]) => re.test(f.host)) || [0, f.host])[1];
  const send = (url, opt) => fetch(url, { credentials: 'same-origin', ...opt, headers: { 'X-MTC': '1', ...(opt && opt.headers) } });

  function section(e) {
    if (!e) return `<h3 style="margin-top:24px">📦 ARCHIVE: RECREATE THIS EVENT</h3><p class="soft small">Save the event first, then open it again to add world downloads, plugins and packs.</p>`;
    return `<h3 style="margin-top:24px">📦 ARCHIVE: RECREATE THIS EVENT</h3>
      <p class="soft small">Files and notes so anyone can run this event again. Shown on the event page under <b>Recreate this event</b>.</p>
      <div class="fields"><div><label for="f_mcv">Minecraft version</label><input type="text" id="f_mcv" maxlength="40" placeholder="e.g. 1.21.4" value="${esc(e.mcVersion || '')}"></div>
        <div><label for="f_sw">Server software</label><input type="text" id="f_sw" maxlength="60" placeholder="e.g. Paper, Fabric, Bedrock Dedicated Server" value="${esc(e.software || '')}"></div>
        <div class="full"><label for="f_rn">How to set it up</label><textarea data-md id="f_rn" maxlength="6000" placeholder="1. Unzip the world into the server folder&#10;2. Put the plugins in /plugins&#10;3. ...">${esc(e.recreateNotes || '')}</textarea></div></div>
      <div id="arList" style="margin-top:12px"></div>
      <div class="ar-add">
        <b>🔗 ADD A NEW FILE BY LINK</b>
        <p class="soft small" style="margin:4px 0 10px">Put the file on <b>GitHub Releases</b> (best: free, up to 2 GB per file, fast), Google Drive, MediaFire or Modrinth, then paste its link. For a second link to the same file, use <b>+ ADD MIRROR LINK</b> on its card instead. Visitors download from there, so it costs our server no bandwidth. Make sure the link is public.</p>
        <div class="fields"><div class="full"><label for="al_url">Download link</label><input type="url" id="al_url" placeholder="https://github.com/.../releases/download/.../world.zip"></div>
          <div><label for="al_name">Name</label><input type="text" id="al_name" maxlength="100" placeholder="e.g. Hide and Seek map"></div>
          <div><label for="al_type">Type</label><select id="al_type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div><label for="al_size">Size <span class="soft small">(optional)</span></label><input type="text" id="al_size" maxlength="20" placeholder="e.g. 850 MB"></div>
          <div><label for="al_note">Note <span class="soft small">(optional)</span></label><input type="text" id="al_note" maxlength="300"></div></div>
        <label class="check"><input type="checkbox" id="al_mem"> Members only (must log in with Discord)</label>
        <button type="button" class="btn sm" id="al_add" style="margin-top:8px">ADD LINK</button>
      </div>
      <div id="arUpWrap" hidden><div class="ar-drop" id="arDrop" tabindex="0" role="button" aria-label="Upload files to this server">
        <b>Or upload to this server:</b> drop files here or click to choose <span class="soft small">(uses this server's bandwidth for every download; up to 8 GB each) <span id="arDisk"></span></span>
        <input type="file" id="arPick" multiple hidden></div>
      <div id="arUp"></div></div>`;
  }

  function bind(e) {
    if (!e) return;
    e.files = e.files || [];
    const list = document.getElementById('arList'), drop = document.getElementById('arDrop'), pick = document.getElementById('arPick'), upBox = document.getElementById('arUp');
    api('/api/admin/archive').then(d => {
      if (!d.uploads) return; document.getElementById('arUpWrap').hidden = false;
      const el = document.getElementById('arDisk'); if (el && d.free != null) el.textContent = `Free space: ${size(d.free)} · uploads use ${size(d.used)}.`; }).catch(() => {});
    const typeFromUrl = url => { try { return guessType(decodeURIComponent(new URL(url).pathname.split('/').pop())); } catch { return 'other'; } };
    const urlIn = document.getElementById('al_url');
    urlIn.addEventListener('change', () => { const t = typeFromUrl(urlIn.value); if (t !== 'other') document.getElementById('al_type').value = t;
      const nm = document.getElementById('al_name'); if (!nm.value) { try { const last = decodeURIComponent(new URL(urlIn.value).pathname.split('/').pop()); if (/\.\w{2,9}$/.test(last)) nm.value = last.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '); } catch {} } });
    document.getElementById('al_add').onclick = async () => {
      const g = id => document.getElementById(id);
      try {
        const d = await api('/api/admin/events/' + e.id + '/files/link', {method: 'POST', body: {url: g('al_url').value, name: g('al_name').value, type: g('al_type').value, size: g('al_size').value, note: g('al_note').value, members: g('al_mem').checked}});
        const nf = {...d.file, url: g('al_url').value.trim()}; e.files.push(nf); draw(); ['al_url', 'al_name', 'al_size', 'al_note'].forEach(id => { g(id).value = ''; }); g('al_mem').checked = false; toast('Link added. Checking it…');
        runCheck(nf).then(c => { draw(); if (c && !c.ok) toast(`That link looks broken: ${c.note}.`, true); }).catch(() => {});
      } catch (x) { toast(x.message, true); }
    };
    /* ---- the file list: same cards as the event page. Links with the same name are one file with mirrors. ---- */
    const groups = () => { const gs = []; for (const f of e.files) { const k = f.name.trim().toLowerCase(), g = gs.find(x => x.key === k); g ? g.links.push(f) : gs.push({ key: k, links: [f] }); } return gs; };
    const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    const pill = f => !f.check ? '' : f.check.ok ? `<span class="ar-ok" title="Checked ${ago(f.check.at)}">✓ ${esc(f.check.note || 'Online')}</span>` : `<span class="ar-bad" title="Checked ${ago(f.check.at)}">✗ ${esc(f.check.note || 'Broken')}</span>`;
    const opts = t => Object.entries(TYPES).map(([k, l]) => `<option value="${k}"${t === k ? ' selected' : ''}>${l}</option>`).join('');
    const draw = () => {
      const gs = groups();
      list.innerHTML = !gs.length ? '<p class="soft small">No files yet. Add one by link below.</p>' : `
        <div class="row" style="justify-content:space-between;margin-bottom:10px"><span class="soft small">${gs.length} file${gs.length === 1 ? '' : 's'} · ${e.files.length} link${e.files.length === 1 ? '' : 's'}. Same name = one file with mirror links.</span>
          ${e.files.some(f => f.link) ? '<button type="button" class="btn grey sm" data-checkall>CHECK ALL LINKS</button>' : ''}</div>
        <div class="ar-files">${gs.map((g, gi) => { const f0 = g.links[0], [ic, , col] = AR_TYPE[f0.type] || AR_TYPE.other, sz = Math.max(0, ...g.links.map(f => f.size || 0)), dl = g.links.reduce((a, f) => a + (f.downloads || 0), 0);
          return `<article class="ar-card ar-adm" data-g="${gi}" style="--tc:${col}">
          <header class="ar-head"><span class="ar-ic" aria-hidden="true">${ic}</span>
            <div class="ar-title" style="flex:1">
              <div class="ar-grow2"><input type="text" class="g-name" value="${esc(f0.name)}" maxlength="100" aria-label="File name"><select class="g-type" aria-label="Type">${opts(f0.type)}</select></div>
              <div class="ar-meta">${sz ? `<span>${size(sz)}</span>` : ''}<span>${g.links.length} link${g.links.length === 1 ? '' : 's'}</span><span>${dl} download${dl === 1 ? '' : 's'}</span>
                <label class="check" style="margin:0"><input type="checkbox" class="g-mem"${g.links.some(f => f.members) ? ' checked' : ''}> Members only</label></div></div>
            <div class="ar-tools"><button type="button" class="btn grey sm" data-gmv="-1"${gi ? '' : ' disabled'} aria-label="Move file up">▲</button><button type="button" class="btn grey sm" data-gmv="1"${gi < gs.length - 1 ? '' : ' disabled'} aria-label="Move file down">▼</button><button type="button" class="btn sm" data-gsave>SAVE</button></div></header>
          <ul class="ar-links">${g.links.map((f, i) => `<li data-f="${f.id}"><span class="ar-host" aria-hidden="true">${esc(hostName(f)[0].toUpperCase())}</span>
            <div class="ar-src"><div><b>${esc(hostName(f))}</b>${i === 0 && g.links.length > 1 ? '<span class="ar-best">MAIN</span>' : ''} ${pill(f)}</div>
              <span>${[f.note && esc(f.note), f.size ? size(f.size) : '', `${f.downloads || 0} downloads`].filter(Boolean).join(' · ')}</span>
              ${f.link ? (f.url ? `<a class="ar-u" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url)}</a>` : '') : `<span class="ar-u">On this server: ${esc(f.original)}</span>`}
              <div class="ar-ed" hidden>${f.link ? `<input type="url" class="l-url" value="${esc(f.url || '')}" aria-label="Download link">` : ''}
                <div class="ar-grow2"><input type="text" class="l-note" value="${esc(f.note || '')}" maxlength="300" placeholder="Label, e.g. Deepstorage, Fast mirror" aria-label="Label">${f.link ? `<input type="text" class="l-size" value="${f.size ? esc(size(f.size)) : ''}" placeholder="Size" aria-label="Size" style="max-width:120px">` : ''}</div>
                <button type="button" class="btn sm" data-lsave>SAVE LINK</button></div></div>
            <div class="ar-lb">${i ? '<button type="button" class="btn grey sm" data-main title="Make this the main download">MAKE MAIN</button>' : ''}${f.link ? '<button type="button" class="btn grey sm" data-check>CHECK</button>' : ''}<button type="button" class="btn grey sm" data-edit>EDIT</button><button type="button" class="btn red sm" data-del>REMOVE</button></div></li>`).join('')}</ul>
          <div class="ar-mirror"><button type="button" class="btn grey sm" data-mirror>+ ADD MIRROR LINK</button>
            <div class="ar-mf" hidden><input type="url" class="m-url" placeholder="Another download link for this same file" aria-label="Mirror link"><input type="text" class="m-note" maxlength="300" placeholder="Label (optional)" aria-label="Mirror label"><button type="button" class="btn sm" data-madd>ADD</button></div></div>
          </article>`; }).join('')}</div>`;
    };
    // first paint from what the page has, then reload with the real link addresses and last checks
    draw();
    api('/api/admin/events/' + e.id + '/files').then(d => { e.files = d.files; draw(); }).catch(() => {});
    const saveOrder = gs => { e.files = gs.flatMap(g => g.links); draw(); return api('/api/admin/events/' + e.id + '/files-order', {method: 'PUT', body: {ids: e.files.map(f => f.id)}}); };
    const runCheck = async f => { const d = await api('/api/admin/events/' + e.id + '/files/' + f.id + '/check', {method: 'POST'}); f.check = d.check; if (d.size) f.size = d.size; return d.check; };
    list.addEventListener('click', async ev => {
      const t = ev.target.closest('button'); if (!t) return;
      const card = t.closest('.ar-card'), gs = groups(), g = card && gs[+card.dataset.g], li = t.closest('li[data-f]'), f = li && e.files.find(x => x.id === li.dataset.f);
      const base = f && '/api/admin/events/' + e.id + '/files/' + f.id;
      try {
        if (t.matches('[data-checkall]')) { t.disabled = true; t.textContent = 'CHECKING…'; let bad = 0;
          for (const x of e.files.filter(x => x.link)) { const c = await runCheck(x).catch(() => null); if (!c || !c.ok) bad++; }
          draw(); toast(bad ? `${bad} link${bad === 1 ? ' looks' : 's look'} broken. Fix or remove ${bad === 1 ? 'it' : 'them'}.` : 'All links work.', !!bad); return; }
        if (t.matches('[data-gsave]')) { const body = { name: card.querySelector('.g-name').value.trim(), type: card.querySelector('.g-type').value, members: card.querySelector('.g-mem').checked };
          if (!body.name) throw new Error('Give the file a name.');
          for (const x of g.links) { await api('/api/admin/events/' + e.id + '/files/' + x.id, {method: 'PUT', body}); Object.assign(x, body); }
          draw(); toast('Saved.'); return; }
        if (t.matches('[data-gmv]')) { const i = gs.indexOf(g), j = i + +t.dataset.gmv; [gs[i], gs[j]] = [gs[j], gs[i]]; await saveOrder(gs); return; }
        if (t.matches('[data-main]')) { g.links = [f, ...g.links.filter(x => x !== f)]; await saveOrder(gs); toast(`${hostName(f)} is now the main download.`); return; }
        if (t.matches('[data-check]')) { t.disabled = true; t.textContent = '…'; const c = await runCheck(f); draw(); toast(`${hostName(f)}: ${c.note}.`, !c.ok); return; }
        if (t.matches('[data-edit]')) { const ed = li.querySelector('.ar-ed'); ed.hidden = !ed.hidden; t.textContent = ed.hidden ? 'EDIT' : 'CLOSE'; return; }
        if (t.matches('[data-lsave]')) { const body = { note: li.querySelector('.l-note').value }, nu = li.querySelector('.l-url'), ns = li.querySelector('.l-size');
          if (nu && nu.value.trim() !== f.url) body.url = nu.value.trim(); if (ns) body.size = ns.value;
          await api(base, {method: 'PUT', body}); const d = await api('/api/admin/events/' + e.id + '/files'); e.files = d.files; draw(); toast('Link saved.'); return; }
        if (t.matches('[data-del]')) { if (!confirm(f.link ? `Remove the ${hostName(f)} link for "${f.name}"? (The file itself stays on ${f.host}.)` : `Delete "${f.name}" (${size(f.size)}) from this server? This cannot be undone.`)) return;
          await api(base, {method: 'DELETE'}); e.files = e.files.filter(x => x !== f); draw(); toast('Removed.'); return; }
        if (t.matches('[data-mirror]')) { const mf = card.querySelector('.ar-mf'); mf.hidden = !mf.hidden; if (!mf.hidden) mf.querySelector('.m-url').focus(); return; }
        if (t.matches('[data-madd]')) { const f0 = g.links[0], url = card.querySelector('.m-url').value.trim();
          const d = await api('/api/admin/events/' + e.id + '/files/link', {method: 'POST', body: {url, note: card.querySelector('.m-note').value, name: f0.name, type: f0.type, members: g.links.some(x => x.members)}});
          const nf = {...d.file, url}, last = e.files.indexOf(g.links[g.links.length - 1]); e.files.splice(last + 1, 0, nf); await saveOrder(groups());
          runCheck(nf).then(draw).catch(() => {}); toast('Mirror added.'); return; }
      } catch (x) { toast(x.message, true); draw(); }
    });
    drop.onclick = () => pick.click(); drop.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick.click(); } };
    drop.ondragover = ev => { ev.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = ev => { ev.preventDefault(); drop.classList.remove('over'); queue([...ev.dataTransfer.files]); };
    pick.onchange = () => { queue([...pick.files]); pick.value = ''; };
    let busy = Promise.resolve();
    const queue = files => files.forEach(file => { busy = busy.then(() => upload(file)); });
    async function upload(file) {
      const row = document.createElement('div'); row.className = 'ar-prog';
      row.innerHTML = `<div class="row"><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)}</b><span class="small soft" data-s>waiting…</span><button type="button" class="btn grey sm" data-x>CANCEL</button></div><div class="mg-prog"><i style="width:0%"></i></div>`;
      upBox.appendChild(row);
      const bar = row.querySelector('i'), st = row.querySelector('[data-s]'); let cancelled = false, id;
      row.querySelector('[data-x]').onclick = () => { cancelled = true; };
      try {
        const s = await api('/api/admin/events/' + e.id + '/files/start', {method: 'POST', body: {name: file.name, size: file.size}}); id = s.upload;
        const CH = s.chunk, t0 = Date.now(); let off = 0, tries = 0;
        while (off < file.size) {
          if (cancelled) throw new Error('Cancelled.');
          const end = Math.min(file.size, off + CH);
          try {
            const r = await send(`/api/admin/uploads/${id}?offset=${off}`, {method: 'PUT', headers: {'Content-Type': 'application/octet-stream'}, body: file.slice(off, end)});
            const j = await r.json().catch(() => ({}));
            if (r.status === 409 && j.received != null) { off = j.received; continue; }   // server has a different amount: carry on from there
            if (!r.ok) throw new Error(j.error || 'Upload failed (' + r.status + ')');
            off = j.received; tries = 0;
          } catch (x) {
            if (++tries > 6) throw x;                                               // network hiccup: wait and resume
            st.textContent = `connection lost, retrying (${tries}/6)…`; await new Promise(r => setTimeout(r, 1500 * tries));
            const g = await api('/api/admin/uploads/' + id).catch(() => null); if (g) off = g.received; continue;
          }
          const pct = off / file.size * 100, speed = off / Math.max(1, (Date.now() - t0) / 1000);
          bar.style.width = pct.toFixed(1) + '%'; st.textContent = `${size(off)} of ${size(file.size)} · ${size(speed)}/s`;
        }
        st.textContent = 'checking file…';
        const done = await api(`/api/admin/uploads/${id}/finish`, {method: 'POST', body: {type: guessType(file.name), name: file.name.replace(/\.[^.]+$/, '')}});
        e.files.push(done.file); draw(); row.remove(); toast(`Added ${file.name} to the archive.`);
      } catch (x) {
        st.textContent = x.message; bar.style.background = '#a63a2b'; row.querySelector('[data-x]').textContent = 'CLOSE'; row.querySelector('[data-x]').onclick = () => row.remove();
        if (id) send('/api/admin/uploads/' + id, {method: 'DELETE'}).catch(() => {});
      }
    }
  }
  const read = () => ({ mcVersion: (document.getElementById('f_mcv') || {}).value, software: (document.getElementById('f_sw') || {}).value, recreateNotes: (document.getElementById('f_rn') || {}).value });
  window.MTCArchive = { section, bind, read };
})();
