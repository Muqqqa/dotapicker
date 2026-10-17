// Audit tattico su larga scala: draft casuali (anche con minacce di meccanica forzate) per ogni rank e ruolo,
// controllate con regole tattiche. Uso: node tests/audit.js [draft-per-rank-ruolo] [--stratz]
// Non fa parte di `npm test`: usa la rete (OpenDota, e STRATZ con --stratz e STRATZ_TOKEN).
const e = require('../src/engine');
const t = require('../src/engine/tags');
const scoring = require('../src/engine/scoring');
const N = Number(process.argv[2]) || 2500;
const USE_STRATZ = process.argv.includes('--stratz');
const RANKS = [15, 25, 35, 45, 55, 65, 75, 85];
const ROLES = [1, 2, 3, 4, 5];
const EN_RANK = /\b(?:rank|al rank) (?:Herald|Guardian|Crusader|Archon|Legend|Ancient|Divine|Immortal)\b/;

let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const sample = (arr, k) => { const a = arr.slice(); const out = []; while (out.length < k && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };

const RULES = {
  R1: 'Il 1Â° consiglio ha winrate atteso molto sotto (oltre 3 punti) il migliore eroe naturale del ruolo',
  R2: 'Il 1Â° consiglio ha counter fortemente negativo (<40) con 3+ nemici',
  R3: 'Minaccia nemica non coperta dai 6 suggerimenti pur esistendo un\'opzione valida del ruolo che la copre',
  R4: 'Eroe complesso come 1Â° consiglio ad Araldo-Crociato',
  R5: 'Sinergia estrema (<10 o >90)',
  R6: 'Reasons non conformi (oltre 4, rank in inglese, testo sospetto)',
  R7: 'Il 1Â° consiglio non gioca nel ruolo richiesto (ne\' primario ne\' secondario)',
  R8: 'Jolly non valido (fuori ruolo, gia tra i suggerimenti o scelto, calo di winrate oltre 2,5, testo sospetto)',
  R0: 'Invarianti di base (forma, duplicati, eroe gia\' scelto, score fuori 0-100, eccezioni)'
};
const stats = {}; for (const k of Object.keys(RULES)) stats[k] = { checked: 0, bad: 0, ex: [] };
const hit = (k, ok, ex) => { const s = stats[k]; s.checked++; if (!ok) { s.bad++; if (s.ex.length < 3) s.ex.push(ex); } };
const tops = new Map(); let calls = 0, mechDrafts = 0;
const wild = { n: 0, team: 0, byKey: {} };

// Dettaglio R3: per meccanica, ruolo e rank; quanto dista la miglior opzione coprente dai suggerimenti.
const r3 = { byKey: {}, byRole: {}, byRank: {}, gapsWr: [], gapsScore: [], posInList: [], pairs: new Map() };
const inc = (o, k, ok) => { o[k] = o[k] || { n: 0, bad: 0 }; o[k].n++; if (!ok) o[k].bad++; };
function r3Detail(need, input, s, viable, ok) {
  inc(r3.byKey, need.key, ok); inc(r3.byRole, 'Pos ' + input.role, ok); inc(r3.byRank, input.rankTier, ok);
  if (ok) return;
  const best = viable.slice().sort((a, b) => b.score - a.score)[0];
  r3.gapsWr.push(s.top.expectedWinrate - best.expectedWinrate);
  r3.gapsScore.push(s.alternatives[s.alternatives.length - 1].score - best.score);
  r3.posInList.push(s.all.findIndex((c) => c.heroId === best.heroId) + 1);
  const k = `${need.key} Pos ${input.role}: ${s.top.name} invece di ${best.name}`;
  r3.pairs.set(k, (r3.pairs.get(k) || 0) + 1);
}
function printR3() {
  const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${(100 * v.bad / v.n).toFixed(1)}% (${v.bad}/${v.n})`).join(' | ');
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)].toFixed(1) : '-'; };
  console.log('\n--- DETTAGLIO R3 ---');
  console.log('per meccanica: ' + fmt(r3.byKey));
  console.log('per ruolo:     ' + fmt(r3.byRole));
  console.log('per rank:      ' + fmt(r3.byRank));
  console.log(`nei casi mancati: winrate atteso del 1Â° consiglio meno quello della miglior opzione coprente, mediana ${med(r3.gapsWr)} punti; ` +
    `score del 3Â° consiglio meno quello dell'opzione coprente, mediana ${med(r3.gapsScore)}; posizione mediana dell'opzione coprente nella classifica: ${med(r3.posInList)}`);
  console.log('casi piu frequenti:');
  for (const [k, n] of [...r3.pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}x ${k}`);
}

function audit(input, heroesById, posOf) {
  let s;
  try { s = e.suggest(input, { includeAll: true }); } catch (x) { hit('R0', false, 'eccezione ' + x.message); return; }
  calls++;
  const picks = [s.top, ...s.alternatives];
  const taken = new Set([...input.allies, ...input.enemies]);
  const desc = `rank ${input.rankTier} Pos ${input.role} | A: ${input.allies.map((i) => heroesById.get(i)).join(', ') || '-'} | N: ${input.enemies.map((i) => heroesById.get(i)).join(', ') || '-'} -> ${s.top.name}`;
  hit('R0', picks.length === 6 && new Set(picks.map((p) => p.heroId)).size === 6 && picks.every((p) => !taken.has(p.heroId) && p.score >= 0 && p.score <= 100), desc);
  tops.set(s.top.name, (tops.get(s.top.name) || 0) + 1);
  if (s.wildcard) {
    wild.n++; wild.byKey[s.wildcard.needKey] = (wild.byKey[s.wildcard.needKey] || 0) + 1;
    if (s.wildcard.teamOnly) wild.team++;
    hit('R8', s.wildcard.teamOnly || (!picks.some((p) => p.heroId === s.wildcard.heroId) && !taken.has(s.wildcard.heroId) &&
      posOf(s.wildcard.name).includes(String(input.role)) && s.wildcard.winrateGap <= 2.5 && !/patch|7\.4\d|undefined|NaN\b/i.test(s.wildcard.text || '')), `${desc} (jolly ${s.wildcard.name}: ${s.wildcard.text})`);
  }

  const natural = s.all.filter((c) => posOf(c.name)[0] === String(input.role));
  if (natural.length) {
    const best = Math.max(...natural.map((c) => c.expectedWinrate));
    hit('R1', s.top.expectedWinrate >= best - 3, `${desc} (${s.top.expectedWinrate}% vs migliore ${best}%)`);
  }
  if (input.enemies.length >= 3) hit('R2', s.top.counter >= 40, `${desc} (counter ${s.top.counter})`);

  for (const need of s.teamNeeds.filter((n) => t.MECH_NEEDS.some((m) => m.key === n.key) && n.note === 'Mancante')) {
    const viable = s.all.filter((c) => (c.covers || []).includes(need.key) && posOf(c.name).includes(String(input.role)) && c.expectedWinrate >= s.top.expectedWinrate - 2);
    if (!viable.length) continue;
    // il jolly conta come copertura: e' il riquadro dedicato proprio a questi casi
    const ok = picks.some((p) => (p.covers || []).includes(need.key)) || (s.wildcard && s.wildcard.needKey === need.key);
    hit('R3', ok, `${desc} (manca ${need.key}; opzioni: ${viable.slice(0, 3).map((c) => c.name).join(', ')})`);
    r3Detail(need, input, s, viable, ok);
  }
  if (input.rankTier < 40) hit('R4', t.getDifficulty ? (t.DIFFICULTY[s.top.name] || 0) < 2 : true, desc);
  for (const p of picks) hit('R5', p.synergy >= 10 && p.synergy <= 90, `${desc} (${p.name} sinergia ${p.synergy})`);
  for (const p of picks) {
    const r = p.reasons || [];
    hit('R6', r.length >= 1 && r.length <= 4 && !r.some((x) => EN_RANK.test(x) || /patch|7\.4\d|undefined|NaN\b|null/i.test(x)), `${p.name}: ${r.join(' / ')}`);
  }
  hit('R7', posOf(s.top.name).includes(String(input.role)), `${desc} (posizioni ${posOf(s.top.name).join(',')})`);
}

(async () => {
  const groups = Object.entries(t.MECH_THREATS).map(([k, m]) => [k, Object.keys(m).filter((n) => m[n] >= 2)]);
  for (const rankTier of RANKS) {
    await e.loadData({ rankTier });
    const heroes = e.getHeroes();
    const ids = heroes.map((h) => h.id);
    const heroesById = new Map(heroes.map((h) => [h.id, h.name]));
    const idByName = new Map(heroes.map((h) => [h.name, h.id]));
    const posCache = new Map();
    // posizioni come stringa di cifre in ordine di preferenza ("54" = Pos 5, poi Pos 4)
    const posOf = (name) => { if (!posCache.has(name)) posCache.set(name, String(scoring.tagsOf(idByName.get(name)).positions || '').replace(/\D/g, '').split('')); return posCache.get(name); };
    await e.ensureMatchups(ids);
    if (USE_STRATZ) { try { await e.ensureStratz(ids, rankTier); } catch (x) { console.log('STRATZ errore:', x.message); } }
    for (const role of ROLES) {
      for (let i = 0; i < N; i++) {
        let enemies, allies;
        if (rnd() < 0.25) { // draft con minaccia di meccanica forzata
          mechDrafts++;
          const [, names] = groups[Math.floor(rnd() * groups.length)];
          const forced = sample(names.map((n) => idByName.get(n)).filter(Boolean), 2 + Math.floor(rnd() * 2));
          const rest = sample(ids.filter((x) => !forced.includes(x)), 4 + 5);
          enemies = forced.concat(rest.slice(0, Math.max(0, 5 - forced.length) * (rnd() < 0.5 ? 1 : 0)));
          allies = rest.slice(5, 5 + Math.floor(rnd() * 5));
        } else {
          const na = Math.floor(rnd() * 5), ne = Math.floor(rnd() * 6);
          const pool = sample(ids, na + ne);
          allies = pool.slice(0, na); enemies = pool.slice(na);
        }
        audit({ allies, enemies, role, rankTier }, heroesById, posOf);
      }
    }
    console.log('rank', rankTier, 'fatto, draft finora', calls);
  }
  console.log(`\n=== AUDIT ${USE_STRATZ ? 'CON' : 'SENZA'} STRATZ ===`);
  console.log(`draft analizzate: ${calls} (di cui con minaccia forzata: ${mechDrafts}) | eroi distinti come 1Â° consiglio: ${tops.size}`);
  for (const [k, label] of Object.entries(RULES)) {
    const s = stats[k];
    const pct = s.checked ? (100 * s.bad / s.checked).toFixed(2) : '-';
    console.log(`${k} ${pct}% violazioni (${s.bad}/${s.checked}) - ${label}`);
    for (const x of s.ex) console.log('    es: ' + String(x).slice(0, 260));
  }
  console.log(`\njolly mostrato in ${(100 * wild.n / calls).toFixed(2)}% delle draft (${wild.n}; solo squadra: ${wild.team}) | per bisogno: ${JSON.stringify(wild.byKey)}`);
  printR3();
})().catch((x) => { console.log('FAIL', x.stack); process.exit(2); });
