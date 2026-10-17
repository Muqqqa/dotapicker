'use strict';
// rank_tier OpenDota: decine = medaglia (1 Herald..8 Immortal), unita' = stelle (1..5).

function tierToLinear(t) {
  if (!Number.isFinite(t) || t <= 0) return null;
  const medal = Math.floor(t / 10);
  const stars = Math.min(5, Math.max(1, t % 10 || 1));
  return (medal - 1) * 5 + (stars - 1);
}

function linearToTier(x) {
  const r = Math.round(x);
  const medal = Math.min(8, Math.floor(r / 5) + 1);
  const stars = medal >= 8 ? 0 : (r % 5) + 1;
  return medal * 10 + stars;
}

/** Media tra rank utente e avversari. Avversari ignoti -> rank utente. */
function lobbyRankTier(userTier, enemyTiers) {
  const u = tierToLinear(userTier);
  if (u == null) return null;
  const e = (enemyTiers || []).map(tierToLinear).filter((x) => x != null);
  if (!e.length) return linearToTier(u);
  const eAvg = e.reduce((a, b) => a + b, 0) / e.length;
  return linearToTier((u + eAvg) / 2);
}

module.exports = { tierToLinear, linearToTier, lobbyRankTier };
