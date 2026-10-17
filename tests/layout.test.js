// Calcolo delle regioni OCR per risoluzione (src/ocr/layout.js) e precedenza della calibrazione utente.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const L = require(path.join(__dirname, '..', 'src', 'ocr', 'layout.js'));
const defaults = require(path.join(__dirname, '..', 'src', 'ocr', 'regions.default.json'));

const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.width <= W && r.y + r.height <= H && r.width >= L.MIN_SIZE && r.height >= L.MIN_SIZE;

test('layout: tutte le regioni esistono e stanno nello schermo per le risoluzioni comuni', () => {
  const sizes = [[1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160], [1920, 1200], [1680, 1050], [1024, 768], [2560, 1080], [3440, 1440], [5120, 1440]];
  for (const [W, H] of sizes) {
    const r = L.presetRegions(defaults, W, H);
    for (const id of L.REGION_IDS) {
      assert.ok(r[id], `${W}x${H}: manca ${id}`);
      assert.ok(inside(r[id], W, H), `${W}x${H}: ${id} fuori schermo ${JSON.stringify(r[id])}`);
    }
  }
});

test('layout: in 16:9 le regioni scalano in proporzione da 1920x1080', () => {
  const a = L.presetRegions(defaults, 1920, 1080), b = L.presetRegions(defaults, 3840, 2160);
  for (const id of L.REGION_IDS) {
    assert.ok(Math.abs(b[id].x - 2 * a[id].x) <= 2 && Math.abs(b[id].y - 2 * a[id].y) <= 2, `${id} non scala x2`);
    assert.ok(Math.abs(b[id].width - 2 * a[id].width) <= 2, `${id} larghezza non scala x2`);
  }
});

test('layout: su ultrawide il draft resta centrato (non stirato)', () => {
  const n = L.presetRegions(defaults, 2560, 1440), u = L.presetRegions(defaults, 3440, 1440);
  for (const id of L.REGION_IDS) {
    assert.ok(Math.abs(u[id].width - n[id].width) <= 2, `${id}: larghezza cambiata su ultrawide`);
    assert.ok(Math.abs((u[id].x - n[id].x) - (3440 - 2560) / 2) <= 2, `${id}: non centrato su ultrawide`);
  }
});

test('layout: alleati e nemici ordinati da sinistra a destra senza sovrapporsi', () => {
  const r = L.presetRegions(defaults, 1920, 1080);
  for (const ids of [L.ALLY_IDS, L.ENEMY_IDS]) {
    for (let i = 1; i < ids.length; i++) assert.ok(r[ids[i]].x >= r[ids[i - 1]].x + r[ids[i - 1]].width, `${ids[i]} sovrapposto a ${ids[i - 1]}`);
  }
});

test('layout: alleati e nemici predefiniti sono speculari rispetto al centro dello schermo', () => {
  for (const [W, H] of [[1920, 1080], [2560, 1440], [3440, 1440]]) {
    const r = L.presetRegions(defaults, W, H);
    for (let i = 0; i < 5; i++) {
      const a = r[L.ALLY_IDS[i]], e = r[L.ENEMY_IDS[4 - i]];
      const mirror = W - (e.x + e.width);
      assert.ok(Math.abs(a.x - mirror) <= 3, `${W}x${H}: ${L.ALLY_IDS[i]} non speculare a ${L.ENEMY_IDS[4 - i]} (${a.x} vs ${mirror})`);
      assert.ok(Math.abs(a.width - e.width) <= 2 && Math.abs(a.y - e.y) <= 2, `${W}x${H}: slot ${i + 1} di dimensioni diverse`);
    }
  }
});

test('layout: la calibrazione utente vale solo per la sua risoluzione e ha la precedenza', () => {
  const key = L.resolutionKey(2560, 1440, 1);
  assert.strictEqual(key, '2560x1440@1');
  const preset = L.presetRegions(defaults, 2560, 1440);
  const mine = Object.assign({}, preset, { roleText: { x: 100, y: 200, width: 300, height: 40 } });
  const res = L.resolveRegions({ defaults, user: mine, width: 2560, height: 1440, scaleFactor: 1 });
  assert.strictEqual(res.source, 'utente');
  assert.deepStrictEqual(res.regions.roleText, { x: 100, y: 200, width: 300, height: 40 });
  const none = L.resolveRegions({ defaults, user: null, width: 2560, height: 1440, scaleFactor: 1 });
  assert.strictEqual(none.source, 'preset');
});

test('layout: regioni utente non valide vengono scartate o corrette', () => {
  const bad = { roleText: { x: -50, y: 99999, width: 'x', height: 2 } };
  const res = L.resolveRegions({ defaults, user: bad, width: 1920, height: 1080, scaleFactor: 1 });
  for (const id of L.REGION_IDS) assert.ok(inside(res.regions[id], 1920, 1080), `${id} non valida dopo la correzione`);
});

test('layout: conversione da DIP a pixel dell\'immagine catturata con scala 150%', () => {
  const px = L.toPixelRect({ x: 100, y: 50, width: 200, height: 40 }, 2560, 1440, 3840, 2160);
  assert.deepStrictEqual([px.x, px.y, px.width, px.height], [150, 75, 300, 60]);
});
