// Seasonal look for the website (snow, Diwali lights, Pongal petals...). Admin > Events > Seasonal theme picks one,
// or "auto" picks by the date (India time). The pages ask /api/theme and draw the effects (test-site/assets/seasonal.js).
module.exports = function install(x) {
  const { on, D, store, err, readBody, needAdmin } = x;
  const THEMES = {
    winter: 'Winter', christmas: 'Christmas', newyear: 'New Year', pongal: 'Pongal', diwali: 'Diwali', halloween: 'Halloween', monsoon: 'Monsoon',
  };
  // Diwali moves every year
  const DIWALI = { 2026: '11-08', 2027: '10-29', 2028: '10-17', 2029: '11-05', 2030: '10-26' };
  const ist = (t = Date.now()) => new Date(t + 330 * 6e4);   // read the UTC fields of this as India time
  function autoTheme(t = Date.now()) {
    const d = ist(t), y = d.getUTCFullYear(), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();   // e.g. 1225
    const between = (a, b) => md >= a && md <= b;
    if (md >= 1231 || md <= 102) return 'newyear';
    if (between(113, 117)) return 'pongal';
    if (DIWALI[y]) { const dw = Date.UTC(y, +DIWALI[y].slice(0, 2) - 1, +DIWALI[y].slice(3)), now = Date.UTC(y, d.getUTCMonth(), d.getUTCDate()), days = (now - dw) / 864e5;
      if (days >= -4 && days <= 2) return 'diwali'; }
    if (between(1220, 1230)) return 'christmas';
    if (between(1024, 1031)) return 'halloween';
    if (md >= 1201 || md <= 210) return 'winter';
    if (between(1015, 1130)) return 'monsoon';
    return '';
  }
  const S = () => (D().settings.theme = D().settings.theme || { mode: 'auto' });
  const active = () => { const m = S().mode; return m === 'auto' ? autoTheme() : THEMES[m] ? m : ''; };

  on('GET', '/api/theme', async () => ({ key: active() }));
  on('GET', '/api/admin/theme', async req => { needAdmin(req); return { mode: S().mode, active: active(), auto: autoTheme(), themes: THEMES }; });
  on('PUT', '/api/admin/theme', async req => {
    needAdmin(req); const b = await readBody(req);
    if (!(b.mode === 'auto' || b.mode === 'off' || THEMES[b.mode])) throw err(400, 'Pick a season, Auto or Off.');
    S().mode = b.mode; store.save(); return { ok: true, mode: b.mode, active: active() };
  });
  return { autoTheme, NO_LOG: ['GET /api/theme'] };
};
