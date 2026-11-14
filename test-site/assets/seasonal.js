/* MTC seasonal look: winter, Christmas, New Year, Pongal, Diwali, Halloween, monsoon.
   Chosen in Admin > Events > Seasonal theme (or by the date). Three parts:
   1) a canvas of moving effects (snow, rain, lanterns, fireworks...) that never blocks clicks and pauses when the tab is hidden,
   2) decorations hanging from the menu bar (garlands, ornaments, toran, icicles...), drawn as SVG,
   3) soft colour layers (aurora, frost, warm glow) and a once-a-day greeting.
   Visitors can switch it off with the round button; people who ask for less motion get still decorations.
   ?season=diwali in the address previews one season on that page. */
(() => {
  if (location.pathname === '/admin.html') return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const istNow = () => new Date(Date.now() + 330 * 6e4);
  const YEAR = (() => { const d = istNow(); return d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(); })();
  const SEASONS = {
    winter:    { name: 'Winter',    title: 'WINTER IS HERE',          sub: 'Stay warm and build together',     c: '#9fd8ff', c2: '#6c8cff' },
    christmas: { name: 'Christmas', title: 'MERRY CHRISTMAS',         sub: 'கிறிஸ்துமஸ் நல்வாழ்த்துகள்',          c: '#ff5a5a', c2: '#30d158' },
    newyear:   { name: 'New Year',  title: 'HAPPY NEW YEAR ' + YEAR,  sub: 'இனிய புத்தாண்டு நல்வாழ்த்துகள்',       c: '#ffd60a', c2: '#bf5af2' },
    pongal:    { name: 'Pongal',    title: 'HAPPY PONGAL',            sub: 'இனிய பொங்கல் நல்வாழ்த்துகள்',         c: '#ffb000', c2: '#4caf50' },
    diwali:    { name: 'Diwali',    title: 'HAPPY DIWALI',            sub: 'இனிய தீபாவளி நல்வாழ்த்துகள்',         c: '#ffb627', c2: '#ff5e3a' },
    halloween: { name: 'Halloween', title: 'HAPPY HALLOWEEN',         sub: 'Watch out for creepers tonight',   c: '#ff7b00', c2: '#9d4edd' },
    monsoon:   { name: 'Monsoon',   title: 'MONSOON SEASON',          sub: 'Rainy days, cosy builds',          c: '#7ab8ff', c2: '#3d7bd9' },
  };
  const preview = new URLSearchParams(location.search).get('season');
  const R = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const seeded = s => () => (s = (s * 16807) % 2147483647) / 2147483647;   // the same "random" on every page load
  const f1 = n => Math.round(n * 10) / 10;
  let key = '';

  // ================================================================ styles
  const CSS = `
  .sz-fx{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:45}
  .sz-layer{position:fixed;inset:0;pointer-events:none;z-index:44}
  .sz-aurora{inset:0 0 auto 0;height:62vh;opacity:.3;mix-blend-mode:screen;filter:blur(22px);background-size:170% 100%;
    background-image:radial-gradient(38% 55% at 18% 8%,#2cf5b8,#2cf5b800 70%),radial-gradient(34% 50% at 52% 0,#6c8cff,#6c8cff00 70%),radial-gradient(40% 60% at 86% 10%,#b56cff,#b56cff00 70%);
    -webkit-mask:linear-gradient(#000,#0000);mask:linear-gradient(#000,#0000);animation:szAurora 24s ease-in-out infinite alternate}
  @keyframes szAurora{to{background-position:100% 0;opacity:.42}}
  .sz-frost{background:radial-gradient(ellipse at 50% 45%,#0000 58%,#cfe8ff12 78%,#e6f4ff2e 100%)}
  .sz-warm{background:radial-gradient(ellipse at 50% 40%,#0000 55%,#ff8c2812 80%,#ff6a0024 100%)}
  .sz-gloom{background:radial-gradient(ellipse at 50% 40%,#0000 48%,#2a0a3a30 80%,#12051c66 100%)}
  .sz-storm{background:radial-gradient(ellipse at 50% 30%,#0000 50%,#0a1a3322 80%,#05101f55 100%)}
  .sz-sun{position:fixed;right:-20vmax;top:-20vmax;width:56vmax;height:56vmax;border-radius:50%;pointer-events:none;z-index:44;opacity:.6;mix-blend-mode:screen;
    background:radial-gradient(circle,#ffd76a 0,#ffb00050 16%,#ff8c0000 58%),repeating-conic-gradient(#ffcf5a1f 0 5deg,#0000 5deg 14deg);
    -webkit-mask:radial-gradient(circle,#000 25%,#0000 68%);mask:radial-gradient(circle,#000 25%,#0000 68%);animation:szSpin 120s linear infinite}
  @keyframes szSpin{to{transform:rotate(360deg)}}
  .sz-deco{position:absolute;left:0;right:0;top:100%;height:120px;margin-top:-3px;pointer-events:none;z-index:2}
  .sz-deco svg{position:absolute;left:0;top:0;overflow:visible}
  .sz-solid{transition:opacity .5s,transform .5s}
  .mtcnav.clear .sz-solid{opacity:0;transform:translateY(-8px)}
  .sz-swing{transform-box:view-box;animation:szSwing var(--d,3.4s) ease-in-out var(--dl,0s) infinite alternate}
  @keyframes szSwing{from{transform:rotate(calc(var(--amp,5deg) * -1))}to{transform:rotate(var(--amp,5deg))}}
  .sz-orn{pointer-events:visiblePainted;cursor:grab}
  .sz-tw{animation:szTw var(--d,2.4s) ease-in-out var(--dl,0s) infinite}
  @keyframes szTw{0%,100%{opacity:.18}50%{opacity:1}}
  .sz-flick{animation:szFlick 1.7s steps(1) var(--dl,0s) infinite}
  @keyframes szFlick{0%,100%{opacity:1}31%{opacity:.7}34%{opacity:1}63%{opacity:.82}66%{opacity:1}}
  .sz-bob{transform-box:view-box;animation:szBob var(--d,5s) ease-in-out var(--dl,0s) infinite}
  .sz-thread{transform-box:view-box;animation:szThread var(--d,5s) ease-in-out var(--dl,0s) infinite}
  @keyframes szBob{0%,100%{transform:translateY(0)}50%{transform:translateY(22px)}}
  @keyframes szThread{0%,100%{transform:scaleY(1)}50%{transform:scaleY(var(--k,1.5))}}
  .sz-drop{transform-box:fill-box;transform-origin:50% 0;animation:szDrop var(--d,4s) ease-in var(--dl,0s) infinite}
  @keyframes szDrop{0%{transform:scale(.25);opacity:0}12%{opacity:1}68%{transform:scale(1) translateY(0);opacity:1}100%{transform:scale(1) translateY(48px);opacity:0}}
  .sz-glint{animation:szGlint var(--d,5s) ease-in-out var(--dl,0s) infinite}
  @keyframes szGlint{0%,78%,100%{opacity:0}88%{opacity:1}}
  .sz-caps{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:30}
  .sz-hello{position:fixed;left:50%;top:86px;z-index:47;transform:translateX(-50%);display:grid;justify-items:center;gap:5px;padding:13px 24px 12px;max-width:92vw;text-align:center;
    background:#0d0804db;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--c) 55%,#0000);border-radius:14px;
    box-shadow:0 0 0 1px #000,0 14px 44px #000b,0 0 40px color-mix(in srgb,var(--c) 28%,#0000);cursor:pointer;animation:szHello .75s cubic-bezier(.2,1.25,.4,1) both}
  .sz-hello b{font:11px/1.6 'Press Start 2P',monospace;letter-spacing:.08em;background:linear-gradient(90deg,var(--c),#fff 50%,var(--c2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .sz-hello span{font:600 13px/1.45 Archivo,'MTC Tamil',system-ui,sans-serif;color:#dccdb6}
  .sz-hello.out{animation:szHelloOut .5s ease-in both}
  @keyframes szHello{from{opacity:0;transform:translate(-50%,-16px) scale(.94)}}
  @keyframes szHelloOut{to{opacity:0;transform:translate(-50%,-12px) scale(.97)}}
  .sz-btn{position:fixed;left:14px;bottom:14px;z-index:46;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;padding:0;cursor:pointer;color:var(--c);
    background:radial-gradient(circle at 35% 30%,#2a1c10,#0d0804);border:1px solid color-mix(in srgb,var(--c) 55%,#000);box-shadow:0 6px 18px #0009,0 0 18px color-mix(in srgb,var(--c) 32%,#0000);transition:transform .2s,opacity .2s,box-shadow .2s}
  .sz-btn:hover,.sz-btn:focus-visible{transform:scale(1.08);box-shadow:0 6px 18px #0009,0 0 26px color-mix(in srgb,var(--c) 50%,#0000)}
  .sz-btn svg{width:22px;height:22px}
  .sz-btn.off{opacity:.6;color:#8a7a68;box-shadow:0 6px 18px #0009}
  .sz-btn.off::after{content:"";position:absolute;width:28px;height:2px;border-radius:2px;background:currentColor;transform:rotate(-45deg)}
  .sz-btn em{position:absolute;left:54px;white-space:nowrap;font:8px/1.4 'Press Start 2P',monospace;font-style:normal;color:#f7ebd8;background:#0d0804ee;padding:7px 9px;border:1px solid #000;opacity:0;transform:translateX(-4px);transition:.2s;pointer-events:none}
  .sz-btn:hover em,.sz-btn:focus-visible em{opacity:1;transform:none}
  @media(max-width:760px){.sz-hello{padding:10px 16px}.sz-hello b{font-size:9px}.sz-hello span{font-size:12px}.sz-aurora{height:45vh}.sz-btn{width:40px;height:40px}}
  @media(prefers-reduced-motion:reduce){.sz-aurora,.sz-sun,.sz-swing,.sz-tw,.sz-flick,.sz-bob,.sz-thread,.sz-drop,.sz-glint,.sz-hello{animation:none!important}.sz-drop{opacity:0}}
  @media print{.sz-caps,.sz-fx,.sz-layer,.sz-deco,.sz-hello,.sz-btn,.sz-sun{display:none}}`;
  const addCss = () => { if (document.getElementById('szCss')) return; const s = document.createElement('style'); s.id = 'szCss'; s.textContent = CSS; document.head.appendChild(s); };

  // ================================================================ 1) the moving effects (canvas)
  const DPR = Math.min(1.5, window.devicePixelRatio || 1);
  let cv = null, g = null, W = 0, H = 0, raf = 0, lastT = 0, sys = null, scrollKick = 0, lastY = scrollY;
  const mouse = { x: -1e4, y: -1e4 };
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; } }, { passive: true });
  document.addEventListener('mouseleave', () => { mouse.x = mouse.y = -1e4; });
  addEventListener('scroll', () => { scrollKick += Math.max(-40, Math.min(40, scrollY - lastY)) * .05; lastY = scrollY; }, { passive: true });

  const cache = {};
  const hexA = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
  function radial(id, size, stops) {
    if (cache[id]) return cache[id];
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'), h = size / 2, gr = x.createRadialGradient(h, h, 0, h, h, h);
    stops.forEach(([o, col]) => gr.addColorStop(o, col)); x.fillStyle = gr; x.fillRect(0, 0, size, size);
    return (cache[id] = c);
  }
  const glow = col => radial('g' + col, 64, [[0, '#ffffff'], [.12, col], [.4, hexA(col, .35)], [1, hexA(col, 0)]]);
  const softDot = () => radial('soft', 32, [[0, 'rgba(255,255,255,1)'], [.45, 'rgba(255,255,255,.85)'], [1, 'rgba(255,255,255,0)']]);
  function crystal() {
    if (cache.crystal) return cache.crystal;
    const s = 80, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
    x.translate(s / 2, s / 2); x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineCap = 'round'; x.shadowColor = '#cfeaff'; x.shadowBlur = 8;
    for (let i = 0; i < 6; i++) {
      x.rotate(Math.PI / 3); x.lineWidth = 2.4; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -32); x.stroke();
      x.lineWidth = 1.8; x.beginPath(); x.moveTo(0, -14); x.lineTo(-8, -22); x.moveTo(0, -14); x.lineTo(8, -22); x.moveTo(0, -24); x.lineTo(-5, -29); x.moveTo(0, -24); x.lineTo(5, -29); x.stroke();
    }
    x.beginPath(); x.arc(0, 0, 3, 0, 7); x.fillStyle = '#fff'; x.fill();
    return (cache.crystal = c);
  }
  function droplet() {   // a raindrop on the glass: clear body, dark lower rim, bright highlight
    if (cache.drop) return cache.drop;
    const s = 40, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'), m = s / 2;
    x.beginPath(); x.arc(m, m, 15, 0, 7); x.fillStyle = 'rgba(190,220,255,.10)'; x.fill();
    x.lineWidth = 2; x.strokeStyle = 'rgba(0,0,0,.32)'; x.beginPath(); x.arc(m, m, 14, .15 * Math.PI, .85 * Math.PI); x.stroke();
    x.lineWidth = 1.4; x.strokeStyle = 'rgba(255,255,255,.65)'; x.beginPath(); x.arc(m, m, 13, 1.15 * Math.PI, 1.6 * Math.PI); x.stroke();
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(m - 6, m - 7, 2.4, 0, 7); x.fill();
    return (cache.drop = c);
  }

  // ---- snow: three depths, big crystals up close, wind, pushed by the mouse
  function snowSys(density, crystals) {
    const P = []; let init = true, wind = 0;
    const make = any => { const z = Math.pow(Math.random(), 1.7), big = crystals && z > .9;
      return { x: R(-30, W + 30), y: any ? R(-30, H) : R(-80, -10), z, big, r: big ? R(7, 13) : .7 + z * 3.3, vy: .3 + z * 1.2, ph: R(0, 6.28), sw: R(.4, 1.2), rot: R(0, 6.28), vr: R(-.012, .012), vx: 0, vy2: 0, a: big ? .8 : .22 + z * .7 }; };
    return { frame(dt, t) {
      const want = Math.round(Math.min(280, W * H / density)); while (P.length < want) P.push(make(init)); init = false; if (P.length > want) P.length = want;
      const target = Math.sin(t * .00021) * .7 + Math.sin(t * .00097) * .25; wind += (target - wind) * .01 * dt;
      const sd = softDot(), cr = crystals ? crystal() : null, damp = Math.pow(.94, dt);
      for (const p of P) {
        p.ph += .013 * dt * p.sw;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 14400) { const d = Math.sqrt(d2) || 1, f = (1 - d / 120) * .55 * (.3 + p.z); p.vx += dx / d * f * dt; p.vy2 += dy / d * f * .5 * dt; }
        p.vx *= damp; p.vy2 *= damp;
        p.x += (wind * (.35 + p.z * 1.2) + Math.sin(p.ph) * .4 * p.sw + p.vx) * dt;
        p.y += (p.vy + p.vy2) * dt - scrollKick * (.2 + p.z * .8);
        if (p.y > H + 20 || p.x < -70 || p.x > W + 70 || p.y < -140) Object.assign(p, make(false));
        if (p.big) { p.rot += p.vr * dt; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = p.a; g.drawImage(cr, -p.r, -p.r, p.r * 2, p.r * 2); g.restore(); }
        else { const s = p.r * 3; g.globalAlpha = p.a; g.drawImage(sd, p.x - s / 2, p.y - s / 2, s, s); }
      }
      g.globalAlpha = 1;
    } };
  }

  // ---- rain with depth, splashes, drops on the glass, and the odd lightning flash
  function rainSys() {
    const P = [], SPL = [], DROPS = []; let init = true, nextBolt = performance.now() + R(7000, 13000), bolt = null;
    const make = any => { const z = Math.pow(Math.random(), 1.4); return { x: R(-60, W + 160), y: any ? R(-H, H) : R(-220, -20), z, len: 10 + z * 28, vy: 11 + z * 14, a: .07 + z * .3, w: .5 + z * 1.3 }; };
    const glass = () => ({ x: R(0, W), y: R(0, H), r: R(2.5, 8), vy: 0, slide: Math.random() < .3, wait: R(30, 700) });
    const lean = -.22;
    return { frame(dt, t) {
      const want = Math.round(Math.min(340, W * H / 4200)); while (P.length < want) P.push(make(init)); init = false;
      g.lineCap = 'round';
      for (const p of P) {
        p.y += p.vy * dt; p.x += p.vy * lean * dt;
        g.strokeStyle = `rgba(175,208,255,${p.a})`; g.lineWidth = p.w; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.len * lean, p.y - p.len); g.stroke();
        if (p.y > H) { if (p.z > .55 && SPL.length < 140) for (let k = 0; k < 2; k++) SPL.push({ x: p.x, y: H - 2, vx: R(-1.6, 1.6), vy: R(-2.8, -1.2), life: 1 }); Object.assign(p, make(false)); }
        else if (p.x < -120) Object.assign(p, make(false));
      }
      g.fillStyle = 'rgba(195,218,255,.75)';
      for (let i = SPL.length - 1; i >= 0; i--) { const s = SPL[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += .22 * dt; s.life -= .045 * dt; g.globalAlpha = Math.max(0, s.life); g.fillRect(s.x, s.y, 1.6, 1.6); if (s.life <= 0) SPL.splice(i, 1); }
      const want2 = Math.round(Math.min(40, W * H / 28000)); while (DROPS.length < want2) DROPS.push(glass());
      const ds = droplet();
      for (const d of DROPS) {
        if (d.slide) { if (d.wait > 0) d.wait -= dt; else { d.vy = Math.min(2.4, d.vy + .03 * dt); d.y += d.vy * dt; d.x += Math.sin(d.y * .05) * .15; } }
        if (d.y > H + 20) Object.assign(d, glass(), { y: R(-20, H * .3), slide: true, vy: 0 });
        g.globalAlpha = .9; g.drawImage(ds, d.x - d.r, d.y - d.r * 1.15, d.r * 2, d.r * 2.3);
      }
      g.globalAlpha = 1;
      if (t > nextBolt) { bolt = makeBolt(); nextBolt = t + R(12000, 26000); }
      if (bolt) { drawBolt(bolt, dt); if (bolt.life <= 0) bolt = null; }
    } };
  }
  function makeBolt() {
    const pts = []; let x = R(W * .15, W * .85), y = -10; const end = R(H * .35, H * .6);
    while (y < end) { pts.push([x, y]); x += R(-28, 28); y += R(14, 34); } pts.push([x, y]);
    const br = []; for (let i = 2; i < pts.length - 2; i += 3) if (Math.random() < .6) { let [bx, by] = pts[i]; const b = [[bx, by]], dir = Math.random() < .5 ? -1 : 1; for (let k = 0; k < 4; k++) { bx += dir * R(8, 24); by += R(10, 22); b.push([bx, by]); } br.push(b); }
    return { pts, br, life: 1 };
  }
  function drawBolt(b, dt) {
    b.life -= .035 * dt; const l = Math.max(0, b.life);
    if (!(l > .75 || (l > .45 && l < .6) || (l > .2 && l < .3))) return;   // flickers on and off
    g.fillStyle = `rgba(190,210,255,${.1 * l})`; g.fillRect(0, 0, W, H);
    const path = pts => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
    g.save(); g.globalCompositeOperation = 'lighter'; g.shadowColor = '#9ec5ff'; g.shadowBlur = 18;
    g.strokeStyle = `rgba(160,195,255,${.55 * l})`; g.lineWidth = 4; path(b.pts); b.br.forEach(path);
    g.shadowBlur = 0; g.strokeStyle = `rgba(255,255,255,${.95 * l})`; g.lineWidth = 1.4; path(b.pts); g.lineWidth = .8; b.br.forEach(path); g.restore();
  }

  // ---- fireworks: a rocket with a trail, then a peony / ring / willow / crackle burst, all glowing
  function fireSys(every, palette, types) {
    const rk = [], sp = []; let next = performance.now() + R(400, 1400);
    types = types || ['peony', 'peony', 'ring', 'willow', 'crackle'];
    const burst = (x, y) => {
      const type = pick(types), c1 = pick(palette), c2 = Math.random() < .35 ? pick(palette) : c1, n = type === 'ring' ? 46 : type === 'willow' ? 70 : 64;
      sp.push({ x, y, vx: 0, vy: 0, life: 1, dec: .06, c: c1, s: 10, flash: true, gr: 0 });
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + R(-.05, .05), v = type === 'ring' ? 3.3 : type === 'willow' ? R(1.2, 2.8) : R(1.2, 4.2);
        sp.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, dec: type === 'willow' ? R(.006, .009) : R(.011, .018), c: i % 2 ? c2 : c1, s: type === 'willow' ? 1.6 : R(1.4, 2.2), gr: type === 'willow' ? .05 : .035, tw: type === 'crackle' });
      }
    };
    return { frame(dt, t) {
      if (t > next) { const ty = R(H * .12, H * .42); rk.push({ x: R(W * .12, W * .88), y: H + 8, vx: R(-.7, .7), vy: -Math.sqrt(2 * .12 * (H - ty)) }); next = t + R(every * .55, every * 1.45); }
      g.globalCompositeOperation = 'lighter';
      for (let i = rk.length - 1; i >= 0; i--) {
        const r = rk[i]; r.x += r.vx * dt; r.y += r.vy * dt; r.vy += .12 * dt;
        sp.push({ x: r.x, y: r.y, vx: R(-.25, .25), vy: R(.2, .8), life: .7, dec: .035, c: '#ffcf8a', s: 1.1, gr: .02 });
        g.globalAlpha = 1; g.drawImage(glow('#ffe1b0'), r.x - 5, r.y - 5, 10, 10);
        if (r.vy > -.5) { burst(r.x, r.y); rk.splice(i, 1); }
      }
      const damp = Math.pow(.986, dt);
      for (let i = sp.length - 1; i >= 0; i--) {
        const s = sp[i]; s.vx *= damp; s.vy = s.vy * damp + s.gr * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= s.dec * dt;
        if (s.life <= 0) { sp.splice(i, 1); continue; }
        let a = s.life; if (s.tw && s.life < .6) a *= Math.random() < .5 ? 1 : .15;
        const sz = s.flash ? s.s * 7 * s.life : s.s * 5; g.globalAlpha = s.flash ? a * .5 : a; g.drawImage(glow(s.c), s.x - sz / 2, s.y - sz / 2, sz, sz);
        if (!s.flash && s.life > .5) { g.fillStyle = '#ffffff'; g.fillRect(s.x - .6, s.y - .6, 1.2, 1.2); }
      }
      if (sp.length > 1800) sp.splice(0, sp.length - 1800);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    } };
  }

  // ---- confetti that flips as it falls (New Year)
  function confettiSys(density, palette) {
    const P = []; let init = true;
    const make = any => ({ x: R(0, W), y: any ? R(-H, H) : R(-40, -10), w: R(4, 7), h: R(7, 11), c: pick(palette), vy: R(.9, 1.9), vx: R(-.4, .4), rot: R(0, 6.28), vr: R(-.06, .06), flip: R(0, 6.28), vf: R(.05, .12), ph: R(0, 6.28) });
    return { frame(dt) {
      const want = Math.round(Math.min(90, W * H / density)); while (P.length < want) P.push(make(init)); init = false;
      for (const p of P) {
        p.ph += .02 * dt; p.flip += p.vf * dt; p.rot += p.vr * dt; p.x += (p.vx + Math.sin(p.ph) * .6) * dt; p.y += p.vy * dt - scrollKick * .6;
        if (p.y > H + 20 || p.y < -200) Object.assign(p, make(false));
        const sy = Math.cos(p.flip); g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, sy); g.globalAlpha = .9;
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.fillStyle = `rgba(255,255,255,${Math.max(0, sy) * .35})`; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * .35); g.restore();
      }
      g.globalAlpha = 1;
    } };
  }

  // ---- Diwali: sky lanterns rising, golden embers
  function lanternSys() {
    const L = [], E = []; let init = true;
    const make = any => { const z = R(.25, 1); return { x: R(W * .03, W * .97), y: any ? R(H * .1, H + 60) : H + R(40, 160), z, s: 9 + z * 17, vy: -(.18 + z * .42), ph: R(0, 6.28), fl: 1 }; };
    const ember = any => ({ x: R(0, W), y: any ? R(0, H) : H + 10, vy: -R(.2, .7), ph: R(0, 6.28), s: R(1, 2.4), a: R(.3, .9) });
    return { frame(dt, t) {
      const want = Math.round(Math.min(16, Math.max(6, W * H / 90000))); while (L.length < want) L.push(make(init));
      const wantE = Math.round(Math.min(70, W * H / 16000)); while (E.length < wantE) E.push(ember(init)); init = false;
      g.globalCompositeOperation = 'lighter';
      for (const e of E) { e.ph += .03 * dt; e.y += e.vy * dt; e.x += Math.sin(e.ph) * .3 * dt; if (e.y < -10) Object.assign(e, ember(false)); g.globalAlpha = e.a * (.6 + .4 * Math.sin(e.ph * 3)); const s = e.s * 5; g.drawImage(glow('#ffb627'), e.x - s / 2, e.y - s / 2, s, s); }
      g.globalCompositeOperation = 'source-over';
      L.sort((a, b) => a.z - b.z);
      for (const p of L) {
        p.ph += .01 * dt; p.y += p.vy * dt - scrollKick * .3 * p.z; p.x += Math.sin(p.ph) * .25 * dt;
        p.fl = .82 + .18 * Math.sin(t * .012 + p.ph * 7) * Math.sin(t * .007 + p.ph);
        if (p.y < -90 || p.y > H + 400) Object.assign(p, make(false));
        drawLantern(p);
      }
      g.globalAlpha = 1;
    } };
  }
  function drawLantern(p) {
    const s = p.s, w = s, h = s * 1.3; g.save(); g.translate(p.x, p.y); g.rotate(Math.sin(p.ph) * .07);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = .45 * p.fl * (.5 + p.z * .5); g.drawImage(glow('#ff9a2e'), -s * 2.4, -s * 2.4, s * 4.8, s * 4.8); g.globalCompositeOperation = 'source-over';
    const gr = g.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, '#ffd27a'); gr.addColorStop(.55, '#ff8f2b'); gr.addColorStop(1, '#c2410c');
    g.globalAlpha = .55 + p.z * .45; g.fillStyle = gr; g.beginPath(); g.moveTo(-w * .4, -h / 2); g.lineTo(w * .4, -h / 2); g.quadraticCurveTo(w * .62, 0, w * .48, h / 2); g.lineTo(-w * .48, h / 2); g.quadraticCurveTo(-w * .62, 0, -w * .4, -h / 2); g.fill();
    g.strokeStyle = 'rgba(120,40,0,.25)'; g.lineWidth = .8; g.beginPath(); g.moveTo(0, -h / 2); g.lineTo(0, h / 2); g.stroke();
    g.fillStyle = '#7c2d12'; g.fillRect(-w * .48, h / 2 - 1.5, w * .96, 2);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = .9 * p.fl; g.drawImage(glow('#ffe08a'), -w * .5, h * .02, w, w);
    g.restore();
  }

  // ---- Pongal: marigold petals and mango leaves tumbling down
  function petalSys() {
    const P = []; let init = true;
    const make = any => { const leaf = Math.random() < .14; return { x: R(-20, W + 20), y: any ? R(-20, H) : R(-60, -10), s: leaf ? R(6, 9) : R(3.5, 6.5), leaf,
      c: leaf ? pick(['#3f9b4b', '#2e7d32', '#5cb85c']) : pick(['#ff9f1c', '#ffb000', '#ffcf3f', '#f77f00', '#e85d04']), vy: R(.5, 1.25), rot: R(0, 6.28), vr: R(-.03, .03), flip: R(0, 6.28), vf: R(.02, .06), ph: R(0, 6.28), sw: R(.5, 1.3) }; };
    return { frame(dt, t) {
      const want = Math.round(Math.min(70, W * H / 20000)); while (P.length < want) P.push(make(init)); init = false;
      const wind = Math.sin(t * .0003) * .5;
      for (const p of P) {
        p.ph += .015 * dt; p.rot += p.vr * dt; p.flip += p.vf * dt;
        const dx = p.x - mouse.x, dy = p.y - mouse.y; if (dx * dx + dy * dy < 9000) { p.x += dx * .02 * dt; p.y += dy * .01 * dt; }
        p.x += (wind + Math.sin(p.ph) * .6 * p.sw) * dt; p.y += p.vy * dt - scrollKick * .5;
        if (p.y > H + 20 || p.x < -40 || p.x > W + 40 || p.y < -200) Object.assign(p, make(false));
        const fy = Math.cos(p.flip), s = p.s; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(fy) < .08 ? .08 * Math.sign(fy || 1) : fy); g.globalAlpha = .92; g.fillStyle = p.c;
        g.beginPath();
        if (p.leaf) { g.moveTo(0, -s * 1.6); g.quadraticCurveTo(s, 0, 0, s * 1.6); g.quadraticCurveTo(-s, 0, 0, -s * 1.6); }
        else { g.moveTo(0, -s); g.bezierCurveTo(s * .95, -s * .6, s * .7, s * .85, 0, s); g.bezierCurveTo(-s * .7, s * .85, -s * .95, -s * .6, 0, -s); }
        g.fill(); g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.ellipse(-s * .2, -s * .25, s * .22, s * .5, 0, 0, 7); g.fill(); g.restore();
      }
      g.globalAlpha = 1;
    } };
  }

  // ---- Halloween: rolling fog, embers, flocks of bats
  function spookSys() {
    const F = [], B = [], E = []; let init = true, nextFlock = performance.now() + R(1500, 4000);
    const fog = () => radial('fog', 128, [[0, 'rgba(170,150,200,.55)'], [.5, 'rgba(120,100,160,.22)'], [1, 'rgba(90,70,130,0)']]);
    return { frame(dt, t) {
      if (!F.length) for (let i = 0; i < 9; i++) F.push({ x: R(-200, W), y: R(H * .55, H + 80), s: R(260, 520), vx: R(.15, .45) * (Math.random() < .5 ? 1 : -1), a: R(.08, .16) });
      const fs = fog(); for (const f of F) { f.x += f.vx * dt; if (f.x > W + 300) f.x = -f.s; if (f.x < -f.s - 300) f.x = W + 100; g.globalAlpha = f.a; g.drawImage(fs, f.x - f.s / 2, f.y - f.s / 3, f.s, f.s * .66); }
      const wantE = Math.round(Math.min(40, W * H / 30000)); while (E.length < wantE) E.push({ x: R(0, W), y: init ? R(0, H) : H + 10, vy: -R(.2, .6), ph: R(0, 6.28), s: R(1, 2.2) }); init = false;
      g.globalCompositeOperation = 'lighter';
      for (const e of E) { e.ph += .03 * dt; e.y += e.vy * dt; e.x += Math.sin(e.ph) * .4 * dt; if (e.y < -10) { e.y = H + 10; e.x = R(0, W); } g.globalAlpha = .5 + .4 * Math.sin(e.ph * 2); const s = e.s * 6; g.drawImage(glow('#ff7b00'), e.x - s / 2, e.y - s / 2, s, s); }
      g.globalCompositeOperation = 'source-over';
      if (t > nextFlock) { const dir = Math.random() < .5 ? 1 : -1, y0 = R(H * .1, H * .5), n = 3 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) B.push({ x: dir > 0 ? -40 - i * R(18, 40) : W + 40 + i * R(18, 40), y: y0 + R(-40, 40), dir, s: R(7, 15), v: R(2.2, 3.6), ph: R(0, 6.28), fl: R(.25, .38) });
        nextFlock = t + R(5000, 11000); }
      for (let i = B.length - 1; i >= 0; i--) { const b = B[i]; b.ph += b.fl * dt; b.x += b.dir * b.v * dt; b.y += Math.sin(b.ph * .25) * .7 * dt; drawBat(b); if (b.x < -160 || b.x > W + 160) B.splice(i, 1); }
      g.globalAlpha = 1;
    } };
  }
  function drawBat(b) {
    const s = b.s, wy = -s * .9 * Math.sin(b.ph); g.save(); g.translate(b.x, b.y); g.scale(b.dir, 1); g.globalAlpha = .92; g.fillStyle = '#120818';
    g.beginPath(); g.moveTo(0, -s * .15);
    g.quadraticCurveTo(-s * .55, -s * .35 + wy * .5, -s * 1.7, wy); g.quadraticCurveTo(-s * 1.35, s * .05 + wy * .3, -s * 1.15, s * .25);
    g.quadraticCurveTo(-s * .95, s * .05, -s * .72, s * .32); g.quadraticCurveTo(-s * .5, s * .1, -s * .25, s * .35); g.lineTo(s * .25, s * .35);
    g.quadraticCurveTo(s * .5, s * .1, s * .72, s * .32); g.quadraticCurveTo(s * .95, s * .05, s * 1.15, s * .25);
    g.quadraticCurveTo(s * 1.35, s * .05 + wy * .3, s * 1.7, wy); g.quadraticCurveTo(s * .55, -s * .35 + wy * .5, 0, -s * .15); g.fill();
    g.beginPath(); g.ellipse(0, s * .05, s * .28, s * .4, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-s * .2, -s * .25); g.lineTo(-s * .12, -s * .55); g.lineTo(-s * .02, -s * .3); g.moveTo(s * .2, -s * .25); g.lineTo(s * .12, -s * .55); g.lineTo(s * .02, -s * .3); g.fill();
    g.fillStyle = '#ff8a1c'; g.fillRect(-s * .12, -s * .12, 1.6, 1.6); g.fillRect(s * .06, -s * .12, 1.6, 1.6); g.restore();
  }

  function makeSystem(k) {
    const parts = k === 'winter' ? [snowSys(6200, true)] : k === 'christmas' ? [snowSys(9000, true)]
      : k === 'newyear' ? [fireSys(1400, ['#ffd60a', '#ff375f', '#64d2ff', '#bf5af2', '#30d158', '#ffffff']), confettiSys(30000, ['#ffd60a', '#f4b400', '#ffffff', '#bf5af2', '#ff375f', '#64d2ff'])]
      : k === 'diwali' ? [lanternSys(), fireSys(5200, ['#ffd166', '#ff9f1c', '#ff5e3a', '#fff3b0', '#ff3d7f'], ['peony', 'willow', 'crackle', 'ring'])]
      : k === 'pongal' ? [petalSys()] : k === 'halloween' ? [spookSys()] : k === 'monsoon' ? [rainSys()] : [];
    return { frame(dt, t) { for (const p of parts) p.frame(dt, t); } };
  }
  function size() { if (!cv) return; W = innerWidth; H = innerHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (document.hidden || !g) return;
    const dt = Math.min(3, (t - lastT) / 16.67 || 1); lastT = t;
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, W, H);
    scrollKick *= Math.pow(.9, dt);
    sys.frame(dt, t);
  }
  function startFx() {
    stopFx(); if (reduce || !key) return;
    cv = document.createElement('canvas'); cv.className = 'sz-fx'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv);
    g = cv.getContext('2d'); size(); sys = makeSystem(key); lastT = performance.now(); raf = requestAnimationFrame(loop);
  }
  function stopFx() { cancelAnimationFrame(raf); if (cv) cv.remove(); cv = g = sys = null; }

  // ================================================================ 2) decorations hanging from the menu bar (SVG)
  const BAUBLE = { red: ['#ff9b9b', '#d62828', '#5c0b0b'], gold: ['#fff1b3', '#f4b400', '#6e4700'], blue: ['#a9c9ff', '#2f6fde', '#0f2557'],
    silver: ['#ffffff', '#c9d3db', '#56626b'], green: ['#a6f0b8', '#1f9d55', '#0a3a20'], purple: ['#e6bcff', '#9b4dff', '#35106a'] };
  const HALO = ['#fff3c4', '#ff5a5a', '#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff375f'];
  const MARI = Array.from({ length: 10 }, (_, i) => { const a = i / 10 * Math.PI * 2; return `<circle cx="${f1(Math.cos(a) * 3.3)}" cy="${f1(Math.sin(a) * 3.3)}" r="2.7" fill="${i % 2 ? '#ff9f1c' : '#ffb627'}"/>`; }).join('');
  const DEFS = `<defs>
    <linearGradient id="szGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".45" stop-color="#f4b400"/><stop offset="1" stop-color="#8a5a00"/></linearGradient>
    <linearGradient id="szSilver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c9d3db"/><stop offset="1" stop-color="#7b8892"/></linearGradient>
    ${Object.entries(BAUBLE).map(([k, [a, b, c]]) => `<radialGradient id="szB_${k}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`).join('')}
    ${HALO.map(c => `<radialGradient id="szH${c.slice(1)}"><stop offset="0" stop-color="${c}" stop-opacity=".9"/><stop offset=".35" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join('')}
    <linearGradient id="szSnowG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#eef6ff"/><stop offset="1" stop-color="#cfe1f5"/></linearGradient>
    <linearGradient id="szIce" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4fbff" stop-opacity=".95"/><stop offset=".6" stop-color="#bfe2ff" stop-opacity=".8"/><stop offset="1" stop-color="#9fd0f5" stop-opacity=".3"/></linearGradient>
    <linearGradient id="szLeafG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86c84f"/><stop offset="1" stop-color="#2e7d32"/></linearGradient>
    <radialGradient id="szMariG" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffe08a"/><stop offset=".5" stop-color="#ff9f1c"/><stop offset="1" stop-color="#d9480f"/></radialGradient>
    <radialGradient id="szPump" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ffb347"/><stop offset=".6" stop-color="#f77f00"/><stop offset="1" stop-color="#8a3a00"/></radialGradient>
    <radialGradient id="szPumpGlow"><stop offset="0" stop-color="#ff9a2e" stop-opacity=".55"/><stop offset="1" stop-color="#ff9a2e" stop-opacity="0"/></radialGradient>
    <linearGradient id="szDropG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6f3ff" stop-opacity=".85"/><stop offset="1" stop-color="#7fb0e8" stop-opacity=".5"/></linearGradient>
    <filter id="szSoft" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
    <symbol id="szLeaf" overflow="visible"><path d="M0 0C5.5 4 6.5 13 0 23C-6.5 13-5.5 4 0 0Z" fill="url(#szLeafG)"/><path d="M0 1.5V21" stroke="#1b5e20" stroke-width=".8" opacity=".75"/></symbol>
    <symbol id="szMari" overflow="visible">${MARI}<circle r="3.6" fill="url(#szMariG)"/></symbol>
  </defs>`;
  function smooth(pts) {   // a smooth line through points (Catmull-Rom as Bezier curves)
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return d;
  }
  function swags(W, gap, sag) {   // a rope hanging in loops between hooks
    const n = Math.max(2, Math.round(W / gap)), step = W / n, list = [];
    for (let i = 0; i < n; i++) list.push([i * step, (i + 1) * step]);
    const at = (s, t) => ({ x: s[0] + (s[1] - s[0]) * t, y: 2 + 4 * sag * t * (1 - t) });
    const wire = list.map(s => `M${f1(s[0])} 2Q${f1((s[0] + s[1]) / 2)} ${f1(2 + 2 * sag)} ${f1(s[1])} 2`).join('');
    return { list, at, wire };
  }
  const swing = (x, y, r, body, d) => `<g class="sz-swing" style="transform-origin:${f1(x)}px ${f1(y)}px;--d:${(d || 2.8 + r * 1.8).toFixed(2)}s;--dl:-${(r * 4).toFixed(2)}s">${body}</g>`;
  const light = (x, y, col, r) => `<g class="sz-tw" style="--d:${(1.8 + r * 1.6).toFixed(2)}s;--dl:-${(r * 3).toFixed(2)}s"><circle cx="${f1(x)}" cy="${f1(y)}" r="6.5" fill="url(#szH${col.slice(1)})"/><circle cx="${f1(x)}" cy="${f1(y)}" r="1.7" fill="${col}"/></g>`;
  function bauble(x, y, len, rad, col, r) {
    const cy = y + len + rad + 1.5;
    return swing(x, y, r, `<line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(x)}" y2="${f1(y + len)}" stroke="#d9c38a" stroke-width=".8"/>
      <rect x="${f1(x - 2.3)}" y="${f1(y + len - .6)}" width="4.6" height="3.2" rx=".8" fill="url(#szGold)"/>
      <circle class="sz-orn" cx="${f1(x)}" cy="${f1(cy)}" r="${f1(rad)}" fill="url(#szB_${col})"/>
      <ellipse cx="${f1(x - rad * .35)}" cy="${f1(cy - rad * .42)}" rx="${f1(rad * .3)}" ry="${f1(rad * .17)}" fill="#fff" opacity=".7" transform="rotate(-30 ${f1(x - rad * .35)} ${f1(cy - rad * .42)})"/>`);
  }
  function starPath(cx, cy, Ro, Ri) { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? Ri : Ro; d += (i ? 'L' : 'M') + f1(cx + Math.cos(a) * rr) + ' ' + f1(cy + Math.sin(a) * rr); } return d + 'Z'; }
  function star(x, y, len, s, grad, r) {
    const cy = y + len + s;
    return swing(x, y, r, `<line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(x)}" y2="${f1(cy - s)}" stroke="#d9c38a" stroke-width=".7"/>
      <path class="sz-orn" d="${starPath(x, cy, s, s * .45)}" fill="url(#${grad})" stroke="#7a5200" stroke-width=".5" style="filter:drop-shadow(0 0 4px #ffd60a88)"/>
      <circle class="sz-glint" cx="${f1(x - s * .25)}" cy="${f1(cy - s * .3)}" r="1.3" fill="#fff" style="--d:4s;--dl:-${(r * 4).toFixed(1)}s"/>`);
  }
  function hangFlake(x, y, len, s, r) {
    const cy = y + len + s; let arms = '';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), P = (d, o) => `${f1(x + ca * d - sa * o)} ${f1(cy + sa * d + ca * o)}`;
      arms += `M${P(0, 0)}L${P(s, 0)}M${P(s * .5, 0)}L${P(s * .8, s * .27)}M${P(s * .5, 0)}L${P(s * .8, -s * .27)}`;
    }
    return swing(x, y, r, `<line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(x)}" y2="${f1(cy - s)}" stroke="#dbe9f7" stroke-width=".6" opacity=".8"/>
      <path class="sz-orn" d="${arms}" stroke="#eaf5ff" stroke-width="1.9" stroke-linecap="round" fill="none" style="filter:drop-shadow(0 0 3px #9fd8ff)"/><circle cx="${f1(x)}" cy="${f1(cy)}" r="1.8" fill="#fff"/>`);
  }

  function decoWinter(W) {
    const r = seeded(7), pts = [];
    for (let x = -10; x < W + 12; x += 22) pts.push([x, 6 + r() * 8 + (r() < .15 ? 5 : 0)]);
    pts.push([W + 12, 8]);
    const edge = x => { const i = Math.min(pts.length - 2, Math.max(0, Math.floor((x + 10) / 22))), [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; return y0 + (y1 - y0) * ((x - x0) / (x1 - x0)); };
    const rev = pts.slice().reverse(), body = `M-10 -4H${W + 12}V${f1(rev[0][1])}${smooth(rev).replace(/^M[^C]+/, '')}V-4Z`;
    const ice = [], extra = [], sparkle = [], flakes = [];
    for (let x = 24 + r() * 40; x < W - 16; x += 34 + r() * 90) {
      const y = edge(x) - 1, L = 9 + r() * 24, w = 4 + r() * 5, tip = (r() - .5) * 2;
      ice.push(`<path d="M${f1(x - w / 2)} ${f1(y)}Q${f1(x - w / 4)} ${f1(y + L * .55)} ${f1(x + tip)} ${f1(y + L)}Q${f1(x + w / 4)} ${f1(y + L * .55)} ${f1(x + w / 2)} ${f1(y)}Z" fill="url(#szIce)"/><path d="M${f1(x - w / 4)} ${f1(y + 1)}Q${f1(x - w / 8)} ${f1(y + L * .5)} ${f1(x + tip * .6)} ${f1(y + L * .85)}" stroke="#fff" stroke-width=".7" fill="none" opacity=".8"/>`);
      if (r() < .5) extra.push(`<circle class="sz-glint" cx="${f1(x - w / 6)}" cy="${f1(y + L * .3)}" r="1.4" fill="#fff" style="--d:${(4 + r() * 4).toFixed(1)}s;--dl:-${(r() * 8).toFixed(1)}s"/>`);
      if (r() < .4) extra.push(`<path class="sz-drop" d="M${f1(x + tip)} ${f1(y + L)}c-1.4 2-1.4 3.6 0 3.6s1.4-1.6 0-3.6z" fill="#cfe8ff" style="--d:${(3 + r() * 3).toFixed(1)}s;--dl:-${(r() * 6).toFixed(1)}s"/>`);
    }
    for (let i = 0; i < W / 36; i++) { const x = r() * W, y = 1 + r() * Math.max(1, edge(x) - 4), s = 1.6 + r() * 1.4;
      sparkle.push(`<path class="sz-tw" d="M${f1(x)} ${f1(y - s)}L${f1(x + s * .25)} ${f1(y - s * .25)} ${f1(x + s)} ${f1(y)} ${f1(x + s * .25)} ${f1(y + s * .25)} ${f1(x)} ${f1(y + s)} ${f1(x - s * .25)} ${f1(y + s * .25)} ${f1(x - s)} ${f1(y)} ${f1(x - s * .25)} ${f1(y - s * .25)}Z" fill="#fff" style="--d:${(1.8 + r() * 2.4).toFixed(1)}s;--dl:-${(r() * 4).toFixed(1)}s"/>`); }
    for (let x = 80 + r() * 60; x < W - 40; x += 170 + r() * 170) flakes.push(hangFlake(x, edge(x) - 2, 14 + r() * 28, 7 + r() * 5, r()));
    return `<g class="sz-solid"><path d="${body}" fill="#000" opacity=".4" filter="url(#szSoft)" transform="translate(0 3)"/><path d="${body}" fill="url(#szSnowG)"/>
      <path d="${body}" fill="none" stroke="#a9c8e6" stroke-width="1" opacity=".55"/>${sparkle.join('')}${ice.join('')}${extra.join('')}${flakes.join('')}</g>`;
  }
  function decoChristmas(W) {
    const r = seeded(3), { list, at } = swags(W, 170, 12), greens = ['#123d22', '#1f5d34', '#2e7d46', '#3f9b5b'], paths = greens.map(() => '');
    let snow = '', lights = '', orns = '';
    for (const s of list) for (let t = 0; t <= 1.001; t += .02) {
      const p = at(s, t);
      for (let k = 0; k < 5; k++) { const a = r() * Math.PI * 2, len = 4 + r() * 5; paths[Math.floor(r() * 4)] += `M${f1(p.x)} ${f1(p.y)}l${f1(Math.cos(a) * len)} ${f1(Math.sin(a) * len * .8)}`; }
      if (r() < .28) snow += `<circle cx="${f1(p.x + (r() - .5) * 6)}" cy="${f1(p.y - 2 - r() * 2)}" r="${f1(.8 + r() * 1)}" fill="#f4faff" opacity=".92"/>`;
    }
    const LC = ['#ff5a5a', '#ffd60a', '#30d158', '#64d2ff', '#fff3c4']; let li = 0;
    for (const s of list) for (let t = .06; t < 1; t += .1) { const p = at(s, t); lights += light(p.x + (r() - .5) * 4, p.y + 2 + (r() - .5) * 4, LC[li++ % LC.length], r()); }
    const BC = ['red', 'gold', 'blue', 'silver', 'red', 'green', 'gold', 'purple']; let bi = 0;
    for (const s of list) for (const t of [0, .5]) { const p = at(s, t); if (p.x < 12 || p.x > W - 12) continue; orns += bauble(p.x, p.y + 3, 6 + r() * (t ? 18 : 30), 6 + r() * 3.5, BC[bi++ % BC.length], r()); }
    return `${paths.map((d, i) => `<path d="${d}" stroke="${greens[i]}" stroke-width="1.7" stroke-linecap="round" fill="none"/>`).join('')}${snow}${lights}${orns}`;
  }
  function decoNewYear(W) {
    const r = seeded(11), { list, at, wire } = swags(W, 160, 10), tins = ['#f4b400', '#ffd60a', '#fff1b3', '#c9d3db'], paths = tins.map(() => '');
    let lights = '', orns = '';
    for (const s of list) for (let t = 0; t <= 1.001; t += .012) { const p = at(s, t), a = Math.PI / 2 + (r() - .5) * .9, len = 4 + r() * 7; paths[Math.floor(r() * 4)] += `M${f1(p.x)} ${f1(p.y)}l${f1(Math.cos(a) * len)} ${f1(Math.sin(a) * len)}`; }
    const LC = ['#ffd60a', '#bf5af2', '#64d2ff', '#ff375f', '#fff3c4']; let li = 0;
    for (const s of list) for (let t = .08; t < 1; t += .14) { const p = at(s, t); lights += light(p.x, p.y + 1, LC[li++ % LC.length], r()); }
    let k = 0;
    for (const s of list) for (const t of [0, .5]) { const p = at(s, t); if (p.x < 12 || p.x > W - 12) continue;
      orns += k++ % 2 ? bauble(p.x, p.y + 3, 6 + r() * 26, 6 + r() * 3, ['gold', 'silver', 'purple'][Math.floor(r() * 3)], r()) : star(p.x, p.y + 3, 8 + r() * 24, 7 + r() * 4, r() < .6 ? 'szGold' : 'szSilver', r()); }
    return `<path d="${wire}" stroke="url(#szGold)" stroke-width="2" fill="none"/>${paths.map((d, i) => `<path d="${d}" stroke="${tins[i]}" stroke-width="1.1" stroke-linecap="round" fill="none" opacity=".9"/>`).join('')}${lights}${orns}`;
  }
  function decoToran(W, diwali) {   // mango-leaf toran with marigold strings (Diwali also: brass bells and warm lights)
    const r = seeded(diwali ? 5 : 9); let strands = '', leaves = '', lights = '';
    for (let x = 40 + r() * 30; x < W - 25; x += diwali ? 62 + r() * 34 : 88 + r() * 40) {
      const n = diwali ? 3 + Math.floor(r() * 3) : 2, y0 = 4;
      let body = `<line x1="${f1(x)}" y1="${y0}" x2="${f1(x)}" y2="${f1(y0 + 10 + n * 8.5)}" stroke="#8a5a1a" stroke-width=".8"/>`;
      for (let k = 0; k < n; k++) { const cy = y0 + 13 + k * 8.5; body += `<use href="#szMari" x="${f1(x)}" y="${f1(cy)}" transform="rotate(${f1((r() - .5) * 40)} ${f1(x)} ${f1(cy)})"/>`; }
      if (diwali) { const by = y0 + 13 + n * 8.5 + 1; body += `<path d="M${f1(x - 4.5)} ${f1(by + 6)}C${f1(x - 4.5)} ${f1(by - 1)} ${f1(x + 4.5)} ${f1(by - 1)} ${f1(x + 4.5)} ${f1(by + 6)}L${f1(x + 5.5)} ${f1(by + 8)}H${f1(x - 5.5)}Z" fill="url(#szGold)"/><circle cx="${f1(x)}" cy="${f1(by + 9.2)}" r="1.4" fill="#b07800"/>`; }
      strands += swing(x, y0, r(), `<g class="sz-orn">${body}</g>`);
    }
    for (let x = 4; x < W; x += 12.5) leaves += `<use href="#szLeaf" transform="translate(${f1(x)} 3) rotate(${f1((r() - .5) * 18)}) scale(${f1(.82 + r() * .3)})"/>`;
    if (diwali) for (let x = 20 + r() * 20; x < W; x += 34 + r() * 26) lights += light(x, 3 + r() * 2, '#fff3c4', r());
    return `${strands}<path d="M-2 3H${W + 2}" stroke="#6b3f12" stroke-width="2.4"/>${leaves}${lights}`;
  }
  function web(cx, dir) {
    const spokes = [0, 18, 36, 54, 72, 90].map(a => a * Math.PI / 180), rings = [10, 19, 29, 40, 52], P = (rad, a) => [cx + dir * Math.cos(a) * rad, Math.sin(a) * rad];
    let d = ''; for (const a of spokes) { const [x, y] = P(60, a); d += `M${f1(cx)} 0L${f1(x)} ${f1(y)}`; }
    for (const rad of rings) for (let i = 0; i < spokes.length - 1; i++) { const [x0, y0] = P(rad, spokes[i]), [x1, y1] = P(rad, spokes[i + 1]), [mx, my] = P(rad * .84, (spokes[i] + spokes[i + 1]) / 2); d += `M${f1(x0)} ${f1(y0)}Q${f1(mx)} ${f1(my)} ${f1(x1)} ${f1(y1)}`; }
    return `<path d="${d}" stroke="#ece4f4" stroke-width=".7" fill="none" opacity=".5"/>`;
  }
  function spider(x, L, r) {
    const d = (4 + r() * 3).toFixed(1), dl = (r() * 5).toFixed(1), k = f1((L + 22) / L), y = L;
    return `<line class="sz-thread" x1="${f1(x)}" y1="0" x2="${f1(x)}" y2="${f1(L)}" stroke="#ece4f4" stroke-width=".6" opacity=".55" style="transform-origin:${f1(x)}px 0px;--k:${k};--d:${d}s;--dl:-${dl}s"/>
      <g class="sz-bob" style="--d:${d}s;--dl:-${dl}s"><g class="sz-orn" transform="translate(${f1(x)} ${f1(y)}) scale(1.7) translate(${f1(-x)} ${f1(-y)})" style="filter:drop-shadow(0 0 3px #b388ff99)">
      <path d="M${f1(x - 3)} ${f1(y + 4)}l-6 -4l-3 3M${f1(x - 3)} ${f1(y + 6)}h-7l-2 4M${f1(x - 3)} ${f1(y + 8)}l-6 4l-1 4M${f1(x + 3)} ${f1(y + 4)}l6 -4l3 3M${f1(x + 3)} ${f1(y + 6)}h7l2 4M${f1(x + 3)} ${f1(y + 8)}l6 4l1 4" stroke="#2b1a3a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <ellipse cx="${f1(x)}" cy="${f1(y + 3)}" rx="3" ry="2.6" fill="#2a1838"/><ellipse cx="${f1(x)}" cy="${f1(y + 9)}" rx="4.6" ry="5.4" fill="#2a1838"/><ellipse cx="${f1(x - 1.4)}" cy="${f1(y + 7)}" rx="1.4" ry="2" fill="#ffffff" opacity=".15"/>
      <circle cx="${f1(x - 1.1)}" cy="${f1(y + 2.6)}" r=".8" fill="#ff7b00"/><circle cx="${f1(x + 1.1)}" cy="${f1(y + 2.6)}" r=".8" fill="#ff7b00"/>
      <path d="M${f1(x)} ${f1(y + 6.5)}l1.6 2.4l-1.6 2.4l-1.6 -2.4z" fill="#a4161a" opacity=".85"/></g></g>`;
  }
  function pumpkin(x, len, s, r) {
    const cy = len + s;
    const face = `<path d="M${f1(x - s * .55)} ${f1(cy - s * .12)}l${f1(s * .22)} ${f1(-s * .34)}l${f1(s * .22)} ${f1(s * .34)}zM${f1(x + s * .11)} ${f1(cy - s * .12)}l${f1(s * .22)} ${f1(-s * .34)}l${f1(s * .22)} ${f1(s * .34)}z
      M${f1(x - s * .62)} ${f1(cy + s * .2)}q${f1(s * .62)} ${f1(s * .58)} ${f1(s * 1.24)} 0l${f1(-s * .21)} ${f1(s * .1)}l${f1(-s * .2)} ${f1(-s * .13)}l${f1(-s * .21)} ${f1(s * .15)}l${f1(-s * .21)} ${f1(-s * .15)}l${f1(-s * .2)} ${f1(s * .13)}z" fill="#ffd166"/>`;
    return swing(x, 0, r, `<line x1="${f1(x)}" y1="0" x2="${f1(x)}" y2="${f1(cy - s * .85)}" stroke="#777" stroke-width=".7"/>
      <circle class="sz-flick" cx="${f1(x)}" cy="${f1(cy)}" r="${f1(s * 2.6)}" fill="url(#szPumpGlow)" style="--dl:-${(r * 3).toFixed(1)}s"/>
      <g class="sz-orn"><ellipse cx="${f1(x - s * .48)}" cy="${f1(cy)}" rx="${f1(s * .62)}" ry="${f1(s * .82)}" fill="url(#szPump)"/><ellipse cx="${f1(x + s * .48)}" cy="${f1(cy)}" rx="${f1(s * .62)}" ry="${f1(s * .82)}" fill="url(#szPump)"/><ellipse cx="${f1(x)}" cy="${f1(cy)}" rx="${f1(s * .6)}" ry="${f1(s * .88)}" fill="url(#szPump)"/>
      <path d="M${f1(x - .8)} ${f1(cy - s * .85)}q.5 -3.5 2.6 -4.2" stroke="#3b5d1e" stroke-width="2" fill="none" stroke-linecap="round"/><g class="sz-flick" style="--dl:-${(r * 2).toFixed(1)}s">${face}</g></g>`);
  }
  function decoHalloween(W) {
    const r = seeded(13); let out = web(0, 1) + web(W, -1);
    for (const fx of [.3, .7]) out += spider(W * fx + (r() - .5) * 60, 18 + r() * 20, r);
    for (let x = 110 + r() * 70; x < W - 100; x += 170 + r() * 130) out += pumpkin(x, 8 + r() * 26, 10 + r() * 4, r());
    return out;
  }
  function decoMonsoon(W) {
    const r = seeded(17); let drops = '';
    for (let x = 10 + r() * 20; x < W - 6; x += 16 + r() * 44) {
      const s = 2 + r() * 3.5, anim = r() < .45;
      drops += `<g${anim ? ` class="sz-drop" style="--d:${(2.6 + r() * 3).toFixed(1)}s;--dl:-${(r() * 5).toFixed(1)}s"` : ''}><path d="M${f1(x)} 0C${f1(x - s)} ${f1(s * 1.3)} ${f1(x - s)} ${f1(s * 2.3)} ${f1(x)} ${f1(s * 2.6)}C${f1(x + s)} ${f1(s * 2.3)} ${f1(x + s)} ${f1(s * 1.3)} ${f1(x)} 0Z" fill="url(#szDropG)"/><ellipse cx="${f1(x - s * .35)}" cy="${f1(s * 1.5)}" rx="${f1(s * .22)}" ry="${f1(s * .35)}" fill="#fff" opacity=".8"/></g>`;
    }
    return `<rect x="0" y="-1" width="${W}" height="2" fill="#9cc8ff" opacity=".35"/>${drops}`;
  }
  function clearDeco() { document.querySelectorAll('.sz-deco').forEach(x => x.remove()); }
  function decorate() {
    clearDeco(); const nav = document.getElementById('nav'); if (!nav) return;
    const w = Math.round(nav.getBoundingClientRect().width || innerWidth); if (w < 200) return;
    const body = { winter: decoWinter, christmas: decoChristmas, newyear: decoNewYear, diwali: w2 => decoToran(w2, true), pongal: w2 => decoToran(w2, false), halloween: decoHalloween, monsoon: decoMonsoon }[key];
    if (body) {
      const d = document.createElement('div'); d.className = 'sz-deco'; d.setAttribute('aria-hidden', 'true');
      d.innerHTML = `<svg width="${w}" height="120" viewBox="0 0 ${w} 120">${DEFS}${body(w)}</svg>`; nav.appendChild(d);
      // touch an ornament and it swings harder, then settles
      d.querySelectorAll('.sz-swing').forEach(gr => gr.addEventListener('pointerenter', () => {
        let a = 20; clearInterval(gr._k); gr.style.setProperty('--amp', a + 'deg');
        gr._k = setInterval(() => { a = Math.max(5, a * .94); gr.style.setProperty('--amp', a.toFixed(1) + 'deg'); if (a <= 5.05) clearInterval(gr._k); }, 50);
      }));
    }
  }

  // ---- snow settled on the tops of cards and boxes (winter, Christmas)
  const CAP_SEL = '.card, .ev, .cr, .pd, .tile, .box, .panel, .lbt, .sc-bar, .vid, .shot, .stchip, .c-hero';
  let capBox = null, capT = 0, capMo = null, capRo = null;
  // snow settled on a ledge: a soft, lumpy layer that is thicker in places, with rounded ends that curl over the box's sides.
  // B is the box's top edge inside the drawing; nothing goes below it over the box (only past its left and right sides).
  const CAP_B = 20, CAP_H = 30;
  function capSvg(w, seed) {
    const r = seeded(seed * 131 + Math.round(w) * 7), B = CAP_B, id = 'szc' + seed;
    const T = Math.max(6, Math.min(12, w / 38));                 // usual thickness of the snow
    // big drifts (every ~60px) + small lumps (every ~9px), blended smoothly
    const big = []; for (let x = 0; x <= w + 60; x += 60) big.push(.5 + r() * .75);
    const at = x => { const i = Math.floor(x / 60), u = x / 60 - i, a = big[i], b = big[i + 1] ?? a, k = (1 - Math.cos(u * Math.PI)) / 2; return a + (b - a) * k; };
    const step = Math.max(6, Math.min(10, w / 40)), top = [];
    const end = x => { const u = Math.min(x, w - x) / Math.min(26, w / 4); return u >= 1 ? 1 : Math.sqrt(Math.max(0, u * (2 - u))); };   // rounded ends
    for (let x = 1; x < w - 1; x += step) top.push([x, B - T * at(x) * (.82 + r() * .28) * (.45 + .55 * end(x))]);
    top.push([w - 1, B - T * at(w) * .5]);
    // the ends hang a little past the box and droop down its sides
    const oL = 2 + r() * 2.5, oR = 2 + r() * 2.5, dL = 3 + r() * 4, dR = 3 + r() * 4;
    const ridge = smooth(top);
    const body = `M${f1(-oL)} ${f1(B + dL)}C${f1(-oL - 1.6)} ${f1(B - 1)} ${f1(-1)} ${f1(top[0][1] - .5)} ${f1(top[0][0])} ${f1(top[0][1])}` + ridge.replace(/^M[^C]*/, '') +
      `C${f1(w + 1)} ${f1(top[top.length - 1][1] - .5)} ${f1(w + oR + 1.6)} ${f1(B - 1)} ${f1(w + oR)} ${f1(B + dR)}` +
      `Q${f1(w + oR * .4)} ${f1(B + dR + 1.2)} ${f1(w)} ${f1(B + 1.6)}L0 ${f1(B + 1.6)}Q${f1(-oL * .4)} ${f1(B + dL + 1.2)} ${f1(-oL)} ${f1(B + dL)}Z`;
    // soft blue hollows between the lumps, and the shaded underside where the snow meets the box
    let holes = ''; for (let i = 0; i < Math.max(2, Math.round(w / 70)); i++) { const x = 10 + r() * (w - 20), rx = 6 + r() * 12; holes += `<ellipse cx="${f1(x)}" cy="${f1(B - T * .45)}" rx="${f1(rx)}" ry="${f1(T * .22)}" fill="#7f9fc6" opacity="${(.16 + r() * .14).toFixed(2)}" filter="url(#szCapSoft)"/>`; }
    let grains = ''; for (let i = 0; i < Math.round(w / 9); i++) { const x = 2 + r() * (w - 4), y = B - r() * T * .9; grains += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${(.35 + r() * .45).toFixed(2)}" fill="${r() < .5 ? '#fff' : '#b9cbe3'}" opacity="${(.5 + r() * .5).toFixed(2)}"/>`; }
    let glints = ''; for (let i = 0; i < Math.max(1, Math.round(w / 110)); i++) { const x = 8 + r() * (w - 16), y = B - T * (.5 + r() * .4), s = 1.6 + r() * 1.4;
      glints += `<path class="sz-tw" d="M${f1(x)} ${f1(y - s)}L${f1(x + s * .22)} ${f1(y - s * .22)} ${f1(x + s)} ${f1(y)} ${f1(x + s * .22)} ${f1(y + s * .22)} ${f1(x)} ${f1(y + s)} ${f1(x - s * .22)} ${f1(y + s * .22)} ${f1(x - s)} ${f1(y)} ${f1(x - s * .22)} ${f1(y - s * .22)}Z" fill="#fff" style="--d:${(2.2 + r() * 2.6).toFixed(1)}s;--dl:-${(r() * 4).toFixed(1)}s"/>`; }
    return `<svg width="${f1(w + 12)}" height="${CAP_H}" viewBox="-6 0 ${f1(w + 12)} ${CAP_H}" aria-hidden="true" style="overflow:visible">
      <defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
      <path d="${body}" fill="#000" opacity=".5" transform="translate(0 1.2)" filter="url(#szCapBlur)"/>
      <path d="${body}" fill="url(#szCapSnow)"/>
      <g clip-path="url(#${id})">
        ${holes}
        <path d="${ridge}" fill="none" stroke="#8eaad0" stroke-width="3" opacity=".28" transform="translate(0 3)" filter="url(#szCapBlur)"/>
        <rect x="-8" y="${B - 2.2}" width="${f1(w + 16)}" height="6" fill="url(#szCapUnder)"/>
        ${grains}
      </g>
      <path d="${ridge}" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".95"/>${glints}</svg>`;
  }
  // only boxes you can see: a visible top border or a solid background (not see-through areas like the team skin stage)
  const alpha = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const v = m[1].split(/[ ,\/]+/).filter(Boolean); return v.length > 3 ? parseFloat(v[3]) : 1; };
  function hasEdge(el) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') return false;
    if (el.querySelector(':scope > canvas')) return false;
    return (parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none' && alpha(cs.borderTopColor) > .3) || alpha(cs.backgroundColor) > .5 || cs.backgroundImage !== 'none';
  }
  function placeCaps() {
    if (!capBox) return;
    const els = [...document.querySelectorAll(CAP_SEL)].filter(el => {
      if (el.closest('#nav, .sz-hello, .sc-stage, [hidden], .modal, dialog, [role=dialog]')) return false;   // popups are hidden see-through, not removed
      if (el.parentElement && el.parentElement.closest(CAP_SEL)) return false;   // only the outer box gets snow
      const b = el.getBoundingClientRect(); return b.width >= 90 && b.height >= 36 && hasEdge(el);
    }).slice(0, 70);
    const html = els.map((el, i) => {
      const b = el.getBoundingClientRect(), x = b.left + scrollX, y = b.top + scrollY;
      const W = b.width + 12, L = 6 + 4, R = 6 + b.width - 4, E = CAP_B + 2;   // below the edge only past the box's sides (and its border)
      return `<div style="position:absolute;left:${f1(x - 6)}px;top:${f1(y - CAP_B)}px;width:${f1(W)}px;height:${CAP_H}px;clip-path:polygon(-20px -20px,${f1(W + 20)}px -20px,${f1(W + 20)}px ${CAP_H}px,${f1(R)}px ${CAP_H}px,${f1(R)}px ${E}px,${f1(L)}px ${E}px,${f1(L)}px ${CAP_H}px,-20px ${CAP_H}px)">${capSvg(b.width, i + 1)}</div>`;
    }).join('');
    capBox.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="szCapSnow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#f6faff"/><stop offset=".8" stop-color="#dde8f5"/><stop offset="1" stop-color="#b7c9e1"/></linearGradient><linearGradient id="szCapUnder" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9db6d6" stop-opacity="0"/><stop offset=".45" stop-color="#9db6d6" stop-opacity=".55"/><stop offset="1" stop-color="#6f8db5" stop-opacity=".8"/></linearGradient><filter id="szCapBlur" x="-5%" y="-60%" width="110%" height="220%"><feGaussianBlur stdDeviation="1.1"/></filter><filter id="szCapSoft" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="2.2"/></filter></defs></svg>${html}`;
  }
  const queueCaps = () => { clearTimeout(capT); capT = setTimeout(placeCaps, 350); };
  function startCaps() {
    stopCaps(); if (key !== 'winter' && key !== 'christmas') return;
    capBox = document.createElement('div'); capBox.className = 'sz-caps'; capBox.setAttribute('aria-hidden', 'true'); document.body.appendChild(capBox);
    placeCaps(); setTimeout(placeCaps, 900); setTimeout(placeCaps, 2500);
    // the pages fill in their cards after loading, and images change the layout: place the snow again when that happens
    capMo = new MutationObserver(ms => { if (ms.some(m => !(m.target.closest && m.target.closest('.sz-caps, .sz-deco, .sz-hello')))) queueCaps(); });
    capMo.observe(document.body, { childList: true, subtree: true });
    if ('ResizeObserver' in window) { capRo = new ResizeObserver(queueCaps); capRo.observe(document.body); }
  }
  function stopCaps() { if (capMo) capMo.disconnect(); if (capRo) capRo.disconnect(); capMo = capRo = null; clearTimeout(capT); if (capBox) capBox.remove(); capBox = null; }

  // ================================================================ 3) colour layers, greeting, button
  function layers() {
    document.querySelectorAll('.sz-layer,.sz-sun').forEach(x => x.remove());
    const add = cls => { const d = document.createElement('div'); d.className = cls; d.setAttribute('aria-hidden', 'true'); document.body.appendChild(d); };
    if (key === 'winter') { add('sz-layer sz-aurora'); add('sz-layer sz-frost'); }
    if (key === 'christmas') add('sz-layer sz-frost');
    if (key === 'diwali') add('sz-layer sz-warm');
    if (key === 'pongal') { add('sz-sun'); add('sz-layer sz-warm'); }
    if (key === 'halloween') add('sz-layer sz-gloom');
    if (key === 'monsoon') add('sz-layer sz-storm');
  }
  function greet() {
    const s = SEASONS[key]; if (!s) return;
    const mark = key + ':' + istNow().toISOString().slice(0, 10);
    if (!preview && ls.get('mtcGreet') === mark) return;   // once a day
    ls.set('mtcGreet', mark);
    document.querySelectorAll('.sz-hello').forEach(x => x.remove());
    const h = document.createElement('div'); h.className = 'sz-hello'; h.setAttribute('role', 'status');
    h.style.setProperty('--c', s.c); h.style.setProperty('--c2', s.c2);
    h.innerHTML = `<b>${s.title}</b>${s.sub ? `<span>${s.sub}</span>` : ''}`;
    const nav = document.getElementById('nav'); if (nav) h.style.top = Math.round(nav.getBoundingClientRect().bottom + 78) + 'px';   // below the hanging decorations
    document.body.appendChild(h);
    const bye = () => { if (!h.isConnected) return; h.classList.add('out'); setTimeout(() => h.remove(), 520); };
    h.onclick = bye; setTimeout(bye, 6500);
  }
  const ICON = {
    winter: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9.5 3.5 12 5.5l2.5-2M9.5 20.5 12 18.5l2.5 2M3 10l2.6-1.6L5 5.5M21 14l-2.6 1.6.6 2.9M3 14l2.6 1.6L5 18.5M21 10l-2.6-1.6.6-2.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    christmas: '<path d="M12 2l5 7h-2.6l3.8 6h-3l3.3 5H5.5l3.3-5h-3l3.8-6H7z" fill="currentColor"/><rect x="10.8" y="20" width="2.4" height="2.5" fill="currentColor"/>',
    newyear: '<circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5M5.3 5.3l3.2 3.2M15.5 15.5l3.2 3.2M5.3 18.7l3.2-3.2M15.5 8.5l3.2-3.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    pongal: '<path d="M4.5 11h15l-1.6 8.3a2 2 0 0 1-2 1.7H8.1a2 2 0 0 1-2-1.7z" fill="currentColor"/><path d="M8 11c.3-2.8 1.6-4 4-4s3.7 1.2 4 4M10 6.5c0-1.7.8-3 2-3.5M14 6.5c0-1.7-.8-3-2-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    diwali: '<path d="M3 13.5c1.8 5 16.2 5 18 0z" fill="currentColor"/><path d="M12 3c2.4 3 2.4 5.5 0 8c-2.4-2.5-2.4-5 0-8z" fill="currentColor"/>',
    halloween: '<ellipse cx="12" cy="14" rx="8.5" ry="7" fill="currentColor"/><path d="M12 7c0-2 1-3.4 3-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 12.5l1.5-2 1.5 2zM13 12.5l1.5-2 1.5 2zM8 16c2.5 2 5.5 2 8 0" fill="#0d0804" stroke="#0d0804" stroke-width="1"/>',
    monsoon: '<path d="M7 15a4 4 0 0 1 .4-8A5.2 5.2 0 0 1 17.2 8 3.5 3.5 0 0 1 17 15z" fill="currentColor"/><path d="M8.5 18l-1 3M12.5 18l-1 3M16.5 18l-1 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  };
  function button() {
    let b = document.querySelector('.sz-btn');
    if (!key) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'sz-btn'; document.body.appendChild(b);
      b.onclick = () => { ls.set('mtcFxOff', ls.get('mtcFxOff') === '1' ? '0' : '1'); apply(key); }; }
    const s = SEASONS[key], off = ls.get('mtcFxOff') === '1';
    b.style.setProperty('--c', s.c); b.classList.toggle('off', off);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[key]}</svg><em>${s.name.toUpperCase()} EFFECTS ${off ? 'OFF' : 'ON'}</em>`;
    b.setAttribute('aria-label', `${off ? 'Show' : 'Hide'} the ${s.name.toLowerCase()} effects`);
  }

  // ================================================================ start
  function apply(k) {
    key = SEASONS[k] ? k : ''; addCss(); document.documentElement.dataset.season = key;
    stopFx(); stopCaps(); clearDeco(); document.querySelectorAll('.sz-layer,.sz-sun,.sz-hello').forEach(x => x.remove());
    if (key && ls.get('mtcFxOff') !== '1') { decorate(); layers(); startFx(); startCaps(); greet(); }
    button();
  }
  let rz = 0;
  addEventListener('resize', () => { size(); clearTimeout(rz); rz = setTimeout(() => { if (key && ls.get('mtcFxOff') !== '1') { decorate(); placeCaps(); } }, 200); });
  const start = () => {
    if (preview && (SEASONS[preview] || preview === 'off')) return apply(preview === 'off' ? '' : preview);
    let cached = null; try { cached = JSON.parse(ls.get('mtcTheme') || 'null'); } catch {}
    if (cached && Date.now() - cached.at < 6 * 3600e3) apply(cached.key);   // no wait on the next page
    fetch('/api/theme').then(r => (r.ok ? r.json() : null)).then(j => { if (!j) return; ls.set('mtcTheme', JSON.stringify({ key: j.key, at: Date.now() })); if (!cached || cached.key !== j.key) apply(j.key); }).catch(() => {});
  };
  // the menu bar is drawn by nav.js, so wait a moment for it
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 60)); else setTimeout(start, 60);
})();
