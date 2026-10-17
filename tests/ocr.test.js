'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { exists, p } = require('./helpers');

function load(t) {
  if (!exists('src', 'ocr', 'parseRole.js')) { t.skip('src/ocr/parseRole.js non esiste ancora (app-dev)'); return null; }
  const m = require(p('src', 'ocr', 'parseRole.js'));
  const fn = typeof m === 'function' ? m : (m.parseRole || m.default);
  if (typeof fn !== 'function') assert.fail('parseRole non esportata come funzione');
  return fn;
}

const CASES = [
  ['Pos 1', 1], ['POS 2', 2], ['Pos 3', 3], ['Pos 4', 4], ['Pos 5', 5],
  ['Posizione 1', 1], ['Posizione 5', 5],
  ['Carry', 1], ['Safe Lane', 1], ['Mid', 2], ['Mid Lane', 2], ['Offlane', 3],
  ['Soft Support', 4], ['Hard Support', 5],
  ['Position 3', 3], ['Position 4', 4],
  ['  pos 2  ', 2], ['Pos. 3', 3], ['Pos:4', 4], ['Pos  5', 5],
  ['Ruolo: Pos 1', 1], ['Il tuo ruolo: Posizione 4', 4],
  // rumore OCR
  ['Pos 1\n', 1], ['xx Pos 3 ##', 3], ['|Pos 2|', 2], ['SOFT  SUPPORT', 4], ['Hard-Support', 5],
  ['Support (Pos 5)', 5], ['Posizione: 3', 3],
];
// Best effort (confusioni caratteri OCR): non bloccanti
const NOISY = [['P0s 2', 2], ['Pos l', 1], ['Pos I', 1], ['Pos S', 5]];

for (const [txt, exp] of NOISY) {
  test(`parseRole rumore OCR ${JSON.stringify(txt)} => ${exp}`, { todo: 'best effort' }, (t) => {
    const fn = load(t); if (!fn) return;
    assert.equal(fn(txt), exp);
  });
}

for (const [txt, exp] of CASES) {
  test(`parseRole(${JSON.stringify(txt)}) => ${exp}`, (t) => {
    const fn = load(t); if (!fn) return;
    assert.equal(fn(txt), exp);
  });
}

for (const txt of ['', '   ', 'Hello world', 'Pos 9', 'Pos 0', '12345', null, undefined]) {
  test(`parseRole(${JSON.stringify(txt)}) => null (nessun ruolo)`, (t) => {
    const fn = load(t); if (!fn) return;
    const r = fn(txt);
    assert.ok(r === null || r === undefined, 'atteso null, ottenuto ' + r);
  });
}
