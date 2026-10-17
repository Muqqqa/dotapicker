'use strict';
// CONTRACT-v2: src/ocr/topbar.js (app-dev) -> findTopBar / matchNickname / sideOf, su screenshot reali.
const test = require('node:test');
const assert = require('node:assert/strict');
const { exists, p } = require('./helpers');
const { decodePNG, scaleRGBA, cropRGBA } = require('./png');

function load(t) {
  if (!exists('src', 'ocr', 'topbar.js')) { t.skip('src/ocr/topbar.js non ancora pubblicato (app-dev)'); return null; }
  const m = require(p('src', 'ocr', 'topbar.js'));
  for (const f of ['findTopBar', 'matchNickname', 'sideOf']) assert.equal(typeof m[f], 'function', f + ' non esportata');
  return m;
}
const cache = {};
const fixture = (name) => cache[name] || (cache[name] = decodePNG(p('tests', 'fixtures', name)));
// Rect: il contratto non fissa i nomi; app-dev usa {x,y,width,height} (come Electron). Accettiamo anche {w,h}.
const W_ = (r) => (r.width != null ? r.width : r.w), H_ = (r) => (r.height != null ? r.height : r.h);
const inRect = (r, x, y, tol = 0) => r && x >= r.x - tol && x <= r.x + W_(r) + tol && y >= r.y - tol && y <= r.y + H_(r) + tol;
const cx = (r) => r.x + W_(r) / 2;

// Verita' a terra, misurata a mano su draft-allpick-dire.png (2000x837).
const TRUTH = {
  barY: 52,                // le lineette colorate
  dire0Bar: { x: 1147, y: 52 },  // centro lineetta primo slot Dire (rosa)
  dire0Name: { x: 1140, y: 71 }, // "Mooq'a#PE..."
  radiant0Bar: { x: 467, y: 52 } // centro lineetta primo slot Radiant (blu)
};

function checkBar(m, img, k, label) {
  const tb = m.findTopBar(img);
  assert.ok(tb, label + ': findTopBar ha restituito null');
  assert.equal(tb.slots.length, 10, label + ': servono 10 slot');
  tb.slots.forEach((s, i) => {
    assert.equal(s.index, i, label + ': indici 0..9 in ordine');
    assert.equal(s.side, i < 5 ? 'radiant' : 'dire', label + ': lato dello slot ' + i);
    for (const r of ['bar', 'portrait', 'name']) assert.ok(s[r] && W_(s[r]) > 0 && H_(s[r]) > 0, `${label}: slot ${i}.${r} non valido`);
  });
  const found = tb.slots.filter((s) => s.found).length;
  assert.equal(found, 10, label + ': tutte e 10 le lineette sono visibili, trovate ' + found);
  assert.ok(tb.confidence >= 0.6 && tb.confidence <= 1, label + ': confidence ' + tb.confidence);
  for (let i = 1; i < 10; i++) assert.ok(cx(tb.slots[i].bar) > cx(tb.slots[i - 1].bar), label + ': slot non ordinati da sinistra a destra');
  const tol = Math.max(3, 6 * k);
  const s5 = tb.slots[5], s0 = tb.slots[0];
  assert.ok(inRect(s5.bar, TRUTH.dire0Bar.x * k, TRUTH.dire0Bar.y * k, tol), `${label}: lineetta slot 5 ${JSON.stringify(s5.bar)} non contiene ${TRUTH.dire0Bar.x * k},${TRUTH.dire0Bar.y * k}`);
  assert.ok(inRect(s0.bar, TRUTH.radiant0Bar.x * k, TRUTH.radiant0Bar.y * k, tol), `${label}: lineetta slot 0 fuori posto ${JSON.stringify(s0.bar)}`);
  assert.ok(inRect(s5.name, TRUTH.dire0Name.x * k, TRUTH.dire0Name.y * k, tol), `${label}: rettangolo nome slot 5 ${JSON.stringify(s5.name)} non contiene il nick`);
  assert.ok(s5.portrait.y + H_(s5.portrait) <= s5.bar.y + H_(s5.bar) + tol, label + ': ritratto non sopra la lineetta');
  assert.ok(s5.name.y >= s5.bar.y - tol, label + ': nome non sotto la lineetta');
  return tb;
}

test('findTopBar: draft-allpick-dire -> 10 slot, posizioni giuste', (t) => {
  const m = load(t); if (!m) return;
  checkBar(m, fixture('draft-allpick-dire.png'), 1, 'originale');
});

test('findTopBar: anche su allpick-ban-esempio (stessa barra)', (t) => {
  const m = load(t); if (!m) return;
  checkBar(m, fixture('allpick-ban-esempio.png'), 1, 'esempio');
});

for (const k of [0.6, 1.5]) {
  test(`findTopBar: indipendente dalla risoluzione (scala ${k})`, (t) => {
    const m = load(t); if (!m) return;
    checkBar(m, scaleRGBA(fixture('draft-allpick-dire.png'), k), k, 'scala ' + k);
  });
}

test('findTopBar: proporzioni diverse (stretch orizzontale 16:9)', (t) => {
  const m = load(t); if (!m) return;
  const src = fixture('draft-allpick-dire.png');
  // 2000x837 (~21:9) schiacciato a 1488x837 (16:9): le x scalano di 0.744, le y no.
  const img = scaleRGBA(src, { width: 1488, height: 837 });
  const tb = m.findTopBar(img);
  assert.ok(tb, 'null su 16:9');
  assert.equal(tb.slots.filter((s) => s.found).length, 10);
  assert.ok(inRect(tb.slots[5].name, 1140 * 0.744, 71, 6), 'nome slot 5 fuori posto: ' + JSON.stringify(tb.slots[5].name));
});

test('findTopBar: ritaglio (barra non centrata nell\'immagine)', (t) => {
  const m = load(t); if (!m) return;
  const img = cropRGBA(fixture('draft-allpick-dire.png'), { x: 300, y: 0, w: 1500, h: 400 });
  const tb = m.findTopBar(img);
  assert.ok(tb, 'null sul ritaglio');
  assert.equal(tb.slots.filter((s) => s.found).length, 10);
  assert.ok(inRect(tb.slots[5].name, 1140 - 300, 71, 6), 'nome slot 5 fuori posto: ' + JSON.stringify(tb.slots[5].name));
});

test('findTopBar: immagine senza barra -> null o confidenza bassa', (t) => {
  const m = load(t); if (!m) return;
  const black = { width: 1920, height: 1080, data: new Uint8ClampedArray(1920 * 1080 * 4).fill(20) };
  const r1 = m.findTopBar(black);
  assert.ok(r1 === null || r1.confidence < 0.3, 'schermo nero: ' + (r1 && r1.confidence));
  const r2 = m.findTopBar(fixture('griglia-ban-reali.png'));
  assert.ok(r2 === null || r2.confidence < 0.5 || r2.slots.filter((s) => s.found).length < 5, 'griglia senza barra riconosciuta come barra');
});

test('sideOf: 0-4 radiant, 5-9 dire', (t) => {
  const m = load(t); if (!m) return;
  for (let i = 0; i < 10; i++) assert.equal(m.sideOf(i), i < 5 ? 'radiant' : 'dire');
});

// ---- matchNickname ----
const slots = (map) => Array.from({ length: 10 }, (_, i) => (i in map ? map[i] : null));
const idx = (r) => (r ? r.index : null);

test('matchNickname: caso reale draft-allpick-dire (nick troncato "…") -> slot 5, lato dire', (t) => {
  const m = load(t); if (!m) return;
  for (const nick of ["Mooq'a#PE", "Mooq'a#PEPPE", "Mooq'a#PE1234567"]) {
    const r = m.matchNickname(slots({ 5: "Mooq'a#PE…" }), nick);
    assert.equal(idx(r), 5, 'nick ' + nick + ' -> ' + JSON.stringify(r));
    assert.ok(r.score > 0 && r.score <= 1, 'score ' + r.score);
    assert.equal(m.sideOf(r.index), 'dire');
  }
});

const CASES = [
  ['tre punti', { 5: "Mooq'a#PE..." }, "Mooq'a#PEPPE", 5],
  ['maiuscole', { 7: "MOOQ'A#PE…" }, "Mooq'a#PEPPE", 7],
  ['0 al posto di O', { 2: "M00q'a#PE…" }, "Mooq'a#PEPPE", 2],
  ['nome intero non troncato', { 9: 'Pippo' }, 'Pippo', 9],
  ['l/I/1', { 3: 'Ki11er' }, 'Killer', 3],
  ['I al posto di l', { 1: 'KiIIer…' }, 'Killer_99', 1],
  ['5 al posto di S', { 0: '5a5uke' }, 'SaSuke', 0],
  ['spazi ai bordi', { 4: "  Mooq'a#PE…  " }, "Mooq'a#PEPPE", 4],
  ['tra altri giocatori', { 0: 'Pippo', 1: 'Mario Rossi', 5: 'zZz', 6: "Mooq'a#PE…", 8: 'Gandalf' }, "Mooq'a#PEPPE", 6],
  ['distrattore simile', { 3: 'Mooqx', 8: "Mooq'a#PE…" }, "Mooq'a#PEPPE", 8],
];
for (const [label, map, nick, exp] of CASES) {
  test(`matchNickname: ${label} -> ${exp}`, (t) => {
    const m = load(t); if (!m) return;
    const r = m.matchNickname(slots(map), nick);
    assert.equal(idx(r), exp, JSON.stringify(r));
  });
}

const ABSENT = [
  ['nick assente', { 0: 'Pippo', 5: 'Mario', 9: 'Gandalf' }, "Mooq'a#PEPPE"],
  ['tutti null (bot)', {}, "Mooq'a#PEPPE"],
  ['stringhe vuote', { 0: '', 1: '   ', 2: '…' }, "Mooq'a#PEPPE"],
  ['nick completamente diverso', { 5: 'Xyzzy…' }, "Mooq'a#PEPPE"],
];
for (const [label, map, nick] of ABSENT) {
  test(`matchNickname: ${label} -> null`, (t) => {
    const m = load(t); if (!m) return;
    assert.equal(m.matchNickname(slots(map), nick), null);
  });
}

test('matchNickname: personaname vuoto o null -> null senza crash', (t) => {
  const m = load(t); if (!m) return;
  for (const nick of ['', null, undefined]) assert.equal(m.matchNickname(slots({ 5: "Mooq'a#PE…" }), nick), null);
});

// Catena completa con OCR vero (tesseract.js): solo se installato e con i dati lingua gia' in cache
// (tools/vision-bench/.cache, scaricati dal banco al primo uso): niente rete durante i test.
test('catena reale: findTopBar -> OCR nomi -> matchNickname -> slot 5, dire', async (t) => {
  const m = load(t); if (!m) return;
  const fs = require('fs');
  const cache = p('tools', 'vision-bench', '.cache');
  let hasTess = true; try { require.resolve('tesseract.js', { paths: [p()] }); } catch (e) { hasTess = false; }
  if (!hasTess) return t.skip('tesseract.js non installato (npm install)');
  if (!exists('src', 'ocr', 'nameOcr.js')) return t.skip('src/ocr/nameOcr.js non pubblicato (app-dev)');
  if (!['eng', 'ita'].every((l) => fs.existsSync(require('path').join(cache, l + '.traineddata')))) return t.skip('dati lingua non in cache: apri una volta il banco vision-bench');
  const { NameOcr } = require(p('src', 'ocr', 'nameOcr.js'));
  const ocr = new NameOcr(cache);
  try {
    const img = fixture('draft-allpick-dire.png');
    const tb = m.findTopBar(img);
    const names = await ocr.readNames(img, tb.slots);
    assert.equal(names.length, 10);
    assert.match(String(names[5]), /^Mooq/i, 'OCR slot 5: ' + names[5]);
    names.forEach((n, i) => { if (i !== 5) assert.equal(n, null, `slot ${i} (bot) dovrebbe essere vuoto, letto ${JSON.stringify(n)}`); });
    const r = m.matchNickname(names, "Mooq'a#PEPPE");
    assert.equal(r && r.index, 5);
    assert.equal(m.sideOf(r.index), 'dire');
  } finally { await ocr.terminate(); }
});

// ---- STRATEGY TIME (strategy-time-dire.png, 2000x837 da 3440x1440): la lineetta sta SOPRA il ritratto ----
// Verita' a terra misurata a mano: lineette a y=0..4; ritratto subito sotto, y~5..57 (altezza ~52, larghezza ~88);
// nome centrato a y~64..78 (slot 5: "Mooq'a#PE…" a x~1140,y~71). Slot 0 = Axe, slot 5 = Keeper of the Light.
const ST = { portrait5: { x: 1110, y: 6, w: 80, h: 48 }, name5: { x: 1140, y: 71 }, name0: { x: 465, y: 71 } };
function checkStrategy(m, img, k, label) {
  const tb = m.findTopBar(img);
  assert.ok(tb, label + ': findTopBar null');
  assert.equal(tb.slots.filter((s) => s.found).length, 10, label + ': servono 10 lineette trovate');
  assert.ok(tb.confidence >= 0.6, label + ': confidence ' + tb.confidence);
  tb.slots.forEach((s, i) => {
    assert.ok(H_(s.portrait) > 30 * k, `${label}: ritratto slot ${i} alto ${H_(s.portrait)} (atteso > ${Math.round(30 * k)})`);
    assert.ok(s.portrait.y >= s.bar.y + H_(s.bar) - 2 * k - 2, `${label}: ritratto slot ${i} non sotto la lineetta (portrait.y ${s.portrait.y}, bar ${JSON.stringify(s.bar)})`);
  });
  const s5 = tb.slots[5], tol = Math.max(4, 6 * k);
  const cxp = s5.portrait.x + W_(s5.portrait) / 2;
  assert.ok(Math.abs(cxp - 1148 * k) < 12 * k, `${label}: ritratto slot 5 centrato a ${cxp}, atteso ~${1148 * k}`);
  assert.ok(inRect(s5.name, ST.name5.x * k, ST.name5.y * k, tol), `${label}: rettangolo nome slot 5 ${JSON.stringify(s5.name)} non contiene il nick`);
  assert.ok(inRect(tb.slots[0].name, ST.name0.x * k, ST.name0.y * k, tol), `${label}: rettangolo nome slot 0 fuori posto ${JSON.stringify(tb.slots[0].name)}`);
  return tb;
}
const STRATEGY_TODO = false; // B8 chiuso da app-dev
test('strategy-time-dire: 10/10 lineette, ritratto SOTTO la lineetta, nome dove sta il testo', { todo: STRATEGY_TODO }, (t) => {
  const m = load(t); if (!m) return;
  checkStrategy(m, fixture('strategy-time-dire.png'), 1, 'strategy');
});
for (const k of [0.6, 1.5]) {
  test(`strategy-time-dire: indipendente dalla risoluzione (scala ${k})`, { todo: STRATEGY_TODO }, (t) => {
    const m = load(t); if (!m) return;
    checkStrategy(m, scaleRGBA(fixture('strategy-time-dire.png'), k), k, 'strategy x' + k);
  });
}
test('strategy-time-dire: nickname -> slot 5, lato dire (nomi trascritti)', (t) => {
  const m = load(t); if (!m) return;
  const names = ['Елена', 'Κατερίνα', 'Andreas', 'Jia', 'Eszter', "Mooq'a#PE…", 'Amadou', 'Trung', '詩涵', 'ไทย'];
  const r = m.matchNickname(names, "Mooq'a#PEPPE");
  assert.equal(r && r.index, 5);
  assert.equal(m.sideOf(r.index), 'dire');
});
test('strategy-time-dire: catena reale con OCR vero -> slot 5, dire', { todo: STRATEGY_TODO }, async (t) => {
  const m = load(t); if (!m) return;
  const fs = require('fs'), cache = p('tools', 'vision-bench', '.cache');
  try { require.resolve('tesseract.js', { paths: [p()] }); } catch (e) { return t.skip('tesseract.js non installato'); }
  if (!['eng', 'ita'].every((l) => fs.existsSync(require('path').join(cache, l + '.traineddata')))) return t.skip('dati lingua non in cache');
  const { NameOcr } = require(p('src', 'ocr', 'nameOcr.js'));
  const ocr = new NameOcr(cache);
  try {
    const img = fixture('strategy-time-dire.png');
    const names = await ocr.readNames(img, m.findTopBar(img).slots);
    assert.match(String(names[5]), /^Mooq/i, 'OCR slot 5: ' + names[5]);
    const r = m.matchNickname(names, "Mooq'a#PEPPE");
    assert.equal(r && r.index, 5, JSON.stringify(names));
  } finally { await ocr.terminate(); }
});

test('nameOcr.prepareName: il testo azzurro chiaro dei nomi si legge, l\'icona arancione no', () => {
  const { prepareName } = require('../src/ocr/nameOcr');
  const W = 120, H = 30, data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 30; data[i * 4 + 1] = 40; data[i * 4 + 2] = 55; data[i * 4 + 3] = 255; }
  const put = (x0, x1, rgb) => { for (let y = 8; y < 20; y++) for (let x = x0; x < x1; x++) { const j = (y * W + x) * 4; data[j] = rgb[0]; data[j + 1] = rgb[1]; data[j + 2] = rgb[2]; } };
  put(10, 60, [170, 195, 235]); // testo azzurro chiaro (saturazione ~65): deve restare
  const withText = prepareName({ data, width: W, height: H }, { x: 0, y: 0, width: W, height: H });
  assert.ok(withText, 'il testo azzurro chiaro non deve essere scartato come se fosse colore');
  const onlyIcon = Buffer.from(data);
  for (let i = 0; i < W * H; i++) { onlyIcon[i * 4] = 30; onlyIcon[i * 4 + 1] = 40; onlyIcon[i * 4 + 2] = 55; }
  const put2 = (x0, x1, rgb) => { for (let y = 8; y < 20; y++) for (let x = x0; x < x1; x++) { const j = (y * W + x) * 4; onlyIcon[j] = rgb[0]; onlyIcon[j + 1] = rgb[1]; onlyIcon[j + 2] = rgb[2]; } };
  put2(10, 60, [235, 120, 40]); // icona arancione (saturazione ~195): non e' testo
  assert.equal(prepareName({ data: onlyIcon, width: W, height: H }, { x: 0, y: 0, width: W, height: H }), null);
});
