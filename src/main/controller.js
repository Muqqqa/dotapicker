'use strict';
const path = require('path');
const fs = require('fs');
const { fetchProfile, fetchHeroes } = require('./opendota');
const { lobbyRankTier } = require('./rank');
const regionsIo = require('../ocr/regions');
const layout = require('../ocr/layout');
const { StratzKey, probe: probeStratz } = require('./stratz');
const { HeroMatcher } = require('../ocr/heroMatch');
const { RoleOcr } = require('../ocr/roleOcr');
const { NameOcr } = require('../ocr/nameOcr');
const { majorityRole } = require('../ocr/parseRole');
const topbar = require('../ocr/topbar');
const heroGrid = require('../ocr/heroGrid');
const png = require('../ocr/png');

const FALLBACK_RANK = 40; // Archon, se il profilo non espone rank
const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/';
const PROFILE_REFRESH_MS = 10 * 60 * 1000; // personaname: aggiornato se cambia
const NAME_OCR_EVERY_MS = 2500;            // OCR dei nomi finche' lo slot non e' trovato
const BAR_MISSING_RESET = 5;               // tick senza barra = draft finita (reset bannati/slot)
const BAN_ROUNDS = 5;
const CANDIDATES = 12;
const TPL_W = 24, TPL_H = 40;              // template appresi dei riquadri della griglia (scala di grigi)
const LOCATE_MIN = 0.85, LOCATE_MARGIN = 0.05;

/**
 * Orchestra: store -> profilo/rank -> engine -> cattura -> barra in alto (lato/slot dal nickname)
 * -> griglia (ban) -> State verso il renderer.
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
    const tess = path.join(userDataDir, 'tessdata');
    this.ocr = new RoleOcr(tess);
    this.nameOcr = new NameOcr(tess);
    this.roleHist = [];
    this.manualRole = null;

    this.profileFetching = false;
    this.lastProfileTry = 0;
    this.lastProfileOk = 0;
    this.timer = null;
    this.busy = false;
    this.lastSig = '';

    // memoria della draft corrente
    this.draft = this.freshDraft();
    this.gridTpl = null; // Map heroId -> RGBA template appreso (caricato pigramente)
    this.gridTplDirty = false;

    this.state = {
      steamId: store.get('steamId', null),
      rankTier: store.get('rankTier', null),
      lobbyRankTier: null, role: null, allies: [], enemies: [], myHero: null,
      suggestion: null, matchEstimate: null, status: 'waiting', message: 'Avvio...',
      nickname: store.get('personaname', null), mySide: null, mySlot: null, excluded: [],
    };
    this.state.status = this.state.steamId ? 'waiting' : 'setup';
    this.state.message = this.state.steamId ? 'Avvio...' : 'Inserisci il tuo Steam ID';
  }

  freshDraft() {
    return { slot: null, slotSource: null, matchScore: null, ocrNames: null, lastNameOcr: 0,
      banned: new Set(), barMissing: 0, hadPicks: false };
  }

  resetDraft() {
    this.draft = this.freshDraft();
    this.lastSig = '';
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
    const changed = s !== this.store.get('steamId', null);
    this.store.set('steamId', s);
    this.store.set('rankTier', null);
    if (changed) this.store.set('personaname', null);
    this.set({ steamId: s, rankTier: null, lobbyRankTier: null, status: 'waiting', message: 'Recupero profilo da OpenDota...',
      suggestion: null, nickname: changed ? null : this.state.nickname });
    this.lastProfileTry = 0;
    this.lastProfileOk = 0;
    this.resetDraft();
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

  /**
   * Profilo OpenDota (rank + personaname). Blocca solo finche' manca il rank; il nickname viene
   * aggiornato in background ogni PROFILE_REFRESH_MS.
   */
  async ensureProfile() {
    if (!this.state.steamId) return null;
    const have = this.state.rankTier;
    const stale = !this.state.nickname || Date.now() - this.lastProfileOk > PROFILE_REFRESH_MS;
    if (have && !stale) return have;
    if (this.profileFetching || Date.now() - this.lastProfileTry < 30000) return have || null;
    this.profileFetching = true;
    this.lastProfileTry = Date.now();
    const job = (async () => {
      try {
        const p = await fetchProfile(this.state.steamId);
        this.lastProfileOk = Date.now();
        const patch = {};
        if (p.personaname && p.personaname !== this.state.nickname) {
          this.store.set('personaname', p.personaname);
          patch.nickname = p.personaname;
          this.resetDraft(); // nickname cambiato: rileggi lo slot
        }
        if (!this.state.rankTier) {
          const eff = p.rankTier || FALLBACK_RANK;
          this.store.set('rankTier', eff);
          patch.rankTier = eff;
          if (!p.rankTier) patch.message = 'Rank non disponibile (profilo privato?): uso Archon';
        }
        if (Object.keys(patch).length) this.set(patch);
        return this.state.rankTier;
      } catch (e) {
        if (!this.state.rankTier) this.set({ status: 'waiting', message: 'Profilo non recuperato (' + e.message + '), riprovo...' });
        return null;
      } finally {
        this.profileFetching = false;
      }
    })();
    if (have) return have; // aggiornamento del nickname in background
    return job;
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

  /** NativeImage -> RGBA {data,width,height} per i moduli puri di src/ocr. */
  toRgba(img) {
    const { width, height } = img.getSize();
    return png.fromBitmapBGRA(img.toBitmap(), width, height);
  }

  /** Ricalcola le regioni per il display principale (preset + calibrazione v2). */
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

  toPx(rect, ri, imgW, imgH) {
    return rect ? layout.toPixelRect(rect, ri.width, ri.height, imgW, imgH) : null;
  }

  toDip(rect, ri, imgW, imgH) {
    if (!rect) return null;
    const sx = ri.width / imgW, sy = ri.height / imgH;
    return { x: Math.round(rect.x * sx), y: Math.round(rect.y * sy), width: Math.max(1, Math.round(rect.width * sx)), height: Math.max(1, Math.round(rect.height * sy)) };
  }

  findBar(rgba, ri) {
    const area = ri.cal && ri.cal.topBar ? this.toPx(ri.cal.topBar, ri, rgba.width, rgba.height) : null;
    let tb = null;
    try { tb = area ? topbar.findTopBar(rgba, { area }) : null; } catch (e) { tb = null; }
    if (!tb) { try { tb = topbar.findTopBar(rgba); } catch (e) { tb = null; } }
    return tb;
  }

  /** Lato/slot dell'utente: nickname letto con OCR (una volta trovato resta fisso per la draft), poi manualSlot. */
  async resolveSlot(rgba, tb, ri, { force = false } = {}) {
    const d = this.draft;
    if (d.slotSource === 'nickname' && !force) return;
    const nick = this.state.nickname;
    if (tb && nick && (force || Date.now() - d.lastNameOcr >= NAME_OCR_EVERY_MS)) {
      d.lastNameOcr = Date.now();
      try {
        d.ocrNames = await this.nameOcr.readNames(rgba, tb.slots);
        const m = topbar.matchNickname(d.ocrNames, nick);
        if (m) { d.slot = m.index; d.slotSource = 'nickname'; d.matchScore = m.score; return; }
      } catch (e) {
        this.nameOcrErr = e;
      }
    }
    const ms = ri.cal ? ri.cal.manualSlot : null;
    if (ms != null) { d.slot = ms; d.slotSource = 'manual'; d.matchScore = null; } else if (d.slotSource !== 'nickname') {
      d.slot = null; d.slotSource = null;
    }
  }

  identifyPortraits(img, tb, ri) {
    if (!tb || !this.matcher || !this.matcher.ready) return new Array(10).fill(null);
    return tb.slots.map((s) => {
      try { return this.matcher.identify(img.crop(s.portrait), ri.matchThreshold); } catch (e) { return null; }
    });
  }

  async readRole(img, ri) {
    try {
      const r = await this.ocr.readRole(this.crop(img, ri.regions.roleText, ri));
      this.roleHist.push(r.role);
      if (this.roleHist.length > 5) this.roleHist.shift();
      return majorityRole(this.roleHist);
    } catch (e) {
      this.ocrErr = e;
      return majorityRole(this.roleHist);
    }
  }

  wrap(id) { return this.heroes.get(id) || { heroId: id, name: '#' + id, img: '' }; }

  // ---- griglia eroi / ban ----------------------------------------------------
  heroesWithAttr() {
    return this.heroList.map((h) => ({ id: h.id, name: h.localized_name, attr: h.primary_attr }));
  }

  loadGridTemplates() {
    if (this.gridTpl) return this.gridTpl;
    this.gridTpl = new Map();
    try {
      const o = JSON.parse(fs.readFileSync(path.join(this.userDataDir, 'grid-templates.json'), 'utf8'));
      for (const [id, b64] of Object.entries(o.tpl || {})) {
        const g = Buffer.from(b64, 'base64');
        if (g.length !== TPL_W * TPL_H) continue;
        const data = Buffer.alloc(TPL_W * TPL_H * 4);
        for (let i = 0; i < g.length; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g[i]; data[i * 4 + 3] = 255; }
        this.gridTpl.set(Number(id), { data, width: TPL_W, height: TPL_H });
      }
    } catch (e) { /* nessun template salvato */ }
    return this.gridTpl;
  }

  learnTemplate(rgba, heroId, rect) {
    const small = png.resizeRgba(png.cropRgba(rgba, rect), TPL_W, TPL_H);
    const data = Buffer.alloc(TPL_W * TPL_H * 4);
    for (let i = 0; i < TPL_W * TPL_H; i++) {
      const j = i * 4;
      const l = Math.round(0.299 * small.data[j] + 0.587 * small.data[j + 1] + 0.114 * small.data[j + 2]);
      data[j] = data[j + 1] = data[j + 2] = l; data[j + 3] = 255;
    }
    const tpls = this.loadGridTemplates();
    if (!tpls.has(heroId)) this.gridTplDirty = true;
    tpls.set(heroId, { data, width: TPL_W, height: TPL_H });
  }

  saveGridTemplates() {
    if (!this.gridTplDirty || !this.gridTpl) return;
    this.gridTplDirty = false;
    const tpl = {};
    for (const [id, t] of this.gridTpl) {
      const g = Buffer.alloc(TPL_W * TPL_H);
      for (let i = 0; i < g.length; i++) g[i] = t.data[i * 4];
      tpl[id] = g.toString('base64');
    }
    try {
      fs.writeFileSync(path.join(this.userDataDir, 'grid-templates.json'), JSON.stringify({ v: 1, w: TPL_W, h: TPL_H, tpl }));
    } catch (e) { /* non bloccante */ }
  }

  /**
   * Contesto della griglia per questo frame: rettangolo, riquadri, mappa eroe->riquadro per ordine.
   * Aggiorna i bannati ricordati per la draft e impara i template dei riquadri disponibili.
   * @returns {null|{grid, tiles, byHero:Map, status:(heroId)=>string}}
   */
  buildGridContext(rgba, ri, tb) {
    let area = ri.cal && ri.cal.grid ? this.toPx(ri.cal.grid, ri, rgba.width, rgba.height) : null;
    if (!area) {
      // tutto lo schermo sotto la barra in alto
      const top = tb ? Math.min(rgba.height - 1, tb.frame.y + tb.frame.height) : Math.round(rgba.height * 0.08);
      area = { x: 0, y: top, width: rgba.width, height: rgba.height - top };
    }
    let t = null;
    try { t = heroGrid.findTiles(rgba, area); } catch (e) { t = null; }
    if (!t || t.tiles.length < 10) return null;
    const map = heroGrid.mapGridByOrder(rgba, t.grid, this.heroesWithAttr(), { tiles: t.tiles });
    const statusCache = new Map();
    const statusOfRect = (r) => {
      const k = r.x + ',' + r.y;
      if (!statusCache.has(k)) statusCache.set(k, heroGrid.tileStatus(rgba, r));
      return statusCache.get(k);
    };
    for (const [id, r] of map.byHero) {
      const st = statusOfRect(r);
      if (st === 'banned' || st === 'unavailable') this.draft.banned.add(id);
      else if (st === 'available') this.learnTemplate(rgba, id, r);
    }
    this.saveGridTemplates();
    const tpls = this.loadGridTemplates();
    const status = (heroId) => {
      let r = map.byHero.get(heroId);
      if (!r) {
        const tpl = tpls.get(heroId);
        if (!tpl) return 'notfound';
        const loc = heroGrid.locateHero(rgba, t.grid, tpl, { tiles: t.tiles, minScore: LOCATE_MIN, minMargin: LOCATE_MARGIN });
        if (!loc) return 'notfound';
        r = loc.rect;
      }
      return statusOfRect(r);
    };
    const canVerify = (heroId) => map.byHero.has(heroId) || tpls.has(heroId);
    return { grid: t.grid, tiles: t.tiles, byHero: map.byHero, mappedBlocks: map.mappedBlocks, status, canVerify };
  }

  /**
   * suggest con filtro ban: suggest({excluded}) -> verifica in griglia i candidati -> esclude
   * bannati/non disponibili/incerti -> ripete (max BAN_ROUNDS). Ritorna { suggestion, excluded, banCheck }.
   */
  suggestFiltered(input, gridCtx) {
    const eng = this.engine;
    const excluded = new Set(this.draft.banned);
    const call = () => {
      const opts = { count: CANDIDATES };
      try { return eng.suggest({ ...input, excluded: [...excluded] }, opts); } catch (e) {
        if (/data|dati|role|ruolo/i.test(e.message)) throw e;
        return eng.suggest({ ...input }, opts); // engine vecchio senza excluded: filtro sotto
      }
    };
    const shown = (s) => [s.top, ...(s.alternatives || []), s.wildcard].filter(Boolean).map((p) => p.heroId);
    let s = call();
    let banCheck = gridCtx ? 'ok' : 'off';
    if (gridCtx) {
      const first = (s.candidates && s.candidates.length ? s.candidates : [s.top, ...(s.alternatives || [])]).filter(Boolean);
      const verifiable = first.filter((p) => gridCtx.canVerify(p.heroId)).length;
      // griglia visibile ma nessun modo di riconoscere gli eroi (ordinamento diverso e nessun template):
      // escludere tutto renderebbe il consiglio inutile, quindi si segnala e si usano solo i bannati noti
      if (first.length && verifiable < first.length * 0.2) banCheck = 'unverified';
    }
    if (banCheck === 'ok') {
      for (let round = 0; round < BAN_ROUNDS; round++) {
        const cands = (s.candidates && s.candidates.length ? s.candidates : []).map((p) => p.heroId);
        const ids = [...new Set([...shown(s), ...cands])];
        let added = 0;
        for (const id of ids) {
          if (excluded.has(id)) continue;
          const st = gridCtx.status(id);
          if (st === 'available') continue;
          excluded.add(id); added++;
          if (st === 'banned' || st === 'unavailable') this.draft.banned.add(id);
        }
        if (!added) break;
        s = call();
        if (round === BAN_ROUNDS - 1) {
          // ultimo giro: niente nuova verifica possibile, togli comunque gli esclusi (engine vecchio)
          break;
        }
      }
    }
    s = this.stripExcluded(s, excluded);
    return { suggestion: s, excluded: [...excluded].sort((a, b) => a - b), banCheck };
  }

  /** Rete di sicurezza: nessun eroe escluso nell'output, anche con un engine che ignora `excluded`. */
  stripExcluded(s, excluded) {
    if (!s || !excluded.size) return s;
    const ok = (p) => p && !excluded.has(p.heroId);
    const pool = [s.top, ...(s.alternatives || [])].filter(ok);
    const out = { ...s, top: pool[0] || null, alternatives: pool.slice(1) };
    if (s.wildcard && !ok(s.wildcard)) out.wildcard = null;
    if (Array.isArray(s.candidates)) out.candidates = s.candidates.filter(ok);
    if (Array.isArray(s.teamNeeds)) {
      out.teamNeeds = s.teamNeeds.map((n) => (n && n.fix && n.fix.hero && excluded.has(n.fix.hero.heroId || n.fix.hero)
        ? { ...n, fix: { ...n.fix, hero: null } } : n));
    }
    if (!out.top && !out.message) out.message = 'Nessun eroe disponibile: tutti i candidati sono bannati o già scelti.';
    return out;
  }

  // ---- ciclo principale ------------------------------------------------------
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.state.steamId) { this.set({ status: 'setup', message: 'Inserisci il tuo Steam ID' }); return; }
      const userRank = await this.ensureProfile();
      if (!userRank) return;
      await this.ensureHeroes();
      await this.ensureMatcher();
      const ri = this.refreshRegions();

      let img = null, rgba = null;
      try {
        img = await this.capture();
        if (img) rgba = this.toRgba(img);
      } catch (e) {
        this.set({ status: 'error', message: 'Cattura schermo fallita: ' + e.message });
        return;
      }

      const tb = rgba ? this.findBar(rgba, ri) : null;
      const d = this.draft;
      if (!tb) {
        d.barMissing++;
        if (d.barMissing >= BAR_MISSING_RESET && (d.slot != null || d.banned.size)) this.resetDraft();
      } else {
        d.barMissing = 0;
      }
      if (tb && rgba) await this.resolveSlot(rgba, tb, ri);

      const portraits = img ? this.identifyPortraits(img, tb, ri) : new Array(10).fill(null);
      const picks = portraits.filter(Boolean).length;
      if (d.hadPicks && picks === 0 && tb) {
        // la barra si e' svuotata: nuova draft
        const keep = { ocrNames: d.ocrNames };
        this.resetDraft();
        Object.assign(this.draft, keep);
        if (rgba) await this.resolveSlot(rgba, tb, ri);
      }
      this.draft.hadPicks = picks > 0;
      const slot = this.draft.slot;
      const mySide = slot != null ? topbar.sideOf(slot) : null;
      const sideIdx = (side) => (side === 'radiant' ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]);
      let allies = [], enemies = [], myId = null;
      if (mySide) {
        const other = mySide === 'radiant' ? 'dire' : 'radiant';
        allies = sideIdx(mySide).filter((i) => i !== slot).map((i) => portraits[i]).filter(Boolean);
        enemies = sideIdx(other).map((i) => portraits[i]).filter(Boolean);
        myId = portraits[slot] || null;
        allies = allies.filter((x) => x !== myId);
      }

      const role0 = img ? await this.readRole(img, ri) : null;
      if (this.manualRole) {
        const draftSig = JSON.stringify([allies, enemies, myId]);
        if (this.manualPending) {
          this.manualBase = { ocr: role0, draft: draftSig };
          this.manualPending = false;
        } else if ((role0 && role0 !== this.manualBase.ocr) || draftSig !== this.manualBase.draft) {
          this.manualRole = null; // OCR ha rilevato un nuovo draft/ruolo
        }
      }
      const role = this.manualRole || role0;
      const lobby = lobbyRankTier(userRank, []); // rank avversari ignoto: usa rank utente

      // griglia: aggiorna i bannati della draft (anche prima di avere un ruolo)
      let gridCtx = null;
      if (tb && rgba) { try { gridCtx = this.buildGridContext(rgba, ri, tb); } catch (e) { gridCtx = null; } }

      const base = {
        rankTier: userRank, lobbyRankTier: lobby, role,
        allies: allies.map((i) => this.wrap(i)),
        enemies: enemies.map((i) => this.wrap(i)),
        myHero: myId ? this.wrap(myId) : null,
        matchEstimate: null,
        nickname: this.state.nickname, mySide, mySlot: slot,
        excluded: [...this.draft.banned].sort((a, b) => a - b),
      };

      if (!tb) {
        const sig = 'idle';
        if (sig !== this.lastSig) {
          this.lastSig = sig;
          this.set({ ...base, suggestion: null, status: 'waiting',
            message: this.matcher ? 'In attesa del draft...' : 'Preparo il riconoscimento eroi...' });
        }
        return;
      }
      if (!mySide) {
        const sig = JSON.stringify(['noslot', this.state.nickname]);
        if (sig !== this.lastSig) {
          this.lastSig = sig;
          this.set({ ...base, suggestion: null, status: 'waiting',
            message: this.state.nickname
              ? 'Non trovo "' + this.state.nickname + '" nella barra in alto: premi F10 e indica il tuo slot'
              : 'Nickname non disponibile dal profilo: premi F10 e indica il tuo slot' });
        }
        return;
      }

      const sig = JSON.stringify([allies, enemies, myId, role, lobby, this.engineLoadedFor, slot, base.excluded, !!gridCtx]);
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
          await this.engine.ensureMatchups(enemies);
        }
        if (typeof this.engine.ensureStratz === 'function') {
          const all10 = [...allies, ...(myId ? [myId] : []), ...enemies];
          await this.engine.ensureStratz(all10, lobby)
            .catch(() => {}); // provider opzionale: senza token o in errore resta l'euristica
        }
        const { suggestion, excluded, banCheck } = this.suggestFiltered({ allies, enemies, role, rankTier: lobby }, gridCtx);
        // stima di vittoria: solo a draft completo (4 alleati + myHero, 5 nemici)
        let matchEstimate = null;
        if (allies.length === 4 && myId && enemies.length === 5 && typeof this.engine.estimateMatch === 'function') {
          try {
            matchEstimate = (await this.engine.estimateMatch({ allies: [...allies, myId], enemies, rankTier: lobby })) || null;
          } catch (e) { matchEstimate = null; }
        }
        this.lastSig = sig;
        const message = banCheck === 'unverified'
          ? 'Ban non verificabili: ordina la griglia eroi per attributi'
          : undefined;
        this.set({ ...base, excluded, suggestion, matchEstimate, status: 'draft', message, banCheck });
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
      nickname: this.state.nickname,
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

  /** cal:init -> dati per la finestra di calibrazione (rect in DIP). */
  getCalibrationV2() {
    const ri = this.refreshRegions();
    return {
      width: ri.width, height: ri.height, scaleFactor: ri.scaleFactor, aspect: ri.aspect,
      saved: ri.cal ? { topBar: ri.cal.topBar, grid: ri.cal.grid, manualSlot: ri.cal.manualSlot } : null,
      nickname: this.state.nickname || null, steamId: this.state.steamId || null,
    };
  }

  /** cal:auto -> rilevamento automatico su una cattura fresca (rect in DIP). */
  async calAutoDetect() {
    const ri = this.refreshRegions();
    const out = {
      ok: false, width: ri.width, height: ri.height, topBar: null, slots: [], confidence: 0, grid: null,
      nickname: this.state.nickname || null, ocrNames: new Array(10).fill(null), mySlot: null, side: null,
      slotSource: null, matchScore: null, manualSlot: ri.cal ? ri.cal.manualSlot : null, notes: [],
    };
    let img = null;
    try { img = await this.capture(); } catch (e) { /* sotto */ }
    if (!img) { out.error = 'Cattura dello schermo non riuscita'; return out; }
    const rgba = this.toRgba(img);
    const W = rgba.width, H = rgba.height;
    const dip = (r) => this.toDip(r, ri, W, H);
    let tb = null;
    try { tb = topbar.findTopBar(rgba); } catch (e) { tb = null; }
    if (tb) {
      out.topBar = dip(tb.frame);
      out.confidence = tb.confidence;
      out.slots = tb.slots.map((s) => ({ index: s.index, side: s.side, bar: dip(s.bar), portrait: dip(s.portrait), name: dip(s.name), found: s.found }));
      const nf = tb.slots.filter((s) => s.found).length;
      if (nf < 10) out.notes.push(`Trovate ${nf} lineette su 10: le altre sono ricostruite per simmetria`);
    } else {
      out.notes.push('Barra degli eroi non trovata: apri la schermata del draft e premi "Rileva di nuovo"');
    }
    try {
      const g = heroGrid.findHeroGrid(rgba);
      out.grid = dip(g);
      if (!g) out.notes.push('Griglia eroi non visibile: il filtro dei ban la cerca da solo durante la draft');
    } catch (e) { out.notes.push('Griglia eroi non analizzabile'); }
    if (tb) {
      if (!this.state.nickname) {
        out.notes.push('Nickname non disponibile da OpenDota (profilo privato?): indica il tuo slot');
      } else {
        try {
          out.ocrNames = await this.nameOcr.readNames(rgba, tb.slots);
          const m = topbar.matchNickname(out.ocrNames, this.state.nickname);
          if (m) {
            out.mySlot = m.index; out.side = topbar.sideOf(m.index); out.slotSource = 'nickname'; out.matchScore = m.score;
            // aggiorna subito la draft corrente
            Object.assign(this.draft, { slot: m.index, slotSource: 'nickname', matchScore: m.score, ocrNames: out.ocrNames });
            this.lastSig = '';
          } else {
            out.notes.push('Nickname "' + this.state.nickname + '" non trovato tra i nomi letti: indica il tuo slot');
          }
        } catch (e) {
          out.notes.push('Lettura dei nomi non disponibile: ' + String(e && e.message).slice(0, 80));
        }
      }
      if (out.mySlot == null && out.manualSlot != null) {
        out.mySlot = out.manualSlot; out.side = topbar.sideOf(out.manualSlot); out.slotSource = 'manual';
      }
    }
    out.ok = !!tb;
    if (!out.ok) out.error = 'Barra degli eroi non trovata';
    return out;
  }

  /** cal:save -> { topBar, grid, manualSlot } in DIP (null = automatico); p null = cancella. */
  saveCalibrationV2(p) {
    const d = this.screen.getPrimaryDisplay();
    const key = layout.resolutionKey(d.size.width, d.size.height, d.scaleFactor || 1);
    try {
      regionsIo.saveCalV2(this.userDataDir, key, p || null, d.size.width, d.size.height);
    } catch (e) { return { ok: false, error: 'Salvataggio non riuscito' }; }
    this.refreshRegions();
    // il manualSlot nuovo vale subito, a meno che il nickname sia gia' stato trovato
    if (this.draft.slotSource !== 'nickname') { this.draft.slot = null; this.draft.slotSource = null; }
    this.lastSig = '';
    this.pushSettings();
    this.tick();
    return { ok: true };
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
    await this.nameOcr.terminate();
  }
}

module.exports = { Controller };
