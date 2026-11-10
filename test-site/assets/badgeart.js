/* MTC pixel badges: one octagon medal layout for every badge (a metal rim, a two-tone face and a 10x10 pixel icon).
   Used by the admin badge maker in the browser and by the server, which turns a design into the SVG file people see.
   A design is { metal, face: '#rrggbb', map: ['10 characters', ... 10 rows] } using the letters in PAL ('.' = empty). */
(function (root) {
  'use strict';
  const PAL = { W: '#ffffff', Y: '#ffd23f', L: '#fff6b8', O: '#e8861a', K: '#1a0f05', G: '#c9cdd2', D: '#7d838a', R: '#e0452b', M: '#8e1f12', B: '#4aa3ff', C: '#5ee6e6', N: '#8a5a1c', E: '#5fd35f', F: '#2e8b2e', P: '#c79bff', I: '#ff8fc8' };
  const METAL = { gold: ['#fff1a8', '#ffd23f', '#b8860b'], silver: ['#ffffff', '#cfd5db', '#7d838a'], bronze: ['#ffd0a0', '#d08a4a', '#7a4a1f'], ember: ['#ffd9a8', '#f7931e', '#9a5a0c'],
    violet: ['#ecdcff', '#a97be8', '#5b3d8a'], diamond: ['#e8ffff', '#5ee6e6', '#1f8a8a'], emerald: ['#d8ffd8', '#3fcf5a', '#1a6b2a'], redstone: ['#ffb3a8', '#e0452b', '#7a1a10'], netherite: ['#a8a0a8', '#4a4248', '#1e1a1e'] };
  const METAL_NAMES = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', ember: 'MTC orange', violet: 'Amethyst', diamond: 'Diamond', emerald: 'Emerald', redstone: 'Redstone', netherite: 'Netherite' };
  const m = s => s.trim().split('\n').map(r => r.trim());
  // starting points for the badge maker (the 11 automatic badges use the first ones)
  const PRESETS = {
    first: { name: 'Controller', metal: 'bronze', face: '#2f5f9e', map: m(`..........\n..........\n.KKKKKKKK.\nKGGGGGGGGK\nKGKGGGGRGK\nKKKKGGRGRK\nKGKGGGGRGK\nKGGGKKGGGK\n.KKK..KKK.\n..........`) },
    regular: { name: 'Flame', metal: 'bronze', face: '#8a2c14', map: m(`....R.....\n...RR.....\n...RRR.R..\n..RRORRR..\n..ROOORR..\n.RROYOORR.\n.ROYYYOOR.\n.ROYLLYOR.\n..RYLLYR..\n...RRRR...`) },
    veteran: { name: 'Medal', metal: 'silver', face: '#6b4a2b', map: m(`.BB....BB.\n..BB..BB..\n...BWWB...\n...YYYY...\n..YLLLYY..\n.YLYYYYOY.\n.YLYYYYOY.\n.YYYYYOOY.\n..YYOOOY..\n...YYYY...`) },
    podium: { name: 'Podium', metal: 'silver', face: '#5a4632', map: m(`....YY....\n...YLLY...\n....YY....\n...GGGG...\n...GWWG...\nNNNGWWGOOO\nNOWGGGGOWO\nNNNGGGGOOO\nNNNGGGGOOO\nKKKKKKKKKK`) },
    winner: { name: 'Trophy', metal: 'gold', face: '#7a5a12', map: m(`.YYYYYYYY.\nYYLLYYYYOY\nY.YLYYYO.Y\nY.YLYYYO.Y\n.YYLYYYOY.\n..YYYYOY..\n....YO....\n....YO....\n...YYYO...\n..NNNNNN..`) },
    triple: { name: 'Crown', metal: 'gold', face: '#5b2a7a', map: m(`..........\nY...YY...Y\nYY..YY..YY\nYYYLYYLYYY\nYLYYYYYYOY\nYRYYBBYYRY\nYYYYYYYYOY\nOOOOOOOOOO\n..........\n..........`) },
    champion: { name: 'Number one', metal: 'gold', face: '#8a1f1f', map: m(`.RR....RR.\n..RRWWRR..\n...RWWR...\n..YYYYYY..\n.YYYKKYYY.\n.YYKKKYYO.\n.YLYKKYYO.\n.YLYKKYYO.\n..YKKKKO..\n...YYYY...`) },
    reliable: { name: 'Tick', metal: 'silver', face: '#2f6b2a', map: m(`..........\n........WW\n.......WWE\n......WWE.\nWW...WWE..\nWWW.WWE...\n.WWWWE....\n..WWE.....\n...E......\n..........`) },
    creator: { name: 'Star', metal: 'ember', face: '#a65a0c', map: m(`....YY....\n....YY....\n...YLLY...\nYYYYLYYYYY\n.YYLYYYYO.\n..YYYYYO..\n..YYYYYO..\n.YYYOOYYO.\n.YOO..OOY.\n.O......O.`) },
    showcase: { name: 'Camera', metal: 'bronze', face: '#8a3d63', map: m(`..........\n...KKK....\n.KKKKKKKK.\nKGGGGGGGGK\nKGGKKKKGRK\nKGKBBBBKGK\nKGKBWBBKGK\nKGGKKKKGGK\n.KKKKKKKK.\n..........`) },
    ideas: { name: 'Light bulb', metal: 'violet', face: '#4a2f78', map: m(`...YYYY...\n..YLLLYY..\n.YLLYYYYY.\n.YLYYYYYY.\n.YYYYYYYO.\n..YYYYYO..\n...YYYO...\n...GGGG...\n...DGGD...\n....GG....`) },
    sword: { name: 'Sword', metal: 'diamond', face: '#1d4a5c', map: m(`........WC\n.......WCC\n......WCC.\n.....WCC..\n....WCC...\n.N.WCC....\n..NCC.....\n..KN......\n.KK.N.....\nKK........`) },
    pickaxe: { name: 'Pickaxe', metal: 'diamond', face: '#3a2a1a', map: m(`..CCCCC...\n.C.....C..\n.....N..C.\n....N....C\n...N......\n..N.......\n.N........\nN.........\n..........\n..........`) },
    diamond: { name: 'Diamond', metal: 'diamond', face: '#16405a', map: m(`..........\n...CCCC...\n..CWCCBC..\n.CWCCCCBC.\n.CCCCCCBB.\n..CCCCBB..\n...CCBB...\n....BB....\n..........\n..........`) },
    heart: { name: 'Heart', metal: 'redstone', face: '#5a1010', map: m(`..........\n.RR...RR..\nRWRR.RRRR.\nRWRRRRRRM.\nRRRRRRRRM.\n.RRRRRRM..\n..RRRRM...\n...RRM....\n....M.....\n..........`) },
    creeper: { name: 'Creeper', metal: 'emerald', face: '#1a3a1a', map: m(`EEEEEEEEEE\nEFFEEEEFFE\nEKKEEEEKKE\nEKKEEEEKKE\nEEEEKKEEEE\nEEEKKKKEEE\nEEEKKKKEEE\nEEEKEEKEEE\nEFEEEEEEFE\nEEEEEEEEEE`) },
    mic: { name: 'Microphone', metal: 'silver', face: '#3a2f5a', map: m(`...GGGG...\n..GDGDGG..\n..GGDGDG..\n..GDGDGG..\n..GGGGGG..\n.K.DGGD.K.\n.K......K.\n..KK..KK..\n....KK....\n...KKKK...`) },
    skull: { name: 'Skull', metal: 'netherite', face: '#2a2228', map: m(`..WWWWWW..\n.WWWWWWWW.\nWWWWWWWWWW\nWKKWWWWKKW\nWKKWWWWKKW\nWWWWKKWWWW\n.WWWWWWWW.\n..WKWKWK..\n..WWWWWW..\n..........`) },
    shield: { name: 'Shield', metal: 'silver', face: '#2a3f6b', map: m(`.GGGGGGGG.\nGBBBRRBBBG\nGBBBRRBBBG\nGRRRRRRRRG\nGRRRRRRRRG\nGBBBRRBBBG\n.GBBRRBBG.\n.GBBRRBBG.\n..GGRRGG..\n....GG....`) },
    book: { name: 'Book', metal: 'bronze', face: '#3a2a5a', map: m(`..........\n.NNNNNNNN.\n.NWWWWWWRN\n.NWKKKKWRN\n.NWWWWWWRN\n.NWKKKWWRN\n.NWWWWWWRN\n.NNNNNNNRN\n..NNNNNNN.\n..........`) },
    note: { name: 'Music note', metal: 'violet', face: '#2f2a5a', map: m(`....PPPPPP\n....PPPPPP\n....P....P\n....P....P\n....P....P\n....P....P\n..PPP..PPP\n.PPPP.PPPP\n.PPP..PPP.\n..........`) },
    hammer: { name: 'Hammer', metal: 'netherite', face: '#3a2a1a', map: m(`.GGGGGG...\n.GDDDDGG..\n.GGGGGG...\n...N......\n...N......\n...N......\n...N......\n...N......\n..NNN.....\n..........`) },
  };
  const S = 16, inside = (x, y) => x >= 0 && y >= 0 && x < S && y < S && x + y >= 4 && x - y <= 11 && y - x <= 11 && x + y <= 26;
  const shade = (hex, k) => { const n = parseInt(String(hex).slice(1), 16), c = [n >> 16, n >> 8 & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k)))); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); };
  function clean(d) {
    d = d || {};
    const metal = METAL[d.metal] ? d.metal : 'gold', face = /^#[0-9a-f]{6}$/i.test(d.face || '') ? d.face.toLowerCase() : '#5a4632';
    const rows = (Array.isArray(d.map) ? d.map : []).slice(0, 10).map(r => [...String(r)].slice(0, 10).map(ch => PAL[ch] ? ch : '.').join('').padEnd(10, '.'));
    while (rows.length < 10) rows.push('..........');
    return { metal, face, map: rows };
  }
  function svg(design) {
    const d = clean(design), [hi, mid, lo] = METAL[d.metal], f1 = d.face, f2 = shade(d.face, .62), px = [];
    const put = (x, y, c) => px.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!inside(x, y)) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inside(x + a, y + b));
      const ring = !edge && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([a, b]) => !inside(x + a, y + b));
      put(x, y, edge ? '#000' : ring ? (x + y < 13 ? hi : x + y > 17 ? lo : mid) : (x + y < 14 ? f1 : f2));
    }
    d.map.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') put(x + 3, y + 3, PAL[ch]); }));
    put(5, 2, '#ffffff'); put(4, 3, hi);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="64" height="64" shape-rendering="crispEdges">${px.join('')}</svg>`;
  }
  const api = { PAL, METAL, METAL_NAMES, PRESETS, clean, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTCBadgeArt = api;
})(typeof window !== 'undefined' ? window : this);
