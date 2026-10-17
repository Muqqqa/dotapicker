'use strict';
// CONTRACT-v2: suggest({..., excluded}) non propone MAI un eroe escluso (bannato / non disponibile / incerto).
const test = require('node:test');
const assert = require('node:assert/strict');
const { getEngine } = require('./helpers');

const ALLIES = [2, 26];
const ENEMIES = [1, 8, 74];

let ctx;
async function ready(t) {
  if (!ctx) ctx = await getEngine();
  if (ctx.skip) { t.skip(ctx.skip); return null; }
  return ctx.eng;
}
const run = (eng, over) => eng.suggest(Object.assign({ allies: ALLIES, enemies: ENEMIES, role: 1, rankTier: 55 }, over));

// Tutti gli heroId presenti in qualunque punto dell'output (top, alternatives, candidates, wildcard, teamNeeds.fix...).
function allHeroIds(obj, out = new Set()) {
  if (Array.isArray(obj)) { obj.forEach((x) => allHeroIds(x, out)); return out; }
  if (obj && typeof obj === 'object') {
    for (const k of ['heroId', 'hero', 'id']) if (typeof obj[k] === 'number') out.add(obj[k]);
    for (const v of Object.values(obj)) allHeroIds(v, out);
  }
  return out;
}
const picks = (r) => [r.top, ...(r.alternatives || [])].filter(Boolean);

test('excluded: un eroe escluso non compare mai nell\'output (nessun ruolo)', async (t) => {
  const eng = await ready(t); if (!eng) return;
  for (const role of [1, 2, 3, 4, 5]) {
    const base = run(eng, { role });
    const ex = picks(base).map((p) => p.heroId); // escludo proprio i 6 consigliati
    const r = run(eng, { role, excluded: ex });
    const seen = allHeroIds(r);
    for (const id of ex) assert.ok(!seen.has(id), `ruolo ${role}: eroe escluso ${id} presente nell'output`);
    assert.ok(r.top, `ruolo ${role}: nessun top dopo 6 esclusioni`);
  }
});

test('excluded: escludere ripetutamente il top non lo ripropone mai (10 giri, ogni ruolo)', async (t) => {
  const eng = await ready(t); if (!eng) return;
  for (const role of [1, 2, 3, 4, 5]) {
    const excluded = [];
    for (let i = 0; i < 10; i++) {
      const r = run(eng, { role, excluded: excluded.slice() });
      if (!r.top) break; // pool esaurito: accettabile
      for (const p of picks(r)) assert.ok(!excluded.includes(p.heroId), `ruolo ${role}, giro ${i}: riproposto escluso ${p.heroId}`);
      excluded.push(r.top.heroId);
    }
    assert.equal(new Set(excluded).size, excluded.length, 'top ripetuto tra i giri: ' + excluded);
  }
});

test('excluded: anche con opts.count / includeAll gli esclusi non compaiono', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const ex = picks(run(eng)).map((p) => p.heroId);
  const r = eng.suggest({ allies: ALLIES, enemies: ENEMIES, role: 1, rankTier: 55, excluded: ex }, { count: 30, includeAll: true });
  const seen = allHeroIds(r);
  for (const id of ex) assert.ok(!seen.has(id), 'escluso presente con count/includeAll: ' + id);
});

test('excluded: accetta stringhe e oggetti {heroId}', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const top = run(eng).top.heroId;
  for (const form of [[String(top)], [{ heroId: top }]]) {
    const r = run(eng, { excluded: form });
    assert.ok(!allHeroIds(r).has(top), 'escluso (forma ' + JSON.stringify(form) + ') ancora presente');
  }
});

test('excluded vuoto o assente: output identico a prima', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const a = JSON.stringify(run(eng));
  assert.equal(JSON.stringify(run(eng, { excluded: [] })), a);
  assert.equal(JSON.stringify(run(eng, { excluded: undefined })), a);
});

test('excluded: tutti esclusi -> nessun crash, top null e messaggio', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const all = (eng.getHeroes ? eng.getHeroes() : []).map((h) => h.id);
  if (!all.length) return t.skip('getHeroes non disponibile');
  const r = run(eng, { excluded: all });
  assert.equal(r.top, null);
  assert.deepEqual(r.alternatives, []);
  assert.match(String(r.message || ''), /Nessun eroe disponibile/);
});

test('excluded: resta un solo eroe -> e\' il top, nessuna alternativa', async (t) => {
  const eng = await ready(t); if (!eng) return;
  const all = (eng.getHeroes ? eng.getHeroes() : []).map((h) => h.id);
  if (!all.length) return t.skip('getHeroes non disponibile');
  const keep = run(eng).top.heroId;
  const r = run(eng, { excluded: all.filter((id) => id !== keep) });
  assert.equal(r.top && r.top.heroId, keep);
  assert.equal(r.alternatives.length, 0);
});
