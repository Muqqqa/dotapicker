'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exists, p } = require('./helpers');

function mod(t, rel) {
  if (!exists(...rel.split('/'))) { t.skip(rel + ' non esiste ancora (app-dev)'); return null; }
  return require(p(...rel.split('/')));
}

// ---- SteamID64 -> account_id
test('steam.toAccountId: SteamID64 -> account_id', (t) => {
  const m = mod(t, 'src/main/steam.js'); if (!m) return;
  assert.equal(m.toAccountId('76561197960265729'), 1);
  assert.equal(m.toAccountId('76561198000000000'), 39734272);
  assert.equal(m.toAccountId(76561197960265729n.toString()), 1);
});
test('steam.toAccountId: account_id passa invariato', (t) => {
  const m = mod(t, 'src/main/steam.js'); if (!m) return;
  assert.equal(m.toAccountId('123456789'), 123456789);
  assert.equal(m.toAccountId(' 123456789 '), 123456789);
  assert.equal(m.toAccountId(123456789), 123456789);
});
test('steam.toAccountId: URL profilo e input non valido', (t) => {
  const m = mod(t, 'src/main/steam.js'); if (!m) return;
  assert.equal(m.toAccountId('https://steamcommunity.com/profiles/76561197960265729'), 1);
  for (const bad of ['', 'abc', null, undefined, '12', '0']) assert.equal(m.toAccountId(bad), null, String(bad));
});

// ---- rank lobby
const lin = (medal, stars) => medal * 10 + stars;
test('rank.lobbyRankTier: media tra utente e avversari', (t) => {
  const m = mod(t, 'src/main/rank.js'); if (!m) return;
  // utente Crusader 3 (33), avversari tutti Legend 3 (53): media a meta' => Archon 3 (43)
  assert.equal(m.lobbyRankTier(33, [53, 53, 53, 53, 53]), 43);
  // stesso rank => invariato
  assert.equal(m.lobbyRankTier(45, [45, 45]), 45);
  // avversari ignoti => rank utente
  assert.equal(m.lobbyRankTier(45, []), 45);
  assert.equal(m.lobbyRankTier(45, null), 45);
  // utente non classificato => null
  assert.equal(m.lobbyRankTier(null, [45]), null);
  // ignora avversari senza rank
  assert.equal(m.lobbyRankTier(45, [null, 45]), 45);
});
test('rank.lobbyRankTier: simmetria e limiti', (t) => {
  const m = mod(t, 'src/main/rank.js'); if (!m) return;
  const r = m.lobbyRankTier(lin(2, 1), [lin(6, 1)]);
  assert.ok(r > lin(2, 1) && r < lin(6, 1), 'media fuori intervallo: ' + r);
  const imm = m.lobbyRankTier(80, [80]);
  assert.equal(Math.floor(imm / 10), 8);
});

// ---- persistenza Steam ID
test('store: Steam ID persiste su disco e sopravvive al riavvio', (t) => {
  const m = mod(t, 'src/main/store.js'); if (!m) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-store-'));
  try {
    const a = new m.Store(dir);
    assert.equal(a.get('steamId'), null);
    a.set('steamId', '76561197960265729');
    const b = new m.Store(dir); // "riavvio"
    assert.equal(b.get('steamId'), '76561197960265729');
    assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('store: file corrotto => default senza crash', (t) => {
  const m = mod(t, 'src/main/store.js'); if (!m) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-store-'));
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{non json');
    const s = new m.Store(dir);
    assert.equal(s.get('steamId', 'x'), 'x');
    s.set('steamId', '1');
    assert.equal(new m.Store(dir).get('steamId'), '1');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('store: crea la cartella mancante', (t) => {
  const m = mod(t, 'src/main/store.js'); if (!m) return;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-store-'));
  try {
    const dir = path.join(base, 'a', 'b');
    new m.Store(dir).set('k', 'v');
    assert.equal(new m.Store(dir).get('k'), 'v');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---- majorityRole
test('ocr.majorityRole: voto di maggioranza', (t) => {
  const m = mod(t, 'src/ocr/parseRole.js'); if (!m) return;
  assert.equal(m.majorityRole([3, null, 3, 2, 3]), 3);
  assert.equal(m.majorityRole([null, null]), null);
  // senza scritta di ruolo l'OCR legge testo a caso: un ruolo instabile non vale
  assert.equal(m.majorityRole([3, 5, 1, 3, 2]), null);
  assert.equal(m.majorityRole([3, null, 3, 2]), null);
  assert.equal(m.majorityRole([3, null, 3, 2], 2), 3);
});
