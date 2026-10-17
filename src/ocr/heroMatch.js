'use strict';
/*
 * Riconoscimento eroi dai ritratti della barra in alto (template matching, PURO su RGBA).
 *
 * Ogni icona eroe CDN (16:9, cache su disco) viene ritagliata nella zona centrale (REGION: evita i
 * bordi inclinati del ritratto, l'icona "i" arancione in basso a sinistra e il badge in basso a destra)
 * e ridotta a TPL_W x TPL_H. Il ritratto catturato subisce lo stesso ritaglio; si confronta con la
 * correlazione incrociata normalizzata (NCC) sui canali RGB. Per tollerare le differenze di
 * inquadratura si provano piccole traslazioni/scale solo sui migliori candidati.
 *
 * Validato su tests/fixtures/strategy-time-dire.png (10 eroi su 10, punteggi 0.76-0.95, distacco >= 0.19).
 * Slot vuoti (riquadro scuro piatto) -> null; sotto soglia o ambiguo -> null (mai indovinare).
 */
const fs = require('fs');
const path = require('path');
const { decodePng, cropRgba, resizeRgba } = require('./png');

const TPL_W = 32;
const TPL_H = 18;
const REGION = [0.22, 0.05, 0.78, 0.6]; // frazioni x0,y0,x1,y1 del ritratto
const MIN_SCORE = 0.5;
const MIN_MARGIN = 0.08;
const SHORTLIST = 8;
const EMPTY_SD = 9; // deviazione standard di luminanza sotto cui il riquadro e' vuoto

/** Estrae un vettore float RGB (scarta alpha) da un buffer 4 canali. */
function toVector(buf4) {
  const n = buf4.length / 4;
  const v = new Float32Array(n * 3);
  for (let i = 0, j = 0; i < buf4.length; i += 4) {
    v[j++] = buf4[i]; v[j++] = buf4[i + 1]; v[j++] = buf4[i + 2];
  }
  return v;
}

/** Correlazione incrociata normalizzata tra due vettori di pari lunghezza: -1..1. */
function ncc(a, b) {
  if (a.length !== b.length || !a.length) return -1;
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= a.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  if (den < 1e-6) return -1; // immagine piatta: nessuna informazione
  return num / den;
}

/** Compatibilita': migliore template con soglia e distacco. */
function matchVector(vec, templates, threshold = MIN_SCORE, margin = MIN_MARGIN) {
  let best = null, second = -2;
  for (const t of templates) {
    const s = ncc(vec, t.vec);
    if (!best || s > best.score) {
      if (best) second = Math.max(second, best.score);
      best = { heroId: t.heroId, score: s };
    } else if (s > second) second = s;
  }
  if (!best || best.score < threshold) return null;
  if (best.score - second < margin) return null;
  return best;
}

function vecOfRect(img, r) {
  const x = Math.round(r.x), y = Math.round(r.y);
  const w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
  if (x < 0 || y < 0 || x + w > img.width || y + h > img.height) {
    // fuori immagine: ritaglio clampato
    return toVector(resizeRgba(cropRgba(img, { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h }), TPL_W, TPL_H).data);
  }
  return toVector(resizeRgba(cropRgba(img, { x, y, width: w, height: h }), TPL_W, TPL_H).data);
}

/** Vettore del template da un'icona RGBA (16:9) o di un ritratto intero. */
function templateVector(icon) {
  return vecOfRect(icon, {
    x: icon.width * REGION[0], y: icon.height * REGION[1],
    width: icon.width * (REGION[2] - REGION[0]), height: icon.height * (REGION[3] - REGION[1]),
  });
}

/** Il riquadro e' vuoto/piatto? (slot non ancora scelto) */
function isEmptyPortrait(img, rect) {
  const r = { x: rect.x + rect.width * REGION[0], y: rect.y + rect.height * REGION[1],
    width: rect.width * (REGION[2] - REGION[0]), height: rect.height * (REGION[3] - REGION[1]) };
  const c = cropRgba(img, r);
  let s = 0, s2 = 0;
  const n = c.width * c.height;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const l = 0.299 * c.data[j] + 0.587 * c.data[j + 1] + 0.114 * c.data[j + 2];
    s += l; s2 += l * l;
  }
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m)) < EMPTY_SD;
}

/**
 * Identifica l'eroe in un ritratto.
 * @param {{data,width,height}} img schermata RGBA
 * @param {{x,y,width,height}} rect ritratto (slot.portrait di findTopBar)
 * @param {Array<{heroId:number, vec:Float32Array}>} templates
 * @returns {{heroId:number, score:number, margin:number}|null}
 */
function identifyPortrait(img, rect, templates, opts = {}) {
  if (!img || !rect || !templates || !templates.length || rect.width < 8 || rect.height < 6) return null;
  if (isEmptyPortrait(img, rect)) return null;
  const minScore = opts.minScore != null ? opts.minScore : MIN_SCORE;
  const minMargin = opts.minMargin != null ? opts.minMargin : MIN_MARGIN;
  const at = (dx, dy, sc) => {
    const w = rect.width * sc, h = rect.height * sc;
    const cx = rect.x + rect.width / 2 + dx * rect.width, cy = rect.y + rect.height / 2 + dy * rect.height;
    const x0 = cx - w / 2, y0 = cy - h / 2;
    return vecOfRect(img, { x: x0 + w * REGION[0], y: y0 + h * REGION[1], width: w * (REGION[2] - REGION[0]), height: h * (REGION[3] - REGION[1]) });
  };
  const base = at(0, 0, 1);
  const stage1 = templates.map((t) => ({ t, s: ncc(base, t.vec) })).sort((a, b) => b.s - a.s);
  const short = stage1.slice(0, SHORTLIST);
  const variants = [];
  for (const sc of [0.9, 1, 1.1]) for (const dx of [-0.08, -0.04, 0, 0.04, 0.08]) for (const dy of [-0.06, 0, 0.06]) {
    variants.push(sc === 1 && dx === 0 && dy === 0 ? base : at(dx, dy, sc));
  }
  const res = short.map(({ t }) => {
    let best = -2;
    for (const v of variants) { const s = ncc(v, t.vec); if (s > best) best = s; }
    return { heroId: t.heroId, score: best };
  }).sort((a, b) => b.score - a.score);
  const best = res[0], second = res[1] ? res[1].score : -1;
  const outside = stage1[SHORTLIST] ? Math.max(-1, stage1[SHORTLIST].s) : -1;
  const sec = Math.max(second, outside);
  if (!best || best.score < minScore || best.score - sec < minMargin) return null;
  return { heroId: best.heroId, score: Math.round(best.score * 1000) / 1000, margin: Math.round((best.score - sec) * 1000) / 1000 };
}

/** Libreria di template: scarica (una volta) le icone in cacheDir e le converte in vettori. */
class HeroMatcher {
  /** @param {{cacheDir:string, heroes:Array<{id:number,name:string}>, urlFor:(id:number,h:object)=>string}} opts */
  constructor({ cacheDir, heroes, urlFor }) {
    this.cacheDir = cacheDir;
    this.heroes = heroes || [];
    this.urlFor = urlFor;
    this.templates = [];
    this.ready = false;
  }

  async download(url, file) {
    if (fs.existsSync(file) && fs.statSync(file).size > 100) return fs.readFileSync(file);
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file, buf);
    return buf;
  }

  async init(onProgress) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const out = [];
    let done = 0;
    const queue = this.heroes.slice();
    const worker = async () => {
      while (queue.length) {
        const h = queue.shift();
        try {
          const file = path.join(this.cacheDir, h.id + '.png');
          const buf = await this.download(this.urlFor(h.id, h), file);
          out.push({ heroId: h.id, vec: templateVector(decodePng(buf)) });
        } catch (e) { /* eroe saltato */ }
        done++;
        if (onProgress && done % 20 === 0) onProgress(done, this.heroes.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.templates = out;
    this.ready = out.length > 0;
    return out.length;
  }

  /** @returns {{heroId, score, margin}|null} */
  identifyPortrait(img, rect, opts) {
    if (!this.ready) return null;
    return identifyPortrait(img, rect, this.templates, opts);
  }
}

module.exports = {
  HeroMatcher, identifyPortrait, isEmptyPortrait, templateVector, ncc, matchVector, toVector,
  TPL_W, TPL_H, REGION, MIN_SCORE, MIN_MARGIN,
};
