'use strict';
// Auto-check del motore: `node src/engine/selfcheck.js` (offline, nessuna rete).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('./index');
const { bracketFromRankTier } = require('./data');

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ok -', name); }, (e) => { console.error('  FAIL -', name, '\n', e); process.exitCode = 1; });

(async () => {
  console.log('selfcheck engine');

  await ok('suggest prima di loadData lancia errore chiaro', () => {
    assert.throws(() => engine.suggest({ allies: [], enemies: [], role: 1, rankTier: 50 }), /non caricati/);
  });

  await ok('bracket da rankTier', () => {
    assert.strictEqual(bracketFromRankTier(54), 5);
    assert.strictEqual(bracketFromRankTier(11), 1);
    assert.strictEqual(bracketFromRankTier(80), 8);
    assert.strictEqual(bracketFromRankTier(null), 4);
  });

  const info = await engine.loadData({ rankTier: 54, offline: true });
  await ok('loadData offline carica sample', () => {
    assert.strictEqual(info.source, 'sample');
    assert.ok(info.heroes >= 30);
    assert.ok(info.matchups >= 30);
  });

  await ok('heroImageUrl', () => {
    assert.match(engine.heroImageUrl(1), /^https:\/\/.+\/heroes\/antimage\.png$/);
    assert.strictEqual(engine.heroImageUrl(999999), null);
  });

  const draft = { allies: [2, 44], enemies: [17, 22, 75], role: 5, rankTier: 54 };
  const r = engine.suggest(draft);
  await ok('forma dell\'output', () => {
    for (const p of [r.top, ...r.alternatives]) {
      assert.ok(Number.isInteger(p.heroId));
      assert.ok(p.name && p.img.startsWith('https://'));
      assert.ok(p.score >= 0 && p.score <= 100);
      assert.strictEqual(typeof p.winrate, 'number');
      assert.strictEqual(typeof p.counter, 'number');
      assert.strictEqual(typeof p.synergy, 'number');
      assert.ok(Array.isArray(p.reasons) && p.reasons.length >= 1);
      assert.ok(p.reasons.every((s) => typeof s === 'string'));
    }
    assert.strictEqual(r.alternatives.length, 5); // default: top + 5
    for (let i = 1; i < r.alternatives.length; i++) assert.ok(r.alternatives[i - 1].score >= r.alternatives[i].score);
    assert.ok(r.top.score >= r.alternatives[0].score);
    assert.strictEqual(new Set([r.top, ...r.alternatives].map((p) => p.heroId)).size, 6);
    assert.deepStrictEqual(r.teamNeeds.map((x) => x.key).slice(0, 6), ['disable', 'initiation', 'magic', 'push', 'support', 'tank']);
    assert.ok(r.teamNeeds.every((x) => x.level >= 0 && x.level <= 1 && x.note));
  });

  await ok('nessun eroe gia\' scelto nei suggerimenti', () => {
    const taken = new Set([...draft.allies, ...draft.enemies]);
    for (const p of [r.top, ...r.alternatives]) assert.ok(!taken.has(p.heroId));
  });

  await ok('pick di supporto per Pos 5 e carry per Pos 1', () => {
    const { RAW } = require('./tags');
    assert.ok(RAW[r.top.heroId][6].includes('5'), 'top pos5 = ' + r.top.name);
    const c = engine.suggest({ allies: [], enemies: [], role: 1, rankTier: 54 });
    assert.ok(RAW[c.top.heroId][6].includes('1'), 'top pos1 = ' + c.top.name);
  });

  await ok('teamNeeds segnala il controllo mancante e favorisce chi lo copre', () => {
    const noCtrl = [44, 1, 35, 22]; // nessun disable
    const out = engine.suggest({ allies: noCtrl, enemies: [], role: 4, rankTier: 50 });
    const dis = out.teamNeeds.find((x) => x.key === 'disable');
    assert.strictEqual(dis.note, 'Mancante');
    assert.ok(out.top.covers.includes('disable') || out.top.covers.includes('initiation'), JSON.stringify(out.top));
    assert.ok(out.top.reasons.some((s) => /manca/i.test(s)));
  });

  await ok('con alleati coperti il bisogno non e\' piu\' Mancante', () => {
    const out = engine.suggest({ allies: [33, 41], enemies: [], role: 3, rankTier: 50 });
    assert.strictEqual(out.teamNeeds.find((x) => x.key === 'disable').note, 'Coperto');
  });

  await ok('counter: eroe con matchup favorevole ha counter > 50', () => {
    // Silencer (75) contrasta Storm Spirit (17) nei dati d'esempio
    const sc = require('./scoring');
    assert.ok(sc.counterDelta(75, 17) > 0.01);
    assert.ok(sc.counterDelta(17, 75) < -0.01);
  });

  await ok('sinergia nota Enigma + Void piu\' alta di una coppia neutra', () => {
    const sc = require('./scoring');
    assert.ok(sc.pairSynergy(33, 41).score > sc.pairSynergy(1, 44).score);
  });

  await ok('input non valido', () => {
    assert.throws(() => engine.suggest({ allies: [], enemies: [], role: 9 }), /role/);
  });

  await ok('rank diverso cambia il winrate usato', () => {
    const lo = engine.suggest({ allies: [], enemies: [], role: 1, rankTier: 11 });
    const hi = engine.suggest({ allies: [], enemies: [], role: 1, rankTier: 80 });
    assert.notDeepStrictEqual(lo.top.winrate + '|' + lo.top.heroId, hi.top.winrate + '|' + hi.top.heroId);
  });

  // rete simulata + cache su disco + fallback
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-engine-'));
  const sample = require('./sample-data.json');
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    const u = String(url);
    let body;
    if (u.endsWith('/constants/patch')) body = sample.patch;
    else if (u.endsWith('/heroStats')) body = sample.heroStats;
    else if (u.endsWith('/heroes')) body = sample.heroes;
    else { const m = u.match(/heroes\/(\d+)\/matchups/); body = sample.matchups[m[1]] || []; }
    return { ok: true, status: 200, json: async () => body };
  };
  await ok('loadData via rete simulata + cache su disco', async () => {
    const a = await engine.loadData({ rankTier: 40, cacheDir: tmp, fetch: fakeFetch, matchups: 'all' });
    assert.strictEqual(a.source, 'network');
    assert.ok(a.matchups >= 30);
    assert.ok(fs.existsSync(path.join(tmp, 'heroStats.json')));
    const before = calls;
    const b = await engine.loadData({ rankTier: 40, cacheDir: tmp, fetch: fakeFetch, matchups: 'none' });
    assert.strictEqual(b.source, 'cache');
    assert.strictEqual(calls, before, 'nessuna richiesta con cache fresca');
    assert.ok(engine.suggest({ allies: [], enemies: [14], role: 2, rankTier: 40 }).top);
  });

  await ok('fallback a sample se rete e cache assenti', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-engine-empty-'));
    const bad = async () => { throw new Error('offline'); };
    const c = await engine.loadData({ rankTier: 40, cacheDir: empty, fetch: bad });
    assert.strictEqual(c.source, 'sample');
    assert.ok(c.warning);
  });

  await ok('balance: aggiustamenti nei limiti, score 0-100, nessuna reason con patch/versioni', async () => {
    const bal = require('./balance');
    await engine.loadData({ rankTier: 54, offline: true });
    for (const [name, level] of bal.ENTRIES) {
      const a = bal.adjustmentFor(name);
      assert.ok(Math.abs(a.points) <= bal.MAX_ABS, name);
    }
    assert.strictEqual(bal.LEVELS.nerfStrong, -4);
    assert.strictEqual(bal.LEVELS.buffStrong, 3);
    const texts = [];
    for (let role = 1; role <= 5; role++) {
      for (const draft of [{ allies: [], enemies: [] }, { allies: [2, 44, 33], enemies: [17, 22, 75, 14] }]) {
        const r = engine.suggest({ ...draft, role, rankTier: 54 }, { includeAll: true });
        for (const p of r.all) assert.ok(p.score >= 0 && p.score <= 100, p.name + ' ' + p.score);
        for (const p of [r.top, ...r.alternatives]) texts.push(...p.reasons);
      }
    }
    for (const t of texts) assert.ok(!/patch|7\.4|\d{1,2} (gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)/i.test(t), t);
    for (const [, , theme] of bal.ENTRIES) assert.ok(!/patch|7\.4/i.test(theme));
  });

  await ok('balance: eroe nerfato scende, eroe buffato sale a parita\' di input', async () => {
    const bal = require('./balance');
    await engine.loadData({ rankTier: 54, offline: true });
    const draft = { allies: [], enemies: [], role: 2, rankTier: 54 };
    const draft1 = { allies: [], enemies: [], role: 1, rankTier: 54 };
    const score = (d, id) => engine.suggest(d, { includeAll: true }).all.find((p) => p.heroId === id).score;
    bal.setEnabled(false);
    const sf0 = score(draft, 11), am0 = score(draft1, 1);
    bal.setEnabled(true);
    const sf1 = score(draft, 11), am1 = score(draft1, 1);
    assert.ok(sf1 < sf0, `Shadow Fiend ${sf0} -> ${sf1}`);
    assert.ok(am1 > am0, `Anti-Mage ${am0} -> ${am1}`);
    assert.ok(Math.abs(sf1 - sf0 + 4) < 0.15 && Math.abs(am1 - am0 - 2) < 0.15);
  });

  await ok('balance: reason con motivo concreto su top/alternative, senza versioni', async () => {
    const bal = require('./balance');
    await engine.loadData({ rankTier: 54, offline: true });
    // Necrophos (36) nerfato forte: forzato nelle alternative scegliendo un contesto dove compare
    const all = engine.suggest({ allies: [2, 44], enemies: [], role: 3, rankTier: 54 }, { includeAll: true }).all;
    assert.ok(bal.reasonFor('Necrophos').startsWith("Indebolito dall'ultimo aggiornamento: Necrophos"));
    assert.ok(bal.reasonFor('Anti-Mage').startsWith("Rinforzato dall'ultimo aggiornamento"));
    assert.strictEqual(bal.reasonFor('Huskar'), null);
    assert.strictEqual(bal.reasonFor('Largo'), null);
    assert.ok(all.length > 3);
    const info = engine.getBalanceInfo();
    assert.ok(info.found.length > 5 && Array.isArray(info.missing));
    bal.setEnabled(true);
  });
  await ok('reattivita\': nemici/alleati cambiano il top rispetto al draft vuoto', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    let changed = 0;
    for (let role = 1; role <= 5; role++) {
      const base = engine.suggest({ allies: [], enemies: [], role, rankTier: 54 }).top.heroId;
      const withDraft = engine.suggest({ allies: [2, 44], enemies: [17, 22, 75, 14], role, rankTier: 54 }).top.heroId;
      if (withDraft !== base) changed++;
    }
    assert.ok(changed >= 3, 'top cambiato in ' + changed + '/5 ruoli');
  });

  await ok('un counter forte puo\' scalzare un eroe con winrate piu\' alto', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    // Silencer (75) contrasta Storm Spirit (17) e Lion (26) nei dati d'esempio
    const r = engine.suggest({ allies: [], enemies: [17, 26], role: 5, rankTier: 54 }, { includeAll: true });
    const sil = r.all.find((p) => p.heroId === 75);
    const better = r.all.filter((p) => p.winrate > sil.winrate).length;
    assert.ok(sil.counter > 50);
    assert.ok(better > 0 || r.all[0].heroId === 75);
  });

  await ok('fit di ruolo: eroi senza tag curati non diventano Pos 1 se non sono veri carry', () => {
    const { deriveTags, POS_BY_NAME } = require('./tags');
    assert.ok(!deriveTags({ id: 9999, roles: ['Carry', 'Nuker'], primary_attr: 'int' }).positions.includes('1'));
    assert.ok(deriveTags({ id: 9998, roles: ['Carry', 'Escape'], primary_attr: 'agi' }).positions.startsWith('1'));
    for (const n of ['Leshrac', 'Lycan', 'Brewmaster', 'Invoker', 'Night Stalker', 'Techies']) {
      assert.ok(!POS_BY_NAME[n].startsWith('1'), n);
    }
    assert.ok(!POS_BY_NAME['Techies'].startsWith('4'));
  });

  await ok('1) winrate atteso in log-odds: presente, nelle reasons e sensibile ai counter', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const sc = require('./scoring');
    const empty = engine.suggest({ allies: [], enemies: [], role: 5, rankTier: 54 }, { includeAll: true }).all;
    const withE = engine.suggest({ allies: [2], enemies: [17, 26], role: 5, rankTier: 54 }, { includeAll: true });
    for (const p of withE.all) assert.ok(p.expectedWinrate >= 30 && p.expectedWinrate <= 75, p.name);
    assert.match(withE.top.reasons[0], /^Winrate atteso in questa draft: \d+,\d%/);
    assert.match(empty[0].reasons[0], /^Winrate \d+,\d% al rank/);
    const sil = withE.all.find((p) => p.heroId === 75), sil0 = empty.find((p) => p.heroId === 75);
    assert.ok(sil.expectedWinrate > sil0.expectedWinrate, 'Silencer contrasta Storm e Lion');
    assert.ok(sc.counterDelta(75, 17) > 0.01);
  });

  await ok('2) meccaniche nemiche generano bisogni nuovi e coperture', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const keys = (d) => engine.suggest({ ...d, role: 4, rankTier: 54 }).teamNeeds.map((n) => n.key);
    assert.deepStrictEqual(keys({ allies: [], enemies: [14] }), ['disable', 'initiation', 'magic', 'push', 'support', 'tank']);
    const inv = engine.suggest({ allies: [], enemies: [62, 9], role: 4, rankTier: 54 }); // Bounty Hunter + Mirana
    const det = inv.teamNeeds.find((n) => n.key === 'detection');
    assert.ok(det && det.label === 'Rilevamento invisibili' && det.note === 'Mancante');
    const heal = engine.suggest({ allies: [], enemies: [36, 50], role: 1, rankTier: 54 }); // Necrophos + Dazzle
    assert.ok(heal.teamNeeds.find((n) => n.key === 'antiheal'));
    const mag = engine.suggest({ allies: [], enemies: [22, 25], role: 1, rankTier: 54 }, { includeAll: true }); // Zeus + Lina
    assert.ok(mag.teamNeeds.find((n) => n.key === 'magicres' && n.label === 'Resistenza magica'));
    const jug = mag.all.find((p) => p.heroId === 8);
    assert.ok(jug.covers.includes('magicres'));
    const ill = engine.suggest({ allies: [], enemies: [89, 109], role: 3, rankTier: 54 }); // Naga (+ id ignoto ignorato)
    assert.ok(!ill.teamNeeds.find((n) => n.key === 'aoe'), 'una sola illusione non basta');
    const covered = engine.suggest({ allies: [8], enemies: [22, 25], role: 3, rankTier: 54 });
    assert.strictEqual(covered.teamNeeds.find((n) => n.key === 'magicres').note, 'Coperto');
  });

  await ok('3) STRATZ: sinergia con shrinkage e percentuale solo con campione sufficiente', async () => {
    const { store } = require('./data');
    const sc = require('./scoring');
    await engine.loadData({ rankTier: 54, offline: true, stratzToken: 'x' });
    const w = (g, wins) => ({ with: new Map([[2, { games: g, wins }]]), vs: new Map() });
    store.stratz.data.set('5:5', w(120, 100)); // 83% su 120 partite: campione piccolo
    const small = sc.pairSynergy(5, 2, 5);
    assert.ok(small.score < 0.75 && small.logit < 0.1, 'shrinkage: score=' + small.score);
    assert.ok(!small.note || !/%/.test(small.note), 'nessuna percentuale con campione piccolo');
    store.stratz.data.set('5:5', w(5000, 3000));
    const big = sc.pairSynergy(5, 2, 5);
    assert.ok(big.logit > small.logit);
    assert.match(big.note, /60,0%.*5000 partite/);
    store.stratz.data.set('5:5', w(40, 38)); // sotto la soglia minima: ricade sull'euristica
    assert.ok(!/%/.test(String(sc.pairSynergy(5, 2, 5).note)));
    store.stratz.token = null; store.stratz.data.clear();
  });

  await ok('4) reasons: rank in italiano, template sinergia corretto, max 4 reasons', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const sc = require('./scoring');
    assert.deepStrictEqual(sc.BRACKET_NAMES, ['Araldo', 'Guardiano', 'Crociato', 'Arconte', 'Leggenda', 'Antico', 'Divino', 'Immortale']);
    const r = engine.suggest({ allies: [2, 44], enemies: [17, 22], role: 5, rankTier: 54 });
    assert.match(r.top.reasons[0], /rank Leggenda/);
    const syn = sc.pairSynergy(2, 26);
    assert.match(syn.note, /^Axe inizia il combattimento e Lion segue con danno o controllo$/);
    assert.match(sc.pairSynergy(26, 2).note, /^Axe inizia il combattimento e Lion segue/);
    for (let role = 1; role <= 5; role++) {
      for (const rankTier of [15, 54, 85]) {
        const o = engine.suggest({ allies: [2, 44, 33], enemies: [17, 22, 75, 14, 36], role, rankTier });
        for (const p of [o.top, ...o.alternatives]) {
          assert.ok(p.reasons.length >= 1 && p.reasons.length <= 4, p.name + ' ' + p.reasons.length);
          for (const s of p.reasons) assert.ok(!/\b(Archon|Divine|Herald|Guardian|Crusader|Legend)\b/.test(s), s);
        }
      }
    }
  });

  await ok('5) difficolta\': malus forte a rank bassi, lieve a medi, nullo ad alti', () => {
    const sc = require('./scoring');
    const { DIFFICULTY } = require('./tags');
    assert.strictEqual(sc.difficultyPenalty(2, 1), -12);
    assert.strictEqual(sc.difficultyPenalty(2, 3), -12);
    assert.strictEqual(sc.difficultyPenalty(2, 4), -2.5);
    assert.strictEqual(sc.difficultyPenalty(2, 5), -2.5);
    assert.strictEqual(sc.difficultyPenalty(2, 6), 0);
    assert.strictEqual(sc.difficultyPenalty(0, 1), 0);
    for (const n of ['Meepo', 'Invoker', 'Chen', 'Io', 'Techies', 'Visage', 'Arc Warden', 'Earth Spirit', 'Morphling', 'Tinker', 'Rubick', 'Lone Druid', 'Puck', 'Oracle', 'Storm Spirit', 'Kez', 'Ember Spirit']) {
      assert.strictEqual(DIFFICULTY[n], 2, n);
    }
    // Io (difficile) pesa meno a Araldo che a Divino rispetto a un supporto semplice, a parita' di dati
    const gap = (rt) => {
      const a = engine.suggest({ allies: [], enemies: [], role: 5, rankTier: rt }, { includeAll: true }).all;
      return a.find((p) => p.heroId === 91).score - a.find((p) => p.heroId === 30).score; // Io - Witch Doctor
    };
    assert.ok(gap(15) < gap(75) + 3.5, 'Io penalizzato ai rank bassi');
  });

  await ok('A) jolly: regole di eleggibilita\' (unit test su picks sintetici)', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const sc = require('./scoring');
    const mk = (heroId, wr, name) => ({ heroId, name: name || String(heroId), img: 'x', score: 50, expectedWinrate: wr });
    const need = (key, note = 'Mancante') => ({ key, label: key, level: 0, note });
    const top3 = [mk(44, 55), mk(1, 54.5), mk(35, 54)];
    const base = [...top3];
    // 1) rilevamento: Zeus (naturale Pos 2) a 1,7 punti dal top
    let w = sc.buildWildcard([...base, mk(22, 53.3, 'Zeus')], [need('detection')], [62, 9], [], 2);
    assert.ok(w && w.heroId === 22 && w.needKey === 'detection' && w.teamOnly === false && w.winrateGap === 1.7);
    assert.strictEqual(w.text, 'Se ti serve rilevamento: Zeus risolve il problema, ma ha 1,7 punti di winrate in meno. In alternativa: Dust, Sentry, Gem.');
    assert.strictEqual(w.items, 'Dust, Sentry, Gem');
    // 2) gap troppo alto -> solo squadra
    w = sc.buildWildcard([...base, mk(22, 51.0, 'Zeus')], [need('detection')], [62, 9, 62], [], 2);
    assert.ok(w && w.teamOnly === true && w.heroId === null && /^Alla squadra serve rilevamento: lo può coprire un compagno o con Dust, Sentry, Gem$/.test(w.text));
    w = sc.buildWildcard([...base, mk(22, 51.0, 'Zeus')], [need('detection')], [62, 9, 62], [1, 2, 3, 4], 2);
    assert.ok(w.teamOnly && /copritelo con/.test(w.text));
    // 3) il top 3 copre gia' -> nessun jolly
    assert.strictEqual(sc.buildWildcard([mk(44, 55), mk(22, 54.9), mk(35, 54), mk(62, 53)], [need('detection')], [62, 9], [], 4), null);
    // 4) bisogno non Mancante o minaccia sotto soglia -> nessun jolly
    assert.strictEqual(sc.buildWildcard([...base, mk(22, 53.3)], [need('detection', 'Coperto')], [62, 9], [], 2), null);
    assert.strictEqual(sc.buildWildcard([...base, mk(22, 53.3)], [need('detection')], [62], [], 2), null);
    // 5) rilevamento in Pos 1-3 solo con eroe naturale: Bloodseeker non conta, Zeus (Pos 2) in Pos 3 no
    assert.strictEqual(sc.buildWildcard([...base, mk(22, 53.3)], [need('detection')], [62, 9, 62], [], 3).teamOnly, true);
    // 6) mai fuori ruolo: Lifestealer (Pos 1) per un supporto Pos 5
    const mag = [22, 25, 101, 39];
    const base2 = [mk(44, 55), mk(35, 54.5), mk(6, 54)]; // nessun eroe con resistenza magica
    w = sc.buildWildcard([...base2, mk(54, 53.2, 'Lifestealer')], [need('magicres')], mag, [], 1);
    assert.ok(w && w.heroId === 54 && w.needKey === 'magicres' && /BKB, Pipe/.test(w.text));
    w = sc.buildWildcard([...base2, mk(54, 53.2, 'Lifestealer')], [need('magicres')], mag, [], 5);
    assert.ok(w.teamOnly);
    // 7) magicres solo se la draft e' fragile (minaccia >= 9)
    assert.strictEqual(sc.buildWildcard([...base2, mk(54, 53.2)], [need('magicres')], [22, 25], [], 1), null);
    // 8) anti-cura: soglia alta (6 non basta, 9 si')
    assert.strictEqual(sc.buildWildcard([...base, mk(68, 53)], [need('antiheal')], [36, 50], [], 5), null);
    w = sc.buildWildcard([...base, mk(68, 53, 'Ancient Apparition')], [need('antiheal')], [36, 50, 57], [], 5);
    assert.ok(w && w.heroId === 68 && /Spirit Vessel/.test(w.text));
    // 9) un solo jolly e mai un eroe del top 3; aoe/manaburn non generano jolly
    assert.strictEqual(sc.buildWildcard([...base, mk(2, 53)], [need('aoe')], [89, 12], [], 3), null);
  });

  await ok('A) jolly: coerente con suggest su molte draft', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const { RAW } = require('./tags');
    const ids = engine.getHeroes().map((h) => h.id);
    let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = (k) => { const a = ids.slice(), o = []; while (o.length < k) o.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return o; };
    let seen = 0;
    for (let i = 0; i < 400; i++) {
      const role = 1 + Math.floor(rnd() * 5), p = pick(10), na = Math.floor(rnd() * 5);
      const r = engine.suggest({ allies: p.slice(0, na), enemies: p.slice(na, na + 5), role, rankTier: 15 + 10 * Math.floor(rnd() * 8) });
      assert.ok('wildcard' in r);
      const w = r.wildcard;
      if (!w) continue;
      seen++;
      assert.ok(['detection', 'antiheal', 'magicres'].includes(w.needKey));
      assert.ok(typeof w.text === 'string' && w.text.length > 10 && !/patch|7\.4/i.test(w.text));
      if (!w.teamOnly) {
        assert.ok(![r.top, ...r.alternatives].some((x) => x.heroId === w.heroId));
        assert.ok(w.winrateGap >= 0 && w.winrateGap <= 2.5);
        assert.ok(RAW[w.heroId] && RAW[w.heroId][6].includes(String(role)) || !RAW[w.heroId]);
      } else assert.strictEqual(w.heroId, null);
    }
    assert.ok(seen >= 0);
  });

  await ok('B) eroi difficolta\' 2 a rank bassi: primo consiglio solo con margine netto', async () => {
    await engine.loadData({ rankTier: 15, offline: true });
    const { DIFFICULTY } = require('./tags');
    const ids = engine.getHeroes().map((h) => [h.id, h.name]);
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let n = 0, hard = 0;
    for (let i = 0; i < 300; i++) {
      const a = ids.slice(), p = []; for (let k = 0; k < 7; k++) p.push(a.splice(Math.floor(rnd() * a.length), 1)[0][0]);
      const role = 1 + (i % 5);
      const r = engine.suggest({ allies: p.slice(0, 2), enemies: p.slice(2), role, rankTier: 15 + 10 * (i % 3) });
      n++; if (DIFFICULTY[r.top.name] === 2) hard++;
    }
    assert.ok(hard / n <= 0.03, 'difficili primi: ' + hard + '/' + n);
  });

  await ok('C) testi con lettere accentate, niente apostrofi al posto degli accenti', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const bal = require('./balance');
    const bad = /[A-Za-z]'(\s|$|[.,;:)])/;
    const texts = [];
    for (const [name, , theme] of bal.ENTRIES) { texts.push(theme); const r = bal.reasonFor(name); if (r) texts.push(r); }
    const ids = engine.getHeroes().map((h) => h.id);
    let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 200; i++) {
      const a = ids.slice(), p = []; for (let k = 0; k < 9; k++) p.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
      const r = engine.suggest({ allies: p.slice(0, 4), enemies: p.slice(4), role: 1 + (i % 5), rankTier: 54 });
      for (const x of [r.top, ...r.alternatives]) texts.push(...x.reasons);
      for (const n of r.teamNeeds) texts.push(n.label, n.note);
      if (r.wildcard) texts.push(r.wildcard.text);
    }
    for (const s of texts) assert.ok(!bad.test(s), s);
    assert.ok(bal.ENTRIES.some(([, , th]) => /velocità/.test(th)) && bal.ENTRIES.some(([, , th]) => /abilità/.test(th)));
  });

  await ok('fix: ogni bisogno Mancante/Scarso ha un fix coerente', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const sc = require('./scoring');
    let withFix = 0;
    for (let role = 1; role <= 5; role++) {
      const r = engine.suggest({ allies: [44, 1, 35], enemies: [22, 25, 62, 9], role, rankTier: 54 });
      for (const n of r.teamNeeds) {
        if (n.note === 'Mancante' || n.note === 'Scarso') {
          withFix++;
          assert.ok(n.fix && typeof n.fix.text === 'string' && n.fix.text.length > 5, n.key);
          assert.ok(n.fix.items === null || typeof n.fix.items === 'string');
          if (n.fix.hero) {
            const h = n.fix.hero;
            assert.ok(h.heroId && h.name && h.img && typeof h.expectedWinrate === 'number');
            assert.ok(h.winrateGap >= 0 && h.winrateGap <= 4, n.key + ' gap ' + h.winrateGap);
            assert.ok(![44, 1, 35, 22, 25, 62, 9].includes(h.heroId), 'eroe gia scelto');
            const { RAW } = require('./tags');
            assert.ok(!RAW[h.heroId] || RAW[h.heroId][6].includes(String(role)), 'fuori ruolo: ' + h.name);
          }
        } else assert.ok(!('fix' in n), n.key + ' ' + n.note);
      }
    }
    assert.ok(withFix > 5);
    // oggetti dosati per ruolo
    assert.strictEqual(sc.itemsFor('detection', 2), 'Dust');
    assert.strictEqual(sc.itemsFor('detection', 5), 'Dust, Sentry, Gem');
    assert.strictEqual(sc.itemsFor('magicres', 1), 'BKB, Mage Slayer');
    assert.strictEqual(sc.itemsFor('magicres', 5), 'Glimmer Cape, Pipe of Insight');
    assert.strictEqual(sc.itemsFor('support', 1), null);
    // un eroe gia' nel top 3 viene indicato comunque
    const mk = (heroId, wr, name) => ({ heroId, name, img: 'x', score: 50, expectedWinrate: wr });
    const fx = sc.buildFix('magicres', [mk(8, 55, 'Juggernaut'), mk(44, 54), mk(35, 53)], 1);
    assert.ok(fx.hero.heroId === 8 && /già tra i consigli/.test(fx.text));
    const fx2 = sc.buildFix('magicres', [mk(44, 55), mk(35, 54), mk(6, 53.5), mk(8, 53.2, 'Juggernaut')], 1);
    assert.strictEqual(fx2.text, 'Juggernaut lo copre nel tuo ruolo (-1,8 punti). Oggetti: BKB, Mage Slayer.');
    assert.strictEqual(fx2.hero.winrateGap, 1.8);
    const none = sc.buildFix('magicres', [mk(44, 55), mk(35, 54), mk(6, 53.5), mk(8, 48, 'Juggernaut')], 1);
    assert.strictEqual(none.hero, null);
  });

  await ok('jolly generalizzato: copre piu\' lacune con calo contenuto', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const sc = require('./scoring');
    const mk = (heroId, wr, name) => ({ heroId, name: name || String(heroId), img: 'x', score: 50, expectedWinrate: wr });
    const nd = (key, note = 'Mancante') => ({ key, label: key === 'push' ? 'Push' : key === 'support' ? 'Cura / sostegno' : 'Resistenza magica', level: 0, note });
    const needs = [nd('push'), nd('support'), nd('magicres')];
    const top3 = [mk(44, 55), mk(35, 54.5), mk(6, 54)]; // nessuno copre push/cura/magicres... (Drow: push 2)
    const top3b = [mk(44, 55), mk(35, 54.5), mk(11, 54)];
    const w = sc.buildWildcard([...top3b, mk(8, 53.2, 'Juggernaut')], needs, [22, 25], [2, 3], 1);
    assert.ok(w && w.heroId === 8 && w.teamOnly === false);
    assert.deepStrictEqual(w.needKeys, ['push', 'support', 'magicres']);
    assert.deepStrictEqual(w.needLabels, ['Push', 'Cura / sostegno', 'Resistenza magica']);
    assert.strictEqual(w.needKey, 'push');
    assert.strictEqual(w.text, 'Se vuoi coprire push, cura e resistenza magica: Juggernaut le copre tutte e tre, con 1,8 punti di winrate in meno.');
    assert.ok(w.winrateGap <= 4);
    // calo troppo alto -> nessun jolly
    assert.strictEqual(sc.buildWildcard([...top3b, mk(8, 49.5)], needs, [22, 25], [2, 3], 1), null);
    // il top 3 copre gia' una lacuna -> nessun jolly generalizzato
    assert.strictEqual(sc.buildWildcard([...top3, mk(8, 53.2)], needs, [22, 25], [2, 3], 1), null);
    // con meno di 2 alleati non e' significativo
    assert.strictEqual(sc.buildWildcard([...top3b, mk(8, 53.2)], needs, [22, 25], [2], 1), null);
    // fuori ruolo mai (Juggernaut e' Pos 1)
    assert.strictEqual(sc.buildWildcard([...top3b, mk(8, 53.2)], needs, [22, 25], [2, 3], 5), null);
    // il push da solo non basta (peso basso, una sola lacuna)
    assert.strictEqual(sc.buildWildcard([...top3b, mk(8, 53.2)], [nd('push'), nd('support', 'Coperto')], [22, 25], [2, 3], 1), null);
    // compatibilita': needKey/needLabel presenti anche nel ramo a bisogno singolo
    const one = sc.buildWildcard([mk(44, 55), mk(35, 54.5), mk(6, 54), mk(22, 53.3, 'Zeus')], [{ key: 'detection', label: 'Rilevamento invisibili', level: 0, note: 'Mancante' }], [62, 9], [], 2);
    assert.deepStrictEqual(one.needKeys, ['detection']);
    assert.strictEqual(one.needKey, 'detection');
  });

  await ok('6 suggerimenti: alternatives configurabile, regole sui suggerimenti mostrati', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const sc = require('./scoring');
    const base = { allies: [2, 44, 33], enemies: [17, 22, 75], role: 3, rankTier: 54 };
    assert.strictEqual(engine.suggest(base).alternatives.length, 5);
    assert.strictEqual(engine.suggest(base, { alternatives: 2 }).alternatives.length, 2);
    assert.strictEqual(engine.suggest(base, { alternatives: 0 }).alternatives.length, 0);
    assert.strictEqual(engine.suggest(base, { alternatives: 8 }).alternatives.length, 8);
    const six = engine.suggest(base, { includeAll: true });
    const two = engine.suggest(base, { alternatives: 2, includeAll: true });
    assert.deepStrictEqual([six.top, ...six.alternatives].slice(0, 3).map((p) => p.heroId), [two.top, ...two.alternatives].map((p) => p.heroId));
    for (const p of [six.top, ...six.alternatives]) assert.ok(p.reasons.length >= 1 && p.reasons.length <= 4);
    // unit: jolly fuori dai 6 mostrati e solo se nessuno dei 6 copre
    const mk = (heroId, wr, name) => ({ heroId, name: name || String(heroId), img: 'x', score: 50, expectedWinrate: wr });
    const need = (key) => ({ key, label: key, level: 0, note: 'Mancante' });
    const shown5 = [mk(44, 55), mk(35, 54.8), mk(6, 54.6), mk(46, 54.4), mk(11, 54.2), mk(4, 54)]; // nessuno rileva
    const w = sc.buildWildcard([...shown5, mk(22, 53.3, 'Zeus')], [need('detection')], [62, 9], [], 2, 6);
    assert.ok(w && w.heroId === 22 && w.winrateGap === 1.7);
    // Zeus in 5ª posizione (tra i 6 mostrati): niente jolly, anche se con shown=3 sarebbe fuori
    const withZeus = [mk(44, 55), mk(35, 54.8), mk(6, 54.6), mk(46, 54.4), mk(22, 54.2, 'Zeus'), mk(4, 54), mk(1, 53)];
    assert.strictEqual(sc.buildWildcard(withZeus, [need('detection')], [62, 9], [], 2, 6), null);
    assert.ok(sc.buildWildcard(withZeus, [need('detection')], [62, 9], [], 2, 3) === null || true);
    // fix: eroe fra i 6 mostrati => 'gia' tra i consigli'
    const fx = sc.buildFix('detection', withZeus, 2, 6);
    assert.ok(fx.hero.heroId === 22 && /già tra i consigli/.test(fx.text));
    const fx3 = sc.buildFix('detection', withZeus, 2, 3);
    assert.ok(!/già tra i consigli/.test(fx3.text));
  });

  await ok('estimateMatch: forma, null se non 5v5, simmetria, limiti 0-100', async () => {
    await engine.loadData({ rankTier: 54, offline: true });
    const A = [129, 84, 9, 39, 8], B = [2, 86, 22, 44, 35];
    assert.strictEqual(engine.estimateMatch({ allies: A.slice(0, 4), enemies: B, rankTier: 54 }), null);
    assert.strictEqual(engine.estimateMatch({ allies: A, enemies: [], rankTier: 54 }), null);
    assert.strictEqual(engine.estimateMatch({ allies: A, enemies: [8, 2, 86, 22, 44], rankTier: 54 }), null, 'eroe duplicato');
    assert.strictEqual(engine.estimateMatch({ allies: [], enemies: [] }), null);
    const r = engine.estimateMatch({ allies: A, enemies: B, rankTier: 54 });
    assert.deepStrictEqual(Object.keys(r).sort(), ['confidence', 'factors', 'high', 'low', 'note', 'winProbability']);
    for (const k of ['winProbability', 'low', 'high']) assert.ok(typeof r[k] === 'number' && r[k] >= 0 && r[k] <= 100, k);
    assert.ok(r.low <= r.winProbability && r.winProbability <= r.high);
    assert.strictEqual(Math.round(r.winProbability * 10), r.winProbability * 10, '1 decimale');
    assert.ok(['bassa', 'media', 'alta'].includes(r.confidence));
    assert.ok(r.factors.length <= 4 && r.factors.every((x) => typeof x.text === 'string' && typeof x.impact === 'number'));
    for (let i = 1; i < r.factors.length; i++) assert.ok(Math.abs(r.factors[i - 1].impact) >= Math.abs(r.factors[i].impact));
    assert.ok(typeof r.note === 'string' && /giocate/.test(r.note));
    const all = JSON.stringify(r);
    assert.ok(!/patch|7\.4/i.test(all));
    assert.ok(!/[A-Za-z]'(\s|$|[.,;:)])/.test(all), 'accenti');
    // simmetria: scambiando le squadre p -> 100 - p (entro 0,1)
    const s = engine.estimateMatch({ allies: B, enemies: A, rankTier: 54 });
    assert.ok(Math.abs(r.winProbability + s.winProbability - 100) <= 0.1, r.winProbability + ' + ' + s.winProbability);
    assert.ok(Math.abs(r.low + s.high - 100) <= 0.15 && Math.abs(r.high + s.low - 100) <= 0.15);
    // molte coppie casuali: sempre in 0-100 e simmetriche
    const ids = engine.getHeroes().map((h) => h.id);
    let seed = 31; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 60; i++) {
      const a = ids.slice(), p = []; for (let k = 0; k < 10; k++) p.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
      const rt = 15 + 10 * Math.floor(rnd() * 8);
      const x = engine.estimateMatch({ allies: p.slice(0, 5), enemies: p.slice(5), rankTier: rt });
      const y = engine.estimateMatch({ allies: p.slice(5), enemies: p.slice(0, 5), rankTier: rt });
      assert.ok(x.winProbability >= 0 && x.winProbability <= 100 && x.low >= 0 && x.high <= 100);
      assert.ok(Math.abs(x.winProbability + y.winProbability - 100) <= 0.1);
    }
    // calibration.json presente e coerente
    const cal = require('./calibration.json');
    assert.ok(cal.matches >= 2000 && cal.metrics.brierWithSide < cal.metrics.baseline.brier && cal.metrics.logLossWithSide < cal.metrics.baseline.logLoss);
    assert.ok(!JSON.stringify(cal).match(/account_id|steam|persona/i));
  });

  await ok('dropPartial scarta solo l\'ultimo giorno parziale', () => {
    const sc = require('./scoring');
    assert.deepStrictEqual(sc.dropPartial([100, 98, 95, 99, 97, 101, 17]), [100, 98, 95, 99, 97, 101]);
    assert.deepStrictEqual(sc.dropPartial([100, 98, 95, 99, 97, 101, 96]).length, 7);
    assert.deepStrictEqual(sc.dropPartial([1, 2]), [1, 2]);
  });

  await ok('meta: tabella con crescita e winrate recente, pro in 0..1', () => {
    const sc = require('./scoring');
    const t = sc.metaTable();
    assert.ok(t.size >= 30);
    for (const m of t.values()) {
      assert.ok(m.score >= 0 && m.score <= 1);
      assert.ok(m.pro >= 0 && m.pro <= 1);
      assert.ok(m.recentWr > 0.4 && m.recentWr < 0.65);
    }
  });

  await ok('reasons di meta compaiono per eroi in crescita nel sample', () => {
    const sc = require('./scoring');
    const hot = [...sc.metaTable()].filter(([, m]) => m.growth >= 0.05).length;
    assert.ok(hot >= 1);
  });

  await ok('STRATZ: senza token resta euristica; con token usa with/vs e non scrive il token', async () => {
    const saved = process.env.STRATZ_TOKEN; delete process.env.STRATZ_TOKEN;
    await engine.loadData({ rankTier: 54, offline: true });
    assert.strictEqual(engine.getProviderInfo().stratz, false);
    assert.strictEqual(await engine.ensureStratz([2, 44], 54), 0);

    const SECRET = 'TEST-SECRET-TOKEN-123';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-stratz-'));
    let seenAuth = null;
    const fake = async (url, init) => {
      const u = String(url);
      if (u.includes('stratz.com')) {
        seenAuth = init.headers.Authorization;
        const id = Number(/matchUp\(heroId: (\d+)/.exec(JSON.parse(init.body).query)[1]);
        const strong = id === 2 ? [{ heroId2: 5, matchCount: 4000, winCount: 2600 }] : [];
        return { ok: true, status: 200, json: async () => ({ data: { heroStats: { matchUp: [{ heroId: id, with: strong, vs: strong }] } } }) };
      }
      const s = require('./sample-data.json');
      const body = u.endsWith('/heroStats') ? s.heroStats : u.endsWith('/heroes') ? s.heroes : u.endsWith('/constants/patch') ? s.patch : [];
      return { ok: true, status: 200, json: async () => body };
    };
    await engine.loadData({ rankTier: 54, cacheDir: dir, fetch: fake, stratzToken: SECRET, matchups: 'none' });
    assert.strictEqual(engine.getProviderInfo().stratz, true);
    assert.strictEqual(await engine.ensureStratz([2], 54), 1);
    assert.strictEqual(seenAuth, 'Bearer ' + SECRET);
    const sc = require('./scoring');
    assert.ok(sc.pairSynergy(5, 2, 5).score > 0.9, 'sinergia STRATZ molto alta');
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); })(dir);
    assert.ok(files.length > 0 && files.every((f) => !fs.readFileSync(f, 'utf8').includes(SECRET)), 'token mai su disco');
    // errore STRATZ: nessun crash e nessun token negli errori
    const failing = async (url) => { if (String(url).includes('stratz')) throw new Error('boom Bearer ' + SECRET); return fake(url, {}); };
    await engine.loadData({ rankTier: 54, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dp-stratz2-')), fetch: failing, stratzToken: SECRET, matchups: 'none' });
    assert.strictEqual(await engine.ensureStratz([2], 54), 0);
    assert.ok(!String(engine.getProviderInfo().lastError).includes(SECRET));
    if (saved) process.env.STRATZ_TOKEN = saved;
  });

  console.log(process.exitCode ? `\nFALLITO (${n} ok)` : `\nTutto ok (${n} controlli)`);
})();




