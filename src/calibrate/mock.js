'use strict';
/*
 * Mock di window.calApi per provare la calibrazione nel browser, senza Electron.
 * Attivo solo con ?mock=<scenario> e solo se il preload non ha gia' esposto calApi.
 * Scenari: 1 (nick trovato, Dire slot 1), radiant, nonick (nickname non trovato), nobar (fuori dal draft), error.
 */
(function () {
  const m = /[?&]mock=([^&]*)/.exec(location.search);
  if (!m || window.calApi) return;
  const scenario = decodeURIComponent(m[1]) || '1';
  const SCENARI = { 1: 'Dire, nick trovato', radiant: 'Radiant, nick trovato', nonick: 'Nickname non trovato', nobar: 'Fuori dal draft', error: 'Cattura fallita' };
  const BAR_COLORS = ['#3375FF', '#66FFBF', '#BF00BF', '#F3F00B', '#FF6B00', '#FE86C2', '#A1B447', '#65D9F7', '#008321', '#A46900'];
  const NICK = "Mooq'a#PEP";

  const W = window.innerWidth, H = window.innerHeight;
  const R = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });

  // geometria finta della barra in alto (proporzioni simili al client)
  const barW = W * 0.6, barX = (W - barW) / 2, gap = barW * 0.12, sw = (barW - gap) / 10;
  const portH = Math.max(28, H * 0.06);
  const slots = [];
  for (let i = 0; i < 10; i++) {
    const x = barX + i * sw + (i >= 5 ? gap : 0);
    slots.push({
      index: i, side: i < 5 ? 'radiant' : 'dire',
      portrait: R(x + 2, 0, sw - 4, portH),
      bar: R(x + 2, portH, sw - 4, 5),
      name: R(x + 2, portH + 6, sw - 4, 16),
      found: !(scenario === 'nonick' && i === 3), // una barra ricostruita per simmetria
    });
  }
  const topBar = R(barX, 0, barW, portH + 24);
  const grid = R(W * 0.2, H * 0.3, W * 0.6, H * 0.42);

  const mySlot = scenario === 'radiant' ? 2 : 5;
  const names = ['Fenrir', 'pippo_99', 'Kaze', null, 'Lotus', "Mooq'a#PE…", null, 'xXslarkXx', 'Nebbia', null];
  if (scenario === 'radiant') { names[2] = "Mooq'a#PE…"; names[5] = 'Ombra'; }
  if (scenario === 'nonick') names[5] = 'M00q a#?';

  // disegna il finto schermo di Dota sotto le cornici
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('mock');
    const scr = document.getElementById('mockScreen');
    scr.hidden = false;
    const box = (cls, r, color) => {
      const d = document.createElement('div');
      d.className = cls;
      d.style.left = r.x + 'px'; d.style.top = r.y + 'px'; d.style.width = r.width + 'px'; d.style.height = r.height + 'px';
      if (color) d.style.background = color;
      scr.appendChild(d); return d;
    };
    if (scenario !== 'nobar') {
      slots.forEach((s, i) => {
        box('mslot', s.portrait);
        box('mbar', s.bar, BAR_COLORS[i]);
        const n = box('mname', s.name); n.textContent = names[i] || '';
      });
      const t = box('mtimer', R(barX + 5 * sw, 6, gap, portH)); t.textContent = '1:10 ALL PICK';
      const cols = 18, rows = 6, tw = grid.width / cols, th = grid.height / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) box('mtile', R(grid.x + c * tw + 2, grid.y + r * th + 2, tw - 4, th - 4));
    }
    const nav = document.getElementById('mockbar');
    nav.hidden = false;
    for (const k of Object.keys(SCENARI)) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = 'mock: ' + SCENARI[k];
      if (k === scenario) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => { location.search = '?mock=' + k; });
      nav.appendChild(b);
    }
  });

  let saved = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  window.calApi = {
    async init() {
      return { width: W, height: H, scaleFactor: window.devicePixelRatio || 1, aspect: 'mock', saved, nickname: NICK };
    },
    async autoDetect() {
      await wait(700);
      if (scenario === 'error') return { ok: false, error: 'Cattura dello schermo non riuscita' };
      if (scenario === 'nobar') {
        return { ok: true, width: W, height: H, topBar: null, slots: [], confidence: 0, grid: null, nickname: NICK,
          ocrNames: Array(10).fill(null), mySlot: null, side: null, slotSource: null, matchScore: null,
          notes: ['Nessuna barra degli eroi visibile: sei nel draft?'] };
      }
      const nickOk = scenario !== 'nonick';
      const ms = nickOk ? mySlot : (saved && saved.manualSlot != null ? saved.manualSlot : null);
      return {
        ok: true, width: W, height: H, topBar, slots, confidence: nickOk ? 0.94 : 0.81, grid,
        nickname: NICK, ocrNames: names,
        mySlot: ms, side: ms == null ? null : (ms < 5 ? 'radiant' : 'dire'),
        slotSource: nickOk ? 'nickname' : (ms != null ? 'manual' : null),
        matchScore: nickOk ? 0.91 : null,
        notes: nickOk ? [] : ['Una barra non trovata: ricostruita per simmetria'],
      };
    },
    async save(p) {
      await wait(200);
      saved = p;
      console.log('[mock] calApi.save', JSON.stringify(p));
      return { ok: true };
    },
    async cancel() { console.log('[mock] calApi.cancel'); return { ok: true }; },
  };
  window.__calMock = { scenario, saved: () => saved };
})();
