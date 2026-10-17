'use strict';
/*
 * Riconoscimento eroi nel draft tramite template matching.
 *
 * Funzionamento: ogni icona eroe (immagini CDN Valve, scaricate e messe in cache su disco)
 * e ogni regione catturata vengono ridotte a TPL_W x TPL_H pixel e confrontate con
 * correlazione incrociata normalizzata (NCC) sui canali RGB. Vince il template con NCC piu' alta
 * se supera la soglia (matchThreshold) e distacca il secondo di un margine minimo.
 *
 * LIMITI NOTI:
 *  - Le regioni di default (regions.default.json) sono approssimate: vanno calibrate.
 *  - Il confronto e' sensibile a overlay/cornici/scalatura UI: i ritagli devono contenere
 *    quasi solo il ritratto, con lo stesso rapporto d'aspetto (16:9) dei template.
 *  - Eroi in "hover"/ritratti scuriti (non ancora pickati, ban) producono match deboli:
 *    sotto soglia vengono scartati (slot ignoto) invece di indovinare.
 *  - Nessuna invarianza a rotazione; scala tollerata solo per resize uniforme.
 *  - Le parti pure (ncc, matchBitmap) lavorano su buffer BGRA/RGBA gia' ridotti; il decoding
 *    PNG e il resize usano Electron nativeImage (caricato in modo pigro).
 */
const fs = require('fs');
const path = require('path');

const TPL_W = 32;
const TPL_H = 18;

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

/**
 * @param {Float32Array} vec regione ridotta come vettore
 * @param {Array<{heroId:number, vec:Float32Array}>} templates
 * @returns {{heroId:number, score:number}|null}
 */
function matchVector(vec, templates, threshold = 0.55, margin = 0.03) {
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

let _nativeImage = null;
function nativeImage() {
  if (!_nativeImage) _nativeImage = require('electron').nativeImage;
  return _nativeImage;
}

function imageToVector(img) {
  const small = img.resize({ width: TPL_W, height: TPL_H, quality: 'good' });
  return toVector(small.toBitmap());
}

/**
 * Gestisce libreria di template: scarica (una volta) le icone in cacheDir e le converte in vettori.
 */
class HeroMatcher {
  /**
   * @param {{cacheDir:string, heroes:Array<{id:number,name:string}>, urlFor:(id:number,h:object)=>string}} opts
   */
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
    const ni = nativeImage();
    const out = [];
    let done = 0;
    const queue = this.heroes.slice();
    const worker = async () => {
      while (queue.length) {
        const h = queue.shift();
        try {
          const file = path.join(this.cacheDir, h.id + '.png');
          const buf = await this.download(this.urlFor(h.id, h), file);
          const img = ni.createFromBuffer(buf);
          if (!img.isEmpty()) out.push({ heroId: h.id, vec: imageToVector(img) });
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

  /** @param {Electron.NativeImage} cropImg ritaglio del ritratto */
  identify(cropImg, threshold) {
    if (!this.ready || !cropImg || cropImg.isEmpty()) return null;
    const m = matchVector(imageToVector(cropImg), this.templates, threshold);
    return m ? m.heroId : null;
  }
}

module.exports = { HeroMatcher, ncc, matchVector, toVector, TPL_W, TPL_H };
