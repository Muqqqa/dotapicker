'use strict';
// CONTRACT-v2: src/ocr/heroGrid.js (app-dev) -> findHeroGrid / tileStatus, su screenshot reali.
// Coordinate dei riquadri misurate a mano (vedi commenti); il banco tools/vision-bench le mostra sovrapposte.
const test = require('node:test');
const assert = require('node:assert/strict');
const { exists, p } = require('./helpers');
const { decodePNG, scaleRGBA } = require('./png');

function load(t) {
  if (!exists('src', 'ocr', 'heroGrid.js')) { t.skip('src/ocr/heroGrid.js non ancora pubblicato (app-dev)'); return null; }
  const m = require(p('src', 'ocr', 'heroGrid.js'));
  for (const f of ['findHeroGrid', 'tileStatus']) assert.equal(typeof m[f], 'function', f + ' non esportata');
  return m;
}
const cache = {};
const fixture = (name) => cache[name] || (cache[name] = decodePNG(p('tests', 'fixtures', name)));

// griglia-ban-reali.png (1675x891): riquadri 58x100, colonne x = 90 + 68*col.
// Righe (y in alto): STR 101 / 212, AGI 372 / 482, INT 642 / 752.
const R = { str1: 101, str2: 212, agi1: 372, agi2: 482, int1: 642, int2: 752 };
const T = (row, col) => ({ x: 90 + 68 * col, y: R[row], w: 58, h: 100, label: `${row} col ${col}` });
const REALI = {
  banned: [T('str2', 10), T('agi2', 5), T('agi2', 10)], // i 3 cerchiati in blu
  unavailable: [T('agi1', 10), T('agi1', 16), T('int1', 0), T('int1', 2), T('int1', 14)], // ingrigiti senza linea
  available: [T('str1', 0), T('str1', 1), T('str1', 4), T('str1', 22), T('agi1', 6), T('int1', 4), T('agi2', 4)],
  // linea rossa su riquadro gia' scurito e arrossato: va escluso (banned o unavailable)
  excludedExtra: [T('agi1', 22), T('int2', 3), T('int2', 4), T('int2', 13)]
};
// allpick-ban-esempio.png (2000x837): riquadri ~34x59, colonne STR x = 359 + 39.5*col, AGI 608 + 39.5*col,
// righe y = 161 + 64.5*row. Qui i bannati NON sono scuriti: solo linea rossa netta.
const E = (x0, col, row) => ({ x: Math.round(x0 + 39.5 * col), y: Math.round(161 + 64.5 * row), w: 34, h: 59, label: `x0 ${x0} col ${col} riga ${row}` });
const ESEMPIO = {
  banned: [E(359, 2, 1), E(359, 2, 4), E(608, 1, 2), { x: 1014, y: 356, w: 35, h: 58, label: 'INT riga 3 col 4' }],
  available: [E(359, 0, 0), E(359, 1, 0), E(608, 0, 0), E(608, 5, 0), E(359, 3, 1)]
};

// Rect con entrambe le convenzioni ({w,h} e {width,height}): app-dev usa width/height.
const R2 = (r) => Object.assign({}, r, { width: r.w, height: r.h });
function expectStatus(m, img, tiles, ok, label) {
  const bad = [];
  for (const r of tiles) {
    const s = m.tileStatus(img, R2(r));
    if (!ok.includes(s)) bad.push(`${r.label} -> ${s}`);
  }
  assert.deepEqual(bad, [], `${label}: attesi ${ok.join('|')}`);
}
const scaleTiles = (tiles, k) => tiles.map((r) => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k, label: r.label }));

test('tileStatus griglia-ban-reali: i 3 eroi cerchiati -> banned', (t) => {
  const m = load(t); if (!m) return;
  expectStatus(m, fixture('griglia-ban-reali.png'), REALI.banned, ['banned'], 'cerchiati');
});

test('tileStatus griglia-ban-reali: ingrigiti senza linea -> unavailable', (t) => {
  const m = load(t); if (!m) return;
  expectStatus(m, fixture('griglia-ban-reali.png'), REALI.unavailable, ['unavailable'], 'ingrigiti');
});

test('tileStatus griglia-ban-reali: riquadri normali -> available', (t) => {
  const m = load(t); if (!m) return;
  expectStatus(m, fixture('griglia-ban-reali.png'), REALI.available, ['available'], 'normali');
});

test('tileStatus griglia-ban-reali: altri riquadri con linea rossa -> esclusi (banned o unavailable)', (t) => {
  const m = load(t); if (!m) return;
  expectStatus(m, fixture('griglia-ban-reali.png'), REALI.excludedExtra, ['banned', 'unavailable'], 'linea su scurito');
});

test('tileStatus allpick-ban-esempio: linea rossa su riquadro non scurito -> banned', (t) => {
  const m = load(t); if (!m) return;
  expectStatus(m, fixture('allpick-ban-esempio.png'), ESEMPIO.banned, ['banned'], 'esempio bannati');
  expectStatus(m, fixture('allpick-ban-esempio.png'), ESEMPIO.available, ['available'], 'esempio normali');
});

for (const k of [0.6, 1.5]) {
  test(`tileStatus indipendente dalla risoluzione (scala ${k})`, (t) => {
    const m = load(t); if (!m) return;
    const img = scaleRGBA(fixture('griglia-ban-reali.png'), k);
    expectStatus(m, img, scaleTiles(REALI.banned, k), ['banned'], 'cerchiati x' + k);
    expectStatus(m, img, scaleTiles(REALI.unavailable, k), ['unavailable'], 'ingrigiti x' + k);
    expectStatus(m, img, scaleTiles(REALI.available, k), ['available'], 'normali x' + k);
  });
}

test('tileStatus: rettangolo fuori immagine o degenere -> unknown, senza crash', (t) => {
  const m = load(t); if (!m) return;
  const img = fixture('griglia-ban-reali.png');
  for (const r of [{ x: -500, y: -500, w: 10, h: 10 }, { x: 5000, y: 10, w: 58, h: 100 }, { x: 100, y: 100, w: 0, h: 0 }]) {
    assert.equal(m.tileStatus(img, R2(r)), 'unknown', JSON.stringify(r));
  }
});

const gw = (g) => (g.width != null ? g.width : g.w), gh = (g) => (g.height != null ? g.height : g.h);
const contains = (g, x, y) => g && x >= g.x && x <= g.x + gw(g) && y >= g.y && y <= g.y + gh(g);

test('findHeroGrid griglia-ban-reali: copre tutti i riquadri e resta nell\'immagine', (t) => {
  const m = load(t); if (!m) return;
  const img = fixture('griglia-ban-reali.png');
  const g = m.findHeroGrid(img);
  assert.ok(g, 'griglia non trovata');
  for (const [x, y] of [[92, 103], [1638, 199], [1438, 851], [119, 800]]) assert.ok(contains(g, x, y), `griglia ${JSON.stringify(g)} non contiene ${x},${y}`);
  assert.ok(g.x >= 0 && g.y >= 0 && g.x + gw(g) <= img.width && g.y + gh(g) <= img.height, 'griglia fuori immagine');
});

test('findHeroGrid allpick-ban-esempio: copre i 4 blocchi, esclude la barra in alto', (t) => {
  const m = load(t); if (!m) return;
  const g = m.findHeroGrid(fixture('allpick-ban-esempio.png'));
  assert.ok(g, 'griglia non trovata');
  for (const [x, y] of [[362, 165], [1255, 190], [376, 540], [1160, 540]]) assert.ok(contains(g, x, y), `griglia ${JSON.stringify(g)} non contiene ${x},${y}`);
  assert.ok(g.y > 60, 'la griglia include la barra in alto (y=' + g.y + ')');
  assert.ok(g.x + gw(g) < 1300, 'la griglia include il pannello CHOOSE YOUR HERO a destra');
});

test('findHeroGrid: schermo nero -> null', (t) => {
  const m = load(t); if (!m) return;
  const black = { width: 1280, height: 720, data: new Uint8ClampedArray(1280 * 720 * 4).fill(15) };
  assert.equal(m.findHeroGrid(black), null);
});

// B5 (tests/BUGS.md, chiuso): su allpick-ban-esempio i soli 4 bannati veri devono risultare esclusi; prima un riquadro
// normale (Skywrath Mage, x974 y420) esce 'unknown' per le ali in diagonale e verrebbe escluso senza motivo.
test('findTiles + tileStatus allpick-ban-esempio: 4 bannati, nessun falso escluso', (t) => {
  const m = load(t); if (!m) return;
  if (typeof m.findTiles !== 'function') return t.skip('findTiles non esportata');
  const img = fixture('allpick-ban-esempio.png');
  const ft = m.findTiles(img);
  assert.ok(ft && ft.tiles.length === 127, 'attesi 127 riquadri, trovati ' + (ft && ft.tiles.length));
  const notAvail = ft.tiles.map((r) => [r, m.tileStatus(img, r)]).filter(([, s]) => s !== 'available');
  const desc = notAvail.map(([r, s]) => `${s}@${r.x},${r.y}`).join(' ');
  assert.equal(notAvail.length, 4, 'esclusi: ' + desc);
  for (const b of ESEMPIO.banned) assert.ok(notAvail.some(([r, s]) => s === 'banned' && Math.abs(r.x - b.x) < 8 && Math.abs(r.y - b.y) < 8), 'bannato mancante: ' + b.label + ' (' + desc + ')');
});

test('findTiles: numero di riquadri sulle fixture (127 nella patch attuale)', (t) => {
  const m = load(t); if (!m) return;
  if (typeof m.findTiles !== 'function') return t.skip('findTiles non esportata');
  for (const f of ['allpick-ban-esempio.png', 'draft-allpick-dire.png']) {
    const ft = m.findTiles(fixture(f));
    assert.equal(ft && ft.tiles.length, 127, f);
  }
});
