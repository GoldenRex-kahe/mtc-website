// Community features: season leaderboard, badges, polls, event suggestions, team finder, feedback, attendance,
// whitelist export, event templates, reminders, scheduled posts, moderation notes, stats, live server status,
// "LIVE NOW" YouTube detection and link previews. Installed by app.js with the helpers it already has.
const crypto = require('crypto');
const mcping = require('./mcping');
const fs = require('fs'), path = require('path');

module.exports = function install(x) {
  const { on, routes, D, store, cfg, err, str, int, isoOrNull, readBody, session, needUser, needAdmin, discord, alertUser, alertStaff, linkRow,
    evById, evBy, mcOf, edOf, yt, sortEvents, publicCreators, MC_WORDS, logErr, esc, playerCard, saveImage, serverStatusOf, sessionOf } = x;
  const now = store.now, id = store.id;
  const S = () => D().settings;
  const list = k => (D()[k] = D()[k] || []);
  const userRec = uid => D().users[uid] || {};
  const isMember = u => !!u && (u.adm || u.ig || userRec(u.uid).inGuild || userRec(u.uid).verified) && !userRec(u.uid).blocked;
  const needMember = req => { const u = needUser(req); if (userRec(u.uid).blocked) throw err(403, 'Your account is blocked. Message an admin in Discord.'); if (!isMember(u)) throw err(403, 'Only MTC members can do this. Join the MTC Discord, then log in again.'); return u; };
  const person = u => { const m = mcOf(u.uid, u.un); return { userId: u.uid, name: m.mc || u.name, discordName: u.name, avatar: u.av || '', skin: m.skin || '', edition: m.edition }; };
  const site = () => cfg.publicUrl;

  // ================================================================ attendance (check-in) and no-shows
  const counts = r => r.status === 'approved' && r.attended !== false;
  const noShows = uid => D().registrations.filter(r => r.userId === uid && r.status === 'approved' && r.attended === false).length;
  on('PUT', '/api/admin/registrations/:id/attended', async (req, res, p) => {
    needAdmin(req); const r = D().registrations.find(q => q.id === p.id); if (!r) throw err(404, 'Not found.');
    const b = await readBody(req); r.attended = b.attended === true ? true : b.attended === false ? false : null; store.save(); return { ok: true, attended: r.attended };
  });
  on('POST', '/api/admin/events/:id/checkin-all', async (req, res, p) => {
    needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
    const b = await readBody(req), val = b.attended === false ? false : true; let n = 0;
    for (const r of D().registrations) if (r.eventId === e.id && r.status === 'approved' && (b.overwrite || r.attended == null)) { r.attended = val; n++; }
    store.save(); return { ok: true, changed: n };
  });
  on('GET', '/api/admin/mod-summary', async req => {
    needAdmin(req); const out = {};
    const add = (uid, k) => { (out[uid] = out[uid] || { warnings: 0, bans: 0, notes: 0, noShows: 0 })[k]++; };
    for (const r of D().registrations) if (r.status === 'approved' && r.attended === false) add(r.userId, 'noShows');
    for (const n of list('modNotes')) add(n.userId, n.kind === 'warning' ? 'warnings' : n.kind === 'ban' ? 'bans' : 'notes');
    return { summary: out };
  });

  // ================================================================ whitelist export (Java online/offline UUIDs, Bedrock through Floodgate)
  const dashed = h => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  const offlineUuid = name => { const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest(); h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80; return dashed(h.toString('hex')); };
  async function javaUuids(names) {
    const out = {};
    for (let i = 0; i < names.length; i += 10) {
      const r = await fetch('https://api.minecraftservices.com/minecraft/profile/lookup/bulk/byname', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(names.slice(i, i + 10)) }).catch(() => null);
      const j = r && r.ok ? await r.json().catch(() => []) : [];
      for (const p of j) out[p.name.toLowerCase()] = { uuid: dashed(p.id), name: p.name };
    }
    return out;
  }
  // Xbox IDs: GeyserMC knows gamertags that have joined any Geyser server; it sometimes answers 503, so try again,
  // and remember every ID found (or typed in by an admin) so a list never depends on the lookup working twice
  const xuidStore = () => (S().xuids = S().xuids || {});
  async function xuidOf(tag) {
    const k = String(tag).toLowerCase(); if (xuidStore()[k]) return xuidStore()[k];
    for (let i = 0; i < 3; i++) {
      const r = await fetch('https://api.geysermc.org/v2/xbox/xuid/' + encodeURIComponent(tag), { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (r && r.ok) { const j = await r.json().catch(() => ({})); if (j.xuid) { xuidStore()[k] = String(j.xuid); store.save(); return String(j.xuid); } }
      if (r && r.status !== 503 && r.status !== 429 && r.status < 500) break;
      await new Promise(res => setTimeout(res, 800 * (i + 1)));
    }
    return '';
  }
  async function linkedJava(xuid) {
    const r = await fetch('https://api.geysermc.org/v2/link/bedrock/' + xuid, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => ({})) : {};
    return j && j.java_id ? { uuid: /-/.test(j.java_id) ? j.java_id : dashed(String(j.java_id).replace(/-/g, '')), name: j.java_name || '' } : null;
  }
  on('PUT', '/api/admin/xuid', async req => {
    needAdmin(req); const b = await readBody(req), tag = str(b.gamertag, 20); let xuid = String(b.xuid || '').trim(); if (/^0x[0-9a-f]{1,16}$/i.test(xuid)) xuid = BigInt(xuid).toString();
    if (!tag) throw err(400, 'Missing gamertag.');
    if (xuid && !/^\d{10,20}$/.test(xuid)) throw err(400, 'An XUID is a long number (about 16 digits). If you have the hex one (e.g. 0009000012345678), paste it with 0x in front.');
    const k = tag.toLowerCase(); if (xuid) xuidStore()[k] = xuid; else delete xuidStore()[k]; store.save(); return { ok: true };
  });
  on('GET', '/api/admin/events/:id/whitelist', async (req, res, p, url) => {
    needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
    const offlineMode = url.searchParams.get('mode') === 'offline', prefix = url.searchParams.get('prefix') ?? '.';
    const team = url.searchParams.get('team') || '';
    const regs = D().registrations.filter(r => r.eventId === e.id && r.status === 'approved' && (!team || r.team === team));
    const players = regs.map(r => { const m = mcOf(r.userId, r.username); return { name: m.mc || r.mc || '', edition: m.mc ? m.edition : edOf(r.mcEdition), team: r.team || '', who: r.name }; });
    const missing = players.filter(x => !x.name).map(x => x.who);
    const javaNames = players.filter(x => x.name && x.edition === 'java').map(x => x.name);
    const looked = offlineMode ? {} : await javaUuids(javaNames);
    const out = [];
    for (const pl of players.filter(x => x.name)) {
      if (pl.edition === 'bedrock') {
        // Floodgate gives Bedrock players the UUID 00000000-0000-0000-<XUID in hex> and the name <prefix><gamertag, spaces as _>, cut to 16 characters.
        // If the Bedrock account is linked to a Java account (Geyser global linking), Floodgate uses the Java account instead.
        const xuid = await xuidOf(pl.name);
        const fname = (prefix + pl.name.replace(/ /g, '_')).slice(0, 16);
        if (!xuid) { out.push({ ...pl, listName: fname, uuid: '', xuid: '', note: 'Xbox ID not found. Ask the player for their XUID (cxkes.me/xbox/xuid) and type it here.' }); continue; }
        const link = await linkedJava(xuid);
        if (link) out.push({ ...pl, listName: link.name, uuid: link.uuid, xuid, linked: true, note: 'Linked to the Java account ' + link.name + ' (Floodgate joins as that account)' });
        else out.push({ ...pl, listName: fname, uuid: dashed(BigInt(xuid).toString(16).padStart(32, '0')), xuid, note: '' });
      } else if (pl.edition === 'offline' || offlineMode) out.push({ ...pl, listName: pl.name, uuid: offlineUuid(pl.name), note: '' });
      else { const f = looked[pl.name.toLowerCase()]; out.push({ ...pl, listName: f ? f.name : pl.name, uuid: f ? f.uuid : '', note: f ? '' : 'Not found at Mojang' }); }
    }
    // Bedrock players go in whitelist.json too: Floodgate players are checked by UUID like everyone else
    const json = JSON.stringify(out.filter(x => x.uuid).map(x => ({ uuid: x.uuid, name: x.listName })), null, 2);
    const commands = out.map(x => x.edition === 'bedrock' && !x.linked ? `fwhitelist add ${x.uuid || x.name}` : `whitelist add ${x.listName}`).join('\n');
    return { players: out, missing, json, commands, offlineMode };
  });

  // ================================================================ duplicate events and templates
  const COPY_SKIP = new Set(['id', 'slug', 'results', 'files', 'order', 'createdAt', 'updatedAt', 'reminded', 'remindedFor', 'start', 'end', 'status']);
  const fieldsOf = e => Object.fromEntries(Object.entries(e).filter(([k]) => !COPY_SKIP.has(k)));
  function newDraft(fields, title) {
    const slugify = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
    let slug = slugify(title), n = 2; while (evBy(slug)) slug = slugify(title) + '-' + n++;
    const e = { ...JSON.parse(JSON.stringify(fields)), id: id(), slug, title, status: 'draft', start: null, end: null, results: [], createdAt: now(), updatedAt: now() };
    D().events.push(e); store.save(); return e;
  }
  on('POST', '/api/admin/events/:id/duplicate', async (req, res, p) => {
    needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
    return { event: newDraft(fieldsOf(e), (e.title + ' (copy)').slice(0, 80)) };
  });
  on('GET', '/api/admin/event-templates', async req => { needAdmin(req); return { templates: (S().eventTemplates || []).map(t => ({ id: t.id, name: t.name, type: t.fields.type, at: t.at, by: t.by })) }; });
  on('POST', '/api/admin/event-templates', async req => {
    const u = needAdmin(req); const b = await readBody(req), e = evById(String(b.eventId || '')); if (!e) throw err(404, 'Event not found.');
    const name = str(b.name, 60) || e.title; const t = { id: id(), name, fields: fieldsOf(e), at: now(), by: u.name };
    (S().eventTemplates = S().eventTemplates || []).push(t); store.save(); return { ok: true, template: { id: t.id, name } };
  });
  on('POST', '/api/admin/event-templates/:id/use', async (req, res, p) => {
    needAdmin(req); const t = (S().eventTemplates || []).find(q => q.id === p.id); if (!t) throw err(404, 'Template not found.');
    const b = await readBody(req); return { event: newDraft(t.fields, str(b.title, 80) || t.name) };
  });
  on('DELETE', '/api/admin/event-templates/:id', async (req, res, p) => { needAdmin(req); S().eventTemplates = (S().eventTemplates || []).filter(q => q.id !== p.id); store.save(); return { ok: true }; });

  // ================================================================ seasons, points and the leaderboard
  const DEFAULT_POINTS = { first: 10, second: 7, third: 5, placed: 3, played: 2 };
  const seasonCfg = () => { const s = S().season || {}; return { points: { ...DEFAULT_POINTS, ...(s.points || {}) }, seasons: s.seasons || [], bonus: s.bonus || [] }; };
  const evDate = e => new Date(e.end || e.start || e.createdAt || 0).getTime();
  const inSeason = (t, s) => !s || ((!s.start || t >= new Date(s.start).getTime()) && (!s.end || t <= new Date(s.end).getTime() + 864e5 - 1));
  const tokens = v => String(v || '').split(/[,&/+]| and /i).map(n => n.trim().toLowerCase()).filter(Boolean);
  // points: everyone who played (confirmed, not a no-show) gets 'played'; a place in the results adds its bonus on top
  function standings(season) {
    const pts = seasonCfg().points, rows = new Map();
    const row = (key, base) => { if (!rows.has(key)) rows.set(key, { key, userId: '', name: '', skin: '', avatar: '', edition: 'java', points: 0, events: 0, wins: 0, podiums: 0, bonus: 0, history: [] }); const r = rows.get(key); Object.keys(base).forEach(k => { if (base[k] && !r[k]) r[k] = base[k]; }); return r; };
    const regKey = r => /^\d{15,}$/.test(r.userId) ? r.userId : 'n:' + String(r.name || r.mc || '').toLowerCase();
    const regBase = r => { const pc = playerCard(r); return { userId: /^\d{15,}$/.test(r.userId) ? r.userId : '', name: pc.name, skin: pc.skin, avatar: pc.avatar, edition: pc.edition }; };
    for (const e of D().events.filter(e => (e.status === 'completed' || e.status === 'unsuccessful') && inSeason(evDate(e), season))) {
      const regs = D().registrations.filter(r => r.eventId === e.id && counts(r));
      const got = new Map();   // key -> points from this event (best of place / played)
      for (const r of regs) got.set(regKey(r), { pts: pts.played, place: null, base: regBase(r) });
      for (const res of e.results || []) {
        const want = new Set(tokens(res.name));
        const match = regs.filter(r => { const m = mcOf(r.userId, r.username); return [m.mc, r.mc, r.name, r.username].some(n => n && want.has(String(n).toLowerCase())) || (r.team && want.has(r.team.toLowerCase())); });
        const placePts = res.place === 1 ? pts.first : res.place === 2 ? pts.second : res.place === 3 ? pts.third : pts.placed;
        if (match.length) for (const r of match) { const k = regKey(r), cur = got.get(k); if (!cur.place || res.place < cur.place) got.set(k, { ...cur, pts: pts.played + placePts, place: res.place }); }
        else for (const n of tokens(res.name)) { const k = 'n:' + n; const cur = got.get(k); if (!cur || res.place < cur.place) got.set(k, { pts: pts.played + placePts, place: res.place, base: { name: String(res.name).split(/[,&/+]| and /i).find(s => s.trim().toLowerCase() === n).trim() } }); }
      }
      for (const [k, v] of got) { const r = row(k, v.base); r.points += v.pts; r.events++; if (v.place === 1) r.wins++; if (v.place && v.place <= 3) r.podiums++; r.history.push({ slug: e.slug, title: e.title, place: v.place, points: v.pts }); }
    }
    for (const b of seasonCfg().bonus.filter(b => !season || b.seasonId === season.id || (!b.seasonId && inSeason(new Date(b.at).getTime(), season)))) {
      const k = /^\d{15,}$/.test(b.userId) ? b.userId : 'n:' + String(b.name).toLowerCase();
      const m = b.userId ? mcOf(b.userId, '') : {}; const r = row(k, { userId: b.userId || '', name: m.mc || b.name, skin: m.skin || '' }); r.points += b.points; r.bonus += b.points;
    }
    return [...rows.values()].filter(r => r.points || r.events).sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.name.localeCompare(b.name))
      .map((r, i, a) => ({ ...r, rank: i && a[i - 1].points === r.points && a[i - 1].wins === r.wins ? null : i + 1 })).map((r, i, a) => ({ ...r, rank: r.rank || a.slice(0, i).reverse().find(q => q.rank).rank }));
  }
  const currentSeason = () => { const t = Date.now(), ss = seasonCfg().seasons; return ss.find(s => inSeason(t, s)) || ss.slice().sort((a, b) => String(b.start).localeCompare(String(a.start)))[0] || null; };
  on('GET', '/api/leaderboard', async (req, res, p, url) => {
    const ss = seasonCfg().seasons, q = url.searchParams.get('season');
    const season = q === 'all' ? null : ss.find(s => s.id === q) || currentSeason();
    const rows = standings(season).slice(0, 200).map(r => ({ ...r, badges: r.userId ? badgesOf(r.userId).map(b => ({ icon: b.icon, image: b.image, name: b.name, desc: b.desc, color: b.color })) : [] }));
    return { seasons: ss.map(s => ({ id: s.id, name: s.name, start: s.start, end: s.end })), season: season ? { id: season.id, name: season.name, start: season.start, end: season.end } : null, points: seasonCfg().points, rows };
  });
  on('GET', '/api/admin/season', async req => { needAdmin(req); const c = seasonCfg(); return { ...c, bonus: c.bonus.slice().reverse() }; });
  on('PUT', '/api/admin/season', async req => {
    needAdmin(req); const b = await readBody(req), s = S().season = S().season || {};
    if (b.points) s.points = Object.fromEntries(Object.keys(DEFAULT_POINTS).map(k => [k, int(b.points[k], 0, 1000, DEFAULT_POINTS[k])]));
    if (Array.isArray(b.seasons)) s.seasons = b.seasons.slice(0, 50).map(q => ({ id: str(q.id, 20) || id(), name: str(q.name, 40) || 'Season', start: isoOrNull(q.start), end: isoOrNull(q.end) }));
    store.save(); return { ok: true, ...seasonCfg() };
  });
  on('POST', '/api/admin/season/bonus', async req => {
    const u = needAdmin(req); const b = await readBody(req);
    const userId = /^\d{15,}$/.test(String(b.userId || '')) ? String(b.userId) : '', name = str(b.name, 60) || (userId && (mcOf(userId, '').mc || userRec(userId).name)) || '';
    if (!name) throw err(400, 'Pick a member or type a player name.');
    const points = int(b.points, -1000, 1000, 0); if (!points) throw err(400, 'Enter the points (use a minus number to take points away).');
    const x2 = { id: id(), userId, name, points, reason: str(b.reason, 120), seasonId: str(b.seasonId, 20) || (currentSeason() || {}).id || '', at: now(), by: u.name };
    (S().season = S().season || {}).bonus = [...(S().season.bonus || []), x2]; store.save(); return { ok: true, bonus: x2 };
  });
  on('DELETE', '/api/admin/season/bonus/:id', async (req, res, p) => { needAdmin(req); const s = S().season || {}; s.bonus = (s.bonus || []).filter(q => q.id !== p.id); store.save(); return { ok: true }; });

  // ================================================================ badges: automatic ones from what people did, plus custom ones admins give
  const AUTO = [
    ['first', '🎮', 'First event', 'Played an MTC event', '#3a78b8', s => s.events >= 1],
    ['regular', '🔥', 'Regular', 'Played 5 MTC events', '#c0582a', s => s.events >= 5],
    ['veteran', '🏅', 'Veteran', 'Played 10 MTC events', '#8a5a1c', s => s.events >= 10],
    ['podium', '🥉', 'Podium', 'Finished in the top 3', '#7a5c3a', s => s.podiums >= 1],
    ['winner', '🏆', 'Winner', 'Won an MTC event', '#b8901f', s => s.wins >= 1],
    ['triple', '👑', 'Triple crown', 'Won 3 MTC events', '#d4af37', s => s.wins >= 3],
    ['champion', '🥇', 'Season champion', 'Finished a season in first place', '#e0b528', s => s.champion],
    ['reliable', '✅', 'Reliable', 'Played 3+ events and never missed one', '#2f6b2a', s => s.events >= 3 && !s.noShows],
    ['creator', '⭐', 'Verified creator', 'A verified MTC creator', '#F7931E', s => s.creator],
    ['showcase', '📸', 'In the showcase', 'Shared a screenshot or video', '#8a3d63', s => s.media >= 1],
    ['ideas', '💡', 'Idea maker', 'Suggested an event that MTC ran', '#5b3d8a', s => s.ideas >= 1],
  ];
  const statCache = { at: 0, map: null };
  function playerStats() {
    if (statCache.map && Date.now() - statCache.at < 60e3) return statCache.map;
    const map = new Map(), get = uid => { if (!map.has(uid)) map.set(uid, { events: 0, wins: 0, podiums: 0, champion: false }); return map.get(uid); };
    for (const r of standings(null)) if (r.userId) Object.assign(get(r.userId), { events: r.events, wins: r.wins, podiums: r.podiums });
    const t = Date.now();
    for (const s of seasonCfg().seasons.filter(s => s.end && new Date(s.end).getTime() < t)) { const top = standings(s)[0]; if (top && top.userId) get(top.userId).champion = true; }
    statCache.map = map; statCache.at = Date.now(); return map;
  }
  function badgesOf(uid) {
    const st = { ...(playerStats().get(uid) || { events: 0, wins: 0, podiums: 0 }) }, ex = yt.readExtras(), u = userRec(uid);
    st.noShows = noShows(uid);
    // creator profiles are saved under the Discord ID or the Discord username: the badge shows as soon as an admin verifies the channel
    const un = String(u.username || (discord.cachedMember(uid) || {}).username || '').toLowerCase(), prof = ex[uid] || (un && ex[un]);
    st.creator = !!(prof && prof.verified === true);
    st.media = D().media.filter(m => m.status === 'approved' && m.userId === uid).length;
    st.ideas = list('suggestions').filter(s => s.userId === uid && s.status === 'done').length;
    const auto = AUTO.filter(a => a[5](st)).map(([key, icon, name, desc, color]) => ({ key, icon, image: autoArt(key), name, desc, color, auto: true }));
    const defs = S().badges || [];
    const custom = list('badgeAwards').filter(a => a.userId === uid).map(a => { const d = defs.find(b => b.id === a.badgeId); return d && { key: d.id, icon: d.icon, image: d.image || '', name: d.name, desc: a.reason || d.desc, color: d.color, at: a.at }; }).filter(Boolean);
    void u; return [...custom, ...auto];
  }
  // badge pictures: the built-in pixel art in /assets/badges, unless an admin uploaded their own
  // pixel designs from the badge maker become SVG files (built by our own renderer, so nothing typed can end up in the file)
  const BA = require(path.join(cfg.SITE, 'assets', 'badgeart.js'));
  const PIX_DIR = path.join(store.UPLOADS, 'badges'); fs.mkdirSync(PIX_DIR, { recursive: true });
  function savePixel(design) {
    const d = BA.clean(design), svg = BA.svg(d) + '\n', name = crypto.createHash('sha1').update(svg).digest('hex').slice(0, 16) + '.svg';
    fs.writeFileSync(path.join(PIX_DIR, name), svg); return { image: '/uploads/badges/' + name, pixel: d };
  }
  const autoArt = key => (S().badgeArt || {})[key] || '/assets/badges/' + key + '.svg';
  const autoPixel = key => (S().badgePixel || {})[key] || BA.clean(BA.PRESETS[key]);
  const badgeImage = (v, prev) => v && String(v).startsWith('data:') ? saveImage(v) : v === '' ? '' : (prev || '');
  on('PUT', '/api/admin/badge-art/:key', async (req, res, p) => {
    needAdmin(req); if (!AUTO.some(a => a[0] === p.key)) throw err(404, 'Unknown badge.');
    const b = await readBody(req), art = S().badgeArt = S().badgeArt || {}, pix = S().badgePixel = S().badgePixel || {};
    if (b.pixel) { const r = savePixel(b.pixel); art[p.key] = r.image; pix[p.key] = r.pixel; }
    else if (b.image && String(b.image).startsWith('data:')) { art[p.key] = saveImage(b.image); delete pix[p.key]; }
    else { delete art[p.key]; delete pix[p.key]; }   // empty = back to the built-in art
    store.save(); return { ok: true, image: autoArt(p.key) };
  });
  on('GET', '/api/badges/:uid', async (req, res, p) => ({ badges: /^\d{15,}$/.test(p.uid) ? badgesOf(p.uid) : [] }));
  on('GET', '/api/admin/badges', async req => {
    needAdmin(req);
    return { badges: S().badges || [], auto: AUTO.map(([key, icon, name, desc, color]) => ({ key, icon, name, desc, color, image: autoArt(key), pixel: autoPixel(key), custom: !!(S().badgeArt || {})[key] })),
      awards: list('badgeAwards').slice().reverse().map(a => { const g = discord.cachedMember(a.userId) || {}, m = mcOf(a.userId, ''); return { ...a, who: m.mc || g.name || userRec(a.userId).name || a.userId, avatar: g.avatar || userRec(a.userId).avatar || '' }; }) };
  });
  const cleanBadge = (b, prev = {}) => ({ name: str(b.name, 30, prev.name) || 'Badge', icon: str(b.icon, 8, prev.icon) || '🏅', color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : prev.color || '#F7931E', desc: str(b.desc, 120, prev.desc || ''), image: badgeImage(b.image, prev.image) });
  const withPixel = (body, out) => { if (body.pixel) Object.assign(out, savePixel(body.pixel)); else if (body.image !== undefined) delete out.pixel; return out; };
  on('POST', '/api/admin/badges', async req => { needAdmin(req); const body = await readBody(req); const b = withPixel(body, { id: id(), ...cleanBadge(body) }); (S().badges = S().badges || []).push(b); store.save(); return { ok: true, badge: b }; });
  on('PUT', '/api/admin/badges/:id', async (req, res, p) => { needAdmin(req); const b = (S().badges || []).find(q => q.id === p.id); if (!b) throw err(404, 'Badge not found.'); const body = await readBody(req); Object.assign(b, cleanBadge(body, b)); withPixel(body, b); store.save(); return { ok: true, badge: b }; });
  on('DELETE', '/api/admin/badges/:id', async (req, res, p) => { needAdmin(req); S().badges = (S().badges || []).filter(q => q.id !== p.id); D().badgeAwards = list('badgeAwards').filter(a => a.badgeId !== p.id); store.save(); return { ok: true }; });
  on('POST', '/api/admin/badges/:id/award', async (req, res, p) => {
    const u = needAdmin(req); const b = (S().badges || []).find(q => q.id === p.id); if (!b) throw err(404, 'Badge not found.');
    const body = await readBody(req), uid = String(body.userId || ''); if (!/^\d{15,}$/.test(uid)) throw err(400, 'Pick a member.');
    if (list('badgeAwards').some(a => a.badgeId === b.id && a.userId === uid)) throw err(409, 'They already have this badge.');
    const a = { id: id(), badgeId: b.id, userId: uid, reason: str(body.reason, 120), at: now(), by: u.name };
    list('badgeAwards').push(a); store.save();
    alertUser(uid, 'community', { title: `${b.icon} You got a badge: ${b.name}`, color: 'ok', text: `MTC gave you the **${b.name}** badge${a.reason ? `: ${a.reason}` : b.desc ? `: ${b.desc}` : ''}. It shows on the leaderboard and your profile.`, buttons: [{ label: 'Leaderboard', url: site() + '/leaderboard.html', emoji: '🏆' }] });
    return { ok: true, award: a };
  });
  on('DELETE', '/api/admin/badge-awards/:id', async (req, res, p) => { needAdmin(req); D().badgeAwards = list('badgeAwards').filter(a => a.id !== p.id); store.save(); return { ok: true }; });

  // ================================================================ polls ("what should the next event be?")
  const pollOpen = q => !q.closed && (!q.endsAt || new Date(q.endsAt).getTime() > Date.now());
  function pubPoll(q, u) {
    const mine = u ? (q.votes || {})[u.uid] || [] : [], total = Object.keys(q.votes || {}).length;
    const show = q.results === 'always' || (q.results !== 'closed' && mine.length) || !pollOpen(q) || (u && u.adm);
    const tally = Object.fromEntries(q.options.map(o => [o.id, 0])); for (const v of Object.values(q.votes || {})) for (const o of v) if (o in tally) tally[o]++;
    return { id: q.id, question: q.question, note: q.note || '', multi: !!q.multi, endsAt: q.endsAt, open: pollOpen(q), results: q.results, voters: total, mine,
      options: q.options.map(o => ({ id: o.id, text: o.text, votes: show ? tally[o.id] : null })), createdAt: q.createdAt };
  }
  on('GET', '/api/polls', async req => {
    const u = session(req), qs = list('polls').slice().reverse();
    return { polls: [...qs.filter(pollOpen), ...qs.filter(q => !pollOpen(q)).slice(0, 6)].map(q => pubPoll(q, u)), canVote: isMember(u) };
  });
  on('POST', '/api/polls/:id/vote', async (req, res, p) => {
    const u = needMember(req); const q = list('polls').find(z => z.id === p.id); if (!q) throw err(404, 'Poll not found.');
    if (!pollOpen(q)) throw err(400, 'This poll has closed.');
    const b = await readBody(req), ids = [...new Set((Array.isArray(b.options) ? b.options : [b.options]).map(String))].filter(o => q.options.some(x => x.id === o));
    if (!ids.length) throw err(400, 'Pick an option.'); if (!q.multi && ids.length > 1) throw err(400, 'Pick one option.');
    (q.votes = q.votes || {})[u.uid] = ids; store.save(); return { poll: pubPoll(q, u) };
  });
  const cleanPoll = b => {
    const question = str(b.question, 200); if (!question) throw err(400, 'Write the question.');
    const opts = (Array.isArray(b.options) ? b.options : []).map(o => typeof o === 'string' ? { text: o } : o).map(o => ({ id: str(o.id, 20) || id(), text: str(o.text, 100) })).filter(o => o.text).slice(0, 12);
    if (opts.length < 2) throw err(400, 'Add at least 2 options.');
    return { question, note: str(b.note, 300), options: opts, multi: !!b.multi, endsAt: isoOrNull(b.endsAt), results: ['always', 'voted', 'closed'].includes(b.results) ? b.results : 'voted' };
  };
  on('GET', '/api/admin/polls', async req => { const u = needAdmin(req); return { polls: list('polls').slice().reverse().map(q => ({ ...pubPoll(q, u), closed: !!q.closed })) }; });
  on('POST', '/api/admin/polls', async req => { const u = needAdmin(req); const q = { id: id(), ...cleanPoll(await readBody(req)), votes: {}, closed: false, createdAt: now(), by: u.name }; list('polls').push(q); store.save(); return { ok: true, poll: pubPoll(q, u) }; });
  on('PUT', '/api/admin/polls/:id', async (req, res, p) => {
    const u = needAdmin(req); const q = list('polls').find(z => z.id === p.id); if (!q) throw err(404, 'Poll not found.');
    const b = await readBody(req);
    if (b.closed !== undefined && Object.keys(b).length === 1) q.closed = !!b.closed;
    else { const c = cleanPoll(b), keep = new Set(c.options.map(o => o.id)); Object.assign(q, c); for (const k of Object.keys(q.votes || {})) { q.votes[k] = q.votes[k].filter(o => keep.has(o)); if (!q.votes[k].length) delete q.votes[k]; } if (b.closed !== undefined) q.closed = !!b.closed; }
    store.save(); return { ok: true, poll: pubPoll(q, u) };
  });
  on('DELETE', '/api/admin/polls/:id', async (req, res, p) => { needAdmin(req); D().polls = list('polls').filter(q => q.id !== p.id); store.save(); return { ok: true }; });
  on('POST', '/api/admin/polls/:id/discord', async (req, res, p) => {
    needAdmin(req); const q = list('polls').find(z => z.id === p.id); if (!q) throw err(404, 'Poll not found.');
    const b = await readBody(req), chs = await discord.channels(), ch = chs.find(c => c.id === String(b.channelId || '')); if (!ch) throw err(400, 'Pick a channel.');
    const letters = '🇦 🇧 🇨 🇩 🇪 🇫 🇬 🇭 🇮 🇯 🇰 🇱'.split(' ');
    await discord.send(ch.id, { content: b.ping ? '@everyone' : undefined, allowed_mentions: { parse: b.ping ? ['everyone'] : [] },
      embeds: [{ title: '🗳️ ' + q.question, description: (q.note ? q.note + '\n\n' : '') + q.options.map((o, i) => `${letters[i]} ${o.text}`).join('\n') + (q.endsAt ? `\n\nVoting closes <t:${Math.floor(new Date(q.endsAt) / 1000)}:R>.` : ''), color: 0xF7931E, footer: { text: 'Vote on the MTC website · one vote per member' } }],
      components: linkRow([{ label: 'Vote now', url: site() + '/community.html#poll-' + q.id, emoji: '🗳️' }]) });
    return { ok: true };
  });

  // ================================================================ event suggestions from members and creators
  const SUG_STATUS = { new: 'New', planned: 'Planned', done: 'Made into an event', declined: 'Not this time' };
  const pubSug = (s, u) => ({ id: s.id, title: s.title, type: s.type, text: s.text, teamSize: s.teamSize, by: { name: s.name, avatar: s.avatar, skin: s.skin, userId: s.userId }, votes: (s.votes || []).length, voted: !!(u && (s.votes || []).includes(u.uid)), mine: !!(u && u.uid === s.userId), status: s.status, statusLabel: SUG_STATUS[s.status], reply: s.reply || '', createdAt: s.createdAt });
  on('GET', '/api/suggestions', async req => { const u = session(req); return { suggestions: list('suggestions').filter(s => !s.hidden).map(s => pubSug(s, u)).sort((a, b) => (a.status === 'declined') - (b.status === 'declined') || b.votes - a.votes || b.createdAt.localeCompare(a.createdAt)), canPost: isMember(u) }; });
  on('POST', '/api/suggestions', async req => {
    const u = needMember(req); const b = await readBody(req);
    const title = str(b.title, 80), text = str(b.text, 1500); if (!title || text.length < 10) throw err(400, 'Give your idea a title and a few words about how it works.');
    if (list('suggestions').filter(s => s.userId === u.uid && s.status === 'new' && !s.hidden).length >= 3) throw err(429, 'You already have 3 ideas waiting. Wait for an admin to look at them first.');
    const s = { id: id(), ...person(u), title, text, type: ['survival', 'minigame', 'build', 'pvp', 'other'].includes(b.type) ? b.type : 'other', teamSize: int(b.teamSize, 1, 20, 1), votes: [u.uid], status: 'new', createdAt: now() };
    list('suggestions').push(s); store.save();
    alertStaff('community', { title: `💡 New event idea: ${title}`, text: `**${s.name}** suggested:\n${text.slice(0, 600)}`, tab: 'community' });
    return { ok: true, suggestion: pubSug(s, u) };
  });
  on('POST', '/api/suggestions/:id/vote', async (req, res, p) => {
    const u = needMember(req); const s = list('suggestions').find(z => z.id === p.id && !z.hidden); if (!s) throw err(404, 'Not found.');
    s.votes = s.votes || []; const i = s.votes.indexOf(u.uid); if (i >= 0) s.votes.splice(i, 1); else s.votes.push(u.uid); store.save(); return { suggestion: pubSug(s, u) };
  });
  on('DELETE', '/api/suggestions/:id', async (req, res, p) => {
    const u = needUser(req); const s = list('suggestions').find(z => z.id === p.id); if (!s) throw err(404, 'Not found.');
    if (s.userId !== u.uid && !u.adm) throw err(403, 'You can only delete your own ideas.'); D().suggestions = list('suggestions').filter(z => z !== s); store.save(); return { ok: true };
  });
  on('GET', '/api/admin/suggestions', async req => { const u = needAdmin(req); return { suggestions: list('suggestions').slice().reverse().map(s => ({ ...pubSug(s, u), hidden: !!s.hidden })), statuses: SUG_STATUS }; });
  on('PUT', '/api/admin/suggestions/:id', async (req, res, p) => {
    needAdmin(req); const s = list('suggestions').find(z => z.id === p.id); if (!s) throw err(404, 'Not found.');
    const b = await readBody(req), before = s.status;
    if (SUG_STATUS[b.status]) s.status = b.status; if (b.reply !== undefined) s.reply = str(b.reply, 500); if (b.hidden !== undefined) s.hidden = !!b.hidden;
    store.save();
    if (s.status !== before) alertUser(s.userId, 'community', { title: `💡 Your idea "${s.title}": ${SUG_STATUS[s.status]}`, color: s.status === 'declined' ? 'no' : 'ok',
      text: (s.status === 'planned' ? 'MTC is planning an event from your idea!' : s.status === 'done' ? 'Your idea became an MTC event. Thank you!' : s.status === 'declined' ? 'MTC will not run this one for now.' : 'Your idea was updated.') + (s.reply ? `\n\n**Admin reply:** ${s.reply}` : ''),
      buttons: [{ label: 'See ideas', url: site() + '/community.html#ideas', emoji: '💡' }] });
    return { ok: true };
  });

  // ================================================================ team finder (per event, for team events that are open)
  const lfgOpen = e => e && (e.status === 'open' || e.status === 'soon') && (e.teamSize || 1) > 1;
  const pubLfg = (l, u) => ({ id: l.id, kind: l.kind, team: l.team, need: l.need, note: l.note, name: l.name, discordName: l.discordName, avatar: l.avatar, skin: l.skin, edition: l.edition,
    contact: /^\d{15,}$/.test(l.userId) ? 'https://discord.com/users/' + l.userId : '', mine: !!(u && u.uid === l.userId), createdAt: l.createdAt });
  on('GET', '/api/events/:slug/lfg', async (req, res, p) => {
    const e = evBy(p.slug); if (!e || e.status === 'draft') throw err(404, 'Event not found.'); const u = session(req);
    return { open: lfgOpen(e), teamSize: e.teamSize || 1, posts: list('lfg').filter(l => l.eventId === e.id).slice().reverse().map(l => pubLfg(l, u)), canPost: isMember(u) };
  });
  on('GET', '/api/lfg', async req => {
    const u = session(req), evs = sortEvents(D().events.filter(lfgOpen));
    return { events: evs.map(e => ({ slug: e.slug, title: e.title, teamSize: e.teamSize, status: e.status, posts: list('lfg').filter(l => l.eventId === e.id).slice().reverse().map(l => pubLfg(l, u)) })) };
  });
  on('POST', '/api/events/:slug/lfg', async (req, res, p) => {
    const u = needMember(req); const e = evBy(p.slug); if (!lfgOpen(e)) throw err(400, 'The team finder is only open for team events that are taking sign-ups.');
    const b = await readBody(req), kind = b.kind === 'team' ? 'team' : 'player';
    const l = { id: id(), eventId: e.id, ...person(u), kind, team: kind === 'team' ? str(b.team, 40) : '', need: kind === 'team' ? int(b.need, 1, 19, 1) : 0, note: str(b.note, 300), createdAt: now() };
    if (kind === 'team' && !l.team) throw err(400, 'Give your team a name.');
    D().lfg = list('lfg').filter(z => !(z.eventId === e.id && z.userId === u.uid)); D().lfg.push(l); store.save(); return { ok: true, post: pubLfg(l, u) };
  });
  on('DELETE', '/api/lfg/:id', async (req, res, p) => {
    const u = needUser(req); const l = list('lfg').find(z => z.id === p.id); if (!l) throw err(404, 'Not found.');
    if (l.userId !== u.uid && !u.adm) throw err(403, 'You can only remove your own post.'); D().lfg = list('lfg').filter(z => z !== l); store.save(); return { ok: true };
  });

  // ================================================================ feedback after an event
  const fbSummary = e => { const f = list('feedback').filter(q => q.eventId === e.id); return { count: f.length, avg: f.length ? Math.round(f.reduce((a, q) => a + q.stars, 0) / f.length * 10) / 10 : 0, again: f.filter(q => q.again).length }; };
  const canFeedback = (e, u) => u && e && e.status === 'completed' && (u.adm || D().registrations.some(r => r.eventId === e.id && r.userId === u.uid && r.status === 'approved'));
  on('GET', '/api/events/:slug/feedback', async (req, res, p) => {
    const e = evBy(p.slug); if (!e || e.status === 'draft') throw err(404, 'Event not found.'); const u = session(req);
    const mine = u ? list('feedback').find(q => q.eventId === e.id && q.userId === u.uid) : null;
    return { summary: fbSummary(e), canGive: !!canFeedback(e, u), mine: mine ? { stars: mine.stars, text: mine.text, again: mine.again } : null };
  });
  on('POST', '/api/events/:slug/feedback', async (req, res, p) => {
    const u = needUser(req); const e = evBy(p.slug); if (!canFeedback(e, u)) throw err(403, 'Only players who took part can rate this event, after it has finished.');
    const b = await readBody(req), stars = int(b.stars, 1, 5, 0); if (!stars) throw err(400, 'Pick 1 to 5 stars.');
    let f = list('feedback').find(q => q.eventId === e.id && q.userId === u.uid);
    if (!f) { f = { id: id(), eventId: e.id, ...person(u), createdAt: now() }; list('feedback').push(f); }
    Object.assign(f, { stars, text: str(b.text, 1000), again: !!b.again, updatedAt: now() }); store.save();
    if (stars <= 2) alertStaff('community', { title: `⭐ Low rating for ${e.title}: ${stars}/5`, text: `**${f.name}**: ${f.text || '(no comment)'}`, tab: 'community' });
    return { ok: true, summary: fbSummary(e) };
  });
  on('GET', '/api/admin/feedback', async req => {
    needAdmin(req);
    return { events: sortEvents(D().events.filter(e => e.status === 'completed')).map(e => ({ id: e.id, slug: e.slug, title: e.title, asked: e.feedbackAsked || '', ...fbSummary(e),
      players: D().registrations.filter(r => r.eventId === e.id && r.status === 'approved').length,
      items: list('feedback').filter(q => q.eventId === e.id).slice().reverse().map(q => ({ name: q.name, avatar: q.avatar, stars: q.stars, text: q.text, again: q.again, at: q.updatedAt || q.createdAt })) })) };
  });
  on('POST', '/api/admin/events/:id/ask-feedback', async (req, res, p) => {
    needAdmin(req); const e = evById(p.id); if (!e || e.status !== 'completed') throw err(400, 'Mark the event as completed first.');
    const done = new Set(list('feedback').filter(q => q.eventId === e.id).map(q => q.userId));
    const to = D().registrations.filter(r => r.eventId === e.id && r.status === 'approved' && !done.has(r.userId) && /^\d{15,}$/.test(r.userId));
    for (const r of to) alertUser(r.userId, 'community', { title: `⭐ How was ${e.title}?`, text: `Thanks for playing **${e.title}**! Rate it in 10 seconds so the next event is even better.`, buttons: [{ label: 'Rate the event', url: site() + '/event.html?slug=' + encodeURIComponent(e.slug) + '#feedback', emoji: '⭐' }] });
    e.feedbackAsked = now(); store.save(); return { ok: true, sent: to.length };
  });

  // ================================================================ moderation notes, warnings and bans
  const MOD_KINDS = { note: 'Note', warning: 'Warning', ban: 'Ban', unban: 'Unban' };
  on('GET', '/api/admin/members/:id/notes', async (req, res, p) => {
    needAdmin(req); const u = userRec(p.id);
    return { notes: list('modNotes').filter(n => n.userId === p.id).slice().reverse(), blocked: !!u.blocked, blockedUntil: u.blockedUntil || '', noShows: noShows(p.id),
      history: D().registrations.filter(r => r.userId === p.id).map(r => { const e = evById(r.eventId) || {}; return { event: e.title || 'Deleted event', slug: e.slug, status: r.status, attended: r.attended ?? null, at: r.createdAt }; }).reverse() };
  });
  on('POST', '/api/admin/members/:id/notes', async (req, res, p) => {
    const a = needAdmin(req); if (!/^\d{15,}$/.test(p.id)) throw err(400, 'Unknown member.');
    const b = await readBody(req), kind = MOD_KINDS[b.kind] ? b.kind : 'note', text = str(b.text, 500);
    if (!text && kind !== 'unban') throw err(400, 'Write what happened.');
    const n = { id: id(), userId: p.id, kind, text, until: kind === 'ban' ? isoOrNull(b.until) : null, by: a.name, at: now() };
    list('modNotes').push(n);
    const u = D().users[p.id] = { ...(D().users[p.id] || {}), id: p.id };
    if (kind === 'ban') { u.blocked = true; u.blockedUntil = n.until || ''; u.note = text; }
    if (kind === 'unban') { u.blocked = false; u.blockedUntil = ''; }
    store.save();
    if (b.dm && kind !== 'note') alertUser(p.id, 'member', { title: kind === 'warning' ? '⚠️ A warning from MTC staff' : kind === 'ban' ? '⛔ You are blocked from MTC events' : '✅ You can take part in MTC events again', color: kind === 'unban' ? 'ok' : 'no',
      text: (kind === 'ban' ? `You cannot register for events${n.until ? ' until ' + new Date(n.until).toDateString() : ''}.` : kind === 'warning' ? 'Please read the MTC rules.' : 'Your block has been lifted.') + (text ? `\n\n**Reason:** ${text}` : '') });
    return { ok: true, note: n };
  });
  on('DELETE', '/api/admin/mod-notes/:id', async (req, res, p) => { needAdmin(req); D().modNotes = list('modNotes').filter(n => n.id !== p.id); store.save(); return { ok: true }; });

  // ================================================================ scheduled posts (channel posts and DMs sent later)
  // A scheduled post replays the same request the Messages tab would send, as the admin who scheduled it.
  on('GET', '/api/admin/scheduled', async req => { needAdmin(req); return { scheduled: list('scheduled').slice().sort((a, b) => a.at.localeCompare(b.at)).map(({ by, ...s }) => ({ ...s, byName: by.name })) }; });
  on('POST', '/api/admin/scheduled', async req => {
    const u = needAdmin(req); const b = await readBody(req), at = isoOrNull(b.at);
    if (!at || new Date(at).getTime() < Date.now() + 30e3) throw err(400, 'Pick a time in the future.');
    if (!['channel', 'dm'].includes(b.kind)) throw err(400, 'Unknown message kind.');
    const body = b.body || {}, m = body.message || {};
    const s = { id: id(), kind: b.kind, at, body, status: 'waiting', by: u, summary: str((m.embed && m.embed.title) || m.content || 'Image', 100), target: str(b.targetLabel, 120), createdAt: now() };
    list('scheduled').push(s); store.save(); return { ok: true, id: s.id };
  });
  on('DELETE', '/api/admin/scheduled/:id', async (req, res, p) => { needAdmin(req); D().scheduled = list('scheduled').filter(s => s.id !== p.id || s.status === 'sent'); store.save(); return { ok: true }; });
  async function runScheduled() {
    for (const s of list('scheduled').filter(s => s.status === 'waiting' && new Date(s.at).getTime() <= Date.now())) {
      s.status = 'sending'; store.save();
      const route = routes.find(r => r.method === 'POST' && r.pattern === '/api/admin/messages/' + s.kind);
      const fakeRes = { headersSent: false, writeHead() {}, end() {}, setHeader() {} };
      try { await route.fn({ method: 'POST', headers: { 'x-mtc': '1' }, _preset: s.body, _session: s.by, on() {} }, fakeRes, {}, new URL('http://localhost/')); s.status = 'sent'; s.sentAt = now(); }
      catch (e) { s.status = 'failed'; s.error = e.message; }
      store.save();
    }
  }

  // ================================================================ reminders 1 hour and 10 minutes before an event starts
  function runReminders() {
    const t = Date.now();
    for (const e of D().events.filter(e => ['open', 'soon', 'live'].includes(e.status) && e.start)) {
      if (e.remindedFor !== e.start) { e.reminded = {}; e.remindedFor = e.start; }
      const left = (new Date(e.start).getTime() - t) / 60000;
      for (const mark of [60, 10]) {
        if (e.reminded[mark] || left > mark || left < (mark === 60 ? 15 : -5)) continue;
        e.reminded[mark] = now();
        const regs = D().registrations.filter(r => r.eventId === e.id && r.status === 'approved' && /^\d{15,}$/.test(r.userId));
        for (const r of regs) alertUser(r.userId, 'reminder', { title: `⏰ ${e.title} starts in ${mark === 60 ? '1 hour' : '10 minutes'}`, color: 'new',
          text: `Get ready! **${e.title}** starts <t:${Math.floor(new Date(e.start) / 1000)}:R>.${r.team ? `\nYour team: **${r.team}**` : ''}${e.serverInfo ? '\n\n**Server**\n```\n' + e.serverInfo + '\n```' : ''}`,
          buttons: [{ label: 'Event page', url: site() + '/event.html?slug=' + encodeURIComponent(e.slug), emoji: '🔗' }] });
        store.save();
      }
    }
    // timed bans end by themselves
    for (const [uid, u] of Object.entries(D().users)) if (u.blocked && u.blockedUntil && new Date(u.blockedUntil).getTime() < t) { u.blocked = false; u.blockedUntil = ''; list('modNotes').push({ id: id(), userId: uid, kind: 'unban', text: 'Timed block ended', by: 'Website', at: now() }); store.save(); }
  }
  setInterval(() => { runReminders(); runScheduled().catch(e => logErr('scheduled', e)); }, 30e3).unref();
  setTimeout(() => runReminders(), 5e3).unref();

  // ================================================================ live server status (only while the event is live, or for admins)
  on('GET', '/api/events/:slug/status', async (req, res, p) => {
    const e = evBy(p.slug), u = session(req); if (!e || (e.status === 'draft' && !(u && u.adm))) throw err(404, 'Event not found.');
    if (!(e.statusAddr || e.serverJava || e.serverBedrock)) return { enabled: false };
    if (e.status !== 'live' && !(u && u.adm)) return { enabled: true, shown: false };
    const st = await serverStatusOf(e), main = st.java || st.bedrock;
    return { enabled: true, shown: true, ...main, java: st.java, bedrock: st.bedrock, session: sessionOf(e) };
  });

  // ================================================================ LIVE NOW: verified creators streaming Minecraft on YouTube
  const live = new Map();   // creator id -> { videoId, title, since }
  async function checkLive(c) {
    const base = String((c.socials || {}).youtube || '').replace(/\/+$/, '').replace(/\/(videos|featured|streams|shorts)$/, '');
    if (!base) return;
    try {
      const r = await fetch(base + '/live', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
      const html = await r.text();
      const vid = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
      const isLive = !!vid && /"isLiveNow":true/.test(html);
      const title = ((html.match(/<meta name="title" content="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (isLive && MC_WORDS.test(title + ' ' + ((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''))) {
        const was = live.get(c.id); live.set(c.id, { videoId: vid, title, since: was && was.videoId === vid ? was.since : now(), creator: { id: c.id, username: c.username, name: c.name, logo: c.logo } });
      } else live.delete(c.id);
    } catch { /* keep the last known state on a network error */ }
  }
  async function liveLoop() {
    try {
      const r = await discord.creatorMembers().catch(() => null); const cs = r ? publicCreators(r.members) : [];
      for (const c of cs) { await checkLive(c); await new Promise(s => setTimeout(s, 1500)); }
      for (const k of [...live.keys()]) if (!cs.some(c => c.id === k)) live.delete(k);
    } catch (e) { logErr('live check', e); }
    setTimeout(liveLoop, 3 * 60e3).unref();
  }
  if (!process.env.MTC_NO_LIVE) setTimeout(liveLoop, 8e3).unref();
  on('GET', '/api/live', async () => ({ live: [...live.values()].map(l => ({ ...l, url: 'https://www.youtube.com/watch?v=' + l.videoId, thumb: `https://i.ytimg.com/vi/${l.videoId}/mqdefault.jpg` })) }));

  // ================================================================ stats dashboard
  on('GET', '/api/admin/stats', async req => {
    needAdmin(req); const d = D(), t = Date.now();
    const evs = d.events.filter(e => e.status !== 'draft'), regs = d.registrations;
    const perEvent = sortEvents(evs).slice(0, 12).map(e => { const r = regs.filter(q => q.eventId === e.id); const ap = r.filter(q => q.status === 'approved');
      return { title: e.title, slug: e.slug, status: e.status, signups: r.filter(q => q.status !== 'withdrawn').length, approved: ap.length, rejected: r.filter(q => q.status === 'rejected').length, withdrawn: r.filter(q => q.status === 'withdrawn').length,
        attended: ap.filter(q => q.attended === true).length, noShows: ap.filter(q => q.attended === false).length, slots: e.slots || 0, rating: fbSummary(e).avg, ratings: fbSummary(e).count }; });
    const decided = regs.filter(r => ['approved', 'rejected'].includes(r.status));
    const playedBy = new Map(); for (const r of regs.filter(r => r.status === 'approved' && r.attended !== false && (evById(r.eventId) || {}).status === 'completed')) playedBy.set(r.userId, (playedBy.get(r.userId) || 0) + 1);
    const top = [...playedBy].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([uid, n]) => { const m = mcOf(uid, ''), g = discord.cachedMember(uid) || {}; return { name: m.mc || g.name || userRec(uid).name || uid, avatar: g.avatar || userRec(uid).avatar || '', events: n }; });
    const mem = await discord.allMembers().catch(() => ({ members: [] }));
    const months = []; for (let i = 11; i >= 0; i--) { const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i); months.push(dt.toISOString().slice(0, 7)); }
    const byMonth = (arr, f) => months.map(m => ({ month: m, n: arr.filter(z => String(f(z) || '').slice(0, 7) === m).length }));
    const checked = regs.filter(r => r.status === 'approved' && r.attended != null);
    const ex = yt.readExtras();
    return {
      totals: { members: mem.members.length || Object.values(d.users).filter(u => u.inGuild).length, logins: Object.keys(d.users).length, creators: Object.values(ex).filter(v => v && v.verified === true).length,
        events: evs.length, completed: evs.filter(e => e.status === 'completed').length, upcoming: evs.filter(e => ['open', 'soon', 'live'].includes(e.status)).length,
        registrations: regs.filter(r => r.status !== 'withdrawn').length, approvalRate: decided.length ? Math.round(decided.filter(r => r.status === 'approved').length / decided.length * 100) : null,
        noShowRate: checked.length ? Math.round(checked.filter(r => r.attended === false).length / checked.length * 100) : null,
        avgPlayers: evs.filter(e => e.status === 'completed').length ? Math.round(regs.filter(r => r.status === 'approved' && (evById(r.eventId) || {}).status === 'completed').length / evs.filter(e => e.status === 'completed').length * 10) / 10 : 0,
        media: d.media.filter(m => m.status === 'approved').length, applications: (d.applications || []).length, suggestions: list('suggestions').length, pollVotes: list('polls').reduce((a, q) => a + Object.keys(q.votes || {}).length, 0) },
      perEvent, top,
      growth: { joins: byMonth(mem.members, m => m.joined), signups: byMonth(regs, r => r.createdAt), applications: byMonth(d.applications || [], a => a.createdAt) },
      at: new Date(t).toISOString() };
  });

  // ================================================================ link previews (Discord, WhatsApp...): title, text, picture, countdown
  const abs = u => !u ? '' : /^https?:/.test(u) ? u : site() + u;
  const left = iso => { const ms = new Date(iso).getTime() - Date.now(); if (!(ms > 0)) return ''; const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const ST = { soon: '⏳ Coming soon', open: '🟢 Registration open', live: '🔴 LIVE NOW', completed: '🏁 Finished', unsuccessful: '⚠️ Unsuccessful', cancelled: '⛔ Cancelled' };
  function previewFor(pathname, sp) {
    const base = { title: 'MC Thamizh Creators (MTC)', text: 'The community for Tamil Minecraft creators: events, showcase, creators and more.', image: '/assets/logo.png', big: false };
    try {
      if (pathname === '/event.html') {
        const e = evBy(sp.get('slug') || ''); if (!e || e.status === 'draft') return base;
        const regs = D().registrations.filter(r => r.eventId === e.id && ['pending', 'approved'].includes(r.status)).length;
        const bits = [ST[e.status] || '', e.start && left(e.start) ? `⏳ Starts in ${left(e.start)}` : e.status === 'live' && e.end && left(e.end) ? `Ends in ${left(e.end)}` : '',
          e.slots ? `👥 ${regs}/${e.slots} spots${e.slots - regs > 0 && e.status === 'open' ? ` (${e.slots - regs} left)` : ''}` : regs ? `👥 ${regs} players` : '', e.prize ? `🏆 ${e.prize}` : ''].filter(Boolean);
        return { title: `${e.title} | MTC event`, text: bits.join(' · ') + (e.summary ? '\n' + e.summary.slice(0, 220) : ''), image: e.banner || base.image, big: !!e.banner, when: e.start };
      }
      if (pathname === '/creator.html') {
        const ex = yt.readExtras(), k = String(sp.get('u') || '').toLowerCase();
        const c = Object.entries(ex).find(([key, v]) => v && v.verified === true && (key === k || String(v.username || '').toLowerCase() === k));
        if (c) return { title: `${c[1].channelName || k} | MTC creator`, text: `A verified MC Thamizh Creators member${c[1].mc ? ` · ⛏️ ${c[1].mc}` : ''}. Latest Minecraft videos, events and badges.`, image: c[1].logo || base.image };
        return { ...base, title: 'MTC creator' };
      }
      if (pathname === '/leaderboard.html') { const top = standings(currentSeason()).slice(0, 3); return { title: 'Leaderboard | MTC', text: top.length ? '🏆 ' + top.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.name} (${r.points})`).join('  ') : 'Season points, wins and badges.', image: base.image }; }
      if (pathname === '/community.html') { const open = list('polls').filter(pollOpen).length; return { title: 'Community | MTC', text: (open ? `🗳️ ${open} poll${open > 1 ? 's' : ''} open · ` : '') + 'Vote for the next event, share your event ideas and find a team.', image: base.image }; }
      if (pathname === '/apply.html') return { ...base, title: 'Join MTC', text: 'Apply to join MC Thamizh Creators, the community for Tamil Minecraft YouTubers.' };
      if (pathname === '/' || pathname === '/index.html') {
        const next = sortEvents(D().events.filter(e => ['live', 'open', 'soon'].includes(e.status)))[0];
        return { ...base, text: next ? `${ST[next.status]}: ${next.title}${next.start && left(next.start) ? ` · starts in ${left(next.start)}` : ''}. ` + base.text : base.text, image: next && next.banner ? next.banner : base.image, big: !!(next && next.banner) };
      }
    } catch (e) { logErr('preview', e); }
    return base;
  }
  function previewTags(pathname, sp) {
    const p = previewFor(pathname, sp), url = site() + pathname + (sp.toString() ? '?' + sp : '');
    return [`<meta property="og:site_name" content="MC Thamizh Creators">`, `<meta property="og:type" content="website">`, `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:title" content="${esc(p.title)}">`, `<meta property="og:description" content="${esc(p.text)}">`, `<meta name="description" content="${esc(p.text.split('\n').pop())}">`,
      `<meta property="og:image" content="${esc(abs(p.image))}">`, `<meta name="twitter:card" content="${p.big ? 'summary_large_image' : 'summary'}">`, `<meta name="theme-color" content="#F7931E">`,
      p.when ? `<meta property="event:start_time" content="${esc(p.when)}">` : ''].filter(Boolean).join('\n');
  }

  // ================================================================ activity-log lines for the new admin actions
  function describeExtra(key, p, b, out) {
    const ev = () => (evById(p.id) || {}).title || 'an event';
    const map = {
      'POST /api/admin/events/:id/duplicate': { kind: 'create', icon: '📄', title: `Duplicated ${ev()}` },
      'POST /api/admin/event-templates': { kind: 'create', icon: '📋', title: `Saved an event template: ${b.name || ''}` },
      'POST /api/admin/event-templates/:id/use': { kind: 'create', icon: '📋', title: `Created an event from a template` },
      'DELETE /api/admin/event-templates/:id': { kind: 'delete', icon: '🗑️', title: 'Deleted an event template' },
      'PUT /api/admin/registrations/:id/attended': { kind: 'update', icon: '✔️', title: `Check-in: marked a player ${b.attended === true ? 'present' : b.attended === false ? 'no-show' : 'unchecked'}` },
      'POST /api/admin/events/:id/checkin-all': { kind: 'update', icon: '✔️', title: `Checked in all players of ${ev()}` },
      'PUT /api/admin/season': { kind: 'settings', icon: '🏆', title: 'Changed the season / points settings' },
      'POST /api/admin/season/bonus': { kind: 'update', icon: '➕', title: `Gave ${b.points} bonus points to ${b.name || (out.bonus && out.bonus.name) || 'a player'}`, details: [['Reason', b.reason]] },
      'DELETE /api/admin/season/bonus/:id': { kind: 'delete', icon: '➖', title: 'Removed bonus points' },
      'POST /api/admin/badges': { kind: 'create', icon: '🏅', title: `Created a badge: ${b.icon || ''} ${b.name || ''}` },
      'PUT /api/admin/badges/:id': { kind: 'update', icon: '🏅', title: `Edited a badge: ${b.name || ''}` },
      'DELETE /api/admin/badges/:id': { kind: 'delete', icon: '🗑️', title: 'Deleted a badge' },
      'POST /api/admin/badges/:id/award': { kind: 'member', icon: '🏅', title: 'Gave a badge to a member', details: [['Reason', b.reason]] },
      'PUT /api/admin/badge-art/:key': { kind: 'update', icon: '🖼️', title: b.image ? 'Changed a badge picture' : 'Reset a badge picture to the built-in one' },
      'PUT /api/admin/promo': { kind: 'settings', icon: '🎬', title: b.on ? `Set the pop-up video: ${b.label || 'TRAILER'}${b.title ? ' · ' + b.title : ''}` : 'Turned the pop-up video off' },
      'DELETE /api/admin/badge-awards/:id': { kind: 'delete', icon: '🏅', title: 'Took a badge back' },
      'POST /api/admin/polls': { kind: 'create', icon: '🗳️', title: `Started a poll: ${b.question || ''}` },
      'PUT /api/admin/polls/:id': { kind: 'update', icon: '🗳️', title: b.closed === true ? 'Closed a poll' : 'Edited a poll' },
      'DELETE /api/admin/polls/:id': { kind: 'delete', icon: '🗑️', title: 'Deleted a poll' },
      'POST /api/admin/polls/:id/discord': { kind: 'discord', icon: '📣', title: 'Posted a poll to Discord' },
      'POST /api/polls/:id/vote': { kind: 'member', icon: '🗳️', title: 'Voted in a poll' },
      'POST /api/suggestions': { kind: 'member', icon: '💡', title: `Suggested an event: ${b.title || ''}` },
      'POST /api/suggestions/:id/vote': { kind: 'member', icon: '👍', title: 'Voted for an event idea' },
      'DELETE /api/suggestions/:id': { kind: 'delete', icon: '🗑️', title: 'Deleted an event idea' },
      'PUT /api/admin/suggestions/:id': { kind: 'update', icon: '💡', title: `Updated an event idea${b.status ? ': ' + (SUG_STATUS[b.status] || b.status) : ''}` },
      'POST /api/events/:slug/lfg': { kind: 'member', icon: '🤝', title: 'Posted in the team finder' },
      'DELETE /api/lfg/:id': { kind: 'delete', icon: '🤝', title: 'Removed a team finder post' },
      'POST /api/events/:slug/feedback': { kind: 'member', icon: '⭐', title: `Rated an event ${b.stars}/5` },
      'POST /api/admin/events/:id/ask-feedback': { kind: 'discord', icon: '⭐', title: `Asked players of ${ev()} for feedback`, details: [['DMs', out.sent]] },
      'POST /api/admin/members/:id/notes': { kind: b.kind === 'ban' ? 'security' : 'member', icon: b.kind === 'ban' ? '⛔' : b.kind === 'warning' ? '⚠️' : b.kind === 'unban' ? '✅' : '🗒️', title: `${MOD_KINDS[b.kind] || 'Note'} for a member`, details: [['Text', b.text]] },
      'DELETE /api/admin/mod-notes/:id': { kind: 'delete', icon: '🗑️', title: 'Deleted a moderation note' },
      'POST /api/admin/scheduled': { kind: 'discord', icon: '🕒', title: `Scheduled a ${b.kind === 'dm' ? 'DM' : 'channel post'}`, details: [['When', b.at]] },
      'DELETE /api/admin/scheduled/:id': { kind: 'delete', icon: '🕒', title: 'Cancelled a scheduled post' },
    };
    return map[key] || null;
  }

  // ================================================================ YouTube channel banners for the creator cards (cached 12 h in data/yt-banners.json)
  const BANNER_FILE = path.join(cfg.DATA, 'yt-banners.json');
  let banners = {}; try { banners = JSON.parse(fs.readFileSync(BANNER_FILE, 'utf8')); } catch {}
  const bannerBusy = new Map();
  const bannerKey = u => crypto.createHash('sha1').update(u).digest('hex').slice(0, 16);
  // the page loads banners from our own address: the server downloads each one once and keeps it in data/banner-cache
  const bannerCached = url => { const u = ((url && banners[url]) || {}).url || ''; return u ? '/api/yt-banner/' + bannerKey(u) : ''; };
  const BAN_DIR = path.join(cfg.DATA, 'banner-cache'); fs.mkdirSync(BAN_DIR, { recursive: true });
  on('GET', '/api/yt-banner/:key', async (req, res, p) => {
    if (!/^[0-9a-f]{16}$/.test(p.key)) throw err(404, 'Not found');
    const file = path.join(BAN_DIR, p.key + '.jpg');
    let buf; try { buf = fs.readFileSync(file); } catch {
      const src = Object.values(banners).map(b => b.url).find(u => u && bannerKey(u) === p.key); if (!src) throw err(404, 'Not found');
      const r = await fetch(src, { signal: AbortSignal.timeout(15000) }).catch(() => null); if (!r || !r.ok) throw err(502, 'Banner not available');
      buf = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(file, buf);
    }
    const png = buf[0] === 0x89, webp = buf.slice(8, 12).toString() === 'WEBP';
    res.writeHead(200, { 'Content-Type': png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }); res.end(buf);
  });
  function bannerOf(url) {
    const base = String(url || '').replace(/\/+$/, '').replace(/\/(videos|featured|streams|shorts)$/, ''); if (!/^https:\/\/(www\.|m\.)?youtube\.com\//.test(base)) return Promise.resolve('');
    const hit = banners[url]; if (hit && Date.now() - hit.at < 12 * 3600e3) return Promise.resolve(hit.url);
    if (bannerBusy.has(url)) return bannerBusy.get(url);
    const p = fetch(base, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(12000) })
      .then(r => r.text()).then(h => {
        const m = h.match(/"imageBannerViewModel":\{"image":\{"sources":\[\{"url":"([^"]+)"/) || h.match(/"banner":\{"thumbnails":\[\{"url":"([^"]+)"/);
        const u = m ? m[1].replace(/\u0026/g, '&').replace(/=w\d+/, '=w1280') : '';
        banners[url] = { url: /^https:\/\/yt3\.(googleusercontent|ggpht)\.com\//.test(u) ? u : '', at: Date.now() };
        try { fs.writeFileSync(BANNER_FILE, JSON.stringify(banners)); } catch {}
        return banners[url].url;
      }).catch(() => '').finally(() => bannerBusy.delete(url));
    bannerBusy.set(url, p); return p;
  }

  // ================================================================ pop-up video (trailer / announcement) in the bottom-right corner of the site
  const promoPublic = () => {
    const p = S().promo; if (!p || !p.on || !p.videoId) return null;
    const t = Date.now(); if ((p.from && new Date(p.from).getTime() > t) || (p.until && new Date(p.until).getTime() < t)) return null;
    return { id: p.id, videoId: p.videoId, label: p.label, title: p.title, link: p.link, linkLabel: p.linkLabel, pages: p.pages };
  };
  on('GET', '/api/promo', async () => ({ promo: promoPublic() }));
  on('GET', '/api/admin/promo', async req => { needAdmin(req); return { promo: S().promo || null, active: !!promoPublic() }; });
  on('PUT', '/api/admin/promo', async req => {
    const u = needAdmin(req); const b = await readBody(req), prev = S().promo || {};
    const videoId = yt.videoId(str(b.video, 300)); if (b.on && !videoId) throw err(400, 'Paste a YouTube video link (normal, Shorts or youtu.be).');
    let link = str(b.link, 300); if (link && !/^https:\/\//.test(link) && !link.startsWith('/')) throw err(400, 'The button link must start with https:// or /');
    const p = { id: videoId && videoId === prev.videoId ? prev.id : id(), on: !!b.on, video: str(b.video, 300), videoId: videoId || '', label: str(b.label, 24) || 'TRAILER', title: str(b.title, 80),
      link, linkLabel: str(b.linkLabel, 24) || 'Learn more', pages: b.pages === 'home' ? 'home' : 'all', from: isoOrNull(b.from), until: isoOrNull(b.until), by: u.name, at: now() };
    if (b.resetSeen) p.id = id();   // show it again to people who closed it
    S().promo = p; store.save(); return { ok: true, promo: p, active: !!promoPublic() };
  });

  return { bannerOf, bannerCached, previewTags, describeExtra, badgesOf, NO_LOG: ['POST /api/polls/:id/vote', 'POST /api/suggestions/:id/vote'] };
};
