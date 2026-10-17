'use strict';
// Banco prova della lettura schermo (solo uso locale, senza Electron e senza dipendenze).
// Avvio: node tools/vision-bench/server.js  ->  http://localhost:5175
// Il browser decodifica lo screenshot (PNG, JPG, WebP...) e manda i pixel RGBA grezzi; qui girano i moduli VERI
// di src/ocr (topbar.js, heroGrid.js), ricaricati a caldo quando cambiano. Possiede: tester.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const OCR_DIR = path.join(ROOT, 'src', 'ocr');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const PORT = process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : 5175; // PORT=0: porta libera (test)
const MAX_BODY = 160 * 1024 * 1024; // fino a ~5K x 3K RGBA

// ---- moduli di src/ocr con ricarica a caldo ----
const MODULES = {
  topbar: { file: 'topbar.js', needs: ['findTopBar', 'matchNickname', 'sideOf'] },
  heroGrid: { file: 'heroGrid.js', needs: ['findHeroGrid', 'tileStatus'] }
};
const mods = {};
function loadModules() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(OCR_DIR)) delete require.cache[k];
  for (const [name, def] of Object.entries(MODULES)) {
    const file = path.join(OCR_DIR, def.file);
    if (!fs.existsSync(file)) { mods[name] = { ok: false, missing: true, message: `src/ocr/${def.file}: modulo non ancora disponibile (lo pubblica app-dev)` }; continue; }
    try {
      const m = require(file);
      const lacking = def.needs.filter((f) => typeof m[f] !== 'function');
      mods[name] = lacking.length
        ? { ok: false, message: `src/ocr/${def.file}: mancano le funzioni ${lacking.join(', ')}`, m }
        : { ok: true, m, exports: Object.keys(m).filter((f) => typeof m[f] === 'function') };
    } catch (e) {
      mods[name] = { ok: false, message: `src/ocr/${def.file} non si carica: ${e.message}` };
    }
  }
}
loadModules();

// ---- OCR dei nomi (facoltativo): readNames del modulo se c'e', altrimenti tesseract.js se installato ----
let tess = null; // { worker } | { error }
async function getTesseract() {
  if (tess) return tess;
  let createWorker;
  try { ({ createWorker } = require(require.resolve('tesseract.js', { paths: [ROOT] }))); } catch (e) {
    tess = { error: 'tesseract.js non installato (esegui npm install nella cartella del progetto)' };
    return tess;
  }
  try {
    const cachePath = path.join(__dirname, '.cache');
    fs.mkdirSync(cachePath, { recursive: true });
    const worker = await createWorker('eng', 1, { cachePath, logger: () => {} });
    try { await worker.setParameters({ tessedit_pageseg_mode: '7' }); } catch (e) { /* non bloccante */ }
    tess = { worker };
  } catch (e) { tess = { error: 'tesseract.js non avviato: ' + e.message }; }
  return tess;
}

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function pngChunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  let c = 0xffffffff; for (const x of tb) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, tb, crc]);
}
// Ritaglio di un rettangolo, ingrandito k volte e invertito (testo chiaro su fondo scuro -> scuro su chiaro), in PNG grigio.
function cropToPng(img, r, k = 3) {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const w = Math.min(img.width - x0, Math.round(rw(r))), h = Math.min(img.height - y0, Math.round(rh(r)));
  if (w < 2 || h < 2) return null;
  const W = w * k, H = h * k, raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = ((y0 + Math.floor(y / k)) * img.width + x0 + Math.floor(x / k)) * 4;
      const l = 0.3 * img.data[o] + 0.59 * img.data[o + 1] + 0.11 * img.data[o + 2];
      raw[y * (W + 1) + 1 + x] = 255 - Math.min(255, l * 1.4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

let nameOcr = null; // { mod, inst } worker di src/ocr/nameOcr.js
async function readNames(img, slots) {
  const nameOcrFile = path.join(OCR_DIR, 'nameOcr.js');
  if (fs.existsSync(nameOcrFile)) {
    let no = null;
    try { no = require(nameOcrFile); } catch (e) { return { names: slots.map(() => null), source: null, error: 'src/ocr/nameOcr.js non si carica: ' + e.message }; }
    if (no && typeof no.NameOcr === 'function') {
      // istanza unica del worker; si ricrea quando il modulo viene ricaricato
      if (!nameOcr || nameOcr.mod !== no) {
        if (nameOcr) nameOcr.inst.terminate().catch(() => {});
        nameOcr = { mod: no, inst: new no.NameOcr(path.join(__dirname, '.cache')) };
      }
      try {
        const names = await nameOcr.inst.readNames(img, slots);
        return { names, source: 'src/ocr/nameOcr (tesseract.js)' };
      } catch (e) {
        const msg = /Cannot find module 'tesseract.js'/.test(e.message) ? 'tesseract.js non installato (esegui npm install nella cartella del progetto)' : e.message;
        return { names: slots.map(() => null), source: null, error: msg };
      }
    }
  }
  const tb = mods.topbar && mods.topbar.m;
  if (tb && typeof tb.readNames === 'function') {
    const names = await tb.readNames(img, slots);
    return { names, source: 'src/ocr/topbar.readNames' };
  }
  const t = await getTesseract();
  if (t.error) return { names: slots.map(() => null), source: null, error: t.error };
  const names = [];
  for (const s of slots) {
    const png = s.name ? cropToPng(img, s.name) : null;
    if (!png) { names.push(null); continue; }
    try {
      const { data } = await t.worker.recognize(png);
      const txt = ((data && data.text) || '').replace(/\s+/g, ' ').trim();
      names.push(txt || null);
    } catch (e) { names.push(null); }
  }
  return { names, source: 'tesseract.js (eng)' };
}

// ---- analisi ----
const rw = (r) => (r.width != null ? r.width : r.w);
const rh = (r) => (r.height != null ? r.height : r.h);
const norm = (r) => (r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(rw(r)), h: Math.round(rh(r)) } : null);
const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100;

async function analyze(img, { nick, manualNames, ocr }) {
  const out = { width: img.width, height: img.height, modules: moduleStatus(), notes: [] };

  // Barra in alto, nomi, nickname, lato
  if (mods.topbar.ok) {
    const tb = mods.topbar.m;
    try {
      let t0 = process.hrtime.bigint();
      const bar = tb.findTopBar(img);
      out.topbar = { timeMs: ms(t0), result: bar ? {
        confidence: bar.confidence,
        slots: bar.slots.map((s) => ({ index: s.index, side: s.side, found: !!s.found, bar: norm(s.bar), portrait: norm(s.portrait), name: norm(s.name) }))
      } : null };
      if (!bar) out.notes.push('Barra degli eroi non trovata in questa immagine.');
      let names = Array(10).fill(null), source = null;
      if (bar && ocr) {
        t0 = process.hrtime.bigint();
        try {
          const r = await readNames(img, bar.slots);
          names = r.names; source = r.source;
          if (r.error) out.notes.push('OCR dei nomi non disponibile: ' + r.error + '. Puoi scrivere i nomi a mano.');
        } catch (e) { out.notes.push('OCR dei nomi fallito: ' + e.message); }
        out.ocrTimeMs = ms(t0);
      }
      if (Array.isArray(manualNames) && manualNames.some((x) => x && x.trim())) {
        names = names.map((n, i) => (manualNames[i] && manualNames[i].trim() ? manualNames[i] : n));
        source = (source ? source + ' + ' : '') + 'correzioni a mano';
      }
      out.names = names; out.namesSource = source;
      if (nick) {
        t0 = process.hrtime.bigint();
        const match = tb.matchNickname(names, nick);
        out.match = match ? { index: match.index, score: match.score, side: tb.sideOf(match.index) } : null;
        out.matchTimeMs = ms(t0);
        if (typeof tb.nameScore === 'function') out.nameScores = names.map((n) => { try { return n ? tb.nameScore(n, nick) : null; } catch (e) { return null; } });
        if (!match) out.notes.push('Nickname non trovato tra i nomi letti: la calibrazione chiederebbe lo slot a mano (R1..R5 / D1..D5).');
      } else out.notes.push('Inserisci il tuo nickname per vedere slot e lato dedotti.');
    } catch (e) { out.topbar = { error: e.message }; }
  }

  // Griglia eroi e stato dei riquadri
  if (mods.heroGrid.ok) {
    const hg = mods.heroGrid.m;
    try {
      let t0 = process.hrtime.bigint();
      const grid = hg.findHeroGrid(img);
      out.grid = { timeMs: ms(t0), rect: norm(grid) };
      if (!grid) out.notes.push('Griglia degli eroi non trovata in questa immagine.');
      if (grid && typeof hg.findTiles === 'function') {
        t0 = process.hrtime.bigint();
        const ft = hg.findTiles(img);
        const tiles = (ft && ft.tiles) || [];
        out.grid.tiles = tiles.map((r) => {
          const detail = {};
          let status;
          try { status = hg.tileStatus(img, r, detail); } catch (e) { status = 'unknown'; detail.error = e.message; }
          return { rect: norm(r), status, detail };
        });
        out.grid.tilesTimeMs = ms(t0);
      } else if (grid) out.notes.push('heroGrid.js non esporta findTiles: disegno solo il quadrante della griglia (trascina un riquadro sull\'immagine per controllarlo).');
    } catch (e) { out.grid = { error: e.message }; }
  }
  return out;
}

function tileCheck(img, rect) {
  if (!mods.heroGrid.ok) return { error: mods.heroGrid.message };
  const r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, width: rect.w, height: rect.h };
  const detail = {};
  const t0 = process.hrtime.bigint();
  const status = mods.heroGrid.m.tileStatus(img, r, detail);
  return { rect: norm(r), status, detail, timeMs: ms(t0) };
}

function moduleStatus() {
  const s = {};
  for (const [k, v] of Object.entries(mods)) s[k] = { ok: v.ok, missing: !!v.missing, message: v.message || null, exports: v.exports || [] };
  return s;
}

// ---- server ----
const images = new Map(); // ultime immagini analizzate, per i controlli di un singolo riquadro
let imageSeq = 0;
const clients = new Set();
const broadcast = (msg) => { for (const res of clients) res.write(`data: ${msg}\n\n`); };
function watch(dir, onChange) {
  let t = null;
  try {
    fs.watch(dir, { recursive: true }, (_ev, file) => {
      if (!file || /\.cache|\.tmp$|~$/.test(file)) return;
      clearTimeout(t); t = setTimeout(() => onChange(file), 300);
    });
  } catch (e) { console.log('watch non disponibile per', dir, e.message); }
}
watch(OCR_DIR, (file) => {
  if (!/\.(js|json)$/.test(file)) return;
  loadModules();
  console.log('moduli src/ocr ricaricati:', file, Object.entries(mods).map(([k, v]) => k + (v.ok ? ' ok' : ' NO')).join(', '));
  broadcast('modules');
});
watch(__dirname, (file) => { if (/\.(html|css|js)$/.test(file) && !/server\.js$/.test(file)) broadcast('reload'); });

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const serveFile = (res, base, rel) => {
  const file = path.resolve(base, rel);
  if (!file.startsWith(path.resolve(base) + path.sep)) return send(res, 403, 'vietato', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, data) => (err ? send(res, 404, 'non trovato', 'text/plain; charset=utf-8') : send(res, 200, data, types[path.extname(file).toLowerCase()] || 'application/octet-stream')));
};
function readRaw(req) {
  return new Promise((ok, ko) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { ko(new Error('immagine troppo grande')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', ko);
  });
}
// Corpo: 4 byte lunghezza JSON (BE) + JSON {width,height,nick,names,ocr,rect?} + pixel RGBA.
async function readImageRequest(req) {
  const buf = await readRaw(req);
  if (buf.length < 4) throw new Error('richiesta vuota');
  const jl = buf.readUInt32BE(0);
  const meta = JSON.parse(buf.toString('utf8', 4, 4 + jl));
  const px = buf.subarray(4 + jl);
  const { width, height } = meta;
  if (!(width > 0 && height > 0) || px.length !== width * height * 4) throw new Error(`pixel inattesi: ${px.length} byte per ${width}x${height}`);
  return { meta, img: { data: new Uint8ClampedArray(px.buffer, px.byteOffset, px.length), width, height } };
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url === '/' || url === '/index.html') return serveFile(res, __dirname, 'index.html');
    if (url === '/bench.js' || url === '/bench.css') return serveFile(res, __dirname, url.slice(1));
    if (url.startsWith('/fixtures/')) return serveFile(res, FIXTURES, url.slice('/fixtures/'.length));
    if (url === '/api/fixtures') {
      const files = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((f) => /\.(png|webp|jpe?g)$/i.test(f)).sort() : [];
      return send(res, 200, files);
    }
    if (url === '/api/status') return send(res, 200, { modules: moduleStatus(), ocr: tess ? (tess.error ? { ok: false, message: tess.error } : { ok: true }) : null });
    if (url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('data: hello\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (url === '/api/analyze' && req.method === 'POST') {
      const { meta, img } = await readImageRequest(req);
      const t0 = process.hrtime.bigint();
      const out = await analyze(img, { nick: (meta.nick || '').trim(), manualNames: meta.names, ocr: meta.ocr !== false });
      out.totalMs = ms(t0);
      out.imageId = String(++imageSeq);
      images.set(out.imageId, img);
      while (images.size > 3) images.delete(images.keys().next().value);
      return send(res, 200, out);
    }
    if (url === '/api/tile' && req.method === 'POST') {
      const meta = JSON.parse((await readRaw(req)).toString('utf8') || '{}');
      const img = images.get(String(meta.imageId));
      if (!img) return send(res, 410, { error: 'immagine scaduta: rianalizza lo screenshot' });
      return send(res, 200, tileCheck(img, meta.rect || {}));
    }
    send(res, 404, { error: 'non trovato' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});
server.listen(PORT, () => {
  console.log('Banco prova lettura schermo su http://localhost:' + server.address().port);
  for (const [k, v] of Object.entries(mods)) console.log(' ', k + ':', v.ok ? 'ok' : v.message);
});
