'use strict';
/*
 * Lettura dei 10 nomi sotto le lineette della barra in alto (senza Electron: RGBA + tesseract.js).
 * - prepareName: ritaglio -> scala di grigi invertita (testo scuro su bianco), contrasto, ingrandimento.
 *   Ritorna null se nel ritaglio non c'e' testo chiaro (bot / slot vuoto): niente OCR inutile.
 * - readNames(rgba, slots, { worker }) -> [string|null] x10. worker = worker tesseract.js gia' pronto
 *   (oppure qualunque oggetto con recognize(pngBuffer) -> { data:{ text } }).
 * - NameOcr: worker pigro dedicato (eng+ita, riga singola), usato dal controller e dal banco prova.
 */
const fs = require('fs');
const path = require('path');
const { cropRgba, resizeRgba, encodePng } = require('./png');

const TARGET_TEXT_H = 48; // altezza del ritaglio ingrandito (px): tesseract preferisce testo ~30px

function prepareName(rgba, rect) {
  if (!rect || rect.width < 4 || rect.height < 4) return null;
  const c = cropRgba(rgba, rect);
  const n = c.width * c.height;
  const L = new Float32Array(n);
  let bright = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = c.data[j], g = c.data[j + 1], b = c.data[j + 2];
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const sorted = Array.from(L).sort((a, b) => a - b);
  const bg = sorted[Math.floor(n * 0.5)];
  const hi = sorted[Math.floor(n * 0.985)];
  for (let i = 0; i < n; i++) if (L[i] > bg + 70) bright++;
  // testo: almeno qualche pixel molto piu' chiaro dello sfondo
  if (hi - bg < 60 || bright < Math.max(6, n * 0.01)) return null;
  const out = Buffer.alloc(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let v = (L[i] - bg) / Math.max(1, hi - bg); // 0 sfondo, 1 testo
    v = Math.max(0, Math.min(1, v));
    const g = Math.round(255 * (1 - v)); // testo scuro su bianco
    out[j] = out[j + 1] = out[j + 2] = g; out[j + 3] = 255;
  }
  const k = Math.max(1, TARGET_TEXT_H / c.height);
  const big = resizeRgba({ data: out, width: c.width, height: c.height }, c.width * k, c.height * k);
  // bordo bianco: tesseract legge male il testo attaccato ai margini
  const pad = Math.round(TARGET_TEXT_H * 0.3);
  const W = big.width + 2 * pad, H = big.height + 2 * pad;
  const padded = Buffer.alloc(W * H * 4, 255);
  for (let y = 0; y < big.height; y++) big.data.copy(padded, ((y + pad) * W + pad) * 4, y * big.width * 4, (y + 1) * big.width * 4);
  return { data: padded, width: W, height: H };
}

function cleanText(t) {
  const s = String(t == null ? '' : t).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

async function readNames(rgba, slots, { worker } = {}) {
  const out = new Array(10).fill(null);
  if (!rgba || !Array.isArray(slots) || !worker) return out;
  for (const s of slots) {
    if (!s || s.index == null || s.index < 0 || s.index > 9) continue;
    const img = prepareName(rgba, s.name);
    if (!img) continue;
    try {
      const r = await worker.recognize(encodePng(img));
      out[s.index] = cleanText(r && r.data && r.data.text);
    } catch (e) { /* slot illeggibile */ }
  }
  return out;
}

/** Worker tesseract.js dedicato ai nomi (pigro). */
class NameOcr {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.worker = null;
    this.initPromise = null;
    this.failed = null;
  }

  async _init() {
    const { createWorker } = require('tesseract.js');
    if (this.cacheDir) fs.mkdirSync(this.cacheDir, { recursive: true });
    const opts = { logger: () => {} };
    if (this.cacheDir) opts.cachePath = this.cacheDir;
    try {
      const wp = require.resolve('tesseract.js/src/worker-script/node/index.js');
      if (wp.includes('app.asar' + path.sep) || wp.includes('app.asar/')) {
        opts.workerPath = wp.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      }
    } catch (e) { /* default */ }
    this.worker = await createWorker('eng+ita', 1, opts);
    try { await this.worker.setParameters({ tessedit_pageseg_mode: '7' }); } catch (e) { /* non bloccante */ }
  }

  ensure() {
    if (!this.initPromise) {
      this.initPromise = this._init().catch((e) => { this.failed = e; this.worker = null; this.initPromise = null; throw e; });
    }
    return this.initPromise;
  }

  async readNames(rgba, slots) {
    await this.ensure();
    return readNames(rgba, slots, { worker: this.worker });
  }

  async terminate() {
    try { if (this.worker) await this.worker.terminate(); } catch (e) { /* ignore */ }
    this.worker = null;
    this.initPromise = null;
  }
}

module.exports = { prepareName, readNames, cleanText, NameOcr };
