'use strict';
/**
 * Stima di vittoria del match a draft completa (5 vs 5).
 *
 * Modello in log-odds, antisimmetrico rispetto allo scambio delle squadre (p(A,B) = 100 - p(B,A)):
 *   z = w.base*Fbase + w.matchup*Fmatchup + w.syn*Fsyn + w.mech*Fmech + w.baseGap*FbaseGap
 *   p = sigmoid(z)
 * dove ogni F e' "la mia squadra meno gli avversari":
 *   Fbase     somma dei winrate base del bracket (regrediti come in suggest) in logit
 *   Fmatchup  25 coppie alleato-vs-nemico (matchup con shrinkage, simmetrizzati)
 *   Fsyn      sinergie interne (STRATZ se disponibili, altrimenti euristica) mie meno avversarie
 *   Fmech     lacune di meccaniche non coperte (es. 2+ invisibili senza rilevamento) loro meno mie
 *   FbaseGap  lacune di composizione (controllo, iniziazione, ...) loro meno mie
 * I pesi w e la covarianza (per l'intervallo) vengono da calibration.json, prodotto da tools/calibrate.js su partite
 * pubbliche reali. Senza quel file si usano pesi prudenti e la confidenza resta 'bassa'.
 */
const fs = require('fs');
const path = require('path');
const { store, ensureLoaded, bracketFromRankTier } = require('./data');
const S = require('./scoring');
const { NEEDS, MECH_NEEDS } = require('./tags');

const CAL_PATH = path.join(__dirname, 'calibration.json');
const DEFAULT_WEIGHTS = { base: 0.3, matchup: 0.15, syn: 0.15, mech: 0.05, baseGap: 0.03 };
const FEATURES = ['base', 'matchup', 'syn', 'mech', 'baseGap'];

let calMemo;
function calibration() {
  if (calMemo === undefined) {
    try { calMemo = JSON.parse(fs.readFileSync(CAL_PATH, 'utf8')); } catch (_) { calMemo = null; }
  }
  return calMemo;
}
const weights = () => (calibration() && calibration().weights) || DEFAULT_WEIGHTS;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const pc = (x, signed = false) => (signed && x > 0 ? '+' : '') + x.toFixed(1).replace('.', ',');
const nameOf = (id) => (store.byId.get(id) || {}).localized_name || String(id);

const MECH_LABEL = { detection: 'Rilevamento invisibili', aoe: 'Danno ad area contro illusioni', antiheal: 'Anti-cura', magicres: 'Resistenza magica', manaburn: 'Mana burn' };

/** Simmetrizza il delta matchup di a contro e (logit): (m(a,e) - m(e,a)) / 2. */
function matchupLogit(a, e, bracket) {
  const x = S.counterInfo(a, e, bracket), y = S.counterInfo(e, a, bracket);
  const lx = x ? x.logit : 0, ly = y ? y.logit : 0;
  return (lx - ly) / 2;
}

function teamBase(ids, bracket) {
  return ids.reduce((acc, h) => acc + S.BASE_SHRINK * logit(clamp(S.heroWinrate(h, bracket).wr, 0.2, 0.8)), 0);
}
function teamSyn(ids, bracket) {
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const s = S.pairSynergy(ids[i], ids[j], bracket);
    pairs.push({ a: ids[i], b: ids[j], logit: s.logit });
  }
  return pairs;
}
function lacune(my, opp) {
  const needs = S.computeNeeds(my, opp);
  const mech = needs.filter((n) => MECH_NEEDS.some((m) => m.key === n.key) && n.note === 'Mancante').map((n) => n.key);
  const base = needs.filter((n) => NEEDS.some((m) => m.key === n.key));
  const gap = base.reduce((a, n) => a + (1 - n.level), 0);
  return { mech, gap, base };
}

/**
 * Feature (la mia squadra meno gli avversari) con il dettaglio per i factors.
 * Esportata per la calibrazione (tools/calibrate.js).
 */
function features(my, opp, bracket) {
  const baseMy = teamBase(my, bracket), baseOpp = teamBase(opp, bracket);
  const pairsMatch = [];
  let fm = 0;
  for (const a of my) for (const e of opp) { const l = matchupLogit(a, e, bracket); fm += l; pairsMatch.push({ a, e, logit: l }); }
  const synMy = teamSyn(my, bracket), synOpp = teamSyn(opp, bracket);
  const fs_ = synMy.reduce((x, p) => x + p.logit, 0) - synOpp.reduce((x, p) => x + p.logit, 0);
  const lMy = lacune(my, opp), lOpp = lacune(opp, my);
  const F = { base: baseMy - baseOpp, matchup: fm, syn: fs_, mech: lOpp.mech.length - lMy.mech.length, baseGap: clamp(lOpp.gap - lMy.gap, -2.5, 2.5) }; // tetto ~ p1/p99 osservato in calibrazione: niente estrapolazione
  return { F, detail: { baseMy, baseOpp, pairsMatch, synMy, synOpp, lMy, lOpp } };
}

function quadForm(F, cov) {
  let q = 0;
  for (let i = 0; i < FEATURES.length; i++) for (let j = 0; j < FEATURES.length; j++) q += F[FEATURES[i]] * cov[i][j] * F[FEATURES[j]];
  return Math.max(0, q);
}

/**
 * estimateMatch({ allies:[5], enemies:[5], rankTier }) -> null se non e' 5 contro 5, altrimenti
 * { winProbability (%), low, high, confidence: 'bassa'|'media'|'alta', factors:[{text, impact}] (max 4), note }
 */
function estimateMatch(input = {}) {
  ensureLoaded();
  const toIds = (l) => (Array.isArray(l) ? l : []).map((x) => Number(x && typeof x === 'object' ? x.heroId : x)).filter((n) => Number.isFinite(n));
  const my = toIds(input.allies), opp = toIds(input.enemies);
  if (my.length !== 5 || opp.length !== 5) return null;
  if (new Set([...my, ...opp]).size !== 10) return null;
  if (![...my, ...opp].every((id) => store.byId.has(id))) return null;
  const bracket = input.rankTier != null ? bracketFromRankTier(input.rankTier) : store.bracket;
  const bracketName = S.BRACKET_NAMES[bracket - 1];
  const w = weights();
  const cal = calibration();
  const { F, detail } = features(my, opp, bracket);
  const z = FEATURES.reduce((a, k) => a + w[k] * F[k], 0);
  const p = sigmoid(z);

  // intervallo: incertezza dei parametri (covarianza da calibration.json) + pavimento di plausibilita'
  const sd = cal && cal.cov ? Math.sqrt(quadForm(F, cal.cov)) : 0.12;
  const floor = cal && cal.intervalFloorPoints != null ? cal.intervalFloorPoints : 3;
  const zLo = z - 1.64 * sd, zHi = z + 1.64 * sd;
  let low = sigmoid(zLo) * 100, high = sigmoid(zHi) * 100;
  low = Math.min(low, p * 100 - floor); high = Math.max(high, p * 100 + floor);
  low = clamp(low, 1, 99); high = clamp(high, 1, 99);

  // confidenza dalle regole misurate in calibrazione (default: sempre 'bassa')
  const dev = Math.abs(p - 0.5) * 100;
  const rules = (cal && cal.confidenceRules) || {};
  let confidence = 'bassa';
  if (rules.mediaFrom != null && dev >= rules.mediaFrom) confidence = 'media';
  if (rules.altaFrom != null && dev >= rules.altaFrom) confidence = 'alta';

  // factors: contributi in punti percentuali (variazione di p rimuovendo il singolo contributo)
  const impact = (c) => (p - sigmoid(z - c)) * 100;
  const cands = [];
  for (const m of detail.pairsMatch) {
    const c = w.matchup * m.logit;
    const imp = impact(c);
    if (Math.abs(imp) < 0.15) continue;
    cands.push({ impact: imp, text: imp > 0 ? `Il vostro ${nameOf(m.a)} contrasta ${nameOf(m.e)} (${pc(imp, true)}%)` : `Il vostro ${nameOf(m.a)} soffre contro ${nameOf(m.e)} (${pc(imp, true)}%)` });
  }
  for (const s of detail.synMy) {
    const imp = impact(w.syn * s.logit);
    if (Math.abs(imp) >= 0.15) cands.push({ impact: imp, text: imp > 0 ? `Sinergia ${nameOf(s.a)} + ${nameOf(s.b)} (${pc(imp, true)}%)` : `Poca sinergia tra ${nameOf(s.a)} e ${nameOf(s.b)} (${pc(imp, true)}%)` });
  }
  for (const s of detail.synOpp) {
    const imp = impact(-w.syn * s.logit);
    if (Math.abs(imp) >= 0.15) cands.push({ impact: imp, text: imp < 0 ? `Gli avversari hanno sinergia ${nameOf(s.a)} + ${nameOf(s.b)} (${pc(imp, true)}%)` : `Poca sinergia tra ${nameOf(s.a)} e ${nameOf(s.b)} negli avversari (${pc(imp, true)}%)` });
  }
  const baseImp = impact(w.base * F.base);
  if (Math.abs(baseImp) >= 0.3) cands.push({ impact: baseImp, text: baseImp < 0 ? `Winrate degli eroi avversari più alto a questo rank (${pc(baseImp, true)}%)` : `Winrate dei vostri eroi più alto a questo rank (${pc(baseImp, true)}%)` });
  const perMech = impact(w.mech) ; // effetto di una lacuna meccanica
  const invis = (ids) => ids.filter((id) => (S.mechOf(id).invis || 0) >= 2).length;
  const mechText = (side, k, n) => {
    const opp = side === 'opp';
    const who = opp ? 'Gli avversari hanno' : 'Voi avete';
    const other = opp ? 'voi' : 'gli avversari';
    switch (k) {
      case 'detection': return `${who} ${n} invisibili e ${other} nessun rilevamento`;
      case 'antiheal': return `${who} cure forti e ${other} nessun anti-cura`;
      case 'magicres': return `${who} molto danno magico e ${other} poca resistenza magica`;
      case 'aoe': return `${who} più illusioni e ${other} poco danno ad area`;
      default: return `${who} eroi dipendenti dal mana e ${other} nessun mana burn`;
    }
  };
  for (const k of detail.lMy.mech) cands.push({ impact: -Math.abs(perMech) || -0.1, text: mechText('opp', k, invis(opp)) + ` (${pc(-Math.abs(perMech), true)}%)` });
  for (const k of detail.lOpp.mech) cands.push({ impact: Math.abs(perMech) || 0.1, text: mechText('my', k, invis(my)) + ` (${pc(Math.abs(perMech), true)}%)` });
  const gapImp = impact(w.baseGap * F.baseGap);
  if (Math.abs(gapImp) >= 0.3) {
    const miss = (l) => l.base.filter((n) => n.level < 0.34).map((n) => n.label.toLowerCase()).slice(0, 2).join(' e ');
    cands.push({ impact: gapImp, text: gapImp < 0 ? `Alla vostra squadra manca: ${miss(detail.lMy) || 'equilibrio'} (${pc(gapImp, true)}%)` : `Agli avversari manca: ${miss(detail.lOpp) || 'equilibrio'} (${pc(gapImp, true)}%)` });
  }
  cands.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const factors = cands.slice(0, 4).map((c) => ({ text: c.text.replace(/\s+/g, ' '), impact: Math.round(c.impact * 10) / 10 }));

  const acc = cal && cal.metrics ? cal.metrics.accuracy : null;
  const note = acc != null
    ? `La draft spiega solo una parte del risultato (accuratezza misurata ${pc(acc * 100)}% su ${cal.matches} partite pubbliche, contro il 50% del caso): conta soprattutto come giocate.`
    : 'La draft spiega solo una parte del risultato: conta soprattutto come giocate. Stima non calibrata.';
  return {
    winProbability: Math.round(p * 1000) / 10,
    low: Math.round(low * 10) / 10,
    high: Math.round(high * 10) / 10,
    confidence,
    factors,
    note,
  };
}

module.exports = { estimateMatch, features, FEATURES, DEFAULT_WEIGHTS, CAL_PATH, sigmoid, logit };
