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

// ---- calibrazione v2: { v:2, topBar:Rect|null, grid:Rect|null, manualSlot:0..9|null, roleText?:Rect } ----
// Le vecchie voci a 12 regioni (ally1..enemy5, myHero) vengono ignorate; di loro si conserva solo
// roleText (l'unica ancora usata), che viene migrata alla prima scrittura v2.

function validRect(r) {
  return !!r && typeof r === 'object' && [r.x, r.y, r.width, r.height].every((v) => typeof v === 'number' && Number.isFinite(v))
    && r.width > 0 && r.height > 0;
}

function cleanRect(r, width, height) {
  return validRect(r) ? layout.clampRect(r, width, height) : null;
}

/** Calibrazione v2 per la risoluzione (o null). */
function loadCalV2(userDir, key) {
  if (!userDir) return null;
  const e = readAll(userDir)[key];
  if (!e || typeof e !== 'object' || e.v !== 2) return null;
  const ms = Number.isInteger(e.manualSlot) && e.manualSlot >= 0 && e.manualSlot <= 9 ? e.manualSlot : null;
  return { topBar: validRect(e.topBar) ? e.topBar : null, grid: validRect(e.grid) ? e.grid : null, manualSlot: ms };
}

/** cal null = rimuove la calibrazione di quella risoluzione. Ritorna l'oggetto salvato. */
function saveCalV2(userDir, key, cal, width, height) {
  const all = readAll(userDir);
  if (!cal) { delete all[key]; } else {
    const old = all[key] && typeof all[key] === 'object' ? all[key] : {};
    const ms = Number.isInteger(cal.manualSlot) && cal.manualSlot >= 0 && cal.manualSlot <= 9 ? cal.manualSlot : null;
    const e = { v: 2, topBar: cleanRect(cal.topBar, width, height), grid: cleanRect(cal.grid, width, height), manualSlot: ms };
    if (validRect(old.roleText)) e.roleText = old.roleText; // migrazione dalle vecchie 12 regioni
    all[key] = e;
  }
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, FILE), JSON.stringify(all, null, 2), 'utf8');
  return all[key] || null;
}

/** Risolve le regioni per il display (size in DIP + scaleFactor). */
function resolveForDisplay(userDir, display) {
  const width = display.size.width, height = display.size.height, scaleFactor = display.scaleFactor || 1;
  const key = layout.resolutionKey(width, height, scaleFactor);
  const old = loadUserRegions(userDir, key);
  // delle regioni utente resta valida solo roleText (le altre 11 sono superate dalla barra automatica)
  const user = old && validRect(old.roleText) ? { roleText: old.roleText } : null;
  const r = layout.resolveRegions({ defaults: DEFAULTS, user, width, height, scaleFactor });
  const cal = loadCalV2(userDir, key);
  return { ...r, source: cal ? 'utente' : 'preset', cal, width, height, scaleFactor, matchThreshold: DEFAULTS.matchThreshold };
}

module.exports = { DEFAULTS, loadUserRegions, saveUserRegions, loadCalV2, saveCalV2, resolveForDisplay };
