// Reads .env and fills in secrets that must exist (session key, admin password) the first time the server runs.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, '.env');

const env = {};
let text = '';
try { text = fs.readFileSync(FILE, 'utf8'); } catch {}
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const add = {};
if (!env.SESSION_SECRET) add.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
if (!env.ADMIN_PASSWORD) add.ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
if (Object.keys(add).length) {
  fs.appendFileSync(FILE, (text && !text.endsWith('\n') ? '\n' : '') + Object.entries(add).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  Object.assign(env, add);
  if (add.ADMIN_PASSWORD) console.log('Created an admin password in .env (ADMIN_PASSWORD).');
}

// The bot token's first part is the application (client) ID, so OAuth only needs the client secret on top.
let clientId = env.DISCORD_CLIENT_ID;
if (!clientId && env.DISCORD_TOKEN) { try { clientId = Buffer.from(env.DISCORD_TOKEN.split('.')[0], 'base64').toString('utf8'); } catch {} }

// Pterodactyl (and most game panels) hand the server its port in SERVER_PORT and expect it to listen on every address
const panel = !!(process.env.SERVER_PORT || process.env.P_SERVER_UUID || process.env.P_SERVER_LOCATION);
const port = +(env.PORT || process.env.PORT || process.env.SERVER_PORT || 4500);
const host = env.HOST || process.env.HOST || (panel ? '0.0.0.0' : '127.0.0.1');
module.exports = {
  ROOT,
  SITE: path.join(ROOT, 'test-site'),
  DATA: env.DATA_DIR ? path.resolve(ROOT, env.DATA_DIR) : path.join(ROOT, 'data'),
  port, host,
  publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  token: env.DISCORD_TOKEN,
  guild: env.DISCORD_GUILD_ID,
  creatorRole: env.DISCORD_CREATOR_ROLE_ID,
  clientId: /^\d{15,}$/.test(clientId || '') ? clientId : null,
  clientSecret: env.DISCORD_CLIENT_SECRET || null,
  announceChannel: env.DISCORD_ANNOUNCE_CHANNEL_ID || null,
  // channel new members land in when they use an approved applicant's invite (falls back to the server's welcome channel)
  inviteChannel: env.DISCORD_INVITE_CHANNEL_ID || null,
  adminIds: (env.ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  adminRoleIds: (env.ADMIN_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  adminPassword: env.ADMIN_PASSWORD,
  sessionSecret: env.SESSION_SECRET,
  requireCreatorRole: (env.REQUIRE_CREATOR_ROLE || 'true') !== 'false',
  backupKeep: +(env.BACKUP_KEEP || 30),
  // event archive: big files can be stored on this server (uses its bandwidth) or kept elsewhere as links (default)
  archiveUploads: /^(on|true|1|yes)$/i.test(env.ARCHIVE_UPLOADS || ''),
  inviteUrl: /^https:\/\/(discord\.gg|discord\.com\/invite)\//.test(env.DISCORD_INVITE_URL || '') ? env.DISCORD_INVITE_URL : '',
};
