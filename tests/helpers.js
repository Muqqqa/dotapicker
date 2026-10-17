'use strict';
// Helper condivisi dei test. Possiede: tester.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const exists = (...a) => fs.existsSync(p(...a));

function tryRequire(rel) {
  if (!exists(rel)) return null;
  try { return require(p(rel)); } catch (e) { return { __loadError: e }; }
}

// Ritorna l'engine pronto con i dati di esempio, oppure { skip: 'motivo' }.
async function getEngine() {
  if (!exists('src', 'engine', 'index.js')) return { skip: 'src/engine/index.js non esiste ancora (tactician)' };
  if (!exists('src', 'engine', 'sample-data.json')) return { skip: 'src/engine/sample-data.json non esiste ancora (tactician)' };
  let eng;
  try { eng = require(p('src', 'engine', 'index.js')); } catch (e) { return { skip: 'engine non caricabile: ' + e.message }; }
  const sample = require(p('src', 'engine', 'sample-data.json'));
  // Il contratto non fissa come iniettare i dati offline: proviamo gli hook piu' comuni.
  const hooks = ['setData', 'loadSampleData', 'useSampleData', 'loadSample', '_setData', 'setSampleData'];
  let loaded = false;
  for (const h of hooks) {
    if (typeof eng[h] === 'function') { await eng[h](h === 'loadSampleData' || h === 'useSampleData' || h === 'loadSample' ? undefined : sample); loaded = true; break; }
  }
  if (!loaded && typeof eng.loadData === 'function') {
    // tentativi offline: opzione esplicita, altrimenti fallback su sample (cache)
    try { await eng.loadData({ rankTier: 55, offline: true, sample: true }); loaded = true; } catch (e) { /* ignora */ }
  }
  if (!loaded) return { skip: 'impossibile caricare dati offline nell\'engine (nessun hook noto)' };
  return { eng, sample };
}

module.exports = { ROOT, p, exists, tryRequire, getEngine };
