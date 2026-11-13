// The Discord bot's own profile picture (avatar) and banner, changed from Admin > Events > Bot profile.
// Discord limits how often a bot may change these, so its answer is passed straight back (no silent waiting).
module.exports = function install(x) {
  const { on, cfg, err, readBody, needAdmin } = x;
  const API = 'https://discord.com/api/v10';
  const headers = json => ({ Authorization: 'Bot ' + cfg.token, 'User-Agent': 'DiscordBot (https://mtc.kovaihost.cloud, 1.0)', ...(json ? { 'Content-Type': 'application/json' } : {}) });
  const cdn = (kind, id, hash, size) => hash ? `https://cdn.discordapp.com/${kind}/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=${size}` : '';
  const IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

  async function me() {
    if (!cfg.token) throw err(400, 'The bot token is not set in .env.');
    const r = await fetch(API + '/users/@me', { headers: headers(), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(502, 'Discord said: ' + (j.message || r.status));
    return { id: j.id, name: j.global_name || j.username, username: j.username, avatar: cdn('avatars', j.id, j.avatar, 512), banner: cdn('banners', j.id, j.banner, 1024),
      accent: j.accent_color != null ? '#' + Number(j.accent_color).toString(16).padStart(6, '0') : '' };
  }

  on('GET', '/api/admin/bot-profile', async req => { needAdmin(req); return { bot: await me() }; });

  on('PUT', '/api/admin/bot-profile', async req => {
    needAdmin(req);
    const b = await readBody(req, 12 * 1024 * 1024), body = {};
    for (const k of ['avatar', 'banner']) {
      if (b[k] === undefined) continue;
      if (b[k] === null) { body[k] = null; continue; }   // remove it
      if (typeof b[k] !== 'string' || !IMG.test(b[k])) throw err(400, `The ${k} must be a PNG, JPG, WEBP or GIF picture.`);
      if (b[k].length > 10.5 * 1024 * 1024 * 4 / 3) throw err(400, `The ${k} is over Discord's 10 MB limit.`);
      body[k] = b[k];
    }
    if (!Object.keys(body).length) throw err(400, 'Pick a new avatar or banner first.');
    const r = await fetch(API + '/users/@me', { method: 'PATCH', headers: headers(true), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) throw err(429, `Discord only lets a bot change its profile a few times an hour. Try again in ${Math.ceil((j.retry_after || 60) / 60)} minute(s).`);
    if (!r.ok) {
      const detail = j.errors ? JSON.stringify(j.errors).match(/"message":"([^"]+)"/) : null;
      throw err(400, 'Discord said: ' + ((detail && detail[1]) || j.message || r.status));
    }
    return { ok: true, bot: await me() };
  });
};
