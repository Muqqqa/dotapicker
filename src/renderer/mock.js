/* Mock di window.api: attivo solo con index.html?mock=1. Nessuna dipendenza da Electron. */
(function () {
  if (!/[?&]mock=1\b/.test(location.search)) return;
  var CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/';
  function h(id, name, internal) { return { heroId: id, name: name, img: CDN + internal + '.png' }; }
  function pick(id, name, internal, score, wr, counter, syn, reasons) {
    var p = h(id, name, internal); p.score = score; p.winrate = wr; p.counter = counter; p.synergy = syn; p.reasons = reasons; return p;
  }
  function altC(p, exp, covers) { p.expectedWinrate = exp; p.covers = covers; return p; }
  var suggestion = {
    top: pick(26, 'Lion', 'lion', 87, 52.4, 53, 52, [
      'Disable a bersaglio singolo (Hex, Earth Spike): alla tua squadra manca controllo.',
      'Forte contro Anti-Mage e Juggernaut, che hai tra i nemici.',
      'Sinergia con Axe e Sven: incantesimo di setup per i loro engage.',
      'Winrate sopra la media nel tuo rank lobby.'
    ]),
    alternatives: [
      altC(pick(27, 'Shadow Shaman', 'shadow_shaman', 81, 51.8, 57, 52, ['Winrate atteso in questa draft: 52,6%', 'Controllo a catena e ottimo push.', 'Buono contro eroi mobili.', 'Rinforzato dall\u2019ultimo aggiornamento.']), 52.6, ['disable', 'push']),
      altC(pick(97, 'Magnus', 'magnataur', 76, 53.0, 51, 55, ['Winrate atteso in questa draft: 51,3%', 'Iniziazione di area con Reverse Polarity.', 'Eroe complesso: richiede timing preciso.']), 51.3, ['initiation']),
      altC(pick(29, 'Tidehunter', 'tidehunter', 72, 51.5, 52, 54, ['Winrate atteso in questa draft: 51,0%', 'Ravage decide i teamfight.', 'Buona sinergia con i tuoi carry.', 'Indebolito dall’ultimo aggiornamento.']), 51.0, ['initiation', 'disable']),
      altC(pick(50, 'Dazzle', 'dazzle', 69, 52.2, 50, 51, ['Winrate atteso in questa draft: 52,0%', 'Cura e salvataggio per la squadra.', 'Shallow Grave contro il burst.']), 52.0, ['healing']),
      altC(pick(84, 'Ogre Magi', 'ogre_magi', 67, 51.7, 51, 50, ['Winrate atteso in questa draft: 50,8%', 'Stun affidabile e danno magico.', 'Semplice da giocare.']), 50.8, ['disable', 'magic'])
    ],
    teamNeeds: [
      { key: 'disable', label: 'Controllo', level: 0.15, note: 'Mancante' },
      { key: 'initiation', label: 'Iniziazione', level: 0.7, note: 'Coperta da Axe' },
      { key: 'magic', label: 'Danno magico', level: 0.3, note: 'Scarso' },
      { key: 'push', label: 'Push', level: 0.0, note: 'Mancante' },
      { key: 'healing', label: 'Cura / sostegno', level: 0.55, note: 'Sufficiente' },
      { key: 'carry', label: 'Late game', level: 0.9, note: 'Coperto da Sven' }
    ]
  };
  suggestion.top.covers = ['disable'];
  suggestion.teamNeeds[0].fix = { hero: { heroId: 27, name: 'Shadow Shaman', img: CDN + 'shadow_shaman.png', expectedWinrate: 52.6, winrateGap: 0 }, items: null, text: 'Shadow Shaman è già tra i consigli.' };
  suggestion.teamNeeds[2].fix = { hero: { heroId: 22, name: 'Zeus', img: CDN + 'zeus.png', expectedWinrate: 49.6, winrateGap: 2.8 }, items: 'Kaya, Veil of Discord', text: 'Danno magico da Zeus.' };
  suggestion.teamNeeds[3].fix = { hero: null, items: 'Mjollnir, Battle Fury', text: 'Nessun eroe vale il push: compra gli oggetti.' };
  suggestion.wildcard = { heroId: 8, name: 'Juggernaut', img: CDN + 'juggernaut.png', needKey: 'push', needLabel: 'Push', needKeys: ['push', 'healing', 'magicres'], needLabels: ['Push', 'Cura', 'Resistenza magica'],
    expectedWinrate: 50.4, winrateGap: 2.0, items: ['Mjollnir'], text: 'Juggernaut copre push, cura (Healing Ward) e resistenza magica (Blade Fury) insieme.', teamOnly: false };
  var base = {
    steamId: '76561198000000000', rankTier: 54, lobbyRankTier: 55, role: 4,
    myHero: h(5, 'Crystal Maiden', 'crystal_maiden'),
    allies: [h(2, 'Axe', 'axe'), h(18, 'Sven', 'sven'), h(129, 'Mars', 'mars')],
    enemies: [h(1, 'Anti-Mage', 'antimage'), h(8, 'Juggernaut', 'juggernaut'), h(74, 'Invoker', 'invoker'), h(14, 'Pudge', 'pudge')],
    suggestion: suggestion, status: 'draft'
  };
  var broken = JSON.parse(JSON.stringify(base)); // eroe con immagine rotta per testare il fallback
  var variants = {
    setup: { steamId: null, rankTier: null, lobbyRankTier: null, role: null, allies: [], enemies: [], myHero: null, suggestion: null, status: 'setup' },
    waiting: { steamId: base.steamId, rankTier: 54, lobbyRankTier: null, role: null, allies: [], enemies: [], myHero: null, suggestion: null, status: 'waiting' },
    draft: base,
    early: Object.assign({}, base, { role: null, allies: [], enemies: [h(1, 'Anti-Mage', 'antimage')], suggestion: null, myHero: null }),
    broken: (function () { broken.allies[0].img = 'https://invalid.example/x.png'; broken.enemies[1].img = ''; return broken; })(),
    error: Object.assign({}, base, { suggestion: null, status: 'error', message: 'Impossibile scaricare i dati da OpenDota. Controlla la connessione.' })
  };
  variants.fine = Object.assign({}, base, { allies: [h(2, 'Axe', 'axe'), h(18, 'Sven', 'sven'), h(129, 'Mars', 'mars'), h(5, 'Crystal Maiden', 'crystal_maiden'), h(26, 'Lion', 'lion')],
    enemies: [h(1, 'Anti-Mage', 'antimage'), h(8, 'Juggernaut', 'juggernaut'), h(74, 'Invoker', 'invoker'), h(14, 'Pudge', 'pudge'), h(22, 'Zeus', 'zuus')],
    matchEstimate: { winProbability: 54.2, low: 50.1, high: 58.3, confidence: 'media', factors: [{ text: 'Più controllo della squadra avversaria', impact: 2.1 }, { text: 'Sinergia Axe + Sven', impact: 1.2 }, { text: 'Nessuna detection contro Riki', impact: -0.8 }, { text: 'Rank lobby alto, dati scarsi', impact: -0.3 }], note: 'Stima indicativa basata sui winrate per rank; non tiene conto di abilità dei giocatori.' } });
  /* Schermate 'jolly': nemici invisibili, con jolly eroe e solo-squadra */
  var invisEnemies = [h(32, 'Riki', 'riki'), h(62, 'Bounty Hunter', 'bounty_hunter'), h(56, 'Clinkz', 'clinkz')];
  function jollySug(w) {
    var s = JSON.parse(JSON.stringify(suggestion));
    s.teamNeeds = s.teamNeeds.slice(0, 2).concat([
      { key: 'detection', label: 'Detection', level: 0.0, note: 'Mancante', threat: ['Riki', 'Bounty Hunter', 'Clinkz'] },
      { key: 'aoe', label: 'Danno ad area', level: 0.4, note: 'Scarso', threat: ['Clinkz'] },
      { key: 'antiheal', label: 'Anti-cura', level: null, note: 'Da definire' },
      { key: 'healing', label: 'Cura / sostegno', level: 0.2, note: 'Sufficiente' }
    ]);
    s.wildcard = w; return s;
  }
  variants.jolly = Object.assign({}, base, { enemies: invisEnemies, suggestion: jollySug({
    heroId: 22, name: 'Zeus', img: CDN + 'zeus.png', needKey: 'detection', needLabel: 'Detection', expectedWinrate: 49.6, winrateGap: 2.8, items: ['Sentry Ward', 'Dust of Appearance'],
    text: 'Zeus rivela gli eroi invisibili con Thundergod\u2019s Wrath: prendi anche Dust e Sentry.', teamOnly: false }) });
  variants.jollyTeam = Object.assign({}, base, { enemies: invisEnemies, suggestion: jollySug({
    heroId: null, name: null, img: null, needKey: 'detection', needLabel: 'Detection', expectedWinrate: null, winrateGap: null, items: ['Dust of Appearance'],
    text: 'Nessun eroe vale il sacrificio di winrate: compra Dust e Sentry in squadra.', teamOnly: true }) });

  var mockSettings = { steamId: null, rankTier: null, resolution: '2560x1440', scaleFactor: 1.25, regionsSource: 'preset', stratz: { configured: false, ok: null, error: null } }, setCbs = [];
  var embed = /[?&]embed=1\b/.test(location.search);
  var cur = 'setup', cbs = [];
  if (embed) {
    var embState = { steamId: base.steamId, rankTier: null, lobbyRankTier: null, role: null, allies: [], enemies: [], myHero: null, suggestion: null, status: 'waiting' };
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.type !== 'dp-state' || !d.state) return;
      embState = d.state; cbs.forEach(function (f) { f(JSON.parse(JSON.stringify(embState))); });
    });
    window.api = {
      getState: function () { return Promise.resolve(JSON.parse(JSON.stringify(embState))); },
      onState: function (cb) { cbs.push(cb); },
      saveSteamId: function () { return Promise.resolve({ ok: true }); },
      setRole: function (r) { parent.postMessage({ type: 'dp-setRole', role: r }, '*'); return Promise.resolve(); },
      // solo nel banco di prova: "Scegli" su un suggerimento lo rende il tuo eroe
      pickHero: function (id) { parent.postMessage({ type: 'dp-pick', heroId: id }, '*'); return Promise.resolve(); }
    };
    parent.postMessage({ type: 'dp-ready' }, '*');
    return;
  }
  var m = location.search.match(/[?&]screen=(\w+)/); if (m && variants[m[1]]) cur = m[1]; else cur = 'draft';
  function state() { return JSON.parse(JSON.stringify(variants[cur])); }
  function emit() { cbs.forEach(function (f) { f(state()); }); }
  window.api = {
    getState: function () { return Promise.resolve(state()); },
    onState: function (cb) { cbs.push(cb); },
    saveSteamId: function (id) {
      variants.setup.steamId = id; variants.waiting.steamId = id; if (cur === 'setup') { cur = 'waiting'; emit(); } return Promise.resolve({ ok: true });
    },
    setRole: function (r) { variants[cur].role = r; return Promise.resolve(); },
    getSettings: function () { return Promise.resolve(JSON.parse(JSON.stringify(mockSettings))); },
    onSettings: function (cb) { setCbs.push(cb); },
    saveStratzToken: function (t) {
      mockSettings.stratz = t ? (t === 'bad' ? { configured: true, ok: false, error: 'token rifiutato da STRATZ' } : { configured: true, ok: true, error: null }) : { configured: false, ok: null, error: null };
      setCbs.forEach(function (f) { f(JSON.parse(JSON.stringify(mockSettings))); }); return Promise.resolve({ ok: true });
    },
    startCalibration: function () {
      mockSettings.regionsSource = 'utente';
      setCbs.forEach(function (f) { f(JSON.parse(JSON.stringify(mockSettings))); }); return Promise.resolve({ ok: true });
    }
  };
  window.__mock = { screens: Object.keys(variants), go: function (k) { cur = k; emit(); }, current: function () { return cur; } };
})();

