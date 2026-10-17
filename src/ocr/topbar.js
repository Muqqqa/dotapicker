'use strict';
/*
 * Barra eroi in alto nel draft (funzioni PURE su RGBA {data, width, height}, nessuna dipendenza).
 *
 * Ogni slot ha una lineetta di colore FISSO sotto il ritratto (Radiant sempre a sinistra):
 *   Radiant: blu, verde acqua, viola, giallo, arancio  -> indici 0..4
 *   Dire:    rosa, oliva, azzurro, verde, marrone       -> indici 5..9
 * findTopBar cerca queste lineette nella fascia alta dello schermo, scarta quelle incoerenti
 * (riga diversa, ordine sbagliato, larghezza anomala) e ricostruisce le mancanti per simmetria
 * attorno al timer centrale. Tutte le misure sono relative all'immagine o alla lineetta stessa,
 * quindi non dipendono da risoluzione o proporzioni.
 */

const SLOT_COLORS = [
  [0x33, 0x75, 0xff], [0x66, 0xff, 0xbf], [0xbf, 0x00, 0xbf], [0xf3, 0xf0, 0x0b], [0xff, 0x6b, 0x00],
  [0xfe, 0x86, 0xc2], [0xa1, 0xb4, 0x47], [0x65, 0xd9, 0xf7], [0x00, 0x83, 0x21], [0xa4, 0x69, 0x00],
];

const BAND = 0.2;          // fascia alta esaminata (frazione dell'altezza)
const MAX_DIST2 = 70 * 70; // distanza RGB massima dal colore dello slot
const MIN_CHROMA = 55;     // scarta grigi/bianchi
// Proporzioni misurate sulla UI reale (rispetto alla larghezza della lineetta)
const PITCH_PER_W = 1.155; // distanza tra centri di slot adiacenti
const PORTRAIT_H = 0.58;
const NAME_TOP = 0.05;
const NAME_H = 0.3;
const NAME_PAD_X = 0.12;

function sideOf(index) { return index < 5 ? 'radiant' : 'dire'; }

function median(a) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clampRect(r, W, H) {
  const x = Math.max(0, Math.min(W - 1, Math.round(r.x)));
  const y = Math.max(0, Math.min(H - 1, Math.round(r.y)));
  const x1 = Math.max(x + 1, Math.min(W, Math.round(r.x + r.width)));
  const y1 = Math.max(y + 1, Math.min(H, Math.round(r.y + r.height)));
  return { x, y, width: x1 - x, height: y1 - y };
}

/** Colore dello slot (0..9) piu' vicino al pixel, o -1. */
function classify(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < MIN_CHROMA) return -1;
  let best = -1, bd = MAX_DIST2;
  for (let k = 0; k < 10; k++) {
    const c = SLOT_COLORS[k];
    const d = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** Componenti orizzontali (lineette) per ogni colore nella fascia [0, bandH) eventualmente limitata a `area`. */
function findSegments(img, area) {
  const { data, width: W, height: H } = img;
  const x0 = area ? Math.max(0, Math.floor(area.x)) : 0;
  const x1 = area ? Math.min(W, Math.ceil(area.x + area.width)) : W;
  const y0 = area ? Math.max(0, Math.floor(area.y)) : 0;
  const y1 = area ? Math.min(H, Math.ceil(area.y + area.height)) : Math.max(1, Math.round(H * BAND));
  const minLen = Math.max(6, Math.round(H * 0.03));
  const maxLen = Math.round(H * 0.3);
  const gap = Math.max(2, Math.round(H * 0.003));
  const comps = []; // {c, y0, y1, x0, x1, mass, open}
  const open = [];
  for (let y = y0; y < y1; y++) {
    const runs = [];
    const cur = new Array(10).fill(null); // run in corso per colore {s, e, n}
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const k = classify(data[i], data[i + 1], data[i + 2]);
      for (let c = 0; c < 10; c++) {
        const r = cur[c];
        if (c === k) {
          if (r && x - r.e <= gap + 1) { r.e = x; r.n++; } else {
            if (r) runs.push({ c, ...r });
            cur[c] = { s: x, e: x, n: 1 };
          }
        } else if (r && x - r.e > gap + 1) { runs.push({ c, ...r }); cur[c] = null; }
      }
    }
    for (let c = 0; c < 10; c++) if (cur[c]) runs.push({ c, ...cur[c] });
    const good = runs.filter((r) => r.e - r.s + 1 >= minLen && r.e - r.s + 1 <= maxLen && r.n >= 0.7 * (r.e - r.s + 1));
    // aggancia ai componenti aperti (riga precedente, stesso colore, x sovrapposte)
    const nextOpen = [];
    for (const r of good) {
      let comp = open.find((o) => o.c === r.c && o.lastY === y - 1 && r.s <= o.x1 && r.e >= o.x0);
      if (!comp) { comp = { c: r.c, y0: y, y1: y, x0: r.s, x1: r.e, mass: 0, lastY: y }; comps.push(comp); }
      comp.y1 = y; comp.lastY = y; comp.mass += r.n;
      comp.x0 = Math.min(comp.x0, r.s); comp.x1 = Math.max(comp.x1, r.e);
      nextOpen.push(comp);
    }
    open.length = 0; open.push(...nextOpen);
  }
  // una lineetta e' sottile: scarta blocchi alti (ritratti, sfondi colorati)
  return comps.filter((c) => (c.y1 - c.y0 + 1) <= Math.max(3, (c.x1 - c.x0 + 1) * 0.25));
}

/** Rimuove i candidati che violano l'ordine sinistra->destra degli indici. */
function enforceOrder(found) {
  let list = found.slice().sort((a, b) => a.index - b.index);
  for (;;) {
    const bad = new Array(list.length).fill(0);
    let any = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].cx <= list[i].cx) { bad[i]++; bad[j]++; any = true; }
      }
    }
    if (!any) return list;
    let worst = 0;
    for (let i = 1; i < list.length; i++) {
      if (bad[i] > bad[worst] || (bad[i] === bad[worst] && list[i].mass < list[worst].mass)) worst = i;
    }
    list.splice(worst, 1);
  }
}

/**
 * @param {{data:Uint8Array|Uint8ClampedArray|Buffer, width:number, height:number}} rgba
 * @param {{area?:{x,y,width,height}}} [opts] area = zona di ricerca (pixel), es. barra salvata in calibrazione
 * @returns {{slots:Array, confidence:number, frame:Rect}|null}
 */
function findTopBar(rgba, opts = {}) {
  if (!rgba || !rgba.data || !rgba.width || !rgba.height) return null;
  const W = rgba.width, H = rgba.height;
  let area = null;
  if (opts.area) {
    // allarga la zona salvata: tollera spostamenti di qualche pixel
    const a = opts.area, mx = a.width * 0.05, my = Math.max(a.height * 0.5, H * 0.02);
    area = { x: a.x - mx, y: a.y - my, width: a.width + 2 * mx, height: a.height + 2 * my };
  }
  const comps = findSegments(rgba, area);
  if (!comps.length) return null;
  const tolY = Math.max(3, H * 0.015);
  // riga comune: il centro y con piu' colori diversi vicini
  let bestY = null, bestN = 0, bestMass = 0;
  for (const c of comps) {
    const cy = (c.y0 + c.y1) / 2;
    const near = new Map();
    for (const d of comps) {
      if (Math.abs((d.y0 + d.y1) / 2 - cy) <= tolY) near.set(d.c, Math.max(near.get(d.c) || 0, d.mass));
    }
    const mass = [...near.values()].reduce((s, v) => s + v, 0);
    if (near.size > bestN || (near.size === bestN && mass > bestMass)) { bestN = near.size; bestMass = mass; bestY = cy; }
  }
  if (bestN < 2) return null;
  let found = [];
  for (let k = 0; k < 10; k++) {
    let best = null;
    for (const c of comps) {
      if (c.c !== k || Math.abs((c.y0 + c.y1) / 2 - bestY) > tolY) continue;
      if (!best || c.mass > best.mass) best = c;
    }
    if (best) found.push({ index: k, x0: best.x0, x1: best.x1 + 1, y0: best.y0, y1: best.y1 + 1, cx: (best.x0 + best.x1 + 1) / 2, mass: best.mass });
  }
  // larghezze coerenti
  const mw = median(found.map((f) => f.x1 - f.x0));
  found = found.filter((f) => { const w = f.x1 - f.x0; return w >= 0.6 * mw && w <= 1.5 * mw; });
  found = enforceOrder(found);
  if (found.length < 2) return null;

  const barW = median(found.map((f) => f.x1 - f.x0));
  const barY0 = median(found.map((f) => f.y0));
  const barY1 = median(found.map((f) => f.y1));
  const barH = Math.max(1, barY1 - barY0);
  // passo tra slot dallo stesso lato, altrimenti dalla larghezza
  const steps = [];
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const a = found[i], b = found[j];
      if (sideOf(a.index) === sideOf(b.index)) steps.push((b.cx - a.cx) / (b.index - a.index));
    }
  }
  let pitch = steps.length ? median(steps) : barW * PITCH_PER_W;
  if (!(pitch > barW * 0.9 && pitch < barW * 1.6)) pitch = barW * PITCH_PER_W;
  // simmetria: radiant i -> C - D - (4-i)p ; dire j -> C + D + j p
  const A = found.filter((f) => f.index < 5).map((f) => f.cx + (4 - f.index) * pitch); // = C - D
  const B = found.filter((f) => f.index >= 5).map((f) => f.cx - (f.index - 5) * pitch); // = C + D
  let C, D;
  if (A.length && B.length) {
    const a = median(A), b = median(B);
    C = (a + b) / 2; D = (b - a) / 2;
  } else {
    C = opts.centerX != null ? opts.centerX : (area ? area.x + area.width / 2 : W / 2);
    D = A.length ? C - median(A) : median(B) - C;
  }
  if (!(D > 0)) return null;

  const byIdx = new Map(found.map((f) => [f.index, f]));
  const slots = [];
  for (let k = 0; k < 10; k++) {
    const f = byIdx.get(k);
    const cx = f ? f.cx : (k < 5 ? C - D - (4 - k) * pitch : C + D + (k - 5) * pitch);
    const w = f ? f.x1 - f.x0 : barW;
    const bar = clampRect({ x: cx - w / 2, y: f ? f.y0 : barY0, width: w, height: f ? f.y1 - f.y0 : barH }, W, H);
    const ph = barW * PORTRAIT_H;
    const portrait = clampRect({ x: cx - barW / 2, y: bar.y - ph - Math.max(1, barH * 0.3), width: barW, height: ph }, W, H);
    const name = clampRect({ x: cx - barW / 2 - barW * NAME_PAD_X, y: bar.y + bar.height + barW * NAME_TOP,
      width: barW * (1 + 2 * NAME_PAD_X), height: barW * NAME_H }, W, H);
    slots.push({ index: k, side: sideOf(k), bar, portrait, name, found: !!f });
  }
  // coerenza: distanza dei trovati dal modello
  let resid = 0;
  for (const f of found) {
    const m = f.index < 5 ? C - D - (4 - f.index) * pitch : C + D + (f.index - 5) * pitch;
    resid = Math.max(resid, Math.abs(m - f.cx) / pitch);
  }
  const confidence = Math.max(0, Math.min(1, (found.length / 10) * (1 - Math.min(1, resid * 2))));
  const xs = slots.flatMap((s) => [s.portrait.x, s.name.x + s.name.width]);
  const ys = slots.flatMap((s) => [s.portrait.y, s.name.y + s.name.height]);
  const frame = clampRect({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys) }, W, H);
  return { slots, confidence: Math.round(confidence * 100) / 100, frame, centerX: C, pitch };
}

// ---- nickname ------------------------------------------------------------------

const CONFUSE = { 0: 'o', 1: 'i', l: 'i', '|': 'i', '!': 'i', 5: 's', 8: 'b', 2: 'z', 6: 'g', 7: 't' };

/** Forma canonica per il confronto: minuscole, niente accenti/simboli, sostituzioni tipiche dell'OCR. */
function canon(s) {
  let t = String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/[0-9l|!]/g, (ch) => CONFUSE[ch] || ch);
  return t.replace(/[^a-z0-9À-￿]/g, '');
}

function isTruncated(s) {
  return /(…|\.{2,}|,{2,}|…\s*)\s*$/.test(String(s || '').trim());
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Somiglianza 0..1 tra testo letto e personaname (tollera troncamento). */
function nameScore(ocr, persona) {
  const raw = String(ocr == null ? '' : ocr).trim();
  const a = canon(raw.replace(/(…|\.{2,})\s*$/, ''));
  const b = canon(persona);
  if (a.length < 2 || b.length < 2) return 0;
  const full = 1 - lev(a, b) / Math.max(a.length, b.length);
  let pref = 0;
  // troncato (con o senza "..." letto): confronta col prefisso del nome di pari lunghezza (+-1)
  if (a.length < b.length && a.length >= 3) {
    for (let L = a.length - 1; L <= a.length + 1; L++) {
      if (L < 3 || L > b.length) continue;
      const s = 1 - lev(a, b.slice(0, L)) / Math.max(a.length, L);
      if (s > pref) pref = s;
    }
    // un prefisso cortissimo e' poco informativo
    const cover = Math.min(1, a.length / Math.min(b.length, 8));
    pref *= isTruncated(raw) ? 0.6 + 0.4 * cover : 0.5 + 0.45 * cover;
  }
  return Math.max(full, pref);
}

const NICK_THRESHOLD = 0.7;

/**
 * @param {Array<string|null>} names 10 testi letti sotto le lineette (null = vuoto/bot)
 * @param {string} personaname nickname Steam
 * @returns {{index:number, score:number}|null}
 */
function matchNickname(names, personaname, threshold = NICK_THRESHOLD) {
  if (!Array.isArray(names) || !personaname || canon(personaname).length < 2) return null;
  let best = null, second = 0;
  names.forEach((n, i) => {
    if (n == null || !String(n).trim()) return;
    const s = nameScore(n, personaname);
    if (!best || s > best.score) { if (best) second = Math.max(second, best.score); best = { index: i, score: s }; }
    else if (s > second) second = s;
  });
  if (!best || best.score < threshold) return null;
  if (best.score - second < 0.08) return null; // ambiguo: meglio nessuna risposta
  return { index: best.index, score: Math.round(best.score * 1000) / 1000 };
}

module.exports = { findTopBar, matchNickname, sideOf, nameScore, canon, SLOT_COLORS, classify };
