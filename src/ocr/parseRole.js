'use strict';
// Parsing puro del testo OCR del ruolo -> posizione 1..5 (o null).
// Supporta italiano e inglese, tollera errori tipici dell'OCR.

function normalize(text) {
  return String(text == null ? '' : text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[|_\-]+/g, ' ')
    .replace(/[^a-z0-9 \n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pattern ordinati: i piu' specifici per primi (hard/soft support prima di "support").
const RULES = [
  { role: 5, re: /\b(hard|hrd|harc|hord)\s*(support|supp|supporto|sup)\b|\b(support|supporto)\s*hard\b|\bsupporto\s*(forte|duro)\b/ },
  { role: 4, re: /\b(soft|sof|saft)\s*(support|supp|supporto|sup)\b|\b(support|supporto)\s*soft\b|\bsupporto\s*(leggero|debole)\b/ },
  { role: 3, re: /\boff\s*lane\b|\boff\s*laner\b|\boffl[a-z]{2,4}\b|\bcorsia\s*difficile\b|\blane\s*difficile\b|\bdifficile\b/ },
  { role: 2, re: /\bmid(dle)?(\s*lane)?\b|\bcentrale\b|\bcorsia\s*centrale\b|\bcentro\b/ },
  { role: 1, re: /\bcarry\b|\bcarri\b|\bsafe\s*lane\b|\bsafelane\b|\bsafe\b|\bcorsia\s*sicura\b|\blane\s*sicura\b|\bsicura\b/ },
];

const POS_RE = /\b(?:pos|position|posizione|posiz)\s*\.?\s*([1-5])\b/;

/**
 * @param {string} text testo OCR grezzo
 * @returns {1|2|3|4|5|null}
 */
function parseRole(text) {
  const t = normalize(text);
  if (!t) return null;
  const pm = t.match(POS_RE);
  if (pm) return Number(pm[1]);
  for (const r of RULES) {
    if (r.re.test(t)) return r.role;
  }
  return null;
}

/** Ruolo piu' frequente tra piu' letture (stabilizza l'OCR). */
function majorityRole(list) {
  const c = {};
  for (const r of list) if (r) c[r] = (c[r] || 0) + 1;
  let best = null, n = 0;
  for (const k of Object.keys(c)) if (c[k] > n) { best = Number(k); n = c[k]; }
  return best;
}

module.exports = { parseRole, normalize, majorityRole };
