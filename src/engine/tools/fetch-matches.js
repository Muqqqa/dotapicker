'use strict';
/**
 * Scarica partite pubbliche recenti da OpenDota /publicMatches per la calibrazione di estimateMatch.
 * Salva SOLO: match_id, esito, rank medio, modalita', durata, eroi delle due squadre (nessun dato dei giocatori).
 * Uso: node src/engine/tools/fetch-matches.js <fileOut> [maxRichieste=40] [minUsabili=0]
 * Rispetta il limite di ~1 richiesta al secondo.
 */
const fs = require('fs');

const DRAFT_MODES = new Set([1, 2, 3, 4, 16, 22]); // All Pick, Captains Mode, Random Draft, Single Draft, Captains Draft, Ranked AP
function usable(m) {
  const full = (t) => Array.isArray(t) && t.length === 5 && t.every((h) => h > 0);
  return m && m.lobby_type !== 4 && DRAFT_MODES.has(m.game_mode) && m.duration >= 600 && m.avg_rank_tier > 0
    && full(m.radiant_team) && full(m.dire_team) && typeof m.radiant_win === 'boolean';
}

async function fetchMatches(file, maxRequests = 40, minUsable = 0) {
  let kept = [];
  const seen = new Set();
  if (fs.existsSync(file)) { try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); kept.forEach((m) => seen.add(m.match_id)); } catch (_) { kept = []; } }
  let lessThan = kept.length ? Math.min(...kept.map((m) => m.match_id)) : null;
  let requests = 0, raw = 0;
  while (requests < maxRequests && (!minUsable || kept.length < minUsable)) {
    const url = 'https://api.opendota.com/api/publicMatches' + (lessThan ? `?less_than_match_id=${lessThan}` : '');
    const res = await fetch(url);
    requests++;
    if (!res.ok) { console.log('HTTP', res.status, 'stop'); break; }
    const page = await res.json();
    if (!page.length) break;
    raw += page.length;
    for (const m of page) {
      if (usable(m) && !seen.has(m.match_id)) {
        seen.add(m.match_id);
        kept.push({ match_id: m.match_id, radiant_win: m.radiant_win, avg_rank_tier: m.avg_rank_tier, game_mode: m.game_mode, lobby_type: m.lobby_type, radiant_team: m.radiant_team, dire_team: m.dire_team });
      }
    }
    lessThan = Math.min(...page.map((m) => m.match_id));
    if (requests % 10 === 0) console.log(`richieste ${requests}, partite grezze ${raw}, utilizzabili ${kept.length}`);
    await new Promise((r) => setTimeout(r, 1100));
  }
  fs.writeFileSync(file, JSON.stringify(kept));
  console.log(`fatto: ${requests} richieste, ${raw} partite grezze, ${kept.length} utilizzabili in ${file}`);
  return kept;
}

if (require.main === module) {
  const [file, max, min] = process.argv.slice(2);
  fetchMatches(file, Number(max) || 40, Number(min) || 0).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { fetchMatches, usable };
