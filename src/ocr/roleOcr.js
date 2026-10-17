'use strict';
const path = require('path');
const fs = require('fs');
const { parseRole } = require('./parseRole');

/** Wrapper pigro attorno a tesseract.js (lingue eng+ita, dati in cache su disco). */
class RoleOcr {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.worker = null;
    this.initPromise = null;
    this.failed = null;
  }

  async _init() {
    const { createWorker } = require('tesseract.js');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const opts = { cachePath: this.cacheDir, logger: () => {} };
    try {
      // dentro asar il worker_thread deve partire dalla copia estratta (asarUnpack)
      const wp = require.resolve('tesseract.js/src/worker-script/node/index.js');
      if (wp.includes('app.asar' + path.sep) || wp.includes('app.asar/')) {
        opts.workerPath = wp.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      }
    } catch (e) { /* default */ }
    this.worker = await createWorker('eng+ita', 1, opts);
    try {
      await this.worker.setParameters({ tessedit_pageseg_mode: '7' }); // singola riga
    } catch (e) { /* non bloccante */ }
  }

  ensure() {
    if (!this.initPromise) {
      this.initPromise = this._init().catch((e) => { this.failed = e; this.worker = null; throw e; });
    }
    return this.initPromise;
  }

  /** @param {Electron.NativeImage} img ritaglio del testo di ruolo. Ritorna {text, role}. */
  async readRole(img) {
    await this.ensure();
    const big = img.resize({ width: Math.max(1, img.getSize().width * 2), quality: 'best' });
    const { data } = await this.worker.recognize(big.toPNG());
    const text = (data && data.text) || '';
    return { text, role: parseRole(text) };
  }

  async terminate() {
    try { if (this.worker) await this.worker.terminate(); } catch (e) { /* ignore */ }
    this.worker = null;
  }
}

module.exports = { RoleOcr };
