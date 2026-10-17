'use strict';
/**
 * Genera src/engine/sample-data.json (dati ESEMPIO, non reali, struttura OpenDota).
 * Uso: node src/engine/tools/gen-sample.js
 * Deterministico: stesso output a ogni esecuzione.
 */
const fs = require('fs');
const path = require('path');

// [id, name(internal), localized, primary_attr, attack_type, roles]
const H = [
  [1, 'antimage', 'Anti-Mage', 'agi', 'Melee', 'Carry,Escape,Nuker'],
  [2, 'axe', 'Axe', 'str', 'Melee', 'Initiator,Durable,Disabler,Jungler'],
  [3, 'bane', 'Bane', 'all', 'Ranged', 'Support,Disabler,Nuker,Durable'],
  [4, 'bloodseeker', 'Bloodseeker', 'agi', 'Melee', 'Carry,Disabler,Jungler,Nuker,Initiator'],
  [5, 'crystal_maiden', 'Crystal Maiden', 'int', 'Ranged', 'Support,Disabler,Nuker,Jungler'],
  [6, 'drow_ranger', 'Drow Ranger', 'agi', 'Ranged', 'Carry,Disabler,Pusher'],
  [7, 'earthshaker', 'Earthshaker', 'str', 'Melee', 'Support,Initiator,Disabler,Nuker'],
  [8, 'juggernaut', 'Juggernaut', 'agi', 'Melee', 'Carry,Pusher,Escape,Nuker'],
  [9, 'mirana', 'Mirana', 'agi', 'Ranged', 'Carry,Support,Escape,Nuker,Disabler'],
  [10, 'morphling', 'Morphling', 'agi', 'Ranged', 'Carry,Escape,Durable,Nuker,Disabler'],
  [11, 'nevermore', 'Shadow Fiend', 'agi', 'Ranged', 'Carry,Nuker'],
  [14, 'pudge', 'Pudge', 'str', 'Melee', 'Disabler,Initiator,Durable,Nuker'],
  [16, 'sand_king', 'Sand King', 'str', 'Melee', 'Initiator,Disabler,Support,Nuker,Escape,Jungler'],
  [17, 'storm_spirit', 'Storm Spirit', 'int', 'Ranged', 'Carry,Escape,Nuker,Initiator,Disabler'],
  [18, 'sven', 'Sven', 'str', 'Melee', 'Carry,Disabler,Initiator,Durable,Nuker,Escape'],
  [19, 'tiny', 'Tiny', 'str', 'Melee', 'Carry,Nuker,Pusher,Initiator,Durable,Disabler'],
  [20, 'vengefulspirit', 'Vengeful Spirit', 'all', 'Ranged', 'Support,Initiator,Disabler,Nuker,Escape'],
  [21, 'windrunner', 'Windranger', 'all', 'Ranged', 'Carry,Support,Disabler,Escape,Nuker'],
  [22, 'zuus', 'Zeus', 'int', 'Ranged', 'Nuker'],
  [23, 'kunkka', 'Kunkka', 'str', 'Melee', 'Carry,Support,Disabler,Initiator,Durable,Nuker'],
  [25, 'lina', 'Lina', 'int', 'Ranged', 'Support,Carry,Nuker,Disabler'],
  [26, 'lion', 'Lion', 'int', 'Ranged', 'Support,Disabler,Nuker,Initiator'],
  [27, 'shadow_shaman', 'Shadow Shaman', 'int', 'Ranged', 'Support,Pusher,Disabler,Nuker'],
  [29, 'tidehunter', 'Tidehunter', 'str', 'Melee', 'Initiator,Durable,Disabler,Nuker'],
  [30, 'witch_doctor', 'Witch Doctor', 'int', 'Ranged', 'Support,Nuker,Disabler'],
  [31, 'lich', 'Lich', 'int', 'Ranged', 'Support,Nuker'],
  [33, 'enigma', 'Enigma', 'all', 'Ranged', 'Disabler,Jungler,Initiator,Pusher'],
  [34, 'tinker', 'Tinker', 'int', 'Ranged', 'Carry,Nuker,Pusher'],
  [35, 'sniper', 'Sniper', 'agi', 'Ranged', 'Carry,Nuker'],
  [36, 'necrolyte', 'Necrophos', 'int', 'Ranged', 'Carry,Support,Durable,Nuker,Disabler'],
  [39, 'queenofpain', 'Queen of Pain', 'int', 'Ranged', 'Carry,Nuker,Escape'],
  [41, 'faceless_void', 'Faceless Void', 'agi', 'Melee', 'Carry,Initiator,Disabler,Escape,Durable'],
  [42, 'skeleton_king', 'Wraith King', 'str', 'Melee', 'Carry,Support,Durable,Disabler,Initiator'],
  [43, 'death_prophet', 'Death Prophet', 'int', 'Ranged', 'Carry,Pusher,Nuker,Disabler'],
  [44, 'phantom_assassin', 'Phantom Assassin', 'agi', 'Melee', 'Carry,Escape'],
  [45, 'pugna', 'Pugna', 'int', 'Ranged', 'Nuker,Pusher'],
  [46, 'templar_assassin', 'Templar Assassin', 'agi', 'Ranged', 'Carry,Escape'],
  [47, 'viper', 'Viper', 'agi', 'Ranged', 'Carry,Durable,Initiator,Disabler'],
  [48, 'luna', 'Luna', 'agi', 'Ranged', 'Carry,Nuker,Pusher'],
  [49, 'dragon_knight', 'Dragon Knight', 'str', 'Melee', 'Carry,Pusher,Durable,Disabler,Initiator,Nuker'],
  [50, 'dazzle', 'Dazzle', 'int', 'Ranged', 'Support,Nuker,Disabler'],
  [51, 'rattletrap', 'Clockwerk', 'str', 'Melee', 'Initiator,Disabler,Durable,Nuker'],
  [53, 'furion', "Nature's Prophet", 'int', 'Ranged', 'Carry,Pusher,Escape,Nuker'],
  [54, 'life_stealer', 'Lifestealer', 'str', 'Melee', 'Carry,Durable,Jungler,Escape,Disabler'],
  [57, 'omniknight', 'Omniknight', 'str', 'Melee', 'Support,Durable,Nuker'],
  [62, 'bounty_hunter', 'Bounty Hunter', 'agi', 'Melee', 'Escape,Nuker'],
  [65, 'batrider', 'Batrider', 'int', 'Ranged', 'Initiator,Jungler,Escape,Disabler,Nuker'],
  [66, 'chen', 'Chen', 'int', 'Ranged', 'Support,Jungler,Pusher'],
  [68, 'ancient_apparition', 'Ancient Apparition', 'int', 'Ranged', 'Support,Disabler,Nuker'],
  [69, 'doom_bringer', 'Doom', 'str', 'Melee', 'Carry,Disabler,Initiator,Durable,Nuker'],
  [71, 'spirit_breaker', 'Spirit Breaker', 'str', 'Melee', 'Carry,Initiator,Disabler,Durable,Escape,Nuker'],
  [75, 'silencer', 'Silencer', 'int', 'Ranged', 'Carry,Support,Disabler,Initiator,Nuker'],
  [84, 'ogre_magi', 'Ogre Magi', 'str', 'Ranged', 'Support,Nuker,Disabler,Durable,Initiator'],
  [86, 'rubick', 'Rubick', 'int', 'Ranged', 'Support,Disabler,Nuker'],
  [87, 'disruptor', 'Disruptor', 'int', 'Ranged', 'Support,Disabler,Nuker,Initiator'],
  [89, 'naga_siren', 'Naga Siren', 'agi', 'Melee', 'Carry,Support,Pusher,Disabler,Initiator,Escape'],
  [91, 'wisp', 'Io', 'all', 'Ranged', 'Support,Jungler,Escape,Nuker'],
  [96, 'centaur', 'Centaur Warrunner', 'str', 'Melee', 'Durable,Initiator,Disabler,Nuker,Escape'],
  [98, 'shredder', 'Timbersaw', 'str', 'Melee', 'Nuker,Durable,Escape'],
  [100, 'tusk', 'Tusk', 'str', 'Melee', 'Initiator,Disabler,Nuker'],
  [101, 'skywrath_mage', 'Skywrath Mage', 'int', 'Ranged', 'Support,Nuker,Disabler'],
  [102, 'abaddon', 'Abaddon', 'all', 'Melee', 'Support,Carry,Durable'],
  [105, 'techies', 'Techies', 'all', 'Ranged', 'Nuker,Disabler'],
  [112, 'winter_wyvern', 'Winter Wyvern', 'all', 'Ranged', 'Support,Disabler,Nuker'],
  [114, 'monkey_king', 'Monkey King', 'agi', 'Melee', 'Carry,Escape,Disabler,Initiator'],
  [129, 'mars', 'Mars', 'str', 'Melee', 'Initiator,Durable,Disabler,Nuker'],
  [135, 'dawnbreaker', 'Dawnbreaker', 'str', 'Melee', 'Carry,Support,Durable,Nuker,Initiator'],
  [137, 'primal_beast', 'Primal Beast', 'str', 'Melee', 'Initiator,Durable,Disabler,Nuker'],
];

// PRNG deterministico
function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const heroes = H.map(([id, name, localized_name, primary_attr, attack_type, roles]) => ({
  id,
  name: 'npc_dota_hero_' + name,
  localized_name,
  primary_attr,
  attack_type,
  roles: roles.split(','),
  legs: 2,
}));

// bracket 1..8: baseline winrate per eroe con deriva lieve tra bracket
const heroStats = heroes.map((h) => {
  const s = {
    ...h,
    img: `/apps/dota2/images/dota_react/heroes/${h.name.replace('npc_dota_hero_', '')}.png`,
    icon: `/apps/dota2/images/dota_react/heroes/icons/${h.name.replace('npc_dota_hero_', '')}.png`,
  };
  const base = 0.47 + hash(h.id, 1) * 0.08; // 0.47 .. 0.55
  const skillSlope = (hash(h.id, 2) - 0.5) * 0.012; // eroi "difficili" migliorano con il rank
  for (let b = 1; b <= 8; b++) {
    const picks = Math.round((2500 + hash(h.id, 10 + b) * 9000) * (b <= 5 ? 1 : 0.6));
    const wr = Math.min(0.62, Math.max(0.42, base + skillSlope * (b - 4)));
    s[`${b}_pick`] = picks;
    s[`${b}_win`] = Math.round(picks * wr);
  }
  // trend ultimi 7 giorni (ultimo = giorno parziale, come nei dati reali)
  const vol = 40000 + hash(h.id, 50) * 80000;
  const grow = (hash(h.id, 51) - 0.5) * 0.3; // crescita relativa nella settimana
  s.pub_pick_trend = []; s.pub_win_trend = [];
  const rwr = Math.min(0.58, Math.max(0.44, base + (hash(h.id, 52) - 0.5) * 0.04));
  for (let d = 0; d < 7; d++) {
    const p = Math.round(vol * (1 + grow * (d / 5 - 0.5)) * (d === 6 ? 0.17 : 1));
    s.pub_pick_trend.push(p);
    s.pub_win_trend.push(Math.round(p * rwr));
  }
  s.pub_pick = s.pub_pick_trend.reduce((a, b) => a + b, 0);
  s.pub_win = s.pub_win_trend.reduce((a, b) => a + b, 0);
  s.pro_pick = Math.round(hash(h.id, 99) * 200);
  s.pro_win = Math.round(s.pro_pick * 0.5);
  s.pro_ban = Math.round(hash(h.id, 98) * 150);
  return s;
});

// matchups: a vs b, antisimmetrici, con alcuni counter noti
const KNOWN = [ // [a, b, vantaggio di a su b]
  [75, 17, 0.04], [26, 17, 0.03], [14, 41, -0.02], [41, 5, 0.035], [44, 5, -0.01],
  [44, 31, 0.0], [1, 22, 0.03], [47, 44, 0.03], [87, 41, -0.03], [29, 44, -0.03],
  [3, 1, 0.03], [5, 1, 0.03], [22, 1, -0.02], [2, 44, -0.03], [96, 44, -0.02],
];
const knownMap = new Map();
for (const [a, b, d] of KNOWN) { knownMap.set(a + ':' + b, d); knownMap.set(b + ':' + a, -d); }

const matchups = {};
for (const a of heroes) {
  matchups[a.id] = [];
  for (const b of heroes) {
    if (a.id === b.id) continue;
    const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
    const sign = a.id === lo ? 1 : -1;
    const games = Math.round(900 + hash(lo, hi) * 2600);
    const adv = (hash(hi, lo) - 0.5) * 0.07 * sign + (knownMap.get(a.id + ':' + b.id) || 0);
    matchups[a.id].push({ hero_id: b.id, games_played: games, wins: Math.round(games * (0.5 + adv)) });
  }
}

const out = {
  _example: true,
  _note: 'DATI DI ESEMPIO generati da tools/gen-sample.js: struttura reale OpenDota (/heroes, /heroStats, /heroes/{id}/matchups) ma numeri inventati. Solo per test offline.',
  heroes,
  heroStats,
  matchups,
};
fs.writeFileSync(path.join(__dirname, '..', 'sample-data.json'), JSON.stringify(out));
console.log('sample-data.json scritto:', heroes.length, 'eroi');

