'use strict';
/**
 * Aggiustamenti di bilanciamento (dati statici, facili da aggiornare).
 *
 * Come aggiornare: modifica ENTRIES -> [nome localizzato OpenDota, livello, tema].
 *  - livello: una chiave di LEVELS (punti sul punteggio finale 0-100)
 *  - tema: cosa e' cambiato, in italiano, senza citare numeri di versione ne' date
 * Il nome viene risolto sui dati caricati (localized_name); i nomi non trovati finiscono in getBalanceInfo().missing.
 *
 * Nota: i winrate OpenDota/STRATZ possono riflettere in parte il periodo precedente all'ultimo
 * aggiornamento, quindi l'aggiustamento e' volutamente piccolo (max +-4 su 100).
 */
const LEVELS = {
  nerfStrong: -4,
  nerfMed: -2.5,
  nerfLight: -1.5,
  buffStrong: 3,
  buffMed: 2,
  buffLight: 1,
  itemLight: -0.5, // eroi core che dipendono da oggetti ridimensionati: malus minimo, senza reason
};
const MAX_ABS = 4;

const ENTRIES = [
  // NERF forti
  ['Shadow Fiend', 'nerfStrong', 'Necromastery e bonus di Shadowraze ridotti'],
  ['Necrophos', 'nerfStrong', 'Sadist e Ghost Shroud ridotti'],
  ['Treant Protector', 'nerfStrong', "intelligenza base, Leech Seed e Nature's Guise ridotti"],
  ['Bounty Hunter', 'nerfStrong', 'oro di Track molto inferiore'],
  // NERF medi
  ['Keeper of the Light', 'nerfMed', 'abilità ridimensionate'],
  ['Lina', 'nerfMed', 'intelligenza, velocità d\'attacco e durata di Fiery Soul ridotte'],
  ['Invoker', 'nerfMed', 'Cold Snap con ricarica maggiore e Ghost Walk ridimensionato'],
  ['Lifestealer', 'nerfMed', 'Rage con ricarica maggiore, scettro e talento ridotti'],
  ['Winter Wyvern', 'nerfMed', 'Arctic Burn con ricarica maggiore e Cold Embrace meno efficace'],
  ['Spectre', 'nerfMed', 'Desolate con crescita inferiore'],
  ['Mirana', 'nerfMed', 'Sacred Arrow e Moonlight Quiver ridimensionati'],
  ['Slardar', 'nerfMed', 'rigenerazione e Crush ridotti'],
  ['Enigma', 'nerfMed', 'Eidolon, Black Hole con scettro e talento ridimensionati'],
  ['Earth Spirit', 'nerfMed', 'velocità d\'attacco e cariche delle pietre ridimensionate'],
  // NERF lievi
  ['Bane', 'nerfLight', 'armatura base ridotta'],
  ['Centaur Warrunner', 'nerfLight', 'danno e velocità di movimento ridotti'],
  ['Clockwerk', 'nerfLight', 'Power Cogs più costoso e knockback ridotto'],
  ['Ember Spirit', 'nerfLight', 'agilità ridotta'],
  ['Hoodwink', 'nerfLight', 'forza ridotta'],
  ['Io', 'nerfLight', 'talento di Spirits ridotto'],
  ['Kez', 'nerfLight', 'danno ridotto'],
  ['Lone Druid', 'nerfLight', 'durata di Entangle ridimensionata'],
  ['Undying', 'nerfLight', 'rigenerazione ridotta e Decay più costoso'],
  ['Huskar', 'mixed', 'forza base ridotta ma crescita migliorata'], // misto: -0.5, sotto soglia reason
  // BUFF
  ['Anti-Mage', 'buffMed', 'Mana Break potenziato'],
  ['Ursa', 'buffMed', 'Maul potenziato'],
  ['Chen', 'buffLight', 'forza per livello e rinascita di Zealot migliorate'],
  ['Broodmother', 'buffLight', 'Insatiable Hunger meno costoso'],
  ['Batrider', 'buffLight', 'intelligenza per livello aumentata'],
  ['Disruptor', 'buffLight', 'intelligenza aumentata'],
  ['Mars', 'buffLight', 'armatura migliorata'],
  ['Warlock', 'buffLight', 'velocità d\'attacco aumentata'],
  // Misti senza aggiustamento (documentati): Largo, Marci, Underlord
];
LEVELS.mixed = -0.5;

// Oggetti ridimensionati o più costosi: leggero malus ai core che ne dipendono (esclusi gli eroi gia' sopra).
const ITEM_DEPENDENT = [
  'Slark', 'Riki', 'Weaver', 'Clinkz',                 // Silver Edge
  'Terrorblade', 'Naga Siren', 'Morphling', 'Juggernaut', // Manta Style
  'Luna', 'Razor',                                     // Mjollnir
  'Phantom Assassin', 'Troll Warlord', 'Sniper',       // Daedalus
  'Wraith King', 'Tiny', 'Dragon Knight',              // Heart of Tarrasque
  'Death Prophet', 'Puck',                             // Shiva's Guard / Octarine Core
];

const byName = new Map();
for (const [name, level, theme] of ENTRIES) byName.set(name, { level, points: LEVELS[level], theme });
for (const name of ITEM_DEPENDENT) {
  if (!byName.has(name)) byName.set(name, { level: 'itemLight', points: LEVELS.itemLight, theme: 'oggetti chiave ridimensionati' });
}
for (const v of byName.values()) {
  if (Math.abs(v.points) > MAX_ABS) throw new Error('balance: aggiustamento oltre il limite');
}

let enabled = true;
/** Solo per test: disattiva/riattiva gli aggiustamenti. */
function setEnabled(v) { enabled = !!v; }

/** Aggiustamento in punti (su 100) per un eroe dato il suo localized_name; 0 se assente. */
function adjustmentFor(localizedName) {
  if (!enabled) return null;
  return byName.get(localizedName) || null;
}

/** Reason in italiano (senza versioni/date) o null se l'effetto e' trascurabile (< 1 punto). */
function reasonFor(localizedName) {
  const a = adjustmentFor(localizedName);
  if (!a || Math.abs(a.points) < 1) return null;
  if (a.level === 'itemLight') return null;
  return a.points < 0
    ? `Indebolito dall'ultimo aggiornamento: ${localizedName}, ${a.theme}`
    : `Rinforzato dall'ultimo aggiornamento: ${localizedName}, ${a.theme}`;
}

/** Quali nomi della tabella sono stati risolti nei dati caricati e quali no. */
function getBalanceInfo(heroes) {
  const names = new Set((heroes || []).map((h) => h.localized_name));
  const all = [...byName.keys()];
  return { found: all.filter((n) => names.has(n)), missing: all.filter((n) => !names.has(n)) };
}

module.exports = { LEVELS, MAX_ABS, ENTRIES, adjustmentFor, reasonFor, getBalanceInfo, setEnabled };

