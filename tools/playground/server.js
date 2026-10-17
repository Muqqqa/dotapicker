// Pannello di valutazione (solo uso locale): compone draft, chiama il motore vero e salva i giudizi in docs/feedback.json.
// Avvio: node tools/playground/server.js  ->  http://localhost:5174
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const FEEDBACK = path.join(ROOT, 'docs', 'feedback.json');
const PORT = 5174;

// Il token STRATZ e' una variabile d'ambiente utente: se il processo e' nato prima, la rilegge dal registro.
if (!process.env.STRATZ_TOKEN && process.platform === 'win32') {
  try {
    const out = execSync('reg query HKCU\\Environment /v STRATZ_TOKEN', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/STRATZ_TOKEN\s+REG_\w+\s+(\S+)/);
    if (m) process.env.STRATZ_TOKEN = m[1];
  } catch (e) { /* nessun token: resta l'euristica */ }
}
// Il motore si ricarica da solo quando cambiano i suoi file, e la pagina si aggiorna quando cambiano
// renderer o banco di prova: cosi' il banco mostra sempre l'ultima versione senza riavvii.
const ENGINE_DIR = path.join(ROOT, 'src', 'engine');
let engine = require(ENGINE_DIR);
const clients = new Set();
const broadcast = (msg) => { for (const res of clients) res.write(`data: ${msg}\n\n`); };
function watch(dir, onChange) {
  let t = null;
  try {
    fs.watch(dir, { recursive: true }, (_ev, file) => {
      if (!file || /cache|\.tmp$|~$/.test(file)) return;
      clearTimeout(t); t = setTimeout(() => onChange(file), 300);
    });
  } catch (e) { console.log('watch non disponibile per', dir, e.message); }
}
watch(ENGINE_DIR, (file) => {
  if (!/\.(js|json)$/.test(file)) return;
  for (const k of Object.keys(require.cache)) if (k.startsWith(ENGINE_DIR)) delete require.cache[k];
  try { engine = require(ENGINE_DIR); loadedRank = null; console.log('motore ricaricato:', file); broadcast('engine'); }
  catch (e) { console.log('motore non ricaricato (errore):', e.message); }
});
watch(RENDERER, () => broadcast('reload'));
watch(__dirname, (file) => { if (!/server\.js$/.test(file)) broadcast('reload'); });

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, ko) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { ko(e); } }); });
const serveFile = (res, base, rel) => {
  const file = path.join(base, rel);
  if (!file.startsWith(base)) return send(res, 403, 'vietato', 'text/plain');
  fs.readFile(file, (err, data) => err ? send(res, 404, 'non trovato', 'text/plain') : send(res, 200, data, types[path.extname(file)] || 'application/octet-stream'));
};

let loadedRank = null;
async function ensureRank(rankTier) {
  if (loadedRank !== rankTier) { await engine.loadData({ rankTier }); loadedRank = rankTier; }
}

async function suggest({ allies = [], enemies = [], myHero = null, role = 1, rankTier = 45 }) {
  await ensureRank(rankTier);
  const ids = allies.concat(enemies, myHero ? [myHero] : []);
  if (enemies.length) await engine.ensureMatchups(enemies);
  if (typeof engine.ensureStratz === 'function' && ids.length) { try { await engine.ensureStratz(ids, rankTier); } catch (e) { /* euristica */ } }
  const h = (id) => ({ heroId: id, name: engine.heroName(id), img: engine.heroImageUrl(id) });
  if (myHero) await engine.ensureMatchups(ids);
  // come nell'app: il tuo eroe conta come alleato per i consigli; a 5 contro 5 arriva la stima di vittoria
  const team = myHero ? allies.concat([myHero]) : allies;
  const suggestion = engine.suggest({ allies: team, enemies, role, rankTier });
  let matchEstimate = null;
  if (team.length === 5 && enemies.length === 5 && typeof engine.estimateMatch === 'function') {
    try { matchEstimate = engine.estimateMatch({ allies: team, enemies, rankTier }); } catch (e) { matchEstimate = null; }
  }
  return {
    steamId: 'test', rankTier, lobbyRankTier: rankTier, role, myHero: myHero ? h(myHero) : null,
    allies: allies.map(h), enemies: enemies.map(h), suggestion, matchEstimate, status: 'draft',
    provider: engine.getProviderInfo ? engine.getProviderInfo() : null
  };
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/' || url === '/index.html') return serveFile(res, __dirname, 'index.html');
    if (url === '/playground.js' || url === '/playground.css') return serveFile(res, __dirname, url.slice(1));
    if (url.startsWith('/renderer/')) return serveFile(res, RENDERER, decodeURIComponent(url.slice('/renderer/'.length)));
    if (url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('data: hello\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (url === '/api/heroes') {
      await ensureRank(loadedRank || 45);
      return send(res, 200, engine.getHeroes().map((x) => ({ id: x.id, name: x.name, img: x.img || engine.heroImageUrl(x.id) })).sort((a, b) => a.name.localeCompare(b.name)));
    }
    if (url === '/api/suggest' && req.method === 'POST') return send(res, 200, await suggest(await readBody(req)));
    if (url === '/api/feedback' && req.method === 'GET') {
      return send(res, 200, fs.existsSync(FEEDBACK) ? JSON.parse(fs.readFileSync(FEEDBACK, 'utf8')) : []);
    }
    if (url === '/api/feedback' && req.method === 'POST') {
      const entry = await readBody(req);
      const all = fs.existsSync(FEEDBACK) ? JSON.parse(fs.readFileSync(FEEDBACK, 'utf8')) : [];
      entry.savedAt = new Date().toISOString();
      all.push(entry);
      fs.writeFileSync(FEEDBACK, JSON.stringify(all, null, 2));
      return send(res, 200, { ok: true, count: all.length });
    }
    send(res, 404, { error: 'non trovato' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log('Pannello di valutazione su http://localhost:' + PORT + (process.env.STRATZ_TOKEN ? ' (STRATZ attivo)' : ' (senza STRATZ)')));
