'use strict';
/**
 * Caricamento dati OpenDota con cache su disco.
 * Stato condiviso del modulo: `store` (heroes, byId, matchups, bracket, source).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = 'https://api.opendota.com/api';
const TTL_CORE_MS = 12 * 3600 * 1000;      // heroes + heroStats
const TTL_MATCHUP_MS = 24 * 3600 * 1000;   // matchups per eroe
const SAMPLE_PATH = path.join(__dirname, 'sample-data.json');

const store = {
  loaded: false,
  source: null,        // 'network' | 'cache' | 'stale-cache' | 'sample'
  bracket: 4,
  heroes: [],          // [{id,name,localized_name,primary_attr,attack_type,roles,img,...}]
  byId: new Map(),
  stats: new Map(),    // id -> heroStats record
  matchups: new Map(), // id -> Map(otherId -> {games, wins})   wins = vittorie di id contro other
  cacheDir: null,
  fetchImpl: null,
  matchupJob: null,
  stratz: { token: null, data: new Map(), lastError: null, queryTemplate: null, extraArgs: '' },
};

/** rankTier OpenDota (es. 54 = Crusader 4) -> bracket 1..8 di heroStats (Herald..Divine; Immortal=8). */
function bracketFromRankTier(rankTier) {
  const n = Number(rankTier);
  if (!Number.isFinite(n) || n <= 0) return 4;
  return Math.min(8, Math.max(1, Math.floor(n / 10)));
}

function defaultCacheDir() {
  return process.env.DOTA_PICKER_CACHE || path.join(os.homedir(), '.dota-picker-cache');
}

function readCache(file, ttl, allowStale) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const age = Date.now() - raw.t;
    if (allowStale || age < ttl) return { data: raw.d, fresh: age < ttl };
  } catch (_) { /* assente o corrotto */ }
  return null;
}

function writeCache(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ t: Date.now(), d: data }));
    fs.renameSync(tmp, file);
  } catch (_) { /* cache best-effort */ }
}

async function getJson(url, timeoutMs = 15000) {
  const f = store.fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('fetch non disponibile (serve Node >= 18)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function applyCore(heroes, heroStats) {
  const statsById = new Map(heroStats.map((s) => [s.id, s]));
  const base = heroes && heroes.length ? heroes : heroStats;
  store.heroes = base.map((h) => {
    const s = statsById.get(h.id) || {};
    return {
      id: h.id,
      name: h.name || s.name,
      localized_name: h.localized_name || s.localized_name,
      primary_attr: h.primary_attr || s.primary_attr,
      attack_type: h.attack_type || s.attack_type,
      roles: h.roles || s.roles || [],
    };
  });
  store.byId = new Map(store.heroes.map((h) => [h.id, h]));
  store.stats = statsById;
}

function applyMatchups(id, list) {
  const m = new Map();
  for (const r of list || []) m.set(r.hero_id, { games: r.games_played, wins: r.wins });
  store.matchups.set(id, m);
}

function loadSample() {
  const s = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
  applyCore(s.heroes, s.heroStats);
  store.matchups = new Map();
  for (const [id, list] of Object.entries(s.matchups || {})) applyMatchups(Number(id), list);
  store.source = 'sample';
}

/** Scarica (o legge dalla cache) i matchups di un eroe. Non lancia mai: ritorna true se disponibile. */
async function fetchMatchups(id, opts = {}) {
  if (store.matchups.has(id) && !opts.force) return true;
  const file = path.join(store.cacheDir, 'matchups', `${id}.json`);
  const cached = readCache(file, TTL_MATCHUP_MS, false);
  if (cached) { applyMatchups(id, cached.data); return true; }
  if (store.source === 'sample') return false;
  try {
    const list = await getJson(`${API}/heroes/${id}/matchups`);
    writeCache(file, list);
    applyMatchups(id, list);
    return true;
  } catch (_) {
    const stale = readCache(file, TTL_MATCHUP_MS, true);
    if (stale) { applyMatchups(id, stale.data); return true; }
    return false;
  }
}

/** Prefetch in background con concorrenza bassa (rate limit OpenDota). */
function prefetchAllMatchups(concurrency = 3) {
  if (store.matchupJob) return store.matchupJob;
  const ids = store.heroes.map((h) => h.id).filter((id) => !store.matchups.has(id));
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      await fetchMatchups(id);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  store.matchupJob = Promise.all(Array.from({ length: concurrency }, worker))
    .then(() => { store.matchupJob = null; return store.matchups.size; });
  return store.matchupJob;
}

/**
 * loadData({ rankTier, cacheDir, offline, matchups:'lazy'|'all'|'none', fetch })
 *  - offline:true -> usa solo sample-data.json (nessuna rete, nessuna cache)
 *  - matchups: 'lazy' (default) avvia il prefetch in background; 'all' lo attende; 'none' non lo fa
 * Fallback: rete -> cache scaduta -> sample-data.json. Ritorna un riepilogo.
 */
async function loadData(opts = {}) {
  store.bracket = bracketFromRankTier(opts.rankTier);
  store.cacheDir = opts.cacheDir || store.cacheDir || defaultCacheDir();
  store.fetchImpl = opts.fetch || null;
  const mode = opts.matchups || 'lazy';
  store.matchups = new Map();
  store.matchupJob = null;

  if (opts.offline) {
    loadSample();
  } else {
    const heroesFile = path.join(store.cacheDir, 'heroes.json');
    const statsFile = path.join(store.cacheDir, 'heroStats.json');
    const cH = readCache(heroesFile, TTL_CORE_MS, false);
    const cS = readCache(statsFile, TTL_CORE_MS, false);
    try {
      if (cH && cS) {
        applyCore(cH.data, cS.data);
        store.source = 'cache';
      } else {
        const [heroes, stats] = await Promise.all([
          getJson(`${API}/heroes`).catch(() => null),
          getJson(`${API}/heroStats`),
        ]);
        if (!Array.isArray(stats) || !stats.length) throw new Error('heroStats vuoto');
        if (heroes) writeCache(heroesFile, heroes);
        writeCache(statsFile, stats);
        applyCore(heroes, stats);
        store.source = 'network';
      }
    } catch (err) {
      const sH = readCache(heroesFile, TTL_CORE_MS, true);
      const sS = readCache(statsFile, TTL_CORE_MS, true);
      if (sS) { applyCore(sH && sH.data, sS.data); store.source = 'stale-cache'; }
      else { loadSample(); store.loadError = String(err && err.message || err); }
    }
  }

  store.loaded = true;
  configureStratz(opts);
  if (store.source !== 'sample') {
    // matchups gia' in cache su disco: caricali subito (veloce), il resto in background/attesa
    for (const h of store.heroes) {
      const c = readCache(path.join(store.cacheDir, 'matchups', `${h.id}.json`), TTL_MATCHUP_MS, false);
      if (c) applyMatchups(h.id, c.data);
    }
    if (mode === 'all') await prefetchAllMatchups();
    else if (mode === 'lazy') prefetchAllMatchups().catch(() => {});
  }
  return {
    source: store.source,
    heroes: store.heroes.length,
    bracket: store.bracket,
    matchups: store.matchups.size,
    stratz: !!store.stratz.token,
    warning: store.loadError,
  };
}

/**
 * Provider opzionale STRATZ. Token da opts.stratzToken, da opts.stratzConfigFile (JSON {token, query?, extraArgs?})
 * o da env STRATZ_TOKEN. Il token resta solo in memoria: mai scritto in cache/log/errori.
 */
function configureStratz(opts) {
  const z = store.stratz;
  z.token = null; z.data = new Map(); z.lastError = null; z.queryTemplate = null; z.extraArgs = '';
  let cfg = {};
  if (opts.stratzConfigFile) {
    try { cfg = JSON.parse(fs.readFileSync(opts.stratzConfigFile, 'utf8')) || {}; }
    catch (_) { z.lastError = 'file di config STRATZ non leggibile'; }
  }
  z.token = opts.stratzToken || cfg.token || process.env.STRATZ_TOKEN || null;
  z.queryTemplate = cfg.query || null;
  z.extraArgs = cfg.extraArgs || '';
  if (opts.offline) z.token = opts.stratzToken || null; // test offline: niente token implicito dall'ambiente
}

// Bracket OpenDota (1..8) -> BracketBasicEnum STRATZ. NON VERIFICATO sulla documentazione ufficiale.
const STRATZ_BRACKETS = ['HERALD_GUARDIAN', 'HERALD_GUARDIAN', 'CRUSADER_ARCHON', 'CRUSADER_ARCHON', 'LEGEND_ANCIENT', 'LEGEND_ANCIENT', 'DIVINE_IMMORTAL', 'DIVINE_IMMORTAL'];
const STRATZ_DEFAULT_QUERY =
  'query { heroStats { matchUp(heroId: {{heroId}}, bracketBasicIds: [{{bracket}}]{{extraArgs}}) { heroId with { heroId2 matchCount winCount } vs { heroId2 matchCount winCount } } } }';

/** Cerca ricorsivamente un oggetto con array `with` e `vs` (tollera piccole variazioni di forma). */
function findMatchUp(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node.with) || Array.isArray(node.vs)) return node;
  for (const v of Object.values(node)) {
    const r = findMatchUp(v);
    if (r) return r;
  }
  return null;
}

function parseStratzList(list) {
  const m = new Map();
  for (const r of list || []) {
    const id = r.heroId2 != null ? r.heroId2 : r.heroId;
    const games = r.matchCount != null ? r.matchCount : r.games;
    const wins = r.winCount != null ? r.winCount : r.wins;
    if (Number.isFinite(id) && Number.isFinite(games) && Number.isFinite(wins)) m.set(id, { games, wins });
  }
  return m;
}

async function fetchStratzHero(id, bracket) {
  const z = store.stratz;
  const key = `${bracket}:${id}`;
  if (z.data.has(key)) return true;
  
  const file = path.join(store.cacheDir, 'stratz', `${bracket}_${id}.json`);
  const cached = readCache(file, TTL_MATCHUP_MS, false);
  const apply = (d) => z.data.set(key, { with: parseStratzList(d.with), vs: parseStratzList(d.vs) });
  if (cached) { apply(cached.data); return true; }
  try {
    const tpl = z.queryTemplate || STRATZ_DEFAULT_QUERY;
    const query = tpl.replace(/{{heroId}}/g, String(id)).replace(/{{bracket}}/g, STRATZ_BRACKETS[bracket - 1])
      .replace(/{{extraArgs}}/g, z.extraArgs ? ', ' + z.extraArgs : '');
    const f = store.fetchImpl || globalThis.fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let body;
    try {
      const res = await f('https://api.stratz.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${z.token}` },
        body: JSON.stringify({ query }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } finally { clearTimeout(timer); }
    if (body && body.errors && body.errors.length) throw new Error('errori GraphQL: ' + String(body.errors[0].message || '').slice(0, 120));
    const mu = findMatchUp(body && body.data);
    if (!mu) throw new Error('risposta senza with/vs');
    writeCache(file, { with: mu.with || [], vs: mu.vs || [] });
    apply(mu);
    z.lastError = null;
    return true;
  } catch (err) {
    z.lastError = 'STRATZ: ' + String(err && err.message || err).replace(/Bearer\s+\S+/g, 'Bearer ***');
    return false;
  }
}

/**
 * Se il token STRATZ e' configurato scarica sinergia 'with' (alleati) e counter 'vs' (nemici) per il bracket del rank.
 * Senza token non fa nulla (resta l'euristica). Non lancia mai. Ritorna quanti eroi sono disponibili.
 */
async function ensureStratz(heroIds, rankTier) {
  ensureLoaded();
  if (!store.stratz.token) return 0;
  const bracket = rankTier != null ? bracketFromRankTier(rankTier) : store.bracket;
  const r = await Promise.all([...new Set(heroIds || [])].map((id) => fetchStratzHero(Number(id), bracket)));
  return r.filter(Boolean).length;
}

function getProviderInfo() {
  return { stratz: !!store.stratz.token, stratzLoaded: store.stratz.data.size, lastError: store.stratz.lastError };
}

function ensureLoaded() {
  if (!store.loaded) {
    throw new Error('Dati engine non caricati: chiamare prima await loadData({ rankTier }).');
  }
}

/** Garantisce i matchups dei dati eroi indicati (es. i nemici appena scelti). */
async function ensureMatchups(heroIds) {
  ensureLoaded();
  const res = await Promise.all((heroIds || []).map((id) => fetchMatchups(id)));
  return res.filter(Boolean).length;
}

function setBracket(rankTier) { store.bracket = bracketFromRankTier(rankTier); }

module.exports = { store, loadData, ensureLoaded, ensureMatchups, ensureStratz, getProviderInfo, STRATZ_DEFAULT_QUERY, bracketFromRankTier, setBracket, loadSample, SAMPLE_PATH };


