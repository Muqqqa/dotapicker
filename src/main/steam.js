'use strict';
const STEAM64_BASE = 76561197960265728n;

/** Accetta SteamID64 o account_id (stringa/numero). Ritorna account_id numerico o null. */
function toAccountId(input) {
  const s = String(input == null ? '' : input).trim();
  // consente anche url profilo /profiles/7656...
  const m = s.match(/(\d{5,20})/);
  if (!m) return null;
  try {
    const n = BigInt(m[1]);
    if (n >= STEAM64_BASE) return Number(n - STEAM64_BASE);
    if (n > 0n && n < 4294967296n) return Number(n);
  } catch (e) { /* ignore */ }
  return null;
}

module.exports = { toAccountId, STEAM64_BASE };
