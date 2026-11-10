// Keeps the bot connected to Discord's gateway, so it shows as online, has a status, and receives
// slash commands and member joins. Reconnects and resumes by itself. No extra libraries (Node's built-in WebSocket).
const cfg = require('./env');

const API = 'https://discord.com/api/v10';
const INTENT_GUILDS = 1, INTENT_MEMBERS = 2; // members is "privileged": it must be switched on in the Developer Portal
let ws = null, beat = null, acked = true, seq = null, session = null, resumeUrl = null, stopped = false;
let intents = INTENT_GUILDS | INTENT_MEMBERS, presence = { name: 'MC Thamizh Creators', type: 0 }, handlers = {};
const state = { online: false, since: null, user: null, lastError: '', reconnects: 0, membersIntent: true };

function send(op, d) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ op, d })); }
function presencePayload() { return { since: null, activities: [presence], status: 'online', afk: false }; }
function setPresence(p) { presence = p; send(3, presencePayload()); }

async function connect() {
  if (stopped || !cfg.token) return;
  let url = resumeUrl;
  if (!url) {
    try { const r = await fetch(API + '/gateway/bot', { headers: { Authorization: 'Bot ' + cfg.token } }); const j = await r.json(); url = j.url; }
    catch (e) { state.lastError = 'Could not reach Discord: ' + e.message; return later(15e3); }
    if (!url) { state.lastError = 'Discord refused the bot token.'; return later(60e3); }
  }
  ws = new WebSocket(url + '/?v=10&encoding=json');
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.s != null) seq = m.s;
    if (m.op === 10) {                                   // hello: start heartbeats, then identify or resume
      clearInterval(beat); acked = true;
      const iv = m.d.heartbeat_interval;
      setTimeout(() => send(1, seq), Math.random() * iv);
      beat = setInterval(() => { if (!acked) { try { ws.close(4000); } catch {} return; } acked = false; send(1, seq); }, iv);
      if (session && resumeUrl) send(6, { token: cfg.token, session_id: session, seq });
      else send(2, { token: cfg.token, intents, properties: { os: process.platform, browser: 'mtc-website', device: 'mtc-website' }, presence: presencePayload() });
    } else if (m.op === 11) acked = true;
    else if (m.op === 1) send(1, seq);
    else if (m.op === 7) { try { ws.close(4000); } catch {} }                 // Discord asks us to reconnect
    else if (m.op === 9) { if (!m.d) { session = null; resumeUrl = null; seq = null; } setTimeout(() => { try { ws.close(4000); } catch {} }, 1000 + Math.random() * 4000); }
    else if (m.op === 0) {
      if (m.t === 'READY') { session = m.d.session_id; resumeUrl = m.d.resume_gateway_url; state.online = true; state.since = new Date().toISOString(); state.user = m.d.user && m.d.user.username; state.lastError = ''; console.log(`Discord bot online as ${state.user}`); }
      if (m.t === 'RESUMED') state.online = true;
      const h = handlers[m.t]; if (h) Promise.resolve().then(() => h(m.d)).catch(e => console.warn('gateway handler', m.t, e.message));
    }
  };
  ws.onclose = ev => {
    clearInterval(beat); state.online = false;
    if (ev.code === 4004) { state.lastError = 'Discord rejected the bot token (4004). Check DISCORD_TOKEN in .env.'; stopped = true; console.warn(state.lastError); return; }
    if (ev.code === 4014) { // privileged "Server Members" intent is off in the Developer Portal: run without it
      intents = INTENT_GUILDS; state.membersIntent = false; session = null; resumeUrl = null;
      state.lastError = 'Server Members intent is off in the Developer Portal, so instant join detection is off (the 5-minute check still runs).'; console.warn(state.lastError);
    }
    if ([4007, 4009, 4010, 4011, 4012, 4013].includes(ev.code)) { session = null; resumeUrl = null; seq = null; }
    state.reconnects++; later(2000 + Math.random() * 3000);
  };
  ws.onerror = () => {};
}
function later(ms) { setTimeout(connect, ms).unref?.(); }
function start(h) { handlers = h || {}; connect(); }
function stop() { stopped = true; try { ws && ws.close(1000); } catch {} }
module.exports = { start, stop, setPresence, state };
