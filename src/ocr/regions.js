'use strict';
// I/O delle regioni: preset (regions.default.json, dentro asar va bene: require) + calibrazioni utente
// in <userData>/regions.json con chiave per risoluzione ('2560x1440@1').
const fs = require('fs');
const path = require('path');
const layout = require('./layout');

const DEFAULTS = require('./regions.default.json');
const FILE = 'regions.json';

function readAll(userDir) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(userDir, FILE), 'utf8'));
    return o && typeof o === 'object' ? o : {};
  } catch (e) { return {}; }
}

function loadUserRegions(userDir, key) {
  if (!userDir) return null;
  const all = readAll(userDir);
  return /^\d+x\d+@/.test(key) && all[key] && typeof all[key] === 'object' ? all[key] : null;
}

/** regions = oggetto id->rect, oppure null per rimuovere la calibrazione di quella risoluzione. */
function saveUserRegions(userDir, key, regions) {
  const all = readAll(userDir);
  if (regions) all[key] = regions; else delete all[key];
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, FILE), JSON.stringify(all, null, 2), 'utf8');
}

/** Risolve le regioni per il display (size in DIP + scaleFactor). */
function resolveForDisplay(userDir, display) {
  const width = display.size.width, height = display.size.height, scaleFactor = display.scaleFactor || 1;
  const key = layout.resolutionKey(width, height, scaleFactor);
  const r = layout.resolveRegions({ defaults: DEFAULTS, user: loadUserRegions(userDir, key), width, height, scaleFactor });
  return { ...r, width, height, scaleFactor, matchThreshold: DEFAULTS.matchThreshold };
}

module.exports = { DEFAULTS, loadUserRegions, saveUserRegions, resolveForDisplay };
