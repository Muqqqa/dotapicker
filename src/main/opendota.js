'use strict';
const { toAccountId } = require('./steam');

const BASE = 'https://api.opendota.com/api';

async function getJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Ritorna rank_tier (number) oppure null se il profilo non ha rank / e' privato. Lancia su errore di rete. */
async function fetchRankTier(steamIdInput) {
  const id = toAccountId(steamIdInput);
  if (id == null) throw new Error('Steam ID non valido');
  const p = await getJson(`${BASE}/players/${id}`);
  const rt = p && p.rank_tier;
  return Number.isFinite(rt) && rt > 0 ? rt : null;
}

/**
 * Profilo OpenDota: { rankTier:number|null, personaname:string|null }.
 * personaname serve a trovare il proprio slot nella barra del draft. Lancia su errore di rete.
 */
async function fetchProfile(steamIdInput) {
  const id = toAccountId(steamIdInput);
  if (id == null) throw new Error('Steam ID non valido');
  const p = await getJson(`${BASE}/players/${id}`);
  const rt = p && p.rank_tier;
  const prof = (p && p.profile) || {};
  const name = typeof prof.personaname === 'string' ? prof.personaname.trim() : '';
  return { rankTier: Number.isFinite(rt) && rt > 0 ? rt : null, personaname: name || null };
}

async function fetchHeroes() {
  return getJson(`${BASE}/heroes`);
}

module.exports = { fetchRankTier, fetchProfile, fetchHeroes, getJson };
