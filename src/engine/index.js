'use strict';
/**
 * Motore di suggerimento pick Dota 2 (CommonJS, zero dipendenze).
 * API: loadData, suggest, heroImageUrl (+ ensureMatchups, isLoaded, getHeroes).
 * Vedi README.md.
 */
const data = require('./data');
const scoring = require('./scoring');

const { store } = data;
let sampleCache = null;

/** URL immagine eroe sul CDN Valve. Usa i dati caricati, altrimenti i nomi di sample-data.json. */
function heroImageUrl(heroId) {
  const id = Number(heroId);
  let hero = store.byId.get(id);
  if (!hero) {
    if (!sampleCache) {
      try { sampleCache = new Map(require('./sample-data.json').heroes.map((h) => [h.id, h])); }
      catch (_) { sampleCache = new Map(); }
    }
    hero = sampleCache.get(id);
  }
  return hero ? scoring.heroImageUrlFor(hero) : null;
}

/** Nome localizzato (utile ad app-dev/renderer per allies/enemies); null se sconosciuto. */
function heroName(heroId) {
  const h = store.byId.get(Number(heroId));
  return h ? h.localized_name : null;
}

module.exports = {
  loadData: data.loadData,
  suggest: scoring.suggest,
  heroImageUrl,
  heroName,
  ensureMatchups: data.ensureMatchups,
  estimateMatch: (input) => require('./match').estimateMatch(input),
  ensureStratz: data.ensureStratz,
  getProviderInfo: data.getProviderInfo,
  getBalanceInfo: () => require('./balance').getBalanceInfo(store.heroes),
  isLoaded: () => store.loaded,
  getHeroes: () => store.heroes.map((h) => ({ id: h.id, heroId: h.id, name: h.localized_name, img: heroImageUrl(h.id) })),
};


