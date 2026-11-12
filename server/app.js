// MTC web server: static site + JSON API. No dependencies. Start with `node server.js` from the project folder.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
// who is making the current request (so background work like DM alerts knows which admin caused it)
const actor = new AsyncLocalStorage();
// keep the site running if something unexpected throws; the error goes to the console and data/server.log
const logErr = (kind, e) => { const line = `[${new Date().toISOString()}] ${kind}: ${(e && e.stack) || e}
`; console.error(line); try { require('fs').appendFileSync(require('path').join(__dirname, '..', 'data', 'server.log'), line); } catch {} };
process.on('uncaughtException', e => logErr('uncaughtException', e));
process.on('unhandledRejection', e => logErr('unhandledRejection', e));
const cfg = require('./env');
const store = require('./db');
const discord = require('./discord');
const yt = require('./youtube');
const audit = require('./audit');
const gateway = require('./gateway');

// ---------------------------------------------------------------- helpers
const err = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
const str = (v, max, def = '') => (v == null ? def : String(v)).trim().slice(0, max);
const int = (v, lo, hi, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const isoOrNull = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const httpsUrl = v => { const s = str(v, 300); if (!s) return ''; try { const u = new URL(s); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const slugify = t => str(t, 80).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
const EVENT_STATUS = ['draft', 'soon', 'open', 'live', 'completed', 'unsuccessful', 'cancelled'];
const EVENT_TYPES = ['survival', 'minigame', 'build', 'pvp', 'other'];

function readBody(req, limit = 7 * 1024 * 1024) {
  if (req._preset) return Promise.resolve(req._body = req._preset);   // scheduled posts replay a saved request body
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(err(413, 'That upload is too large (max about 5 MB).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!size) return resolve(req._body = {}); try { resolve(req._body = JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(err(400, 'Bad request body')); } });
    req.on('error', reject);
  });
}

// Images arrive as data URLs. Check the real file bytes, not just the claimed type.
const MAGIC = [['png', b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47], ['jpg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['webp', b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP'], ['gif', b => b.slice(0, 3).toString() === 'GIF']];
function saveImage(dataUrl) {
  const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw err(400, 'Please choose a PNG, JPG, WEBP or GIF image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw err(413, 'Images must be under 5 MB.');
  const kind = MAGIC.find(([, ok]) => ok(buf));
  if (!kind) throw err(400, 'That file is not a supported image.');
  const name = store.id() + '.' + kind[0];
  fs.writeFileSync(path.join(store.UPLOADS, name), buf);
  return '/uploads/' + name;
}

// ---------------------------------------------------------------- sessions (signed cookie, nothing secret inside)
const secure = cfg.publicUrl.startsWith('https:');
const sign = p => crypto.createHmac('sha256', cfg.sessionSecret).update(p).digest('base64url');
function cookies(req) { const o = {}; for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } return o; }
function setCookie(name, value, maxAge) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`; }
function makeSession(u) {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Date.now() + 14 * 864e5 })).toString('base64url');
  return setCookie('mtc', p + '.' + sign(p), 14 * 86400);
}
function session(req) {
  if (req._session) return req._session;   // scheduled posts run as the admin who scheduled them
  const c = cookies(req).mtc; if (!c) return null;
  const [p, s] = c.split('.'); if (!p || !s) return null;
  const a = Buffer.from(sign(p)), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const u = JSON.parse(Buffer.from(p, 'base64url').toString()); return u.exp > Date.now() ? u : null; } catch { return null; }
}
const needUser = req => { const u = session(req); if (!u) throw err(401, 'Please log in first.'); return u; };
const needAdmin = req => { const u = needUser(req); if (!u.adm) throw err(403, 'Admins only.'); return u; };

// simple per-IP limiter for password attempts
const tries = new Map();
function limited(ip) { const t = Date.now(), list = (tries.get(ip) || []).filter(x => t - x < 10 * 60 * 1000); list.push(t); tries.set(ip, list); return list.length > 8; }

// ---------------------------------------------------------------- public shapes
const D = () => store.db;
const evBy = slug => D().events.find(e => e.slug === slug) || D().events.find(e => (e.oldSlugs || []).includes(slug));
const evById = id => D().events.find(e => e.id === id);
function syncSlugs() {
  let changed = false;
  for (const e of D().events) {
    const base = slugify(e.title); if (e.slug === base) continue;
    let slug = base, n = 2;
    while (D().events.some(x => x.id !== e.id && (x.slug === slug || (x.oldSlugs || []).includes(slug)))) slug = base + '-' + n++;
    e.oldSlugs = [...new Set([...(e.oldSlugs || []), e.slug])].filter(x => x !== slug); e.slug = slug; changed = true;
  }
  if (changed) store.save();
}
// a player's face for lists: uploaded skin or Minecraft-name skin (face is cut from the skin in the page), else Discord picture
// Java names use Mojang skins; Bedrock (Xbox gamertags, can have spaces) use the GeyserMC skin lookup
// java = premium (Mojang) account, offline = cracked / non-premium Java account (no Mojang check, default skin), bedrock = Xbox gamertag
const edOf = e => e === 'bedrock' ? 'bedrock' : e === 'offline' ? 'offline' : 'java';
const skinUrl = (mc, ed) => !mc ? '' : edOf(ed) === 'bedrock' ? '/api/skin-be/' + encodeURIComponent(mc) : edOf(ed) === 'offline' ? '/api/skin-off/' + encodeURIComponent(mc) : '/api/skin/' + encodeURIComponent(mc);
// a name the member sets themself also replaces the one on their creator profile (otherwise the profile's old name keeps showing)
function syncProfileMc(uid, un, mc, edition) {
  const ex = yt.readExtras(), key = ex[uid] ? uid : ex[String(un || '').toLowerCase()] ? String(un).toLowerCase() : null;
  if (!key) return; ex[key].mc = mc; ex[key].mcEdition = edOf(edition); yt.writeExtras(ex);
}
function mcOf(uid, un) {
  const ex = yt.readExtras(), x = ex[uid] || ex[String(un || '').toLowerCase()] || {}, u = (uid && D().users[uid]) || {};
  const mc = x.mc || u.mc || '', edition = edOf(x.mc ? x.mcEdition : u.mcEdition);
  return { mc, edition, skin: x.skin || u.skin || skinUrl(mc, edition) };
}
function playerCard(r) {
  const u = D().users[r.userId] || {}, m = mcOf(r.userId, r.username);
  const gm = discord.cachedMember(r.userId);
  return { name: m.mc || r.mc || r.username || r.name, edition: m.mc ? m.edition : edOf(r.mcEdition), team: r.team || '', skin: m.skin || skinUrl(r.mc, r.mcEdition), avatar: u.avatar || (gm && gm.avatar) || '' };
}
function pubEvent(e) {
  const regs = D().registrations.filter(r => r.eventId === e.id);
  // server address is only public while the event is live
  return { ...e, files: (e.files || []).map(pubFile), serverInfo: e.status === 'live' ? e.serverInfo || '' : '', statusAddr: undefined, hasStatus: !!(e.statusAddr || e.serverJava || e.serverBedrock),
    ...(e.status === 'live' ? {} : { serverJava: '', serverBedrock: '', serverBedrockPort: '', serverExtra: [] }), serverPost: undefined, reminded: undefined, remindedFor: undefined, taken: regs.filter(r => r.status === 'pending' || r.status === 'approved').length,
    participants: regs.filter(r => r.status === 'approved').map(r => playerCard(r)) };
}
function pubMedia(m) {
  const e = evById(m.eventId) || {};
  return { id: m.id, type: m.type, url: m.url, thumb: m.thumb, caption: m.caption, creator: m.creator, creatorLogo: m.creatorLogo || '', published: m.published || '', eventSlug: e.slug, eventTitle: e.title, createdAt: m.createdAt };
}
// a YouTube video's real upload date (looked up once from YouTube, then kept on the showcase item) so videos can be sorted by it
async function videoDate(m) {
  if (m.type !== 'youtube' || m.published || (m.publishedTried && Date.now() - new Date(m.publishedTried) < 864e5)) return;
  const vid = m.videoId || yt.videoId(m.url); if (!vid) return;
  m.publishedTried = store.now();
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20241101.00.00', hl: 'en' } }, videoId: vid }) });
    const j = await r.json(), mf = j.microformat && j.microformat.playerMicroformatRenderer, d = mf && (mf.publishDate || mf.uploadDate);
    if (d && !isNaN(new Date(d))) m.published = new Date(d).toISOString();
  } catch {}
}
const fillVideoDates = async list => { const todo = list.filter(m => m.type === 'youtube' && !m.published); if (!todo.length) return;
  await Promise.race([Promise.all(todo.slice(0, 40).map(videoDate)), new Promise(r => setTimeout(r, 5000))]); store.save(); };
const evOrder = e => ({ live: 0, open: 1, soon: 2, draft: 3, completed: 4, unsuccessful: 4, cancelled: 4 }[e.status] ?? 5);
// admins can set the order by hand (Admin > Events, arrows); events without a set order follow by status and date
const sortEvents = list => list.slice().sort((a, b) => ((a.order ?? 1e9) - (b.order ?? 1e9)) || evOrder(a) - evOrder(b) || String(b.start || b.createdAt).localeCompare(String(a.start || a.createdAt)));

// Profile fields shared by the member form and the admin editor.
const SOCIAL_KEYS = ['instagram', 'discord', 'x', 'twitch', 'facebook', 'website', 'website2', 'website3']; // up to 3 "website or other" links
const YT_CHANNEL = /^https:\/\/(www\.|m\.)?youtube\.com\/(@|channel\/|c\/|user\/)/i;
function cleanSocials(src) {
  const out = {};
  for (const k of SOCIAL_KEYS) {
    const raw = str(src && src[k], 300); if (!raw) continue;
    const v = httpsUrl(raw); if (!v) throw err(400, `The ${k === 'x' ? 'X' : k.startsWith('website') ? 'website' : k} link must start with https://`);
    out[k] = v;
  }
  return out;
}
function cleanFeatured(raw) {
  const s = str(raw, 300); if (!s) return null;
  const v = yt.videoId(s); if (!v) throw err(400, 'The featured video must be a YouTube video link.');
  return { id: v, url: 'https://www.youtube.com/watch?v=' + v };
}
function cleanMc(raw, edition) {
  if (edOf(edition) === 'bedrock') {
    // Xbox gamertag: letters, numbers and single spaces; a leading "." (Floodgate prefix) is dropped
    const mc = str(raw, 20).replace(/^[.*]/, '').replace(/\s+/g, ' ').trim();
    if (mc && !/^[A-Za-z][A-Za-z0-9 _]{1,15}$/.test(mc)) throw err(400, 'Bedrock gamertags are 2 to 16 letters, numbers and spaces, starting with a letter.');
    return mc;
  }
  const mc = str(raw, 16);
  if (mc && !/^\w{3,16}$/.test(mc)) throw err(400, 'Java usernames are 3 to 16 letters, numbers or underscores. Playing on Bedrock? Pick Bedrock.');
  if (mc && edOf(edition) === 'offline' && !/^\w{3,16}$/.test(mc)) throw err(400, 'Offline names are 3 to 16 letters, numbers or underscores.');
  return mc;
}
// checks the name really exists: Java with Mojang (an unknown name is refused); Bedrock with GeyserMC,
// which only knows gamertags that have joined a Geyser server, so an unknown gamertag is still accepted
async function checkMc(mc, edition) {
  if (edOf(edition) === 'bedrock') {
    const r = await fetch('https://api.geysermc.org/v2/xbox/xuid/' + encodeURIComponent(mc)).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => ({})) : {};
    return { name: mc, found: !!j.xuid };
  }
  if (edOf(edition) === 'offline') return { name: mc, found: false };   // cracked accounts are not in Mojang's records: nothing to check
  const look = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(mc)).catch(() => null);
  if (look && (look.status === 404 || look.status === 204)) throw err(400, `No premium Java account is called "${mc}". Check the spelling, or pick Offline if you play without a premium account (or Bedrock).`);
  let real = mc; if (look && look.ok) { const j = await look.json().catch(() => ({})); if (j.name) real = j.name; }
  return { name: real, found: true };
}

// Uploaded skins (PNG from NameMC's Download button, or the player's own file). Checked to be a real Minecraft skin.
const SKIN_DIR = path.join(store.UPLOADS, 'skins');
fs.mkdirSync(SKIN_DIR, { recursive: true });
function saveSkin(dataUrl, key) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw err(400, 'The skin must be a PNG file.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 300 * 1024 || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw err(400, 'That is not a skin PNG (or it is too large).');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (!((w === 64 && (h === 64 || h === 32)) || (w === h && [128, 256, 512].includes(w)))) throw err(400, `A Minecraft skin is 64x64 pixels; this image is ${w}x${h}.`);
  const file = String(key).replace(/[^a-z0-9_.-]/gi, '_') + '.png';
  fs.writeFileSync(path.join(SKIN_DIR, file), buf);
  return '/uploads/skins/' + file + '?v=' + Date.now();
}

function publicCreators(members) {
  const extras = yt.readExtras(), out = [];
  for (const m of members) {
    const x = extras[m.id] || extras[m.username.toLowerCase()];
    if (!x || x.verified !== true || !x.socials || !x.socials.youtube || !x.logo) continue;
    out.push({ id: m.id, username: m.username, name: x.channelName || m.name, logo: x.logo, mc: x.mc, mcEdition: edOf(x.mcEdition), skin: x.skin || skinUrl(x.mc, x.mcEdition), socials: x.socials, featured: x.featured || null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- event fields from the admin form
// --- Discord alerts: DMs to members when an admin decides something, and a staff channel for new things to review
const ALERT_KINDS = { registration: 'Event registrations', media: 'Showcase uploads', profile: 'Creator profiles', application: 'Join applications', member: 'Member verified / blocked / warned', reminder: 'Event reminders (1 hour and 10 min before)', community: 'Badges, ideas, polls and feedback' };
const alertCfg = () => { const a = D().settings.alerts || {}; return { reportFails: a.reportFails !== false, logChannel: a.logChannel || '', dm: { ...Object.fromEntries(Object.keys(ALERT_KINDS).map(k => [k, true])), ...(a.dm || {}) }, staffChannel: a.staffChannel || '', staff: { ...Object.fromEntries(Object.keys(ALERT_KINDS).map(k => [k, true])), ...(a.staff || {}) } }; };
const COL = { ok: 0x4c9a2a, no: 0xa63a2b, info: 0x3a78b8, new: 0xF7931E };
const logAlert = x => { const l = D().settings.alertLog = D().settings.alertLog || []; l.push({ id: store.id(), at: store.now(), ...x }); if (l.length > 200) l.splice(0, l.length - 200); return l[l.length - 1]; };
const dmError = e => e.code === 50007 ? 'Discord would not deliver it: their DMs are closed, or they left the server.' : e.code === 10013 ? 'That Discord account no longer exists.' : e.status === 429 ? 'Discord asked the bot to slow down. Try again in a minute.' : e.message;
function alertEmbed({ title, text, color }) {
  return { author: { name: 'MTC · MC Thamizh Creators', icon_url: cfg.publicUrl + '/assets/logo.png' }, title: title.slice(0, 256), description: String(text || '').slice(0, 4000), color: COL[color] || COL.info, timestamp: new Date().toISOString() };
}
// fire and forget: an alert never blocks or breaks the admin action; every try is logged with the full message
function alertUser(userId, kind, { title, text, color = 'info', buttons = [] }) {
  if (!/^\d{15,}$/.test(String(userId || '')) || !alertCfg().dm[kind] || !discord.ready()) return;
  const who = (discord.cachedMember(userId) || {}), u = D().users[userId] || {}, by = actor.getStore() || null;
  const rec = { kind, to: userId, toName: who.name || u.name || '', toUsername: who.username || u.username || '', toAvatar: who.avatar || u.avatar || '',
    title, text: String(text || ''), color, buttons: buttons.filter(Boolean).map(x => ({ label: x.label, url: x.url })), by: by && by.name ? { name: by.name, admin: !!by.admin } : null, ok: null, tries: 0 };
  sendAlert(rec);
}
function sendAlert(rec) {
  rec.tries = (rec.tries || 0) + 1; rec.lastTry = store.now();
  return discord.dmSend(rec.to, { embeds: [alertEmbed(rec)], components: rec.buttons.length ? linkRow(rec.buttons) : undefined, allowed_mentions: { parse: [] } })
    .then(() => { rec.ok = true; rec.error = ''; })
    .catch(e => { rec.ok = false; rec.error = dmError(e); if (rec.tries === 1) reportDmFail({ to: rec.to, name: rec.toName, username: rec.toUsername, what: rec.title, reason: rec.error }); })
    .finally(() => { if (!rec.id) logAlert(rec); store.save(); });
}
// ---- failed DM reports: when the bot cannot DM someone, tell the admins in the staff channel (or the log channel)
function reportDmFail({ to, name, username, what, reason, list }) {
  const c = alertCfg(); if (!c.reportFails || !discord.ready()) return;
  const ch = c.staffChannel || c.logChannel;
  const g = to ? discord.cachedMember(to) || {} : {};
  audit.log({ who: { name: 'MTC bot' }, kind: 'security', icon: '⚠️', title: list ? `${list.length} DMs could not be delivered` : `DM not delivered to ${name || g.name || to}`,
    details: [['What', what], ['Reason', reason], ['People', list ? list.map(x => x.name).slice(0, 15).join(', ') : '']] });
  if (!ch) return;
  const fields = list
    ? [{ name: `Not delivered (${list.length})`, value: list.slice(0, 20).map(x => `• ${x.name} — ${x.reason}`).join('\n').slice(0, 1024) + (list.length > 20 ? `\n…and ${list.length - 20} more` : '') }]
    : [{ name: 'Member', value: `${to ? `<@${to}>` : ''} ${name || g.name || ''}${username || g.username ? ` (@${username || g.username})` : ''}`.trim() || 'unknown', inline: true },
       { name: 'Reason', value: String(reason || 'unknown').slice(0, 1024), inline: true }];
  const embed = { title: list ? '⚠️ Some DMs were not delivered' : '⚠️ DM not delivered', description: `**${String(what || 'A message').slice(0, 300)}**\n\nThey did not get this in Discord. Please tell them another way, or ask them to open their DMs (Server Settings → Privacy → Allow direct messages) and press Retry.`,
    color: 0xc0392b, fields, footer: { text: 'MC Thamizh Creators · DM report' }, timestamp: new Date().toISOString() };
  discord.send(ch, { embeds: [embed], components: linkRow([{ label: 'Open DM alerts', url: cfg.publicUrl + '/admin.html', emoji: '🔔' }]), allowed_mentions: { parse: [] } })
    .catch(e => console.warn('DM report failed:', e.message));
}
const failedDmCount = () => (D().settings.alertLog || []).filter(x => x.ok === false && !x.seen).length;

function alertStaff(kind, { title, text, fields = [], tab = '' }) {
  const c = alertCfg(); if (!c.staffChannel || !c.staff[kind] || !discord.ready()) return;
  const embed = { title: title.slice(0, 256), description: String(text || '').slice(0, 4000), color: COL.new, fields: fields.filter(f => f && f.value).slice(0, 10), footer: { text: 'MTC website' }, timestamp: new Date().toISOString() };
  discord.send(c.staffChannel, { embeds: [embed], components: linkRow([{ label: 'Open admin', url: cfg.publicUrl + '/admin.html' + (tab ? '#' + tab : ''), emoji: '🛠️' }]), allowed_mentions: { parse: [] } })
    .catch(e => { logAlert({ kind, to: 'staff channel', title, ok: false, error: e.message }); store.save(); });
}
audit.init({ send: (ch, payload) => discord.send(ch, payload), channel: () => (discord.ready() ? alertCfg().logChannel : '') });
const evLink = e => ({ label: 'Event page', url: cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug), emoji: '🔗' });

// --- custom forms (event registration questions, join application questions)
const FORM_TYPES = ['text', 'textarea', 'number', 'url', 'select', 'radio', 'checkbox', 'yesno'];
function cleanForm(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.slice(0, 20).map(f => {
    const type = FORM_TYPES.includes(f && f.type) ? f.type : 'text';
    let id = String((f && f.id) || '').replace(/[^\w]/g, '').slice(0, 20) || 'q' + crypto.randomBytes(3).toString('hex');
    while (seen.has(id)) id += 'x'; seen.add(id);
    const options = ['select', 'radio', 'checkbox'].includes(type) ? [...new Set((Array.isArray(f.options) ? f.options : []).map(o => str(o, 60)).filter(Boolean))].slice(0, 20) : [];
    return { id, label: str(f && f.label, 120), type, required: !!(f && f.required), help: str(f && f.help, 160), options };
  }).filter(f => f.label && (!['select', 'radio', 'checkbox'].includes(f.type) || f.options.length >= 2));
}
function checkAnswers(form, raw) {
  const a = raw && typeof raw === 'object' ? raw : {}, out = {};
  for (const f of form || []) {
    let v = a[f.id];
    if (f.type === 'checkbox') { v = (Array.isArray(v) ? v : []).map(String).filter(x => f.options.includes(x)); if (f.required && !v.length) throw err(400, `Answer "${f.label}".`); if (v.length) out[f.id] = v; continue; }
    v = String(v == null ? '' : v).trim();
    if (!v) { if (f.required) throw err(400, `Answer "${f.label}".`); continue; }
    if (f.type === 'select' || f.type === 'radio') { if (!f.options.includes(v)) throw err(400, `Pick one of the choices for "${f.label}".`); }
    else if (f.type === 'yesno') { if (v !== 'Yes' && v !== 'No') throw err(400, `Answer "${f.label}" with Yes or No.`); }
    else if (f.type === 'number') { if (!isFinite(+v)) throw err(400, `"${f.label}" needs a number.`); v = String(+v); }
    else if (f.type === 'url') { const u = httpsUrl(v); if (!u) throw err(400, `"${f.label}" needs a link starting with https://`); v = u; }
    else v = v.slice(0, f.type === 'textarea' ? 1000 : 200);
    out[f.id] = v;
  }
  return out;
}

function eventFields(b, prev = {}) {
  const title = str(b.title, 80, prev.title);
  if (!title) throw err(400, 'The event needs a title.');
  const status = EVENT_STATUS.includes(b.status) ? b.status : (prev.status || 'draft');
  const out = {
    title, status,
    type: EVENT_TYPES.includes(b.type) ? b.type : (prev.type || 'other'),
    dateLabel: str(b.dateLabel, 40, prev.dateLabel || ''),
    start: b.start !== undefined ? isoOrNull(b.start) : (prev.start || null),
    end: b.end !== undefined ? isoOrNull(b.end) : (prev.end || null),
    days: int(b.days, 0, 365, prev.days || 0), daysPlayed: int(b.daysPlayed, 0, 365, prev.daysPlayed || 0),
    slots: int(b.slots, 0, 1000, prev.slots || 0), teamSize: int(b.teamSize, 1, 20, prev.teamSize || 1),
    prize: str(b.prize, 120, prev.prize || ''), summary: str(b.summary, 600, prev.summary || ''),
    rules: str(b.rules, 8000, prev.rules || ''), notes: str(b.notes, 1500, prev.notes || ''),
    serverInfo: str(b.serverInfo, 300, prev.serverInfo || ''),
    // how to join: Java address, Bedrock IP + port, and extra rows like "Voice chat port (BE)" (all hidden until the event is live)
    serverJava: str(b.serverJava, 120, prev.serverJava || ''), serverBedrock: str(b.serverBedrock, 120, prev.serverBedrock || ''),
    serverBedrockPort: b.serverBedrockPort !== undefined ? (String(b.serverBedrockPort).trim() ? String(int(b.serverBedrockPort, 1, 65535, 19132)) : '') : (prev.serverBedrockPort || ''),
    // daily server hours ("14:00" to "22:30", India time); empty = the server is open all the time while live
    hoursFrom: b.hoursFrom !== undefined ? (/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hoursFrom) ? b.hoursFrom : '') : (prev.hoursFrom || ''),
    hoursTo: b.hoursTo !== undefined ? (/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hoursTo) ? b.hoursTo : '') : (prev.hoursTo || ''),
    serverExtra: Array.isArray(b.serverExtra) ? b.serverExtra.slice(0, 6).map(x => ({ label: str(x && x.label, 40), value: str(x && x.value, 120) })).filter(x => x.label && x.value) : (prev.serverExtra || []),
    // live status on the event page: the address the website pings (shown only while the event is live)
    statusAddr: str(b.statusAddr, 120, prev.statusAddr || ''), statusEdition: b.statusEdition === 'bedrock' ? 'bedrock' : b.statusEdition === 'java' ? 'java' : (prev.statusEdition || 'java'),
    form: b.form !== undefined ? cleanForm(b.form) : (prev.form || []),
    titleOver: b.titleOver !== undefined ? !!b.titleOver : !!prev.titleOver,
    // archive: what someone needs to run this event again
    mcVersion: str(b.mcVersion, 40, prev.mcVersion || ''), software: str(b.software, 60, prev.software || ''), recreateNotes: str(b.recreateNotes, 6000, prev.recreateNotes || ''),
  };
  // banner focus point ("x% y%") and fit ("cover" crops, "contain" shows the whole image)
  out.bannerPos = /^\d{1,3}% \d{1,3}%$/.test(String(b.bannerPos || '')) ? b.bannerPos : (prev.bannerPos || '50% 50%');
  out.bannerFit = b.bannerFit === 'contain' || b.bannerFit === 'cover' ? b.bannerFit : (prev.bannerFit || 'cover');
  if (b.banner && String(b.banner).startsWith('data:')) out.banner = saveImage(b.banner);
  else if (b.banner === '') out.banner = '';
  else out.banner = prev.banner || '';
  return out;
}

// ---------------------------------------------------------------- event card for Discord
const ST_LABEL = { draft: 'Draft', soon: 'Coming soon', open: 'Registration open', live: 'Live now', completed: 'Completed', unsuccessful: 'Unsuccessful', cancelled: 'Cancelled' };
const ST_COLOR = { draft: 0x555555, soon: 0x3a78b8, open: 0x4c9a2a, live: 0xF7931E, completed: 0xD4AF37, unsuccessful: 0xb5651d, cancelled: 0xa63a2b };
const TYPE_ICON = { survival: '🌲', build: '🏗️', minigame: '🎯', pvp: '⚔️', hardcore: '💀', other: '🎮', civilization: '🏰' };
const ST_ICON = { soon: '⏳', open: '🟢', live: '🔴', completed: '🏁', unsuccessful: '⚠️', cancelled: '⛔', draft: '📝' };
const bar = (n, of) => { const k = Math.round(Math.min(1, n / of) * 10); return '▰'.repeat(k) + '▱'.repeat(10 - k); };
// link buttons under a message (Discord allows these for bots without any extra setup)
const linkRow = btns => [{ type: 1, components: btns.filter(Boolean).slice(0, 5).map(x => ({ type: 2, style: 5, label: x.label.slice(0, 80), url: x.url, ...(x.emoji ? { emoji: { name: x.emoji } } : {}) })) }];
const TYPE_NAME = { survival: 'Survival', build: 'Build', minigame: 'Minigame', pvp: 'PvP', hardcore: 'Hardcore', other: 'Other', civilization: 'Civilization' };
// the rules: the rules message in Discord when it was posted there, else the rules on the website
function rulesLink(e) { return (e.rulesPost && e.rulesPost.url) || cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug) + '#rules'; }
function bannerFile(e, embed) {
  if (!e.banner) return [];
  const n = path.basename(e.banner), ext = n.split('.').pop().toLowerCase(), fp = path.join(store.UPLOADS, n);
  if (!fs.existsSync(fp)) return [];
  embed.image = { url: 'attachment://banner.' + ext };
  return [{ name: 'banner.' + ext, buf: fs.readFileSync(fp), type: MIME[ext] || 'image/png' }];
}
const unixOf = iso => Math.floor(new Date(iso).getTime() / 1000);
function eventCard(e) {
  const url = cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug);
  const pe = pubEvent(e), fields = [], live = e.status === 'live', ended = ['completed', 'unsuccessful', 'cancelled'].includes(e.status);
  const gap = { name: '\u200b', value: '\u200b', inline: true };
  // when: one wide field so the dates do not wrap (Discord shows <t:...> in each reader's own time zone)
  const when = [e.start ? `**Starts**  <t:${unixOf(e.start)}:F>  ·  <t:${unixOf(e.start)}:R>` : `**Starts**  ${e.dateLabel || 'To be announced'}`,
    e.end && `**Ends**  <t:${unixOf(e.end)}:F>`].filter(Boolean).join('\n');
  fields.push({ name: '📅 When', value: when, inline: false });
  // the game, three short columns
  fields.push({ name: `${TYPE_ICON[e.type] || '🎮'} Mode`, value: TYPE_NAME[e.type] || 'Other', inline: true });
  fields.push({ name: '👥 Format', value: e.teamSize > 1 ? `Teams of ${e.teamSize}` : 'Solo', inline: true });
  fields.push({ name: '🗓️ Length', value: e.days ? `${e.days} day${e.days > 1 ? 's' : ''}` : 'One session', inline: true });
  if (e.slots) fields.push({ name: '🎟️ Slots', value: `${bar(pe.taken, e.slots)}  **${pe.taken} / ${e.slots}**${pe.taken >= e.slots ? ' · **FULL**' : ''}`, inline: false });
  else fields.push({ name: '🎟️ Registered', value: `**${pe.taken}** player${pe.taken === 1 ? '' : 's'}`, inline: true });
  if (e.prize) fields.push({ name: '🏆 Prize', value: e.prize.slice(0, 1024), inline: !e.slots });
  if (e.rules) fields.push({ name: '📜 Rules', value: `Read the rules before you play: **[open the rules](${rulesLink(e)})**${e.rulesPost && e.rulesPost.url ? ' (posted in Discord)' : ''}`, inline: false });
  void gap;
  const lead = { open: '**Registration is open!** Press **Register** below to join.', soon: 'Registration opens soon. Keep an eye on this channel.', live: '🔴 **The event is live now!** Join the server below.', completed: 'This event is over. Thanks to everyone who played!', unsuccessful: 'This event did not go as planned. Thanks to everyone who played!', cancelled: 'This event was cancelled.' }[e.status];
  const embed = { author: { name: `MTC EVENT · ${ST_ICON[e.status] || ''} ${(ST_LABEL[e.status] || e.status).toUpperCase()}`, icon_url: cfg.publicUrl + '/assets/logo.png' },
    title: `${TYPE_ICON[e.type] || '🎮'} ${e.title}`.slice(0, 256), url, description: [e.summary && `>>> ${e.summary}`, lead].filter(Boolean).join('\n\n').slice(0, 4000),
    color: ST_COLOR[e.status] || 0xF7931E, fields, thumbnail: { url: cfg.publicUrl + '/assets/logo.png' },
    footer: { text: 'MC Thamizh Creators', icon_url: cfg.publicUrl + '/assets/logo.png' }, timestamp: new Date().toISOString() };
  const files = bannerFile(e, embed);
  const btns = [
    e.status === 'open' && { label: 'Register', url, emoji: '📝' },
    { label: ended ? 'Results and videos' : 'Event page', url, emoji: ended ? '🏆' : '🔗' },
    e.rules && { label: 'Rules', url: rulesLink(e), emoji: '📜' },
    e.status === 'completed' && { label: 'Showcase', url: url + '#showcase', emoji: '🎬' },
    (e.files || []).length && { label: 'Downloads', url: url + '#recreate', emoji: '📦' },
    { label: 'All events', url: cfg.publicUrl + '/#events', emoji: '🗂️' }];
  return { embeds: [embed], components: linkRow(btns.filter(Boolean).slice(0, 5)), files };
}
// "the event has ended" announcement with the winner and the podium
function endCard(e) {
  const url = cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug), pe = pubEvent(e);
  const res = (e.results || []).slice().sort((a, b) => a.place - b.place), medal = ['🥇', '🥈', '🥉'], pts = r => r.points ? ` · ${r.points} pts` : '';
  const fields = [];
  if (res.length) {
    fields.push({ name: '👑 WINNER', value: `# ${res[0].name}${res[0].points ? `\n**${res[0].points} points**` : ''}`, inline: false });
    if (res.length > 1) fields.push({ name: '🏅 Podium', value: res.slice(0, 3).map((r, i) => `${medal[i]} **${r.name}**${pts(r)}`).join('\n'), inline: false });
    if (res.length > 3) fields.push({ name: 'Also placed', value: res.slice(3, 10).map(r => `**#${r.place}** ${r.name}${pts(r)}`).join('\n').slice(0, 1024), inline: false });
  } else fields.push({ name: '👑 Winner', value: e.status === 'unsuccessful' ? 'No winner this time.' : 'Results are coming soon on the event page.', inline: false });
  fields.push({ name: '👥 Players', value: `**${pe.taken}**`, inline: true });
  if (e.days) fields.push({ name: '🗓️ Days played', value: `**${e.daysPlayed || e.days}** / ${e.days}`, inline: true });
  fields.push({ name: '🏁 Ended', value: `<t:${unixOf(e.end && new Date(e.end) < new Date() ? e.end : new Date().toISOString())}:D>`, inline: true });
  const lead = e.status === 'unsuccessful' ? 'This event did not go as planned, but thank you to everyone who joined in!'
    : `**${e.title}** is over! Congratulations to the winner${res.length > 1 ? 's' : ''} and thank you to everyone who played. 🎉`;
  const embed = { author: { name: 'MTC EVENT · 🏁 EVENT ENDED', icon_url: cfg.publicUrl + '/assets/logo.png' },
    title: `🏁 ${e.title} has ended`.slice(0, 256), url, description: lead + '\n\nVideos, screenshots and full results are on the event page.',
    color: e.status === 'unsuccessful' ? ST_COLOR.unsuccessful : 0xF2C230, fields, thumbnail: { url: cfg.publicUrl + '/assets/logo.png' },
    footer: { text: 'MC Thamizh Creators', icon_url: cfg.publicUrl + '/assets/logo.png' }, timestamp: new Date().toISOString() };
  const files = bannerFile(e, embed);
  const btns = [{ label: 'Results and videos', url, emoji: '🏆' }, { label: 'Showcase', url: url + '#showcase', emoji: '🎬' }, { label: 'Season leaderboard', url: cfg.publicUrl + '/#leaderboard', emoji: '📊' }, { label: 'All events', url: cfg.publicUrl + '/#events', emoji: '🗂️' }];
  return { embeds: [embed], components: linkRow(btns), files };
}
async function postEnded(e, opt = {}) {
  const ch = opt.channelId || cfg.announceChannel;
  if (!ch) throw err(400, 'Pick a channel to post in.');
  const card = endCard(e), ping = opt.ping || {};
  const pre = [ping.everyone && '@everyone', ping.here && '@here', ...(ping.roles || []).map(r => `<@&${r}>`)].filter(Boolean).join(' ');
  await discord.send(ch, { content: pre, embeds: card.embeds, components: card.components,
    allowed_mentions: { parse: ping.everyone || ping.here ? ['everyone'] : [], roles: ping.roles || [] } }, card.files);
  e.endPostedAt = store.now(); store.save();
}
async function postEvent(e, opt = {}) {
  const ch = opt.channelId || cfg.announceChannel;
  if (!ch) throw err(400, 'Pick a channel to post in.');
  const card = eventCard(e), ping = opt.ping || {};
  const pre = [ping.everyone && '@everyone', ping.here && '@here', ...(ping.roles || []).map(r => `<@&${r}>`)].filter(Boolean).join(' ');
  await discord.send(ch, { content: pre, embeds: card.embeds, components: card.components,
    allowed_mentions: { parse: ping.everyone || ping.here ? ['everyone'] : [], roles: ping.roles || [] } }, card.files);
  e.discordPostedAt = store.now(); store.save();
}
// the event's rules as their own message (long rules are split over several embeds / messages)
function splitText(t, max) {
  const out = []; let cur = '';
  for (const line of String(t).split('\n')) {
    if ((cur + '\n' + line).length > max && cur) { out.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + line : line;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) out.push(cur); return out;
}
async function postRules(e, opt = {}) {
  const ch = opt.channelId || cfg.announceChannel;
  if (!ch) throw err(400, 'Pick a channel to post in.');
  if (!String(e.rules || '').trim()) throw err(400, 'This event has no rules yet. Add them in the event editor.');
  const url = cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug);
  const parts = splitText(e.rules, 3900), ping = opt.ping || {};
  const pre = [ping.everyone && '@everyone', ping.here && '@here', ...(ping.roles || []).map(r => `<@&${r}>`)].filter(Boolean).join(' ');
  for (let i = 0; i < parts.length; i++) {
    const first = i === 0, last = i === parts.length - 1;
    const embed = { color: ST_COLOR[e.status] || 0xF7931E, description: parts[i] };
    if (first) Object.assign(embed, { author: { name: 'MTC EVENT RULES', icon_url: cfg.publicUrl + '/assets/logo.png' }, title: `📜 ${e.title}`.slice(0, 256), url });
    if (last) Object.assign(embed, { footer: { text: 'Breaking the rules can get you removed from the event · MC Thamizh Creators', icon_url: cfg.publicUrl + '/assets/logo.png' }, timestamp: new Date().toISOString() });
    const btns = [e.status === 'open' && { label: 'Register', url, emoji: '📝' }, { label: 'Event page', url, emoji: '🔗' }, { label: 'Rules on the website', url: url + '#rules', emoji: '📜' }];
    const msg = await discord.send(ch, { content: first ? pre : '', embeds: [embed], ...(last ? { components: linkRow(btns) } : {}),
      allowed_mentions: { parse: first && (ping.everyone || ping.here) ? ['everyone'] : [], roles: first ? ping.roles || [] : [] } });
    if (first && msg && msg.id) e.rulesPost = { channelId: ch, messageId: msg.id, url: `https://discord.com/channels/${cfg.guild}/${ch}/${msg.id}` };
  }
  e.rulesPostedAt = store.now(); store.save();
  return parts.length;
}
// the server address as its own message, in a code box so it is easy to copy
// ---- the server post: how to join (Java / Bedrock / extra ports) plus the live server status.
// While the event is live the bot edits the same message every 2 minutes, so the status in Discord stays current.
const mcping = require('./mcping');
// ---- daily server hours: is the server open right now, when does it open next, and which day of the event that is
const IST = 330 * 6e4, DAY = 864e5;   // the times are India time (UTC+5:30, no summer time)
function sessionOf(e, now = Date.now()) {
  if (!e.hoursFrom || !e.hoursTo || e.hoursFrom === e.hoursTo) return null;
  const mins = s => +s.slice(0, 2) * 60 + +s.slice(3, 5), f = mins(e.hoursFrom) * 6e4, t = mins(e.hoursTo) * 6e4;
  const loc = now + IST, day0 = Math.floor(loc / DAY) * DAY, m = loc - day0, len = t > f ? t - f : t + DAY - f;
  let openAt;   // (India "clock" ms) start of the current session, or of the next one
  if (t > f) openAt = m < t ? day0 + f : day0 + DAY + f;
  else openAt = m >= f ? day0 + f : m < t ? day0 - DAY + f : day0 + f;   // the hours cross midnight
  const open = loc >= openAt && loc < openAt + len;
  let day = 1;
  if (e.start) day = Math.max(1, Math.floor(openAt / DAY) - Math.floor((new Date(e.start).getTime() + IST) / DAY) + 1);
  const days = e.days || 0, toIso = x => new Date(x - IST).toISOString();
  const over = (!!days && day > days) || (!!e.end && openAt - IST >= new Date(e.end).getTime());
  return { open: open && !over, from: e.hoursFrom, to: e.hoursTo, day, days, opensAt: toIso(openAt), closesAt: toIso(openAt + len), over };
}
const hm = s => { const [h, m] = s.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
async function serverStatusOf(e) {
  const javaAddr = e.statusAddr && e.statusEdition !== 'bedrock' ? e.statusAddr : e.serverJava;
  const beAddr = e.serverBedrock ? e.serverBedrock.replace(/:\d+$/, '') + ':' + (e.serverBedrockPort || (e.serverBedrock.match(/:(\d+)$/) || [, 19132])[1]) : (e.statusAddr && e.statusEdition === 'bedrock' ? e.statusAddr : '');
  const [java, bedrock] = await Promise.all([javaAddr ? mcping.status(javaAddr, 'java') : null, beAddr ? mcping.status(beAddr, 'bedrock') : null]);
  return { java, bedrock };
}
// laid out like a server-status bot: name + MOTD, then Status / Player Count / Version, then how to join
const statusCard = require('./statuscard');
function statusImage(e, st) {
  const main = st.java || st.bedrock, live = e.status === 'live';
  try {
    const ss = live ? sessionOf(e) : null, closed = ss && !ss.open ? ss : null;
    const buf = statusCard.render({ title: e.title, closed: closed && { over: closed.over, day: closed.day, days: closed.days, opens: new Date(closed.opensAt), hours: `${hm(closed.from)} - ${hm(closed.to)}` }, online: !closed && !!(live && main && main.online), ended: ['completed', 'unsuccessful', 'cancelled'].includes(e.status),
      java: e.serverJava, bedrock: (e.serverBedrock || '').replace(/:\d+$/, ''), bedrockPort: e.serverBedrock ? (e.serverBedrockPort || (e.serverBedrock.match(/:(\d+)$/) || [, '19132'])[1]) : '',
      extras: e.serverExtra || [], status: live ? main || {} : {} });
    return { name: 'server-status.png', buf, type: 'image/png' };
  } catch (x) { logErr('status card', x); return null; }
}
function serverEmbed(e, st, thumb, withImage) {
  const url = cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug), live = e.status === 'live', ended = ['completed', 'unsuccessful', 'cancelled'].includes(e.status);
  const j = st.java, be = st.bedrock, main = j || be, on = !!(live && main && main.online);
  const code = v => '```\n' + String(v).slice(0, 120) + '\n```';
  const motd = on && main.motd ? main.motd.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 2).join('\n') : '';
  const ss = live ? sessionOf(e) : null, closed = !!(ss && !ss.open), dayTxt = ss ? `**Day ${ss.day}**${ss.days ? ` of ${ss.days}` : ''}` : '';
  const unix = iso => Math.floor(new Date(iso) / 1000);
  const hoursLine = ss ? `🕑 Server hours: **${hm(ss.from)} – ${hm(ss.to)}** every day` : '';
  let closedDesc = '';
  if (closed) {
    closedDesc = ss.over ? `🏁 All the play days are done. Thanks for playing!\n${hoursLine}`
      : `⏰ The server is **closed** right now.\nIt opens <t:${unix(ss.opensAt)}:t> (<t:${unix(ss.opensAt)}:R>) for ${dayTxt}.\n**Please be ready on time!**\n\n${hoursLine}`;
  }
  const description = on ? (motd || `Join **${e.title}** now!`)
    : live ? (main ? 'The server is **offline** right now. This message updates by itself when it comes online.' : `**${e.title}** is live now!`)
    : ended ? 'This event has ended. Thanks to everyone who played!' : 'The server opens when the event goes live.';
  const fields = withImage ? [] : [
    { name: 'Status', value: on ? (j && be && be.online ? '🟢 Online (Java + Bedrock)' : '🟢 Online') : live && main ? '🔴 Offline' : ended ? '🏁 Ended' : '⏳ Not open yet', inline: true },
    { name: 'Player Count', value: on ? `${main.players.online}/${main.players.max}` : '–', inline: true },
    { name: 'Version', value: (on && main.version) || '–', inline: true },
  ];
  if (!ended) {
    const host = a => String(a || '').trim().replace(/:\d+$/, '').toLowerCase(), port = a => (String(a || '').match(/:(\d+)$/) || [])[1] || '';
    const beHost = String(e.serverBedrock || '').trim().replace(/:\d+$/, ''), bePort = e.serverBedrockPort || port(e.serverBedrock) || (e.serverBedrock ? '19132' : '');
    const same = !!(e.serverJava && e.serverBedrock && host(e.serverJava) === beHost.toLowerCase());
    if (same) {   // one address for both editions, then each port on its own line
      fields.push({ name: '🌐 Server IP (Java + Bedrock)', value: code(beHost), inline: false });
      if (port(e.serverJava)) fields.push({ name: '☕ Java Port', value: code(port(e.serverJava)), inline: false });
      fields.push({ name: '📱 Bedrock Port', value: code(bePort), inline: false });
    } else {
      if (e.serverJava) fields.push({ name: '☕ Java IP', value: code(e.serverJava), inline: false });
      if (e.serverBedrock) { fields.push({ name: '📱 Bedrock IP', value: code(beHost), inline: false }); fields.push({ name: '🔌 Bedrock Port', value: code(bePort), inline: false }); }
    }
    for (const x of e.serverExtra || []) fields.push({ name: x.label.slice(0, 256), value: code(x.value), inline: false });
    const notes = String(e.serverInfo || '').trim();
    fields.push({ name: '⚠️ Important', value: (notes && (e.serverJava || e.serverBedrock) ? notes : '• Enter the IP and port for **your** edition (Java or Bedrock)\n• Make sure you join the correct edition!\n• Only registered players can join').slice(0, 1024) });
    if (!live && e.start) fields.push({ name: '📅 Starts', value: `<t:${Math.floor(new Date(e.start) / 1000)}:F> · <t:${Math.floor(new Date(e.start) / 1000)}:R>` });
  }
  const top = ss ? `📅 ${dayTxt} · open until <t:${unix(ss.closesAt)}:t>\n` : '';
  if (closed) return serverEmbedOut(e, url, closedDesc, withImage ? fields.filter(f => !['Status', 'Player Count', 'Version'].includes(f.name)) : fields, 0xF2A62C, thumb, withImage, live);
  return serverEmbedOut(e, url, top + (withImage ? (on ? `🟢 **Online** · ${main.players.online}/${main.players.max} players · tap the addresses below to copy them` : description) : description), fields,
    on ? 0x4c9a2a : live && main ? 0xa63a2b : ended ? 0x777777 : 0xF7931E, thumb, withImage, live);
}
function serverEmbedOut(e, url, description, fields, color, thumb, withImage, live) {
  return { title: e.title.slice(0, 256), url, color,
    description: description.slice(0, 4000), fields: fields.slice(0, 25),
    ...(withImage ? { image: { url: 'attachment://server-status.png' } } : { thumbnail: { url: thumb || cfg.publicUrl + '/assets/logo.png' } }),
    footer: { text: live ? 'MTC Event Server · updates every 2 minutes' : 'MTC Event Server', icon_url: cfg.publicUrl + '/assets/logo.png' }, timestamp: new Date().toISOString() };
}
async function refreshServerPosts() {
  for (const e of D().events.filter(x => x.serverPost && x.serverPost.active)) {
    try {
      const st = e.status === 'live' ? await serverStatusOf(e) : {};
      const img = statusImage(e, st);
      await discord.edit(e.serverPost.channelId, e.serverPost.messageId, { embeds: [serverEmbed(e, st, '', !!img)] }, img ? [img] : []);
      if (e.status !== 'live') { e.serverPost.active = false; store.save(); }   // one last edit when the event ends, then stop
    } catch (x) { if (x.status === 404 || x.code === 10008) { e.serverPost.active = false; store.save(); } }
  }
}
if (!process.env.MTC_NO_BOT) setInterval(() => { if (discord.ready()) refreshServerPosts().catch(() => {}); }, 120e3).unref();
async function postServer(e, opt = {}) {
  const ch = opt.channelId || cfg.announceChannel;
  if (!ch) throw err(400, 'Pick a channel to post in.');
  if (e.serverJava || e.serverBedrock) {
    const url = cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug), ping = opt.ping || {};
    const pre = [ping.everyone && '@everyone', ping.here && '@here', ...(ping.roles || []).map(r => `<@&${r}>`)].filter(Boolean).join(' ');
    const st = e.status === 'live' ? await serverStatusOf(e) : {}, main = st.java || st.bedrock;
    const img = statusImage(e, st);
    const btns = [{ label: 'Event page', url, emoji: '🔗' }, e.rules && { label: 'Rules', url: url + '#rules', emoji: '📜' }];
    const msg = await discord.send(ch, { content: pre, embeds: [serverEmbed(e, st, '', !!img)], components: linkRow(btns), allowed_mentions: { parse: ping.everyone || ping.here ? ['everyone'] : [], roles: ping.roles || [] } }, img ? [img] : []);
    e.serverPost = { channelId: ch, messageId: msg.id, active: e.status === 'live', at: store.now() };
    e.serverPostedAt = store.now(); store.save(); return;
  }
  const info = String(e.serverInfo || '').trim();
  if (!info) throw err(400, 'This event has no server addresses yet. Add the Java / Bedrock address in the event editor.');
  const url = cfg.publicUrl + '/event.html?slug=' + encodeURIComponent(e.slug), ping = opt.ping || {};
  const pre = [ping.everyone && '@everyone', ping.here && '@here', ...(ping.roles || []).map(r => `<@&${r}>`)].filter(Boolean).join(' ');
  const lines = info.split(/\n|\s*[|·]\s*/).map(x => x.trim()).filter(Boolean);
  const embed = { author: { name: 'MTC EVENT SERVER', icon_url: cfg.publicUrl + '/assets/logo.png' }, title: `🖥️ ${e.title}`.slice(0, 256), url,
    color: ST_COLOR[e.status] || 0xF7931E,
    description: ('**Join the server**\n```\n' + lines.join('\n') + '\n```' + (e.status === 'live' ? '\n🔴 **The event is live now.** See you in game!' : '')).slice(0, 4000),
    fields: [e.start && { name: '📅 Starts', value: `<t:${Math.floor(new Date(e.start) / 1000)}:F>\n<t:${Math.floor(new Date(e.start) / 1000)}:R>`, inline: true },
      { name: '👥 Players', value: e.teamSize > 1 ? `Teams of ${e.teamSize}` : 'Solo', inline: true }].filter(Boolean),
    thumbnail: { url: cfg.publicUrl + '/assets/logo.png' },
    footer: { text: 'Only registered players may join · MC Thamizh Creators', icon_url: cfg.publicUrl + '/assets/logo.png' }, timestamp: new Date().toISOString() };
  const btns = [{ label: 'Event page', url, emoji: '🔗' }, e.rules && { label: 'Rules', url: url + '#rules', emoji: '📜' }];
  await discord.send(ch, { content: pre, embeds: [embed], components: linkRow(btns), allowed_mentions: { parse: ping.everyone || ping.here ? ['everyone'] : [], roles: ping.roles || [] } });
  e.serverPostedAt = store.now(); store.save();
}
async function eventPostOpts(b) {
  if (!b.channelId) return {};
  const chs = await discord.channels(); if (!chs.some(c => c.id === String(b.channelId))) throw err(400, 'That channel is not in the server.');
  return { channelId: String(b.channelId), ping: cleanPing(b.ping, (await discord.roles()).map(r => r.id)) };
}

// ---------------------------------------------------------------- routes
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, pattern, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

// --- auth
on('GET', '/api/me', async req => {
  const u = session(req); let rec = u ? D().users[u.uid] || {} : {};
  // their skin, for the home page background: uploaded skin first, then the skin of their Minecraft name
  const m = u ? mcOf(u.uid, u.un) : { mc: '', skin: '' };
  if (u && !u.ig && u.uid !== 'admin' && !rec.inGuild && D().applications.some(x => x.userId === u.uid && x.status === 'approved' && !x.joinedAt)) { await joinCheck(u.uid).catch(() => {}); rec = D().users[u.uid] || {}; }
  return { user: u ? { id: u.uid, name: u.name, avatar: u.av, admin: !!u.adm, creator: !!u.cr || !!rec.creator, inGuild: !!u.ig || !!rec.inGuild, viaPassword: u.uid === 'admin',
    verified: !!rec.verified, blocked: !!rec.blocked, skin: m.skin, mc: m.mc, mcEdition: m.edition, ownSkin: !!rec.skin, needsSetup: u.uid !== 'admin' && !m.mc } : null,
    discordLogin: discord.loginReady(), invite: cfg.inviteUrl, maintenance: !!(u && u.adm && D().settings.maintenance && D().settings.maintenance.on) };
});
on('GET', '/auth/discord', async (req, res, p, url) => {
  if (!discord.loginReady()) { res.writeHead(302, { Location: '/account.html?error=' + encodeURIComponent('Discord login is not set up yet (DISCORD_CLIENT_SECRET in .env).') }); return res.end(); }
  // Cookies belong to one address. If the site was opened as 127.0.0.1 (or any other name), move to the address
  // Discord sends people back to first, otherwise the login cookie is missing on return.
  // Behind the tunnel the Host header may be rewritten, so only hop when the visitor came in directly (not via the tunnel).
  const home = new URL(cfg.publicUrl), viaProxy = !!(req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']);
  const join = url.searchParams.get('join') === '1';
  if (!viaProxy && (req.headers.host || '') !== home.host) { res.writeHead(302, { Location: cfg.publicUrl + '/auth/discord' + (join ? '?join=1' : '') }); return res.end(); }
  // One cookie per attempt, so clicking twice or using two tabs doesn't break the first attempt.
  const state = crypto.randomBytes(16).toString('hex');
  res.writeHead(302, { Location: discord.authorizeUrl(state, join), 'Set-Cookie': setCookie('mtc_st_' + state, join ? 'j' : '1', 900) }); res.end();
});
on('GET', '/auth/callback', async (req, res, p, url) => {
  const state = url.searchParams.get('state') || '';
  const clear = /^[a-f0-9]{32}$/.test(state) ? setCookie('mtc_st_' + state, '', 0) : setCookie('mtc_state', '', 0);
  const back = msg => { res.writeHead(302, { Location: '/account.html' + (msg ? '?error=' + encodeURIComponent(msg) : ''), 'Set-Cookie': clear }); res.end(); };
  const stv = cookies(req)['mtc_st_' + state];
  if (!/^[a-f0-9]{32}$/.test(state) || (stv !== '1' && stv !== 'j')) {
    console.warn(`Discord login: no matching login cookie (host ${req.headers.host}, cookies: ${Object.keys(cookies(req)).join(', ') || 'none'})`);
    return back('Login expired, please try again.');
  }
  if (url.searchParams.get('error')) return back('Discord login was cancelled.');
  try {
    const me = await discord.exchange(url.searchParams.get('code') || '');
    const info = await discord.memberInfo(me.id);
    const adm = cfg.adminIds.includes(me.id) || info.roles.some(r => cfg.adminRoleIds.includes(r));
    const name = info.nick || me.global_name || me.username;
    const av = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : '';
    D().users[me.id] = { ...(D().users[me.id] || {}), id: me.id, username: me.username, name, avatar: av, inGuild: info.inGuild, creator: info.creator, lastLogin: store.now() };
    if (me._join && !info.inGuild) saveJoin(me.id, me._join);
    audit.log({ who: { id: me.id, name, username: me.username, avatar: av, admin: adm }, kind: 'login', icon: '🔑', title: 'Logged in with Discord', details: [['In the server', info.inGuild ? 'Yes' : 'No'], ['Creator role', info.creator ? 'Yes' : 'No']] });
    store.save();
    res.writeHead(302, { Location: adm ? '/admin.html' : info.inGuild ? '/account.html' : '/apply.html', 'Set-Cookie': [clear, makeSession({ uid: me.id, un: me.username, name, av, adm, cr: info.creator, ig: info.inGuild })] });
    res.end();
  } catch (e) { console.error(e); back(e.message); }
});
on('POST', '/auth/admin', async (req, res) => {
  // through the tunnel every request comes from 127.0.0.1, so use the visitor address the tunnel passes on
  const ip = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  if (limited(ip)) throw err(429, 'Too many tries. Wait 10 minutes.');
  const b = await readBody(req);
  const a = Buffer.from(String(b.password || '')), c = Buffer.from(String(cfg.adminPassword));
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) { audit.log({ who: { name: 'Unknown visitor' }, kind: 'security', icon: '🚨', title: 'Wrong staff password', details: [['Where', 'Staff login on the website']] }); throw err(401, 'Wrong password.'); }
  json(res, 200, { ok: true }, { 'Set-Cookie': makeSession({ uid: 'admin', un: 'admin', name: 'Admin', av: '', adm: true, cr: true, ig: true }) });
});
on('POST', '/auth/logout', async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': setCookie('mtc', '', 0) }));

// --- public
const SKIN_CACHE = path.join(cfg.DATA, 'skin-cache');
fs.mkdirSync(SKIN_CACHE, { recursive: true });
async function mojangSkin(name) {
  const p = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name));
  if (p.status !== 200) return null;
  const { id } = await p.json();
  const s = await fetch('https://sessionserver.mojang.com/session/minecraft/profile/' + id);
  if (!s.ok) return null;
  const prop = ((await s.json()).properties || []).find(x => x.name === 'textures');
  const tex = prop && JSON.parse(Buffer.from(prop.value, 'base64').toString()).textures;
  if (!tex || !tex.SKIN) return null;
  const png = await fetch(tex.SKIN.url.replace(/^http:/, 'https:'));
  return png.ok ? Buffer.from(await png.arrayBuffer()) : null;
}
on('GET', '/api/skin/:name', async (req, res, p) => {
  const name = p.name;
  if (!/^\w{3,16}$/.test(name)) throw err(400, 'Bad Minecraft name');
  const file = path.join(SKIN_CACHE, name.toLowerCase() + '.png');
  let buf = null;
  try { if (Date.now() - fs.statSync(file).mtimeMs < 6 * 3600e3) buf = fs.readFileSync(file); } catch {}
  if (!buf) {
    buf = await mojangSkin(name).catch(() => null);
    if (!buf) { const r = await fetch('https://mc-heads.net/skin/' + name).catch(() => null); if (r && r.ok) buf = Buffer.from(await r.arrayBuffer()); }
    if (buf) fs.writeFileSync(file, buf);
    else { try { buf = fs.readFileSync(file); } catch { throw err(404, 'No skin found for ' + name); } }
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }); res.end(buf);
});
// Bedrock skin: gamertag -> XUID -> skin texture (GeyserMC uploads Bedrock skins as normal Java-style skins); Steve if unknown
// offline (cracked) players: Minecraft's default Steve or Alex, picked from the name like the game does, unless they upload a skin
const DEFAULT_SKINS = {};
on('GET', '/api/skin-off/:name', async (req, res, p) => {
  const name = String(p.name || ''); if (!/^\w{3,16}$/.test(name)) throw err(400, 'Bad name');
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0; const which = h & 1 ? 'MHF_Alex' : 'MHF_Steve';
  if (!DEFAULT_SKINS[which]) { const file = path.join(SKIN_CACHE, which.toLowerCase() + '.png');
    try { DEFAULT_SKINS[which] = fs.readFileSync(file); } catch { const r = await fetch('https://mc-heads.net/skin/' + which).catch(() => null);
      if (!r || !r.ok) throw err(404, 'No default skin'); DEFAULT_SKINS[which] = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(file, DEFAULT_SKINS[which]); } }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(DEFAULT_SKINS[which]);
});
on('GET', '/api/skin-be/:tag', async (req, res, p) => {
  const tag = String(p.tag || '').replace(/^[.*]/, '').trim();
  if (!/^[A-Za-z][A-Za-z0-9 _]{1,15}$/.test(tag)) throw err(400, 'Bad gamertag');
  const file = path.join(SKIN_CACHE, 'be_' + tag.toLowerCase().replace(/\s/g, '_') + '.png');
  let buf = null;
  try { if (Date.now() - fs.statSync(file).mtimeMs < 6 * 3600e3) buf = fs.readFileSync(file); } catch {}
  if (!buf) {
    try {
      const x = await (await fetch('https://api.geysermc.org/v2/xbox/xuid/' + encodeURIComponent(tag))).json();
      if (x.xuid) { const sk = await (await fetch('https://api.geysermc.org/v2/skin/' + x.xuid)).json();
        if (sk.texture_id) { const r = await fetch('https://textures.minecraft.net/texture/' + sk.texture_id); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); } }
    } catch {}
    if (buf) fs.writeFileSync(file, buf);
    else { try { buf = fs.readFileSync(file); } catch {} }
    if (!buf) { const r = await fetch('https://mc-heads.net/skin/MHF_Steve').catch(() => null); if (r && r.ok) buf = Buffer.from(await r.arrayBuffer()); }
    if (!buf) throw err(404, 'No skin found for ' + tag);
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }); res.end(buf);
});
on('GET', '/api/creators', async (req, res, p, url) => {
  const r = await discord.creatorMembers(url.searchParams.has('refresh'));
  const list = publicCreators(r.members);
  // the creator cards use each channel's YouTube banner; wait a few seconds for new ones, otherwise use what is cached
  await Promise.race([Promise.all(list.map(c => community.bannerOf((c.socials || {}).youtube))), new Promise(res => setTimeout(res, 4000))]);
  for (const c of list) { c.banner = community.bannerCached((c.socials || {}).youtube); c.live = community.liveOf(c.id);
    c.badges = community.badgesOf(c.id).map(b => ({ name: b.name, desc: b.desc, color: b.color, image: b.image, icon: b.icon })); }
  return { source: r.source, at: r.at, warning: r.error, total: r.members.length, creators: list };
});
// --- one creator's page: profile, latest YouTube uploads, MTC event history, showcase, activity
const ytFeeds = new Map();
const MC_WORDS = /minecraft|\bmcpe\b|\bmc\b|\bsmp\b|bedwars|skywars|skyblock|hypixel|lifesteal|creeper|enderman|ender dragon|\bnether\b|redstone|manhunt|hardcore|speedrun|\bmods?\b|craft|\bbedrock\b|java edition|herobrine|villager|pillager|warden|elytra|netherite|\bmobs?\b/i;
const TAMIL_MC = /மைன்கிராஃப்ட்|மைன்கிராப்ட்|மைன்கிராஃபட்|மின்கிராஃப்ட்|மைன்கிராஃட்/;
const isMcText = t => MC_WORDS.test(t) || TAMIL_MC.test(t);
const YT_PAGE_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en', Cookie: 'SOCS=CAI; CONSENT=PENDING+987' };
const ytDec = t => String(t || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// 1) the channel's RSS feed (cheap and exact, but YouTube answers 404 for some channels and servers)
async function ytFromFeed(id) {
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { headers: YT_PAGE_HEADERS, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('feed ' + r.status);
  const xml = await r.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const g = re => (e.match(re) || [])[1] || '';
    const vid = g(/<yt:videoId>([\w-]{11})<\/yt:videoId>/), title = ytDec(g(/<title>([\s\S]*?)<\/title>/));
    return { id: vid, title, published: g(/<published>([^<]+)<\/published>/), views: +g(/<media:statistics views="(\d+)"/) || 0,
      short: /\/shorts\//.test(g(/<link rel="alternate" href="([^"]+)"/)), thumb: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
      mc: isMcText(title + ' ' + ytDec(g(/<media:description>([\s\S]*?)<\/media:description>/))) };
  }).filter(v => v.id);
}
// 2) the channel's videos page: used when the feed fails. It only says "2w ago", so the date is approximate.
const agoToIso = t => {
  const m = /(\d+)\s*(months?|mo|years?|y|weeks?|w|days?|d|hours?|h|minutes?|m|seconds?|s)\b/i.exec(String(t || '')); if (!m) return '';
  const k = m[2].toLowerCase(), key = k.startsWith('mo') ? 'mo' : k[0];
  const unit = { s: 1e3, m: 60e3, h: 36e5, d: 864e5, w: 6048e5, mo: 2592e6, y: 31536e6 }[key];
  return new Date(Date.now() - m[1] * unit).toISOString();
};
const countOf = t => { const m = /([\d.,]+)\s*([KMB])?/i.exec(String(t || '').replace(/,/g, '')); if (!m) return 0; return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1)) || 0; };
// one tab of a channel: videos, streams (past, live and upcoming) or shorts
async function ytFromPage(id, tab = 'videos', retry = true) {
  if (retry) try { return await ytFromPage(id, tab, false); } catch (e) { await new Promise(r => setTimeout(r, 1200)); }
  const r = await fetch('https://www.youtube.com/channel/' + id + '/' + tab, { headers: YT_PAGE_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(tab + ' page ' + r.status);
  const html = await r.text(), m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error(tab + ' page has no video data');
  const found = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.shortsLockupViewModel) { found.push({ sh: o.shortsLockupViewModel }); return; }
    if (o.lockupViewModel && o.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') { found.push({ lv: o.lockupViewModel }); return; }
    if (o.videoRenderer && o.videoRenderer.videoId) { found.push({ old: o.videoRenderer }); return; }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  const out = [];
  for (const v of found) {
    if (tab === 'shorts') {   // a channel without Shorts sends its home page instead: only real Shorts count
      if (!v.sh) continue;
      const sh = v.sh, vid = ((sh.onTap && sh.onTap.innertubeCommand && sh.onTap.innertubeCommand.reelWatchEndpoint) || {}).videoId || String(sh.entityId || '').replace(/^shorts-shelf-item-/, '');
      const title = ytDec(((sh.overlayMetadata || {}).primaryText || {}).content);
      out.push({ id: vid, title, published: '', views: countOf(((sh.overlayMetadata || {}).secondaryText || {}).content), short: true, thumb: `https://i.ytimg.com/vi/${vid}/oar2.jpg`, mc: isMcText(title) });
      continue;
    }
    if (v.sh) continue;
    if (v.old) { const o = v.old, t = (o.title.runs || []).map(x => x.text).join('') || (o.title.simpleText || '');
      out.push({ id: o.videoId, title: t, published: agoToIso((o.publishedTimeText || {}).simpleText), views: countOf((o.viewCountText || {}).simpleText), short: false, thumb: `https://i.ytimg.com/vi/${o.videoId}/mqdefault.jpg`, mc: isMcText(t) }); continue; }
    const lv = v.lv, md = lv.metadata.lockupMetadataViewModel, parts = (((md.metadata || {}).contentMetadataViewModel || {}).metadataRows || []).flatMap(r => (r.metadataParts || []).map(p => (p.text || {}).content || ''));
    const title = ytDec(md.title.content), raw = JSON.stringify(lv.contentImage || {});
    const live = /"text":"LIVE"|BADGE_STYLE_TYPE_LIVE|THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE/.test(raw) || parts.some(p => /watching/i.test(p));
    const upcoming = parts.some(p => /^(Scheduled|Premieres|Upcoming)/i.test(p)) || /UPCOMING/.test(raw);
    out.push({ id: lv.contentId, title, published: live ? new Date().toISOString() : agoToIso(parts.find(p => /\bago\b/i.test(p))),
      views: countOf(parts.find(p => /views?|watching/i.test(p)) || parts.find(p => !/\bago\b/i.test(p))), short: false, live, upcoming,
      when: upcoming ? parts.find(p => /^(Scheduled|Premieres|Upcoming)/i.test(p)) || '' : '', thumb: `https://i.ytimg.com/vi/${lv.contentId}/mqdefault.jpg`, mc: isMcText(title) });
  }
  return out.filter(v => /^[\w-]{11}$/.test(v.id || ''));
}
async function ytLatest(channelUrl) {
  const id = (String(channelUrl || '').match(/\/channel\/(UC[\w-]{22})/) || [])[1]; if (!id) return null;
  const hit = ytFeeds.get(id); if (hit && Date.now() - hit.at < 20 * 60e3) return hit.data;
  // the three tabs of the channel, at the same time; Videos falls back to the RSS feed
  const [vids, streams, shorts] = await Promise.all([
    ytFromPage(id, 'videos').catch(() => ytFromFeed(id).then(all => all.filter(v => !v.short))).catch(e => { logErr('YouTube videos ' + id, e); return null; }),
    ytFromPage(id, 'streams').catch(e => { logErr('YouTube streams ' + id, e); return null; }),
    ytFromPage(id, 'shorts').catch(e => { logErr('YouTube shorts ' + id, e); return null; })]);
  if (!vids && !streams && !shorts) return hit ? hit.data : { channelId: id, videos: [], streams: [], shorts: [], error: 'YouTube could not be reached right now.' };
  // only Minecraft (title mentions Minecraft or a well-known Minecraft term, in English or Tamil); live streams first
  const keep = (list, n) => (list || []).filter(v => v.mc).sort((a, b) => !!b.live - !!a.live).slice(0, n).map(({ mc, ...v }) => v);
  const data = { channelId: id, videos: keep(vids, 12), streams: keep(streams, 12), shorts: keep(shorts, 12),
    hidden: [vids, streams, shorts].reduce((n, l) => n + (l || []).filter(v => !v.mc).length, 0) };
  ytFeeds.set(id, { at: Date.now(), data }); return data;
}
on('GET', '/api/creators/:key', async (req, res, p) => {
  const key = String(p.key || '').toLowerCase();
  const r = await discord.creatorMembers();
  const list = publicCreators(r.members).sort((a, b) => (!!(b.socials || {}).youtube - !!(a.socials || {}).youtube) || a.name.localeCompare(b.name));
  const i = list.findIndex(c => c.username.toLowerCase() === key || c.id === key);
  if (i < 0) throw err(404, 'That creator is not on the site.');
  const c = list[i], ex = yt.readExtras(), x = ex[c.id] || ex[c.username.toLowerCase()] || {};
  await discord.allMembers().catch(() => null);
  const g = discord.cachedMember(c.id) || {}, u = D().users[c.id] || {};
  const mc = c.mc || u.mc || '', mcEdition = c.mc ? c.mcEdition : edOf(u.mcEdition);
  const names = new Set([c.username, c.name, mc, g.name, u.name].filter(Boolean).map(n => String(n).toLowerCase()));
  // events: their registrations, and where their name shows in the results
  const regs = D().registrations.filter(q => (q.userId === c.id || names.has(String(q.name || '').toLowerCase())) && q.status !== 'withdrawn' && q.status !== 'rejected');
  const events = [];
  for (const e of sortEvents(D().events.filter(e => e.status !== 'draft'))) {
    const reg = regs.find(q => q.eventId === e.id);
    const res = (e.results || []).find(rr => String(rr.name || '').split(/[,&/]| and /i).map(n => n.trim().toLowerCase()).some(n => names.has(n)) || (reg && reg.team && String(rr.name).toLowerCase() === reg.team.toLowerCase()));
    if (!reg && !res) continue;
    events.push({ slug: e.slug, title: e.title, status: e.status, type: e.type, start: e.start, dateLabel: e.dateLabel, banner: e.banner, bannerPos: e.bannerPos, bannerFit: e.bannerFit,
      team: reg ? reg.team || '' : '', confirmed: reg ? reg.status === 'approved' : true, place: res ? res.place : null, points: res ? res.points || '' : '',
      at: (['completed', 'unsuccessful', 'live', 'cancelled'].includes(e.status) && (e.end || e.start)) || (reg ? reg.createdAt : e.start || e.createdAt) });
  }
  const media = D().media.filter(m => m.status === 'approved' && (m.userId === c.id || names.has(String(m.creator || '').toLowerCase()))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(pubMedia);
  const played = events.filter(e => e.confirmed && (e.status === 'completed' || e.status === 'unsuccessful' || e.status === 'live' || (e.status === 'cancelled' && e.start && new Date(e.start) < Date.now())));
  const stats = { events: played.length, wins: events.filter(e => e.place === 1).length, podiums: events.filter(e => e.place && e.place <= 3).length, uploads: media.length, memberSince: g.joined || '' };
  const activity = [
    ...events.map(e => ({ at: e.at, icon: e.place === 1 ? '🏆' : e.place && e.place <= 3 ? '🥈' : '🎮', text: e.place ? `Finished #${e.place} in ${e.title}` : e.status === 'open' || e.status === 'soon' ? `Registered for ${e.title}` : e.status === 'cancelled' ? `Was in ${e.title} (cancelled)` : e.status === 'unsuccessful' ? `Played ${e.title} (it did not go as planned)` : e.status === 'live' ? `Playing ${e.title} now` : `Played ${e.title}`, link: '/event.html?slug=' + encodeURIComponent(e.slug) })),
    ...media.slice(0, 10).map(m => ({ at: m.createdAt, icon: m.type === 'youtube' ? '🎬' : '📸', text: `Shared a ${m.type === 'youtube' ? 'video' : 'screenshot'}${m.eventTitle ? ' from ' + m.eventTitle : ''}`, link: m.eventSlug ? '/event.html?slug=' + encodeURIComponent(m.eventSlug) + '#showcase' : '' })),
    x.verifiedAt && { at: x.verifiedAt, icon: '✅', text: 'Became a verified MTC creator' },
    g.joined && { at: g.joined, icon: '👋', text: 'Joined the MTC Discord' },
  ].filter(a => a && a.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15);
  const yt1 = await ytLatest((c.socials || {}).youtube);
  await Promise.race([community.bannerOf((c.socials || {}).youtube), new Promise(res => setTimeout(res, 4000))]);
  const banner = community.bannerCached((c.socials || {}).youtube);
  const nb = k => { const o = list[(i + k + list.length) % list.length]; return o && o.id !== c.id ? { username: o.username, name: o.name, logo: o.logo } : null; };
  return { creator: { banner, live: community.liveOf(c.id), id: c.id, username: c.username, name: c.name, discordName: g.name || u.name || '', avatar: g.avatar || u.avatar || '', logo: c.logo, mc, mcEdition, skin: c.skin || skinUrl(mc, mcEdition),
      socials: c.socials || {}, featured: c.featured }, stats, events, media, activity, youtube: yt1, prev: nb(-1), next: nb(1), total: list.length };
});
on('GET', '/api/events', async () => ({ events: sortEvents(D().events.filter(e => e.status !== 'draft')).map(pubEvent) }));
on('GET', '/api/events/:slug', async (req, res, p) => {
  const e = evBy(p.slug); const u = session(req);
  if (!e || (e.status === 'draft' && !(u && u.adm))) throw err(404, 'Event not found.');
  const mine = u ? D().registrations.find(r => r.eventId === e.id && r.userId === u.uid && r.status !== 'withdrawn') : null;
  const evMedia = D().media.filter(m => m.eventId === e.id && m.status === 'approved'); await fillVideoDates(evMedia);
  return { event: pubEvent(e), media: evMedia.map(pubMedia),
    mine: mine ? { status: mine.status, team: mine.team } : null };
});
// the creator's channel logo for a showcase item: a verified MTC creator with that channel name, else the YouTube channel's picture (looked up once, then kept)
const logoBusy = new Set();
async function creatorLogoOf(m) {
  if (m.creatorLogo || m.logoTried || logoBusy.has(m.id)) return;
  const name = String(m.creator || '').trim().toLowerCase(), ex = yt.readExtras();
  const own = name && Object.values(ex).find(x => x && x.verified === true && x.logo && String(x.channelName || '').trim().toLowerCase() === name);
  if (own) { m.creatorLogo = own.logo; store.save(); return; }
  if (m.type !== 'youtube') return;
  logoBusy.add(m.id);
  try {
    const o = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(m.url), { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null);
    if (o && /^https:\/\/www\.youtube\.com\//.test(o.author_url || '')) {
      const h = await fetch(o.author_url, { headers: YT_PAGE_HEADERS, signal: AbortSignal.timeout(10000) }).then(r => r.text());
      const img = (h.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '';
      if (/^https:\/\/yt3\.(googleusercontent|ggpht)\.com\//.test(img)) m.creatorLogo = img.replace(/=s\d+[^"]*$/, '=s160-c-k-c0x00ffffff-no-rj');
    }
  } catch (e) { /* try again another time */ return; } finally { logoBusy.delete(m.id); }
  m.logoTried = true; store.save();
}
on('GET', '/api/showcase', async () => {
  const list = D().media.filter(m => m.status === 'approved').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // wait a moment for missing logos; the rest arrive on the next visit
  await Promise.race([Promise.all(list.slice(0, 60).map(creatorLogoOf)), new Promise(r => setTimeout(r, 2500))]);
  return { media: list.map(pubMedia) };
});
on('GET', '/api/announcements', async () => ({ announcements: D().announcements.slice(-5).reverse().map(a => ({ id: a.id, title: a.title, body: a.body, image: a.image || '', createdAt: a.createdAt })) }));

// --- members
// Who may register / upload / submit a profile: admins, members an admin verified by hand,
// or anyone in the MTC Discord holding the Creator role. Blocked members never can.
async function canJoin(u) {
  if (u.adm) return;
  const rec = D().users[u.uid] || {};
  if (rec.blocked) throw err(403, 'Your account is blocked from taking part. Message an admin in Discord.');
  if (rec.verified) return;
  const info = await discord.memberInfo(u.uid).catch(() => null);
  if (!info || !info.inGuild) throw err(403, 'Join the MTC Discord server first, then log in again.');
  if (cfg.requireCreatorRole && !info.creator) throw err(403, 'Events are for creators. Ask an admin for the Creator role in Discord.');
}
on('POST', '/api/events/:slug/register', async (req, res, p) => {
  const u = needUser(req); const e = evBy(p.slug);
  if (!e || e.status === 'draft') throw err(404, 'Event not found.');
  if (e.status !== 'open') throw err(400, 'Registration is closed for this event.');
  await canJoin(u);
  if (u.uid !== 'admin' && !mcOf(u.uid, u.un).mc) throw err(400, 'Add your Minecraft username on your account page first.');
  const regs = D().registrations.filter(r => r.eventId === e.id && r.status !== 'withdrawn' && r.status !== 'rejected');
  if (regs.some(r => r.userId === u.uid)) throw err(409, 'You are already registered.');
  if (e.slots && regs.length >= e.slots) throw err(409, 'All slots are taken.');
  const b = await readBody(req);
  const answers = checkAnswers(e.form, b.answers);
  const r = { id: store.id(), eventId: e.id, userId: u.uid, username: u.un, name: u.name, team: str(b.team, 40), note: str(b.note, 300), answers, status: 'pending', createdAt: store.now() };
  D().registrations.push(r); store.save();
  alertStaff('registration', { title: `📝 New registration: ${e.title}`, text: `**${u.name}** (@${u.un}) registered.`, tab: 'regs',
    fields: [{ name: 'Minecraft', value: mcOf(u.uid, u.un).mc, inline: true }, { name: 'Team', value: r.team, inline: true }, { name: 'Note', value: r.note }] });
  return { ok: true, status: r.status };
});
on('DELETE', '/api/events/:slug/register', async (req, res, p) => {
  const u = needUser(req); const e = evBy(p.slug); if (!e) throw err(404, 'Event not found.');
  const r = D().registrations.find(x => x.eventId === e.id && x.userId === u.uid && x.status !== 'withdrawn');
  if (!r) throw err(404, 'You are not registered.');
  if (['live', 'completed', 'unsuccessful'].includes(e.status)) throw err(400, 'The event has started, so you cannot withdraw here. Message an admin.');
  r.status = 'withdrawn'; r.updatedAt = store.now(); store.save();
  return { ok: true };
});
on('GET', '/api/me/registrations', async req => {
  const u = needUser(req);
  return { registrations: D().registrations.filter(r => r.userId === u.uid).map(r => { const e = evById(r.eventId) || {}; return { status: r.status, team: r.team, createdAt: r.createdAt, event: { slug: e.slug, title: e.title, status: e.status, dateLabel: e.dateLabel } }; }) };
});
on('GET', '/api/me/profile', async req => {
  const u = needUser(req);
  const extras = yt.readExtras(), x = extras[u.uid] || extras[(u.un || '').toLowerCase()] || null;
  const req1 = D().profiles.filter(q => q.userId === u.uid).slice(-1)[0] || null;
  return { verified: x && x.verified ? { channelName: x.channelName, logo: x.logo, youtube: x.socials && x.socials.youtube, mc: x.mc || '', mcEdition: edOf(x.mcEdition), socials: x.socials || {}, featured: x.featured ? x.featured.url : '' } : null,
    request: req1 && { youtube: req1.youtube, mc: req1.mc, mcEdition: edOf(req1.mcEdition), socials: req1.socials, featured: req1.featured ? req1.featured.url : '', status: req1.status, reason: req1.reason || '', submittedAt: req1.submittedAt } };
});
// --- applications to join MTC (for people not in the Discord yet)
const HOW = ['YouTube', 'Instagram', 'A friend', 'Another MTC creator', 'Discord server list', 'Other'];
const DEFAULT_APPLY_FORM = [
  { id: 'how', label: 'How did you know about MTC?', type: 'radio', required: true, help: '', options: HOW },
  { id: 'howMore', label: 'Tell us more', type: 'text', required: false, help: 'Which friend, video or creator?', options: [] },
  { id: 'about', label: 'About you', type: 'textarea', required: false, help: 'What kind of Minecraft videos do you make?', options: [] }];
const applyForm = () => D().settings.applyForm || DEFAULT_APPLY_FORM;
// older applications kept these three answers as their own fields
const appAnswers = a => a.answers || { how: a.how, howMore: a.howMore, about: a.about };
const pubApp = a => a && { status: a.status, youtube: a.youtube, channelName: a.channelName || '', mc: a.mc, answers: appAnswers(a),
  reason: a.reason || '', submittedAt: a.submittedAt, decidedAt: a.decidedAt || '', joinedAt: a.joinedAt || '',
  invite: a.status === 'approved' && !a.joinedAt && a.invite && (!a.invite.expires || Date.parse(a.invite.expires) > Date.now()) ? 'https://discord.gg/' + a.invite.code : '',
  inviteExpires: a.invite ? a.invite.expires || '' : '', expired: !!(a.status === 'approved' && !a.joinedAt && a.invite && a.invite.expires && Date.parse(a.invite.expires) <= Date.now()) };
const lastApp = uid => D().applications.filter(a => a.userId === uid).slice(-1)[0] || null;
// "join servers for you" permission, kept encrypted in data/join-tokens.json until it is used or the applicant is rejected
const JOIN_FILE = path.join(cfg.DATA, 'join-tokens.json');
const jkey = crypto.createHash('sha256').update('join:' + cfg.sessionSecret).digest();
const readJoins = () => { try { return JSON.parse(fs.readFileSync(JOIN_FILE, 'utf8')); } catch { return {}; } };
const writeJoins = o => { fs.writeFileSync(JOIN_FILE + '.tmp', JSON.stringify(o)); fs.renameSync(JOIN_FILE + '.tmp', JOIN_FILE); };
function saveJoin(uid, t) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', jkey, iv);
  const data = Buffer.concat([c.update(JSON.stringify(t), 'utf8'), c.final()]);
  const o = readJoins(); o[uid] = [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.'); writeJoins(o);
}
function loadJoin(uid) {
  const v = readJoins()[uid]; if (!v) return null;
  try { const [iv, tag, data] = v.split('.').map(s => Buffer.from(s, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', jkey, iv); d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8')); } catch { return null; }
}
function dropJoin(uid) { const o = readJoins(); if (o[uid]) { delete o[uid]; writeJoins(o); } }
const hasJoin = uid => !!readJoins()[uid];
// approve: put them straight into the server with their permission; false if that is not possible
async function addDirect(a) {
  let t = loadJoin(a.userId); if (!t) return false;
  try {
    if (Date.now() > t.exp - 60e3) { const n = await discord.refreshToken(t.refresh); t = { access: n.access_token, refresh: n.refresh_token || t.refresh, exp: Date.now() + (n.expires_in || 604800) * 1000 }; saveJoin(a.userId, t); }
    const r = await discord.addMember(a.userId, t.access, a.giveRole && cfg.creatorRole ? [cfg.creatorRole] : []);
    a.added = { how: r, at: store.now() }; dropJoin(a.userId);
    await joinCheck(a.userId);
    try { await discord.dm(a.userId, { embeds: [{ title: 'Welcome to MTC!', color: 0xF7931E, url: cfg.publicUrl + '/account.html',
      description: `Hi ${a.name}, your application was approved and you have been added to the MC Thamizh Creators server. Say hi in the server, and finish your profile here: ${cfg.publicUrl}/account.html` }] }); a.dm = { ok: true, at: store.now() }; }
    catch (e) { a.dm = { ok: false, error: dmError(e), at: store.now() }; reportDmFail({ to: a.userId, name: a.name, username: a.username, what: 'Welcome to MTC (they were added to the server)', reason: a.dm.error }); }
    return true;
  } catch (e) { a.addError = e.code === 50025 || e.status === 401 || /invalid_grant/.test(e.message) ? 'Their permission to add them expired or was removed, so an invite link was made instead.' : e.message; return false; }
}

// has an approved applicant joined? then delete their invite, give the Creator role, mark them in the server
async function joinCheck(uid) {
  const a = D().applications.find(x => x.userId === uid && x.status === 'approved' && !x.joinedAt);
  const info = await discord.memberInfo(uid);
  if (!info.inGuild) return false;
  const rec = D().users[uid] = { ...(D().users[uid] || {}), id: uid, inGuild: true };
  if (a) {
    a.joinedAt = store.now();
    if (a.invite && a.invite.code) { await discord.deleteInvite(a.invite.code).catch(e => console.warn('delete invite', e.message)); a.invite.deleted = store.now(); }
    if (a.giveRole && cfg.creatorRole && !info.creator) { try { await discord.addRole(uid, cfg.creatorRole); rec.creator = true; } catch (e) { a.roleError = e.message; } }
    else if (info.creator) rec.creator = true;
    if (a.mc && !rec.mc) { rec.mc = a.mc; rec.mcEdition = edOf(a.mcEdition); }
  }
  store.save(); return true;
}
// every 5 minutes: approved applicants who have not joined yet
setInterval(async () => {
  for (const a of D().applications.filter(x => x.status === 'approved' && !x.joinedAt)) await joinCheck(a.userId).catch(() => {});
}, 5 * 60e3).unref();

on('GET', '/api/apply', async req => {
  const u = session(req); const rec = u ? D().users[u.uid] || {} : {};
  return { form: applyForm(), user: u && u.uid !== 'admin' ? { name: u.name, avatar: u.av, inGuild: !!u.ig || !!rec.inGuild, canAdd: hasJoin(u.uid) } : null, application: u ? pubApp(lastApp(u.uid)) : null,
    discordLogin: discord.loginReady() };
});
const checkHits = new Map();
on('POST', '/api/apply/check', async req => {
  const u = needUser(req); const n = (checkHits.get(u.uid) || []).filter(t => Date.now() - t < 10 * 60e3);
  if (n.length >= 15) throw err(429, 'Too many checks. Wait a few minutes.'); n.push(Date.now()); checkHits.set(u.uid, n);
  const b = await readBody(req);
  try { const info = await yt.channelInfo(str(b.youtube, 300)); return { name: info.name, image: info.image }; }
  catch { throw err(400, 'We could not find that YouTube channel. Check the link.'); }
});
on('POST', '/api/apply', async req => {
  const u = needUser(req); if (u.uid === 'admin') throw err(400, 'Log in with Discord to apply.');
  const rec = D().users[u.uid] || {};
  if (rec.blocked) throw err(403, 'You cannot apply. Message an admin.');
  if (u.ig || rec.inGuild) throw err(400, 'You are already in the MTC Discord.');
  const prev = lastApp(u.uid);
  if (prev && (prev.status === 'pending' || (prev.status === 'approved' && !prev.joinedAt))) throw err(409, 'Your application is already in.');
  if (prev && prev.status === 'rejected' && Date.now() - Date.parse(prev.decidedAt) < 7 * 864e5) throw err(429, 'You can apply again 7 days after your last application.');
  const b = await readBody(req);
  const youtube = httpsUrl(b.youtube);
  if (!youtube || !/^https:\/\/(www\.|m\.)?youtube\.com\/(@|channel\/|c\/|user\/)/i.test(youtube)) throw err(400, 'Add your YouTube channel link (looks like https://www.youtube.com/@yourname).');
  const mcEdition = edOf(b.edition);
  const mc = cleanMc(b.mc, mcEdition); if (!mc) throw err(400, 'Add your Minecraft username.');
  const answers = checkAnswers(applyForm(), b.answers);
  if (D().applications.filter(a => a.status === 'pending').length > 300) throw err(429, 'We have a lot of applications right now. Try again in a few days.');
  let channelName = ''; try { channelName = (await yt.channelInfo(youtube)).name; } catch { throw err(400, 'We could not find that YouTube channel. Check the link.'); }
  const a = { id: store.id(), userId: u.uid, username: u.un, name: u.name, avatar: u.av, youtube, channelName, mc, mcEdition, answers,
    status: 'pending', submittedAt: store.now() };
  D().applications.push(a); store.save();
  alertStaff('application', { title: '🙋 New join application', text: `**${u.name}** (@${u.un}) wants to join.`, tab: 'apps',
    fields: [{ name: 'YouTube', value: `[${channelName}](${youtube})`, inline: true }, { name: 'Minecraft', value: mc, inline: true }] });
  return { ok: true, application: pubApp(a) };
});
// admin
on('GET', '/api/admin/applications', async req => {
  needAdmin(req);
  return { form: applyForm(), applications: D().applications.slice().reverse().map(a => ({ ...a, answers: appAnswers(a), canAdd: a.status === 'pending' && hasJoin(a.userId) })), bypassNote: 'Links that skip the Discord application need the bot role to have Kick Members.' };
});
on('PUT', '/api/admin/apply-form', async req => {
  needAdmin(req); const b = await readBody(req);
  D().settings.applyForm = b.reset ? undefined : cleanForm(b.form); store.save();
  return { ok: true, form: applyForm() };
});
async function sendInvite(a) {
  const inv = await discord.makeInvite(7);
  if (a.invite && a.invite.code && !a.invite.deleted) await discord.deleteInvite(a.invite.code).catch(() => {});
  a.invite = { code: inv.code, bypass: inv.bypass, expires: inv.expires, at: store.now() };
  a.inviteNote = inv.note || '';
  const link = 'https://discord.gg/' + inv.code;
  try {
    await discord.dm(a.userId, { embeds: [{ title: 'You are accepted into MTC!', color: 0xF7931E, url: cfg.publicUrl + '/apply.html',
      description: `Hi ${a.name}, your application to MC Thamizh Creators was approved.\n\n**Join here:** ${link}\n\nThis link is only for you, works once, and expires in 7 days.` }] });
    a.dm = { ok: true, at: store.now() };
  } catch (e) { a.dm = { ok: false, error: e.code === 50007 ? 'Discord does not let the bot message them yet (no shared server or DMs closed). They can see the link on the website.' : e.message, at: store.now() };
    reportDmFail({ to: a.userId, name: a.name, username: a.username, what: 'Your MTC invite link (application approved)', reason: a.dm.error + ' The invite is also on their apply page.' }); }
}
on('POST', '/api/admin/applications/:id', async (req, res, p) => {
  const u = needAdmin(req); const a = D().applications.find(x => x.id === p.id); if (!a) throw err(404, 'Application not found.');
  const b = await readBody(req);
  if (b.action === 'approve') {
    if (a.status === 'approved') throw err(400, 'Already approved.');
    a.status = 'approved'; a.decidedAt = store.now(); a.decidedBy = u.name; a.giveRole = b.giveRole !== false; a.reason = '';
    if (!(await addDirect(a))) await sendInvite(a);
    if (b.showOnSite) { try { await yt.verifyCreator(a.userId, a.youtube, { mc: a.mc }); } catch (e) { a.siteError = e.message; } }
    const rec = D().users[a.userId] = { ...(D().users[a.userId] || {}), id: a.userId, username: a.username, name: a.name, avatar: a.avatar };
    if (!rec.mc) { rec.mc = a.mc; rec.mcEdition = edOf(a.mcEdition); }
  } else if (b.action === 'reject') {
    a.status = 'rejected'; a.decidedAt = store.now(); a.decidedBy = u.name; a.reason = str(b.reason, 200); dropJoin(a.userId);
    alertUser(a.userId, 'application', { title: 'MTC application', color: 'no', text: `Thanks for applying to MTC. Your application was not accepted this time${a.reason ? `.\n\n**Reason:** ${a.reason}` : '.'} You can apply again in 7 days.`, buttons: [{ label: 'Apply page', url: cfg.publicUrl + '/apply.html', emoji: '📄' }] });
    if (a.invite && a.invite.code && !a.invite.deleted) { await discord.deleteInvite(a.invite.code).catch(() => {}); a.invite.deleted = store.now(); }
  } else if (b.action === 'resend') {
    if (a.status !== 'approved' || a.joinedAt) throw err(400, 'Only for approved people who have not joined.');
    await sendInvite(a);
  } else if (b.action === 'check') {
    await joinCheck(a.userId);
  } else throw err(400, 'Unknown action.');
  store.save();
  return { ok: true, application: a };
});

on('PUT', '/api/me/setup', async req => {
  const u = needUser(req); if (u.uid === 'admin') throw err(400, 'Log in with Discord to set this up.');
  const b = await readBody(req);
  const edition = edOf(b.edition);
  const mc = cleanMc(b.mc, edition); if (!mc) throw err(400, edition === 'bedrock' ? 'Add your Bedrock gamertag.' : 'Add your Minecraft username.');
  const { name: real, found } = await checkMc(mc, edition);
  const rec = D().users[u.uid] = { ...(D().users[u.uid] || {}), id: u.uid, username: u.un, name: u.name };
  rec.mc = real; rec.mcEdition = edition; syncProfileMc(u.uid, u.un, real, edition);
  if (b.skin && String(b.skin).startsWith('data:')) rec.skin = saveSkin(b.skin, 'user-' + u.uid);
  else if (b.clearSkin) delete rec.skin;
  let sent = false;
  const youtube = httpsUrl(b.youtube);
  if (b.youtube && String(b.youtube).trim()) {
    if (!youtube || !/^https:\/\/(www\.|m\.)?youtube\.com\/(@|channel\/|c\/|user\/)/i.test(youtube)) throw err(400, 'That YouTube link does not look right (it looks like https://www.youtube.com/@yourname).');
    const ex = yt.readExtras(), x = ex[u.uid] || ex[(u.un || '').toLowerCase()];
    const already = x && x.verified && x.socials && x.socials.youtube === youtube;
    const pending = D().profiles.some(q => q.userId === u.uid && q.status === 'pending' && q.youtube === youtube);
    if (!already && !pending) {
      for (const q of D().profiles) if (q.userId === u.uid && q.status === 'pending') q.status = 'replaced';
      D().profiles.push({ id: store.id(), userId: u.uid, username: u.un, name: u.name, youtube, mc: real, socials: {}, featured: null, skin: rec.skin || '', status: 'pending', submittedAt: store.now() });
      sent = true;
    }
  }
  rec.setupAt = rec.setupAt || store.now();
  store.save();
  return { ok: true, mc: real, edition, found, sent };
});
on('PUT', '/api/me/profile', async req => {
  const u = needUser(req); if (u.uid === 'admin') throw err(400, 'Log in with Discord to set up a creator profile.');
  await canJoin(u);
  const b = await readBody(req);
  const youtube = httpsUrl(b.youtube);
  if (!youtube || !/^https:\/\/(www\.|m\.)?youtube\.com\/(@|channel\/|c\/|user\/)/i.test(youtube)) throw err(400, 'Add your YouTube channel link (looks like https://www.youtube.com/@yourname).');
  const mcEdition = edOf(b.edition), mc = cleanMc(b.mc, mcEdition), socials = cleanSocials(b.socials), featured = cleanFeatured(b.featured);
  const skin = b.skin && String(b.skin).startsWith('data:') ? saveSkin(b.skin, 'request-' + u.uid) : '';
  const list = D().profiles;
  for (const q of list) if (q.userId === u.uid && q.status === 'pending') q.status = 'replaced';
  list.push({ id: store.id(), userId: u.uid, username: u.un, name: u.name, youtube, mc, mcEdition, socials, featured, skin, status: 'pending', submittedAt: store.now() });
  store.save();
  alertStaff('profile', { title: '⭐ Creator profile to review', text: `**${u.name}** (@${u.un}) sent their channel: ${youtube}`, tab: 'creators' });
  return { ok: true };
});
on('POST', '/api/events/:slug/media', async (req, res, p) => {
  const u = needUser(req); const e = evBy(p.slug);
  if (!e || e.status === 'draft') throw err(404, 'Event not found.');
  await canJoin(u);
  if (D().media.filter(m => m.userId === u.uid && m.status === 'pending').length >= 10) throw err(429, 'You have 10 items waiting for review already.');
  const b = await readBody(req);
  const m = { id: store.id(), eventId: e.id, userId: u.uid, creator: u.name, caption: str(b.caption, 140), status: u.adm ? 'approved' : 'pending', createdAt: store.now() };
  if (b.type === 'youtube') {
    const v = yt.videoId(str(b.url, 300)); if (!v) throw err(400, 'That is not a YouTube video link.');
    Object.assign(m, { type: 'youtube', url: 'https://www.youtube.com/watch?v=' + v, thumb: `https://i.ytimg.com/vi/${v}/hqdefault.jpg`, videoId: v });
  } else { const f = saveImage(b.data); Object.assign(m, { type: 'image', url: f, thumb: f }); }
  D().media.push(m); store.save();
  if (m.status === 'pending') alertStaff('media', { title: `🎬 New showcase upload: ${e.title}`, text: `**${u.name}** sent a ${m.type === 'youtube' ? 'video' : 'screenshot'}${m.caption ? `: "${m.caption}"` : '.'}`, tab: 'media' });
  return { ok: true, status: m.status };
});

// --- admin
on('GET', '/api/admin/data', async req => {
  needAdmin(req);
  const d = D();
  return { events: sortEvents(d.events), registrations: d.registrations.map(r => { const m = mcOf(r.userId, r.username); return { ...r, mc: m.mc || r.mc || '', mcEdition: m.mc ? m.edition : edOf(r.mcEdition) }; }), media: d.media, profiles: d.profiles.filter(q => q.status !== 'replaced'),
    announcements: d.announcements.slice().reverse(), backups: store.listBackups(), pendingApps: d.applications.filter(a => a.status === 'pending').length, failedDms: failedDmCount(), maintenance: d.settings.maintenance || { on: false, message: '' },
    config: { botOnline: gateway.state.online, botError: gateway.state.lastError, botMembersIntent: gateway.state.membersIntent, discordLogin: discord.loginReady(), announceChannel: !!cfg.announceChannel, redirectUri: discord.redirectUri(), discordReady: discord.ready() } };
});
on('POST', '/api/admin/events', async req => {
  needAdmin(req); const b = await readBody(req);
  const f = eventFields(b);
  let slug = slugify(f.title), n = 2; while (evBy(slug)) slug = slugify(f.title) + '-' + n++;   // evBy also sees old slugs
  const ordered = D().events.filter(x => typeof x.order === 'number');
  const e = { id: store.id(), slug, ...f, results: [], ...(ordered.length ? { order: Math.min(...ordered.map(x => x.order)) - 1 } : {}), createdAt: store.now(), updatedAt: store.now() };
  D().events.push(e); store.save();
  let discordError; if (b.postDiscord) await eventPostOpts(b).then(o => postEvent(e, o)).catch(x => { discordError = x.message; });
  return { event: e, posted: !!b.postDiscord && !discordError, discordError };
});
on('PUT', '/api/admin/events/:id', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  const b = await readBody(req);
  const oldTitle = e.title;
  Object.assign(e, eventFields(b, e), { updatedAt: store.now() });
  if (e.title !== oldTitle) {   // renamed: new slug from the new title; the old one still opens the event
    const base = slugify(e.title); let slug = base, n = 2;
    while (D().events.some(x => x.id !== e.id && (x.slug === slug || (x.oldSlugs || []).includes(slug)))) slug = base + '-' + n++;
    if (slug !== e.slug) { e.oldSlugs = [...new Set([...(e.oldSlugs || []), e.slug])].filter(x => x !== slug); e.slug = slug; }
  }
  if (Array.isArray(b.results)) e.results = b.results.slice(0, 50).map((r, i) => ({ place: int(r.place, 1, 999, i + 1), name: str(r.name, 60), points: str(r.points, 20), note: str(r.note, 80) })).filter(r => r.name);
  store.save();
  let discordError; if (b.postDiscord) await eventPostOpts(b).then(o => postEvent(e, o)).catch(x => { discordError = x.message; });
  return { event: e, posted: !!b.postDiscord && !discordError, discordError };
});
on('PUT', '/api/admin/events-order', async req => {
  needAdmin(req); const b = await readBody(req);
  const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
  if (!ids.length) throw err(400, 'No order given.');
  ids.forEach((id, i) => { const e = evById(id); if (e) e.order = i; });
  let n = ids.length; for (const e of D().events) if (!ids.includes(e.id)) e.order = n++;
  store.save(); return { ok: true };
});
on('POST', '/api/admin/events/:id/discord', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  if (e.status === 'draft') throw err(400, 'Drafts are hidden. Change the status before posting.');
  const b = await readBody(req), o = await eventPostOpts(b);
  if (b.what === 'rules') return { ok: true, messages: await postRules(e, o) };
  if (b.what === 'server') { await postServer(e, o); return { ok: true }; }
  if (b.what === 'ended') { await postEnded(e, o); return { ok: true }; }
  await postEvent(e, o); return { ok: true };
});
on('DELETE', '/api/admin/events/:id', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  store.backup('before-delete'); // events are never lost: a copy is taken first
  const d = D(); d.events = d.events.filter(x => x !== e);
  d.registrations = d.registrations.filter(r => r.eventId !== e.id); d.media = d.media.filter(m => m.eventId !== e.id);
  store.save(); return { ok: true };
});
// --- members: manual verification
const memberRow = (id, x) => ({ id, username: x.username || '', name: x.name || x.username || id, avatar: x.avatar || '', inGuild: !!x.inGuild, creator: !!x.creator,
  verified: !!x.verified, verifiedBy: x.verifiedBy || '', verifiedAt: x.verifiedAt || '', blocked: !!x.blocked, note: x.note || '', lastLogin: x.lastLogin || '', mc: mcOf(id, x.username).mc, mcEdition: mcOf(id, x.username).edition });
on('GET', '/api/admin/members', async (req, res, p, url) => {
  needAdmin(req);
  let guild = null, warning = '';
  try { guild = await discord.allMembers(url.searchParams.has('refresh')); } catch (e) { warning = 'Could not reach Discord: ' + e.message; }
  const users = D().users, extras = yt.readExtras(), rows = new Map();
  const profileOf = (id, un) => extras[id] || extras[String(un || '').toLowerCase()] || null;
  for (const m of guild ? guild.members : []) {
    const x = users[m.id] || {}, pr = profileOf(m.id, m.username);
    rows.set(m.id, { ...memberRow(m.id, { ...x, username: m.username, name: m.name, avatar: m.avatar || x.avatar, inGuild: true, creator: m.creator }),
      joined: m.joined, onSite: !!(pr && pr.verified), hasProfile: !!pr });
  }
  for (const [id, x] of Object.entries(users)) if (!rows.has(id)) {
    const pr = profileOf(id, x.username);
    rows.set(id, { ...memberRow(id, { ...x, inGuild: guild ? false : x.inGuild }), onSite: !!(pr && pr.verified), hasProfile: !!pr });
  }
  return { warning, total: rows.size, members: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)) };
});
// check a YouTube channel link right now (admin profile editor), without saving anything
on('POST', '/api/admin/channel-check', async req => {
  needAdmin(req); const b = await readBody(req);
  const info = await yt.channelInfo(str(b.youtube, 300));
  return { name: info.name, url: info.url, image: info.image };
});
// who a member is: the Discord list first, then people who logged in
async function memberIdentity(id) {
  const g = await discord.allMembers().catch(() => null);
  const m = g && g.members.find(x => x.id === id), u = D().users[id];
  if (!m && !u) throw err(404, 'Member not found.');
  return { id, username: (m || u).username || '', name: (m || u).name || '' };
}
on('GET', '/api/admin/members/:id/profile', async (req, res, p) => {
  needAdmin(req); const who = await memberIdentity(p.id);
  const ex = yt.readExtras(), x = ex[p.id] || ex[who.username.toLowerCase()] || {};
  return { ...who, profile: { youtube: (x.socials && x.socials.youtube) || '', channelName: x.channelName || '', logo: x.logo || '', mc: x.mc || '', mcEdition: edOf(x.mcEdition),
    socials: x.socials || {}, featured: x.featured ? x.featured.url : '', skin: x.skin || '', show: !!x.verified, verifiedAt: x.verifiedAt || '' } };
});
// admin edits a member's public profile; a new YouTube link is checked with YouTube and its logo saved
on('PUT', '/api/admin/members/:id/profile', async (req, res, p) => {
  needAdmin(req); const who = await memberIdentity(p.id);
  const b = await readBody(req);
  const mcEdition = edOf(b.edition), youtube = str(b.youtube, 300), mc = cleanMc(b.mc, mcEdition), socials = cleanSocials(b.socials), featured = cleanFeatured(b.featured), show = !!b.show, recheck = !!b.recheck;
  if (youtube && !YT_CHANNEL.test(youtube)) throw err(400, 'The YouTube link must be a channel link (https://www.youtube.com/@name).');
  if (show && !youtube) throw err(400, 'Add a YouTube channel to show this member on the Creators page.');
  const ex0 = yt.readExtras();
  const key = ex0[p.id] ? p.id : (who.username ? who.username.toLowerCase() : p.id);
  const prev = ex0[key] || {};
  let channel = prev.channelName || '';
  if (youtube && (recheck || youtube !== (prev.socials && prev.socials.youtube) || !prev.logo)) channel = (await yt.verifyCreator(key, youtube, { mc, socials })).name;
  const ex = yt.readExtras(), x = ex[key] || {};
  x.socials = { ...socials, ...(youtube ? { youtube: (x.socials && x.socials.youtube) || youtube } : {}) };
  if (mc) { x.mc = mc; x.mcEdition = mcEdition; } else { delete x.mc; delete x.mcEdition; }
  if (featured) x.featured = featured; else delete x.featured;
  if (b.skin && String(b.skin).startsWith('data:')) x.skin = saveSkin(b.skin, key); else if (b.skin === '') delete x.skin;
  if (show && x.socials.youtube) {
    const dup = Object.entries(ex).find(([k, v]) => k !== key && k[0] !== '_' && v.verified && v.socials && v.socials.youtube === x.socials.youtube);
    if (dup) throw err(409, `This channel is already on the Creators page for @${dup[0]}. Hide it there first.`);
  }
  x.verified = show && !!x.logo; if (x.verified && !x.verifiedAt) x.verifiedAt = new Date().toISOString().slice(0, 10);
  x.editedAt = store.now();
  ex[key] = x; yt.writeExtras(ex);
  return { ok: true, channel, shown: x.verified };
});
on('PUT', '/api/admin/members/:id', async (req, res, p) => {
  const a = needAdmin(req);
  if (!D().users[p.id]) { const who = await memberIdentity(p.id); D().users[p.id] = { id: p.id, username: who.username, name: who.name, inGuild: true }; }
  const x = D().users[p.id];
  const b = await readBody(req);
  if (b.verified !== undefined) { x.verified = !!b.verified; x.verifiedBy = x.verified ? a.name : ''; x.verifiedAt = x.verified ? store.now() : ''; if (x.verified) x.blocked = false; }
  if (b.blocked !== undefined) { x.blocked = !!b.blocked; if (x.blocked) x.verified = false; }
  if (b.note !== undefined) x.note = str(b.note, 200);
  store.save();
  if (b.verified === true) alertUser(p.id, 'member', { title: '✅ You are verified on MTC', color: 'ok', text: 'An admin verified your account. You can now register for events and share your videos on the website.', buttons: [{ label: 'Events', url: cfg.publicUrl + '/#events', emoji: '🎮' }] });
  if (b.blocked === true) alertUser(p.id, 'member', { title: 'Your MTC website access was paused', color: 'no', text: 'An admin paused your access to events on the website. Message an admin in Discord if you think this is a mistake.' });
  return { member: memberRow(p.id, x) };
});
// verify someone who hasn't logged in yet: find them in the Discord server by username, nickname or user ID
on('POST', '/api/admin/members/find', async req => {
  needAdmin(req); const b = await readBody(req); const q = str(b.query, 40).replace(/^@/, '');
  if (!q) throw err(400, 'Enter a Discord username or user ID.');
  const list = await discord.searchMembers(q);
  return { results: list.filter(m => !m.user.bot).map(m => ({ id: m.user.id, username: m.user.username, name: m.nick || m.user.global_name || m.user.username,
    avatar: m.user.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64` : '', creator: m.roles.includes(cfg.creatorRole),
    known: !!D().users[m.user.id], verified: !!(D().users[m.user.id] || {}).verified })) };
});
on('POST', '/api/admin/members/:id/verify', async (req, res, p) => {
  const a = needAdmin(req); if (!/^\d{15,}$/.test(p.id)) throw err(400, 'Bad member ID.');
  const b = await readBody(req);
  const x = D().users[p.id] || (D().users[p.id] = { id: p.id });
  Object.assign(x, { username: x.username || str(b.username, 40), name: x.name || str(b.name, 60), avatar: x.avatar || httpsUrl(b.avatar), inGuild: true,
    creator: b.creator !== undefined ? !!b.creator : !!x.creator, verified: true, blocked: false, verifiedBy: a.name, verifiedAt: store.now() });
  store.save(); return { member: memberRow(p.id, x) };
});
on('POST', '/api/admin/events/:id/registrations', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  const b = await readBody(req);
  const name = str(b.name, 60); if (!name) throw err(400, 'Enter the player name.');
  const userId = /^\d{15,}$/.test(String(b.userId || '')) ? String(b.userId) : '';
  const regs = D().registrations.filter(r => r.eventId === e.id && r.status !== 'withdrawn' && r.status !== 'rejected');
  if (userId && regs.some(r => r.userId === userId)) throw err(409, name + ' is already in this event.');
  if (regs.some(r => String(r.name || '').trim().toLowerCase() === name.toLowerCase())) throw err(409, name + ' is already in this event.');
  const r = { id: store.id(), eventId: e.id, userId: userId || 'manual-' + store.id(), username: str(b.username, 40), name, team: str(b.team, 40), mcEdition: edOf(b.edition), mc: cleanMc(b.mc, b.edition),
    note: 'Added by an admin', status: 'approved', addedByAdmin: true, createdAt: store.now() };
  D().registrations.push(r); store.save();
  alertUser(userId, 'registration', { title: `✅ You were added to ${e.title}`, color: 'ok', text: `An admin added you to **${e.title}**${r.team ? ` in team **${r.team}**` : ''}.`, buttons: [evLink(e)] });
  return { ok: true };
});
on('PUT', '/api/admin/registrations/:id', async (req, res, p) => {
  needAdmin(req); const r = D().registrations.find(x => x.id === p.id); if (!r) throw err(404, 'Not found.');
  const b = await readBody(req);
  const before = r.status;
  if (['pending', 'approved', 'rejected', 'withdrawn'].includes(b.status)) r.status = b.status;
  const teamBefore = r.team;
  if (b.team !== undefined) r.team = str(b.team, 40);
  if (b.reason !== undefined) r.reason = str(b.reason, 200);
  r.updatedAt = store.now(); store.save();
  const e = evById(r.eventId) || { title: 'the event', slug: '' };
  if (r.status !== before && r.status === 'approved') alertUser(r.userId, 'registration', { title: `✅ You're in: ${e.title}`, color: 'ok',
    text: `Your place in **${e.title}** is confirmed${r.team ? ` (team **${r.team}**)` : ''}. See you in game!`, buttons: [evLink(e)] });
  else if (r.status !== before && r.status === 'rejected') alertUser(r.userId, 'registration', { title: `Registration not accepted: ${e.title}`, color: 'no',
    text: `Sorry, your registration for **${e.title}** was not accepted${r.reason ? `.\n\n**Reason:** ${r.reason}` : '.'} Message an admin if you have questions.`, buttons: [evLink(e)] });
  else if (r.team !== teamBefore && r.team && r.status === 'approved') alertUser(r.userId, 'registration', { title: `Your team for ${e.title}`, text: `You are in team **${r.team}**.`, buttons: [evLink(e)] });
  return { ok: true };
});
on('POST', '/api/admin/events/:id/media', async (req, res, p) => {
  const u = needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  const b = await readBody(req);
  const m = { id: store.id(), eventId: e.id, userId: u.uid, creator: str(b.creator, 60) || 'MTC', caption: str(b.caption, 140), status: 'approved', createdAt: store.now() };
  if (b.type === 'youtube') { const v = yt.videoId(str(b.url, 300)); if (!v) throw err(400, 'That is not a YouTube video link.'); Object.assign(m, { type: 'youtube', url: 'https://www.youtube.com/watch?v=' + v, thumb: `https://i.ytimg.com/vi/${v}/hqdefault.jpg`, videoId: v }); }
  else { const f = saveImage(b.data); Object.assign(m, { type: 'image', url: f, thumb: f }); }
  D().media.push(m); store.save(); return { ok: true };
});
on('PUT', '/api/admin/media/:id', async (req, res, p) => {
  needAdmin(req); const m = D().media.find(x => x.id === p.id); if (!m) throw err(404, 'Not found.');
  const b = await readBody(req);
  const before = m.status;
  if (['pending', 'approved', 'rejected'].includes(b.status)) m.status = b.status;
  if (b.caption !== undefined) m.caption = str(b.caption, 140);
  store.save();
  const e = evById(m.eventId) || { title: 'an event', slug: '' };
  if (m.status !== before && (m.status === 'approved' || m.status === 'rejected')) alertUser(m.userId, 'media', m.status === 'approved'
    ? { title: '🎬 Your upload is on the showcase', color: 'ok', text: `Your ${m.type === 'youtube' ? 'video' : 'screenshot'}${m.caption ? ` "${m.caption}"` : ''} for **${e.title}** is now on the website.`, buttons: [{ ...evLink(e), url: evLink(e).url + '#showcase', label: 'See it' }] }
    : { title: 'Your upload was not added', color: 'no', text: `Your ${m.type === 'youtube' ? 'video' : 'screenshot'} for **${e.title}** was not added to the showcase${b.reason ? `.\n\n**Reason:** ${str(b.reason, 200)}` : '.'}` });
  return { ok: true };
});
on('POST', '/api/admin/profiles/:id/approve', async (req, res, p) => {
  needAdmin(req); const q = D().profiles.find(x => x.id === p.id); if (!q) throw err(404, 'Not found.');
  const r = await yt.verifyCreator(q.username || q.userId, q.youtube, { mc: q.mc, socials: q.socials });
  if (q.mc) { const ex = yt.readExtras(); if (ex[r.key]) { ex[r.key].mcEdition = edOf(q.mcEdition); yt.writeExtras(ex); } }
  if (q.featured || q.skin) {
    const ex = yt.readExtras();
    if (q.featured) ex[r.key].featured = q.featured;
    if (q.skin) { const src = path.join(SKIN_DIR, q.skin.split('/').pop().split('?')[0]), file = String(r.key).replace(/[^a-z0-9_.-]/gi, '_') + '.png';
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(SKIN_DIR, file)); ex[r.key].skin = '/uploads/skins/' + file + '?v=' + Date.now(); } }
    yt.writeExtras(ex);
  }
  q.status = 'approved'; q.reviewedAt = store.now(); q.channelName = r.name; store.save();
  alertUser(q.userId, 'profile', { title: '✅ Your creator profile is live', color: 'ok', text: `Your channel **${r.name}** is verified and shows on the MTC Creators page.`, buttons: [{ label: 'Creators page', url: cfg.publicUrl + '/#creators', emoji: '⭐' }] });
  return { ok: true, channel: r.name };
});
on('POST', '/api/admin/profiles/:id/reject', async (req, res, p) => {
  needAdmin(req); const q = D().profiles.find(x => x.id === p.id); if (!q) throw err(404, 'Not found.');
  const b = await readBody(req);
  q.status = 'rejected'; q.reason = str(b.reason, 200); q.reviewedAt = store.now(); store.save();
  alertUser(q.userId, 'profile', { title: 'Creator profile not approved', color: 'no', text: `Your creator profile changes were not approved${q.reason ? `.\n\n**Reason:** ${q.reason}` : '.'} You can fix them and send again.`, buttons: [{ label: 'Your account', url: cfg.publicUrl + '/account.html', emoji: '👤' }] });
  return { ok: true };
});
on('POST', '/api/admin/creators/verify', async req => {
  needAdmin(req); const b = await readBody(req);
  const key = str(b.username, 40); if (!key) throw err(400, 'Enter the Discord username.');
  const r = await discord.creatorMembers().catch(() => null);
  if (r && !r.members.some(m => m.username.toLowerCase() === key.toLowerCase() || m.id === key)) throw err(400, key + ' does not hold the Creator role in Discord.');
  const mcEd = edOf(b.edition), v = await yt.verifyCreator(key, str(b.youtube, 300), { mc: cleanMc(b.mc, mcEd) });
  if (b.mc) { const ex = yt.readExtras(); if (ex[v.key]) { ex[v.key].mcEdition = mcEd; yt.writeExtras(ex); } }
  return { ok: true, channel: v.name };
});
on('POST', '/api/admin/creators/unverify', async req => {
  needAdmin(req); const b = await readBody(req);
  if (!yt.unverifyCreator(str(b.username, 40))) throw err(404, 'No creator entry with that name.');
  return { ok: true };
});
on('POST', '/api/admin/announce', async req => {
  needAdmin(req); const b = await readBody(req);
  const a = { id: store.id(), title: str(b.title, 120), body: str(b.body, 2000), createdAt: store.now(), postedToDiscord: false };
  if (!a.title) throw err(400, 'The announcement needs a title.');
  if (b.discord) {
    try { await discord.announce({ title: a.title, body: a.body, url: b.url ? httpsUrl(b.url) : '' }); a.postedToDiscord = true; }
    catch (e) { a.discordError = e.message; }
  }
  D().announcements.push(a); store.save();
  return { ok: true, postedToDiscord: a.postedToDiscord, discordError: a.discordError };
});
// ---------------------------------------------------------------- messages: channel posts and DMs
// a message is { content, image, embed: null | { title, description, url, color, timestamp, author{name,url,icon}, thumbnail, footer{text,icon}, fields[] } }
// every picture is either an upload kept on this server ('/uploads/..', sent to Discord as a file) or an https link
function pic(v) {
  if (!v) return '';
  v = String(v);
  if (v.startsWith('data:')) return saveImage(v);
  if (/^\/uploads\/[\w-]+\.(png|jpg|jpeg|gif|webp)$/.test(v) && fs.existsSync(path.join(store.UPLOADS, path.basename(v)))) return v;
  const u = httpsUrl(v); if (u) return u;
  throw err(400, 'An image is missing. Choose it again.');
}
function cleanMessage(m) {
  m = m && typeof m === 'object' ? m : {};
  const out = { content: str(m.content, 2000), embed: null, image: pic(m.image) };
  if (m.embed && typeof m.embed === 'object') {
    const e = m.embed, au = e.author || {}, ft = typeof e.footer === 'string' ? { text: e.footer } : (e.footer || {});
    const ts = e.timestamp === 'now' ? 'now' : (e.timestamp && !isNaN(Date.parse(e.timestamp)) ? new Date(e.timestamp).toISOString() : '');
    out.embed = {
      title: str(e.title, 256), description: str(e.description, 4000), url: httpsUrl(e.url) || '',
      color: /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : '#F7931E', timestamp: ts,
      author: { name: str(au.name, 256), url: httpsUrl(au.url) || '', icon: pic(au.icon) },
      thumbnail: pic(e.thumbnail),
      footer: { text: str(ft.text, 2048), icon: pic(ft.icon) },
      fields: (Array.isArray(e.fields) ? e.fields : []).slice(0, 25).map(x => ({ name: str(x && x.name, 256), value: str(x && x.value, 1024), inline: !!(x && x.inline) })).filter(x => x.name && x.value),
    };
    const em = out.embed;
    if (!em.title && !em.description && !out.image && !em.thumbnail && !em.fields.length && !em.author.name) throw err(400, 'The embed is empty. Add a title, description, field or image.');
    const total = em.title.length + em.description.length + em.author.name.length + em.footer.text.length + em.fields.reduce((n, x) => n + x.name.length + x.value.length, 0);
    if (total > 6000) throw err(400, 'The embed is too long for Discord (6000 characters in total).');
  }
  if (!out.content && !out.embed && !out.image) throw err(400, 'Write a message or add an image.');
  return out;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
function payloadOf(m, { ping, name, mentionId } = {}) {
  const fill = t => String(t || '').replace(/\{name\}/g, name || '').replace(/\{mention\}/g, mentionId ? `<@${mentionId}>` : (name || ''));
  const files = [];
  // uploads go as attachments (named by slot), links are used as they are
  const ref = (p, slot) => {
    if (!p) return '';
    if (/^https:/.test(p)) return p;
    const n = path.basename(p), ext = n.split('.').pop().toLowerCase(), fname = slot + '.' + ext;
    if (!files.some(x => x.name === fname)) files.push({ name: fname, buf: fs.readFileSync(path.join(store.UPLOADS, n)), type: MIME[ext] || 'application/octet-stream' });
    return 'attachment://' + fname;
  };
  const pre = [];
  if (ping && ping.everyone) pre.push('@everyone');
  if (ping && ping.here) pre.push('@here');
  for (const r of (ping && ping.roles) || []) pre.push(`<@&${r}>`);
  if (ping && ping.mention && mentionId) pre.push(`<@${mentionId}>`);
  const body = fill(m.content);
  const content = [pre.join(' '), body].filter(Boolean).join(pre.length && body ? '\n' : '');
  const p = { content: content.slice(0, 2000), allowed_mentions: { parse: ping && (ping.everyone || ping.here) ? ['everyone'] : [], roles: (ping && ping.roles) || [], users: mentionId ? [mentionId] : [] } };
  if (m.embed) {
    const e = m.embed, em = { color: parseInt(e.color.slice(1), 16) };
    if (e.title) em.title = fill(e.title); if (e.description) em.description = fill(e.description); if (e.url) em.url = e.url;
    if (e.author && e.author.name) { em.author = { name: fill(e.author.name) }; if (e.author.url) em.author.url = e.author.url; if (e.author.icon) em.author.icon_url = ref(e.author.icon, 'author'); }
    if (e.thumbnail) em.thumbnail = { url: ref(e.thumbnail, 'thumbnail') };
    if (m.image) em.image = { url: ref(m.image, 'image') };
    if (e.fields && e.fields.length) em.fields = e.fields.map(x => ({ name: fill(x.name), value: fill(x.value), inline: x.inline }));
    if (e.footer && e.footer.text) { em.footer = { text: fill(e.footer.text) }; if (e.footer.icon) em.footer.icon_url = ref(e.footer.icon, 'footer'); }
    if (e.timestamp) em.timestamp = e.timestamp === 'now' ? new Date().toISOString() : e.timestamp;
    p.embeds = [em];
  } else if (m.image) {
    if (/^https:/.test(m.image)) p.content = [p.content, m.image].filter(Boolean).join('\n').slice(0, 2000);
    else ref(m.image, 'image');
  }
  return { payload: p, files };
}
function cleanPing(pg, roleIds) {
  pg = pg && typeof pg === 'object' ? pg : {};
  return { everyone: !!pg.everyone, here: !!pg.here, roles: (Array.isArray(pg.roles) ? pg.roles : []).filter(r => roleIds.includes(r)).slice(0, 10) };
}
const logMessage = rec => { const l = D().messages; l.push(rec); if (l.length > 150) l.splice(0, l.length - 150); };

on('GET', '/api/admin/discord/meta', async req => {
  needAdmin(req);
  if (!discord.ready()) throw err(503, 'Discord is not set up (.env).');
  const [chs, rls, mem] = await Promise.all([discord.channels(), discord.roles(), discord.allMembers().catch(() => ({ members: [] }))]);
  const count = id => mem.members.filter(m => (m.roles || []).includes(id)).length;
  return { channels: chs, roles: rls.map(r => ({ ...r, members: count(r.id) })), defaultChannel: cfg.announceChannel || '', members: mem.members.length };
});
on('GET', '/api/admin/activity', async req => { needAdmin(req); return { log: audit.recent(300) }; });
on('GET', '/api/admin/alerts', async req => {
  needAdmin(req); await discord.allMembers().catch(() => null);
  for (const x of D().settings.alertLog || []) if (x.ok === false) x.seen = true; store.save();
  const log = (D().settings.alertLog || []).slice().reverse().slice(0, 200).map(x => {
    if (x.toName) return x;
    const g = discord.cachedMember(x.to) || {}, u = D().users[x.to] || {};
    return { ...x, toName: g.name || u.name || '', toUsername: g.username || u.username || '', toAvatar: g.avatar || u.avatar || '' };
  });
  return { kinds: ALERT_KINDS, alerts: alertCfg(), log };
});
on('POST', '/api/admin/alerts/:id/retry', async (req, res, p) => {
  needAdmin(req); const rec = (D().settings.alertLog || []).find(x => x.id === p.id); if (!rec) throw err(404, 'That alert is no longer in the log.');
  if (rec.ok) throw err(400, 'That alert was already delivered.');
  await sendAlert(rec); return { ok: rec.ok, error: rec.error, alert: rec };
});
on('PUT', '/api/admin/alerts', async req => {
  needAdmin(req); const b = await readBody(req);
  const pick = o => Object.fromEntries(Object.keys(ALERT_KINDS).map(k => [k, !!(o && o[k])]));
  let staffChannel = '';
  const chs = b.staffChannel || b.logChannel ? await discord.channels() : [];
  if (b.staffChannel) { if (!chs.some(c => c.id === String(b.staffChannel))) throw err(400, 'That channel is not in the server.'); staffChannel = String(b.staffChannel); }
  let logChannel = ''; if (b.logChannel) { if (!chs.some(c => c.id === String(b.logChannel))) throw err(400, 'That log channel is not in the server.'); logChannel = String(b.logChannel); }
  D().settings.alerts = { dm: pick(b.dm), staff: pick(b.staff), staffChannel, logChannel, reportFails: b.reportFails !== false }; store.save();
  return { ok: true, alerts: alertCfg() };
});
on('GET', '/api/admin/messages', async req => { needAdmin(req); return { messages: D().messages.slice().reverse(), jobs: [...dmJobs.values()].filter(j => !j.done).map(jobView) }; });

on('POST', '/api/admin/messages/channel', async req => {
  const u = needAdmin(req); const b = await readBody(req);
  const chs = await discord.channels(); const ch = chs.find(c => c.id === String(b.channelId || ''));
  if (!ch) throw err(400, 'Pick a channel.');
  const ping = cleanPing(b.ping, (await discord.roles()).map(r => r.id));
  const m = cleanMessage(b.message);
  const { payload, files } = payloadOf(m, { ping });
  const sent = await discord.send(ch.id, payload, files);
  const rec = { id: store.id(), kind: 'channel', message: m, ping, target: { channelId: ch.id, channel: ch.name }, by: u.name, at: store.now(), result: { ok: true, link: `https://discord.com/channels/${cfg.guild}/${ch.id}/${sent.id}` } };
  if (b.showOnSite) {
    const title = (m.embed && (m.embed.title || m.embed.author.name)) || m.content.split('\n')[0].slice(0, 120) || 'Announcement';
    D().announcements.push({ id: store.id(), title, body: (m.embed && m.embed.description) || m.content, image: m.image, createdAt: store.now(), postedToDiscord: true });
  }
  logMessage(rec); store.save();
  return { ok: true, link: rec.result.link, message: m };
});

// DMs go out one by one in the background (about one a second, so Discord does not block the bot)
const dmJobs = new Map();
const jobView = j => ({ id: j.id, total: j.total, sent: j.sent, failed: j.failed.length, done: j.done, failures: j.failed.slice(0, 50) });
on('POST', '/api/admin/messages/dm', async req => {
  const u = needAdmin(req); const b = await readBody(req);
  if ([...dmJobs.values()].some(j => !j.done)) throw err(409, 'A DM batch is still sending. Wait for it to finish.');
  const mem = (await discord.allMembers(true)).members;
  const users = (Array.isArray(b.users) ? b.users : []).map(String), roleIds = (Array.isArray(b.roles) ? b.roles : []).map(String);
  const allRoles = await discord.roles(); const pickedRoles = allRoles.filter(r => roleIds.includes(r.id));
  const ids = new Set(users.filter(id => /^\d{15,}$/.test(id)));
  for (const m of mem) if ((m.roles || []).some(r => pickedRoles.some(x => x.id === r))) ids.add(m.id);
  if (!ids.size) throw err(400, 'Pick at least one person or role.');
  if (ids.size > 500) throw err(400, `That is ${ids.size} people. Send to 500 or fewer at a time.`);
  const m = cleanMessage(b.message);
  const dmPing = { mention: !!(b.ping && b.ping.mention) };
  const people = [...ids].map(id => mem.find(x => x.id === id) || { id, name: (D().users[id] || {}).name || id });
  const job = { id: store.id(), total: people.length, sent: 0, failed: [], done: false };
  dmJobs.set(job.id, job);
  const rec = { id: job.id, kind: 'dm', message: m, ping: dmPing, target: { users: people.filter(p => users.includes(p.id)).map(p => p.name).slice(0, 20), roles: pickedRoles.map(r => r.name), count: people.length },
    by: u.name, at: store.now(), result: { ok: false, sending: true } };
  logMessage(rec); store.save();
  (async () => {
    for (const p of people) {
      try { const { payload, files } = payloadOf(m, { name: p.name, mentionId: p.id, ping: dmPing }); await discord.dmSend(p.id, payload, files); job.sent++; }
      catch (e) { job.failed.push({ name: p.name, reason: e.code === 50007 ? 'DMs closed or not in the server' : e.message }); }
      await new Promise(s => setTimeout(s, 1100));
    }
    job.done = true; rec.result = { ok: job.failed.length === 0, sent: job.sent, failed: job.failed.length, failures: job.failed.slice(0, 50) }; store.save();
    if (job.failed.length) reportDmFail({ what: `DM batch: "${(m.embed && m.embed.title) || m.content.split('\n')[0].slice(0, 80) || 'image'}" (${job.sent} of ${job.total} delivered)`, list: job.failed });
    setTimeout(() => dmJobs.delete(job.id), 3600e3).unref();
  })();
  return { ok: true, job: jobView(job) };
});
on('GET', '/api/admin/messages/jobs/:id', async (req, res, p) => { needAdmin(req); const j = dmJobs.get(p.id); if (!j) throw err(404, 'That batch is finished.'); return { job: jobView(j) }; });

on('DELETE', '/api/admin/announcements/:id', async (req, res, p) => {
  needAdmin(req); const d = D(); d.announcements = d.announcements.filter(a => a.id !== p.id); store.save(); return { ok: true };
});
on('GET', '/api/admin/export', async (req, res) => {
  needAdmin(req);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="mtc-data-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ exportedAt: store.now(), db: D(), creatorsExtra: yt.readExtras() }, null, 1));
});
on('POST', '/api/admin/backups', async req => { needAdmin(req); return { name: store.backup('manual'), backups: store.listBackups() }; });
on('GET', '/api/admin/backups/:name', async (req, res, p) => {
  needAdmin(req);
  if (!/^db-[\w-]+\.json$/.test(p.name)) throw err(400, 'Bad name');
  const f = path.join(store.BACKUPS, p.name); if (!fs.existsSync(f)) throw err(404, 'Not found');
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${p.name}"` }); fs.createReadStream(f).pipe(res);
});

// ---------------------------------------------------------------- static files
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveFile(res, root, rel, cache) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="background:#150E08;color:#F7EBD8;font-family:sans-serif;padding:40px"><h1>Page not found</h1><p><a style="color:#F7931E" href="/">Back to MTC</a></p>'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- event archive: worlds, plugins, packs to recreate an event
// Two kinds of entry: a LINK to a file kept elsewhere (GitHub Releases, Google Drive, MediaFire...: uses none of our bandwidth,
// the default) or an UPLOAD stored here (only when ARCHIVE_UPLOADS=on in .env, because every download goes through this server).
// Files live in data/archive/<event id>/. Uploads come in pieces (32 MB each) because the Cloudflare tunnel refuses single
// requests over 100 MB; a dropped upload resumes from where it stopped. Downloads support resume (HTTP ranges).
const ARCHIVE = path.join(cfg.DATA, 'archive'), PARTS = path.join(ARCHIVE, '.uploads');
fs.mkdirSync(PARTS, { recursive: true });
const MAX_FILE = 8 * 1024 ** 3, MAX_CHUNK = 40 * 1024 * 1024;
const FILE_TYPES = { world: 'World', plugins: 'Plugins', mods: 'Mods', datapack: 'Datapack', resourcepack: 'Resource pack', config: 'Config', schematic: 'Schematic', other: 'Other' };
const OK_EXT = /\.(zip|rar|7z|tar|gz|tgz|jar|mcworld|mcpack|mcaddon|mctemplate|schem|schematic|litematic|nbt|json|ya?ml|toml|txt|md|properties|png|sk|mrpack)$/i;
// a link's address is never sent to the page: downloads go through /api/dl so members-only links stay private and get counted
const pubFile = x => ({ id: x.id, link: !!x.url, host: x.url ? x.host : '', name: x.name, original: x.original || '', size: x.size || 0, sha256: x.sha256 || '', type: x.type, note: x.note || '', members: !!x.members, downloads: x.downloads || 0, uploadedAt: x.uploadedAt });
const freeSpace = () => { try { const st = fs.statfsSync(cfg.DATA); return st.bavail * st.bsize; } catch { return null; } };
const uploads = new Map(); // id -> { eventId, original, size, part, by, at }
const safeName = n => String(n || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
const linkUrl = v => { let x; try { x = new URL(String(v || '').trim()); } catch { throw err(400, 'Paste the full download link, starting with https://'); }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') throw err(400, 'Only http(s) links work.'); return x; };
// "850 MB", "1.2gb", "300" (MB) -> bytes; blank = unknown
const sizeIn = v => { const m = /^\s*([\d.]+)\s*(k|m|g|t)?i?b?\s*$/i.exec(String(v || '')); if (!m) return 0;
  return Math.round(+m[1] * 1024 ** ({ k: 1, m: 2, g: 3, t: 4 }[(m[2] || 'm').toLowerCase()])); };
on('POST', '/api/admin/events/:id/files/link', async (req, res, p) => {
  const u = needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  const b = await readBody(req), url = linkUrl(b.url);
  const file = { id: store.id(), url: url.href, host: url.hostname.replace(/^www\./, ''), name: str(b.name, 100) || url.pathname.split('/').pop() || url.hostname,
    size: sizeIn(b.size), type: FILE_TYPES[b.type] ? b.type : 'other', note: str(b.note, 300), members: !!b.members, downloads: 0, uploadedAt: store.now(), by: u.name };
  (e.files = e.files || []).push(file); store.save();
  return { ok: true, file: pubFile(file) };
});
on('POST', '/api/admin/events/:id/files/start', async (req, res, p) => {
  const u = needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  if (!cfg.archiveUploads) throw err(403, 'Uploads to this server are off (ARCHIVE_UPLOADS in .env) to save bandwidth. Add the file as a link instead.');
  const b = await readBody(req), original = safeName(b.name), size = Math.floor(+b.size || 0);
  if (!OK_EXT.test(original)) throw err(400, `"${original}" is not an archive file type we keep (zip, jar, mcworld, mcpack, schem, litematic, json, yml, ...).`);
  if (!(size > 0) || size > MAX_FILE) throw err(400, 'Files can be up to 8 GB.');
  const free = freeSpace(); if (free != null && free < size + 2e9) throw err(507, 'Not enough free disk space on the server for this file.');
  const id = store.id() + store.id(), part = path.join(PARTS, id + '.part');
  fs.writeFileSync(part, ''); uploads.set(id, { eventId: e.id, original, size, part, by: u.name, at: Date.now() });
  fs.writeFileSync(part + '.json', JSON.stringify(uploads.get(id)));
  return { upload: id, chunk: 32 * 1024 * 1024 };
});
const getUpload = id => { if (uploads.has(id)) return uploads.get(id); try { const m = JSON.parse(fs.readFileSync(path.join(PARTS, id + '.part.json'), 'utf8')); uploads.set(id, m); return m; } catch { return null; } };
on('GET', '/api/admin/uploads/:id', async (req, res, p) => { needAdmin(req); const up = getUpload(p.id); if (!up) throw err(404, 'Upload not found.'); return { received: fs.statSync(up.part).size, size: up.size }; });
// one piece: must start exactly where the file currently ends (so a retry never duplicates data)
on('PUT', '/api/admin/uploads/:id', async (req, res, p, url) => {
  needAdmin(req); const up = getUpload(p.id); if (!up) throw err(404, 'Upload not found. Start again.');
  const have = fs.statSync(up.part).size, offset = Math.floor(+url.searchParams.get('offset'));
  if (offset !== have) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'offset', received: have })); }
  await new Promise((resolve, reject) => {
    let n = 0; const out = fs.createWriteStream(up.part, { flags: 'a' });
    req.on('data', c => { n += c.length; if (n > MAX_CHUNK || have + n > up.size) { req.destroy(); out.destroy(); reject(err(413, 'Piece too large.')); } });
    req.pipe(out); out.on('finish', resolve); out.on('error', reject); req.on('error', reject);
  }).catch(e => { // keep only whole pieces: cut back to where this piece started
    try { fs.truncateSync(up.part, have); } catch {} throw e; });
  return { received: fs.statSync(up.part).size };
});
on('POST', '/api/admin/uploads/:id/finish', async (req, res, p) => {
  const u = needAdmin(req); const up = getUpload(p.id); if (!up) throw err(404, 'Upload not found.');
  const b = await readBody(req), e = evById(up.eventId); if (!e) throw err(404, 'Event not found.');
  const have = fs.statSync(up.part).size; if (have !== up.size) throw err(400, `Upload is not complete (${have} of ${up.size} bytes).`);
  const sha256 = await new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(up.part).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });
  const dir = path.join(ARCHIVE, e.id); fs.mkdirSync(dir, { recursive: true });
  let stored = up.original, k = 2; while (fs.existsSync(path.join(dir, stored))) stored = up.original.replace(/(\.[^.]+)?$/, ` (${k++})$1`);
  fs.renameSync(up.part, path.join(dir, stored)); try { fs.unlinkSync(up.part + '.json'); } catch {} uploads.delete(p.id);
  const file = { id: store.id(), name: str(b.name, 100) || up.original, original: stored, size: have, sha256, type: FILE_TYPES[b.type] ? b.type : 'other', note: str(b.note, 300), members: !!b.members, downloads: 0, uploadedAt: store.now(), by: u.name };
  (e.files = e.files || []).push(file); store.save();
  return { ok: true, file: pubFile(file) };
});
on('DELETE', '/api/admin/uploads/:id', async (req, res, p) => { needAdmin(req); const up = getUpload(p.id); if (up) { try { fs.unlinkSync(up.part); fs.unlinkSync(up.part + '.json'); } catch {} uploads.delete(p.id); } return { ok: true }; });
on('PUT', '/api/admin/events/:id/files/:fid', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id), x = e && (e.files || []).find(f => f.id === p.fid); if (!x) throw err(404, 'File not found.');
  const b = await readBody(req);
  if (b.name !== undefined) x.name = str(b.name, 100) || x.name; if (b.type && FILE_TYPES[b.type]) x.type = b.type;
  if (b.note !== undefined) x.note = str(b.note, 300); if (b.members !== undefined) x.members = !!b.members;
  if (x.url && b.url !== undefined) { const l = linkUrl(b.url); x.url = l.href; x.host = l.hostname.replace(/^www\./, ''); }
  if (x.url && b.size !== undefined) x.size = sizeIn(b.size);
  if (b.move === 'up' || b.move === 'down') { const l = e.files, i = l.indexOf(x), j = i + (b.move === 'up' ? -1 : 1); if (j >= 0 && j < l.length) [l[i], l[j]] = [l[j], l[i]]; }
  store.save(); return { ok: true };
});
on('DELETE', '/api/admin/events/:id/files/:fid', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id), x = e && (e.files || []).find(f => f.id === p.fid); if (!x) throw err(404, 'File not found.');
  e.files = e.files.filter(f => f !== x); store.save();
  if (!x.url) try { fs.unlinkSync(path.join(ARCHIVE, e.id, x.original)); } catch {}
  return { ok: true };
});
// admin view of an event's archive: includes each link's real address and the last link check
on('GET', '/api/admin/events/:id/files', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  return { files: (e.files || []).map(x => ({ ...pubFile(x), url: x.url || '', check: x.check || null })) };
});
on('PUT', '/api/admin/events/:id/files-order', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
  const b = await readBody(req), ids = Array.isArray(b.ids) ? b.ids.map(String) : [], l = e.files || [];
  e.files = [...ids.map(id => l.find(f => f.id === id)).filter(Boolean), ...l.filter(f => !ids.includes(f.id))];
  store.save(); return { ok: true };
});
// is the link still alive? (file hosts like Workupload delete files after a while). Also fills in the size when the host tells us.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/i;
async function checkLink(x) {
  const u = new URL(x.url); if (PRIVATE_HOST.test(u.hostname)) return { ok: false, status: 0, note: 'Local address', at: store.now() };
  const go = method => fetch(x.url, { method, redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (MTC link check)', ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) } });
  let r; try { r = await go('HEAD'); if (r.status === 405 || r.status === 403 || r.status === 501) { await r.body?.cancel(); r = await go('GET'); } }
  catch (e) { return { ok: false, status: 0, note: e.name === 'TimeoutError' ? 'No answer (timed out)' : 'Could not connect', at: store.now() }; }
  try { await r.body?.cancel(); } catch {}
  const type = (r.headers.get('content-type') || '').split(';')[0], cr = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
  const len = cr ? +cr[1] : r.status === 200 ? +(r.headers.get('content-length') || 0) : 0, page = /html/i.test(type);
  const ok = r.status < 400;
  return { ok, status: r.status, page, size: !page && len > 1 ? len : 0, note: !ok ? (r.status === 404 || r.status === 410 ? 'File is gone (deleted or expired)' : 'Host answered ' + r.status) : page ? 'Opens a download page' : 'Direct download', at: store.now() };
}
on('POST', '/api/admin/events/:id/files/:fid/check', async (req, res, p) => {
  needAdmin(req); const e = evById(p.id), x = e && (e.files || []).find(f => f.id === p.fid); if (!x) throw err(404, 'File not found.');
  if (!x.url) return { check: { ok: true, status: 200, note: 'Stored on this server', at: store.now() } };
  const c = await checkLink(x); x.check = { ok: c.ok, status: c.status, note: c.note, at: c.at };
  if (c.size && !x.size) x.size = c.size;
  store.save(); return { check: x.check, size: x.size || 0 };
});
on('GET', '/api/admin/archive', async req => {
  needAdmin(req); let used = 0;
  for (const e of D().events) for (const f of e.files || []) if (!f.url) used += f.size || 0;
  return { uploads: cfg.archiveUploads, free: cfg.archiveUploads ? freeSpace() : null, used, files: D().events.reduce((n, e) => n + (e.files || []).length, 0), max: MAX_FILE };
});
// download (resumable). Members-only files need a logged-in member who is in the server or verified.
on('GET', '/api/dl/:slug/:fid', async (req, res, p) => {
  const e = evBy(p.slug), x = e && e.status !== 'draft' && (e.files || []).find(f => f.id === p.fid); if (!x) throw err(404, 'File not found.');
  if (x.members) { const u = session(req), rec = u ? D().users[u.uid] || {} : {};
    if (!u || !(u.adm || u.ig || rec.inGuild || rec.verified)) { res.writeHead(302, { Location: '/account.html?error=' + encodeURIComponent('Log in with Discord to download this file (members only).') }); return res.end(); } }
  if (x.url) { x.downloads = (x.downloads || 0) + 1; store.save(); res.writeHead(302, { Location: x.url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end(); }
  const fp = path.join(ARCHIVE, e.id, x.original); let st; try { st = fs.statSync(fp); } catch { throw err(410, 'This file is missing on the server.'); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = st.size - 1;
  if (range) { start = range[1] ? +range[1] : st.size - +range[2]; end = range[1] && range[2] ? Math.min(+range[2], end) : end;
    if (start > end || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); } }
  if (start === 0) { x.downloads = (x.downloads || 0) + 1; store.save(); }
  res.writeHead(range ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
    'Content-Disposition': `attachment; filename="${x.original.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(x.original)}`, 'Cache-Control': 'no-store',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${st.size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(fp, { start, end }).pipe(res);
});
// leftover half-finished uploads are removed after 2 days
setInterval(() => { try { for (const n of fs.readdirSync(PARTS)) { const fp = path.join(PARTS, n); if (Date.now() - fs.statSync(fp).mtimeMs > 2 * 864e5) fs.unlinkSync(fp); } } catch {} }, 6 * 3600e3).unref();

// ---------------------------------------------------------------- activity log (who changed what)
const NO_LOG = new Set(['POST /api/admin/events/:id/files/:fid/check', 'PUT /api/admin/uploads/:id', 'POST /api/admin/events/:id/files/start', 'DELETE /api/admin/uploads/:id', 'POST /api/apply/check', 'POST /api/admin/channel-check', 'POST /api/admin/members/find']);
const cut = (v, n = 300) => { v = String(v == null ? '' : v); return v.length > n ? v.slice(0, n) + '…' : v; };
const yn = v => v ? 'Yes' : 'No';
function whoOf(req) {
  const u = session(req); if (!u) return { name: 'Visitor' };
  return { id: u.uid, name: u.uid === 'admin' ? 'Staff password login' : u.name, username: u.uid === 'admin' ? '' : u.un, avatar: u.av, admin: !!u.adm };
}
// what the action is about, looked up before it runs (so deletes still have names)
function before(p) {
  const c = {};
  if (p.id) {
    c.event = evById(p.id); c.reg = D().registrations.find(x => x.id === p.id); c.media = D().media.find(x => x.id === p.id);
    c.profile = D().profiles.find(x => x.id === p.id); c.app = D().applications.find(x => x.id === p.id); c.user = D().users[p.id];
    c.news = D().announcements.find(x => x.id === p.id);
    if (c.reg) c.regEvent = evById(c.reg.eventId); if (c.media) c.mediaEvent = evById(c.media.eventId);
    if (c.reg) c.regBefore = { status: c.reg.status, team: c.reg.team }; if (c.media) c.mediaBefore = c.media.status;
  }
  if (p.slug) c.event = evBy(p.slug);
  return c;
}
function describe(key, p, b, out, c) {
  b = b || {}; out = out || {};
  const evName = e => e ? e.title : 'an event';
  const msgSum = m => !m ? '' : cut((m.embed && (m.embed.title || (m.embed.author || {}).name)) || m.content || (m.image ? '(image)' : ''), 120);
  switch (key) {
    case 'POST /auth/admin': return { kind: 'login', icon: '🔑', title: 'Logged in with the staff password' };
    case 'POST /auth/logout': return { kind: 'login', icon: '🚪', title: 'Logged out' };
    case 'POST /api/events/:slug/register': return { kind: 'member', icon: '📝', title: `Registered for ${evName(c.event)}`, details: [['Team', b.team], ['Note', cut(b.note)]] };
    case 'DELETE /api/events/:slug/register': return { kind: 'member', icon: '↩️', title: `Withdrew from ${evName(c.event)}` };
    case 'POST /api/apply': return { kind: 'member', icon: '🙋', title: 'Sent a join application', details: [['YouTube', b.youtube], ['Minecraft', b.mc]] };
    case 'PUT /api/me/setup': return { kind: 'member', icon: '⛏️', title: 'Set their Minecraft name', details: [['Minecraft', out.mc || b.mc], ['New skin file', yn(b.skin)], ['YouTube sent', b.youtube]] };
    case 'PUT /api/me/profile': return { kind: 'member', icon: '⭐', title: 'Sent creator profile for review', details: [['YouTube', b.youtube], ['Minecraft', b.mc]] };
    case 'POST /api/events/:slug/media': return { kind: 'member', icon: '🎬', title: `Uploaded to the showcase of ${evName(c.event)}`, details: [['Type', b.type === 'youtube' ? 'YouTube video' : 'Screenshot'], ['Link', b.type === 'youtube' ? b.url : ''], ['Caption', b.caption], ['Status', out.status]] };
    case 'PUT /api/admin/apply-form': return { kind: 'update', icon: '🧾', title: b.reset ? 'Reset the application form' : 'Edited the application form', details: [['Questions', (out.form || []).map(q => q.label).join(', ')]] };
    case 'POST /api/admin/applications/:id': {
      const a = out.application || c.app || {}, act = { approve: ['approve', '✅', 'Approved join application'], reject: ['reject', '⛔', 'Rejected join application'], resend: ['discord', '🔁', 'Sent a new invite'], check: ['other', '🔍', 'Checked if an applicant joined'] }[b.action] || ['other', '•', 'Application action'];
      return { kind: act[0], icon: act[1], title: `${act[2]}: ${a.name || ''}`, details: [['Applicant', a.username ? '@' + a.username : ''], ['YouTube', a.channelName || a.youtube], ['Reason', b.reason], ['Added to server', a.added ? 'Yes, by the bot' : ''], ['Invite made', a.invite && b.action !== 'check' ? 'discord.gg/' + a.invite.code : ''], ['Joined', a.joinedAt ? 'Yes' : '']] };
    }
    case 'POST /api/admin/events': return { kind: 'create', icon: '🆕', title: `Created event: ${out.event ? out.event.title : b.title}`, details: [['Status', b.status], ['Posted to Discord', b.postDiscord ? yn(out.posted) : '']] };
    case 'PUT /api/admin/events/:id': return { kind: 'update', icon: '✏️', title: `Edited event: ${out.event ? out.event.title : evName(c.event)}`, details: [['Status', out.event && out.event.status], ['Changed', Object.keys(b).filter(k => !['postDiscord', 'channelId', 'ping', 'results', 'form', 'banner', 'bannerPos', 'bannerFit', 'titleOver'].includes(k) && b[k] !== undefined).slice(0, 14).join(', ')], ['Banner', b.banner && String(b.banner).startsWith('data:') ? 'New image' : b.banner === '' ? 'Removed' : ''], ['Registration questions', b.form ? String(b.form.length) : ''], ['Results', b.results && b.results.filter(r => r.name).length ? b.results.filter(r => r.name).map(r => `#${r.place} ${r.name}`).slice(0, 5).join(', ') : ''], ['Posted to Discord', b.postDiscord ? yn(out.posted) : '']] };
    case 'PUT /api/admin/events-order': return { kind: 'update', icon: '↕️', title: 'Changed the event order', details: [['Order', (b.ids || []).map(id => (evById(id) || {}).title).filter(Boolean).join(' → ')]] };
    case 'POST /api/admin/events/:id/discord': return { kind: 'discord', icon: '📣', title: `Posted ${b.what === 'rules' ? 'rules' : b.what === 'server' ? 'server IP' : b.what === 'ended' ? 'event ended + winner' : 'event card'} to Discord: ${evName(c.event)}`, details: [['Channel', b.channelId ? `<#${b.channelId}>` : 'default'], ['Ping', pingText(b.ping)]] };
    case 'DELETE /api/admin/events/:id': return { kind: 'delete', icon: '🗑️', title: `Deleted event: ${evName(c.event)}` };
    case 'PUT /api/admin/members/:id/profile': return { kind: 'update', icon: '✏️', title: `Edited creator profile: ${(c.user && c.user.name) || p.id}`, details: [['YouTube', b.youtube], ['Minecraft', b.mc], ['Shown on site', b.show === undefined ? '' : yn(b.show)], ['New skin', yn(b.skin)]] };
    case 'PUT /api/admin/members/:id': return { kind: b.blocked ? 'security' : 'member', icon: b.blocked ? '⛔' : b.verified ? '✅' : '✏️', title: `${b.blocked === true ? 'Blocked' : b.blocked === false ? 'Unblocked' : b.verified === true ? 'Verified' : b.verified === false ? 'Removed verification from' : 'Edited'} member: ${(c.user && c.user.name) || p.id}`, details: [['Note', b.note]] };
    case 'POST /api/admin/members/:id/verify': return { kind: 'approve', icon: '✅', title: `Verified member: ${(c.user && c.user.name) || p.id}` };
    case 'POST /api/admin/events/:id/registrations': return { kind: 'create', icon: '➕', title: `Added ${b.name} to ${evName(c.event)}`, details: [['Minecraft', b.mc], ['Team', b.team]] };
    case 'PUT /api/admin/registrations/:id': {
      const r = c.reg || {}, was = c.regBefore || {};
      const ch = b.status && b.status !== was.status ? `${was.status} → ${b.status}` : '';
      return { kind: b.status === 'approved' ? 'approve' : b.status === 'rejected' ? 'reject' : 'update', icon: b.status === 'approved' ? '✅' : b.status === 'rejected' ? '⛔' : b.status === 'withdrawn' ? '🗑️' : '✏️',
        title: `${b.status === 'approved' ? 'Approved' : b.status === 'rejected' ? 'Rejected' : b.status === 'withdrawn' ? 'Removed' : 'Changed'} registration: ${r.name || ''} in ${evName(c.regEvent)}`, details: [['Status', ch], ['Team', b.team !== undefined && b.team !== was.team ? `${was.team || '(none)'} → ${b.team || '(none)'}` : ''], ['Reason', b.reason]] };
    }
    case 'POST /api/admin/events/:id/media': return { kind: 'create', icon: '🎬', title: `Added to the showcase of ${evName(c.event)}`, details: [['Type', b.type === 'youtube' ? 'YouTube video' : 'Screenshot'], ['By', b.creator], ['Caption', b.caption]] };
    case 'PUT /api/admin/media/:id': { const m = c.media || {};
      return { kind: b.status === 'approved' ? 'approve' : b.status === 'rejected' ? 'reject' : 'update', icon: b.status === 'approved' ? '✅' : b.status === 'rejected' ? '⛔' : '✏️',
        title: `${b.status === 'approved' ? 'Approved' : b.status === 'rejected' ? (c.mediaBefore === 'approved' ? 'Removed' : 'Rejected') : 'Edited'} showcase item from ${m.creator || 'someone'} (${evName(c.mediaEvent)})`, details: [['Caption', b.caption !== undefined ? b.caption : m.caption], ['Reason', b.reason]] }; }
    case 'POST /api/admin/profiles/:id/approve': return { kind: 'approve', icon: '✅', title: `Approved creator profile: ${(c.profile && c.profile.name) || ''}`, details: [['Channel', out.channel]] };
    case 'POST /api/admin/profiles/:id/reject': return { kind: 'reject', icon: '⛔', title: `Rejected creator profile: ${(c.profile && c.profile.name) || ''}`, details: [['Reason', b.reason]] };
    case 'POST /api/admin/creators/verify': return { kind: 'approve', icon: '✅', title: `Verified creator by hand: @${b.username}`, details: [['YouTube', b.youtube], ['Channel', out.channel], ['Minecraft', b.mc]] };
    case 'POST /api/admin/creators/unverify': return { kind: 'delete', icon: '🙈', title: `Hid creator from the site: @${b.username}` };
    case 'POST /api/admin/announce': return { kind: 'create', icon: '📰', title: `Published news: ${b.title}`, details: [['Also in Discord', yn(b.discord)]] };
    case 'DELETE /api/admin/announcements/:id': return { kind: 'delete', icon: '🗑️', title: `Deleted news: ${(c.news && c.news.title) || ''}` };
    case 'PUT /api/admin/alerts': return { kind: 'update', icon: '🔔', title: 'Changed alert and log settings', details: [['Staff channel', b.staffChannel ? `<#${b.staffChannel}>` : 'Off'], ['Log channel', b.logChannel ? `<#${b.logChannel}>` : 'Off']] };
    case 'POST /api/admin/messages/channel': return { kind: 'discord', icon: '📢', title: 'Posted a message to Discord', details: [['Channel', `<#${b.channelId}>`], ['Message', msgSum(b.message)], ['Ping', pingText(b.ping)], ['Shown on site', b.showOnSite ? 'Yes' : '']] };
    case 'POST /api/admin/messages/dm': return { kind: 'discord', icon: '✉️', title: `Started sending DMs to ${out.job ? out.job.total : '?'} people`, details: [['Message', msgSum(b.message)], ['People picked', (b.users || []).length ? String(b.users.length) : ''], ['Roles', (b.roles || []).map(r => `<@&${r}>`).join(' ')], ['Mention each person', b.ping && b.ping.mention ? 'Yes' : '']] };
    case 'POST /api/admin/alerts/:id/retry': return { kind: 'discord', icon: '🔁', title: 'Retried a DM alert', details: [['Result', out.ok ? 'Delivered' : out.error]] };
    case 'PUT /api/admin/maintenance': return { kind: b.on ? 'security' : 'update', icon: b.on ? '🔒' : '🔓', title: b.on ? 'Turned ON admin-only mode (website closed to visitors)' : 'Turned OFF admin-only mode (website open again)', details: [['Message', b.message]] };
    case 'POST /api/admin/uploads/:id/finish': return { kind: 'create', icon: '📦', title: `Added to the archive: ${out.file ? out.file.name : ''}`, details: [['Size', out.file ? (out.file.size / 1048576).toFixed(1) + ' MB' : ''], ['Type', out.file && FILE_TYPES[out.file.type]], ['Members only', out.file && out.file.members ? 'Yes' : '']] };
    case 'PUT /api/admin/events/:id/files-order': return { kind: 'update', icon: '↕️', title: `Reordered the archive files of ${(c.event && c.event.title) || 'an event'}` };
    case 'POST /api/admin/events/:id/files/link': return { kind: 'create', icon: '🔗', title: `Added an archive link to ${(c.event && c.event.title) || 'an event'}: ${out.file ? out.file.name : ''}`, details: [['Hosted on', out.file && out.file.host], ['Type', out.file && FILE_TYPES[out.file.type]], ['Members only', out.file && out.file.members ? 'Yes' : '']] };
    case 'DELETE /api/admin/events/:id/files/:fid': return { kind: 'delete', icon: '🗑️', title: `Deleted an archive file from ${(c.event && c.event.title) || 'an event'}` };
    case 'PUT /api/admin/events/:id/files/:fid': return { kind: 'update', icon: '✏️', title: `Edited an archive file in ${(c.event && c.event.title) || 'an event'}`, details: [['Name', b.name], ['Members only', b.members === undefined ? '' : b.members ? 'Yes' : 'No']] };
    case 'POST /api/admin/backups': return { kind: 'other', icon: '💾', title: 'Made a backup', details: [['File', out.name]] };
    default: return (community && community.describeExtra(key, p, b, out)) || { kind: 'other', icon: '•', title: key };
  }
}
function pingText(pg) { if (!pg) return ''; return [pg.everyone && '@everyone', pg.here && '@here', ...(pg.roles || []).map(r => `<@&${r}>`)].filter(Boolean).join(' '); }

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ---------------------------------------------------------------- admin-only (maintenance) mode
const MAINT_OPEN = /^\/(auth\/|api\/me$|api\/plugin\/|api\/admin\/|assets\/|uploads\/|logos\/|admin\.html$|favicon)/;
function maintPage(msg) {
  const m = esc(msg || 'We are updating the website. Please come back soon!');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Back soon | MTC</title>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png"><link rel="icon" type="image/png" sizes="128x128" href="/assets/favicon-128.png"><link rel="apple-touch-icon" href="/assets/favicon-128.png"><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Archivo:wght@400;600&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 100%,#5a2f0a,#150E08 70%);color:#f6ead7;font:17px/1.6 Archivo,system-ui,sans-serif;text-align:center;padding:24px}
img{width:140px;image-rendering:pixelated;animation:b 2.4s ease-in-out infinite}@keyframes b{50%{transform:translateY(-8px)}}
h1{font:clamp(18px,4vw,30px) 'Press Start 2P',monospace;margin:24px 0 12px;color:#F7931E}p{max-width:520px;margin:0 auto 22px;color:#d8c8b0}
a{display:inline-block;font:11px 'Press Start 2P',monospace;padding:14px 18px;background:#5865f2;color:#fff;text-decoration:none;border:3px solid #000;margin:4px}
small{display:block;margin-top:26px;color:#9c8b74}a.s{background:none;border:0;color:#9c8b74;font:13px Archivo,sans-serif;padding:0;text-decoration:underline}
@media(prefers-reduced-motion:reduce){img{animation:none}}</style></head>
<body><main><img src="/assets/logo.png" alt="MTC"><h1>BACK SOON</h1><p>${m}</p>${cfg.inviteUrl ? `<a href="${esc(cfg.inviteUrl)}">JOIN OUR DISCORD</a>` : ''}<small>MC Thamizh Creators · <a class="s" href="/admin.html">Staff login</a></small></main></body></html>`;
}
on('PUT', '/api/admin/maintenance', async req => {
  needAdmin(req); const b = await readBody(req);
  D().settings.maintenance = { on: !!b.on, message: str(b.message, 300), since: b.on ? store.now() : '' }; store.save();
  return { ok: true, maintenance: D().settings.maintenance };
});

// ---------------------------------------------------------------- community features (server/community.js)
const community = require('./community')({ on, routes, D, store, cfg, err, str, int, isoOrNull, readBody, session, needUser, needAdmin, discord, alertUser, alertStaff, linkRow,
  evById, evBy, mcOf, edOf, yt, sortEvents, publicCreators, MC_WORDS, logErr, esc, playerCard, saveImage, serverStatusOf, sessionOf });
community.NO_LOG.forEach(k => NO_LOG.add(k));
// the Minecraft plugin that opens and closes the event server (server/plugin.js)
const serverPlugin = require('./plugin')({ on, D, store, cfg, err, readBody, needAdmin, evById, evBy, sessionOf });
serverPlugin.NO_LOG.forEach(k => NO_LOG.add(k));
// pages get link-preview tags (title, text, picture, countdown) filled in on the server, so Discord and WhatsApp show them
const pageCache = new Map();
function serveHtml(res, rel, url) {
  const file = path.normalize(path.join(cfg.SITE, rel));
  if (!file.startsWith(cfg.SITE + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  let html; try { const st = fs.statSync(file), hit = pageCache.get(file); html = hit && hit.m === st.mtimeMs ? hit.html : fs.readFileSync(file, 'utf8'); pageCache.set(file, { m: st.mtimeMs, html }); }
  catch { return serveFile(res, cfg.SITE, rel, 'no-cache'); }
  const tags = community.previewTags(rel === '/index.html' ? '/' : rel, url.searchParams);
  html = html.replace(/<meta name="description"[^>]*>\s*/i, '').replace(/<head>/i, '<head>\n' + tags);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(html);
}

const server = http.createServer(async (req, res) => {
  req.on('error', () => {}); res.on('error', () => {});
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/favicon.ico') { res.writeHead(302, { Location: '/assets/favicon-32.png', 'Cache-Control': 'public, max-age=86400' }); return res.end(); }
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }   // for the hosting panel
  try {
    // admin-only mode: everyone except admins sees the "back soon" page (login and admin pages stay open so admins can get in)
    const mt = D().settings.maintenance;
    if (mt && mt.on && !MAINT_OPEN.test(pathname)) {
      const u = session(req);
      if (!(u && u.adm)) {
        if (pathname.startsWith('/api/')) throw err(503, 'The website is in admin-only mode right now. Please come back soon.');
        // link-preview bots (Discord, WhatsApp...) still get the preview tags of a page, never the page itself, so shared links show a card
        if (/discordbot|whatsapp|twitterbot|facebookexternalhit|telegrambot|slackbot|linkedinbot|embedly|skypeuripreview/i.test(req.headers['user-agent'] || '') && (pathname === '/' || pathname.endsWith('.html'))) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end('<!doctype html><html><head><meta charset="utf-8">' + community.previewTags(pathname === '/index.html' ? '/' : pathname, url.searchParams) + '<title>MC Thamizh Creators</title></head><body></body></html>');
        }
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '1800' });
        return res.end(maintPage(mt.message));
      }
    }
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
      // state-changing calls must come from our own pages (custom header can't be sent cross-site without permission)
      if (req.method !== 'GET' && req.headers['x-mtc'] !== '1') throw err(403, 'Blocked request.');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname); if (!m) continue;
        const key = r.method + ' ' + r.pattern, logIt = req.method !== 'GET' && !NO_LOG.has(key);
        const who = logIt ? whoOf(req) : null, ctx = logIt ? before(m.groups || {}) : null;
        const out = await actor.run(logIt ? who : whoOf(req), () => r.fn(req, res, m.groups || {}, url));
        if (!res.headersSent && out !== undefined) json(res, 200, out);
        if (logIt) { try { const d = describe(key, m.groups || {}, req._body, out, ctx); audit.log({ who: key === 'POST /auth/admin' ? { name: 'Staff password login', admin: true } : who, ...d, route: key }); } catch (e) { console.warn('activity log:', e.message); } }
        return;
      }
      throw err(404, 'Not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (pathname.startsWith('/uploads/')) return serveFile(res, store.UPLOADS, pathname.slice(9), 'public, max-age=31536000, immutable');
    let rel = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    if (rel.endsWith('.html') && req.method === 'GET') return serveHtml(res, rel, url);
    return serveFile(res, cfg.SITE, rel, 'no-cache');
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message });
  }
});
// ---------------------------------------------------------------- the Discord bot: online status + slash commands
const SITE = () => cfg.publicUrl;
const pageOfEvent = e => SITE() + '/event.html?slug=' + encodeURIComponent(e.slug);
const ORANGE = 0xF7931E;
const COMMANDS = [
  { name: 'help', description: 'What the MTC bot can do' },
  { name: 'events', description: 'Upcoming and open MTC events' },
  { name: 'event', description: 'Show one event', options: [{ type: 3, name: 'name', description: 'Event', required: true, autocomplete: true }] },
  { name: 'register', description: 'Register for an open event', options: [{ type: 3, name: 'event', description: 'Event', required: true, autocomplete: true }, { type: 3, name: 'team', description: 'Team name (optional)', required: false, max_length: 40 }] },
  { name: 'withdraw', description: 'Withdraw from an event you registered for', options: [{ type: 3, name: 'event', description: 'Event', required: true, autocomplete: true }] },
  { name: 'profile', description: "A member's MTC profile", options: [{ type: 6, name: 'user', description: 'Member (leave empty for yourself)', required: false }] },
  { name: 'creators', description: 'Verified MTC creators' },
  { name: 'skin', description: "Show a Minecraft player's skin", options: [{ type: 3, name: 'name', description: 'Minecraft username', required: true, max_length: 16 }] },
  { name: 'setmc', description: 'Set your Minecraft name (needed to register)', options: [{ type: 3, name: 'name', description: 'Java username or Bedrock gamertag', required: true, max_length: 20 },
    { type: 3, name: 'edition', description: 'Java, Offline (cracked) or Bedrock (default Java)', required: false, choices: [{ name: 'Java (premium)', value: 'java' }, { name: 'Offline / cracked Java', value: 'offline' }, { name: 'Bedrock', value: 'bedrock' }] }] },
  { name: 'server', description: 'Server address of the event that is live now' },
  { name: 'apply', description: 'How to join MC Thamizh Creators' },
];
const reply = (it, data, ephemeral) => fetch(`https://discord.com/api/v10/interactions/${it.id}/${it.token}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 4, data: { allowed_mentions: { parse: [] }, ...data, ...(ephemeral ? { flags: 64 } : {}) } }) }).catch(e => console.warn('reply', e.message));
const note = (title, text, color = ORANGE, buttons = []) => ({ embeds: [{ title, description: text, color, footer: { text: 'MC Thamizh Creators' } }], ...(buttons.length ? { components: linkRow(buttons) } : {}) });
const opt = (it, n) => ((it.data.options || []).find(o => o.name === n) || {}).value;
const visibleEvents = () => sortEvents(D().events.filter(e => e.status !== 'draft'));
function whoFromInteraction(it) {
  const u = (it.member && it.member.user) || it.user || {};
  const name = (it.member && it.member.nick) || u.global_name || u.username;
  const avatar = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : '';
  return { id: u.id, username: u.username, name, avatar, roles: (it.member && it.member.roles) || [] };
}
function profileStats(id, username) {
  const m = mcOf(id, username), names = new Set([username, m.mc, (D().users[id] || {}).name].filter(Boolean).map(x => String(x).toLowerCase()));
  const regs = D().registrations.filter(r => (r.userId === id || names.has(String(r.name || '').toLowerCase())) && r.status === 'approved');
  let played = 0, wins = 0, podiums = 0;
  for (const e of D().events) {
    const reg = regs.find(r => r.eventId === e.id);
    const res = (e.results || []).find(rr => String(rr.name || '').split(/[,&/]| and /i).map(n => n.trim().toLowerCase()).some(n => names.has(n)) || (reg && reg.team && String(rr.name).toLowerCase() === reg.team.toLowerCase()));
    if (reg && (e.status === 'completed' || e.status === 'live')) played++;
    if (res && res.place === 1) wins++; if (res && res.place <= 3) podiums++;
  }
  return { mc: m.mc, played, wins, podiums };
}
async function onCommand(it) {
  const who = whoFromInteraction(it), cmd = it.data.name;
  if (cmd === 'help') return reply(it, note('🤖 MTC bot commands', [
    '`/events` upcoming and open events', '`/event` one event with all details', '`/register` sign up for an open event', '`/withdraw` leave an event',
    '`/profile` your (or someone\'s) MTC profile', '`/creators` verified creators', '`/skin` a Minecraft skin', '`/setmc` set your Minecraft name',
    '`/server` server address while an event is live', '`/apply` how to join MTC'].join('\n'), ORANGE, [{ label: 'Website', url: SITE(), emoji: '🌐' }]));
  if (cmd === 'apply') return reply(it, note('🙋 Join MC Thamizh Creators', 'MTC is for **Tamil Minecraft YouTubers**. Apply with your YouTube channel on the website. Once an admin approves it, you are added to the server.', ORANGE, [{ label: 'Apply', url: SITE() + '/apply.html', emoji: '📝' }]));
  if (cmd === 'events') {
    const list = visibleEvents(), upcoming = list.filter(e => ['open', 'soon', 'live'].includes(e.status)), recent = list.filter(e => e.status === 'completed').slice(0, 2);
    const show = [...upcoming, ...recent].slice(0, 6);
    if (!show.length) return reply(it, note('📅 MTC events', 'No events yet. Watch the announcements channel!'));
    const unix = iso => Math.floor(new Date(iso) / 1000);
    return reply(it, { embeds: [{ title: '📅 MTC events', color: ORANGE, url: SITE() + '/#events', fields: show.map(e => { const pe = pubEvent(e);
      return { name: `${ST_ICON[e.status] || ''} ${e.title}`, value: `${ST_LABEL[e.status] || e.status} · ${e.start ? `<t:${unix(e.start)}:R>` : e.dateLabel || 'date soon'} · ${pe.taken}${e.slots ? '/' + e.slots : ''} registered${e.status === 'open' ? '\n➡️ `/register event:' + e.title + '`' : ''}` }; }),
      footer: { text: 'MC Thamizh Creators' } }], components: linkRow(show.slice(0, 5).map(e => ({ label: e.title.slice(0, 40), url: pageOfEvent(e) }))) });
  }
  if (cmd === 'event') {
    const e = evBy(opt(it, 'name')) || visibleEvents().find(x => x.title.toLowerCase() === String(opt(it, 'name') || '').toLowerCase());
    if (!e || e.status === 'draft') return reply(it, note('Event not found', 'Pick an event from the list while typing.'), true);
    const card = eventCard(e);
    if (card.embeds[0].image && e.banner && /^https:/.test(SITE())) card.embeds[0].image = { url: SITE() + e.banner };
    else delete card.embeds[0].image;
    return reply(it, { embeds: card.embeds, components: card.components });
  }
  if (cmd === 'register' || cmd === 'withdraw') {
    const e = evBy(opt(it, 'event'));
    if (!e || e.status === 'draft') return reply(it, note('Event not found', 'Pick an event from the list while typing.'), true);
    const u = { uid: who.id, un: who.username, name: who.name, adm: false };
    const rec = D().users[who.id] = { ...(D().users[who.id] || {}), id: who.id, username: who.username, name: who.name, avatar: who.avatar || (D().users[who.id] || {}).avatar || '', inGuild: true };
    if (cmd === 'withdraw') {
      const r = D().registrations.find(x => x.eventId === e.id && x.userId === who.id && x.status !== 'withdrawn');
      if (!r) return reply(it, note('Not registered', `You are not registered for **${e.title}**.`), true);
      if (['live', 'completed', 'unsuccessful'].includes(e.status)) return reply(it, note('Too late', 'The event has started, so you cannot withdraw. Message an admin.'), true);
      r.status = 'withdrawn'; r.updatedAt = store.now(); store.save();
      audit.log({ who: { id: who.id, name: who.name, username: who.username, avatar: who.avatar }, kind: 'member', icon: '↩️', title: `Withdrew from ${e.title} (in Discord)` });
      return reply(it, note('↩️ Withdrawn', `You left **${e.title}**.`, 0x777777), true);
    }
    if (e.status !== 'open') return reply(it, note('Registration closed', `Registration for **${e.title}** is not open.`, 0xa63a2b, [{ label: 'Event page', url: pageOfEvent(e), emoji: '🔗' }]), true);
    try { await canJoin(u); } catch (x) { return reply(it, note('Cannot register', x.message, 0xa63a2b), true); }
    if (!mcOf(who.id, who.username).mc) return reply(it, note('Set your Minecraft name first', 'Use `/setmc name:YourName` and then try again.', 0xa63a2b), true);
    if ((e.form || []).some(q => q.required)) return reply(it, note('Register on the website', `**${e.title}** has a few questions to answer, so please register on the event page.`, ORANGE, [{ label: 'Register', url: pageOfEvent(e), emoji: '📝' }]), true);
    const regs = D().registrations.filter(r => r.eventId === e.id && r.status !== 'withdrawn' && r.status !== 'rejected');
    if (regs.some(r => r.userId === who.id)) return reply(it, note('Already registered', `You are already in **${e.title}**.`), true);
    if (e.slots && regs.length >= e.slots) return reply(it, note('Full', `All slots for **${e.title}** are taken.`, 0xa63a2b), true);
    const team = str(opt(it, 'team'), 40);
    const r = { id: store.id(), eventId: e.id, userId: who.id, username: who.username, name: who.name, team, note: 'Registered in Discord', answers: {}, status: 'pending', createdAt: store.now() };
    D().registrations.push(r); store.save();
    audit.log({ who: { id: who.id, name: who.name, username: who.username, avatar: who.avatar }, kind: 'member', icon: '📝', title: `Registered for ${e.title} (in Discord)`, details: [['Team', team]] });
    alertStaff('registration', { title: `📝 New registration: ${e.title}`, text: `**${who.name}** (@${who.username}) registered in Discord.`, tab: 'regs', fields: [{ name: 'Minecraft', value: mcOf(who.id, who.username).mc, inline: true }, { name: 'Team', value: team, inline: true }] });
    return reply(it, note('📝 Registered!', `You are registered for **${e.title}**${team ? ` in team **${team}**` : ''}. An admin will confirm your place, and you'll get a DM.`, 0x4c9a2a, [{ label: 'Event page', url: pageOfEvent(e), emoji: '🔗' }]), true);
  }
  if (cmd === 'setmc') {
    const ed = edOf(opt(it, 'edition'));
    let mc, real, found; try { mc = cleanMc(opt(it, 'name'), ed); ({ name: real, found } = await checkMc(mc, ed)); } catch (x) { return reply(it, note('Not a valid name', x.message, 0xa63a2b), true); }
    const rec = D().users[who.id] = { ...(D().users[who.id] || {}), id: who.id, username: who.username, name: who.name, inGuild: true };
    rec.mc = real; rec.mcEdition = ed; syncProfileMc(who.id, who.username, real, ed); rec.setupAt = rec.setupAt || store.now(); store.save();
    audit.log({ who: { id: who.id, name: who.name, username: who.username, avatar: who.avatar }, kind: 'member', icon: '⛏️', title: 'Set their Minecraft name (in Discord)', details: [['Minecraft', real]] });
    return reply(it, { embeds: [{ title: `⛏️ ${ed === 'bedrock' ? 'Bedrock gamertag' : ed === 'offline' ? 'Offline name' : 'Java name'} set: ${real}`, color: 0x4c9a2a, ...(ed === 'java' ? { thumbnail: { url: `https://mc-heads.net/avatar/${encodeURIComponent(real)}/64` } } : {}),
      description: 'Your name and skin now show in event player lists.' + (ed === 'offline' ? '\n\nOffline accounts have no official skin, so you show as Steve or Alex. Upload your skin file on the website (Account page) to show yours.' : '') + (ed === 'bedrock' && !found ? '\n\nYour Bedrock skin shows after you join a Geyser server once. Until then you appear as Steve, or upload your skin on the website (Account page).' : '') }] }, true);
  }
  if (cmd === 'skin') {
    let mc; try { mc = cleanMc(opt(it, 'name')); } catch (x) { return reply(it, note('Not a valid name', x.message, 0xa63a2b), true); }
    return reply(it, { embeds: [{ title: `🧍 ${mc}`, color: ORANGE, url: `https://namemc.com/profile/${encodeURIComponent(mc)}`, image: { url: `https://mc-heads.net/body/${encodeURIComponent(mc)}/180` }, thumbnail: { url: `https://mc-heads.net/head/${encodeURIComponent(mc)}/96` } }] });
  }
  if (cmd === 'profile') {
    const target = opt(it, 'user'), res = it.data.resolved || {};
    const tu = target ? (res.users || {})[target] || { id: target } : (it.member && it.member.user) || it.user;
    const tm = target ? (res.members || {})[target] || {} : it.member || {};
    const name = tm.nick || tu.global_name || tu.username || 'Member';
    const ex = yt.readExtras(), x = ex[tu.id] || ex[String(tu.username || '').toLowerCase()] || {};
    const st = profileStats(tu.id, tu.username), verified = x.verified === true && x.socials && x.socials.youtube;
    const avatar = tu.avatar ? `https://cdn.discordapp.com/avatars/${tu.id}/${tu.avatar}.png?size=128` : '';
    const buttons = [verified && { label: 'Creator page', url: SITE() + '/creator.html?u=' + encodeURIComponent(tu.username), emoji: '⭐' }, verified && { label: 'YouTube', url: x.socials.youtube, emoji: '▶️' },
      st.mc && { label: 'Skin on NameMC', url: `https://namemc.com/profile/${encodeURIComponent(st.mc)}`, emoji: '🧍' }];
    return reply(it, { embeds: [{ author: { name: `${name}${tu.username ? ' · @' + tu.username : ''}`, ...(avatar ? { icon_url: avatar } : {}) },
      title: verified ? `⭐ ${x.channelName || name}` : name, color: verified ? 0x4c9a2a : ORANGE,
      thumbnail: { url: x.logo ? (x.logo.startsWith('http') ? x.logo : SITE() + x.logo) : st.mc ? `https://mc-heads.net/avatar/${encodeURIComponent(st.mc)}/96` : avatar || SITE() + '/assets/logo.png' },
      fields: [{ name: '⛏️ Minecraft', value: st.mc ? `${st.mc}${mcOf(tu.id, tu.username).edition === 'bedrock' ? ' (Bedrock)' : mcOf(tu.id, tu.username).edition === 'offline' ? ' (Offline)' : ' (Java)'}` : 'not set (`/setmc`)', inline: true }, { name: '🎮 Events played', value: String(st.played), inline: true }, { name: '🏆 Wins', value: String(st.wins), inline: true },
        { name: '🥇 Top 3', value: String(st.podiums), inline: true }, { name: '✅ Creator', value: verified ? 'Verified' : 'Not yet', inline: true }],
      footer: { text: 'MC Thamizh Creators' } }], ...(buttons.filter(Boolean).length ? { components: linkRow(buttons.filter(Boolean)) } : {}) });
  }
  if (cmd === 'creators') {
    const r = await discord.creatorMembers().catch(() => null), list = r ? publicCreators(r.members) : [];
    if (!list.length) return reply(it, note('⭐ Creators', 'No verified creators yet.'));
    return reply(it, { embeds: [{ title: `⭐ Verified MTC creators (${list.length})`, color: ORANGE, url: SITE() + '/#creators',
      description: list.slice(0, 30).map(c => `• [${c.name}](${SITE()}/creator.html?u=${encodeURIComponent(c.username)})${c.mc ? ` · ⛏️ ${c.mc}` : ''}`).join('\n').slice(0, 4000), footer: { text: 'MC Thamizh Creators' } }],
      components: linkRow([{ label: 'All creators', url: SITE() + '/#creators', emoji: '⭐' }]) });
  }
  if (cmd === 'server') {
    const live = visibleEvents().filter(e => e.status === 'live' && (e.serverJava || e.serverBedrock || e.serverInfo));
    if (!live.length) return reply(it, note('🖥️ No event is live', 'The server address is shared when an event goes live. Check `/events`.'), true);
    // answer "thinking..." first (Discord wants a reply within 3 seconds), then send the card with its picture
    await fetch(`https://discord.com/api/v10/interactions/${it.id}/${it.token}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 5 }) }).catch(() => {});
    const e = live[0];
    if (!e.serverJava && !e.serverBedrock) return discord.followup(cfg.clientId, it.token, { embeds: [{ title: `🖥️ ${e.title}`, url: pageOfEvent(e), color: ST_COLOR.live, description: '```\n' + e.serverInfo + '\n```' }] }).catch(x => logErr('/server', x));
    const st = await serverStatusOf(e), img = statusImage(e, st);
    return discord.followup(cfg.clientId, it.token, { embeds: [serverEmbed(e, st, '', !!img)], components: linkRow([{ label: 'Event page', url: pageOfEvent(e), emoji: '🔗' }]) }, img ? [img] : []).catch(x => logErr('/server', x));
  }

  return reply(it, note('Unknown command', 'Try `/help`.'), true);
}
async function onAutocomplete(it) {
  const focused = (it.data.options || []).find(o => o.focused) || {}, q = String(focused.value || '').toLowerCase();
  let list = visibleEvents();
  if (it.data.name === 'register') list = list.filter(e => e.status === 'open');
  if (it.data.name === 'withdraw') { const uid = whoFromInteraction(it).id; list = list.filter(e => D().registrations.some(r => r.eventId === e.id && r.userId === uid && r.status !== 'withdrawn')); }
  const choices = list.filter(e => !q || e.title.toLowerCase().includes(q)).slice(0, 25).map(e => ({ name: `${e.title} · ${ST_LABEL[e.status] || e.status}`.slice(0, 100), value: e.slug }));
  await fetch(`https://discord.com/api/v10/interactions/${it.id}/${it.token}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 8, data: { choices } }) }).catch(() => {});
}
// rotating status line under the bot's name ("rich presence" for the bot): what is happening in MTC right now
let presenceStep = 0;
const leftTxt = iso => { const ms = new Date(iso) - Date.now(); if (!(ms > 0)) return ''; const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const istTime = iso => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).toUpperCase();
async function presenceOptions() {
  const out = [], evs = visibleEvents(), cut = t => String(t).slice(0, 120);
  // 1) creators streaming Minecraft now: the purple "LIVE" status, with a link to the stream
  for (const l of (community.liveList ? community.liveList() : []).slice(0, 3)) out.push({ type: 1, name: cut(`🔴 ${l.name} is live`), url: l.url });
  // 2) the live event: the day, the server hours and how many are in game
  const live = evs.find(e => e.status === 'live');
  if (live) {
    const ss = sessionOf(live);
    if (ss && !ss.open && !ss.over) out.push({ type: 3, name: cut(`${live.title} · Day ${ss.day}${ss.days ? '/' + ss.days : ''} opens ${istTime(ss.opensAt)}`) });
    else {
      const st = (live.serverJava || live.serverBedrock) ? await Promise.race([serverStatusOf(live), new Promise(r => setTimeout(() => r({}), 4000))]).catch(() => ({})) : {};
      const main = st.java || st.bedrock;
      out.push({ type: 0, name: cut(`${live.title}${ss ? ` · Day ${ss.day}${ss.days ? '/' + ss.days : ''}` : ''}${main && main.online ? ` · ${main.players.online} online` : ' · LIVE'}`) });
    }
  }
  // 3) registration open: spots left; coming soon: countdown
  const open = evs.find(e => e.status === 'open');
  if (open) { const n = D().registrations.filter(r => r.eventId === open.id && ['pending', 'approved'].includes(r.status)).length;
    out.push({ type: 3, name: cut(`📝 ${open.title} · ${open.slots ? `${Math.max(0, open.slots - n)} spots left` : `${n} registered`}`) }); }
  const soon = evs.filter(e => ['soon', 'open'].includes(e.status) && e.start && new Date(e.start) > Date.now()).sort((x, y) => new Date(x.start) - new Date(y.start))[0];
  if (soon) out.push({ type: 3, name: cut(`⏳ ${soon.title} in ${leftTxt(soon.start)}`) });
  // 4) always: the website, the creators, the help command
  const n = (yt.readExtras && Object.values(yt.readExtras()).filter(x => x && x.verified === true).length) || 0;
  out.push({ type: 3, name: 'mtc.kovaihost.cloud' });
  if (n) out.push({ type: 3, name: `${n} Tamil creators` });
  out.push({ type: 2, name: '/help' });
  return out;
}
async function rotatePresence() {
  try { const opts = await presenceOptions(); gateway.setPresence(opts[presenceStep++ % opts.length]); }
  catch (e) { logErr('presence', e); }
}
if (discord.ready() && !process.env.MTC_NO_BOT) {
  gateway.start({
    READY: async () => {
      rotatePresence();
      if (cfg.clientId) { const r = await fetch(`https://discord.com/api/v10/applications/${cfg.clientId}/guilds/${cfg.guild}/commands`, { method: 'PUT', headers: { Authorization: 'Bot ' + cfg.token, 'Content-Type': 'application/json' }, body: JSON.stringify(COMMANDS) });
        console.log(r.ok ? `Slash commands ready (${COMMANDS.length})` : 'Could not register slash commands: ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
    },
    INTERACTION_CREATE: it => { if (it.guild_id && it.guild_id !== cfg.guild) return; if (it.type === 2) return onCommand(it); if (it.type === 4) return onAutocomplete(it); },
    // an approved applicant joined: delete their invite and give the Creator role straight away
    GUILD_MEMBER_ADD: m => { if (m.guild_id !== cfg.guild) return; const id = m.user && m.user.id; if (id && D().applications.some(a => a.userId === id && a.status === 'approved' && !a.joinedAt)) joinCheck(id).catch(() => {}); },
  });
  setInterval(rotatePresence, 30e3).unref();
}

syncSlugs();   // event addresses follow the event names
server.listen(cfg.port, cfg.host, () => {
  console.log(`MTC site: ${cfg.publicUrl}/  (listening on ${cfg.host}:${cfg.port})`);
  console.log(`  Discord sync: ${discord.ready() ? 'on' : 'off'} | Discord login: ${discord.loginReady() ? 'on' : 'off (add DISCORD_CLIENT_SECRET to .env)'} | Announcements: ${cfg.announceChannel ? 'on' : 'off'}`);
  console.log(`  Admin page: ${cfg.publicUrl}/admin.html (Discord admins, or the ADMIN_PASSWORD in .env)`);
});

// ---------------------------------------------------------------- clean shutdown (Pterodactyl "Stop", Ctrl+C) and console commands
function shutdown(why) { console.log(`Stopping (${why}): saving data...`); try { store.save(); } catch (e) { console.error(e); } gateway.stop && gateway.stop(); server.close(); setTimeout(() => process.exit(0), 500).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('Ctrl+C'));
if (process.stdin && !process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { for (const line of String(d).split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean)) {
    if (line === 'stop' || line === 'end' || line === 'exit') shutdown('console');
    else if (line === 'save') { store.save(); console.log('Saved.'); }
    else if (line === 'backup') console.log('Backup: ' + store.backup('console'));
    else console.log('Commands: stop, save, backup'); } });
  process.stdin.on('error', () => {});
}
