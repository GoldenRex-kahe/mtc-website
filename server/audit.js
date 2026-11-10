// Activity log: every change made through the website (by admins and members) is written to data/activity.log
// and, when a log channel is set, posted to Discord (queued, about one message a second).
const fs = require('fs'), path = require('path');
const cfg = require('./env');
const FILE = path.join(cfg.DATA, 'activity.log');

let sendFn = null, channelFn = () => '';
const queue = []; let busy = false;
function init({ send, channel }) { sendFn = send; channelFn = channel; }

async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const job = queue.shift(), ch = channelFn();
    if (ch && sendFn) { try { await sendFn(ch, job); } catch (e) { console.warn('activity log to Discord failed:', e.message); } }
    await new Promise(r => setTimeout(r, 1100));
  }
  busy = false;
}

const COLORS = { create: 0x4c9a2a, update: 0x3a78b8, delete: 0xa63a2b, approve: 0x4c9a2a, reject: 0xa63a2b, discord: 0x5865f2, login: 0x8e44ad, member: 0xF7931E, security: 0xc0392b, other: 0x777777 };

// entry: { who: {id, name, avatar, admin}, kind, icon, title, details: [[label, value]], target }
function log(entry) {
  const rec = { at: new Date().toISOString(), ...entry };
  try { fs.appendFileSync(FILE, JSON.stringify(rec) + '\n'); } catch {}
  const who = entry.who || {};
  const embed = {
    author: { name: `${who.name || 'Someone'}${who.admin ? ' (admin)' : ''}${who.username ? ' · @' + who.username : ''}`.slice(0, 256), ...(who.avatar && /^https:/.test(who.avatar) ? { icon_url: who.avatar } : {}) },
    title: `${entry.icon || '•'} ${entry.title}`.slice(0, 256),
    color: COLORS[entry.kind] || COLORS.other,
    fields: (entry.details || []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').slice(0, 12)
      .map(([k, v]) => ({ name: String(k).slice(0, 256), value: String(v).slice(0, 1000), inline: String(v).length < 40 })),
    footer: { text: 'MTC website activity' + (who.id && /^\d+$/.test(who.id) ? ' · ID ' + who.id : '') },
    timestamp: rec.at,
  };
  if (queue.length < 500) { queue.push({ embeds: [embed], allowed_mentions: { parse: [] } }); pump(); }
}
function recent(n = 200) {
  try {
    const st = fs.statSync(FILE), len = Math.min(st.size, 400 * 1024), fd = fs.openSync(FILE, 'r'), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter(Boolean).slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  } catch { return []; }
}
module.exports = { init, log, recent };
