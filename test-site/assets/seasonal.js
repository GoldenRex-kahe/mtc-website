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
  .sz-deco{position:absolute;left:0;right:0;top:100%;height:60px;margin-top:-3px;pointer-events:none;z-index:2;transition:opacity .45s,transform .45s}
  .mtcnav.clear .sz-deco{opacity:0;transform:translateY(-8px)}
  .sz-deco svg{position:absolute;left:0;top:0;overflow:visible}
  .sz-cap{position:absolute;left:2px;top:-6px;width:32px;height:11px;pointer-events:none;z-index:2;filter:drop-shadow(0 2px 1px #0006)}
  .mtcnav .brand{position:relative}
  .sz-tw{animation:szTw 2.6s ease-in-out infinite}
  .sz-drip{animation:szDrip 3.4s cubic-bezier(.55,0,1,.45) infinite;opacity:0}
  .sz-bulb{animation:szBulb 2.4s steps(1) infinite}
  .sz-flame{transform-box:fill-box;transform-origin:50% 100%;animation:szFlame .8s ease-in-out infinite alternate}
  .sz-spider{animation:szSpider 4.5s ease-in-out infinite}
  @keyframes szTw{0%,100%{opacity:.2}50%{opacity:1}}
  @keyframes szDrip{0%,55%{transform:translateY(0);opacity:0}60%{opacity:.95}100%{transform:translateY(34px);opacity:0}}
  @keyframes szBulb{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes szFlame{to{transform:scale(.82,1.18);opacity:.85}}
  @keyframes szSpider{0%,100%{transform:translateY(0)}50%{transform:translateY(16px)}}
  .sz-sun{position:fixed;right:-140px;top:-140px;width:420px;height:420px;border-radius:50%;pointer-events:none;z-index:1;background:radial-gradient(#ffd16655,#ff9f1c22 45%,#0000 70%)}
  .sz-btn{position:fixed;left:12px;bottom:12px;z-index:46;display:inline-flex;align-items:center;gap:7px;padding:7px 10px;font:8px 'Press Start 2P',monospace;letter-spacing:.06em;color:#f7ebd8;background:#0d0804cc;border:2px solid #000;box-shadow:inset 0 -2px 0 #f7931e;cursor:pointer;opacity:.75}
  .sz-btn:hover,.sz-btn:focus-visible{opacity:1}.sz-btn i{width:8px;height:8px;background:#5fd35f}.sz-btn.off i{background:#a63a2b}
  @media(prefers-reduced-motion:reduce){.sz-tw,.sz-drip,.sz-bulb,.sz-flame,.sz-spider{animation:none}.sz-drip{opacity:0}}
  @media print{.sz-fx,.sz-btn,.sz-deco,.sz-cap,.sz-sun{display:none}}`;
  const addCss = () => { if (document.getElementById('szCss')) return; const s = document.createElement('style'); s.id = 'szCss'; s.textContent = css; document.head.appendChild(s); };

  // ---------------------------------------------------------------- decorations hanging from the navbar
  // a fixed "random" sequence, so the drift looks the same on every page and does not jump on resize
  const rnd = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const U = 4;   // one pixel block
  function snowSvg(W) {
    const r = rnd(7), cols = Math.ceil(W / U) + 1, hs = [];
    let h = 3; for (let i = 0; i < cols; i++) { if (r() < .35) h += r() < .5 ? -1 : 1; h = Math.max(2, Math.min(6, h)); hs.push(h); }
    // stepped outline of the drift
    let d = `M0 -3H${cols * U}`; for (let i = cols - 1; i >= 0; i--) d += `V${hs[i] * U}H${i * U}`; d += 'Z';
    const ice = [], drips = [], tw = [];
    let x = 30 + r() * 60;
    while (x < W - 20) {
      const i = Math.floor(x / U), top = hs[i] * U, len = 2 + Math.floor(r() * 5), w0 = len > 4 ? 3 : 2, px = i * U;
      for (let k = 0; k < len; k++) { const w = Math.max(1, w0 - Math.floor(k * w0 / len)); const off = Math.floor((w0 - w) / 2) * U;
        ice.push(`<rect x="${px + off}" y="${top + k * U}" width="${w * U}" height="${U}" fill="${k === len - 1 ? '#9fd0f5' : '#cfe8fb'}"/>`, `<rect x="${px + off}" y="${top + k * U}" width="${U / 2}" height="${U}" fill="#fff" opacity=".8"/>`); }
      if (r() < .45) drips.push(`<rect class="sz-drip" x="${px + Math.floor(w0 / 2) * U}" y="${top + len * U}" width="3" height="4" fill="#bfe3ff" style="animation-delay:${(r() * 3.4).toFixed(2)}s"/>`);
      x += 45 + r() * 110;
    }
    for (let k = 0; k < Math.round(W / 70); k++) { const i = Math.floor(r() * cols); tw.push(`<rect class="sz-tw" x="${i * U + 1}" y="${1 + Math.floor(r() * (hs[i] - 1)) * U}" width="2" height="2" fill="${r() < .5 ? '#fff' : '#cfe8ff'}" style="animation-delay:${(r() * 2.6).toFixed(2)}s"/>`); }
    return `<svg width="${W}" height="60" viewBox="0 0 ${W} 60" shape-rendering="crispEdges"><defs><linearGradient id="szSnow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".65" stop-color="#eef6ff"/><stop offset="1" stop-color="#cfe2f7"/></linearGradient></defs>
      <path d="${d}" fill="#000" opacity=".35" transform="translate(0 3)"/><path d="${d}" fill="url(#szSnow)"/><path d="M0 -3H${cols * U}V1H0Z" fill="#fff"/>${ice.join('')}${drips.join('')}${tw.join('')}</svg>`;
  }
  // a wire hanging in swags between hooks, with things placed along it
  function swags(W, gap, sag) {
    const n = Math.max(2, Math.round(W / gap)), step = W / n, out = [];
    for (let i = 0; i < n; i++) out.push({ x0: i * step, x1: (i + 1) * step, sag });
    const at = (s, t) => ({ x: (1 - t) * (1 - t) * s.x0 + 2 * (1 - t) * t * ((s.x0 + s.x1) / 2) + t * t * s.x1, y: 2 * (1 - t) * t * (s.sag * 2) + 1 });
    const wire = out.map(s => `M${s.x0} 1Q${(s.x0 + s.x1) / 2} ${s.sag * 2 + 1} ${s.x1} 1`).join('');
    return { list: out, at, wire };
  }
  function lightsSvg(W, colors) {
    const { list, at, wire } = swags(W, 130, 11), bulbs = []; let n = 0;
    for (const s of list) for (const t of [.17, .39, .61, .83]) {
      const p = at(s, t), c = colors[n % colors.length], dl = (n % 3) * .8;
      bulbs.push(`<g class="sz-bulb" style="animation-delay:${dl}s"><rect x="${p.x - 2}" y="${p.y}" width="4" height="3" fill="#2b2b2b"/><ellipse cx="${p.x}" cy="${p.y + 7}" rx="3.6" ry="5" fill="${c}" style="filter:drop-shadow(0 0 4px ${c}) drop-shadow(0 0 9px ${c}88)"/><rect x="${p.x - 1.6}" y="${p.y + 4}" width="1.4" height="2.4" fill="#fff" opacity=".7"/></g>`);
      n++;
    }
    return `<svg width="${W}" height="60" viewBox="0 0 ${W} 60"><path d="${wire}" fill="none" stroke="#14301c" stroke-width="2"/>${bulbs.join('')}</svg>`;
  }
  function torSvg(W) {   // Diwali: marigold garland with diyas hanging at the low points, mango leaves at the hooks
    const { list, at, wire } = swags(W, 150, 13), flowers = [], diyas = [], leaves = [];
    for (const s of list) {
      for (let t = 0; t <= 1.0001; t += .045) { const p = at(s, t), c = Math.round(t / .045) % 3 ? '#ff9f1c' : '#ffd23f'; flowers.push(`<circle cx="${p.x}" cy="${p.y + 2}" r="3.4" fill="${c}"/><circle cx="${p.x}" cy="${p.y + 2}" r="1.2" fill="#e85d04"/>`); }
      const m = at(s, .5), y = m.y + 6;
      diyas.push(`<line x1="${m.x}" y1="${m.y + 4}" x2="${m.x}" y2="${y + 6}" stroke="#7a4a1a" stroke-width="1"/><path d="M${m.x - 8} ${y + 9}h16l-3 6h-10z" fill="#b5651d"/><path d="M${m.x - 8} ${y + 9}h16v2h-16z" fill="#d98a3a"/>
        <ellipse class="sz-flame" cx="${m.x}" cy="${y + 4.5}" rx="2.4" ry="4.4" fill="#ffd166" style="filter:drop-shadow(0 0 5px #ffb627) drop-shadow(0 0 10px #ff9f1c88)"/>`);
      leaves.push(`<path d="M${s.x0} 2l-5 12l5-3l5 3z" fill="#2d8a3e"/><path d="M${s.x0} 2v10" stroke="#1e5c29" stroke-width="1"/>`);
    }
    return `<svg width="${W}" height="60" viewBox="0 0 ${W} 60"><path d="${wire}" fill="none" stroke="#5a3a12" stroke-width="2"/>${leaves.join('')}${flowers.join('')}${diyas.join('')}</svg>`;
  }
  function webSvg(W) {   // Halloween: a cobweb in the corner and a spider on a thread
    const cx = W - 4, rings = [12, 22, 32, 42], spokes = [100, 125, 150, 175];
    const pt = (r, a) => [cx + r * Math.cos(a * Math.PI / 180), r * Math.sin(a * Math.PI / 180)];
    const lines = spokes.map(a => { const [x, y] = pt(48, a); return `<line x1="${cx}" y1="0" x2="${x}" y2="${y}"/>`; }).join('');
    const arcs = rings.map(r => { const p = spokes.map(a => pt(r, a)); return `<path d="M${p.map(q => q.join(' ')).join(' L')}" fill="none"/>`; }).join('');
    const sx = Math.round(W * .62);
    return `<svg width="${W}" height="60" viewBox="0 0 ${W} 60"><g stroke="#ffffff55" stroke-width="1">${lines}${arcs}</g>
      <g class="sz-spider"><line x1="${sx}" y1="0" x2="${sx}" y2="18" stroke="#ffffff66"/><rect x="${sx - 4}" y="18" width="8" height="7" fill="#120a1a"/><rect x="${sx - 3}" y="16" width="6" height="3" fill="#120a1a"/>
      <g stroke="#120a1a" stroke-width="1.4"><path d="M${sx - 4} 20h-4l-2 3M${sx - 4} 23h-5l-1 4M${sx + 4} 20h4l2 3M${sx + 4} 23h5l1 4"/></g><rect x="${sx - 2}" y="19" width="1.5" height="1.5" fill="#ff7b00"/><rect x="${sx + .5}" y="19" width="1.5" height="1.5" fill="#ff7b00"/></g></svg>`;
  }
  function dripsSvg(W) {   // Monsoon: water running off the edge
    const r = rnd(11), d = [];
    for (let x = 20 + r() * 40; x < W - 10; x += 30 + r() * 70) d.push(`<rect class="sz-drip" x="${Math.round(x)}" y="0" width="3" height="5" fill="#9cc8ff" style="animation-delay:${(r() * 3.4).toFixed(2)}s;animation-duration:${(2.2 + r() * 2).toFixed(2)}s"/>`);
    return `<svg width="${W}" height="60" viewBox="0 0 ${W} 60" shape-rendering="crispEdges"><rect x="0" y="-3" width="${W}" height="3" fill="#9cc8ff" opacity=".5"/>${d.join('')}</svg>`;
  }
  const CAP = `<svg class="sz-cap" viewBox="0 0 48 18" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 18V12H6V8H12V5H20V3H30V5H36V8H42V12H46V18Z" fill="#fff"/><path d="M2 18V15H46V18Z" fill="#cfe2f7"/><path d="M12 8H16V6H12Z M28 5H32V7H28Z" fill="#eaf4ff"/><rect x="20" y="4" width="2" height="2" fill="#cfe8ff" class="sz-tw"/></svg>`;
  function decorate() {
    document.querySelectorAll('.sz-deco,.sz-cap,.sz-sun').forEach(x => x.remove());
    const nav = document.getElementById('nav'); if (!nav) return;
    const W = Math.max(320, nav.getBoundingClientRect().width || innerWidth);
    const svg = key === 'winter' ? snowSvg(W) : key === 'christmas' ? snowSvg(W) + lightsSvg(W, ['#ff3b30', '#ffd60a', '#30d158', '#64d2ff'])
      : key === 'newyear' ? lightsSvg(W, ['#ffd60a', '#f5f5f5', '#bf5af2', '#ff9f0a']) : key === 'diwali' ? torSvg(W) : key === 'halloween' ? webSvg(W) : key === 'monsoon' ? dripsSvg(W) : '';
    if (svg) { const d = document.createElement('div'); d.className = 'sz-deco'; d.setAttribute('aria-hidden', 'true'); d.innerHTML = svg; nav.appendChild(d); }
    if (key === 'winter' || key === 'christmas') { const b = nav.querySelector('.brand'); if (b) b.insertAdjacentHTML('afterbegin', CAP); }
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
  let rz = 0; addEventListener('resize', () => { size(); clearTimeout(rz); rz = setTimeout(() => { if (key && store.get('mtcFxOff') !== '1') decorate(); }, 200); });

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
    if (key && !off) { decorate(); startFx(); } else { stopFx(); document.querySelectorAll('.sz-deco,.sz-cap,.sz-sun').forEach(x => x.remove()); }
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
