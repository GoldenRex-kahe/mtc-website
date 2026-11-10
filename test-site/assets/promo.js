/* Pop-up video in the bottom-right corner (a trailer or announcement the admins pick in Admin > Events).
   Starts muted (browsers only autoplay muted video); visitors can turn the sound on, make it bigger, shrink it to a tab or close it.
   A closed video stays closed for that visitor until the admins set a new one. */
(function () {
  'use strict';
  if (/\/admin\.html$/.test(location.pathname) || window.__mtcPromo) return; window.__mtcPromo = true;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const ICON = {
    soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="m22 9-6 6M16 9l6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    big: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    small: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    min: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  };
  const css = `
.mtc-promo{position:fixed;right:18px;bottom:18px;z-index:120;width:min(340px,calc(100vw - 36px));background:#150e08;border:3px solid #000;box-shadow:0 0 0 2px var(--accent,#F7931E),0 18px 40px #000c;font-family:Archivo,system-ui,sans-serif;color:#F7EBD8;transform:translateY(calc(100% + 40px));opacity:0;transition:transform .5s cubic-bezier(.2,.9,.3,1.2),opacity .4s,width .35s}
.mtc-promo.in{transform:none;opacity:1}
.mtc-promo.big{width:min(640px,calc(100vw - 36px))}
.mp-top{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 10px;background:linear-gradient(90deg,#2a1608,#150e08)}
.mp-tag{display:inline-flex;align-items:center;gap:6px;flex:none;font:8px "Press Start 2P",monospace;letter-spacing:.05em;padding:5px 7px;background:var(--accent,#F7931E);color:#1a0f05}
.mp-tag i{width:7px;height:7px;border-radius:50%;background:#e0452b;box-shadow:0 0 0 2px #1a0f05;animation:mpBlink 1.2s ease-in-out infinite}
@keyframes mpBlink{50%{opacity:.3}}
.mp-title{flex:1;min-width:0;font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mp-btns{display:flex;gap:4px;flex:none}
.mp-btns button,.mp-pill{display:grid;place-items:center;width:30px;height:30px;padding:0;background:#0d0804;color:#F7EBD8;border:2px solid #000;cursor:pointer;transition:border-color .15s,color .15s}
.mp-btns button:hover,.mp-btns button:focus-visible{border-color:var(--accent,#F7931E);color:var(--accent,#F7931E);outline:none}
.mp-btns svg{width:16px;height:16px}
.mp-vid{position:relative;aspect-ratio:16/9;background:#000}
.mp-vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
.mp-sound{position:absolute;left:10px;bottom:10px;display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#000c;color:#fff;border:2px solid #fff6;font:700 13px Archivo,system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(4px);transition:background .15s}
.mp-sound:hover,.mp-sound:focus-visible{background:var(--accent,#F7931E);color:#1a0f05;border-color:#000;outline:none}
.mp-sound svg{width:18px;height:18px}
.mp-link{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:var(--accent,#F7931E);color:#1a0f05;font:9px "Press Start 2P",monospace;text-decoration:none;border-top:3px solid #000}
.mp-link:hover{background:#ffa83d}
.mtc-promo.min{width:auto}.mtc-promo.min .mp-vid,.mtc-promo.min .mp-link,.mtc-promo.min .mp-top{display:none}
.mp-pill{display:none;width:auto;height:auto;gap:8px;padding:10px 14px 10px 12px;font:9px "Press Start 2P",monospace;border:0;background:#150e08}
.mp-pill svg{width:16px;height:16px;color:var(--accent,#F7931E)}
.mtc-promo.min .mp-pill{display:inline-flex}
@media(max-width:560px){.mtc-promo{right:10px;bottom:10px;width:min(260px,calc(100vw - 20px))}.mtc-promo.big{width:calc(100vw - 20px)}.mp-title{display:none}}
@media(prefers-reduced-motion:reduce){.mtc-promo{transition:none}.mp-tag i{animation:none}}`;
  fetch('/api/promo', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(d => {
    const p = d && d.promo; if (!p) return;
    const home = location.pathname === '/' || /\/index\.html$/.test(location.pathname);
    if (p.pages === 'home' && !home) return;
    if (store.get('mtcPromoClosed') === p.id) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(p.videoId)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(p.videoId)}&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
    const box = document.createElement('aside');
    box.className = 'mtc-promo'; box.setAttribute('aria-label', p.label + (p.title ? ': ' + p.title : ''));
    const label = esc(p.label || 'TRAILER');
    box.innerHTML = `<div class="mp-top"><span class="mp-tag"><i aria-hidden="true"></i>${label}</span><span class="mp-title">${esc(p.title || '')}</span>
        <div class="mp-btns"><button type="button" data-a="big" aria-label="Make bigger" title="Make bigger">${ICON.big}</button><button type="button" data-a="min" aria-label="Minimise" title="Minimise">${ICON.min}</button><button type="button" data-a="close" aria-label="Close" title="Close">${ICON.close}</button></div></div>
      <div class="mp-vid"><iframe src="${esc(src)}" title="${esc(p.title || p.label)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>
        <button type="button" class="mp-sound" data-a="sound" aria-pressed="false">${ICON.soundOff}<span>Tap for sound</span></button></div>
      ${p.link ? `<a class="mp-link" href="${esc(p.link)}"${/^https?:/.test(p.link) && !p.link.startsWith(location.origin) ? ' target="_blank" rel="noopener"' : ''}>${esc(p.linkLabel || 'Learn more')} &rarr;</a>` : ''}
      <button type="button" class="mp-pill" data-a="open" aria-label="Show the ${label.toLowerCase()} video">${ICON.play}${label}</button>`;
    document.body.appendChild(box);
    const frame = box.querySelector('iframe'), cmd = (func, args = []) => { try { frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch {} };
    let sound = false;
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'sound') { sound = !sound; if (sound) { cmd('unMute'); cmd('setVolume', [70]); cmd('playVideo'); } else cmd('mute');
        b.setAttribute('aria-pressed', sound); b.innerHTML = sound ? `${ICON.soundOn}<span>Sound on</span>` : `${ICON.soundOff}<span>Tap for sound</span>`; }
      if (a === 'big') { const on = box.classList.toggle('big'); b.innerHTML = on ? ICON.small : ICON.big; b.setAttribute('aria-label', on ? 'Make smaller' : 'Make bigger'); b.title = b.getAttribute('aria-label'); }
      if (a === 'min') { box.classList.add('min'); cmd('pauseVideo'); }
      if (a === 'open') { box.classList.remove('min'); cmd('playVideo'); }
      if (a === 'close') { cmd('pauseVideo'); store.set('mtcPromoClosed', p.id); box.classList.remove('in'); setTimeout(() => box.remove(), 450); }
    });
    // people who prefer less motion get the small tab instead of a playing video
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) box.classList.add('min');
    setTimeout(() => box.classList.add('in'), 1200);
  }).catch(() => {});
})();
