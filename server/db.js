// One JSON file holds everything. Every write goes to a temp file first and is then renamed over the real one,
// so a crash mid-write can never leave a half-written database. A dated copy is kept every day (data/backups).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const cfg = require('./env');

const FILE = path.join(cfg.DATA, 'db.json'), BACKUPS = path.join(cfg.DATA, 'backups'), UPLOADS = path.join(cfg.DATA, 'uploads');
fs.mkdirSync(BACKUPS, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const id = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

function seed() {
  const t = now();
  return {
    version: 1,
    events: [
      { id: id(), slug: '7-days-civilization', title: '7 Days Civilization', type: 'survival', status: 'cancelled',
        dateLabel: 'December 2025', start: null, end: null, days: 7, daysPlayed: 3, slots: 0, teamSize: 1, prize: '', banner: '',
        summary: 'Seven days to build a civilization from nothing. Only 3 of 7 days were played before a hosting failure and data loss ended it.',
        rules: '', notes: 'Lesson learned: the server and its world were lost with the host. Everything is now backed up daily and kept off the game host.',
        results: [], createdAt: t, updatedAt: t },
      { id: id(), slug: 'hide-and-seek', title: 'Hide and Seek', type: 'minigame', status: 'completed',
        dateLabel: 'November 2026', start: null, end: null, days: 0, daysPlayed: 0, slots: 0, teamSize: 1, prize: '', banner: '',
        summary: 'Creators hid, seekers hunted, and the whole event ran start to finish.',
        rules: '', notes: '', results: [], createdAt: t, updatedAt: t },
    ],
    registrations: [], media: [], profiles: [], announcements: [], users: {},
  };
}

let db;
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch (e) {
  if (fs.existsSync(FILE)) { // never silently replace a database that exists but cannot be read
    const bad = FILE + '.unreadable-' + Date.now();
    fs.copyFileSync(FILE, bad);
    console.error('db.json could not be read; a copy was kept at ' + bad + '. Restore from data/backups.');
    process.exit(1);
  }
  db = seed();
  save();
}
for (const k of ['events', 'registrations', 'media', 'profiles', 'announcements', 'applications', 'messages']) db[k] = db[k] || [];
db.users = db.users || {};
db.settings = db.settings || {};

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}

function backup(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `db-${stamp}${reason ? '-' + reason : ''}.json`;
  fs.copyFileSync(FILE, path.join(BACKUPS, name));
  const all = listBackups();
  for (const old of all.slice(cfg.backupKeep)) fs.unlinkSync(path.join(BACKUPS, old.name));
  return name;
}
function listBackups() {
  return fs.readdirSync(BACKUPS).filter(f => /^db-.*\.json$/.test(f))
    .map(f => ({ name: f, size: fs.statSync(path.join(BACKUPS, f)).size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}
function dailyBackup() {
  const today = new Date().toISOString().slice(0, 10);
  if (!listBackups().some(b => b.name.startsWith('db-' + today))) console.log('Backup saved: ' + backup('daily'));
}
dailyBackup();
setInterval(dailyBackup, 60 * 60 * 1000).unref();

module.exports = { get db() { return db; }, save, backup, listBackups, id, now, FILE, BACKUPS, UPLOADS };
