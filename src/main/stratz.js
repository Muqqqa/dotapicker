'use strict';
// Chiave STRATZ personale: cifrata con Electron safeStorage in userData (mai in chiaro, mai nei log/State).
const fs = require('fs');
const path = require('path');

const FILE = 'stratz.key';
const TEST_QUERY = 'query { heroStats { matchUp(heroId: 1, bracketBasicIds: [CRUSADER_ARCHON]) { heroId with { heroId2 matchCount winCount } vs { heroId2 matchCount winCount } } } }';

function redact(msg, token) {
  let s = String(msg == null ? '' : msg);
  if (token) s = s.split(token).join('***');
  return s.replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 160);
}

class StratzKey {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, FILE);
    this.safe = safeStorage;
  }

  available() {
    try { return !!(this.safe && this.safe.isEncryptionAvailable()); } catch (e) { return false; }
  }

  /** Token salvato (decifrato) o null. */
  load() {
    try {
      if (!this.available() || !fs.existsSync(this.file)) return null;
      const buf = Buffer.from(fs.readFileSync(this.file, 'utf8'), 'base64');
      return this.safe.decryptString(buf) || null;
    } catch (e) { return null; }
  }

  /** @returns {{ok:boolean, error?:string}} stringa vuota = rimuove. */
  save(token) {
    const t = String(token == null ? '' : token).trim();
    if (!t) {
      try { fs.rmSync(this.file, { force: true }); } catch (e) { /* ignore */ }
      return { ok: true };
    }
    if (/\s/.test(t) || t.length < 8 || t.length > 4096) return { ok: false, error: 'Chiave STRATZ non valida' };
    if (!this.available()) {
      return { ok: false, error: 'Cifratura del sistema non disponibile: la chiave non viene salvata per non tenerla in chiaro' };
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, this.safe.encryptString(t).toString('base64'), 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Salvataggio non riuscito' };
    }
  }
}

/** Richiesta di prova. Ritorna {ok, error} (error mai con il token). */
async function probe(token, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await f('https://api.stratz.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: TEST_QUERY }),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Chiave rifiutata da STRATZ (HTTP ' + res.status + ')' };
    if (!res.ok) return { ok: false, error: 'STRATZ: HTTP ' + res.status };
    const body = await res.json();
    if (body && body.errors && body.errors.length) {
      return { ok: false, error: 'STRATZ: ' + redact(body.errors[0].message, token) };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: 'STRATZ non raggiungibile: ' + redact(e && e.message, token) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { StratzKey, probe, redact };
