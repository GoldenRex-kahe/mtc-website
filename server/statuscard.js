// Draws the website's "Server status" card as a PNG for Discord (Discord cannot show web pages, only pictures).
// No libraries: the Press Start 2P pixel font (fonts/PressStart2P.ttf, SIL Open Font License) is read and filled
// directly, server icons are decoded from PNG, and the result is written as a PNG with Node's zlib.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// ---------------------------------------------------------------- font: TrueType outlines (Press Start 2P is made of straight lines)
const FONT = (() => {
  const b = fs.readFileSync(path.join(__dirname, 'fonts', 'PressStart2P.ttf')), n = b.readUInt16BE(4), t = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; t[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) }; }
  const upem = b.readUInt16BE(t.head.off + 18), locFmt = b.readInt16BE(t.head.off + 50), nGlyphs = b.readUInt16BE(t.maxp.off + 4), nHm = b.readUInt16BE(t.hhea.off + 34);
  const loca = i => locFmt ? b.readUInt32BE(t.loca.off + i * 4) : b.readUInt16BE(t.loca.off + i * 2) * 2;
  const adv = i => b.readUInt16BE(t.hmtx.off + Math.min(i, nHm - 1) * 4);
  // cmap format 4 (Unicode BMP)
  const cm = t.cmap.off, map = {};
  for (let i = 0, nt = b.readUInt16BE(cm + 2); i < nt; i++) {
    const sub = cm + b.readUInt32BE(cm + 4 + i * 8 + 4); if (b.readUInt16BE(sub) !== 4) continue;
    const segX2 = b.readUInt16BE(sub + 6), ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = b.readUInt16BE(ends + s * 2), start = b.readUInt16BE(starts + s * 2), delta = b.readInt16BE(deltas + s * 2), ro = b.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g; if (!ro) g = (c + delta) & 0xffff; else { const gi = b.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2); g = gi ? (gi + delta) & 0xffff : 0; }
        if (g) map[c] = g;
      }
    }
    break;
  }
  const cache = {};
  function glyph(g) {
    if (cache[g]) return cache[g];
    const off = t.glyf.off + loca(g), len = loca(g + 1) - loca(g), out = { adv: adv(g), contours: [] };
    if (len > 0 && g < nGlyphs) {
      const nc = b.readInt16BE(off);
      if (nc > 0) {
        const endPts = []; for (let i = 0; i < nc; i++) endPts.push(b.readUInt16BE(off + 10 + i * 2));
        const nPts = endPts[nc - 1] + 1; let p = off + 10 + nc * 2; p += 2 + b.readUInt16BE(p);
        const flags = []; while (flags.length < nPts) { const f = b[p++]; flags.push(f); if (f & 8) { let r = b[p++]; while (r--) flags.push(f); } }
        const xs = [], ys = []; let v = 0;
        for (const f of flags) { if (f & 2) { const d = b[p++]; v += f & 16 ? d : -d; } else if (!(f & 16)) { v += b.readInt16BE(p); p += 2; } xs.push(v); }
        v = 0;
        for (const f of flags) { if (f & 4) { const d = b[p++]; v += f & 32 ? d : -d; } else if (!(f & 32)) { v += b.readInt16BE(p); p += 2; } ys.push(v); }
        let s = 0; for (const e of endPts) { const c = []; for (let i = s; i <= e; i++) c.push([xs[i], ys[i]]); out.contours.push(c); s = e + 1; }
      }
    }
    return (cache[g] = out);
  }
  return { upem, glyphOf: ch => { const g = map[ch.codePointAt(0)]; return g ? glyph(g) : null; } };
})();

// ---------------------------------------------------------------- canvas
function canvas(w, h, bg) {
  const px = new Uint8ClampedArray(w * h * 4);
  const set = (x, y, c, a = 1) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4, k = a * (c[3] ?? 1);
    px[i] = px[i] * (1 - k) + c[0] * k; px[i + 1] = px[i + 1] * (1 - k) + c[1] * k; px[i + 2] = px[i + 2] * (1 - k) + c[2] * k; px[i + 3] = 255; };
  const rect = (x, y, rw, rh, c) => { for (let j = Math.max(0, y | 0); j < Math.min(h, (y + rh) | 0); j++) for (let i = Math.max(0, x | 0); i < Math.min(w, (x + rw) | 0); i++) set(i, j, c); };
  const frame = (x, y, rw, rh, t, c) => { rect(x, y, rw, t, c); rect(x, y + rh - t, rw, t, c); rect(x, y, t, rh, c); rect(x + rw - t, y, t, rh, c); };
  // text in the pixel font; size = pixels per em (multiples of 8 stay perfectly crisp)
  function text(str, x, y, size, c) {
    const sc = size / FONT.upem; let cx = x;
    for (const ch of [...String(str)]) {
      const g = FONT.glyphOf(ch) || FONT.glyphOf('?'); if (!g) continue;
      if (g.contours.length) {
        // even-odd fill at pixel centres; y in font units goes up, baseline at y + size
        const polys = g.contours.map(cn => cn.map(([u, v]) => [cx + u * sc, y + size - v * sc]));
        let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
        for (const pl of polys) for (const [u, v] of pl) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); minX = Math.min(minX, u); maxX = Math.max(maxX, u); }
        for (let j = Math.floor(minY); j < Math.ceil(maxY); j++) {
          const yc = j + .5, xsx = [];
          for (const pl of polys) for (let k = 0; k < pl.length; k++) { const [x1, y1] = pl[k], [x2, y2] = pl[(k + 1) % pl.length]; if ((y1 <= yc) !== (y2 <= yc)) xsx.push(x1 + (yc - y1) / (y2 - y1) * (x2 - x1)); }
          xsx.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xsx.length; k += 2) for (let i = Math.ceil(xsx[k] - .5); i < Math.ceil(xsx[k + 1] - .5); i++) set(i, j, c);
        }
      }
      cx += g.adv * sc;
    }
    return cx - x;
  }
  const textWidth = (str, size) => [...String(str)].reduce((a, ch) => a + ((FONT.glyphOf(ch) || FONT.glyphOf('?') || { adv: 0 }).adv * size / FONT.upem), 0);
  function image(img, x, y, dw, dh) { if (!img) return; for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) { const sx = Math.floor(i * img.w / dw), sy = Math.floor(j * img.h / dh), k = (sy * img.w + sx) * 4;
    set(x + i, y + j, [img.px[k], img.px[k + 1], img.px[k + 2], img.px[k + 3] / 255]); } }
  return { w, h, px, rect, frame, text, textWidth, image, fill: () => rect(0, 0, w, h, bg) };
}

// ---------------------------------------------------------------- PNG in / out
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function encodePng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePng(buf) {
  try {
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    let p = 8, w, h, depth, type, inter, pal = null, trns = null; const idat = [];
    while (p < buf.length) { const len = buf.readUInt32BE(p), tp = buf.toString('latin1', p + 4, p + 8), d = buf.slice(p + 8, p + 8 + len); p += 12 + len;
      if (tp === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; } else if (tp === 'PLTE') pal = d; else if (tp === 'tRNS') trns = d; else if (tp === 'IDAT') idat.push(d); else if (tp === 'IEND') break; }
    if (depth !== 8 || inter || w > 2048 || h > 2048) return null;
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]; if (!ch) return null;
    const data = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) { const f = data[y * (stride + 1)], row = data.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let i = 0; i < stride; i++) { const a = i >= ch ? out[y * stride + i - ch] : 0, b = y ? out[(y - 1) * stride + i] : 0, c = y && i >= ch ? out[(y - 1) * stride + i - ch] : 0;
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c), paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[y * stride + i] = (row[i] + [0, a, b, (a + b) >> 1, paeth][f]) & 255; } }
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const s = out.slice(i * ch, i * ch + ch), o = i * 4;
      if (type === 6) { px.set(s, o); } else if (type === 2) { px.set(s, o); px[o + 3] = 255; } else if (type === 0) { px[o] = px[o + 1] = px[o + 2] = s[0]; px[o + 3] = 255; }
      else if (type === 4) { px[o] = px[o + 1] = px[o + 2] = s[0]; px[o + 3] = s[1]; }
      else { const k = s[0]; px[o] = pal[k * 3]; px[o + 1] = pal[k * 3 + 1]; px[o + 2] = pal[k * 3 + 2]; px[o + 3] = trns && k < trns.length ? trns[k] : 255; } }
    return { w, h, px };
  } catch { return null; }
}

// ---------------------------------------------------------------- the card (same look as the event page)
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1];
const C = { bg: hex('#1c140c'), panel: hex('#0d0804'), entry: hex('#0b0705'), black: hex('#000000'), ink: hex('#f7ebd8'), soft: hex('#b3a18b'), white: hex('#ffffff'),
  green: hex('#5fd35f'), greenD: hex('#2f6b2a'), red: hex('#ff8a7a'), redD: hex('#6b231a'), orange: hex('#f7931e'), blue: hex('#7fc4ff'), blueD: hex('#4aa3ff'), purple: hex('#d9bcff'), purpleD: hex('#c79bff'), yellow: hex('#ffd23f'), tile: hex('#1a110a') };
const LOGO = (() => { try { return decodePng(fs.readFileSync(path.join(__dirname, '..', 'test-site', 'assets', 'logo.png'))); } catch { return null; } })();
const ascii = s => String(s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();   // the pixel font has Latin letters only

function render({ title, online, ended, closed, java, bedrock, bedrockPort, extras = [], notes = '', status = {}, when = new Date() }) {
  const W = 960, P = 28, inner = W - P * 2, s = status || {}, pl = s.players || { online: 0, max: 0 };
  const rows = [];   // addresses are not drawn: Discord shows them as copyable text under the picture
  const small = [];
  // height first
  let H = P + 40 + 120 + 16 + rows.length * 76 + (small.length ? 76 : 0) + (online ? 54 + 92 : 0) + 50;
  const cv = canvas(W, H, C.bg); cv.fill();
  const AMB = hex('#f2c230'), AMBD = hex('#7a5a12');
  const edge = online ? C.greenD : ended ? hex('#555555') : closed ? AMBD : C.redD;
  cv.frame(0, 0, W, H, 4, C.black); cv.frame(4, 4, W - 8, H - 8, 3, edge);
  let y = P;
  cv.text('SERVER STATUS', P, y, 24, C.ink);
  const pill = online ? 'ONLINE' : ended ? 'ENDED' : closed ? 'CLOSED' : 'OFFLINE', pw = cv.textWidth(pill, 16) + 54;
  cv.rect(W - P - pw, y - 4, pw, 34, C.panel); cv.frame(W - P - pw, y - 4, pw, 34, 3, C.black); cv.rect(W - P - pw + 3, y + 26, pw - 6, 4, online ? C.greenD : closed ? AMBD : C.redD);
  cv.rect(W - P - pw + 14, y + 6, 12, 12, online ? C.green : closed ? AMB : hex('#a63a2b')); cv.text(pill, W - P - pw + 36, y + 4, 16, online ? C.green : closed ? AMB : C.red);
  y += 48;
  // server-list entry: icon, name, MOTD in its colours, player count
  cv.rect(P, y, inner, 112, C.entry); cv.frame(P, y, inner, 112, 3, C.black);
  const icon = s.icon ? decodePng(Buffer.from(String(s.icon).split(',')[1] || '', 'base64')) : null;
  cv.image(icon || LOGO, P + 14, y + 14, 84, 84);
  cv.text(ascii(title).slice(0, 34), P + 116, y + 16, 16, C.white);
  if (online) {
    const lines = [[]]; for (const part of s.motdParts || []) String(part.t).split('\n').forEach((t, k) => { if (k) lines.push([]); if (t) lines[lines.length - 1].push({ ...part, t }); });
    lines.slice(0, 2).forEach((ln, li) => { let x = P + 116; ln.forEach((part, pi) => { let t = String(part.t).normalize('NFKD').replace(/[^ -~]/g, '').replace(/ {2,}/g, ' '); if (pi === 0) t = t.replace(/^ +/, ''); if (!t || x > W - P - 20) return; x += cv.text(t, x, y + 46 + li * 24, 16, part.c && /^#[0-9a-f]{6}$/i.test(part.c) ? hex(part.c) : C.soft); }); });
    const cnt = `${pl.online}/${pl.max}`; cv.text(cnt, W - P - 16 - cv.textWidth(cnt, 16), y + 16, 16, C.white);
  } else if (closed) {
    const amber = hex('#f2c230');
    if (closed.over) cv.text('All play days are done.', P + 116, y + 50, 16, C.soft);
    else {
      const at = closed.opens.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).toUpperCase();
      cv.text(`OPENS ${at} - DAY ${closed.day}${closed.days ? ' OF ' + closed.days : ''}`, P + 116, y + 46, 16, amber);
      cv.text(`DAILY HOURS ${closed.hours.toUpperCase()}  -  PLEASE BE READY`, P + 116, y + 74, 8, C.soft);
    }
  } else cv.text(ended ? 'This event has ended.' : 'Cannot reach the server right now.', P + 116, y + 50, 16, ended ? C.soft : C.red);
  y += 128;
  // addresses
  for (const [label, val, col, bar] of rows) {
    cv.rect(P, y, inner, 64, C.panel); cv.frame(P, y, inner, 64, 3, C.black); cv.rect(P + 3, y + 3, 5, 58, bar);
    cv.text(label, P + 22, y + 12, 8, C.soft); cv.text(ascii(val).slice(0, 40), P + 22, y + 30, 24, col); y += 76;
  }
  if (small.length) {
    const gw = (inner - (small.length - 1) * 12) / small.length;
    small.forEach(([label, val, col, bar], i) => { const x = P + i * (gw + 12); cv.rect(x, y, gw, 64, C.panel); cv.frame(x, y, gw, 64, 3, C.black); cv.rect(x + 3, y + 3, 5, 58, bar);
      cv.text(label.slice(0, Math.floor((gw - 30) / 8)), x + 20, y + 12, 8, C.soft); cv.text(val.slice(0, Math.floor((gw - 30) / 24)), x + 20, y + 30, 24, col); });
    y += 76;
  }
  if (online) {
    // capacity bar + tiles
    const pct = pl.max ? Math.min(100, Math.round(pl.online / pl.max * 100)) : 0;
    cv.rect(P, y, inner, 42, C.panel); cv.frame(P, y, inner, 42, 3, C.black); if (pct) cv.rect(P + 3, y + 3, (inner - 6) * pct / 100, 36, [76, 154, 42, .45]);
    cv.text(pl.online ? `${pl.online} PLAYER${pl.online === 1 ? '' : 'S'} IN GAME` : 'NOBODY IN GAME YET', P + 16, y + 14, 16, C.ink);
    const pt = pct + '% FULL'; cv.text(pt, W - P - 16 - cv.textWidth(pt, 16), y + 14, 16, C.soft); y += 54;
    const tiles = [['VERSION', ascii(s.version) || '-'], ['EDITION', java && bedrock ? 'JAVA + BEDROCK' : bedrock && !java ? 'BEDROCK' : 'JAVA'], ['SLOTS LEFT', String(Math.max(0, pl.max - pl.online))]];
    const tw = (inner - 24) / 3;
    tiles.forEach(([l, v], i) => { const x = P + i * (tw + 12); cv.rect(x, y, tw, 78, C.tile); cv.frame(x, y, tw, 78, 3, C.black); cv.rect(x + 3, y + 72, tw - 6, 3, hex('#2a1d12'));
      cv.text(l, x + 16, y + 16, 8, C.soft); cv.text(v.slice(0, Math.floor((tw - 32) / 16)), x + 16, y + 40, 16, C.ink); });
    y += 92;
  }
  const t = when.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).toUpperCase();
  cv.text(`UPDATED ${t}  -  MTC.KOVAIHOST.CLOUD`, P, y + 8, 8, C.soft);
  return encodePng(W, H, cv.px);
}
module.exports = { render, decodePng };
