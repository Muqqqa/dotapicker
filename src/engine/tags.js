'use strict';
/**
 * Dataset statico di tag per eroe (curato a mano, approssimativo, patch-agnostico).
 * Formato: heroId -> [disable, iniziazione, magico, push, sostegno, bersaglio, posizioni]
 *   - i primi 6 valori sono interi 0..3 (0 = assente, 3 = eccellente)
 *   - posizioni: stringa di cifre 1-5, la prima e' la posizione primaria
 * Gli eroi non presenti vengono derivati dai ruoli OpenDota (vedi deriveTags).
 */

const NEEDS = [
  { key: 'disable', label: 'Controllo (disable)', target: 5 },
  { key: 'initiation', label: 'Iniziazione', target: 3 },
  { key: 'magic', label: 'Danno magico', target: 4 },
  { key: 'push', label: 'Push', target: 3 },
  { key: 'support', label: 'Cura / sostegno', target: 3 },
  { key: 'tank', label: 'Bersaglio (frontliner)', target: 3 },
];

const TAG_ORDER = ['disable', 'initiation', 'magic', 'push', 'support', 'tank'];

const RAW = {
  1: [0, 0, 0, 0, 0, 0, '1'],
  2: [2, 3, 0, 0, 0, 3, '3'],
  3: [3, 1, 1, 0, 0, 1, '45'],
  4: [1, 1, 0, 0, 0, 0, '13'],
  5: [2, 0, 2, 0, 1, 0, '5'],
  6: [1, 0, 0, 2, 0, 0, '1'],
  7: [3, 3, 1, 0, 0, 1, '4'],
  8: [0, 0, 0, 2, 2, 1, '1'],
  9: [2, 1, 0, 0, 0, 0, '4'],
  10: [1, 0, 0, 0, 0, 1, '1'],
  11: [0, 0, 2, 0, 0, 0, '2'],
  14: [3, 2, 1, 0, 0, 2, '4'],
  16: [3, 3, 2, 0, 0, 1, '3'],
  17: [1, 1, 2, 0, 0, 0, '2'],
  18: [2, 1, 0, 0, 0, 2, '1'],
  19: [2, 2, 1, 1, 0, 1, '2'],
  20: [3, 2, 0, 0, 1, 0, '5'],
  21: [2, 0, 1, 0, 0, 0, '2'],
  22: [0, 0, 3, 0, 0, 0, '2'],
  23: [2, 2, 1, 0, 0, 2, '3'],
  25: [2, 0, 3, 0, 0, 0, '2'],
  26: [3, 2, 3, 0, 0, 0, '4'],
  27: [3, 0, 1, 3, 0, 0, '5'],
  29: [2, 3, 0, 0, 0, 3, '3'],
  30: [2, 0, 2, 0, 2, 0, '5'],
  31: [0, 0, 2, 0, 1, 0, '5'],
  33: [3, 3, 1, 3, 0, 1, '3'],
  34: [0, 0, 3, 2, 0, 0, '2'],
  35: [0, 0, 0, 0, 0, 0, '1'],
  36: [0, 0, 2, 0, 2, 2, '3'],
  39: [0, 0, 3, 0, 0, 0, '2'],
  41: [3, 3, 0, 0, 0, 0, '1'],
  42: [2, 1, 0, 0, 1, 3, '1'],
  43: [0, 0, 2, 3, 0, 0, '2'],
  44: [0, 0, 0, 0, 0, 0, '1'],
  45: [0, 0, 3, 3, 0, 0, '4'],
  46: [0, 0, 0, 0, 0, 0, '1'],
  47: [1, 0, 1, 0, 0, 2, '3'],
  48: [0, 0, 2, 2, 0, 0, '1'],
  49: [1, 1, 0, 2, 0, 3, '3'],
  50: [0, 0, 1, 0, 3, 0, '5'],
  51: [3, 3, 1, 0, 0, 2, '4'],
  53: [0, 0, 1, 3, 0, 0, '4'],
  54: [0, 0, 0, 0, 0, 2, '1'],
  57: [0, 0, 1, 0, 3, 2, '5'],
  62: [1, 0, 0, 0, 0, 0, '4'],
  65: [2, 3, 1, 0, 0, 0, '3'],
  66: [0, 0, 0, 3, 3, 0, '5'],
  68: [1, 0, 3, 0, 0, 0, '5'],
  69: [2, 1, 1, 0, 0, 2, '3'],
  71: [2, 3, 0, 0, 0, 2, '3'],
  75: [2, 1, 2, 0, 0, 0, '4'],
  84: [2, 1, 2, 0, 1, 2, '5'],
  86: [2, 0, 2, 0, 0, 0, '4'],
  87: [3, 1, 2, 0, 0, 0, '4'],
  89: [2, 0, 0, 3, 0, 0, '1'],
  91: [0, 0, 1, 0, 3, 0, '5'],
  96: [2, 3, 0, 0, 0, 3, '3'],
  98: [0, 0, 3, 0, 0, 2, '3'],
  100: [2, 2, 0, 0, 0, 0, '4'],
  101: [1, 0, 3, 0, 0, 0, '4'],
  102: [0, 0, 0, 0, 3, 2, '5'],
  105: [1, 0, 2, 1, 0, 0, '4'],
  112: [1, 0, 2, 0, 2, 0, '5'],
  114: [1, 1, 0, 0, 0, 0, '1'],
  129: [3, 3, 0, 0, 0, 3, '3'],
  135: [0, 0, 1, 0, 2, 2, '3'],
  137: [2, 3, 0, 0, 0, 3, '3'],
};

/**
 * Posizioni curate per NOME localizzato OpenDota (robuste a id nuovi). Hanno priorita' su RAW e sulla
 * derivazione dai ruoli. Prima cifra = posizione primaria. Copre quasi tutto il roster; gli eroi nuovi non
 * elencati ricadono su derivePositions (piu' restrittiva).
 */
const POS_BY_NAME = {
  'Abaddon': '5', 'Alchemist': '1', 'Ancient Apparition': '5', 'Anti-Mage': '1', 'Arc Warden': '12', 'Axe': '3',
  'Bane': '54', 'Batrider': '3', 'Beastmaster': '3', 'Bloodseeker': '13', 'Bounty Hunter': '4', 'Brewmaster': '3',
  'Bristleback': '3', 'Broodmother': '23', 'Centaur Warrunner': '3', 'Chaos Knight': '13', 'Chen': '5', 'Clinkz': '1',
  'Clockwerk': '4', 'Crystal Maiden': '5', 'Dark Seer': '3', 'Dark Willow': '45', 'Dawnbreaker': '3', 'Dazzle': '5',
  'Death Prophet': '2', 'Disruptor': '4', 'Doom': '3', 'Dragon Knight': '3', 'Drow Ranger': '1', 'Earth Spirit': '4',
  'Earthshaker': '4', 'Elder Titan': '45', 'Ember Spirit': '2', 'Enchantress': '45', 'Enigma': '3', 'Faceless Void': '1',
  'Grimstroke': '54', 'Gyrocopter': '1', 'Hoodwink': '4', 'Huskar': '2', 'Invoker': '2', 'Io': '5', 'Jakiro': '54',
  'Juggernaut': '1', 'Keeper of the Light': '54', 'Kez': '1', 'Kunkka': '3', 'Largo': '45', 'Legion Commander': '3',
  'Leshrac': '2', 'Lich': '5', 'Lifestealer': '1', 'Lina': '2', 'Lion': '4', 'Lone Druid': '2', 'Luna': '1',
  'Lycan': '3', 'Magnus': '3', 'Marci': '4', 'Mars': '3', 'Medusa': '1', 'Meepo': '12', 'Mirana': '4',
  'Monkey King': '1', 'Morphling': '1', 'Muerta': '1', 'Naga Siren': '1', 'Necrophos': '3', "Nature's Prophet": '4',
  'Night Stalker': '3', 'Nyx Assassin': '4', 'Ogre Magi': '5', 'Omniknight': '5', 'Oracle': '5', 'Outworld Destroyer': '2',
  'Pangolier': '3', 'Phantom Assassin': '1', 'Phantom Lancer': '1', 'Phoenix': '4', 'Primal Beast': '3', 'Puck': '2',
  'Pudge': '4', 'Pugna': '4', 'Queen of Pain': '2', 'Razor': '3', 'Riki': '1', 'Ringmaster': '45', 'Rubick': '4',
  'Sand King': '3', 'Shadow Demon': '54', 'Shadow Fiend': '2', 'Shadow Shaman': '5', 'Silencer': '5', 'Skywrath Mage': '4',
  'Slardar': '3', 'Slark': '1', 'Snapfire': '45', 'Sniper': '1', 'Spectre': '1', 'Spirit Breaker': '4', 'Storm Spirit': '2',
  'Sven': '1', 'Techies': '5', 'Templar Assassin': '1', 'Terrorblade': '1', 'Tidehunter': '3', 'Timbersaw': '3',
  'Tinker': '2', 'Tiny': '2', 'Treant Protector': '5', 'Troll Warlord': '1', 'Tusk': '4', 'Undying': '5',
  'Ursa': '1', 'Vengeful Spirit': '5', 'Venomancer': '4', 'Viper': '3', 'Visage': '34', 'Void Spirit': '2',
  'Warlock': '5', 'Weaver': '1', 'Windranger': '2', 'Winter Wyvern': '5', 'Witch Doctor': '5', 'Wraith King': '1',
  'Zeus': '2', 'Underlord': '3', 'Spectre ': '1',
};


/**
 * Meccaniche per eroe, per NOME localizzato OpenDota (valori 0..3; curati a mano da meccaniche di gioco note,
 * senza contare oggetti come Dust/Gem/Sentry). Minacce (lato nemico): invis, illusions, heal, manadep.
 * Risposte (lato alleato): detection, antiheal, aoe, magicres, manaburn. 'magic' (burst magico) e' gia' in RAW.
 */
const MECH_THREATS = {
  invis: {
    Riki: 3, 'Bounty Hunter': 3, Clinkz: 3, 'Nyx Assassin': 3, Weaver: 3, Mirana: 2, Invoker: 1, 'Treant Protector': 2,
    Slark: 2, Broodmother: 2, 'Templar Assassin': 1, 'Sand King': 0,
  },
  illusions: {
    'Phantom Lancer': 3, 'Naga Siren': 3, 'Chaos Knight': 3, Terrorblade: 3, Spectre: 2, Meepo: 2, 'Arc Warden': 2,
    'Monkey King': 1, 'Dark Seer': 1, 'Phantom Assassin': 0,
  },
  heal: {
    Huskar: 2, Alchemist: 2, Necrophos: 3, Dazzle: 3, Oracle: 3, Omniknight: 3, Io: 3, Chen: 3, Juggernaut: 2,
    Enchantress: 2, Abaddon: 3, 'Winter Wyvern': 2, 'Witch Doctor': 2, 'Treant Protector': 2, Lifestealer: 2, 'Wraith King': 1,
    Slark: 1, Venomancer: 0,
  },
  manadep: {
    Invoker: 3, 'Storm Spirit': 3, Tinker: 3, 'Outworld Destroyer': 3, 'Keeper of the Light': 3, Leshrac: 2, Lina: 2, Zeus: 2,
    'Skywrath Mage': 2, Puck: 2, Pugna: 2, 'Queen of Pain': 2, 'Death Prophet': 2, Lion: 2, Rubick: 2, 'Crystal Maiden': 2,
    Enigma: 1, 'Ancient Apparition': 1, Techies: 1, Medusa: 2,
  },
};
const MECH_ANSWERS = {
  // rilevamento (true sight / rivela invisibili senza oggetti)
  detection: { Slardar: 3, 'Bounty Hunter': 3, Zeus: 2, Bloodseeker: 1 },
  // anti-cura: blocca rigenerazione/cure (verificato con certezza solo per Ancient Apparition; Necrophos parziale)
  antiheal: { 'Ancient Apparition': 3, Necrophos: 1 },
  // danno ad area / cleave: risposta alle illusioni
  aoe: {
    Axe: 3, Sven: 3, Kunkka: 2, Tidehunter: 3, Earthshaker: 3, 'Sand King': 3, Leshrac: 3, Gyrocopter: 3, Razor: 3,
    Bristleback: 3, 'Crystal Maiden': 3, Jakiro: 3, Timbersaw: 3, Venomancer: 3, Omniknight: 3, Underlord: 3, 'Dark Seer': 3,
    Techies: 3, Magnus: 2, Lina: 2, 'Death Prophet': 2, 'Dragon Knight': 2, Luna: 2, Enigma: 2, Warlock: 2, Phoenix: 2,
    'Shadow Shaman': 2, Alchemist: 2, 'Winter Wyvern': 2, Lich: 2, 'Centaur Warrunner': 2, Invoker: 2, Sniper: 2,
    'Legion Commander': 2, Tiny: 2, Pugna: 2, 'Shadow Fiend': 2,
  },
  // resistenza magica / immunita' (BKB-like intrinseca o forte riduzione): niente Pugna (Decrepify amplifica il danno magico)
  magicres: { 'Anti-Mage': 3, Juggernaut: 3, Lifestealer: 3, Abaddon: 2, Tidehunter: 1, Slark: 1, Huskar: 0 },
  // mana burn / drain
  manaburn: { 'Anti-Mage': 3, 'Nyx Assassin': 3, Lion: 2, Silencer: 1, 'Outworld Destroyer': 1 },
};

const MECH_NEEDS = [
  { key: 'detection', label: 'Rilevamento invisibili', threat: 'invis', minThreat: 2, target: 2 },
  { key: 'aoe', label: 'Danno ad area contro illusioni', threat: 'illusions', minThreat: 2, target: 3 },
  { key: 'antiheal', label: 'Anti-cura', threat: 'heal', minThreat: 5, target: 2 },
  { key: 'magicres', label: 'Resistenza magica', threat: 'magic', minThreat: 6, target: 2 },
  { key: 'manaburn', label: 'Mana burn contro eroi dipendenti dal mana', threat: 'manadep', minThreat: 7, target: 2 },
];

/** Difficolta' per nome: 2 = alta, 1 = media, 0/assente = normale. Criteri: micro intensiva o forte dipendenza da
 *  gestione di piu' unita'/timing/mappa; l'effetto e' un malus a rank bassi (vedi scoring.js). */
const DIFFICULTY = {
  Meepo: 2, Invoker: 2, Chen: 2, Io: 2, Techies: 2, Visage: 2, 'Arc Warden': 2, 'Earth Spirit': 2, Morphling: 2, Tinker: 2,
  Rubick: 2, 'Lone Druid': 2, Puck: 2, Oracle: 2, 'Storm Spirit': 2, Kez: 2, 'Ember Spirit': 2, Broodmother: 2,
  Phoenix: 1, 'Templar Assassin': 1, Timbersaw: 1, Pangolier: 1, "Nature's Prophet": 1, Enigma: 1, 'Dark Willow': 1,
  'Elder Titan': 1, 'Winter Wyvern': 1, 'Keeper of the Light': 1, 'Shadow Demon': 1, Ringmaster: 1, Hoodwink: 1, Largo: 1,
  Pudge: 1, Tusk: 1, Mirana: 1, Windranger: 1, 'Monkey King': 1, 'Void Spirit': 1, Marci: 1, 'Primal Beast': 1,
  Dawnbreaker: 1, Snapfire: 1, Weaver: 1, Leshrac: 1, 'Dark Seer': 1, Beastmaster: 1, 'Nyx Assassin': 1, Batrider: 1,
  Clockwerk: 1, 'Spirit Breaker': 1, 'Faceless Void': 1, 'Phantom Lancer': 1, 'Naga Siren': 1, Lina: 0,
};

function getMech(hero) {
  const n = hero.localized_name;
  return {
    invis: MECH_THREATS.invis[n] || 0, illusions: MECH_THREATS.illusions[n] || 0, heal: MECH_THREATS.heal[n] || 0,
    manadep: MECH_THREATS.manadep[n] || 0,
    detection: MECH_ANSWERS.detection[n] || 0, antiheal: MECH_ANSWERS.antiheal[n] || 0, aoe: MECH_ANSWERS.aoe[n] || 0,
    magicres: MECH_ANSWERS.magicres[n] || 0, manaburn: MECH_ANSWERS.manaburn[n] || 0,
  };
}
function getDifficulty(hero) { return DIFFICULTY[hero.localized_name] || 0; }

/** Coppie di eroi con sinergie note (usate come bonus nelle reasons). */
const KNOWN_SYNERGIES = [
  [33, 41, 'Black Hole + Chronosphere: combo di controllo ad area'],
  [26, 22, 'Burst combinato di Lion e Zeus per eliminare i bersagli'],
  [29, 23, 'Ravage + Ghostship: iniziazione ad area devastante'],
];

/** Eroi dell'euristica per posizione da ruoli OpenDota, usato per eroi non nel dataset. */
function derivePositions(hero) {
  const roles = hero.roles || [];
  const has = (r) => roles.includes(r);
  const out = [];
  // Pos 1 solo per veri carry: ruolo Carry E attributo agi/str (gli int "Carry" di OpenDota sono quasi sempre mid/utility)
  if (has('Carry') && (hero.primary_attr === 'agi' || hero.primary_attr === 'str') && !has('Support') && !has('Initiator')) out.push('1');
  if ((has('Nuker') || has('Carry')) && hero.primary_attr !== 'str' && !has('Support')) out.push('2');
  if (has('Durable') || has('Initiator')) out.push('3');
  if (has('Support')) out.push('4', '5');
  if (!out.length) out.push('2', '3');
  return [...new Set(out)].join('');
}

function deriveTags(hero) {
  const roles = hero.roles || [];
  const has = (r) => roles.includes(r);
  // eroi con molti ruoli OpenDota (>4) sono 'tuttofare': i loro tag derivati valgono meno
  const w = roles.length <= 4 ? 2 : 1;
  return {
    disable: has('Disabler') ? w : 0,
    initiation: has('Initiator') ? w : 0,
    magic: has('Nuker') && hero.primary_attr !== 'agi' ? 2 : has('Nuker') ? 1 : 0,
    push: has('Pusher') ? w : 0,
    support: has('Support') ? 1 : 0,
    tank: has('Durable') ? w : 0,
    positions: derivePositions(hero),
    derived: true,
  };
}

/**
 * Restituisce { disable, initiation, magic, push, support, tank (0..3), positions:'1..5', derived:boolean }.
 * Il dataset statico ha priorita'; i ruoli OpenDota (hero.roles) completano dove manca.
 */
function getTags(hero) {
  const raw = RAW[hero.id];
  let t;
  if (!raw) {
    t = deriveTags(hero);
  } else {
    t = { positions: raw[6], derived: false };
    TAG_ORDER.forEach((k, i) => { t[k] = raw[i]; });
  }
  const byName = POS_BY_NAME[hero.localized_name];
  if (byName) t.positions = byName;
  return t;
}

module.exports = { MECH_NEEDS, MECH_THREATS, MECH_ANSWERS, DIFFICULTY, getMech, getDifficulty, POS_BY_NAME, NEEDS, TAG_ORDER, RAW, KNOWN_SYNERGIES, getTags, deriveTags };
