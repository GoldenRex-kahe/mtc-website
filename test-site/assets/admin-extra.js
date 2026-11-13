/* Admin: community (polls, ideas, feedback, team finder), season & badges, stats, member notes,
   whitelist export, check-in and event templates. Used by admin.html. */
(function () {
  'use strict';
  const { esc, api, toast, day } = MTC;
  const $ = s => document.querySelector(s);
  const fmt = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const local = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  const dateOnly = iso => iso ? String(iso).slice(0, 10) : '';
  const face = (src, name) => src ? `<img src="${esc(src)}" alt="" loading="lazy" style="width:32px;height:32px;border:2px solid #000;flex:none">` : `<b class="badge" style="width:32px;height:32px;display:grid;place-items:center;flex:none">${esc([...(name || '?')][0])}</b>`;
  let members = null;
  const loadMembers = () => members ? Promise.resolve(members) : api('/api/admin/members').then(d => (members = d.members)).catch(() => (members = []));
  // a text box that suggests Discord members; returns the picked member (or the typed name)
  function memberField(id, label, opt = {}) {
    setTimeout(() => loadMembers().then(ms => { const dl = document.getElementById(id + '_l'); if (dl) dl.innerHTML = ms.map(m => `<option value="${esc(m.name)} (@${esc(m.username)})"></option>`).join(''); }), 0);
    return `<div${opt.full ? ' class="full"' : ''}><label for="${id}">${label}</label><input type="text" id="${id}" list="${id}_l" autocomplete="off" placeholder="Type a name or @username"><datalist id="${id}_l"></datalist></div>`;
  }
  const readMember = id => { const v = (document.getElementById(id) || {}).value || '', m = /\(@([^)]+)\)\s*$/.exec(v); const found = members && members.find(x => m ? x.username === m[1] : x.name === v.trim() || x.username === v.trim().replace(/^@/, '')); return { member: found || null, text: v.replace(/\s*\(@[^)]+\)\s*$/, '').trim() }; };
  const subTabs = (box, tabs, cur, go) => { box.innerHTML = `<div class="row" role="tablist" style="gap:6px;margin-bottom:16px">${tabs.map(([k, l, n]) => `<button type="button" class="btn ${k === cur ? '' : 'grey'} sm" data-st="${k}" aria-selected="${k === cur}">${l}${n ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}</div><div id="stPane"></div>`;
    box.querySelectorAll('[data-st]').forEach(b => b.onclick = () => go(b.dataset.st)); return box.querySelector('#stPane'); };

  /* ======================================================================= COMMUNITY */
  let commTab = sessionStorage.getItem('mtcComm') || 'polls';
  async function community(pane) {
    const sug = await api('/api/admin/suggestions').catch(() => ({ suggestions: [] }));
    const fresh = sug.suggestions.filter(s => s.status === 'new' && !s.hidden).length;
    const go = k => { commTab = k; sessionStorage.setItem('mtcComm', k); community(pane); };
    const p = subTabs(pane, [['polls', '🗳️ POLLS'], ['ideas', '💡 EVENT IDEAS', fresh], ['feedback', '⭐ FEEDBACK'], ['lfg', '🤝 TEAM FINDER']], commTab, go);
    ({ polls, ideas: () => ideas(p, sug), feedback, lfg }[commTab] || polls)(p);
  }
  async function polls(p) {
    const d = await api('/api/admin/polls');
    p.innerHTML = `<div class="card accent"><h2>NEW POLL</h2><p class="soft small">Members vote on the website (Community page). One vote per member; they can change it until it closes.</p>
      <div class="fields"><div class="full"><label for="pq">Question</label><input type="text" id="pq" maxlength="200" placeholder="What should the next MTC event be?"></div>
        <div class="full"><label for="po">Options <span class="soft">(one per line, 2 to 12)</span></label><textarea id="po" rows="4" placeholder="Hunger Games&#10;Build battle&#10;Manhunt"></textarea></div>
        <div class="full"><label for="pn">Note <span class="soft">(optional)</span></label><input type="text" id="pn" maxlength="300"></div>
        <div><label for="pe">Closes <span class="soft">(optional)</span></label><input type="datetime-local" id="pe"></div>
        <div><label for="pr">Show results</label><select id="pr"><option value="voted">After they vote</option><option value="always">Always</option><option value="closed">Only when the poll closes</option></select></div></div>
      <label class="check"><input type="checkbox" id="pm"> Members can pick more than one option</label>
      <div style="margin-top:12px"><button class="btn" id="padd" type="button">START POLL</button></div></div>
      <div class="list">${d.polls.map(q => { const max = Math.max(1, ...q.options.map(o => o.votes || 0));
        return `<div class="card" data-poll="${q.id}" style="margin-bottom:14px"><div class="row"><h3 style="margin:0;flex:1">${esc(q.question)}</h3><span class="badge ${q.open ? 'live' : 'withdrawn'}">${q.open ? 'OPEN' : 'CLOSED'}</span></div>
          <p class="soft small">${q.voters} voter${q.voters === 1 ? '' : 's'}${q.endsAt ? ' · closes ' + esc(fmt(q.endsAt)) : ''}${q.multi ? ' · multiple choice' : ''}</p>
          ${q.options.map(o => `<div class="pbar" title="${esc(o.text)}: ${o.votes} vote${o.votes === 1 ? '' : 's'}"><span>${esc(o.text)}</span><i style="width:${Math.round((o.votes || 0) / max * 100)}%"></i><b>${o.votes || 0}</b></div>`).join('')}
          <div class="row" style="margin-top:12px"><button class="btn grey sm" data-pc="${q.closed ? 0 : 1}">${q.closed ? 'REOPEN' : 'CLOSE NOW'}</button><button class="btn grey sm" data-pd>POST TO DISCORD</button><a class="btn grey sm" href="/community.html#poll-${q.id}" target="_blank" rel="noopener">VIEW</a><button class="btn red sm" data-px style="margin-left:auto">DELETE</button></div><div class="pdc"></div></div>`; }).join('') || '<p class="soft">No polls yet.</p>'}</div>`;
    $('#padd').onclick = async () => {
      try { await api('/api/admin/polls', { method: 'POST', body: { question: $('#pq').value, options: $('#po').value.split('\n').map(s => s.trim()).filter(Boolean), note: $('#pn').value, endsAt: $('#pe').value ? new Date($('#pe').value).toISOString() : '', results: $('#pr').value, multi: $('#pm').checked } }); toast('Poll started.'); polls(p); }
      catch (x) { toast(x.message, true); } };
    p.querySelectorAll('[data-poll]').forEach(card => {
      const id = card.dataset.poll;
      card.querySelector('[data-pc]').onclick = e => api('/api/admin/polls/' + id, { method: 'PUT', body: { closed: e.target.dataset.pc === '1' } }).then(() => { toast('Saved.'); polls(p); }).catch(x => toast(x.message, true));
      card.querySelector('[data-px]').onclick = () => { if (confirm('Delete this poll and its votes?')) api('/api/admin/polls/' + id, { method: 'DELETE' }).then(() => polls(p)).catch(x => toast(x.message, true)); };
      card.querySelector('[data-pd]').onclick = async () => {
        const box = card.querySelector('.pdc'); if (box.innerHTML) { box.innerHTML = ''; return; }
        let meta; try { meta = await api('/api/admin/discord/meta'); } catch (x) { return toast(x.message, true); }
        box.innerHTML = `<div class="row" style="margin-top:12px"><select class="pch" style="max-width:300px">${meta.channels.map(c => `<option value="${c.id}"${c.id === meta.defaultChannel ? ' selected' : ''}>#${esc(c.name)}</option>`).join('')}</select><label class="check" style="margin:0"><input type="checkbox" class="pping"> Ping @everyone</label><button class="btn sm" type="button">POST</button></div>`;
        box.querySelector('button').onclick = () => api('/api/admin/polls/' + id + '/discord', { method: 'POST', body: { channelId: box.querySelector('.pch').value, ping: box.querySelector('.pping').checked } }).then(() => { toast('Posted to Discord.'); box.innerHTML = ''; }).catch(x => toast(x.message, true));
      };
    });
  }
  function ideas(p, d) {
    const st = d.statuses || {};
    p.innerHTML = d.suggestions.length ? `<p class="soft small">Ideas members and creators posted on the Community page. Changing the status DMs the person who suggested it.</p><div class="list">${d.suggestions.map(s => `<div class="item" data-sug="${s.id}" style="align-items:flex-start${s.hidden ? ';opacity:.55' : ''}">${face(s.by.avatar, s.by.name)}
      <div class="grow"><b>${esc(s.title)}</b> <span class="badge ${s.status === 'done' ? 'approved' : s.status === 'declined' ? 'rejected' : s.status === 'planned' ? 'live' : 'pending'}">${esc(st[s.status] || s.status)}</span>${s.hidden ? ' <span class="badge withdrawn">HIDDEN</span>' : ''}<br>
        <span class="soft small">by ${esc(s.by.name)} · ${esc(day(s.createdAt))} · 👍 ${s.votes} · ${esc(s.type)}${s.teamSize > 1 ? ' · teams of ' + s.teamSize : ''}</span>
        <div class="md small" style="margin:6px 0">${MTCmd.md(s.text)}</div>
        <div class="row" style="gap:6px"><select class="sst" style="max-width:220px">${Object.entries(st).map(([k, l]) => `<option value="${k}"${k === s.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <input type="text" class="srp" maxlength="500" value="${esc(s.reply)}" placeholder="Reply shown under the idea (optional)" style="flex:1;min-width:180px">
          <button class="btn sm" data-ss type="button">SAVE</button><button class="btn grey sm" data-sh type="button">${s.hidden ? 'SHOW' : 'HIDE'}</button></div></div></div>`).join('')}</div>` : '<p class="soft">No ideas yet. Members post them on the Community page.</p>';
    p.querySelectorAll('[data-sug]').forEach(row => {
      const id = row.dataset.sug, s = d.suggestions.find(x => x.id === id);
      row.querySelector('[data-ss]').onclick = () => api('/api/admin/suggestions/' + id, { method: 'PUT', body: { status: row.querySelector('.sst').value, reply: row.querySelector('.srp').value } }).then(() => { toast('Saved.'); community(p.parentNode); }).catch(x => toast(x.message, true));
      row.querySelector('[data-sh]').onclick = () => api('/api/admin/suggestions/' + id, { method: 'PUT', body: { hidden: !s.hidden } }).then(() => community(p.parentNode)).catch(x => toast(x.message, true));
    });
  }
  async function feedback(p) {
    const d = await api('/api/admin/feedback');
    const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
    p.innerHTML = d.events.length ? d.events.map(e => `<div class="card" style="margin-bottom:14px"><div class="row"><h3 style="margin:0;flex:1">${esc(e.title)}</h3>
        ${e.count ? `<b style="color:var(--accent);font-size:20px" title="${e.avg} out of 5">${stars(e.avg)} ${e.avg}</b>` : ''}</div>
      <p class="soft small">${e.count} of ${e.players} players rated it${e.count ? ` · ${e.again} want it again` : ''}${e.asked ? ' · asked ' + esc(day(e.asked)) : ''}</p>
      <button class="btn grey sm" data-ask="${e.id}" type="button">DM PLAYERS: "RATE THIS EVENT"</button>
      ${e.items.length ? `<div class="list" style="margin-top:12px">${e.items.map(f => `<div class="item" style="align-items:flex-start">${face(f.avatar, f.name)}<div class="grow"><b>${esc(f.name)}</b> <span style="color:var(--accent)">${stars(f.stars)}</span>${f.again ? ' <span class="badge approved">WANTS IT AGAIN</span>' : ''}<br><span class="small">${esc(f.text || '(no comment)')}</span><br><span class="soft small">${esc(day(f.at))}</span></div></div>`).join('')}</div>` : ''}</div>`).join('')
      : '<p class="soft">Feedback opens when an event is marked Completed.</p>';
    p.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => { if (confirm('DM every player who has not rated this event yet?')) api('/api/admin/events/' + b.dataset.ask + '/ask-feedback', { method: 'POST' }).then(r => { toast(`Asked ${r.sent} player${r.sent === 1 ? '' : 's'}.`); feedback(p); }).catch(x => toast(x.message, true)); });
  }
  async function lfg(p) {
    const d = await api('/api/lfg');
    p.innerHTML = d.events.length ? d.events.map(e => `<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">${esc(e.title)} <span class="soft small">teams of ${e.teamSize}</span></h3>
      ${e.posts.length ? `<div class="list">${e.posts.map(l => `<div class="item">${face(l.avatar, l.name)}<div class="grow"><b>${esc(l.kind === 'team' ? l.team + ' needs ' + l.need : l.name + ' is looking for a team')}</b><br><span class="soft small">${esc(l.name)} · ${esc(l.note)}</span></div><button class="btn red sm" data-lx="${l.id}" type="button">REMOVE</button></div>`).join('')}</div>` : '<p class="soft small">No posts yet.</p>'}</div>`).join('')
      : '<p class="soft">The team finder shows for team events (team size 2 or more) that are Coming soon or Registration open.</p>';
    p.querySelectorAll('[data-lx]').forEach(b => b.onclick = () => { if (confirm('Remove this post?')) api('/api/lfg/' + b.dataset.lx, { method: 'DELETE' }).then(() => lfg(p)).catch(x => toast(x.message, true)); });
  }

  /* ======================================================================= SEASON & BADGES */
  async function season(pane) {
    const [s, b, lb] = await Promise.all([api('/api/admin/season'), api('/api/admin/badges'), api('/api/leaderboard')]);
    const P = s.points;
    pane.innerHTML = `<div class="grid2" style="align-items:start">
      <div class="card accent"><h2>POINTS</h2><p class="soft small">Counted from <b>Completed</b> events: every confirmed player who was not a no-show gets <b>Played</b>, and a place in the results adds its bonus on top (winner = Played + 1st place). A team result gives the points to everyone in that team.</p>
        <div class="fields">${[['played', 'Played an event'], ['first', '🥇 1st place bonus'], ['second', '🥈 2nd place bonus'], ['third', '🥉 3rd place bonus'], ['placed', 'Other placed bonus']].map(([k, l]) => `<div><label for="pt_${k}">${l}</label><input type="number" id="pt_${k}" min="0" max="1000" value="${P[k]}"></div>`).join('')}</div>
        <h3 style="margin-top:20px">SEASONS</h3><p class="soft small">Events count in the season their date falls in. With no seasons, the leaderboard is all time.</p>
        <div id="seasons">${s.seasons.map(x => seasonRow(x)).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn grey sm" id="sAdd" type="button">+ ADD SEASON</button><button class="btn sm" id="sSave" type="button" style="margin-left:auto">SAVE POINTS & SEASONS</button></div></div>
      <div class="card"><div class="row"><h2 style="margin:0;flex:1">LEADERBOARD</h2><a class="btn grey sm" href="/leaderboard.html" target="_blank" rel="noopener">OPEN</a></div>
        <p class="soft small">${lb.season ? esc(lb.season.name) : 'All time'}</p>
        ${lb.rows.length ? `<ol class="lbmini">${lb.rows.slice(0, 10).map(r => `<li><b>#${r.rank}</b> ${esc(r.name)} <span class="soft small">${r.events} event${r.events === 1 ? '' : 's'} · ${r.wins} win${r.wins === 1 ? '' : 's'}</span><span class="pts">${r.points}</span></li>`).join('')}</ol>` : '<p class="soft">No completed events in this season yet.</p>'}</div></div>
      <div class="card"><h2>BONUS POINTS</h2><p class="soft small">Extra points (or a minus number to take points away), for example for helping run an event.</p>
        <div class="fields">${memberField('bm', 'Member <span class="soft">(or type any player name)</span>')}<div><label for="bp">Points</label><input type="number" id="bp" min="-1000" max="1000" value="5"></div>
          <div><label for="bs">Season</label><select id="bs"><option value="">Current season</option>${s.seasons.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div><label for="br">Reason</label><input type="text" id="br" maxlength="120"></div></div>
        <div style="margin-top:12px"><button class="btn sm" id="bAdd" type="button">GIVE POINTS</button></div>
        ${s.bonus.length ? `<div class="list" style="margin-top:14px">${s.bonus.map(x => `<div class="item"><div class="grow"><b>${x.points > 0 ? '+' : ''}${x.points}</b> to <b>${esc(x.name)}</b> <span class="soft small">${esc(x.reason)} · ${esc(day(x.at))} · by ${esc(x.by)}</span></div><button class="btn grey sm" data-bx="${x.id}" type="button">REMOVE</button></div>`).join('')}</div>` : ''}</div>
      <div class="card"><h2>BADGES</h2>
        <p class="soft small">Every badge uses the same MTC medal: pick a rim, a colour and draw the icon (10 × 10 pixels), or start from one of the ready-made icons. You can still upload your own picture instead.</p>
        <div id="bmBox"></div>
        <h3>AUTOMATIC BADGES</h3><p class="soft small">Members earn these by themselves.</p>
        <div class="bart">${b.auto.map(a => `<div class="bart-i" data-art="${a.key}" style="--bc:${a.color}"><span class="bart-p">${MTC.badgeIcon(a)}</span><b>${esc(a.name)}</b><span class="soft small">${esc(a.desc)}</span>
          <div class="row" style="gap:4px;justify-content:center"><button class="btn sm" data-artedit type="button">DESIGN</button>${a.custom ? '<button class="btn ghost sm" data-artreset type="button">RESET</button>' : ''}</div></div>`).join('')}</div>
        <div class="row" style="margin-top:22px"><h3 style="margin:0;flex:1">CUSTOM BADGES</h3><button class="btn sm" id="nbNew" type="button">+ NEW BADGE</button></div>
        <p class="soft small">Make your own and give them to members, for example "Event host", "Best build", "Bug hunter".</p>
        <div class="bart">${b.badges.map(x => `<div class="bart-i" data-bdg="${x.id}" style="--bc:${esc(x.color)}"><span class="bart-p">${MTC.badgeIcon(x)}</span><b>${esc(x.name)}</b><span class="soft small">${esc(x.desc)}</span>
          <div class="row" style="gap:4px;justify-content:center"><button class="btn sm" data-bedit type="button">EDIT</button><button class="btn red sm" data-bdx type="button">DELETE</button></div></div>`).join('') || '<p class="soft small">No custom badges yet.</p>'}</div>
        ${b.badges.length ? `<h3 style="margin-top:22px">GIVE A BADGE</h3><div class="fields"><div><label for="ab">Badge</label><select id="ab">${b.badges.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>${memberField('am', 'Member')}<div class="full"><label for="ar">Reason <span class="soft">(optional, shown on the badge)</span></label><input type="text" id="ar" maxlength="120"></div></div>
          <div style="margin-top:12px"><button class="btn sm" id="abGo" type="button">GIVE BADGE</button> <span class="soft small">They get a DM (if badge DMs are on in Messages → Alerts).</span></div>` : ''}
        ${b.awards.length ? `<div class="list" style="margin-top:14px">${b.awards.map(a => { const x = b.badges.find(q => q.id === a.badgeId) || {}; return `<div class="item">${face(a.avatar, a.who)}<div class="grow">${x.name ? MTC.badgeRow([x]) : '<span class="soft">Deleted badge</span>'} → <b>${esc(a.who)}</b><br><span class="soft small">${esc(a.reason)} · ${esc(day(a.at))} · by ${esc(a.by)}</span></div><button class="btn grey sm" data-awx="${a.id}" type="button">TAKE BACK</button></div>`; }).join('')}</div>` : ''}</div>`;
    const reload = () => season(pane);
    $('#sAdd').onclick = () => { $('#seasons').insertAdjacentHTML('beforeend', seasonRow({ id: '', name: 'Season ' + ($('#seasons').children.length + 1), start: new Date().toISOString(), end: '' })); };
    $('#seasons').onclick = e => { const x = e.target.closest('[data-sx]'); if (x) x.closest('.srow').remove(); };
    $('#sSave').onclick = () => api('/api/admin/season', { method: 'PUT', body: { points: Object.fromEntries(['first', 'second', 'third', 'placed', 'played'].map(k => [k, +$('#pt_' + k).value])),
      seasons: [...document.querySelectorAll('.srow')].map(r => ({ id: r.dataset.id, name: r.querySelector('.sn').value, start: r.querySelector('.ss').value, end: r.querySelector('.se').value })) } }).then(() => { toast('Saved.'); reload(); }).catch(x => toast(x.message, true));
    $('#bAdd').onclick = () => { const m = readMember('bm'); api('/api/admin/season/bonus', { method: 'POST', body: { userId: m.member ? m.member.id : '', name: m.member ? '' : m.text, points: +$('#bp').value, reason: $('#br').value, seasonId: $('#bs').value } }).then(() => { toast('Points given.'); reload(); }).catch(x => toast(x.message, true)); };
    pane.querySelectorAll('[data-bx]').forEach(x => x.onclick = () => api('/api/admin/season/bonus/' + x.dataset.bx, { method: 'DELETE' }).then(reload).catch(e => toast(e.message, true)));
    const A = window.MTCBadgeArt, box = $('#bmBox');
    const open = opt => { badgeMaker(box, { ...opt, onDone: () => { box.innerHTML = ''; reload(); } }); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $('#nbNew').onclick = () => open({ title: 'NEW BADGE', custom: true, design: A.clean(A.PRESETS.winner), name: '', desc: '',
      save: (body) => api('/api/admin/badges', { method: 'POST', body }) });
    pane.querySelectorAll('[data-art]').forEach(c => {
      const a = b.auto.find(x => x.key === c.dataset.art);
      c.querySelector('[data-artedit]').onclick = () => open({ title: 'DESIGN: ' + a.name.toUpperCase(), design: a.pixel, color: a.color, save: body => api('/api/admin/badge-art/' + a.key, { method: 'PUT', body }) });
      const r = c.querySelector('[data-artreset]'); if (r) r.onclick = () => api('/api/admin/badge-art/' + a.key, { method: 'PUT', body: { image: '' } }).then(() => { toast('Back to the MTC pixel art.'); reload(); }).catch(x => toast(x.message, true));
    });
    pane.querySelectorAll('[data-bdg]').forEach(c => {
      const x = b.badges.find(q => q.id === c.dataset.bdg);
      c.querySelector('[data-bedit]').onclick = () => open({ title: 'EDIT BADGE', custom: true, design: x.pixel || A.clean(A.PRESETS.winner), name: x.name, desc: x.desc, picture: x.pixel ? '' : x.image,
        save: body => api('/api/admin/badges/' + x.id, { method: 'PUT', body }) });
      c.querySelector('[data-bdx]').onclick = () => { if (confirm('Delete this badge? Everyone who has it loses it.')) api('/api/admin/badges/' + x.id, { method: 'DELETE' }).then(reload).catch(e => toast(e.message, true)); };
    });
    if ($('#abGo')) $('#abGo').onclick = () => { const m = readMember('am'); if (!m.member) return toast('Pick a member from the list.', true); api('/api/admin/badges/' + $('#ab').value + '/award', { method: 'POST', body: { userId: m.member.id, reason: $('#ar').value } }).then(() => { toast('Badge given.'); reload(); }).catch(x => toast(x.message, true)); };
    pane.querySelectorAll('[data-awx]').forEach(x => x.onclick = () => { if (confirm('Take this badge back?')) api('/api/admin/badge-awards/' + x.dataset.awx, { method: 'DELETE' }).then(reload).catch(e => toast(e.message, true)); });
  }
  /* ======================================================================= PIXEL BADGE MAKER
     Same medal for every badge: rim metal + background colour + a 10x10 icon you draw (or start from a ready-made one). */
  function badgeMaker(box, o) {
    const A = window.MTCBadgeArt, d = A.clean(o.design), grid = d.map.map(r => [...r]);
    let ink = 'Y', painting = false, picture = null, mirror = false;
    const keys = Object.keys(A.PAL);
    box.innerHTML = `<div class="card accent bm"><div class="row"><h3 style="margin:0;flex:1">${esc(o.title)}</h3><button class="btn ghost sm" data-bmx type="button">CLOSE</button></div>
      ${o.custom ? `<div class="fields" style="margin-bottom:14px"><div><label for="bm_n">Badge name</label><input type="text" id="bm_n" maxlength="30" value="${esc(o.name || '')}" placeholder="e.g. Event host"></div><div><label for="bm_d">What it is for</label><input type="text" id="bm_d" maxlength="120" value="${esc(o.desc || '')}" placeholder="Shown when people hover the badge"></div></div>` : ''}
      <div class="bm-wrap">
        <div class="bm-side">
          <div class="bm-prev"><span class="bm-big"></span><div class="bm-mini"><span class="bm-s"></span><span class="bm-s2"></span><small class="soft">how it looks on profiles</small></div></div>
          <label>Rim</label><div class="bm-metals" role="radiogroup" aria-label="Rim">${Object.entries(A.METAL).map(([k, c]) => `<button type="button" role="radio" data-metal="${k}" aria-checked="${k === d.metal}" title="${esc(A.METAL_NAMES[k])}" style="--m1:${c[0]};--m2:${c[1]};--m3:${c[2]}"><span class="sr">${esc(A.METAL_NAMES[k])}</span></button>`).join('')}</div>
          <label for="bm_f">Background colour</label><input type="color" id="bm_f" value="${d.face}">
          <label for="bm_p">Start from an icon</label><select id="bm_p"><option value="">Pick one...</option>${Object.entries(A.PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select>
        </div>
        <div class="bm-draw">
          <div class="bm-pal" role="radiogroup" aria-label="Colour">${keys.map(k => `<button type="button" role="radio" data-ink="${k}" aria-checked="${k === ink}" style="background:${A.PAL[k]}" title="${k}"><span class="sr">${k}</span></button>`).join('')}<button type="button" role="radio" data-ink="." aria-checked="false" class="bm-erase" title="Eraser">✕</button></div>
          <div class="bm-grid" aria-label="Draw the icon">${grid.map((r, y) => r.map((ch, x) => `<i data-x="${x}" data-y="${y}"></i>`).join('')).join('')}</div>
          <div class="row" style="gap:10px;margin-top:8px"><label class="check" style="margin:0"><input type="checkbox" id="bm_m"> Mirror (draws both sides)</label><button class="btn ghost sm" id="bm_c" type="button">CLEAR</button></div>
        </div>
      </div>
      <div class="row" style="margin-top:16px"><button class="btn" id="bm_save" type="button">SAVE BADGE</button>
        <label class="btn grey sm" style="cursor:pointer">OR UPLOAD A PICTURE<input type="file" id="bm_up" accept="image/png,image/webp,image/gif,image/jpeg" hidden></label><span class="soft small" id="bm_upn">${o.picture ? 'This badge uses an uploaded picture. Saving uses the pixel design instead.' : ''}</span></div></div>`;
    const root = box.querySelector('.bm');
    const cells = [...root.querySelectorAll('.bm-grid i')];
    const design = () => ({ metal: d.metal, face: d.face, map: grid.map(r => r.join('')) });
    const paint = () => {
      cells.forEach(c => { const ch = grid[c.dataset.y][c.dataset.x]; c.style.background = ch === '.' ? '' : A.PAL[ch]; c.classList.toggle('on', ch !== '.'); });
      root.querySelector('.bm-grid').style.setProperty('--face', d.face);
      const svg = A.svg(design());   // built by our own renderer from letters and colours only
      root.querySelector('.bm-big').innerHTML = svg; root.querySelector('.bm-s').innerHTML = svg; root.querySelector('.bm-s2').innerHTML = svg;
    };
    const set = (x, y) => { grid[y][x] = ink; if (mirror) grid[y][9 - x] = ink; paint(); };
    const grd = root.querySelector('.bm-grid');
    grd.addEventListener('pointerdown', e => { const c = e.target.closest('i'); if (!c) return; e.preventDefault(); painting = true; grd.setPointerCapture(e.pointerId); set(+c.dataset.x, +c.dataset.y); });
    grd.addEventListener('pointermove', e => { if (!painting) return; const c = document.elementFromPoint(e.clientX, e.clientY); if (c && c.parentNode === grd) { const x = +c.dataset.x, y = +c.dataset.y; if (grid[y][x] !== ink) set(x, y); } });
    grd.addEventListener('pointerup', () => { painting = false; }); grd.addEventListener('pointercancel', () => { painting = false; });
    root.querySelectorAll('[data-ink]').forEach(bt => bt.onclick = () => { ink = bt.dataset.ink; root.querySelectorAll('[data-ink]').forEach(z => z.setAttribute('aria-checked', z === bt)); });
    root.querySelectorAll('[data-metal]').forEach(bt => bt.onclick = () => { d.metal = bt.dataset.metal; root.querySelectorAll('[data-metal]').forEach(z => z.setAttribute('aria-checked', z === bt)); paint(); });
    root.querySelector('#bm_f').oninput = e => { d.face = e.target.value; paint(); };
    root.querySelector('#bm_m').onchange = e => { mirror = e.target.checked; };
    root.querySelector('#bm_c').onclick = () => { grid.forEach(r => r.fill('.')); paint(); };
    root.querySelector('#bm_p').onchange = e => { const p = A.PRESETS[e.target.value]; if (!p) return; const c = A.clean(p); c.map.forEach((r, y) => { grid[y] = [...r]; }); d.metal = c.metal; d.face = c.face;
      root.querySelector('#bm_f').value = d.face; root.querySelectorAll('[data-metal]').forEach(z => z.setAttribute('aria-checked', z.dataset.metal === d.metal)); paint(); e.target.value = ''; };
    root.querySelector('#bm_up').onchange = e => { picture = e.target.files[0] || null; root.querySelector('#bm_upn').textContent = picture ? picture.name + ' will be used instead of the pixel design. Press SAVE BADGE.' : ''; };
    root.querySelector('[data-bmx]').onclick = () => { box.innerHTML = ''; };
    root.querySelector('#bm_save').onclick = async () => {
      try {
        const body = {};
        if (o.custom) { body.name = root.querySelector('#bm_n').value.trim(); body.desc = root.querySelector('#bm_d').value; if (!body.name) throw new Error('Give the badge a name.'); body.color = d.face; }
        if (picture) body.image = await readPic(picture); else body.pixel = design();
        await o.save(body); toast('Badge saved.'); o.onDone();
      } catch (x) { toast(x.message, true); }
    };
    paint();
  }
  // badge pictures keep their see-through background: small files go up as they are, big ones are shrunk to 256 px
  const readPic = file => !file ? Promise.resolve(undefined) : file.size < 900e3 && /^image\/(png|webp|gif)$/.test(file.type)
    ? new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('That picture could not be read.')); fr.readAsDataURL(file); })
    : MTC.imageToDataUrl(file, 256);
  const seasonRow = x => `<div class="srow row" data-id="${esc(x.id)}" style="gap:6px;margin-bottom:6px"><input type="text" class="sn" value="${esc(x.name)}" maxlength="40" aria-label="Season name" style="flex:1;min-width:120px"><input type="date" class="ss" value="${dateOnly(x.start)}" aria-label="Start"><input type="date" class="se" value="${dateOnly(x.end)}" aria-label="End"><button class="btn grey sm" data-sx type="button" aria-label="Remove season">✕</button></div>`;

  /* ======================================================================= STATS */
  async function stats(pane) {
    pane.innerHTML = '<p class="soft">Counting...</p>';
    let s; try { s = await api('/api/admin/stats'); } catch (x) { pane.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
    const T = s.totals, pct = v => v == null ? '–' : v + '%';
    const tiles = [['Members in Discord', T.members], ['Verified creators', T.creators], ['Logged in to the site', T.logins], ['Events run', T.completed], ['Coming up', T.upcoming], ['Sign-ups', T.registrations],
      ['Approval rate', pct(T.approvalRate)], ['No-show rate', pct(T.noShowRate)], ['Players per event', T.avgPlayers], ['Showcase items', T.media], ['Event ideas', T.suggestions], ['Poll votes', T.pollVotes]];
    const bars = (rows, label, key) => { const max = Math.max(1, ...rows.map(r => r[key])); return `<div class="sbars" role="img" aria-label="${esc(label)}">${rows.map(r => `<div class="sb" title="${esc(r.label)}: ${r[key]}"><b>${r[key] || ''}</b><i style="height:${Math.max(r[key] ? 3 : 0, Math.round(r[key] / max * 85))}%"></i><span>${esc(r.short)}</span></div>`).join('')}</div>`; };
    const mon = m => new Date(m + '-01').toLocaleDateString([], { month: 'short' });
    pane.innerHTML = `<div class="stiles">${tiles.map(([l, v]) => `<div class="stile"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
      <div class="grid2" style="align-items:start">
        <div class="card"><h3 style="margin-top:0">NEW DISCORD MEMBERS PER MONTH</h3>${bars(s.growth.joins.map(g => ({ label: g.month, short: mon(g.month), n: g.n })), 'New members per month', 'n')}</div>
        <div class="card"><h3 style="margin-top:0">EVENT SIGN-UPS PER MONTH</h3>${bars(s.growth.signups.map(g => ({ label: g.month, short: mon(g.month), n: g.n })), 'Sign-ups per month', 'n')}</div></div>
      <div class="card"><h3 style="margin-top:0">EVENTS</h3><div class="tablewrap"><table><thead><tr><th>EVENT</th><th>SIGN-UPS</th><th>CONFIRMED</th><th>REJECTED</th><th>WITHDREW</th><th>CHECKED IN</th><th>NO-SHOWS</th><th>RATING</th></tr></thead><tbody>
        ${s.perEvent.map(e => `<tr><td><a href="/event.html?slug=${encodeURIComponent(e.slug)}" target="_blank" rel="noopener">${esc(e.title)}</a> <span class="soft small">${esc(e.status)}</span></td><td>${e.signups}${e.slots ? ' / ' + e.slots : ''}</td><td>${e.approved}</td><td>${e.rejected}</td><td>${e.withdrawn}</td><td>${e.attended}</td><td>${e.noShows}</td><td>${e.ratings ? '★ ' + e.rating + ` (${e.ratings})` : '–'}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3 style="margin-top:0">MOST ACTIVE PLAYERS</h3>${s.top.length ? `<ol class="lbmini">${s.top.map(t => `<li>${face(t.avatar, t.name)} ${esc(t.name)}<span class="pts">${t.events} event${t.events === 1 ? '' : 's'}</span></li>`).join('')}</ol>` : '<p class="soft">No completed events yet.</p>'}</div>
      <p class="soft small">Updated ${esc(fmt(s.at))}. <button class="btn ghost sm" id="stRe" type="button">REFRESH</button></p>`;
    $('#stRe').onclick = () => stats(pane);
  }

  /* ======================================================================= MEMBER NOTES (warnings, bans, no-shows, history) */
  async function notes(box, id, name) {
    box.innerHTML = '<div class="card accent"><p class="soft">Loading...</p></div>'; box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let d; try { d = await api('/api/admin/members/' + id + '/notes'); } catch (x) { box.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
    const K = { note: ['🗒️', 'NOTE', 'pending'], warning: ['⚠️', 'WARNING', 'pending'], ban: ['⛔', 'BAN', 'rejected'], unban: ['✅', 'UNBAN', 'approved'] };
    box.innerHTML = `<div class="card accent"><div class="row"><h2 style="margin:0;flex:1">NOTES: ${esc(name)}</h2><button class="btn ghost sm" id="nClose" type="button">CLOSE</button></div>
      <p>${d.blocked ? `<span class="badge rejected">BLOCKED${d.blockedUntil ? ' UNTIL ' + esc(new Date(d.blockedUntil).toLocaleDateString()) : ''}</span> ` : ''}<span class="badge ${d.noShows ? 'rejected' : 'approved'}">${d.noShows} NO-SHOW${d.noShows === 1 ? '' : 'S'}</span>
        <span class="badge pending">${d.notes.filter(n => n.kind === 'warning').length} WARNINGS</span></p>
      <div class="fields"><div><label for="nk">Type</label><select id="nk"><option value="note">🗒️ Note (only admins see it)</option><option value="warning">⚠️ Warning</option><option value="ban">⛔ Block from events</option>${d.blocked ? '<option value="unban">✅ Unblock</option>' : ''}</select></div>
        <div id="nuW" hidden><label for="nu">Blocked until <span class="soft">(empty = until unblocked)</span></label><input type="date" id="nu"></div>
        <div class="full"><label for="nt">What happened</label><textarea id="nt" rows="2" maxlength="500"></textarea></div></div>
      <label class="check"><input type="checkbox" id="nd"> DM them about this (warnings, blocks and unblocks)</label>
      <div style="margin-top:10px"><button class="btn sm" id="nAdd" type="button">SAVE</button></div>
      ${d.notes.length ? `<div class="list" style="margin-top:16px">${d.notes.map(n => `<div class="item"><div class="grow"><span class="badge ${K[n.kind][2]}">${K[n.kind][0]} ${K[n.kind][1]}</span> ${esc(n.text)}${n.until ? ` <span class="soft small">(until ${esc(new Date(n.until).toLocaleDateString())})</span>` : ''}<br><span class="soft small">${esc(fmt(n.at))} · by ${esc(n.by)}</span></div><button class="btn grey sm" data-nx="${n.id}" type="button" aria-label="Delete note">✕</button></div>`).join('')}</div>` : ''}
      ${d.history.length ? `<h3 style="margin-top:18px">EVENTS</h3><div class="list">${d.history.map(h => `<div class="item"><div class="grow">${esc(h.event)} <span class="badge ${h.status}">${esc(h.status.toUpperCase())}</span> ${h.attended === true ? '<span class="badge approved">CHECKED IN</span>' : h.attended === false ? '<span class="badge rejected">NO-SHOW</span>' : ''}</div><span class="soft small">${esc(day(h.at))}</span></div>`).join('')}</div>` : ''}</div>`;
    $('#nClose').onclick = () => { box.innerHTML = ''; };
    $('#nk').onchange = () => { $('#nuW').hidden = $('#nk').value !== 'ban'; $('#nd').checked = $('#nk').value !== 'note'; };
    $('#nAdd').onclick = () => api('/api/admin/members/' + id + '/notes', { method: 'POST', body: { kind: $('#nk').value, text: $('#nt').value, until: $('#nu').value ? new Date($('#nu').value + 'T23:59').toISOString() : '', dm: $('#nd').checked } })
      .then(() => { toast('Saved.'); notes(box, id, name); }).catch(x => toast(x.message, true));
    box.querySelectorAll('[data-nx]').forEach(b => b.onclick = () => { if (confirm('Delete this note?')) api('/api/admin/mod-notes/' + b.dataset.nx, { method: 'DELETE' }).then(() => notes(box, id, name)).catch(x => toast(x.message, true)); });
  }
  const modSummary = () => api('/api/admin/mod-summary').then(d => d.summary).catch(() => ({}));

  /* ======================================================================= WHITELIST EXPORT */
  async function whitelist(box, ev) {
    if (box.innerHTML) { box.innerHTML = ''; return; }
    const teams = [...new Set((ev.teams || []).filter(Boolean))];
    box.innerHTML = `<div class="card accent" style="margin-bottom:14px"><div class="row"><h2 style="margin:0;flex:1">WHITELIST: ${esc(ev.title)}</h2><button class="btn ghost sm" data-wx type="button">CLOSE</button></div>
      <p class="soft small">Every <b>confirmed</b> player's Minecraft name. Paste the commands in the server console, or put <code>whitelist.json</code> in the server folder and run <code>whitelist reload</code>. Bedrock players (through Geyser + Floodgate) use <code>fwhitelist</code>.</p>
      <div class="row" style="gap:12px"><label class="check" style="margin:0"><input type="radio" name="wm" value="online" checked> Online-mode server (premium)</label><label class="check" style="margin:0"><input type="radio" name="wm" value="offline"> Offline-mode server (cracked allowed)</label>
        <label style="margin:0">Floodgate prefix <input type="text" id="wpre" value="." maxlength="3" style="width:56px"></label>${teams.length ? `<select id="wteam" style="max-width:200px"><option value="">All teams</option>${teams.map(t => `<option>${esc(t)}</option>`).join('')}</select>` : ''}
        <button class="btn sm" data-wgo type="button">MAKE LIST</button></div><div class="wout"></div></div>`;
    box.querySelector('[data-wx]').onclick = () => { box.innerHTML = ''; };
    box.querySelector('[data-wgo]').onclick = async () => {
      const out = box.querySelector('.wout'); out.innerHTML = '<p class="soft">Looking up UUIDs...</p>';
      const mode = box.querySelector('input[name=wm]:checked').value, team = (box.querySelector('#wteam') || {}).value || '';
      let d; try { d = await api(`/api/admin/events/${ev.id}/whitelist?mode=${mode}&prefix=${encodeURIComponent(box.querySelector('#wpre').value)}&team=${encodeURIComponent(team)}`); } catch (x) { out.innerHTML = `<p class="msg err">${esc(x.message)}</p>`; return; }
      out.innerHTML = `<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>PLAYER</th><th>NAME IN GAME</th><th>EDITION</th><th>UUID</th></tr></thead><tbody>${d.players.map(p => `<tr><td>${esc(p.who)}${p.team ? ` <span class="soft small">${esc(p.team)}</span>` : ''}</td><td><b>${esc(p.listName)}</b></td><td>${MTC.edTag(p.edition) || 'Java'}</td><td class="small">${p.uuid ? `<code>${esc(p.uuid)}</code>${p.note ? `<br><span class="soft">${esc(p.note)}</span>` : ''}` : `<span class="soft">${esc(p.note)}</span>${p.edition === 'bedrock' ? `<div class="row" style="gap:4px;margin-top:4px"><input type="text" class="wx" data-tag="${esc(p.name)}" placeholder="XUID, e.g. 2535435356389627" style="max-width:220px"><button class="btn sm" data-wxs type="button">SAVE</button></div>` : ''}`}</td></tr>`).join('')}</tbody></table></div>
        ${d.missing.length ? `<p class="msg info small">No Minecraft name yet: ${d.missing.map(esc).join(', ')}</p>` : ''}
        <div class="grid2" style="margin-top:12px"><div><label>Console commands</label><textarea rows="8" readonly class="wcmd">${esc(d.commands)}</textarea><button class="btn grey sm" data-cp=".wcmd" type="button" style="margin-top:6px">COPY</button></div>
          <div><label>whitelist.json <span class="soft">(Java and Bedrock players)</span></label><textarea rows="8" readonly class="wjson">${esc(d.json)}</textarea><div class="row" style="margin-top:6px"><button class="btn grey sm" data-cp=".wjson" type="button">COPY</button><button class="btn grey sm" data-dl type="button">DOWNLOAD whitelist.json</button></div></div></div>`;
      out.querySelectorAll('[data-wxs]').forEach(b => b.onclick = () => { const i = b.parentNode.querySelector('.wx');
        api('/api/admin/xuid', { method: 'PUT', body: { gamertag: i.dataset.tag, xuid: i.value } }).then(() => { toast('Saved. Making the list again...'); box.querySelector('[data-wgo]').click(); }).catch(x => toast(x.message, true)); });
      out.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => { const t = out.querySelector(b.dataset.cp); navigator.clipboard.writeText(t.value).then(() => toast('Copied.'), () => { t.select(); toast('Press Ctrl+C to copy.'); }); });
      out.querySelector('[data-dl]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([d.json], { type: 'application/json' })); a.download = 'whitelist.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
    };
  }

  /* ======================================================================= CHECK-IN (attendance) */
  const checkCell = r => r.status !== 'approved' ? '<span class="soft small">–</span>' : `<div class="chk" data-reg="${r.id}" role="group" aria-label="Check-in for ${esc(r.name)}">
      <button type="button" class="btn sm ${r.attended === true ? 'green' : 'grey'}" data-att="1" title="Was there">✓</button><button type="button" class="btn sm ${r.attended === false ? 'red' : 'grey'}" data-att="0" title="No-show">✗</button></div>`;
  function bindCheck(root, regs) {
    root.querySelectorAll('.chk').forEach(g => g.onclick = async e => {
      const b = e.target.closest('[data-att]'); if (!b) return; const r = regs.find(x => x.id === g.dataset.reg); const want = b.dataset.att === '1';
      const val = r.attended === want ? null : want;
      try { await api('/api/admin/registrations/' + r.id + '/attended', { method: 'PUT', body: { attended: val } }); r.attended = val; g.outerHTML = checkCell(r); bindCheck(root, regs); } catch (x) { toast(x.message, true); }
    });
  }

  /* ======================================================================= TEMPLATES & DUPLICATE */
  async function templateBar(box, onCreated) {
    let t; try { t = await api('/api/admin/event-templates'); } catch { return; }
    if (!t.templates.length) { box.innerHTML = '<span class="soft small">Tip: open an event and press SAVE AS TEMPLATE to reuse its setup.</span>'; return; }
    box.innerHTML = `<select id="tplSel" style="max-width:260px" aria-label="Template">${t.templates.map(x => `<option value="${x.id}">📋 ${esc(x.name)}</option>`).join('')}</select><button class="btn grey sm" id="tplUse" type="button">NEW FROM TEMPLATE</button><button class="btn ghost sm" id="tplDel" type="button" title="Delete this template">✕</button>`;
    $('#tplUse').onclick = async () => { const title = prompt('Title for the new event:', $('#tplSel').selectedOptions[0].textContent.replace('📋 ', '')); if (title === null) return;
      try { const r = await api('/api/admin/event-templates/' + $('#tplSel').value + '/use', { method: 'POST', body: { title } }); toast('Draft created from the template.'); onCreated(r.event); } catch (x) { toast(x.message, true); } };
    $('#tplDel').onclick = () => { if (confirm('Delete this template?')) api('/api/admin/event-templates/' + $('#tplSel').value, { method: 'DELETE' }).then(() => templateBar(box, onCreated)).catch(x => toast(x.message, true)); };
  }
  const duplicate = id => api('/api/admin/events/' + id + '/duplicate', { method: 'POST' });
  const saveTemplate = (id, title) => { const name = prompt('Template name:', title); if (!name) return; api('/api/admin/event-templates', { method: 'POST', body: { eventId: id, name } }).then(() => toast('Template saved. Use it from the Events list.')).catch(x => toast(x.message, true)); };

  /* ======================================================================= POP-UP VIDEO (trailer / announcement, bottom right of the site) */
  async function promoCard(box) {
    let d; try { d = await api('/api/admin/promo'); } catch { return; }
    const p = d.promo || { on: false, label: 'TRAILER', pages: 'all', linkLabel: 'Learn more' };
    const vid = p.videoId || '';
    box.innerHTML = `<div class="card ${p.on ? 'accent' : ''}" style="margin-top:22px"><div class="row"><h2 style="margin:0;flex:1">POP-UP VIDEO</h2><span class="badge ${d.active ? 'live' : 'withdrawn'}">${d.active ? 'SHOWING ON THE SITE' : 'OFF'}</span></div>
      <p class="soft small">A small video in the bottom-right corner of the website, for a trailer or an announcement. It plays <b>muted</b> (browsers only autoplay muted video); visitors can turn the sound on, make it bigger, shrink it or close it. Someone who closes it does not see it again until you change the video.</p>
      <div class="fields">
        <div class="full"><label for="pv_v">YouTube video link</label><input type="url" id="pv_v" value="${esc(p.video || '')}" placeholder="https://www.youtube.com/watch?v=... or a Shorts / youtu.be link"></div>
        <div><label for="pv_l">Label</label><input type="text" id="pv_l" list="pv_ll" maxlength="24" value="${esc(p.label || 'TRAILER')}"><datalist id="pv_ll"><option>TRAILER</option><option>ANNOUNCEMENT</option><option>NEW EVENT</option><option>LIVE NOW</option><option>HIGHLIGHTS</option></datalist></div>
        <div><label for="pv_t">Title <span class="soft">(optional)</span></label><input type="text" id="pv_t" maxlength="80" value="${esc(p.title || '')}" placeholder="e.g. MTC November 2k26 trailer"></div>
        <div><label for="pv_k">Button link <span class="soft">(optional)</span></label><input type="text" id="pv_k" maxlength="300" value="${esc(p.link || '')}" placeholder="/event.html?slug=... or https://"></div>
        <div><label for="pv_kl">Button text</label><input type="text" id="pv_kl" maxlength="24" value="${esc(p.linkLabel || 'Learn more')}"></div>
        <div><label for="pv_p">Show on</label><select id="pv_p"><option value="all"${p.pages !== 'home' ? ' selected' : ''}>Every page</option><option value="home"${p.pages === 'home' ? ' selected' : ''}>Home page only</option></select></div>
        <div><label for="pv_u">Stop showing after <span class="soft">(optional)</span></label><input type="datetime-local" id="pv_u" value="${p.until ? local(p.until) : ''}"></div>
      </div>
      ${vid ? `<div style="margin-top:12px;max-width:360px;aspect-ratio:16/9;border:3px solid #000"><iframe src="https://www.youtube-nocookie.com/embed/${esc(vid)}?mute=1&rel=0" title="Preview" style="width:100%;height:100%;border:0" allowfullscreen></iframe></div>` : ''}
      <div class="row" style="margin-top:14px"><label class="check" style="margin:0"><input type="checkbox" id="pv_on"${p.on ? ' checked' : ''}> Show it on the website</label>
        <button class="btn" id="pv_save" type="button">SAVE</button>${p.videoId ? '<button class="btn grey sm" id="pv_again" type="button" title="People who closed it will see it again">SHOW AGAIN TO EVERYONE</button>' : ''}</div></div>`;
    const body = extra => ({ on: $('#pv_on').checked, video: $('#pv_v').value.trim(), label: $('#pv_l').value.trim().toUpperCase(), title: $('#pv_t').value, link: $('#pv_k').value.trim(), linkLabel: $('#pv_kl').value, pages: $('#pv_p').value, until: $('#pv_u').value ? new Date($('#pv_u').value).toISOString() : '', ...extra });
    $('#pv_save').onclick = () => api('/api/admin/promo', { method: 'PUT', body: body() }).then(r => { toast(r.active ? 'Saved. The video is showing on the website.' : 'Saved. The pop-up video is off.'); promoCard(box); }).catch(x => toast(x.message, true));
    if ($('#pv_again')) $('#pv_again').onclick = () => api('/api/admin/promo', { method: 'PUT', body: body({ resetSeen: true }) }).then(() => { toast('Everyone will see it again, including people who closed it.'); promoCard(box); }).catch(x => toast(x.message, true));
  }

  /* ---- server control: the Minecraft plugin that opens / closes the event server ---- */
  const MC_COL = { 0: '#000', 1: '#00a', 2: '#0a0', 3: '#0aa', 4: '#a00', 5: '#a0a', 6: '#fa0', 7: '#aaa', 8: '#555', 9: '#55f', a: '#5f5', b: '#5ff', c: '#f55', d: '#f5f', e: '#ff5', f: '#fff' };
  const mcHtml = t => { let col = '#aaa', b = false, out = '';
    for (const part of String(t || '').split(/(§[0-9a-fk-or])/i)) {
      const m = /^§([0-9a-fk-or])$/i.exec(part);
      if (m) { const c = m[1].toLowerCase(); if (MC_COL[c]) { col = MC_COL[c]; b = false; } else if (c === 'l') b = true; else if (c === 'r') { col = '#aaa'; b = false; } continue; }
      out += part.split('\n').map(x => `<span style="color:${col}${b ? ';font-weight:700' : ''}">${esc(x)}</span>`).join('<br>');
    }
    return out; };
  async function serverControl(box) {
  if (!document.getElementById('scCss')) document.head.insertAdjacentHTML('beforeend', `<style id="scCss">
    .sc-setup summary{cursor:pointer;padding:6px 0;font-family:var(--display);font-size:12px;letter-spacing:.04em}
    .sc-steps{display:grid;gap:10px;margin-top:10px}
    .sc-step{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:14px;align-items:start;padding:14px 16px;background:#0d0804;border:3px solid #000;box-shadow:inset 0 -3px 0 #2a1d12}
    .sc-step>b{display:grid;place-items:center;width:34px;height:34px;background:var(--accent,#f7931e);color:#000;font:13px var(--display);border:2px solid #000}
    .sc-step h4{margin:2px 0 4px;font:11px/1.6 var(--display);letter-spacing:.04em}
    .sc-step p{margin:0;font-size:14px;line-height:1.6;color:var(--soft);overflow-wrap:anywhere}
    .sc-step code{background:#1f150c;padding:1px 6px;border:1px solid #3a2a1a;color:var(--ink)}
    .sc-step>.btn{align-self:center;white-space:nowrap}
    .sc-key{display:flex;gap:6px;margin-top:10px;max-width:520px}.sc-key input{flex:1;min-width:0;font-family:monospace}
    .sc-link{background:none;border:0;padding:0;margin-top:8px;color:var(--soft);font-size:13px;text-decoration:underline;cursor:pointer}.sc-link:hover{color:#ff9a8a}
    @media(max-width:640px){.sc-step{grid-template-columns:34px minmax(0,1fr)}.sc-step>.btn,.sc-step>.badge{grid-column:2;justify-self:start}}
  </style>`);
    let d; try { d = await api('/api/admin/plugin'); } catch { return; }
    const st = d.state || {}, seen = d.seen, ago = seen ? Math.round((Date.now() - new Date(seen.at)) / 1000) : null;
    const WHY = { 'inside-hours': 'Inside the daily server hours', live: 'The event is live (no daily hours set)', 'outside-hours': 'Outside the daily server hours', 'all-days-done': 'All play days are done', ended: 'The event has ended', 'not-live': 'The event is not live yet', 'forced-open': 'Opened by an admin (OPEN NOW)', 'forced-closed': 'Closed by an admin (CLOSE NOW)' };
    const evs = d.events.filter(e => ['live', 'open', 'soon'].includes(e.status) || e.control !== 'auto');
    box.innerHTML = `<div class="card ${d.connected ? 'accent' : ''}" style="margin-top:22px">
      <div class="row"><h2 style="margin:0;flex:1">SERVER CONTROL</h2><span class="badge ${d.connected ? 'live' : 'withdrawn'}">${d.connected ? 'PLUGIN CONNECTED' : seen ? 'PLUGIN OFFLINE' : 'PLUGIN NOT SET UP'}</span></div>
      <p class="soft small">The <b>MTC Server Control</b> plugin on the Minecraft server opens and closes it by itself, using each event's <b>daily server hours</b>. At closing time it kicks players with a message and keeps them out until the next opening. <b>Staff can always join</b> (LuckPerms groups admin, dev, founder, owner, or the <code>mtc.bypass</code> permission). The server-list MOTD changes too.</p>
      ${seen ? `<p class="small">Last check-in: <b>${ago < 90 ? ago + ' seconds ago' : esc(fmt(seen.at))}</b> · ${seen.players}/${seen.max} players${seen.mc ? ' · ' + esc(seen.mc) : ''}${seen.slug ? ' · event <code>' + esc(seen.slug) + '</code>' : ''}</p>` : ''}
      ${seen && seen.backup && seen.backup.mode ? (() => { const b = seen.backup, sz = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB';
        return `<p class="small">Google Drive backups: ${b.mode === 'off' ? '<b>off</b> <span class="soft">(backup.enabled in the plugin config)</span>' : b.mode === 'unlinked' ? '<b>not linked</b> <span class="soft">(run <code>mtcserver backup link</code> in the server console)</span>' : '<b>on</b>'}${b.busy ? ' · <b>backing up now…</b>' : ''}${b.okAt ? ` · last good backup <b>${esc(fmt(new Date(b.okAt).toISOString()))}</b> (${sz(b.size)})` : ''}${b.error ? ` · <span class="err">last try failed: ${esc(b.error)}</span>` : ''}</p>`; })() : ''}
      ${st.managed ? `<div class="card" style="background:#0d0804;margin:12px 0">
        <div class="row"><b style="flex:1">${esc(st.event.title)}</b><span class="badge ${st.open ? 'live' : 'rejected'}">${st.open ? 'OPEN' : 'CLOSED'}</span></div>
        <p class="soft small" style="margin:6px 0">${esc(WHY[st.why] || st.why)}${st.hours ? ' · daily hours ' + esc(st.hours) : ''}</p>
        <div class="small soft" style="margin-top:8px">Server list (MOTD) right now:</div>
        <div style="font-family:var(--display);font-size:11px;line-height:1.9;background:#000;border:2px solid #333;padding:10px 12px;margin-top:4px">${mcHtml(st.motd)}</div>
        ${st.open ? '' : `<details style="margin-top:8px"><summary class="small">Message players see when they are kicked or try to join</summary><div style="font-family:var(--display);font-size:10px;line-height:1.9;background:#000;border:2px solid #333;padding:10px 12px;margin-top:6px;text-align:center">${mcHtml(st.kick)}</div></details>`}
      </div>` : '<p class="msg info">No live or upcoming event, so the plugin leaves the server open.</p>'}
      ${evs.length ? `<label>Open or close by hand</label><div class="list">${evs.map(e => `<div class="item"><div class="grow"><b>${esc(e.title)}</b> <span class="soft small">${esc(e.status)}${e.hours ? ' · ' + esc(e.hours) : ' · no daily hours'}</span></div>
        <div class="row" style="gap:6px">${[['auto', 'AUTO'], ['open', 'OPEN NOW'], ['closed', 'CLOSE NOW']].map(([v, l]) => `<button class="btn sm ${e.control === v ? '' : 'grey'}" type="button" data-sc="${esc(e.id)}" data-v="${v}">${l}</button>`).join('')}</div></div>`).join('')}</div>
        <p class="soft small">AUTO follows the daily hours (and keeps the server closed while the event is not Live). OPEN NOW and CLOSE NOW stay until you press AUTO again.</p>` : ''}
      <details class="sc-setup" style="margin-top:14px"${seen ? '' : ' open'}><summary><b>SET UP THE PLUGIN</b></summary>
        <div class="sc-steps">
          <div class="sc-step"><b>1</b><div><h4>Install the plugin</h4><p>Put the jar in the Minecraft server's <code>plugins</code> folder (Paper, Purpur or Spigot 1.18+), then restart the server.</p></div>
            ${d.jar ? '<a class="btn sm" href="/api/admin/plugin/jar">DOWNLOAD .JAR</a>' : '<span class="badge rejected">FILE MISSING</span>'}</div>
          <div class="sc-step"><b>2</b><div><h4>Paste the key</h4><p>Open <code>plugins/MTCServerControl/config.yml</code> and paste this into <code>key:</code>. Keep it secret.</p>
            <div class="sc-key"><input type="password" id="sc_key" readonly value="${esc(d.key)}" aria-label="Plugin key"><button class="btn grey sm" type="button" id="sc_show">SHOW</button><button class="btn sm" type="button" id="sc_copy">COPY</button></div>
            <button class="sc-link" type="button" id="sc_new">Make a new key</button></div></div>
          <div class="sc-step"><b>3</b><div><h4>Pick the event <span class="soft small">(optional)</span></h4><p>Set <code>event:</code> to the event's slug, e.g. <code>hide-and-seek</code>. Leave it empty to follow the live event.</p></div></div>
          <div class="sc-step"><b>4</b><div><h4>Connect</h4><p>Run <code>mtcserver reload</code> in the server console. This card turns to <b>PLUGIN CONNECTED</b> in a few seconds.</p></div></div>
          <div class="sc-step"><b>5</b><div><h4>Bedrock players</h4><p>In Geyser's <code>config.yml</code> set <code>passthrough-motd: true</code> so Bedrock shows the same MOTD.</p></div></div>
        </div></details>
    </div>`;
    box.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => {
      if (b.dataset.v === 'closed' && !confirm('Close the server now? Everyone except staff is kicked within a few seconds.')) return;
      api('/api/admin/events/' + b.dataset.sc + '/server-control', { method: 'PUT', body: { control: b.dataset.v } })
        .then(r => { toast(b.dataset.v === 'auto' ? 'Back to the daily hours.' : r.state.open ? 'Server opened.' : 'Server closed. Players are kicked within a few seconds.'); serverControl(box); }).catch(x => toast(x.message, true));
    });
    const k = $('#sc_key');
    $('#sc_show').onclick = e => { k.type = k.type === 'password' ? 'text' : 'password'; e.target.textContent = k.type === 'password' ? 'SHOW' : 'HIDE'; };
    $('#sc_copy').onclick = () => navigator.clipboard.writeText(k.value).then(() => toast('Key copied.'), () => toast('Copy failed. Press SHOW and copy it by hand.', true));
    $('#sc_new').onclick = () => { if (!confirm('Make a new key? The plugin stops working until you paste the new key into its config.')) return;
      api('/api/admin/plugin/new-key', { method: 'POST' }).then(() => { toast('New key made. Paste it into the plugin config.'); serverControl(box); }).catch(x => toast(x.message, true)); };
    clearTimeout(box._t); box._t = setTimeout(() => { if (document.body.contains(box)) serverControl(box); }, 30000);
  }

  /* ---- the bot's own Discord avatar and banner ---- */
  async function botProfile(box) {
    let d; try { d = (await api('/api/admin/bot-profile')).bot; } catch (x) { box.innerHTML = `<div class="card" style="margin-top:22px"><h2 style="margin-top:0">BOT PROFILE</h2><p class="msg err">${esc(x.message)}</p></div>`; return; }
    let evs = []; try { evs = ((await api('/api/events')).events || []).filter(e => e.banner); } catch {}
    const pend = { avatar: undefined, banner: undefined };   // undefined = no change, null = remove, string = new picture
    let bannerY = 50, bannerSrc = null, avatarSrc = null;
    if (!document.getElementById('bpCss')) document.head.insertAdjacentHTML('beforeend', `<style id="bpCss">
      .bp-wrap{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:22px;align-items:start}
      .bp-prof{background:#111214;border:3px solid #000;border-radius:10px;overflow:hidden;box-shadow:0 10px 30px #0008}
      .bp-ban{aspect-ratio:17/6;background:#5865f2 center/cover no-repeat}
      .bp-av{width:92px;height:92px;border-radius:50%;border:7px solid #111214;margin:-48px 0 0 14px;background:#2b2d31 center/cover;position:relative}
      .bp-meta{padding:6px 16px 16px}.bp-meta b{display:block;font:700 19px/1.3 Archivo,sans-serif;color:#f2f3f5}
      .bp-meta span{font-size:13px;color:#b5bac1}.bp-meta em{font-style:normal;font-size:10px;font-weight:700;background:#5865f2;color:#fff;border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:2px}
      .bp-new{outline:3px dashed var(--accent);outline-offset:3px}
      .bp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 14px}
      @media(max-width:760px){.bp-wrap{grid-template-columns:1fr}}</style>`);
    const draw = () => {
      const ban = pend.banner === undefined ? d.banner : pend.banner, av = pend.avatar === undefined ? d.avatar : pend.avatar;
      $('#bpBan').style.backgroundImage = ban ? `url('${ban}')` : ''; $('#bpBan').style.backgroundColor = ban ? '' : (d.accent || '#5865f2');
      $('#bpBan').classList.toggle('bp-new', pend.banner !== undefined); $('#bpAv').style.backgroundImage = av ? `url('${av}')` : ''; $('#bpAv').classList.toggle('bp-new', pend.avatar !== undefined);
      const changes = Object.keys(pend).filter(k => pend[k] !== undefined);
      $('#bpSave').disabled = !changes.length; $('#bpSave').textContent = changes.length ? 'SAVE ' + changes.map(k => k.toUpperCase()).join(' + ') : 'NOTHING TO SAVE';
      $('#bpUndo').hidden = !changes.length; $('#bpY').closest('label').hidden = !bannerSrc;
    };
    // fit a picture into a box (cover), like Discord shows it; GIFs keep their animation and are sent as they are
    const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That picture could not be opened.')); i.src = src; });
    const crop = async (src, W, H, y = 50) => { const i = await loadImg(src), c = document.createElement('canvas'); c.width = W; c.height = H;
      const k = Math.max(W / i.width, H / i.height), w = i.width * k, h = i.height * k; c.getContext('2d').drawImage(i, (W - w) / 2, (H - h) * (y / 100), w, h);
      const png = c.toDataURL('image/png'); return png.length < 7.5e6 ? png : c.toDataURL('image/jpeg', .9); };
    const readFile = f => new Promise((ok, no) => { if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return no(new Error('Pick a PNG, JPG, WEBP or GIF picture.'));
      if (f.size > 10 * 1024 * 1024) return no(new Error('That picture is over 10 MB.')); const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
    const setBanner = async () => { pend.banner = /^data:image\/gif/.test(bannerSrc) ? bannerSrc : await crop(bannerSrc, 1360, 480, bannerY); draw(); };

    box.innerHTML = `<div class="card" style="margin-top:22px"><div class="row"><h2 style="margin:0;flex:1">BOT PROFILE</h2><span class="badge live">${esc(d.name)}</span></div>
      <p class="soft small">The picture and banner of the MTC bot in Discord. New pictures are cropped to Discord's shapes (avatar 1024×1024, banner 680×240 at 17:6). Animated GIFs are kept as they are. <b>Discord lets a bot change these only a few times an hour.</b></p>
      <div class="bp-wrap">
        <div><div class="bp-prof"><div class="bp-ban" id="bpBan"></div><div class="bp-av" id="bpAv"></div><div class="bp-meta"><b>${esc(d.name)}<em>APP</em></b><span>${esc(d.username)}</span></div></div>
          <p class="soft small" style="margin-top:8px">Preview. Dashed outline = not saved yet.</p></div>
        <div>
          <label>Avatar</label><div class="bp-row"><label class="btn grey sm" style="margin:0">CHOOSE PICTURE<input type="file" id="bpAvF" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label></div>
          <label>Banner</label><div class="bp-row"><label class="btn grey sm" style="margin:0">CHOOSE PICTURE<input type="file" id="bpBanF" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
            ${evs.length ? `<select id="bpEv" style="width:auto;max-width:260px"><option value="">…or use an event banner</option>${evs.map(e => `<option value="${esc(e.banner)}">${esc(e.title)}</option>`).join('')}</select>` : ''}
            ${d.banner ? '<button class="btn ghost sm" type="button" id="bpBanX">REMOVE BANNER</button>' : ''}</div>
          <label hidden>Banner position (up / down) <input type="range" id="bpY" min="0" max="100" value="50"></label>
          <div class="row" style="gap:8px;margin-top:10px"><button class="btn" type="button" id="bpSave" disabled>NOTHING TO SAVE</button><button class="btn ghost sm" type="button" id="bpUndo" hidden>UNDO</button></div>
        </div>
      </div></div>`;
    draw();
    const fail = x => toast(x.message || String(x), true);
    $('#bpAvF').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { avatarSrc = await readFile(f); pend.avatar = /^data:image\/gif/.test(avatarSrc) ? avatarSrc : await crop(avatarSrc, 1024, 1024); draw(); } catch (x) { fail(x); } };
    $('#bpBanF').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { bannerSrc = await readFile(f); bannerY = 50; $('#bpY').value = 50; await setBanner(); } catch (x) { fail(x); } };
    if ($('#bpEv')) $('#bpEv').onchange = async e => { if (!e.target.value) return;
      try { const blob = await (await fetch(e.target.value)).blob(); bannerSrc = await readFile(new File([blob], 'b', { type: blob.type })); bannerY = 50; $('#bpY').value = 50; await setBanner(); } catch (x) { fail(x); } };
    $('#bpY').oninput = () => { bannerY = +$('#bpY').value; clearTimeout(botProfile.t); botProfile.t = setTimeout(() => setBanner().catch(fail), 60); };
    if ($('#bpBanX')) $('#bpBanX').onclick = () => { bannerSrc = null; pend.banner = null; draw(); };
    $('#bpUndo').onclick = () => { pend.avatar = undefined; pend.banner = undefined; bannerSrc = avatarSrc = null; if ($('#bpEv')) $('#bpEv').value = ''; draw(); };
    $('#bpSave').onclick = async () => {
      const body = {}; for (const k of ['avatar', 'banner']) if (pend[k] !== undefined) body[k] = pend[k];
      if (!confirm(`Change the bot's ${Object.keys(body).join(' and ')} in Discord now?`)) return;
      $('#bpSave').disabled = true; $('#bpSave').textContent = 'SAVING...';
      try { await api('/api/admin/bot-profile', { method: 'PUT', body }); toast('Saved. Discord can take a minute to show it everywhere.'); botProfile(box); }
      catch (x) { fail(x); draw(); }
    };
  }

  /* ---- seasonal theme: snow, Diwali lights, Pongal petals... ---- */
  async function seasonCard(box) {
    let d; try { d = await api('/api/admin/theme'); } catch { return; }
    const DESC = { winter: 'Falling snow, a snowy edge on the menu', christmas: 'Snow and blinking lights', newyear: 'Fireworks, confetti and lights', pongal: 'Marigold petals and a warm sun',
      diwali: 'Rising sparks, fireworks and diya lamps', halloween: 'Bats and embers', monsoon: 'Rain' };
    const COL = { winter: '#9fd3ff', christmas: '#30d158', newyear: '#ffd60a', pongal: '#ff9f1c', diwali: '#ffb627', halloween: '#9d4edd', monsoon: '#64a8ff' };
    const tile = (k, name, sub, col) => `<button type="button" class="th-tile${d.mode === k ? ' on' : ''}" data-th="${k}" style="--c:${col}"><b>${esc(name)}</b><small>${esc(sub)}</small>${k !== 'auto' && k !== 'off' ? `<a href="/?season=${k}" target="_blank" rel="noopener" data-prev>PREVIEW</a>` : ''}</button>`;
    if (!document.getElementById('thCss')) document.head.insertAdjacentHTML('beforeend', `<style id="thCss">
      .th-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-top:12px}
      .th-tile{position:relative;text-align:left;display:grid;gap:4px;padding:12px 12px 12px 16px;background:#0d0804;border:3px solid #000;color:var(--ink);cursor:pointer;box-shadow:inset 4px 0 0 var(--c)}
      .th-tile b{font:10px/1.5 var(--display);letter-spacing:.04em}.th-tile small{font-size:13px;color:var(--soft);line-height:1.4}
      .th-tile.on{outline:3px solid var(--accent);outline-offset:-3px;background:#1d130a}.th-tile.on b::after{content:" ✓";color:var(--accent)}
      .th-tile a{justify-self:start;margin-top:4px;font:7px var(--display);color:var(--soft);text-decoration:underline}.th-tile a:hover{color:var(--accent)}</style>`);
    const autoName = d.auto ? d.themes[d.auto] : 'nothing';
    box.innerHTML = `<div class="card" style="margin-top:22px"><div class="row"><h2 style="margin:0;flex:1">SEASONAL THEME</h2><span class="badge ${d.active ? 'live' : 'withdrawn'}">${d.active ? 'SHOWING: ' + esc(d.themes[d.active].toUpperCase()) : 'OFF'}</span></div>
      <p class="soft small">Pixel effects over the whole website for the time of year. They never block clicks, pause when the tab is hidden, and visitors can turn them off with a small button. People who ask their device for less motion get the decorations without moving parts.</p>
      <div class="th-grid">
        ${tile('auto', 'AUTO (BY DATE)', `Today: ${autoName}. New Year, Pongal, Diwali, Christmas, Halloween, then Winter (Dec–Feb) or Monsoon (mid Oct–Nov).`, '#f7931e')}
        ${Object.entries(d.themes).map(([k, n]) => tile(k, n.toUpperCase(), DESC[k] || '', COL[k] || '#888')).join('')}
        ${tile('off', 'OFF', 'No seasonal effects', '#555')}
      </div></div>`;
    box.querySelectorAll('[data-th]').forEach(b => b.onclick = e => {
      if (e.target.closest('[data-prev]')) return;   // the preview link opens the home page with that season
      api('/api/admin/theme', { method: 'PUT', body: { mode: b.dataset.th } }).then(r => { toast(r.active ? `Showing ${d.themes[r.active]} on the website.` : 'Seasonal effects are off.'); seasonCard(box); }).catch(x => toast(x.message, true));
    });
  }

  window.MTCX = { seasonCard, botProfile, serverControl, promoCard, community, season, stats, notes, modSummary, whitelist, checkCell, bindCheck, templateBar, duplicate, saveTemplate };
})();
