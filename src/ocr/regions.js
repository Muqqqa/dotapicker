'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = require('./regions.default.json');

/** Carica config: default + eventuale override <userDir>/regions.json (merge superficiale). */
function loadRegions(userDir) {
  let cfg = { ...DEFAULTS };
  if (userDir) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(userDir, 'regions.json'), 'utf8'));
      cfg = { ...cfg, ...o };
    } catch (e) { /* nessun override */ }
  }
  return cfg;
}

/** Scala un rect [x,y,w,h] dal sistema di riferimento alla risoluzione reale, con clamp. */
function scaleRect(rect, cfg, width, height) {
  const sx = width / cfg.baseWidth;
  const sy = height / cfg.baseHeight;
  let x = Math.round(rect[0] * sx), y = Math.round(rect[1] * sy);
  let w = Math.max(1, Math.round(rect[2] * sx)), h = Math.max(1, Math.round(rect[3] * sy));
  x = Math.min(Math.max(0, x), Math.max(0, width - 1));
  y = Math.min(Math.max(0, y), Math.max(0, height - 1));
  w = Math.min(w, width - x);
  h = Math.min(h, height - y);
  return { x, y, width: w, height: h };
}

module.exports = { loadRegions, scaleRect, DEFAULTS };
