// Gli oggetti suggeriti dal motore devono esistere nel negozio attuale (riferimento Liquipedia) e non essere rimossi.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'engine', 'items-reference.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'scoring.js'), 'utf8');

// nomi brevi usati nell'overlay -> nome ufficiale Liquipedia
const ALIAS = { Dust: 'Dust of Appearance', Sentry: 'Sentry Ward', Gem: 'Gem of True Sight', BKB: 'Black King Bar', Pipe: 'Pipe of Insight', "Eul's Scepter": "Eul's Scepter of Divinity" };

function usedItems() {
  const used = new Set();
  const add = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => used.add(x));
  const block = src.slice(src.indexOf('const NEED_ITEMS'), src.indexOf('function itemsFor'))
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const m of block.matchAll(/'([^']+)'|"([^"]+)"/g)) add(m[1] || m[2]);
  for (const m of src.matchAll(/items: '([^']+)'/g)) add(m[1]); // oggetti del jolly per meccanica
  return [...used];
}

test('items-reference: elenco Liquipedia caricato', () => {
  assert.ok(Object.keys(ref.shop).length > 100, 'troppi pochi oggetti nel riferimento');
  assert.ok(ref.removed.includes('Necronomicon'));
});

test('oggetti del motore: esistono nel negozio e non sono rimossi', () => {
  const used = usedItems();
  assert.ok(used.length > 10, 'NEED_ITEMS non trovato in scoring.js');
  const official = used.map((n) => ALIAS[n] || n);
  const missing = official.filter((n) => !(n in ref.shop));
  const removed = official.filter((n) => ref.removed.includes(n));
  assert.deepEqual(missing, [], 'oggetti non presenti nel negozio: ' + missing.join(', '));
  assert.deepEqual(removed, [], 'oggetti rimossi: ' + removed.join(', '));
});
