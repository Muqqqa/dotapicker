'use strict';
// Identificazione degli eroi dai ritratti della barra (src/ocr/heroMatch.js) e controller finto.
// Le icone CDN (256x144) NON stanno nel repo: i test usano la cache reale dell'app (%APPDATA%/Dota Picker/hero-icons,
// <id>.png, + heroes.json) o, in alternativa, la cartella indicata da DOTAPICKER_ICONS (heroes.json nella cartella
// padre). Se manca, i test si saltano: nessuna rete.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exists, p } = require('./helpers');
const { decodePNG, scaleRGBA } = require('./png');

const APPDATA_DIR = process.env.DOTAPICKER_ICONS
  ? path.dirname(process.env.DOTAPICKER_ICONS)
  : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Dota Picker');
const ICON_DIR = process.env.DOTAPICKER_ICONS || path.join(APPDATA_DIR, 'hero-icons');
const HEROES_FILE = path.join(APPDATA_DIR, 'heroes.json');

function icons(t) {
  if (!exists('src', 'ocr', 'heroMatch.js')) { t.skip('src/ocr/heroMatch.js non esiste (app-dev)'); return null; }
  const n = fs.existsSync(ICON_DIR) ? fs.readdirSync(ICON_DIR).filter((f) => /^\d+\.png$/.test(f)).length : 0;
  if (n < 100) { t.skip('icone eroi non in cache (' + ICON_DIR + "): avvia l'app una volta o imposta DOTAPICKER_ICONS"); return null; }
  if (!fs.existsSync(HEROES_FILE)) { t.skip('heroes.json non in cache (' + HEROES_FILE + ')'); return null; }
  return { heroes: JSON.parse(fs.readFileSync(HEROES_FILE, 'utf8')) };
}
const cache = {};
const fixture = (name) => cache[name] || (cache[name] = decodePNG(p('tests', 'fixtures', name)));

let matcherP = null;
function getMatcher(heroes) {
  if (!matcherP) {
    const { HeroMatcher } = require(p('src', 'ocr', 'heroMatch.js'));
    const m = new HeroMatcher({
      cacheDir: ICON_DIR,
      heroes: heroes.map((h) => ({ id: h.id, name: h.name })),
      urlFor: () => 'https://invalid.invalid/offline.png' // la cache esiste: nessun download
    });
    matcherP = m.init().then(() => m);
  }
  return matcherP;
}
const topbar = () => require(p('src', 'ocr', 'topbar.js'));

// Verita' a terra (Valve hero id). Radiant = slot 0-4, Dire = 5-9. Verificati a occhio: slot 0 Axe, slot 5 Keeper of the
// Light (scritta "ENTERING BATTLE AS"), slot 3 Zeus; gli altri vengono dal riconoscimento di app-dev.
const TRUTH = { 0: 2, 1: 18, 2: 36, 3: 22, 4: 20, 5: 90, 6: 30, 7: 6, 8: 37, 9: 29 };
const NAMES = { 2: 'Axe', 18: 'Sven', 36: 'Necrophos', 22: 'Zeus', 20: 'Vengeful Spirit', 90: 'Keeper of the Light', 30: 'Witch Doctor', 6: 'Drow Ranger', 37: 'Warlock', 29: 'Tidehunter' };

function identifyAll(m, img) {
  const tb = topbar().findTopBar(img);
  assert.ok(tb, 'barra non trovata');
  return tb.slots.map((s) => {
    const r = m.identifyPortrait(img, s.portrait);
    return r ? r.heroId : null;
  });
}

test('identifyPortrait strategy-time-dire: 10 eroi riconosciuti', async (t) => {
  const c = icons(t); if (!c) return;
  const m = await getMatcher(c.heroes);
  assert.ok(m.ready, 'matcher non pronto');
  const got = identifyAll(m, fixture('strategy-time-dire.png'));
  const diff = got.map((id, i) => (id === TRUTH[i] ? null : `slot ${i}: atteso ${NAMES[TRUTH[i]]}, letto ${id}`)).filter(Boolean);
  assert.deepEqual(diff, []);
  assert.equal(got[0], 2); assert.equal(got[3], 22); assert.equal(got[5], 90);
});

for (const k of [0.6, 1.5]) {
  test(`identifyPortrait strategy-time-dire: scala ${k}`, async (t) => {
    const c = icons(t); if (!c) return;
    const m = await getMatcher(c.heroes);
    const got = identifyAll(m, scaleRGBA(fixture('strategy-time-dire.png'), k));
    const wrong = got.map((id, i) => (id === TRUTH[i] ? null : `slot ${i}: ${id}`)).filter(Boolean);
    assert.ok(wrong.length <= 1, `troppi errori a scala ${k}: ${wrong.join(', ')}`);
    assert.equal(got[5], 90, 'Keeper of the Light non riconosciuto');
  });
}

test('identifyPortrait: slot vuoti (draft-allpick-dire, nessun pick) -> null, isEmptyPortrait', async (t) => {
  const c = icons(t); if (!c) return;
  const m = await getMatcher(c.heroes);
  const { isEmptyPortrait } = require(p('src', 'ocr', 'heroMatch.js'));
  const img = fixture('draft-allpick-dire.png');
  const tb = topbar().findTopBar(img);
  const found = tb.slots.map((s) => m.identifyPortrait(img, s.portrait)).filter(Boolean);
  assert.deepEqual(found, [], 'riconosciuti eroi in slot vuoti: ' + JSON.stringify(found));
  assert.ok(tb.slots.every((s) => isEmptyPortrait(img, s.portrait)), 'isEmptyPortrait false su uno slot vuoto');
});

test('identifyPortrait: punteggio alto e distacco dal secondo (slot noti)', async (t) => {
  const c = icons(t); if (!c) return;
  const m = await getMatcher(c.heroes);
  const img = fixture('strategy-time-dire.png');
  const tb = topbar().findTopBar(img);
  for (const i of [0, 3, 5]) {
    const r = m.identifyPortrait(img, tb.slots[i].portrait);
    assert.ok(r && r.score >= 0.7 && r.margin >= 0.1, `slot ${i}: ${JSON.stringify(r)}`);
  }
});

// ---- controller finto (senza Electron) ----
function fakeElectron(img) {
  const bgra = Buffer.alloc(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) {
    bgra[i * 4] = img.data[i * 4 + 2]; bgra[i * 4 + 1] = img.data[i * 4 + 1]; bgra[i * 4 + 2] = img.data[i * 4]; bgra[i * 4 + 3] = 255;
  }
  const thumbnail = { getSize: () => ({ width: img.width, height: img.height }), isEmpty: () => false, toBitmap: () => bgra };
  return {
    screen: { getPrimaryDisplay: () => ({ id: 1, size: { width: img.width, height: img.height }, scaleFactor: 1, bounds: { x: 0, y: 0, width: img.width, height: img.height } }) },
    desktopCapturer: { getSources: async () => [{ display_id: '1', thumbnail }] }
  };
}

test('controller finto: strategy-time-dire -> draft, slot 5 dire, squadre, matchEstimate', async (t) => {
  const c = icons(t); if (!c) return;
  if (!exists('src', 'main', 'controller.js')) return t.skip('controller assente');
  const { Controller } = require(p('src', 'main', 'controller.js'));
  const { Store } = require(p('src', 'main', 'store.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-ctl-'));
  fs.mkdirSync(path.join(dir, 'hero-icons'));
  for (const f of fs.readdirSync(ICON_DIR)) if (/^\d+\.png$/.test(f)) fs.copyFileSync(path.join(ICON_DIR, f), path.join(dir, 'hero-icons', f));
  fs.copyFileSync(HEROES_FILE, path.join(dir, 'heroes.json'));
  const store = new Store(dir);
  store.set('steamId', '76561198000000000'); store.set('rankTier', 55); store.set('personaname', "Mooq'a#PEPPE");
  const realFetch = global.fetch;
  const online = !!process.env.DOTAPICKER_ONLINE; // con DOTAPICKER_ONLINE=1 l'engine scarica i dati veri (matchEstimate)
  if (!online) global.fetch = async () => { throw new Error('rete disattivata nei test'); };
  const ctl = new Controller(Object.assign({ store, userDataDir: dir, nativeImage: null, emit: () => {} }, fakeElectron(fixture('strategy-time-dire.png'))));
  try {
    ctl.lastProfileOk = Date.now();
    for (let i = 0; i < 100 && !(ctl.matcher && ctl.matcher.ready); i++) { await ctl.ensureMatcher(); await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(ctl.matcher && ctl.matcher.ready, 'matcher non pronto');
    await ctl.tick();
    for (let i = 0; online && i < 60 && ctl.state.matchEstimate == null; i++) { await new Promise((r) => setTimeout(r, 1000)); await ctl.tick(); }
    const s = ctl.state;
    assert.equal(s.status, 'draft', JSON.stringify({ status: s.status, message: s.message }));
    assert.equal(s.mySlot, 5); assert.equal(s.mySide, 'dire');
    const ids = (a) => a.map((h) => h.heroId).sort((x, y) => x - y);
    assert.equal(s.myHero && s.myHero.heroId, 90, 'myHero = Keeper of the Light');
    assert.deepEqual(ids(s.allies.concat(s.myHero ? [s.myHero] : [])), [6, 29, 30, 37, 90].sort((x, y) => x - y), 'alleati');
    assert.deepEqual(ids(s.enemies), [2, 18, 20, 22, 36].sort((x, y) => x - y), 'nemici');
    if (s.matchEstimate == null) return t.skip('matchEstimate null: offline engine senza i dati di tutti gli eroi (prova con DOTAPICKER_ONLINE=1)');
    assert.equal(typeof s.matchEstimate, 'object');
  } finally {
    global.fetch = realFetch;
    try { await ctl.nameOcr.terminate(); await ctl.ocr.terminate(); } catch (e) { /* ok */ }
  }
});
