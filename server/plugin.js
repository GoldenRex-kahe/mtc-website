// The MTC Server Control plugin (Minecraft server side) asks this website every few seconds:
// "is the server open right now?" The answer comes from the event's daily server hours, or from the
// OPEN NOW / CLOSE NOW buttons in admin. The plugin then kicks players at closing time, blocks them until
// the next opening (staff can always join), and shows the matching MOTD in the server list.
const crypto = require('crypto');
const fs = require('fs'), path = require('path');

module.exports = function install(x) {
  const { on, D, store, cfg, err, readBody, needAdmin, evById, evBy, sessionOf } = x;
  const S = () => D().settings;
  const P = () => (S().plugin = S().plugin || {});
  const JAR = path.join(__dirname, '..', 'plugin', 'MTCServerControl.jar');
  if (!P().key) { P().key = crypto.randomBytes(24).toString('base64url'); store.save(); }

  const IST = 'Asia/Kolkata';
  const time = iso => new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' }).toUpperCase();
  const dayKey = t => new Date(t).toLocaleDateString('en-CA', { timeZone: IST });
  const whenDay = iso => dayKey(iso) === dayKey(Date.now()) ? 'today' : dayKey(iso) === dayKey(Date.now() + 864e5) ? 'tomorrow'
    : 'on ' + new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'short' });
  const hm = s => { const [h, m] = s.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const clean = s => String(s || '').replace(/§/g, '').normalize('NFKC');

  // which event the server belongs to: the one named in the plugin config, else the live one, else the next one
  function pickEvent(slug) {
    if (slug) return evBy(slug) || null;
    const evs = D().events.filter(e => e.status !== 'draft');
    return evs.find(e => e.status === 'live')
      || evs.filter(e => ['open', 'soon'].includes(e.status)).sort((a, b) => new Date(a.start || 8e15) - new Date(b.start || 8e15))[0] || null;
  }

  // the answer for the plugin. Texts use Minecraft § colour codes.
  function stateOf(e) {
    if (!e) return { managed: false, open: true };
    const title = clean(e.title).slice(0, 40), ctl = e.serverControl || 'auto';
    const ss = e.status === 'live' ? sessionOf(e) : null;
    const dayTxt = ss ? `Day ${ss.day}${ss.days ? ' of ' + ss.days : ''}` : '';
    let open, why;
    if (ctl === 'open') { open = true; why = 'forced-open'; }
    else if (ctl === 'closed') { open = false; why = 'forced-closed'; }
    else if (e.status !== 'live') { open = false; why = ['completed', 'unsuccessful', 'cancelled'].includes(e.status) ? 'ended' : 'not-live'; }
    else if (ss && !ss.open) { open = false; why = ss.over ? 'all-days-done' : 'outside-hours'; }
    else { open = true; why = ss ? 'inside-hours' : 'live'; }

    const L1 = `§6§lMTC §8» §e${title}`;
    let motd, kick, deny;
    if (open) {
      motd = `${L1}\n§a§lOPEN NOW${ss ? ` §8| §f${dayTxt} §8| §7until §f${time(ss.closesAt)}` : ' §8| §7Join and have fun!'}`;
    } else {
      let line, msg;
      if (why === 'outside-hours') {
        line = `§c§lCLOSED §8| §7Opens §f${whenDay(ss.opensAt)} ${time(ss.opensAt)} §8| §e${dayTxt}`;
        msg = `§7The server is closed right now.\n\n§fIt opens §e${whenDay(ss.opensAt)} at ${time(ss.opensAt)}§f for §e${dayTxt}§f.\n§7Daily hours: §f${hm(ss.from)} - ${hm(ss.to)}\n\n§aPlease be ready on time!`;
      } else if (why === 'all-days-done' || why === 'ended') {
        line = '§7§lEVENT FINISHED §8| §7Thanks for playing!';
        msg = `§7${title} has finished.\n\n§fThank you for playing! §7Results and videos are on the website.`;
      } else if (why === 'not-live') {
        line = e.start ? `§6§lSOON §8| §7Opens when the event starts §8| §f${new Date(e.start).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' })}` : '§6§lSOON §8| §7Opens when the event starts';
        msg = `§7The server opens when §e${title}§7 starts.\n\n§fWatch the MTC Discord for the announcement.`;
      } else {
        line = '§c§lCLOSED §8| §7Back soon';
        msg = '§7The server is closed by the MTC staff for now.\n\n§fWatch the MTC Discord for updates.';
      }
      motd = `${L1}\n${line}`;
      kick = `§6§lMTC EVENTS\n\n§c§lSERVER CLOSED\n\n${msg}\n\n§8${(cfg.publicUrl || '').replace(/^https?:\/\//, '')}`;
      deny = kick;
    }
    return { managed: true, open, why, control: ctl, event: { slug: e.slug, title: e.title, status: e.status },
      day: ss ? ss.day : null, days: ss ? ss.days : null, opensAt: ss ? ss.opensAt : null, closesAt: ss && open && ctl === 'auto' ? ss.closesAt : null,
      hours: ss ? `${hm(ss.from)} - ${hm(ss.to)}` : '', motd, kick: kick || '', deny: deny || '',
      closedForStaff: '§eThe server is now closed for players. §7You are staff, so you can stay.', now: new Date().toISOString() };
  }

  // ---- the plugin's question (needs the plugin key)
  on('GET', '/api/plugin/state', async (req, res, p, url) => {
    const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')), want = Buffer.from(P().key);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw err(401, 'Wrong plugin key. Copy it from Admin > Events > Server control.');
    const q = k => url.searchParams.get(k) || '';
    P().seen = { at: new Date().toISOString(), players: +q('players') || 0, max: +q('max') || 0, mc: q('mc').slice(0, 60), v: q('v').slice(0, 20), slug: q('event').slice(0, 80), staffOnline: +q('staff') || 0 };
    return stateOf(pickEvent(q('event')));
  });

  // ---- admin
  on('GET', '/api/admin/plugin', async (req, res, p, url) => {
    needAdmin(req);
    const seen = P().seen || null, slug = seen && seen.slug, e = pickEvent(slug);
    return { key: P().key, seen, connected: !!(seen && Date.now() - new Date(seen.at) < 90e3), jar: fs.existsSync(JAR),
      state: stateOf(e), events: D().events.filter(x => x.status !== 'draft').map(x => ({ id: x.id, title: x.title, status: x.status, control: x.serverControl || 'auto', hours: x.hoursFrom && x.hoursTo ? `${hm(x.hoursFrom)} - ${hm(x.hoursTo)}` : '' })) };
  });
  on('PUT', '/api/admin/events/:id/server-control', async (req, res, p) => {
    needAdmin(req); const e = evById(p.id); if (!e) throw err(404, 'Event not found.');
    const b = await readBody(req); if (!['auto', 'open', 'closed'].includes(b.control)) throw err(400, 'Pick auto, open or closed.');
    e.serverControl = b.control; store.save(); return { ok: true, state: stateOf(e) };
  });
  on('POST', '/api/admin/plugin/new-key', async req => {
    needAdmin(req); P().key = crypto.randomBytes(24).toString('base64url'); store.save(); return { ok: true, key: P().key };
  });
  on('GET', '/api/admin/plugin/jar', async (req, res) => {
    needAdmin(req); if (!fs.existsSync(JAR)) throw err(404, 'The plugin file is missing on the website server.');
    res.writeHead(200, { 'Content-Type': 'application/java-archive', 'Content-Disposition': 'attachment; filename="MTCServerControl.jar"', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(JAR));
  });
  return { stateOf, NO_LOG: ['GET /api/plugin/state'] };
};
