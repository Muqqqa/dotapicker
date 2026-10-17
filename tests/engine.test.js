'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getEngine } = require('./helpers');

// Heroes id Dota noti (Valve): 1 AM, 2 Axe, 5 CM, 8 Jugg, 14 Pudge, 26 Lion, 33 Enigma, 41 Void, 86 Rubick, 74 Invoker
const ALLIES = [2, 26];
const ENEMIES = [1, 8, 74];

let ctx;
async function ready(t) {
  if (!ctx) ctx = await getEngine();
  if (ctx.skip) { t.skip(ctx.skip); return null; }
  return ctx.eng;
}

function run(eng, over) {
  return eng.suggest(Object.assign({ allies: ALLIES, enemies: ENEMIES, role: 1, rankTier: 55 }, over));
}

test('suggest: lancia errore chiaro se i dati non sono caricati', async (t) => {
  const { exists } = require('./helpers');
  if (!exists('src', 'engine', 'index.js')) return t.skip('engine assente');
  // modulo fresco in processo separato per evitare lo stato condiviso
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['-e',
    "const e=require('./src/engine');try{e.suggest({allies:[],enemies:[],role:1,rankTier:55});console.log('NOERR')}catch(x){console.log('ERR:'+x.message)}"],
    { cwd: require('./helpers').ROOT, encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  if (out.startsWith('NOERR') && ctx && ctx.skip) return t.skip('dati preinstallati: nessun errore (accettabile?)');
  assert.ok(out.startsWith('ERR:') && out.length > 8, 'atteso errore con messaggio chiaro, ottenuto: ' + out + r.stderr);
});

test('suggest: forma dell\'output e score 0-100', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const r = run(eng);
  assert.ok(r.top && typeof r.top === 'object');
  assert.ok(Array.isArray(r.alternatives) && r.alternatives.length === 5, 'servono 5 alternative (6 suggerimenti in tutto)');
  assert.ok(Array.isArray(r.teamNeeds));
  for (const pk of [r.top, ...r.alternatives]) {
    assert.equal(typeof pk.heroId, 'number');
    assert.equal(typeof pk.name, 'string');
    assert.ok(pk.name.length > 0);
    assert.equal(typeof pk.img, 'string');
    assert.ok(pk.score >= 0 && pk.score <= 100, 'score fuori range: ' + pk.score);
    for (const k of ['winrate', 'counter', 'synergy']) assert.equal(typeof pk[k], 'number', k);
    assert.ok(Array.isArray(pk.reasons) && pk.reasons.length > 0, 'reasons vuote');
    pk.reasons.forEach((x) => assert.equal(typeof x, 'string'));
  }
  for (const n of r.teamNeeds) {
    assert.equal(typeof n.key, 'string');
    assert.equal(typeof n.label, 'string');
    assert.ok(n.level >= 0 && n.level <= 1, 'level fuori range');
    assert.equal(typeof n.note, 'string');
  }
});

test('suggest: top diverso dalle alternatives e senza duplicati', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const r = run(eng);
  const ids = [r.top, ...r.alternatives].map((x) => x.heroId);
  assert.equal(new Set(ids).size, ids.length, 'duplicati: ' + ids);
});

test('suggest: top ordinato per score >= alternatives', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const r = run(eng);
  for (const a of r.alternatives) assert.ok(r.top.score >= a.score, 'top ha score minore di una alternativa');
});

test('suggest: nessun eroe gia\' scelto viene suggerito', async (t) => {
  const eng = await ready(t); if (!eng) return;
  for (const role of [1, 2, 3, 4, 5]) {
    const r = run(eng, { role });
    const picked = new Set([...ALLIES, ...ENEMIES]);
    for (const pk of [r.top, ...r.alternatives]) assert.ok(!picked.has(pk.heroId), `ruolo ${role}: suggerito eroe gia' scelto ${pk.heroId}`);
  }
});

test('suggest: ruolo diverso => ranking diverso', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const sig = (role) => { const r = run(eng, { role }); return [r.top, ...r.alternatives].map((x) => x.heroId).join(','); };
  const sigs = new Set([1, 2, 3, 4, 5].map(sig));
  assert.ok(sigs.size > 1, 'tutti i ruoli danno lo stesso ranking: ' + [...sigs]);
  assert.notEqual(sig(1), sig(5), 'carry (1) e support (5) identici');
});

test('suggest: deterministico a parita\' di input', async (t) => {
  const eng = await ready(t); if (!eng) return;
  assert.deepEqual(run(eng), run(eng));
});

test('suggest: draft vuoto non crasha', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const r = run(eng, { allies: [], enemies: [] });
  assert.ok(r.top);
});

test('teamNeeds: disable mancante evidenziato in draft senza controllo', async (t) => {
  const eng = await ready(t); if (!eng) return;
  // alleati senza controllo: Anti-Mage, Juggernaut (nessun disable di rilievo)
  const noCtl = run(eng, { allies: [1, 8], enemies: [] , role: 4});
  const dis = noCtl.teamNeeds.find((n) => n.key === 'disable');
  assert.ok(dis, 'manca la voce teamNeeds con key "disable"');
  // con controllo (Lion, Enigma, Axe) il livello deve essere maggiore
  const ctl = run(eng, { allies: [26, 33, 2], enemies: [], role: 1 });
  const dis2 = ctl.teamNeeds.find((n) => n.key === 'disable');
  assert.ok(dis2);
  assert.ok(dis.level < dis2.level, `level disable senza controllo (${dis.level}) non < con controllo (${dis2.level})`);
});

test('il pick coprente sale: se manca disable, il suggerimento aumenta il controllo', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const base = { allies: [1, 8], enemies: [], role: 4 };
  const r = run(eng, base);
  // Il top suggerito, aggiunto al team, deve migliorare (o non peggiorare) il livello disable
  const before = r.teamNeeds.find((n) => n.key === 'disable').level;
  const after = run(eng, { allies: [1, 8, r.top.heroId], enemies: [], role: 5 }).teamNeeds.find((n) => n.key === 'disable').level;
  assert.ok(after >= before, `disable ${before} -> ${after} dopo il pick suggerito`);
});

test('heroImageUrl: URL http(s) con l\'id/nome eroe', async (t) => {
  const eng = await ready(t); if (!eng) return;
  if (typeof eng.heroImageUrl !== 'function') return assert.fail('heroImageUrl non esportata');
  const u = eng.heroImageUrl(1);
  assert.match(u, /^https?:\/\//);
});
