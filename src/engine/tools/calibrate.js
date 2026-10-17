'use strict';
/**
 * Calibra estimateMatch su partite pubbliche reali (vedi tools/fetch-matches.js) e scrive src/engine/calibration.json.
 * Uso: node src/engine/tools/calibrate.js <matches.json> [richiesteUsate]
 * Regressione logistica (IRLS, ridge) sulle feature di match.js, senza intercetta (il modello e' simmetrico fra le
 * squadre). Metriche su 5-fold cross validation (fuori campione). Se il modello e' sovraconfidente (pendenza < 1)
 * i pesi vengono compressi con un fattore di temperatura.
 */
const fs = require('fs');
const path = require('path');
const engine = require('../index');
const { features, FEATURES } = require('../match');
const { bracketFromRankTier, store } = require('../data');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const K = FEATURES.length;

function solve(A, b) { // Gauss con pivot, A K x K
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function invert(A) {
  const n = A.length; return Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)))).map((col, j, all) => all.map((c) => c[j]));
}

/**
 * Regressione logistica ridge con intercetta (vantaggio del lato Radiant: serve solo a non sporcare i pesi, a runtime
 * il lato e' ignoto) e pesi delle feature vincolati a >= 0 (active set: una feature con peso negativo e' rumore o
 * contraddice il suo significato, viene esclusa e si rifitta).
 */
function fit(X, y, lambda = 1) {
  const only = process.env.CAL_FEATURES ? process.env.CAL_FEATURES.split(',') : null; // solo per ablazioni
  const active = FEATURES.map((k) => !only || only.includes(k));
  for (let round = 0; round < K + 1; round++) {
    const idx = []; active.forEach((v, k) => { if (v) idx.push(k); });
    const cols = idx.length + 1; // +1 intercetta
    const rows = X.map((r) => [...idx.map((k) => r[k]), 1]);
    let w = new Array(cols).fill(0); let H;
    for (let it = 0; it < 60; it++) {
      const g = new Array(cols).fill(0); H = Array.from({ length: cols }, () => new Array(cols).fill(0));
      for (let i = 0; i < rows.length; i++) {
        const z = rows[i].reduce((s, v, k) => s + v * w[k], 0); const p = sigmoid(z); const wt = p * (1 - p);
        for (let a = 0; a < cols; a++) { g[a] += rows[i][a] * (y[i] - p); for (let c = 0; c < cols; c++) H[a][c] += wt * rows[i][a] * rows[i][c]; }
      }
      for (let a = 0; a < idx.length; a++) { g[a] -= lambda * w[a]; H[a][a] += lambda; }
      const d = solve(H, g); w = w.map((v, k) => v + d[k]);
      if (Math.max(...d.map(Math.abs)) < 1e-9) break;
    }
    const neg = idx.filter((k, j) => w[j] < 0);
    if (!neg.length) {
      const full = new Array(K).fill(0); idx.forEach((k, j) => { full[k] = w[j]; });
      // covarianza completa (K x K) sulle sole feature attive
      const Hf = Array.from({ length: K }, () => new Array(K).fill(0));
      const inv = invert(H);
      idx.forEach((k1, j1) => idx.forEach((k2, j2) => { Hf[k1][k2] = inv[j1][j2]; }));
      return { w: full, b: w[cols - 1], cov: Hf, active: active.slice() };
    }
    for (const k of neg) active[k] = false;
  }
  return { w: new Array(K).fill(0), b: 0, cov: Array.from({ length: K }, () => new Array(K).fill(0)), active };
}

function metrics(p, y) {
  let ok = 0, br = 0, ll = 0;
  for (let i = 0; i < p.length; i++) {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, p[i]));
    if ((p[i] > 0.5) === (y[i] === 1)) ok++;
    br += (p[i] - y[i]) ** 2; ll -= y[i] ? Math.log(q) : Math.log(1 - q);
  }
  return { accuracy: ok / p.length, brier: br / p.length, logLoss: ll / p.length };
}
function table(p, y) {
  const bins = [[0, 45], [45, 50], [50, 55], [55, 60], [60, 101]];
  return bins.map(([lo, hi]) => {
    const idx = p.map((v, i) => i).filter((i) => p[i] * 100 >= lo && p[i] * 100 < hi);
    const n = idx.length;
    return { bin: hi > 100 ? '>60' : lo === 0 ? '<45' : `${lo}-${hi}`, n, predicted: n ? +(100 * idx.reduce((a, i) => a + p[i], 0) / n).toFixed(1) : null, actual: n ? +(100 * idx.reduce((a, i) => a + y[i], 0) / n).toFixed(1) : null };
  });
}

(async () => {
  const [file, requests] = process.argv.slice(2);
  const matches = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('partite:', matches.length);
  await engine.loadData({ rankTier: 55, matchups: 'all' });
  console.log('matchups caricati:', store.matchups.size);
  const X = [], y = [], ranks = [];
  for (const m of matches) {
    const all = [...m.radiant_team, ...m.dire_team];
    if (!all.every((id) => store.byId.has(id)) || new Set(all).size !== 10) continue;
    const { F } = features(m.radiant_team, m.dire_team, bracketFromRankTier(m.avg_rank_tier));
    X.push(FEATURES.map((k) => F[k])); y.push(m.radiant_win ? 1 : 0); ranks.push(m.avg_rank_tier);
  }
  const N = X.length;
  console.log('partite usate:', N, '| vittorie Radiant:', (100 * y.reduce((a, b) => a + b, 0) / N).toFixed(1) + '%');

  // 5-fold CV (ordine mescolato con seme fisso)
  let seed = 2024; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const order = Array.from({ length: N }, (_, i) => i).sort(() => rnd() - 0.5);
  const oofZ = new Array(N), oofS = new Array(N); // z delle sole feature; z + intercetta (lato Radiant)
  const LAMBDA = 1;
  for (let f = 0; f < 5; f++) {
    const test = order.filter((_, i) => i % 5 === f), train = order.filter((_, i) => i % 5 !== f);
    const m = fit(train.map((i) => X[i]), train.map((i) => y[i]), LAMBDA);
    for (const i of test) { oofZ[i] = X[i].reduce((a, v, k) => a + v * m.w[k], 0); oofS[i] = oofZ[i] + m.b; }
  }
  // pendenza di calibrazione fuori campione (regressione logistica di y su z): <1 = sovraconfidente
  const slopeOf = (zs) => { let s = 1; for (let it = 0; it < 60; it++) { let g = 0, h = 1e-9; for (let i = 0; i < N; i++) { const p = sigmoid(s * zs[i]); g += zs[i] * (y[i] - p); h += p * (1 - p) * zs[i] ** 2; } s += g / h; } return s; };
  const slope = slopeOf(oofS);
  const temperature = Math.min(1, Math.max(0.3, slope));
  const pSideRaw = oofS.map(sigmoid), pSide = oofS.map((z) => sigmoid(temperature * z));
  const baseline = metrics(new Array(N).fill(0.5), y);
  const radiantRate = y.reduce((a, b) => a + b, 0) / N;
  const mRaw = metrics(pSideRaw, y), mSide = metrics(pSide, y);
  // senza lato (come a runtime): accuratezza del segno e Brier/logloss orientati sul favorito, esito "il favorito vince"
  const pHero = oofZ.map((z) => sigmoid(temperature * z));
  const accHero = oofZ.filter((z, i) => (z > 0) === (y[i] === 1)).length / N;
  console.log('baseline: accuratezza 50% (caso) o', (100 * Math.max(radiantRate, 1 - radiantRate)).toFixed(1) + '% (sempre Radiant)', '| Brier 0.25 | logloss 0.6931');
  console.log('con lato, grezzo  :', JSON.stringify(mRaw), 'pendenza', slope.toFixed(3));
  console.log('con lato, temperatura', temperature.toFixed(3) + ':', JSON.stringify(mSide));
  console.log('solo eroi (lato ignorato) accuratezza:', (100 * accHero).toFixed(1) + '%');
  const tab = table(pSide, y);
  console.log('tabella di calibrazione (probabilita Radiant, lato incluso), previsto vs reale:'); for (const r of tab) console.log(' ', JSON.stringify(r));
  // tabella orientata sul favorito, lato escluso: il favorito (secondo i soli eroi) vince?
  const favP = pHero.map((p) => Math.max(p, 1 - p)), favWin = oofZ.map((z, i) => ((z > 0) === (y[i] === 1) ? 1 : 0));
  const favBins = [[50, 52], [52, 54], [54, 56], [56, 60], [60, 101]].map(([lo, hi]) => {
    const idx = favP.map((v, i) => i).filter((i) => favP[i] * 100 >= lo && favP[i] * 100 < hi); const n = idx.length;
    return { bin: hi > 100 ? '>60' : lo + '-' + hi, n, predicted: n ? +(100 * idx.reduce((s, i) => s + favP[i], 0) / n).toFixed(1) : null, actual: n ? +(100 * idx.reduce((s, i) => s + favWin[i], 0) / n).toFixed(1) : null };
  });
  console.log('tabella orientata sul favorito (lato ignorato; l\'esito include il vantaggio di lato):'); for (const r of favBins) console.log(' ', JSON.stringify(r));

  // accuratezza condizionata alla distanza da 50 (per la confidenza), sui soli eroi
  const cond = [];
  for (const th of [0, 1, 2, 3, 4, 5, 6, 8, 10]) {
    const idx = favP.map((p, i) => i).filter((i) => (favP[i] - 0.5) * 100 >= th);
    cond.push({ minDev: th, n: idx.length, accuracy: +(idx.reduce((s, i) => s + favWin[i], 0) / Math.max(1, idx.length)).toFixed(3) });
  }
  console.log('accuratezza per distanza da 50 (solo eroi):', JSON.stringify(cond));
  const first = (target, minN) => { const c = cond.find((r) => r.n >= minN && r.accuracy >= target && r.minDev > 0); return c ? c.minDev : null; };
  const rules = { mediaFrom: first(0.60, 300), altaFrom: first(0.65, 100) }; // alta solo se la precisione misurata supera il 65%

  // fit finale su tutto; pesi compressi con la temperatura; covarianza (Fisher) scalata
  const m = fit(X, y, LAMBDA);
  const weights = {}; FEATURES.forEach((k, i) => { weights[k] = +(m.w[i] * temperature).toFixed(5); });
  const cov = m.cov.map((r) => r.map((v) => v * temperature * temperature));
  const rankHist = {}; for (const r of ranks) { const b = Math.floor(r / 10); rankHist[b] = (rankHist[b] || 0) + 1; }
  const out = {
    date: new Date().toISOString().slice(0, 10),
    source: 'OpenDota /publicMatches (partite recenti; salvati solo eroi, esito e rank medio, nessun dato dei giocatori)',
    filters: 'lobby non bot, modalita draft (AP/CM/RD/SD/CD/Ranked AP), durata >= 10 min, rank medio presente, 10 eroi noti',
    requests: Number(requests) || null,
    matches: N,
    radiantWinPct: +(100 * radiantRate).toFixed(1),
    rankBracketCounts: rankHist,
    method: 'Regressione logistica ridge (lambda ' + LAMBDA + ') con intercetta per il lato Radiant (ignorata a runtime) e pesi >= 0 (le feature con peso negativo sono escluse: ' + FEATURES.filter((k, i) => !m.active[i]).join(', ') + '); metriche in 5-fold cross validation; temperatura ' + temperature.toFixed(3) + ' sui pesi',
    featureOrder: FEATURES,
    activeFeatures: FEATURES.filter((k, i) => m.active[i]),
    weights,
    cov,
    sideIntercept: +m.b.toFixed(4),
    temperature: +temperature.toFixed(3),
    calibrationSlopeBeforeTemperature: +slope.toFixed(3),
    intervalFloorPoints: 4,
    metrics: {
      accuracyHeroesOnly: +accHero.toFixed(4),
      accuracyWithSide: +mSide.accuracy.toFixed(4),
      brierWithSide: +mSide.brier.toFixed(5),
      logLossWithSide: +mSide.logLoss.toFixed(5),
      baseline: { accuracyChance: 0.5, accuracyAlwaysRadiant: +Math.max(radiantRate, 1 - radiantRate).toFixed(4), brier: 0.25, logLoss: +Math.log(2).toFixed(5) },
      beforeTemperature: { brier: +mRaw.brier.toFixed(5), logLoss: +mRaw.logLoss.toFixed(5) },
    },
    calibrationTableRadiant: tab,
    calibrationTableFavorite: favBins,
    accuracyByDeviation: cond,
    confidenceRules: rules,
  };
  out.metrics.accuracy = out.metrics.accuracyHeroesOnly; // usato dalla nota di estimateMatch
  if (!process.env.CAL_DRY) fs.writeFileSync(path.join(__dirname, '..', 'calibration.json'), JSON.stringify(out, null, 2));
  console.log('scritto calibration.json | pesi', JSON.stringify(weights), '| regole confidenza', JSON.stringify(rules), '| lato', m.b.toFixed(3));
})().catch((e) => { console.error(e); process.exit(1); });
