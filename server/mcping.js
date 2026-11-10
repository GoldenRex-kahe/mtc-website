// Minecraft server status without any library.
//   Java:    Server List Ping over TCP (the same request the multiplayer menu sends), with SRV records like the game.
//   Bedrock: RakNet "unconnected ping" over UDP (what the Bedrock server list sends).
const net = require('net'), dgram = require('dgram'), dns = require('dns').promises;

function varint(n) { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); }
function readVarint(buf, off) { let n = 0, shift = 0, b; do { if (off >= buf.length) return null; b = buf[off++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && shift < 35); return [n, off]; }
const packet = (...parts) => { const body = Buffer.concat(parts); return Buffer.concat([varint(body.length), body]); };
const mcString = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); };
// chat component -> plain text (MOTD)
const plain = c => typeof c === 'string' ? c : !c ? '' : (c.text || '') + (Array.isArray(c.extra) ? c.extra.map(plain).join('') : '');
const strip = s => String(s || '').replace(/§[0-9a-fk-orx]/gi, '').trim();
// MOTD with its colours: a list of { t: text, c: '#rrggbb', b, i, u, s, o } pieces (bold, italic, underline, strike, obfuscated)
const CODE = { 0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff' };
const NAMED = { black: '0', dark_blue: '1', dark_green: '2', dark_aqua: '3', dark_red: '4', dark_purple: '5', gold: '6', gray: '7', dark_gray: '8', blue: '9', green: 'a', aqua: 'b', red: 'c', light_purple: 'd', yellow: 'e', white: 'f' };
const FMT = { k: 'o', l: 'b', m: 's', n: 'u', o: 'i' };
const colourOf = v => !v ? null : /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : NAMED[v] ? CODE[NAMED[v]] : null;
function legacy(text, base, out) {   // text with § codes (also §x§r§r§g§g§b§b hex colours)
  let st = { ...base }, buf = '';
  const push = () => { if (buf) out.push({ t: buf, ...st }); buf = ''; };
  const t = String(text);
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '§' && i + 1 < t.length) {
      const k = t[i + 1].toLowerCase();
      if (k === 'x' && /^(§[0-9a-f]){6}$/i.test(t.slice(i + 2, i + 14))) { push(); st = { c: '#' + t.slice(i + 2, i + 14).replace(/§/g, '').toLowerCase() }; i += 13; continue; }
      if (CODE[k]) { push(); st = { c: CODE[k] }; i++; continue; }          // a colour code also clears bold/italic...
      if (FMT[k]) { push(); st = { ...st, [FMT[k]]: true }; i++; continue; }
      if (k === 'r') { push(); st = { ...base }; i++; continue; }
    }
    buf += t[i];
  }
  push();
}
function component(c, base, out) {
  if (c == null) return;
  if (typeof c === 'string' || typeof c === 'number') return legacy(c, base, out);
  if (Array.isArray(c)) return c.forEach(x => component(x, base, out));
  const st = { ...base }; const col = colourOf(c.color); if (col) st.c = col;
  for (const [k, f] of [['bold', 'b'], ['italic', 'i'], ['underlined', 'u'], ['strikethrough', 's'], ['obfuscated', 'o']]) if (c[k] !== undefined) st[f] = !!c[k];
  if (c.text !== undefined) legacy(c.text, st, out); else if (c.translate) legacy(c.translate, st, out);
  if (Array.isArray(c.extra)) c.extra.forEach(x => component(x, st, out));
}
const motdParts = d => { const out = []; component(d, { c: '#aaaaaa' }, out); return out.map(p => Object.fromEntries(Object.entries(p).filter(([, v]) => v))).filter(p => p.t).slice(0, 80); };

async function javaPing(host, port, timeout = 5000) {
  if (!port) { try { const srv = await dns.resolveSrv('_minecraft._tcp.' + host); if (srv[0]) { host = srv[0].name; port = srv[0].port; } } catch {} }
  port = port || 25565;
  return new Promise((resolve, reject) => {
    const t0 = Date.now(), sock = net.connect({ host, port, timeout });
    let buf = Buffer.alloc(0), done = false;
    const fail = e => { if (done) return; done = true; sock.destroy(); reject(e); };
    sock.on('timeout', () => fail(new Error('No answer from the server')));
    sock.on('error', fail);
    sock.on('connect', () => {
      const p = Buffer.alloc(2); p.writeUInt16BE(port);
      sock.write(packet(varint(0), varint(767), mcString(host), p, varint(1)));   // handshake, next state = status
      sock.write(packet(varint(0)));                                                 // status request
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const len = readVarint(buf, 0); if (!len || buf.length < len[1] + len[0]) return;
      const id = readVarint(buf, len[1]); const sl = id && readVarint(buf, id[1]); if (!sl) return;
      try {
        const j = JSON.parse(buf.slice(sl[1], sl[1] + sl[0]).toString('utf8'));
        done = true; sock.destroy();
        const icon = typeof j.favicon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(j.favicon) && j.favicon.length < 120000 ? j.favicon : '';
        resolve({ online: true, edition: 'java', version: strip(j.version && j.version.name), motd: strip(plain(j.description)), motdParts: motdParts(j.description), icon,
          players: { online: (j.players && j.players.online) || 0, max: (j.players && j.players.max) || 0, sample: ((j.players && j.players.sample) || []).map(p => strip(p.name)).filter(n => n && !/^§/.test(n)).slice(0, 12) },
          ms: Date.now() - t0 });
      } catch (e) { fail(e); }
    });
  });
}

const MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
async function bedrockPing(host, port = 19132, timeout = 5000) {
  const addr = net.isIP(host) ? host : (await dns.lookup(host)).address;
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket(net.isIPv6(addr) ? 'udp6' : 'udp4'), t0 = Date.now();
    const timer = setTimeout(() => { s.close(); reject(new Error('No answer from the server')); }, timeout);
    s.on('error', e => { clearTimeout(timer); s.close(); reject(e); });
    s.on('message', msg => {
      if (msg[0] !== 0x1c) return;
      clearTimeout(timer); s.close();
      const len = msg.readUInt16BE(33), f = msg.slice(35, 35 + len).toString('utf8').split(';');   // MCPE;motd;protocol;version;online;max;id;motd2;mode;...
      const parts = []; legacy(f[1] || '', { c: '#aaaaaa' }, parts); if (f[7]) { parts.push({ t: '\n', c: '#aaaaaa' }); legacy(f[7], { c: '#aaaaaa' }, parts); }
      resolve({ online: true, edition: 'bedrock', motd: strip(f[1]) + (f[7] ? '\n' + strip(f[7]) : ''), motdParts: parts, icon: '', version: f[3] || '', players: { online: +f[4] || 0, max: +f[5] || 0, sample: [] }, ms: Date.now() - t0 });
    });
    const p = Buffer.alloc(33); p[0] = 0x01; p.writeBigUInt64BE(BigInt(Date.now()), 1); MAGIC.copy(p, 9); p.writeBigUInt64BE(2n, 25);
    s.send(p, port, addr);
  });
}

// "play.example.com", "play.example.com:25566", "1.2.3.4 19132" -> { host, port }
function parseAddr(raw) {
  const s = String(raw || '').trim().replace(/^[a-z]+:\/\//i, '');
  const m = /^\[?([a-z0-9.\-:]+?)\]?(?:[:\s]+(\d{2,5}))?$/i.exec(s);
  return m ? { host: m[1].toLowerCase(), port: m[2] ? +m[2] : 0 } : null;
}

const cache = new Map();
async function status(addr, edition) {
  const a = parseAddr(addr); if (!a) return { online: false, error: 'No server address set' };
  const key = edition + ' ' + a.host + ':' + a.port, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30e3) return hit.data;
  let data;
  try { data = edition === 'bedrock' ? await bedrockPing(a.host, a.port || 19132) : await javaPing(a.host, a.port); }
  catch (e) { data = { online: false, edition, error: e.code === 'ENOTFOUND' ? 'Server address not found' : e.code === 'ECONNREFUSED' ? 'Server is offline' : e.message }; }
  data.checkedAt = new Date().toISOString();
  cache.set(key, { at: Date.now(), data });
  return data;
}
module.exports = { status, javaPing, bedrockPing, parseAddr };
