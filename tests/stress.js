// Stress test del motore: molti draft casuali + tutti gli eroi come nemico singolo, per ogni rank e ruolo.
// Uso: node tests/stress.js [bozze-per-rank-ruolo] [--stratz]   (non fa parte di `npm test`: usa la rete)
const e = require('../src/engine');
const N = Number(process.argv[2]) || 300;
const USE_STRATZ = process.argv.includes('--stratz');
const RANKS = [15, 25, 35, 45, 55, 65, 75, 85];
const ROLES = [1, 2, 3, 4, 5];
const ALTS = 5; // suggerimenti mostrati: miglior pick + 5 alternative
const NEEDS = ['disable', 'initiation', 'magic', 'push', 'support', 'tank'];

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const sample = (arr, k) => { const a = arr.slice(); const out = []; while (out.length < k && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };

const problems = new Map();
const bad = (kind, detail) => { if (!problems.has(kind)) problems.set(kind, { n: 0, example: detail }); problems.get(kind).n++; };
const tops = new Map();
let calls = 0, ms = 0;

function check(input, s) {
  const picks = [s.top, ...s.alternatives];
  const taken = new Set([...input.allies, ...input.enemies]);
  const ctx = JSON.stringify(input);
  if (!s.top || s.alternatives.length !== ALTS) bad('forma: top/alternative', ctx);
  const ids = picks.map((p) => p.heroId);
  if (new Set(ids).size !== ids.length) bad('pick duplicati', ctx);
  for (const p of picks) {
    if (taken.has(p.heroId)) bad('suggerito eroe gia scelto', ctx + ' -> ' + p.name);
    for (const f of ['score', 'winrate', 'counter', 'synergy']) if (typeof p[f] !== 'number' || !isFinite(p[f])) bad('numero non valido: ' + f, ctx + ' ' + p.name);
    if (p.score < 0 || p.score > 100) bad('score fuori 0-100', ctx + ' ' + p.score);
    if (p.counter < 0 || p.counter > 100 || p.synergy < 0 || p.synergy > 100) bad('counter/sinergia fuori 0-100', ctx + ' ' + p.name);
    if (p.winrate < 30 || p.winrate > 70) bad('winrate implausibile', ctx + ' ' + p.name + ' ' + p.winrate);
    if (!p.img || !/^https:\/\//.test(p.img)) bad('immagine mancante', p.name);
    if (!Array.isArray(p.reasons) || !p.reasons.length) bad('reasons vuote', p.name);
    for (const r of p.reasons || []) {
      if (/patch|7\.4\d|undefined|NaN|null/i.test(r)) bad('reason sospetta', r);
    }
  }
  if (!picks.every((p, i) => i === 0 || picks[i - 1].score >= p.score)) bad('ordine punteggi', ctx);
  const keys = (s.teamNeeds || []).map((n) => n.key);
  if (NEEDS.some((k) => !keys.includes(k))) bad('teamNeeds incompleti', keys.join());
  for (const n of s.teamNeeds || []) {
    if (!(n.level >= 0 && n.level <= 1) || !n.note || !n.label) bad('teamNeeds valore non valido', JSON.stringify(n));
  }
}

function run(input) {
  const t0 = process.hrtime.bigint();
  let s;
  try { s = e.suggest(input); } catch (x) { bad('eccezione: ' + x.message, JSON.stringify(input)); return; }
  ms += Number(process.hrtime.bigint() - t0) / 1e6; calls++;
  check(input, s);
  const key = s.top.name;
  tops.set(key, (tops.get(key) || 0) + 1);
  return s;
}

(async () => {
  let ids = [];
  for (const rankTier of RANKS) {
    await e.loadData({ rankTier });
    const heroes = e.getHeroes();
    ids = heroes.map((h) => h.id);
    await e.ensureMatchups(ids);
    if (USE_STRATZ) {
      try { await e.ensureStratz(ids, rankTier); } catch (x) { bad('stratz', x.message); }
    }
    for (const role of ROLES) {
      for (let i = 0; i < N; i++) {
        const na = Math.floor(rnd() * 5), ne = Math.floor(rnd() * 6);
        const pool = sample(ids, na + ne);
        run({ allies: pool.slice(0, na), enemies: pool.slice(na), role, rankTier });
      }
      for (const id of ids) run({ allies: [], enemies: [id], role, rankTier });        // ogni eroe come unico nemico
      run({ allies: [], enemies: [], role, rankTier });                                  // draft vuoto
      const full = sample(ids, 9); run({ allies: full.slice(0, 4), enemies: full.slice(4), role, rankTier }); // ultimo pick
    }
    console.log('rank', rankTier, 'ok, chiamate finora', calls);
  }
  // determinismo
  const d = { allies: sample(ids, 3), enemies: sample(ids, 4), role: 3, rankTier: 65 };
  if (JSON.stringify(e.suggest(d)) !== JSON.stringify(e.suggest(d))) bad('non deterministico', JSON.stringify(d));

  const sorted = [...tops.entries()].sort((a, b) => b[1] - a[1]);
  const total = calls;
  console.log('\n=== RISULTATO ===');
  console.log('suggerimenti calcolati:', calls, '| tempo medio ' + (ms / calls).toFixed(2) + ' ms');
  console.log('eroi distinti come top:', tops.size, 'su', ids.length);
  console.log('top 8:', sorted.slice(0, 8).map(([n, c]) => `${n} ${(100 * c / total).toFixed(1)}%`).join(', '));
  if (!problems.size) console.log('problemi: nessuno');
  for (const [k, v] of problems) console.log('PROBLEMA', k, 'x' + v.n, '| es:', String(v.example).slice(0, 200));
  process.exit(problems.size ? 1 : 0);
})().catch((x) => { console.log('FAIL', x.stack); process.exit(2); });
