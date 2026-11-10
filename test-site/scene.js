/* MTC wallpaper scenes: puts any Minecraft skin onto the posed players in a wallpaper.
   Each player is a UV map (which skin texel belongs on each pixel) plus a lighting layer. */
(function () {
  'use strict';
  const OPTS = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  const BG = {
    looking: 'assets/bg/looking.jpg',
    atriptothenether: 'assets/bg/atriptothenether.jpg',
    broadcasting: 'assets/bg/broadcasting.jpg',
    totheend: 'assets/bg/totheend.jpg'
  };
  const LABEL = { looking: 'OVERWORLD', atriptothenether: 'NETHER', totheend: 'END', broadcasting: 'STUDIO' };
  const ORDER = ['looking', 'atriptothenether', 'totheend', 'broadcasting'];
  const CH = { r: 0, g: 1, b: 2 };
  const STEVE = 'https://mc-heads.net/skin/MHF_Steve';
  const mcSkin = n => '/api/skin/' + encodeURIComponent(n);

  let scenes = null;
  const cache = new Map();
  const blobOf = async s => (s instanceof Blob ? s : (await fetch(s, { mode: 'cors' })).blob());
  const bmp = async s => createImageBitmap(await blobOf(s), OPTS);
  function dataOf(b) {
    const c = document.createElement('canvas'); c.width = b.width; c.height = b.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(b, 0, 0);
    return x.getImageData(0, 0, b.width, b.height);
  }
  function layerData(src) {
    if (!cache.has(src)) cache.set(src, bmp(src).then(dataOf).catch(e => { cache.delete(src); throw e; }));
    return cache.get(src);
  }
  async function getScenes() {
    if (!scenes) scenes = await (await fetch('assets/scenes/scenes.json')).json();
    return scenes;
  }

  const blank = () => new ImageData(64, 64);
  function copy(src, dst, sx, sy, sw, sh, dx, dy) {
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      const s = ((sy + j) * 64 + sx + i) * 4, d = ((dy + j) * 64 + dx + i) * 4;
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1]; dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = src.data[s + 3];
    }
  }
  /* skin -> { c: base+outer 64x64 (slim arms widened), f: outer layers moved onto the base layout } */
  async function skinFrom(src) {
    const b = await bmp(src);
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = false;
    x.drawImage(b, 0, 0);
    let d = x.getImageData(0, 0, 64, 64);
    if (b.height < 64) { /* old 64x32 skin: reuse right limbs for the left side */
      copy(d, d, 0, 16, 16, 16, 16, 48); copy(d, d, 40, 16, 16, 16, 32, 48);
    }
    let c = d;
    if (d.data[(17 * 64 + 51) * 4 + 3] === 0) { /* slim (3px) arms: widen to 4px */
      c = blank(); copy(d, c, 0, 0, 64, 64, 0, 0);
      [[48, 16, 2, 16, 50, 16], [52, 20, 2, 12, 54, 20], [40, 48, 2, 16, 42, 48], [44, 52, 2, 12, 46, 52]].forEach(r => copy(d, c, ...r));
    }
    const f = blank();
    [[0, 32, 16, 16, 0, 16], [0, 48, 16, 16, 16, 48], [48, 48, 16, 16, 32, 48], [40, 32, 16, 16, 40, 16], [16, 32, 24, 16, 16, 16]].forEach(r => copy(c, f, ...r));
    return { c, f };
  }

  function luts(scale, w, h) {
    const u = new Int32Array(256), v = new Int32Array(256);
    for (let a = 0; a < 256; a++) {
      const o = Math.floor(a / scale * w), s = Math.floor(a / scale * h);
      u[a] = o >= 0 && o < w ? o * 4 : -1; v[a] = s >= 0 && s < h ? s * w * 4 : -1;
    }
    return { u, v };
  }
  /* body layer: base skin with the outer layer blended on top, lit by the lighting layer */
  function shadePlayer(uv, il, skin, L) {
    const hasUV = !!(L.u && L.v), ui = hasUV ? CH[L.u] : 0, vi = hasUV ? CH[L.v] : 2;
    const o = uv.data, s = il && il.data, bs = skin.c.data, ov = skin.f.data;
    const out = new ImageData(uv.width, uv.height), c = out.data, lt = luts(L.hd ? 256 : 64, 64, 64);
    for (let e = 0; e < o.length; e += 4) {
      const al = o[e + 3]; if (!al) continue;
      const a = o[e + ui], d = o[e + vi];
      let t, r, n;
      if (s) { t = s[e] / 255; r = s[e + 1] / 255; n = s[e + 2] / 255; } else t = r = n = o[e + 1] / 255;
      const x = lt.u[a], y = lt.v[d]; if (x < 0 || y < 0) continue;
      const p = y + x;
      let br = 0, bg = 0, bb = 0, ba = 0, or = 0, og = 0, ob = 0, oa = 0;
      if (bs[p + 3]) { br = bs[p] * t; bg = bs[p + 1] * r; bb = bs[p + 2] * n; ba = bs[p + 3] * al / 255; }
      if (ov[p + 3]) { or = ov[p] * t; og = ov[p + 1] * r; ob = ov[p + 2] * n; oa = ov[p + 3] * al / 255; }
      if (!oa) { if (!ba) continue; c[e] = br; c[e + 1] = bg; c[e + 2] = bb; c[e + 3] = ba; }
      else if (oa >= 255 || !ba) { c[e] = or; c[e + 1] = og; c[e + 2] = ob; c[e + 3] = oa; }
      else { const k = oa / 255, m = ba / 255 * (1 - k), z = k + m; c[e] = (or * k + br * m) / z; c[e + 1] = (og * k + bg * m) / z; c[e + 2] = (ob * k + bb * m) / z; c[e + 3] = 255 * z; }
    }
    return out;
  }
  /* head layer: the hat/helmet layer, sampled straight from the skin */
  function shadeHat(uv, il, base, L) {
    const hasUV = !!(L.u && L.v), ui = hasUV ? CH[L.u] : 0, vi = hasUV ? CH[L.v] : 2;
    const o = uv.data, s = il && il.data, bs = base.data;
    const out = new ImageData(uv.width, uv.height), c = out.data, lt = luts(L.hd ? 256 : 64, 64, 64);
    for (let e = 0; e < o.length; e += 4) {
      const al = o[e + 3]; if (!al) continue;
      const x = lt.u[o[e + ui]], y = lt.v[o[e + vi]]; if (x < 0 || y < 0) continue;
      const p = y + x, a = bs[p + 3]; if (!a) continue;
      let r = bs[p], g = bs[p + 1], b = bs[p + 2];
      if (s) { r = r * s[e] / 255; g = g * s[e + 1] / 255; b = b * s[e + 2] / 255; } else { const t = o[e + 1] / 255; r *= t; g *= t; b *= t; }
      c[e] = r; c[e + 1] = g; c[e + 2] = b; c[e + 3] = a * al / 255;
    }
    return out;
  }

  async function compose(slug, srcs, canvas) {
    const sc = (await getScenes())[slug];
    const bg = await bmp(BG[slug]);
    canvas.width = bg.width; canvas.height = bg.height;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bg, 0, 0);
    const k = canvas.width / 3840;
    const groups = [...new Set(sc.map(l => l.group))].sort();
    for (const g of groups) {
      const skin = await skinFrom(srcs[g] || srcs[0] || STEVE);
      const ls = sc.filter(l => l.group === g).sort((a, b) => (a.kind === 'player' ? 0 : 1) - (b.kind === 'player' ? 0 : 1));
      for (const l of ls) {
        const uv = await layerData(l.src), il = l.illum ? await layerData(l.illum) : null;
        const out = l.kind === 'player' ? shadePlayer(uv, il, skin, l) : shadeHat(uv, il, skin.c, l);
        const off = document.createElement('canvas'); off.width = out.width; off.height = out.height;
        off.getContext('2d').putImageData(out, 0, 0);
        ctx.drawImage(off, l.x * k, l.y * k, out.width * k, out.height * k);
      }
    }
    return groups.length;
  }

  /* ---------- UI ---------- */
  const HTML = `<div class="modal" id="sceneModal" role="dialog" aria-modal="true" aria-label="Wallpaper maker">
  <div class="panel scenepanel">
    <button class="x" id="sClose" aria-label="Close">✕</button>
    <div class="sview"><canvas id="sCanvas"></canvas><div class="sload on" id="sLoad">RENDERING...</div></div>
    <div class="sctl">
      <h3 class="px" style="font-size:14px">MAKE A WALLPAPER</h3>
      <p class="none">Pick a scene, then put any skin on the players.</p>
      <div class="srow" id="sScenes"></div>
      <div id="sPlayers" style="display:grid;gap:10px"></div>
      <div class="rowbtns"><button class="btn" id="sDl">DOWNLOAD</button></div>
      <p class="none" id="sErr"></p>
    </div>
  </div>
</div>`;
  const S = { slug: 'totheend', srcs: [], names: [], n: 1, busy: 0 };
  const $ = s => document.querySelector(s);

  async function render() {
    const my = ++S.busy; $('#sLoad').classList.add('on'); $('#sErr').textContent = '';
    try {
      S.n = await compose(S.slug, S.srcs, $('#sCanvas'));
    } catch (e) {
      if (my === S.busy) $('#sErr').textContent = 'Could not render. Check the username or skin file and try again.';
      console.error(e);
    }
    if (my === S.busy) { $('#sLoad').classList.remove('on'); drawPlayers(); }
  }
  function drawPlayers() {
    const box = $('#sPlayers'); box.innerHTML = '';
    for (let i = 0; i < S.n; i++) {
      const row = document.createElement('div'); row.className = 'prow';
      row.innerHTML = `<b class="px" style="font-size:9px">PLAYER ${i + 1}: ${S.names[i] || 'CUSTOM'}</b>
        <div style="display:flex;gap:8px"><input type="text" placeholder="Minecraft username" aria-label="Player ${i + 1} username"><button class="sbtn">CHANGE</button></div>
        <input type="file" accept="image/png" aria-label="Player ${i + 1} skin file">`;
      const inp = row.querySelector('input[type=text]');
      const go = () => { const v = inp.value.trim(); if (!v) return; S.srcs[i] = mcSkin(v); S.names[i] = v.toUpperCase(); render(); };
      row.querySelector('button').onclick = go;
      inp.onkeydown = e => { if (e.key === 'Enter') go(); };
      row.querySelector('input[type=file]').onchange = e => { const f = e.target.files[0]; if (!f) return; S.srcs[i] = f; S.names[i] = 'FILE'; render(); };
      box.appendChild(row);
    }
  }
  function drawScenes() {
    $('#sScenes').innerHTML = ORDER.map(k => `<button class="sbtn${k === S.slug ? ' on' : ''}" data-k="${k}">${LABEL[k]}</button>`).join('');
  }
  function build() {
    if ($('#sceneModal')) return;
    document.body.insertAdjacentHTML('beforeend', HTML);
    $('#sClose').onclick = close;
    $('#sceneModal').addEventListener('click', e => { if (e.target.id === 'sceneModal') close(); });
    $('#sScenes').onclick = e => { const b = e.target.closest('button[data-k]'); if (!b) return; S.slug = b.dataset.k; drawScenes(); render(); };
    $('#sDl').onclick = () => $('#sCanvas').toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mtc-wallpaper-' + S.slug + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
    addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sceneModal').classList.contains('open')) { e.stopImmediatePropagation(); close(); } }, true);
  }
  function open(opt) {
    build();
    S.srcs = [opt.skin || STEVE, opt.skin2 || 'assets/skin2.png'];
    S.names = [(opt.name || '').toUpperCase(), (opt.name2 || 'EVIL_GOD_NK').toUpperCase()];
    S.slug = opt.scene || 'totheend';
    drawScenes(); $('#sceneModal').classList.add('open'); render();
  }
  function close() { $('#sceneModal').classList.remove('open'); }
  window.MTCScene = { open, compose, close };
})();
