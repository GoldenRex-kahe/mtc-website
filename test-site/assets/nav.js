/* Site navbar, shared by every page. Put <header id="nav"></header> in the page and load this script.
   Highlights the current page; on the home page it follows the section you have scrolled to. */
(function () {
  'use strict';
  const el = document.getElementById('nav'); if (!el) return;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const path = location.pathname.replace(/\/index\.html$/, '/');
  const home = path === '/';
  const LINKS = [['home', 'Home', '/'], ['events', 'Events', '/#events'], ['team', 'Team', '/#team'], ['creators', 'Creators', '/#creators'],
    ['showcase', 'Showcase', '/#showcase'], ['leaderboard', 'Leaderboard', '/leaderboard.html'], ['community', 'Community', '/community.html'], ['about', 'About', '/#about']];
  const pageKey = { '/event.html': 'events', '/account.html': 'account', '/admin.html': 'admin', '/leaderboard.html': 'leaderboard', '/community.html': 'community' }[path] || '';

  el.className = 'mtcnav' + (home ? ' clear' : '');
  el.setAttribute('aria-label', 'Site');
  el.innerHTML = `<a class="brand" href="/"><img src="/assets/logo.png" alt=""><span>MTC</span></a>
    <ul id="navList">
      ${LINKS.map(([k, label, href]) => `<li><a href="${href}" data-k="${k}">${label}</a></li>`).join('')}
      <li id="navAdmin" hidden><a href="/admin.html" data-k="admin">Admin</a></li>
      <li class="mobile"><a class="join-link" href="/apply.html">APPLY TO JOIN MTC</a></li>
    </ul>
    <a class="acct out" id="navWho" href="/account.html" data-k="account"><span>LOG IN</span></a>
    <a class="join join-link" href="/apply.html">JOIN</a>
    <button class="menu" id="menuBtn" type="button" aria-expanded="false" aria-controls="navList">MENU</button>`;

  /* highlight */
  function mark(key) {
    el.querySelectorAll('[data-k]').forEach(a => {
      if (a.dataset.k === key) a.setAttribute('aria-current', pageKey ? 'page' : 'location'); else a.removeAttribute('aria-current');
    });
  }
  mark(pageKey);

  /* home: follow the section in view, and keep the bar see-through over the hero */
  if (home) {
    const ids = { top: 'home', events: 'events', team: 'team', creators: 'creators', showcase: 'showcase', about: 'about', join: '' };
    // whichever section crosses the middle of the screen is the current one
    const secs = Object.keys(ids).map(id => [document.getElementById(id), ids[id]]).filter(([n]) => n);
    let raf = 0;
    const spy = () => { raf = 0; const mid = innerHeight / 2;
      const hit = secs.find(([n]) => { const r = n.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
      mark(hit ? hit[1] : ''); };
    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(spy); }, { passive: true });
    addEventListener('resize', spy); setTimeout(spy, 300);
    const onScroll = () => el.classList.toggle('clear', scrollY < 60);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  /* pop-up video (trailer / announcement) set in Admin > Events */
  if (path !== '/admin.html') { const ps = document.createElement('script'); ps.src = '/assets/promo.js'; ps.defer = true; document.body.appendChild(ps); }

  /* phone menu */
  const b = el.querySelector('#menuBtn');
  const set = o => { el.classList.toggle('open', o); b.setAttribute('aria-expanded', o); b.textContent = o ? 'CLOSE' : 'MENU'; };
  b.addEventListener('click', () => set(!el.classList.contains('open')));
  el.querySelectorAll('ul a').forEach(a => a.addEventListener('click', () => set(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  document.addEventListener('click', e => { if (el.classList.contains('open') && !el.contains(e.target)) set(false); });

  /* who is logged in, admin link, Discord invite */
  fetch('/api/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(d => {
    if (!d) return;
    const u = d.user;
    // members open the Discord; everyone else applies on the website
    if (d.invite && u && u.inGuild) el.ownerDocument.querySelectorAll('.join-link').forEach(a => { a.href = d.invite; a.target = '_blank'; a.rel = 'noopener'; });
    if (!u) return;
    const w = el.querySelector('#navWho');
    w.classList.remove('out');
    w.innerHTML = `${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<b class="ini" aria-hidden="true">${esc([...u.name][0] || '?')}</b>`}<span>${esc(u.name)}</span>`;
    w.setAttribute('aria-label', 'Your account: ' + u.name);
    if (u.admin) el.querySelector('#navAdmin').hidden = false;
    if (d.maintenance) { const bar = document.createElement('a'); bar.href = '/admin.html'; bar.className = 'setupbar'; bar.style.background = '#c0392b'; bar.style.color = '#fff';
      bar.textContent = '🔒 Admin-only mode is ON: visitors see the "Back soon" page. Turn it off in Admin.'; el.appendChild(bar); }
    if (u.needsSetup && u.inGuild && !/\/account\.html$/.test(location.pathname)) {
      const bar = document.createElement('a'); bar.href = '/account.html'; bar.className = 'setupbar';
      bar.textContent = 'Finish setting up: add your Minecraft username →'; el.appendChild(bar);
    }
    mark(pageKey || (el.querySelector('[aria-current]') || {}).dataset?.k || '');
  }).catch(() => {});
})();
