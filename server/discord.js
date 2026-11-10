// Talks to Discord with the bot token (member list, role checks, announcements) and handles the login exchange.
const fs = require('fs'), path = require('path');
const cfg = require('./env');

const API = 'https://discord.com/api/v10';
const UA = 'MTC-Website (local, 1.0)';
async function call(p, opt = {}) {
  const r = await fetch(API + p, { ...opt, headers: { Authorization: 'Bot ' + cfg.token, 'User-Agent': UA, ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) } });
  if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise(s => setTimeout(s, (j.retry_after || 1) * 1000)); return call(p, opt); }
  if (r.status === 204) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.message || 'Discord ' + r.status); e.status = r.status; e.code = body.code; throw e; }
  return body;
}
const ready = () => !!(cfg.token && cfg.guild && cfg.creatorRole);

// ----- every member of the server (admin Members tab), cached 10 min -----
const CACHE = path.join(cfg.DATA, 'creators.json'), TTL = 10 * 60 * 1000;
let all = null;
async function allMembers(force) {
  if (!force && all && Date.now() - all.at < TTL) return all;
  if (!ready()) throw Object.assign(new Error('Discord is not configured (.env)'), { status: 503 });
  const out = []; let after = '0';
  for (;;) {
    const page = await call(`/guilds/${cfg.guild}/members?limit=1000&after=${after}`);
    for (const m of page) if (!m.user.bot && !m.user.username.startsWith('deleted_user_')) out.push({
      id: m.user.id, username: m.user.username, name: m.nick || m.user.global_name || m.user.username,
      avatar: m.user.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64` : '',
      creator: m.roles.includes(cfg.creatorRole), joined: m.joined_at, roles: m.roles });
    if (page.length < 1000) break; after = page[page.length - 1].user.id;
  }
  all = { at: Date.now(), members: out };
  return all;
}

// ----- members holding the Creator role (cached 10 min, saved copy used if Discord is down) -----
let mem = null;
async function fetchMembers() {
  return (await allMembers(true)).members.filter(m => m.creator).map(({ id, username, name }) => ({ id, username, name }));
}
async function creatorMembers(force) {
  if (!force && mem && Date.now() - mem.at < TTL) return mem;
  if (!ready()) throw Object.assign(new Error('Discord is not configured (.env)'), { status: 503 });
  try {
    const members = await fetchMembers();
    mem = { at: Date.now(), members, source: 'discord' };
    fs.writeFileSync(CACHE, JSON.stringify({ at: mem.at, members }, null, 1));
  } catch (e) {
    let c; try { c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}
    if (!c || !c.members) throw e;
    mem = { at: c.at, members: c.members, source: 'cache', error: e.message };
  }
  return mem;
}

// ----- one member: is this Discord user in our server, and do they hold the Creator role? -----
async function memberInfo(userId) {
  if (!ready()) return { inGuild: false, creator: false, roles: [] };
  try {
    const m = await call(`/guilds/${cfg.guild}/members/${userId}`);
    return { inGuild: true, creator: m.roles.includes(cfg.creatorRole), roles: m.roles, nick: m.nick };
  } catch (e) {
    if (e.status === 404) return { inGuild: false, creator: false, roles: [] };
    throw e;
  }
}

// ----- find server members by username / nickname (admin "verify a member" form) -----
async function searchMembers(q) {
  if (!ready()) return [];
  if (/^\d{15,}$/.test(q)) {
    try { const m = await call(`/guilds/${cfg.guild}/members/${q}`); return [m]; } catch (e) { if (e.status === 404) return []; throw e; }
  }
  return call(`/guilds/${cfg.guild}/members/search?limit=5&query=${encodeURIComponent(q)}`);
}

// ----- announcements to a Discord channel -----
async function announce({ title, body, url }) {
  if (!cfg.announceChannel) throw Object.assign(new Error('No announcement channel set (DISCORD_ANNOUNCE_CHANNEL_ID in .env)'), { status: 400 });
  return call(`/channels/${cfg.announceChannel}/messages`, { method: 'POST', body: JSON.stringify({
    embeds: [{ title: title.slice(0, 256), description: body.slice(0, 4000), url: url || undefined, color: 0xF7931E }],
    allowed_mentions: { parse: [] } }) });
}

// a ready-made embed (event cards)
async function postEmbed(embed) {
  if (!cfg.announceChannel) throw Object.assign(new Error('No announcement channel set (DISCORD_ANNOUNCE_CHANNEL_ID in .env)'), { status: 400 });
  return call(`/channels/${cfg.announceChannel}/messages`, { method: 'POST', body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
}

// ----- login with Discord (OAuth2, "identify" scope only) -----
const loginReady = () => !!(cfg.clientId && cfg.clientSecret);
const redirectUri = () => cfg.publicUrl + '/auth/callback';
// applicants also grant "guilds.join", so once approved the bot can add them to MTC itself (no invite, no DM needed)
function authorizeUrl(state, join) {
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: join ? 'identify guilds.join' : 'identify', state, prompt: join ? 'consent' : 'none' });
  return 'https://discord.com/oauth2/authorize?' + q;
}
async function token(params) {
  const r = await fetch(API + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }) });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) throw Object.assign(new Error('Discord login failed: ' + (tok.error_description || tok.error || r.status)), { status: 400 });
  return tok;
}
async function exchange(code) {
  const tok = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  const u = await fetch(API + '/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token, 'User-Agent': UA } });
  if (!u.ok) throw Object.assign(new Error('Could not read your Discord profile'), { status: 400 });
  const me = await u.json();
  const scopes = String(tok.scope || '').split(' ');
  if (scopes.includes('guilds.join')) me._join = { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in || 604800) * 1000 };
  return me;
}
const refreshToken = refresh => token({ grant_type: 'refresh_token', refresh_token: refresh });
// add an approved applicant to the server with their permission token; returns 'added' or 'already'
async function addMember(userId, accessToken, roles) {
  const r = await fetch(`${API}/guilds/${cfg.guild}/members/${userId}`, { method: 'PUT', headers: { Authorization: 'Bot ' + cfg.token, 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken, ...(roles && roles.length ? { roles } : {}) }) });
  if (r.status === 201) return 'added';
  if (r.status === 204) return 'already';
  const b = await r.json().catch(() => ({}));
  throw Object.assign(new Error(b.message || 'Discord ' + r.status), { status: r.status, code: b.code });
}

// ----- join applications from the website -----
// one-use invite that skips the server's own "Apply to Join" form (Discord needs the bot to have Kick Members for that)
async function inviteChannel() {
  if (cfg.inviteChannel) return cfg.inviteChannel;
  const g = await call(`/guilds/${cfg.guild}`);
  if (g.system_channel_id) return g.system_channel_id;
  const chans = await call(`/guilds/${cfg.guild}/channels`);
  const t = chans.filter(c => c.type === 0).sort((a, b) => a.position - b.position)[0];
  if (!t) throw Object.assign(new Error('No text channel to invite people into. Set DISCORD_INVITE_CHANNEL_ID in .env.'), { status: 400 });
  return t.id;
}
async function makeInvite(days = 7) {
  if (!ready()) throw Object.assign(new Error('Discord is not configured (.env)'), { status: 503 });
  const ch = await inviteChannel();
  const body = { max_age: days * 86400, max_uses: 1, unique: true, temporary: false };
  try { const i = await call(`/channels/${ch}/invites`, { method: 'POST', body: JSON.stringify({ ...body, flags: 8 }) }); return { code: i.code, bypass: true, expires: i.expires_at }; }
  catch (e) {
    if (e.status !== 403 && e.status !== 400) throw e;
    // no Kick Members permission: a normal one-use invite still works, but Discord's own application form will show
    const i = await call(`/channels/${ch}/invites`, { method: 'POST', body: JSON.stringify(body) });
    return { code: i.code, bypass: false, expires: i.expires_at, note: 'The bot needs the Kick Members permission for links that skip the Discord application.' };
  }
}
async function deleteInvite(code) { try { await call(`/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }); return true; } catch (e) { if (e.status === 404) return true; throw e; } }
// Discord only lets a bot DM people who share a server with it, so this often fails for people not in MTC yet
async function dm(userId, payload) {
  const ch = await call('/users/@me/channels', { method: 'POST', body: JSON.stringify({ recipient_id: userId }) });
  return call(`/channels/${ch.id}/messages`, { method: 'POST', body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }) });
}
async function addRole(userId, roleId) { return call(`/guilds/${cfg.guild}/members/${userId}/roles/${roleId}`, { method: 'PUT' }); }

// ----- messages module: channels, roles, sending with an optional image file -----
async function channels() {
  const all = await call(`/guilds/${cfg.guild}/channels`);
  const cats = Object.fromEntries(all.filter(c => c.type === 4).map(c => [c.id, c]));
  return all.filter(c => c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name, news: c.type === 5,
    category: cats[c.parent_id] ? cats[c.parent_id].name : '', cpos: cats[c.parent_id] ? cats[c.parent_id].position : -1, pos: c.position }))
    .sort((a, b) => a.cpos - b.cpos || a.pos - b.pos).map(({ cpos, pos, ...c }) => c);
}
async function roles() {
  const r = await call(`/guilds/${cfg.guild}/roles`);
  return r.filter(x => x.id !== cfg.guild && !x.managed).sort((a, b) => b.position - a.position)
    .map(x => ({ id: x.id, name: x.name, color: x.color ? '#' + x.color.toString(16).padStart(6, '0') : '' }));
}
// payload is a normal message body; file = { name, buf, type } sent as an attachment (embeds point at attachment://name)
async function send(channelId, payload, files) {
  files = (Array.isArray(files) ? files : files ? [files] : []).slice(0, 10);
  if (!files.length) return call(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(payload) });
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ ...payload, attachments: files.map((f, i) => ({ id: i, filename: f.name })) }));
  files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.buf], { type: f.type }), f.name));
  for (let tries = 0; ; tries++) {
    const r = await fetch(`${API}/channels/${channelId}/messages`, { method: 'POST', headers: { Authorization: 'Bot ' + cfg.token, 'User-Agent': UA }, body: fd });
    if (r.status === 429 && tries < 3) { const j = await r.json().catch(() => ({})); await new Promise(s => setTimeout(s, (j.retry_after || 1) * 1000)); continue; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(body.message || 'Discord ' + r.status); e.status = r.status; e.code = body.code; throw e; }
    return body;
  }
}
// change a message the bot posted (used to keep the live server status post up to date); with files, the old attachments are replaced
async function multipart(method, url, payload, files) {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ ...payload, attachments: files.map((f, i) => ({ id: i, filename: f.name })) }));
  files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.buf], { type: f.type }), f.name));
  for (let tries = 0; ; tries++) {
    const r = await fetch(url, { method, headers: { Authorization: 'Bot ' + cfg.token, 'User-Agent': UA }, body: fd });
    if (r.status === 429 && tries < 3) { const j = await r.json().catch(() => ({})); await new Promise(s => setTimeout(s, (j.retry_after || 1) * 1000)); continue; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(body.message || 'Discord ' + r.status); e.status = r.status; e.code = body.code; throw e; }
    return body;
  }
}
async function edit(channelId, messageId, payload, files) {
  if (files && files.length) return multipart('PATCH', `${API}/channels/${channelId}/messages/${messageId}`, payload, files);
  return call(`/channels/${channelId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
// finish a slash command answered with "thinking..." (used when the answer has a picture)
const followup = (appId, token, payload, files) => multipart('PATCH', `${API}/webhooks/${appId}/${token}/messages/@original`, payload, files || []);
async function dmSend(userId, payload, files) {
  const ch = await call('/users/@me/channels', { method: 'POST', body: JSON.stringify({ recipient_id: userId }) });
  return send(ch.id, payload, files);
}

// last fetched member list, without waiting (used for player pictures)
const cachedMember = id => all ? all.members.find(m => m.id === id) : null;
module.exports = { edit, followup, channels, roles, send, dmSend, addMember, refreshToken, makeInvite, deleteInvite, dm, addRole, cachedMember, ready, allMembers, creatorMembers, memberInfo, searchMembers, announce, postEmbed, loginReady, authorizeUrl, exchange, redirectUri };
