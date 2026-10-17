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
    this.worker = await createWorker('eng+ita', 1, { cachePath: this.cacheDir, logger: () => {} });
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
