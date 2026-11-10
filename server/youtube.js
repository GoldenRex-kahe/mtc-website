// Reads public YouTube pages: checks a channel link is a real channel, gets its name and logo, and parses video links.
const fs = require('fs'), path = require('path');
const cfg = require('./env');

const HEAD = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };
const meta = (html, re) => { const m = html.match(re); return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') : null; };
const fail = (m, status = 400) => { throw Object.assign(new Error(m), { status }); };

async function channelInfo(raw) {
  let u; try { u = new URL(/^https?:/i.test(raw) ? raw : 'https://' + raw); } catch { fail('That is not a valid link.'); }
  if (!/^(www\.|m\.)?youtube\.com$/i.test(u.hostname)) fail('Only youtube.com channel links are accepted.');
  if (!/^\/(@|channel\/|c\/|user\/)/i.test(u.pathname)) fail('Use the channel link (looks like youtube.com/@name), not a video link.');
  const r = await fetch(u.origin + u.pathname, { headers: HEAD, redirect: 'follow' });
  if (!r.ok) fail('YouTube answered ' + r.status + ' for that link. Check it opens in a browser.');
  const html = await r.text();
  const name = meta(html, /<meta property="og:title" content="([^"]+)"/), image = meta(html, /<meta property="og:image" content="([^"]+)"/);
  const canon = meta(html, /<link rel="canonical" href="([^"]+)"/) || meta(html, /<meta property="og:url" content="([^"]+)"/);
  if (!name || !image || !canon || !/youtube\.com\/(channel\/|@)/i.test(canon)) fail('That page does not look like a YouTube channel (no channel name or logo found).');
  return { name, image: image.replace(/=s\d+[^&]*$/, '=s240-c-k-c0x00ffffff-no-rj'), url: canon.replace(/^http:/, 'https:') };
}

async function saveLogo(imageUrl, key) {
  const img = await fetch(imageUrl, { headers: HEAD });
  if (!img.ok || !/^image\//.test(img.headers.get('content-type') || '')) fail('Could not download the channel logo.');
  const dir = path.join(cfg.SITE, 'logos');
  fs.mkdirSync(dir, { recursive: true });
  const file = String(key).replace(/[^a-z0-9_.-]/gi, '_') + '.jpg';
  fs.writeFileSync(path.join(dir, file), Buffer.from(await img.arrayBuffer()));
  return '/logos/' + file;
}

// Verify a channel and store it for a Discord user in creators-extra.json (the file the Creators page reads).
const EXTRA = path.join(cfg.ROOT, 'creators-extra.json');
const readExtras = () => { try { return JSON.parse(fs.readFileSync(EXTRA, 'utf8')); } catch { return {}; } };
const writeExtras = o => { const tmp = EXTRA + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n'); fs.renameSync(tmp, EXTRA); };
async function verifyCreator(key, link, { mc, socials } = {}) {
  key = /^\d{15,}$/.test(key) ? key : String(key).toLowerCase();
  const info = await channelInfo(link);
  // one channel, one creator: refuse if another member already shows this channel
  const owner = Object.entries(readExtras()).find(([k, v]) => k !== key && k[0] !== '_' && v.verified && v.socials && v.socials.youtube === info.url);
  if (owner) throw Object.assign(new Error(`This channel (${info.name}) is already on the Creators page for @${owner[0]}. Hide it there first.`), { status: 409 });
  const logo = await saveLogo(info.image, key);
  const extras = readExtras(), prev = extras[key] || {};
  const cleanSocials = {};
  for (const [k, v] of Object.entries({ ...(prev.socials || {}), ...(socials || {}) })) if (v) cleanSocials[k] = v;
  extras[key] = { ...prev, verified: true, verifiedAt: new Date().toISOString().slice(0, 10), channelName: info.name, logo,
    ...(mc ? { mc } : {}), socials: { ...cleanSocials, youtube: info.url } };
  writeExtras(extras);
  return { key, ...info, logo };
}
function unverifyCreator(key) {
  key = /^\d{15,}$/.test(key) ? key : String(key).toLowerCase();
  const extras = readExtras(); if (!extras[key]) return false;
  extras[key].verified = false; writeExtras(extras); return true;
}

// youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/live/ID -> ID
function videoId(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  const h = u.hostname.replace(/^(www|m)\./, '');
  let v = null;
  if (h === 'youtu.be') v = u.pathname.slice(1);
  else if (h === 'youtube.com') v = u.searchParams.get('v') || (u.pathname.match(/^\/(shorts|live|embed)\/([^/]+)/) || [])[2];
  return v && /^[\w-]{11}$/.test(v) ? v : null;
}

module.exports = { channelInfo, saveLogo, verifyCreator, unverifyCreator, readExtras, writeExtras, videoId };
