'use strict';
const path = require('path');
const { fetchRankTier, fetchHeroes } = require('./opendota');
const { lobbyRankTier } = require('./rank');
const regionsIo = require('../ocr/regions');
const layout = require('../ocr/layout');
const { StratzKey, probe: probeStratz } = require('./stratz');
const { HeroMatcher } = require('../ocr/heroMatch');
const { RoleOcr } = require('../ocr/roleOcr');
const { majorityRole } = require('../ocr/parseRole');

const FALLBACK_RANK = 40; // Archon, se il profilo non espone rank
const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/';

/**
 * Orchestra: store -> rank -> engine -> cattura/OCR -> State verso il renderer.
 * Tutto difensivo: ogni errore diventa status 'waiting'/'error' con messaggio, mai un crash.
 */
class Controller {
  constructor({ store, userDataDir, desktopCapturer, screen, nativeImage, emit, emitSettings, safeStorage, enginePath }) {
    this.store = store;
    this.emitSettings = emitSettings || (() => {});
    this.stratzKey = new StratzKey(userDataDir, safeStorage);
    this.userStratzToken = this.stratzKey.load(); // solo in memoria
    this.stratzStatus = { ok: null, error: null };
    this.regionsInfo = null;
    this.userDataDir = userDataDir;
    this.desktopCapturer = desktopCapturer;
    this.screen = screen;
    this.nativeImage = nativeImage;
    this.emit = emit || (() => {});
    this.enginePath = enginePath || path.join(__dirname, '..', 'engine');

    this.engine = null;
    this.engineLoadedFor = null;
    this.engineErr = null;
    this.engineLoading = false;
    this.lastEngineTry = 0;

    this.heroes = new Map(); // id -> {heroId,name,img}
    this.heroList = [];
    this.matcher = null;
    this.matcherLoading = false;
    this.ocr = new RoleOcr(path.join(userDataDir, 'tessdata'));
    this.roleHist = [];
    this.manualRole = null;

    this.rankFetching = false;
    this.lastRankTry = 0;
    this.timer = null;
    this.busy = false;
    this.lastSig = '';

    this.state = {
      steamId: store.get('steamId', null),
      rankTier: store.get('rankTier', null),
      lobbyRankTier: null, role: null, allies: [], enemies: [], myHero: null,
      suggestion: null, matchEstimate: null, status: 'waiting', message: 'Avvio...',
    };
    this.state.status = this.state.steamId ? 'waiting' : 'setup';
    this.state.message = this.state.steamId ? 'Avvio...' : 'Inserisci il tuo Steam ID';
  }

  getState() { return this.state; }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit(this.state);
  }

  async saveSteamId(id) {
    const s = String(id == null ? '' : id).trim();
    if (!s) return { ok: false, error: 'Steam ID vuoto' };
    const { toAccountId } = require('./steam');
    if (toAccountId(s) == null) {
      this.set({ status: 'error', message: 'Steam ID non valido (usa SteamID64 o account ID)' });
      return { ok: false, error: 'Steam ID non valido' };
    }
    this.store.set('steamId', s);
    this.store.set('rankTier', null);
    this.set({ steamId: s, rankTier: null, lobbyRankTier: null, status: 'waiting', message: 'Recupero rank da OpenDota...', suggestion: null });
    this.lastRankTry = 0;
    this.lastSig = '';
    this.tick();
    return { ok: true };
  }

  setRole(r) {
    this.manualRole = r >= 1 && r <= 5 ? r : null;
    // baseline: l'override decade quando l'OCR rileva un cambio di ruolo o di draft
    this.manualBase = null; // popolata al prossimo tick con la lettura corrente
    this.manualPending = !!this.manualRole;
    this.lastSig = '';
    this.tick();
    return { ok: true, role: this.manualRole };
  }

  // ---- inizializzazioni lazy -------------------------------------------------
  loadEngine() {
    if (this.engine) return this.engine;
    try {
      delete require.cache[require.resolve(this.enginePath)];
    } catch (e) { /* non ancora presente */ }
    try {
      this.engine = require(this.enginePath);
      this.engineErr = null;
    } catch (e) {
      this.engine = null;
      this.engineErr = e;
    }
    return this.engine;
  }

  async ensureEngineData(rankTier) {
    if (this.engineLoadedFor === rankTier) return true;
    if (this.engineLoading) return false;
    if (Date.now() - this.lastEngineTry < 20000 && this.engineErr) return false;
    this.lastEngineTry = Date.now();
    const eng = this.loadEngine();
    if (!eng || typeof eng.loadData !== 'function' || typeof eng.suggest !== 'function') {
      this.engineErr = this.engineErr || new Error('Engine non ancora pronto');
      return false;
    }
    this.engineLoading = true;
    try {
      // precedenza: chiave dell'utente > env STRATZ_TOKEN (gestita dall'engine quando stratzToken e' assente)
      const o = { rankTier, cacheDir: path.join(this.userDataDir, 'engine-cache') };
      if (this.userStratzToken) o.stratzToken = this.userStratzToken;
      await eng.loadData(o);
      this.engineLoadedFor = rankTier;
      this.engineErr = null;
      return true;
    } catch (e) {
      this.engineErr = e;
      return false;
    } finally {
      this.engineLoading = false;
    }
  }

  async ensureHeroes() {
    if (this.heroes.size) return true;
    const fs = require('fs');
    const cacheFile = path.join(this.userDataDir, 'heroes.json');
    let list = null;
    try { list = await fetchHeroes(); fs.writeFileSync(cacheFile, JSON.stringify(list)); } catch (e) {
      try { list = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e2) { /* niente */ }
    }
    if (!Array.isArray(list) || !list.length) return false;
    this.heroList = list;
    for (const h of list) {
      this.heroes.set(h.id, { heroId: h.id, name: h.localized_name, img: this.heroImg(h) });
    }
    return true;
  }

  heroImg(h) {
    try {
      if (this.engine && typeof this.engine.heroImageUrl === 'function') {
        const u = this.engine.heroImageUrl(h.id);
        if (u) return u;
      }
    } catch (e) { /* fallback */ }
    return CDN + String(h.name).replace('npc_dota_hero_', '') + '.png';
  }

  async ensureMatcher() {
    if (this.matcher && this.matcher.ready) return true;
    if (this.matcherLoading) return false;
    if (!(await this.ensureHeroes())) return false;
    this.matcherLoading = true;
    this.set({ message: 'Scarico icone eroi per il riconoscimento...' });
    const m = new HeroMatcher({
      cacheDir: path.join(this.userDataDir, 'hero-icons'),
      heroes: this.heroList.map((h) => ({ id: h.id, name: h.name })),
      urlFor: (id, h) => CDN + String(h.name).replace('npc_dota_hero_', '') + '.png',
    });
    m.init().then(() => { this.matcher = m; }).catch(() => {}).finally(() => { this.matcherLoading = false; });
    return false;
  }

  async ensureRank() {
    if (!this.state.steamId) return null;
    if (this.state.rankTier) return this.state.rankTier;
    if (this.rankFetching || Date.now() - this.lastRankTry < 30000) return null;
    this.rankFetching = true;
    this.lastRankTry = Date.now();
    try {
      const rt = await fetchRankTier(this.state.steamId);
      const eff = rt || FALLBACK_RANK;
      this.store.set('rankTier', eff);
      this.set({ rankTier: eff, message: rt ? undefined : 'Rank non disponibile (profilo privato?): uso Archon' });
      return eff;
    } catch (e) {
      this.set({ status: 'waiting', message: 'Rank non recuperato (' + e.message + '), riprovo...' });
      return null;
    } finally {
      this.rankFetching = false;
    }
  }

  // ---- cattura ---------------------------------------------------------------
  async capture() {
    const disp = this.screen.getPrimaryDisplay();
    const w = Math.round(disp.size.width * disp.scaleFactor);
    const h = Math.round(disp.size.height * disp.scaleFactor);
    const sources = await this.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
    if (!sources.length) return null;
    const src = sources.find((s) => String(s.display_id) === String(disp.id)) || sources[0];
    const img = src.thumbnail;
    return img && !img.isEmpty() ? img : null;
  }

  /** Ricalcola le regioni per il display principale (preset o calibrazione utente). */
  refreshRegions() {
    this.regionsInfo = regionsIo.resolveForDisplay(this.userDataDir, this.screen.getPrimaryDisplay());
    return this.regionsInfo;
  }

  /** rect in DIP -> ritaglio dell'immagine catturata. */
  crop(img, rect, info) {
    const ri = info || this.regionsInfo || this.refreshRegions();
    const { width, height } = img.getSize();
    return img.crop(layout.toPixelRect(rect, ri.width, ri.height, width, height));
  }

  async detect(img, regions) {
    const ri = this.regionsInfo || this.refreshRegions();
    const R = regions || ri.regions;
    const thr = ri.matchThreshold;
    const ident = (id) => (this.matcher && R[id] ? this.matcher.identify(this.crop(img, R[id], ri), thr) : null);
    const alliesIds = layout.ALLY_IDS.map(ident);
    const enemiesIds = layout.ENEMY_IDS.map(ident);
    const myId = ident('myHero');

    let role = null;
    try {
      const r = await this.ocr.readRole(this.crop(img, R.roleText, ri));
      this.roleHist.push(r.role);
      if (this.roleHist.length > 5) this.roleHist.shift();
      role = majorityRole(this.roleHist);
    } catch (e) {
      this.ocrErr = e;
    }
    return { alliesIds, enemiesIds, myId, role };
  }

  wrap(id) { return this.heroes.get(id) || { heroId: id, name: '#' + id, img: '' }; }

  // ---- ciclo principale ------------------------------------------------------
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.state.steamId) { this.set({ status: 'setup', message: 'Inserisci il tuo Steam ID' }); return; }
      const userRank = await this.ensureRank();
      if (!userRank) return;
      await this.ensureHeroes();
      await this.ensureMatcher();
      this.refreshRegions();

      let det = { alliesIds: [], enemiesIds: [], myId: null, role: null };
      try {
        const img = await this.capture();
        if (img) det = await this.detect(img);
      } catch (e) {
        this.set({ status: 'error', message: 'Cattura schermo fallita: ' + e.message });
        return;
      }

      const allies = det.alliesIds.filter((x) => x && x !== det.myId);
      const enemies = det.enemiesIds.filter((x) => x);
      if (this.manualRole) {
        const draftSig = JSON.stringify([allies, enemies, det.myId]);
        if (this.manualPending) {
          this.manualBase = { ocr: det.role, draft: draftSig };
          this.manualPending = false;
        } else if ((det.role && det.role !== this.manualBase.ocr) || draftSig !== this.manualBase.draft) {
          this.manualRole = null; // OCR ha rilevato un nuovo draft/ruolo
        }
      }
      const role = this.manualRole || det.role;
      const anything = allies.length || enemies.length || det.myId || role;
      const lobby = lobbyRankTier(userRank, []); // rank avversari ignoto: usa rank utente

      const base = {
        rankTier: userRank, lobbyRankTier: lobby, role,
        allies: allies.map((i) => this.wrap(i)),
        enemies: enemies.map((i) => this.wrap(i)),
        myHero: det.myId ? this.wrap(det.myId) : null,
        matchEstimate: null,
      };

      if (!anything) {
        const sig = 'idle';
        if (sig !== this.lastSig) {
          this.lastSig = sig;
          this.set({ ...base, suggestion: null, status: 'waiting',
            message: this.matcher ? 'In attesa del draft...' : 'Preparo il riconoscimento eroi...' });
        }
        return;
      }

      const sig = JSON.stringify([allies, enemies, det.myId, role, lobby, this.engineLoadedFor]);
      if (sig === this.lastSig) return;

      if (!role) {
        this.lastSig = sig;
        this.set({ ...base, suggestion: null, status: 'waiting', message: 'Ruolo non rilevato (scritta di ruolo non leggibile)' });
        return;
      }
      const ready = await this.ensureEngineData(lobby);
      if (!ready) {
        // niente lastSig: riprova al prossimo tick
        this.set({ ...base, suggestion: null, status: 'waiting',
          message: 'Motore di analisi non ancora pronto' + (this.engineErr ? ' (' + this.engineErr.message + ')' : '') });
        return;
      }
      try {
        if (typeof this.engine.ensureMatchups === 'function' && enemies.length) {
          await this.engine.ensureMatchups(enemies.map((h) => (h && h.heroId) || h));
        }
        if (typeof this.engine.ensureStratz === 'function') {
          const all10 = [...allies, ...(det.myId ? [det.myId] : []), ...enemies].map((h) => (h && h.heroId) || h);
          await this.engine.ensureStratz(all10, lobby)
            .catch(() => {}); // provider opzionale: senza token o in errore resta l'euristica
        }
        const suggestion = this.engine.suggest({ allies, enemies, role, rankTier: lobby });
        // stima di vittoria: solo a draft completo (4 alleati + myHero, 5 nemici)
        let matchEstimate = null;
        if (allies.length === 4 && det.myId && enemies.length === 5 && typeof this.engine.estimateMatch === 'function') {
          try {
            matchEstimate = (await this.engine.estimateMatch({ allies: [...allies, det.myId], enemies, rankTier: lobby })) || null;
          } catch (e) { matchEstimate = null; }
        }
        this.lastSig = sig;
        this.set({ ...base, suggestion, matchEstimate, status: 'draft', message: undefined });
      } catch (e) {
        this.set({ ...base, suggestion: null, status: 'waiting', message: 'Suggerimento non disponibile: ' + e.message });
      }
    } catch (e) {
      this.set({ status: 'error', message: 'Errore interno: ' + e.message });
    } finally {
      this.busy = false;
    }
  }

  // ---- impostazioni / STRATZ / calibrazione -----------------------------------
  getSettings() {
    let ri;
    try { ri = this.refreshRegions(); } catch (e) { ri = null; }
    const configured = !!(this.userStratzToken || process.env.STRATZ_TOKEN);
    return {
      steamId: this.state.steamId,
      rankTier: this.state.rankTier,
      resolution: ri ? `${ri.width}x${ri.height}` : null,
      scaleFactor: ri ? ri.scaleFactor : null,
      regionsSource: ri ? ri.source : 'preset',
      stratz: { configured, ok: configured ? this.stratzStatus.ok : null, error: configured ? this.stratzStatus.error : null },
    };
  }

  pushSettings() {
    try { this.emitSettings(this.getSettings()); } catch (e) { /* ignore */ }
  }

  async checkStratz() {
    const tok = this.userStratzToken || process.env.STRATZ_TOKEN;
    if (!tok) { this.stratzStatus = { ok: null, error: null }; this.pushSettings(); return; }
    this.stratzStatus = { ok: null, error: null };
    this.pushSettings();
    const r = await probeStratz(tok);
    this.stratzStatus = { ok: r.ok, error: r.error || null };
    this.pushSettings();
  }

  /** token '' = rimuovi. Mai il token in log/errori/State. */
  async saveStratzToken(token) {
    const r = this.stratzKey.save(token);
    if (!r.ok) return { ok: false, error: r.error };
    const t = String(token == null ? '' : token).trim();
    this.userStratzToken = t || null;
    this.engineLoadedFor = null; // forza loadData col nuovo token al prossimo giro
    this.lastEngineTry = 0;
    this.lastSig = '';
    await this.checkStratz();
    this.tick();
    return { ok: true, stratz: this.getSettings().stratz };
  }

  saveCalibration(regions, useDefault) {
    const d = this.screen.getPrimaryDisplay();
    const key = layout.resolutionKey(d.size.width, d.size.height, d.scaleFactor || 1);
    try {
      if (useDefault) regionsIo.saveUserRegions(this.userDataDir, key, null);
      else {
        const clean = layout.sanitizeRegions(regions, d.size.width, d.size.height, null);
        if (!clean) return { ok: false, error: 'Regioni non valide' };
        regionsIo.saveUserRegions(this.userDataDir, key, clean);
      }
    } catch (e) { return { ok: false, error: 'Salvataggio non riuscito' }; }
    this.refreshRegions();
    this.lastSig = '';
    this.pushSettings();
    this.tick();
    return { ok: true };
  }

  /** "Prova lettura": OCR del ruolo e riconoscimento di ogni slot con le regioni passate. */
  async testRead(regions) {
    const ri = this.refreshRegions();
    const R = layout.sanitizeRegions(regions, ri.width, ri.height, ri.preset) || ri.regions;
    const out = { role: null, roleText: '', slots: {}, notes: [] };
    let img = null;
    try { img = await this.capture(); } catch (e) { /* sotto */ }
    if (!img) { out.error = 'Cattura dello schermo non riuscita'; return out; }
    try {
      const r = await this.ocr.readRole(this.crop(img, R.roleText, ri));
      out.role = r.role;
      out.roleText = String(r.text || '').trim().slice(0, 60);
    } catch (e) { out.notes.push('OCR ruolo non disponibile: ' + String(e.message).slice(0, 80)); }
    if (!this.matcher || !this.matcher.ready) {
      out.notes.push('Icone eroi non ancora pronte: riprova tra poco');
      await this.ensureHeroes(); await this.ensureMatcher();
      return out;
    }
    for (const id of [...layout.ALLY_IDS, ...layout.ENEMY_IDS, 'myHero']) {
      const hid = R[id] ? this.matcher.identify(this.crop(img, R[id], ri), ri.matchThreshold) : null;
      out.slots[id] = hid ? { heroId: hid, name: this.wrap(hid).name } : null;
    }
    return out;
  }

  start(intervalMs = 1500) {
    this.stop();
    this.tick();
    this.checkStratz().catch(() => {});
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispose() {
    this.stop();
    await this.ocr.terminate();
  }
}

module.exports = { Controller };
