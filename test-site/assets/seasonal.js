/* Seasonal look: snow, rain, Diwali sparks, Pongal petals, Halloween bats, New Year fireworks.
   Chosen in Admin > Events > Seasonal theme (or by the date). Pixel-style, never blocks clicks, pauses when the tab is hidden.
   Visitors can hide it with the small button; people who ask for less motion get the decorations without moving parts.
   ?season=diwali in the address previews one season on that page. */
(() => {
  if (location.pathname === '/admin.html') return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const NAMES = { winter: 'WINTER', christmas: 'CHRISTMAS', newyear: 'NEW YEAR', pongal: 'PONGAL', diwali: 'DIWALI', halloween: 'HALLOWEEN', monsoon: 'MONSOON' };
  const preview = new URLSearchParams(location.search).get('season');
  let key = '', canvas = null, raf = 0, parts = [], bursts = [], last = 0;

  // ---------------------------------------------------------------- styles (added once)
  const css = `
  .sz-fx{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:45}
  .sz-edge{position:absolute;left:0;right:0;bottom:-7px;height:8px;pointer-events:none;z-index:2}
  .sz-snow{height:6px;bottom:-6px;background:repeating-linear-gradient(90deg,#fff 0 18px,#eaf4ff 18px 30px)}
  .sz-snow::after{content:"";position:absolute;left:0;right:0;top:6px;height:4px;background:repeating-linear-gradient(90deg,#fff 0 6px,#0000 6px 24px,#eaf4ff 24px 30px,#0000 30px 48px)}
  .sz-lights{position:absolute;left:0;right:0;bottom:-10px;height:12px;display:flex;justify-content:space-around;pointer-events:none;z-index:2}
  .sz-lights i{width:7px;height:9px;border-radius:2px 2px 4px 4px;box-shadow:0 0 8px currentColor;background:currentColor;animation:szBlink 1.6s steps(1) infinite}
  .sz-lights i:nth-child(4n+2){animation-delay:.4s}.sz-lights i:nth-child(4n+3){animation-delay:.8s}.sz-lights i:nth-child(4n){animation-delay:1.2s}
  .sz-diyas i{width:12px;height:6px;border-radius:0 0 7px 7px;background:#a0521c;box-shadow:0 0 0 #0000;color:#ffb627;animation:none;position:relative}
  .sz-diyas i::after{content:"";position:absolute;left:4px;top:-7px;width:4px;height:7px;border-radius:50% 50% 40% 40%;background:#ffd166;box-shadow:0 0 10px 3px #ffb627aa;animation:szFlame .9s ease-in-out infinite alternate}
  @keyframes szBlink{50%{opacity:.25}}
  @keyframes szFlame{to{transform:scale(.8,1.15) translateY(-1px);opacity:.85}}
  .sz-sun{position:fixed;right:-140px;top:-140px;width:420px;height:420px;border-radius:50%;pointer-events:none;z-index:1;background:radial-gradient(#ffd16655,#ff9f1c22 45%,#0000 70%)}
  .sz-btn{position:fixed;left:12px;bottom:12px;z-index:46;display:inline-flex;align-items:center;gap:7px;padding:7px 10px;font:8px 'Press Start 2P',monospace;letter-spacing:.06em;color:#f7ebd8;background:#0d0804cc;border:2px solid #000;box-shadow:inset 0 -2px 0 #f7931e;cursor:pointer;opacity:.75}
  .sz-btn:hover,.sz-btn:focus-visible{opacity:1}.sz-btn i{width:8px;height:8px;background:#5fd35f}.sz-btn.off i{background:#a63a2b}
  @media(prefers-reduced-motion:reduce){.sz-lights i,.sz-diyas i::after{animation:none}}
  @media print{.sz-fx,.sz-btn,.sz-edge,.sz-lights,.sz-sun{display:none}}`;
  const addCss = () => { if (document.getElementById('szCss')) return; const s = document.createElement('style'); s.id = 'szCss'; s.textContent = css; document.head.appendChild(s); };

  // ---------------------------------------------------------------- decorations (on the navbar)
  function decorate() {
    document.querySelectorAll('.sz-edge,.sz-lights,.sz-sun').forEach(x => x.remove());
    const nav = document.getElementById('nav'); const host = nav && (nav.firstElementChild || nav);
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const strip = (cls, n, colors) => { const d = document.createElement('div'); d.className = cls; d.setAttribute('aria-hidden', 'true');
      d.innerHTML = Array.from({ length: n }, (_, i) => `<i style="color:${colors[i % colors.length]}"></i>`).join(''); host && host.appendChild(d); };
    if (key === 'winter' || key === 'christmas') { const e = document.createElement('div'); e.className = 'sz-edge sz-snow'; e.setAttribute('aria-hidden', 'true'); host && host.appendChild(e); }
    if (key === 'christmas') strip('sz-lights', Math.round(innerWidth / 46), ['#ff3b30', '#ffd60a', '#30d158', '#64d2ff']);
    if (key === 'newyear') strip('sz-lights', Math.round(innerWidth / 46), ['#ffd60a', '#ff9f0a', '#bf5af2', '#64d2ff']);
    if (key === 'diwali') strip('sz-lights sz-diyas', Math.round(innerWidth / 70), ['#ffb627']);
    if (key === 'pongal') { const s = document.createElement('div'); s.className = 'sz-sun'; s.setAttribute('aria-hidden', 'true'); document.body.appendChild(s); }
  }

  // ---------------------------------------------------------------- moving parts
  const R = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function spawn(W, H, anywhere) {
    const y = anywhere ? R(0, H) : -10;
    switch (key) {
      case 'winter': case 'christmas': return { t: 'snow', x: R(0, W), y, s: Math.round(R(2, 5)), vy: R(.4, 1.3), vx: 0, ph: R(0, 6.3), c: Math.random() < .3 ? '#dcecff' : '#ffffff' };
      case 'monsoon': return { t: 'rain', x: R(-100, W), y, s: R(10, 22), vy: R(9, 15), vx: 2.2, c: 'rgba(160,200,255,.35)' };
      case 'pongal': return { t: 'petal', x: R(0, W), y, s: Math.round(R(3, 6)), vy: R(.6, 1.4), vx: R(-.3, .3), ph: R(0, 6.3), c: pick(['#ff9f1c', '#ffbf00', '#ffd166', '#e85d04']) };
      case 'halloween': return Math.random() < .12 ? { t: 'bat', x: Math.random() < .5 ? -20 : W + 20, y: R(40, H * .6), s: 3, vy: 0, vx: 0, ph: R(0, 6.3), dir: 0 }
        : { t: 'ember', x: R(0, W), y, s: Math.round(R(2, 4)), vy: R(.5, 1.2), vx: R(-.4, .4), ph: R(0, 6.3), c: pick(['#ff7b00', '#ffb347', '#9d4edd']) };
      case 'diwali': return { t: 'spark', x: R(0, W), y: anywhere ? R(H * .3, H) : H + 10, s: Math.round(R(2, 3)), vy: -R(.5, 1.4), vx: R(-.2, .2), ph: R(0, 6.3), c: pick(['#ffd166', '#ffb627', '#ff9f1c']), life: R(.4, 1) };
      case 'newyear': return { t: 'confetti', x: R(0, W), y, s: Math.round(R(3, 5)), vy: R(.8, 1.8), vx: R(-.5, .5), ph: R(0, 6.3), c: pick(['#ffd60a', '#ff375f', '#30d158', '#64d2ff', '#bf5af2']) };
    }
    return null;
  }
  function burst(W, H) {
    const x = R(W * .15, W * .85), y = R(H * .12, H * .45), cols = key === 'diwali' ? ['#ffd166', '#ff9f1c', '#fff3b0'] : ['#ffd60a', '#ff375f', '#64d2ff', '#bf5af2', '#30d158'], c = pick(cols), n = 34;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, v = R(1.4, 3.2); bursts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: Math.random() < .3 ? pick(cols) : c }); }
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !canvas) return;
    const dt = Math.min(3, (t - last) / 16.7 || 1); last = t;
    const g = canvas.getContext('2d'), W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, W, H);
    const want = Math.round(Math.min(160, W * H / (key === 'monsoon' ? 9000 : key === 'halloween' ? 26000 : 14000)));
    while (parts.length < want) { const p = spawn(W, H, parts.length < want * .7 && !frame.started); if (!p) break; parts.push(p); }
    frame.started = true;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.ph = (p.ph || 0) + .03 * dt;
      if (p.t === 'bat') {
        p.dir = p.dir || (p.x < 0 ? 1 : -1); p.x += p.dir * 2.2 * dt; p.y += Math.sin(p.ph * 3) * .8 * dt;
        const up = Math.sin(p.ph * 12) > 0, s = p.s; g.fillStyle = '#1a0f24';
        g.fillRect(p.x - s, p.y - s, s * 2, s * 2);                                   // body
        g.fillRect(p.x - s * 4, p.y - (up ? s * 2 : 0), s * 3, s); g.fillRect(p.x + s, p.y - (up ? s * 2 : 0), s * 3, s);   // wings
        g.fillStyle = '#ff7b00'; g.fillRect(p.x - s * .6, p.y - s * .5, 1.5, 1.5); g.fillRect(p.x + s * .2, p.y - s * .5, 1.5, 1.5);
        if (p.x < -60 || p.x > W + 60) parts.splice(i, 1);
        continue;
      }
      p.y += p.vy * dt; p.x += (p.vx + (p.t === 'rain' ? 0 : Math.sin(p.ph) * .5)) * dt;
      if (p.t === 'rain') { g.strokeStyle = p.c; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 1.6, p.y - p.s); g.stroke(); }
      else if (p.t === 'spark') { p.life -= .004 * dt; g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c; g.fillRect(p.x, p.y, p.s, p.s); g.globalAlpha = 1; }
      else if (p.t === 'confetti' || p.t === 'petal') { const w = p.s * Math.abs(Math.cos(p.ph * 2)) + 1; g.fillStyle = p.c; g.fillRect(p.x, p.y, w, p.s); }
      else { g.fillStyle = p.c; g.globalAlpha = p.t === 'ember' ? .8 : .9; g.fillRect(p.x, p.y, p.s, p.s); g.globalAlpha = 1; }
      if (p.y > H + 20 || p.y < -30 || (p.life !== undefined && p.life <= 0)) parts.splice(i, 1);
    }
    if ((key === 'newyear' || key === 'diwali') && Math.random() < (key === 'newyear' ? .012 : .006) * dt) burst(W, H);
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += .035 * dt; b.vx *= .985; b.life -= .012 * dt;
      g.globalAlpha = Math.max(0, b.life); g.fillStyle = b.c; g.fillRect(b.x, b.y, 2.5, 2.5); g.globalAlpha = 1;
      if (b.life <= 0) bursts.splice(i, 1);
    }
  }
  function size() { if (!canvas) return; canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; }
  function startFx() {
    stopFx(); if (reduce || !key) return;
    canvas = document.createElement('canvas'); canvas.className = 'sz-fx'; canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas); size(); parts = []; bursts = []; frame.started = false; last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function stopFx() { cancelAnimationFrame(raf); if (canvas) canvas.remove(); canvas = null; parts = []; bursts = []; }
  addEventListener('resize', () => { size(); if (key) decorate(); });

  // ---------------------------------------------------------------- the visitor's on / off button
  function button() {
    let b = document.querySelector('.sz-btn');
    if (!key) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'sz-btn'; document.body.appendChild(b);
      b.onclick = () => { const off = store.get('mtcFxOff') !== '1'; store.set('mtcFxOff', off ? '1' : '0'); apply(key); }; }
    const off = store.get('mtcFxOff') === '1';
    b.classList.toggle('off', off); b.innerHTML = `<i aria-hidden="true"></i>${NAMES[key] || ''} ${off ? 'OFF' : 'ON'}`;
    b.setAttribute('aria-label', (off ? 'Show' : 'Hide') + ' the ' + (NAMES[key] || 'seasonal').toLowerCase() + ' effects');
  }

  function apply(k) {
    key = NAMES[k] ? k : '';
    addCss(); document.documentElement.dataset.season = key;
    const off = store.get('mtcFxOff') === '1';
    if (key && !off) { decorate(); startFx(); } else { stopFx(); document.querySelectorAll('.sz-edge,.sz-lights,.sz-sun').forEach(x => x.remove()); }
    button();
  }
  const start = () => {
    if (preview && (NAMES[preview] || preview === 'off')) return apply(preview === 'off' ? '' : preview);
    let cached = null; try { cached = JSON.parse(store.get('mtcTheme') || 'null'); } catch {}
    if (cached && Date.now() - cached.at < 6 * 3600e3) apply(cached.key);   // no wait on the next page
    fetch('/api/theme').then(r => r.ok ? r.json() : null).then(j => { if (!j) return; store.set('mtcTheme', JSON.stringify({ key: j.key, at: Date.now() })); if (!cached || cached.key !== j.key) apply(j.key); }).catch(() => {});
  };
  // the navbar is drawn by nav.js, so wait a moment for it
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 50)); else setTimeout(start, 50);
})();
