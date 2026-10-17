'use strict';
/*
 * Calcolo PURO delle regioni di cattura in base alla risoluzione (nessun fs, nessun electron).
 *
 * Coordinate: DIP del display principale (display.size), cioe' la stessa unita' della chiave
 * di risoluzione ('2560x1440@1'). Per ritagliare l'immagine catturata (pixel fisici) si usa toPixelRect.
 *
 * Logica del preset (verificata a mano su 16:9, 16:10, 4:3, 21:9, 32:9):
 *   L'HUD di Dota scala in modo UNIFORME con s = min(W/baseW, H/baseH) e resta centrato in orizzontale.
 *   - 16:9: s = W/baseW, nessun offset (scalatura lineare).
 *   - schermi piu' larghi di 16:9 (21:9, 32:9): s dipende dall'altezza e l'HUD si centra: offset X = (W - baseW*s)/2.
 *     Non si scala x linearmente, altrimenti le regioni finirebbero nelle bande laterali.
 *   - schermi piu' stretti (16:10, 4:3): s dipende dalla larghezza; verticalmente le regioni con ancora 'top'
 *     restano al bordo alto, 'bottom' al basso, 'center' relative al centro.
 *  E' un'euristica sul comportamento del client: se l'HUD reale differisce, l'utente calibra e il salvataggio
 *  per quella risoluzione ha la precedenza.
 */

const REGION_IDS = ['roleText', 'myHero',
  'ally1', 'ally2', 'ally3', 'ally4', 'ally5',
  'enemy1', 'enemy2', 'enemy3', 'enemy4', 'enemy5'];

const REGION_LABELS = {
  roleText: 'Testo del ruolo',
  myHero: 'Il tuo eroe',
  ally1: 'Alleato 1', ally2: 'Alleato 2', ally3: 'Alleato 3', ally4: 'Alleato 4', ally5: 'Alleato 5',
  enemy1: 'Nemico 1', enemy2: 'Nemico 2', enemy3: 'Nemico 3', enemy4: 'Nemico 4', enemy5: 'Nemico 5',
};

const ALLY_IDS = ['ally1', 'ally2', 'ally3', 'ally4', 'ally5'];
const ENEMY_IDS = ['enemy1', 'enemy2', 'enemy3', 'enemy4', 'enemy5'];
const MIN_SIZE = 8;

function resolutionKey(width, height, scaleFactor) {
  return `${Math.round(width)}x${Math.round(height)}@${Number(scaleFactor) || 1}`;
}

function aspectLabel(width, height) {
  const r = width / height;
  const near = (v) => Math.abs(r - v) < 0.06;
  if (near(16 / 9)) return '16:9';
  if (near(16 / 10)) return '16:10';
  if (near(4 / 3)) return '4:3';
  if (near(5 / 4)) return '5:4';
  if (near(21 / 9)) return '21:9';
  if (near(32 / 9)) return '32:9';
  return r > 16 / 9 ? 'ultrawide' : 'altro';
}

function clampRect(r, width, height) {
  let w = Math.min(Math.max(MIN_SIZE, Math.round(r.width)), width);
  let h = Math.min(Math.max(MIN_SIZE, Math.round(r.height)), height);
  let x = Math.min(Math.max(0, Math.round(r.x)), width - w);
  let y = Math.min(Math.max(0, Math.round(r.y)), height - h);
  return { x, y, width: w, height: h };
}

/** Preset per la risoluzione (width x height in DIP). defaults = contenuto di regions.default.json. */
function presetRegions(defaults, width, height) {
  const bw = defaults.baseWidth, bh = defaults.baseHeight;
  const s = Math.min(width / bw, height / bh);
  const xoff = (width - bw * s) / 2;
  const out = {};
  for (const id of REGION_IDS) {
    const d = defaults.regions[id];
    if (!d) continue;
    const [x, y, w, h, anchor] = d;
    let Y;
    if (anchor === 'bottom') Y = height - (bh - y) * s;
    else if (anchor === 'center') Y = height / 2 + (y - bh / 2) * s;
    else Y = y * s;
    out[id] = clampRect({ x: xoff + x * s, y: Y, width: w * s, height: h * s }, width, height);
  }
  return out;
}

/** Valida regioni utente; ritorna oggetto completo (id mancanti/invalidi presi dal fallback) o null se inutilizzabili. */
function sanitizeRegions(input, width, height, fallback) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  let valid = 0;
  for (const id of REGION_IDS) {
    const r = input[id];
    const ok = r && [r.x, r.y, r.width, r.height].every((v) => typeof v === 'number' && Number.isFinite(v));
    if (ok) { out[id] = clampRect(r, width, height); valid++; }
    else if (fallback && fallback[id]) out[id] = { ...fallback[id] };
  }
  return valid ? out : null;
}

/**
 * @param {{defaults:object, user:object|null, width:number, height:number, scaleFactor:number}} p
 * @returns {{regions:object, source:'preset'|'utente', key:string, aspect:string, preset:object}}
 */
function resolveRegions({ defaults, user, width, height, scaleFactor }) {
  const preset = presetRegions(defaults, width, height);
  const clean = sanitizeRegions(user, width, height, preset);
  return {
    regions: clean || preset,
    source: clean ? 'utente' : 'preset',
    key: resolutionKey(width, height, scaleFactor),
    aspect: aspectLabel(width, height),
    preset,
  };
}

/** Converte un rect in DIP nel rect in pixel dell'immagine catturata (imgW x imgH). */
function toPixelRect(rect, dispW, dispH, imgW, imgH) {
  const sx = imgW / dispW, sy = imgH / dispH;
  let x = Math.round(rect.x * sx), y = Math.round(rect.y * sy);
  let w = Math.max(1, Math.round(rect.width * sx)), h = Math.max(1, Math.round(rect.height * sy));
  x = Math.min(Math.max(0, x), Math.max(0, imgW - 1));
  y = Math.min(Math.max(0, y), Math.max(0, imgH - 1));
  w = Math.min(w, imgW - x);
  h = Math.min(h, imgH - y);
  return { x, y, width: w, height: h };
}

module.exports = {
  REGION_IDS, REGION_LABELS, ALLY_IDS, ENEMY_IDS, MIN_SIZE,
  resolutionKey, aspectLabel, presetRegions, sanitizeRegions, resolveRegions, toPixelRect, clampRect,
};
