/* Text formatting for everything admins and members write (event descriptions, rules, notes, announcements).
   Same marks as Discord, so a post looks the same on the site and in Discord:
     **bold**  *italic*  __underline__  ~~strike~~  `code`  [text](https://link)  plain https:// links
     # Heading   - list item   1. numbered item   > quote
     ```lang  (code block, e.g. a Minecraft command, closed with ```), shown with a COPY button
   Everything is escaped first, so nobody can inject HTML. */
(function () {
  'use strict';
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(text) {
    const keep = [];
    const stash = html => `\u0000${keep.push(html) - 1}\u0000`;
    let s = String(text);
    s = s.replace(/`{3}([^`\n]+)`{3}|``([^`\n]+)``|`([^`\n]+)`/g, (m, a, b, c) => stash(`<code>${esc(a || b || c)}</code>`));
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => stash(`<a href="${esc(u)}" target="_blank" rel="noopener nofollow">${inline(t)}</a>`));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,!?:;'"])/g, (m, pre, u) => pre + stash(`<a href="${esc(u)}" target="_blank" rel="noopener nofollow">${esc(u)}</a>`));
    s = esc(s)
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<u>$1</u>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
  }

  function md(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    const out = []; let para = [], list = null, code = null;
    const flushCode = () => { if (code) { const body = code.lines.join('\n').replace(/^\n+|\n+$/g, '');
      out.push(`<div class="md-code">${code.lang ? `<span class="md-lang">${esc(code.lang)}</span>` : ''}<button type="button" class="md-copy" aria-label="Copy code">COPY</button><pre><code>${esc(body)}</code></pre></div>`); code = null; } };
    const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (code) { if (/^\s*`{3,}\s*$/.test(line)) flushCode(); else code.lines.push(raw); continue; }
      if ((m = /^\s*`{3,}\s*([\w+-]*)\s*$/.exec(line))) { flushPara(); flushList(); code = { lang: m[1], lines: [] }; continue; }
      if ((m = /^\s*`{3}(.+?)`{3}\s*$/.exec(line))) { flushPara(); flushList(); code = { lang: '', lines: [m[1]] }; flushCode(); continue; }   // ```one line``` (like Discord)
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = /^\s*#{1,3}\s+(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
      if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      flushList(); para.push(line);
    }
    flushPara(); flushList(); flushCode();   // an unclosed block runs to the end
    return out.join('');
  }
  // one-line version (cards, captions): keeps bold/italic/links, drops block structure
  const mdLine = src => inline(String(src == null ? '' : src).replace(/\s*\n+\s*/g, ' ').replace(/(^|\s)[#>]+\s/g, '$1'));

  // one listener for every COPY button the formatter makes, wherever the text is shown
  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('.md-copy'); if (!b) return;
    const text = b.parentNode.querySelector('code').textContent;
    const done = ok => { b.textContent = ok ? 'COPIED' : 'PRESS CTRL+C'; setTimeout(() => { b.textContent = 'COPY'; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else { const r = document.createRange(); r.selectNodeContents(b.parentNode.querySelector('code')); getSelection().removeAllRanges(); getSelection().addRange(r); done(false); }
  });
  window.MTCmd = { md, mdLine, esc };
})();
