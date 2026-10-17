'use strict';
const { store, ensureLoaded, bracketFromRankTier } = require('./data');
const { NEEDS, MECH_NEEDS, KNOWN_SYNERGIES, getTags, getMech, getDifficulty } = require('./tags');
const balance = require('./balance');

const BRACKET_NAMES = ['Araldo', 'Guardiano', 'Crociato', 'Arconte', 'Leggenda', 'Antico', 'Divino', 'Immortale'];
const SHRINK_K = 150; // partite "virtuali" a favore del winrate base nel matchup
const SYN_K = 800;    // shrinkage piu' forte per la sinergia (coppie con meno campione)
const COUNTER_SCALE = 0.55;     // correzione per correlazione fra i matchup dei vari nemici
const SYN_SCALE = 0.5;
const BASE_SHRINK = 0.6;       // regressione verso 50%: i winrate pub incorporano bias di selezione (chi pick-a cosa, quando)
const MAX_SHIFT = 0.4;         // compressione (tanh) dello scostamento totale counter+sinergia: evita winrate attesi irrealistici
const HEUR_SYN_SCALE = 0.25;   // l'euristica di sinergia vale poco in log-odds (max ~ +-0.1 per alleato)
const MIN_GAMES_VS = 60, MIN_GAMES_WITH = 100, SHOW_GAMES_WITH = 300;
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const pc = (x) => x.toFixed(1).replace('.', ','); // numeri all'italiana nelle reasons

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const tagCache = new Map();
function tagsOf(heroId) {
  const hero = store.byId.get(heroId);
  const key = heroId + ':' + store.source;
  if (!tagCache.has(key)) tagCache.set(key, getTags(hero));
  return tagCache.get(key);
}

function heroWinrate(id, bracket) {
  const s = store.stats.get(id);
  if (!s) return { wr: 0.5, picks: 0 };
  let pick = s[`${bracket}_pick`] || 0;
  let win = s[`${bracket}_win`] || 0;
  if (pick < 200) { // campione scarso: somma tutti i bracket
    pick = 0; win = 0;
    for (let b = 1; b <= 8; b++) { pick += s[`${b}_pick`] || 0; win += s[`${b}_win`] || 0; }
  }
  return { wr: (win + 25) / (pick + 50), picks: pick };
}

function overallWinrate(id) {
  const s = store.stats.get(id);
  if (!s) return 0.5;
  let pick = 0, win = 0;
  for (let b = 1; b <= 8; b++) { pick += s[`${b}_pick`] || 0; win += s[`${b}_win`] || 0; }
  return (win + 25) / (pick + 50);
}

/**
 * Toglie l'ultimo valore se e' un giorno parziale: verificato sui dati reali OpenDota (127 eroi),
 * dove l'ultimo valore di pub_pick_trend e' sempre 0.12-0.22 della media dei 6 precedenti.
 * Regola: scarta se < 0.6 * mediana degli altri valori (con >= 4 valori).
 */
function dropPartial(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return Array.isArray(arr) ? arr : [];
  const rest = arr.slice(0, -1).slice().sort((a, b) => a - b);
  const med = rest[Math.floor(rest.length / 2)];
  return arr[arr.length - 1] < 0.6 * med ? arr.slice(0, -1) : arr;
}

/**
 * Normalizzatore robusto: mediana -> 0.5, ampiezza p10-p90 (almeno `floor`) -> +-0.3 per mezza ampiezza, clamp 0..1.
 * Il pavimento evita di amplificare rumore quando il pool non si differenzia (es. matchup assenti).
 */
function robustNormalizer(values, floor, slope = 0.3) {
  const s = values.slice().sort((a, b) => a - b);
  const q = (x) => s[Math.min(s.length - 1, Math.max(0, Math.round(x * (s.length - 1))))];
  const med = q(0.5);
  const half = Math.max(q(0.9) - q(0.1), floor) / 2;
  return (v) => clamp(0.5 + slope * (v - med) / half, 0, 1);
}

let metaMemo = { key: null, map: null };
/** Segnale meta per eroe: { recentWr, growth (relativa vs globale), score 0..1, pro 0..1 }. Memoizzato per dataset. */
function metaTable() {
  if (metaMemo.key === store.stats) return metaMemo.map;
  const rows = [];
  let gFirst = 0, gLast = 0, maxPro = 0;
  for (const [id, s] of store.stats) {
    const pick = dropPartial(s.pub_pick_trend), win = dropPartial(s.pub_win_trend);
    const n = Math.min(pick.length, win.length);
    let row = { id, recentWr: null, rawGrowth: null, pro: (s.pro_pick || 0) + (s.pro_ban || 0) };
    if (n >= 4) {
      const p = pick.slice(0, n), w = win.slice(0, n);
      const tp = p.reduce((a, b) => a + b, 0);
      const h = Math.floor(n / 2);
      const first = p.slice(0, h).reduce((a, b) => a + b, 0) / h;
      const last = p.slice(n - h).reduce((a, b) => a + b, 0) / h;
      if (tp > 0 && first > 0) {
        row.recentWr = w.reduce((a, b) => a + b, 0) / tp;
        row.rawGrowth = last / first - 1;
        gFirst += first; gLast += last;
      }
    }
    maxPro = Math.max(maxPro, row.pro);
    rows.push(row);
  }
  const globalGrowth = gFirst > 0 ? gLast / gFirst - 1 : 0;
  const map = new Map();
  for (const r of rows) {
    let score = null, growth = null;
    if (r.recentWr !== null) {
      growth = (1 + r.rawGrowth) / (1 + globalGrowth) - 1; // crescita rispetto al calo/aumento globale
      score = clamp(0.5 + (r.recentWr - 0.5) * 4 + clamp(growth, -0.2, 0.2) * 1.5, 0, 1);
    }
    map.set(r.id, { recentWr: r.recentWr, growth, score, pro: maxPro > 0 ? Math.sqrt(r.pro / maxPro) : null });
  }
  metaMemo = { key: store.stats, map };
  return map;
}

/** Dati STRATZ (se caricati) per il bracket: record { games, wins } di a con/contro b, oppure null. */
function stratzRecord(kind, fromId, toId, bracket) {
  const e = store.stratz.data.get(`${bracket}:${fromId}`);
  if (!e) return null;
  return e[kind].get(toId) || null;
}

/** Winrate di cand contro enemy (0..1) o null se nessun dato. Usa il matchup inverso se serve. */
function vsRecord(cand, enemy, bracket) {
  if (store.stratz.token && bracket) {
    // STRATZ (filtrato per bracket): wins = vittorie dell'eroe interrogato
    const z1 = stratzRecord('vs', enemy, cand, bracket);
    if (z1 && z1.games >= MIN_GAMES_VS) return { games: z1.games, wins: z1.games - z1.wins };
    const z2 = stratzRecord('vs', cand, enemy, bracket);
    if (z2 && z2.games >= MIN_GAMES_VS) return { games: z2.games, wins: z2.wins };
  }
  const a = store.matchups.get(cand);
  if (a && a.has(enemy)) { const r = a.get(enemy); return { games: r.games, wins: r.wins }; }
  const b = store.matchups.get(enemy);
  if (b && b.has(cand)) { const r = b.get(cand); return { games: r.games, wins: r.games - r.wins }; }
  return null;
}

/** Matchup di cand contro enemy: { delta (frazione di winrate), logit } rispetto al winrate base, con shrinkage per partite. */
function counterInfo(cand, enemy, bracket) {
  const rec = vsRecord(cand, enemy, bracket);
  if (!rec || !rec.games) return null;
  const base = clamp(overallWinrate(cand), 0.2, 0.8);
  const adj = clamp((rec.wins + SHRINK_K * base) / (rec.games + SHRINK_K), 0.05, 0.95);
  return { delta: adj - base, logit: clamp(logit(adj) - logit(base), -0.25, 0.25), games: rec.games };
}

/** Vantaggio (frazione di winrate) di cand su enemy rispetto al suo winrate base; null se manca il dato. */
function counterDelta(cand, enemy, bracket) {
  const i = counterInfo(cand, enemy, bracket);
  return i ? i.delta : null;
}

/**
 * Sinergia tra due eroi: { score 0..1 (0.5 neutro), logit (contributo al winrate atteso), note }.
 * Con STRATZ: winrate 'with' per bracket con shrinkage per partite (SYN_K). Senza: euristica su tag.
 */
function pairSynergy(aId, bId, bracket) {
  const nameA = (store.byId.get(aId) || {}).localized_name;
  const nameB = (store.byId.get(bId) || {}).localized_name;
  if (store.stratz.token && bracket) {
    const r = stratzRecord('with', aId, bId, bracket) || stratzRecord('with', bId, aId, bracket);
    if (r && r.games >= MIN_GAMES_WITH) {
      const exp = clamp((overallWinrate(aId) + overallWinrate(bId)) / 2, 0.2, 0.8);
      const adj = clamp((r.wins + SYN_K * exp) / (r.games + SYN_K), 0.05, 0.95);
      const d = adj - exp;
      let note = null;
      if (d >= 0.012) {
        note = r.games >= SHOW_GAMES_WITH
          ? `${nameA} e ${nameB} insieme vincono il ${pc((r.wins / r.games) * 100)}% (${r.games} partite)`
          : `${nameA} e ${nameB} funzionano bene insieme`;
      }
      return { score: clamp(0.5 + d * 5, 0, 1), logit: clamp(logit(adj) - logit(exp), -0.2, 0.2) * SYN_SCALE, note };
    }
  }
  const a = tagsOf(aId), b = tagsOf(bId);
  let s = 0.5, note = null, best = 0;
  const bump = (v, text) => { s += v; if (v > best) { best = v; note = text; } };
  for (const k of KNOWN_SYNERGIES) {
    if ((k[0] === aId && k[1] === bId) || (k[0] === bId && k[1] === aId)) bump(0.25, k[2]);
  }
  // iniziazione + seguito: inizia chi ha piu' iniziazione, segue l'altro
  const [init, fol, nInit, nFol] = a.initiation >= b.initiation ? [a, b, nameA, nameB] : [b, a, nameB, nameA];
  if (init.initiation >= 2 && (fol.magic >= 2 || fol.disable >= 2)) {
    bump(0.12, `${nInit} inizia il combattimento e ${nFol} segue con danno o controllo`);
  }
  const carryPos = (t) => t.positions[0] === '1';
  if (a.support >= 2 && carryPos(b)) bump(0.1, `${nameA} sostiene ${nameB} nelle fasi di farm e teamfight`);
  if (b.support >= 2 && carryPos(a)) bump(0.1, `${nameB} sostiene ${nameA} nelle fasi di farm e teamfight`);
  if (a.disable >= 2 && carryPos(b)) bump(0.08, `Il controllo di ${nameA} crea spazio a ${nameB}`);
  if (b.disable >= 2 && carryPos(a)) bump(0.08, `Il controllo di ${nameB} crea spazio a ${nameA}`);
  if (a.push >= 2 && b.push >= 2) bump(0.06, `${nameA} e ${nameB} insieme spingono bene le torri`);
  if (a.positions[0] === b.positions[0] && a.positions[0] !== '4' && a.positions[0] !== '5') s -= 0.05; // stesso ruolo
  s = clamp(s, 0, 1);
  return { score: s, logit: (s - 0.5) * HEUR_SYN_SCALE, note };
}

const mechCache = new Map();
function mechOf(heroId) {
  const key = heroId + ':' + store.source;
  if (!mechCache.has(key)) mechCache.set(key, getMech(store.byId.get(heroId)));
  return mechCache.get(key);
}

/** Minacce della squadra nemica: misura per ogni meccanica e nomi degli eroi che la portano. */
function enemyThreats(enemyIds) {
  const out = {};
  for (const th of ['invis', 'illusions', 'heal', 'manadep', 'magic']) out[th] = { value: 0, heroes: [] };
  for (const id of enemyIds) {
    if (!store.byId.has(id)) continue;
    const m = mechOf(id);
    const name = store.byId.get(id).localized_name;
    for (const th of ['invis', 'illusions']) if (m[th] >= 2) { out[th].value += 1; out[th].heroes.push(name); }
    for (const th of ['heal', 'manadep']) if (m[th] >= 1) { out[th].value += m[th]; out[th].heroes.push(name); }
    const mg = tagsOf(id).magic || 0;
    if (mg >= 2) { out.magic.value += mg; out.magic.heroes.push(name); }
  }
  return out;
}

function computeNeeds(allyIds, enemyIds = []) {
  const raw = {};
  NEEDS.forEach((n) => { raw[n.key] = 0; });
  for (const id of allyIds) {
    if (!store.byId.has(id)) continue;
    const t = tagsOf(id);
    NEEDS.forEach((n) => { raw[n.key] += t[n.key] || 0; });
  }
  const needs = NEEDS.map((n) => {
    const level = clamp(raw[n.key] / n.target, 0, 1);
    let note;
    if (!allyIds.length) note = 'Da definire';
    else if (level < 0.34) note = 'Mancante';
    else if (level < 0.67) note = 'Scarso';
    else note = 'Coperto';
    return { key: n.key, label: n.label, level: Math.round(level * 100) / 100, note };
  });
  // bisogni dettati dalle meccaniche nemiche (compaiono solo quando la minaccia e' rilevante)
  const th = enemyThreats(enemyIds);
  for (const mn of MECH_NEEDS) {
    if (th[mn.threat].value < mn.minThreat) continue;
    let have = 0;
    for (const id of allyIds) if (store.byId.has(id)) have += mechOf(id)[mn.key] || 0;
    const level = clamp(have / mn.target, 0, 1);
    const note = level < 0.34 ? 'Mancante' : level < 0.67 ? 'Scarso' : 'Coperto';
    needs.push({ key: mn.key, label: mn.label, level: Math.round(level * 100) / 100, note, threat: th[mn.threat].heroes.slice(0, 4) });
  }
  return needs;
}

function roleFit(tags, role) {
  if (!role) return 1;
  const i = tags.positions.indexOf(String(role));
  if (i === 0) return 1;
  if (i > 0) return 0.6;
  return 0.15;
}
const FIT_POINTS = (fit) => (fit >= 1 ? 0 : fit >= 0.5 ? -8 : -30);

/** Malus a rank bassi per eroi difficili (livello 2 alta, 1 media): bracket 1-3 molto forte (-12: un eroe difficile
 *  e' primo solo con un margine netto), 4-5 lieve, da 6 nessuno. */
function difficultyPenalty(level, bracket) {
  if (!level) return 0;
  const table = bracket <= 3 ? [0, -2.5, -12] : bracket <= 5 ? [0, -1, -2.5] : [0, 0, 0];
  return table[level];
}

function heroImageUrlFor(hero) {
  const short = String(hero.name || '').replace('npc_dota_hero_', '');
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${short}.png`;
}

function toIds(list) {
  return (Array.isArray(list) ? list : []).map((x) => Number(x && typeof x === 'object' ? x.heroId : x)).filter((n) => Number.isFinite(n));
}

const MAX_REASONS = 4;
const DEFAULT_ALTERNATIVES = 5;

// Etichette brevi per i testi e oggetti utili per bisogno, dosati per ruolo (indice 0..4 = Pos 1..5; null = nessun oggetto sensato).
const NEED_SHORT = {
  disable: 'controllo', initiation: 'iniziazione', magic: 'danno magico', push: 'push', support: 'cura', tank: 'frontliner',
  detection: 'rilevamento', antiheal: 'anti-cura', aoe: 'danno ad area', magicres: 'resistenza magica', manaburn: 'mana burn',
};
// Nomi brevi da giocatore; tests/items.test.js li riporta ai nomi ufficiali di items-reference.json (Liquipedia)
// e controlla che esistano nel negozio e non siano rimossi.
const NEED_ITEMS = {
  detection: ['Dust', 'Dust', 'Dust', 'Dust, Sentry, Gem', 'Dust, Sentry, Gem'],
  antiheal: ['Spirit Vessel, Eye of Skadi', 'Spirit Vessel, Eye of Skadi', 'Spirit Vessel, Eye of Skadi', "Spirit Vessel, Shiva's Guard", "Spirit Vessel, Shiva's Guard"],
  magicres: ['BKB, Mage Slayer', 'BKB, Mage Slayer', 'BKB, Pipe of Insight', 'Glimmer Cape, Pipe of Insight', 'Glimmer Cape, Pipe of Insight'],
  support: [null, null, 'Mekansm, Guardian Greaves', 'Mekansm, Holy Locket, Guardian Greaves', 'Mekansm, Holy Locket, Guardian Greaves'],
  initiation: [null, 'Blink Dagger', 'Blink Dagger', 'Blink Dagger', 'Force Staff'],
  disable: ['Abyssal Blade', "Eul's Scepter", 'Abyssal Blade, Rod of Atos', "Rod of Atos, Eul's Scepter", "Rod of Atos, Eul's Scepter"],
  // Necronomicon risulta tra gli oggetti rimossi: per il push restano Mjollnir e Helm of the Dominator
  push: ['Mjollnir, Helm of the Dominator', 'Helm of the Dominator', 'Helm of the Dominator', null, null],
  tank: [null, null, 'Crimson Guard, Heart of Tarrasque', 'Crimson Guard, Pipe of Insight', 'Crimson Guard, Pipe of Insight'],
  magic: [null, 'Kaya, Veil of Discord', 'Veil of Discord', 'Veil of Discord, Aether Lens', 'Veil of Discord, Aether Lens'],
  aoe: ['Battle Fury, Radiance', 'Radiance', 'Radiance, Battle Fury', null, null],
  manaburn: ['Diffusal Blade', null, 'Diffusal Blade', null, null],
};
function itemsFor(key, role) {
  const t = NEED_ITEMS[key];
  return t ? (t[(role || 3) - 1] || null) : null;
}
// peso di una lacuna nel jolly generalizzato (il push manca quasi sempre: pesa poco)
const NEED_WEIGHT = { push: 0.5, magicres: 1.5, detection: 1.5, antiheal: 1.5, aoe: 1.5, manaburn: 1.5 };

/** Un eroe 'copre' un bisogno se ha il tag/la risposta con valore >= 2. */
function coversNeed(heroId, key) {
  if (NEEDS.some((n) => n.key === key)) return (tagsOf(heroId)[key] || 0) >= 2;
  return (mechOf(heroId)[key] || 0) >= 2;
}
function inRole(heroId, role) {
  return !role || tagsOf(heroId).positions.includes(String(role));
}
const FIX_MAX_GAP = 4;

/** fix per un bisogno Mancante/Scarso: miglior eroe del ruolo che lo copre (anche se gia' nel top 3) + oggetti + frase. */
function buildFix(key, picks, role, shown = 3) {
  const top = picks[0];
  const items = itemsFor(key, role);
  const cand = picks.find((c) => coversNeed(c.heroId, key) && inRole(c.heroId, role) && top.expectedWinrate - c.expectedWinrate <= FIX_MAX_GAP);
  const itemsText = items ? ` Oggetti: ${items}.` : '';
  if (!cand) {
    return { hero: null, items, text: items ? `Nessun eroe adatto al tuo ruolo senza perdere troppo winrate.${itemsText}` : 'Nessuna soluzione semplice nel tuo ruolo: cercatela con un compagno.' };
  }
  const gap = Math.max(0, Math.round((top.expectedWinrate - cand.expectedWinrate) * 10) / 10);
  const inTop = picks.indexOf(cand) < shown;
  const where = inTop ? 'lo copre ed è già tra i consigli' : gap >= 0.1 ? `lo copre nel tuo ruolo (-${pc(gap)} punti)` : 'lo copre nel tuo ruolo (nessun calo di winrate)';
  return {
    hero: { heroId: cand.heroId, name: cand.name, img: cand.img, expectedWinrate: cand.expectedWinrate, winrateGap: gap },
    items,
    text: `${cand.name} ${where}.${itemsText}`,
  };
}

// Jolly: solo per questi bisogni. Etichetta breve, oggetti alternativi e soglie di minaccia (sopra quelle del bisogno).
const WILDCARD = {
  detection: { short: 'rilevamento', items: 'Dust, Sentry, Gem', minThreat: 2, strong: 3, threat: 'invis' },
  antiheal: { short: 'anti-cura', items: "Spirit Vessel, Shiva's Guard", minThreat: 7, strong: 9, threat: 'heal' },
  magicres: { short: 'resistenza magica', items: 'BKB, Pipe', minThreat: 9, strong: 12, threat: 'magic' },
};
const WILDCARD_MAX_GAP = 2.5;

// Tetto di calo winrate per il jolly generalizzato. Spec iniziale: 3 (4 con 3+ lacune); tenuto a 2,5 come il ramo singolo
// (parere tattico + audit R8). Alzare qui per consentire jolly piu' costosi.
const GEN_GAP = 2.5, GEN_GAP_MULTI = 2.5;
const COUNT_WORDS = { 2: 'entrambe', 3: 'tutte e tre', 4: 'tutte e quattro', 5: 'tutte e cinque' };

/**
 * Jolly generalizzato: se il top 3 non copre nessuna lacuna Mancante, l'eroe del ruolo (fuori dal top 3) che ne copre
 * di piu' (almeno 2, peso totale >= 2), con calo di winrate atteso <= 3 (<= 4 se copre 3+ lacune o peso >= 3).
 */
function generalWildcard(picks, teamNeeds, allies, role, shown = 3) {
  if (allies.length < 2) return null; // con pochi alleati le lacune non sono significative
  const lacune = teamNeeds.filter((n) => n.note === 'Mancante');
  if (lacune.length < 2) return null;
  const top3 = picks.slice(0, shown); // suggerimenti mostrati (top + alternative)
  if (lacune.some((n) => top3.some((p) => coversNeed(p.heroId, n.key)))) return null;
  let best = null;
  for (const c of picks.slice(shown)) {
    if (!inRole(c.heroId, role)) continue;
    const cov = lacune.filter((n) => coversNeed(c.heroId, n.key));
    if (cov.length < 2) continue;
    const weight = cov.reduce((a, n) => a + (NEED_WEIGHT[n.key] || 1), 0);
    if (weight < 2) continue;
    const gap = top3[0].expectedWinrate - c.expectedWinrate;
    if (gap > (cov.length >= 3 || weight >= 3 ? GEN_GAP_MULTI : GEN_GAP)) continue;
    if (!best || weight > best.weight) best = { c, cov, weight, gap };
  }
  if (!best) return null;
  const gap = Math.max(0, Math.round(best.gap * 10) / 10);
  const names = best.cov.map((n) => NEED_SHORT[n.key] || n.label.toLowerCase());
  const list = names.length === 2 ? names.join(' e ') : names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1];
  const tail = gap >= 0.1 ? `con ${pc(gap)} punti di winrate in meno` : 'senza perdere winrate atteso';
  return {
    heroId: best.c.heroId, name: best.c.name, img: best.c.img, needKey: best.cov[0].key, needLabel: best.cov[0].label,
    needKeys: best.cov.map((n) => n.key), needLabels: best.cov.map((n) => n.label),
    expectedWinrate: best.c.expectedWinrate, winrateGap: gap, items: null,
    text: `Se vuoi coprire ${list}: ${best.c.name} ${names.length === 2 ? 'le copre entrambe' : `le copre ${COUNT_WORDS[names.length] || 'tutte'}`}, ${tail}.`,
    teamOnly: false,
  };
}

/**
 * Jolly: un eroe (fuori dal top 3) che risolve un problema specifico della draft con un calo di winrate atteso
 * contenuto, oppure, se nessun eroe adatto esiste, un avviso 'alla squadra serve X'. Un solo jolly. Vedi README.
 */
function buildWildcard(picks, teamNeeds, enemies, allies, role, shown = 3) {
  if (picks.length <= shown) return null;
  const top3 = picks.slice(0, shown); // suggerimenti mostrati: il jolly e' fuori da questi e scatta solo se nessuno copre
  const threats = enemyThreats(enemies);
  const roleStr = role ? String(role) : null;
  let best = null;
  let teamOnly = null;
  for (const key of Object.keys(WILDCARD)) {
    const w = WILDCARD[key];
    const need = teamNeeds.find((n) => n.key === key);
    if (!need || need.note !== 'Mancante') continue;
    if (threats[w.threat].value < w.minThreat) continue;
    if (top3.some((p) => (mechOf(p.heroId)[key] || 0) >= 2)) continue; // il top 3 copre gia'
    const naturalOnly = key === 'detection' && roleStr && roleStr !== '4' && roleStr !== '5';
    const viable = picks.slice(shown).filter((c) => {
      if ((mechOf(c.heroId)[key] || 0) < 2) return false;
      const pos = tagsOf(c.heroId).positions;
      if (roleStr && !pos.includes(roleStr)) return false; // mai fuori ruolo
      if (naturalOnly && pos[0] !== roleStr) return false; // rilevamento: ruoli 1-3 solo eroe naturale
      return top3[0].expectedWinrate - c.expectedWinrate <= WILDCARD_MAX_GAP;
    });
    if (viable.length) {
      const c = viable[0]; // picks e' ordinato per score
      if (!best || c.score > best.c.score) best = { key, w, c };
    } else if (!teamOnly && threats[w.threat].value >= w.strong) {
      teamOnly = { key, w };
    }
  }
  if (best) {
    const gap = Math.max(0, Math.round((top3[0].expectedWinrate - best.c.expectedWinrate) * 10) / 10);
    const tail = gap >= 0.1 ? `ma ha ${pc(gap)} punti di winrate in meno` : 'con un winrate atteso simile al primo consiglio';
    return {
      heroId: best.c.heroId, name: best.c.name, img: best.c.img, needKey: best.key,
      needLabel: (teamNeeds.find((n) => n.key === best.key) || {}).label, expectedWinrate: best.c.expectedWinrate,
      needKeys: [best.key], needLabels: [(teamNeeds.find((n) => n.key === best.key) || {}).label],
      winrateGap: gap, items: best.w.items,
      text: `Se ti serve ${best.w.short}: ${best.c.name} risolve il problema, ${tail}. In alternativa: ${best.w.items}.`,
      teamOnly: false,
    };
  }
  const gen = generalWildcard(picks, teamNeeds, allies, role, shown);
  if (gen) return gen;
  if (teamOnly) {
    const { key, w } = teamOnly;
    const text = allies.length >= 4
      ? `Alla squadra serve ${w.short}: copritelo con ${w.items}`
      : `Alla squadra serve ${w.short}: lo può coprire un compagno o con ${w.items}`;
    const label = (teamNeeds.find((n) => n.key === key) || {}).label;
    return { heroId: null, needKey: key, needLabel: label, needKeys: [key], needLabels: [label], teamOnly: true, items: w.items, text };
  }
  return null;
}

/**
 * Modello: logit(p) = logit(winrate base del bracket) + sum(delta matchup vs ogni nemico)
 *                    + sum(delta sinergia con ogni alleato)   (ognuno con shrinkage per partite).
 * Il winrate atteso p e' il cuore del punteggio (50 + (p-0.5)*400); fit di ruolo, bisogni, meccaniche, meta, pro,
 * difficolta' e balance.js sono modificatori additivi in punti. Score finale clampato a 0..100.
 */
function suggest(input = {}, opts = {}) {
  ensureLoaded();
  const allies = toIds(input.allies);
  const enemies = toIds(input.enemies);
  const role = input.role == null ? null : Number(input.role);
  if (role !== null && !(role >= 1 && role <= 5)) throw new Error('role deve essere 1..5');
  const bracket = input.rankTier != null ? bracketFromRankTier(input.rankTier) : store.bracket;
  const bracketName = BRACKET_NAMES[bracket - 1];
  // numero di alternative mostrate (default 5 => top + 5 = 6 suggerimenti)
  const altN = opts.alternatives == null ? DEFAULT_ALTERNATIVES : Math.max(0, Math.floor(Number(opts.alternatives)));
  // count: quanti candidati ordinati esporre in `candidates` (controllo ban del controller); assente => nessun campo
  const countN = opts.count == null ? null : Math.max(0, Math.floor(Number(opts.count)) || 0);
  // excluded: bannati / non disponibili / incerti. Mai proposti in nessun elenco dell'output (top, alternatives, candidates, fix, wildcard, all).
  const excluded = new Set(toIds(input.excluded));
  const taken = new Set([...allies, ...enemies]);
  const teamNeeds = computeNeeds(allies, enemies);
  const baseNeeds = teamNeeds.filter((n) => NEEDS.some((x) => x.key === n.key)).map((n) => ({ ...n, gap: 1 - n.level }));
  const mechNeeds = teamNeeds.filter((n) => MECH_NEEDS.some((x) => x.key === n.key)).map((n) => ({ ...n, gap: 1 - n.level }));
  const sumGap = baseNeeds.reduce((a, g) => a + g.gap, 0);

  let pool = store.heroes.filter((h) => !taken.has(h.id) && !excluded.has(h.id));
  const fitting = pool.filter((h) => roleFit(tagsOf(h.id), role) >= 0.5);
  if (fitting.length >= 1 + altN) pool = fitting;
  // pool vuoto (tutti scelti/esclusi): nessuna eccezione, top null + message (vedi README)

  const needWeightFactor = clamp(allies.length / 4, 0.15, 1);
  const meta = metaTable();
  const enemyNames = new Map(enemies.filter((e) => store.byId.has(e)).map((e) => [e, store.byId.get(e).localized_name]));

  const picks = pool.map((h) => {
    const tags = tagsOf(h.id);
    const mech = mechOf(h.id);
    const { wr } = heroWinrate(h.id, bracket);

    // counter (log-odds)
    const deltas = [];
    let counterLogit = 0;
    for (const e of enemies) {
      const c = counterInfo(h.id, e, bracket);
      if (c) { deltas.push({ enemy: e, delta: c.delta }); counterLogit += c.logit * COUNTER_SCALE; }
    }
    const avgDelta = deltas.length ? deltas.reduce((a, x) => a + x.delta, 0) / deltas.length : 0;
    const counter = clamp(50 + avgDelta * 800, 0, 100);

    // sinergia (log-odds)
    const pairs = allies.filter((a) => store.byId.has(a)).map((a) => ({ ally: a, ...pairSynergy(h.id, a, bracket) }));
    const synScore = pairs.length ? pairs.reduce((a, p) => a + p.score, 0) / pairs.length : 0.5;
    const synLogit = pairs.reduce((a, p) => a + p.logit, 0);

    // winrate atteso in questa draft
    const pExp = clamp(sigmoid(BASE_SHRINK * logit(clamp(wr, 0.2, 0.8)) + MAX_SHIFT * Math.tanh((counterLogit + synLogit) / MAX_SHIFT)), 0.3, 0.75);

    // modificatori (punti)
    const fit = roleFit(tags, role);
    const fitPts = role ? FIT_POINTS(fit) : 0;
    const covers = [];
    let needRaw = 0;
    for (const g of baseNeeds) {
      const v = (tags[g.key] || 0) / 3;
      needRaw += g.gap * v;
      if (g.level < 0.5 && (tags[g.key] || 0) >= 2) covers.push(g);
    }
    const needPts = sumGap > 0 ? 8 * clamp(needRaw / 1.2, 0, 1) * needWeightFactor : 0;
    const mechCovers = [];
    let mechPts = 0;
    for (const g of mechNeeds) {
      const resp = clamp((mech[g.key] || 0) / 2, 0, 1);
      if (resp > 0 && g.gap > 0) { mechPts += 6 * g.gap * resp; if (g.gap >= 0.5 && resp >= 1) mechCovers.push(g); }
    }
    mechPts = Math.min(mechPts, 10);
    const m = meta.get(h.id) || { score: null, pro: null, growth: null, recentWr: null };
    const metaPts = m.score === null ? 0 : (m.score - 0.5) * 6;
    const proPts = m.pro === null ? 0 : (m.pro - 0.3) * 3;
    const diffPts = difficultyPenalty(getDifficulty(h), bracket);
    const balPts = (balance.adjustmentFor(h.localized_name) || {}).points || 0;

    const core = clamp(50 + (pExp - 0.5) * 400, 0, 100);
    const score = Math.round(clamp(core + fitPts + needPts + mechPts + metaPts + proPts + diffPts + balPts, 0, 100) * 10) / 10;

    return {
      heroId: h.id,
      name: h.localized_name,
      img: heroImageUrlFor(h),
      score,
      winrate: Math.round(wr * 1000) / 10,
      expectedWinrate: Math.round(pExp * 1000) / 10,
      counter: Math.round(counter),
      synergy: Math.round(synScore * 100),
      reasons: [],
      covers: covers.map((c) => c.key).concat(mechCovers.map((c) => c.key)),
      _d: { tags, deltas, pairs, covers, needPts, mechCovers, mechPts, metaPts, proPts, diffPts, balPts, m, fit, pExp, wr, counterLogit, synLogit },
    };
  });

  picks.sort((a, b) => b.score - a.score);
  const shown = Math.min(1 + altN, picks.length);
  const withReasons = Math.min(Math.max(shown, countN || 0), picks.length);

  // reasons solo per top e alternative: winrate atteso sempre in testa, poi le piu' rilevanti per impatto (max MAX_REASONS)
  for (const p of picks.slice(0, withReasons)) {
    const d = p._d;
    const wrBase = d.wr * 100;
    const head = (allies.length || enemies.length)
      ? `Winrate atteso in questa draft: ${pc(d.pExp * 100)}% (base ${pc(wrBase)}%, rank ${bracketName})`
      : `Winrate ${pc(wrBase)}% al rank ${bracketName}`;
    const cand = []; // { text, impact (punti di punteggio), forced }
    if (role) cand.push({ text: d.tags.positions[0] === String(role) ? `Eroe naturale per la Pos ${role}` : `Giocabile come Pos ${role}`, impact: d.fit >= 1 ? 0.3 : 0.2 });
    const sorted = d.deltas.slice().sort((a, b) => b.delta - a.delta);
    for (const x of sorted.filter((y) => y.delta >= 0.015).slice(0, 2)) {
      cand.push({ text: `Contrasta ${enemyNames.get(x.enemy)} (+${pc(x.delta * 100)}% winrate nel matchup)`, impact: x.delta * 400 });
    }
    const worst = sorted[sorted.length - 1];
    if (worst && worst.delta <= -0.02) cand.push({ text: `Attenzione: soffre contro ${enemyNames.get(worst.enemy)} (${pc(worst.delta * 100)}%)`, impact: -worst.delta * 400 });
    if (enemies.length && !d.deltas.length) cand.push({ text: 'Matchup non ancora disponibili: counter stimato neutro', impact: 0.1 });
    if (d.covers.length && allies.length) {
      cand.push({ text: `Copre ciò che manca alla squadra: ${d.covers.map((c) => c.label.toLowerCase()).join(', ')}`, impact: d.needPts });
    }
    for (const g of d.mechCovers) {
      cand.push({ text: `Risponde a una minaccia nemica (${g.label.toLowerCase()}): ${g.threat.slice(0, 3).join(', ')}`, impact: d.mechPts });
    }
    const bestPair = d.pairs.filter((q) => q.note).sort((a, b) => b.logit - a.logit)[0];
    if (bestPair && bestPair.logit > 0.01) cand.push({ text: bestPair.note, impact: bestPair.logit * 100 });
    else if (bestPair && bestPair.score >= 0.6) cand.push({ text: bestPair.note, impact: (bestPair.score - 0.5) * 20 });
    if (d.m.growth !== null && d.m.growth >= 0.05) cand.push({ text: `In crescita nell'ultima settimana (pick +${(d.m.growth * 100).toFixed(0)}% rispetto alla tendenza generale)`, impact: Math.abs(d.metaPts) });
    else if (d.m.growth !== null && d.m.growth <= -0.08) cand.push({ text: `In calo nell'ultima settimana (pick ${(d.m.growth * 100).toFixed(0)}% rispetto alla tendenza generale)`, impact: Math.abs(d.metaPts) });
    if (d.m.recentWr !== null && d.m.recentWr >= 0.525) cand.push({ text: `Winrate recente alto: ${pc(d.m.recentWr * 100)}% negli ultimi giorni`, impact: Math.abs(d.metaPts) });
    if (d.m.pro !== null && d.m.pro >= 0.85) cand.push({ text: 'Alta popolarità competitiva (spesso pickato o bannato dai pro)', impact: Math.abs(d.proPts) });
    const forced = [];
    const br = balance.reasonFor(p.name);
    if (br) forced.push({ text: br, impact: Math.abs(d.balPts), forced: true });
    if (d.diffPts <= -2.5) forced.push({ text: 'Eroe complesso: rischioso a questo rank', impact: Math.abs(d.diffPts), forced: true });
    cand.sort((a, b) => b.impact - a.impact);
    const rest = MAX_REASONS - 1 - forced.length;
    const chosen = forced.concat(cand.slice(0, Math.max(0, rest))).sort((a, b) => b.impact - a.impact);
    p.reasons = [head, ...chosen.map((c) => c.text)];
  }
  for (const n of teamNeeds) {
    if (n.note === 'Mancante' || n.note === 'Scarso') n.fix = buildFix(n.key, picks, role, shown);
  }
  const wildcard = buildWildcard(picks, teamNeeds, enemies, allies, role, shown);
  for (const p of picks) {
    if (!p.reasons.length) p.reasons = [`Winrate ${pc(p._d.wr * 100)}% al rank ${bracketName}`];
    delete p._d;
  }
  const out = { top: picks[0] || null, alternatives: picks.slice(1, shown), teamNeeds, wildcard };
  if (!picks.length) out.message = 'Nessun eroe disponibile da suggerire: tutti gli eroi sono già scelti, bannati o esclusi.';
  if (countN !== null) out.candidates = picks.slice(0, countN);
  if (opts.includeAll) out.all = picks;
  return out;
}

module.exports = { counterInfo, heroWinrate, mechOf, enemyThreats, BASE_SHRINK, buildFix, itemsFor, buildWildcard, suggest, dropPartial, metaTable, computeNeeds, pairSynergy, counterDelta, heroImageUrlFor, tagsOf, BRACKET_NAMES, difficultyPenalty };







