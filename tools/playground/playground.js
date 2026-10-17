(function () {
  var RANKS = [['Araldo', 15], ['Guardiano', 25], ['Crociato', 35], ['Arconte', 45], ['Leggenda', 55], ['Antico', 65], ['Divino', 75], ['Immortale', 85]];
  var MAX = { allies: 4, enemies: 5 };
  var s = { rankTier: 55, role: 1, allies: [], enemies: [], myHero: null, estimate: null, target: 'enemies', heroes: [], byId: {}, last: null, ready: false, verdicts: {}, needs: null, overall: null };
  var $ = function (id) { return document.getElementById(id); };
  var frame = $('frame');

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  // rank e ruolo
  RANKS.forEach(function (r) { $('rank').appendChild(el('option', { value: r[1], text: r[0], selected: r[1] === s.rankTier ? 'selected' : false })); });
  $('rank').addEventListener('change', function () { s.rankTier = Number(this.value); recalc(); });
  [1, 2, 3, 4, 5].forEach(function (n) {
    $('roles').appendChild(el('button', { type: 'button', 'data-r': n, 'aria-pressed': String(n === s.role), text: 'Pos ' + n, onclick: function () { setRole(n); } }));
  });
  function setRole(n) {
    s.role = n;
    [].forEach.call($('roles').children, function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.r) === n)); });
    recalc();
  }
  [].forEach.call($('target').children, function (b) {
    b.addEventListener('click', function () {
      s.target = b.dataset.t;
      [].forEach.call($('target').children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
  });

  // eroi
  function renderSides() {
    ['allies', 'enemies'].forEach(function (side) {
      var box = $(side); box.textContent = '';
      s[side].forEach(function (id) {
        var h = s.byId[id];
        box.appendChild(el('div', { class: 'chip' }, [
          el('img', { src: h.img, alt: h.name, title: h.name }),
          el('button', { type: 'button', 'aria-label': 'Togli ' + h.name, text: '×', onclick: function () { s[side] = s[side].filter(function (x) { return x !== id; }); update(); } })
        ]));
      });
    });
    // il tuo eroe (scelto con "Scegli" dai suggerimenti) compare tra gli alleati, bordato d'ambra
    if (s.myHero) {
      var mh = s.byId[s.myHero];
      $('allies').appendChild(el('div', { class: 'chip mine', title: 'Il tuo eroe: ' + mh.name }, [
        el('img', { src: mh.img, alt: 'Il tuo eroe: ' + mh.name }),
        el('button', { type: 'button', 'aria-label': 'Togli il tuo eroe ' + mh.name, text: '×', onclick: function () { s.myHero = null; update(); } })
      ]));
    }
    $('ally-count').textContent = s.allies.length + '/4' + (s.myHero ? ' + tu' : '');
    $('enemy-count').textContent = s.enemies.length + '/5';
  }
  function renderGrid() {
    var q = $('search').value.trim().toLowerCase();
    var grid = $('grid'); grid.textContent = '';
    var taken = s.allies.concat(s.enemies, s.myHero ? [s.myHero] : []);
    s.heroes.filter(function (h) { return !q || h.name.toLowerCase().indexOf(q) >= 0; }).forEach(function (h) {
      grid.appendChild(el('button', {
        type: 'button', role: 'listitem', title: h.name, disabled: taken.indexOf(h.id) >= 0 ? 'disabled' : false,
        'aria-label': 'Aggiungi ' + h.name,
        onclick: function () {
          pickHero(h.id);
        }
      }, [el('img', { src: h.img, alt: '', loading: 'lazy' }), el('span', { text: h.name })]));
    });
  }
  // mette l'eroe nel gruppo scelto o, se e' pieno, nell'altro; il tuo eroe si sceglie solo con "Scegli" sui suggerimenti
  function pickHero(id) {
    if (s.allies.concat(s.enemies).indexOf(id) >= 0 || s.myHero === id) return;
    var order = s.target === 'allies' ? ['allies', 'enemies'] : ['enemies', 'allies'];
    for (var i = 0; i < order.length; i++) {
      if (s[order[i]].length < MAX[order[i]]) { s[order[i]].push(id); update(); return; }
    }
  }
  $('search').addEventListener('input', renderGrid);
  $('search').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var b = $('grid').querySelector('button:not([disabled])'); if (b) { b.click(); this.value = ''; renderGrid(); } }
  });
  $('clear').addEventListener('click', function () { s.allies = []; s.enemies = []; s.myHero = null; update(); });
  $('random-full').addEventListener('click', function () {
    var pool = s.heroes.map(function (h) { return h.id; }).sort(function () { return Math.random() - 0.5; });
    s.allies = pool.slice(0, 4); s.myHero = pool[4]; s.enemies = pool.slice(5, 10);
    s.rankTier = RANKS[Math.floor(Math.random() * RANKS.length)][1]; $('rank').value = s.rankTier;
    setRole(1 + Math.floor(Math.random() * 5));
    update();
  });
  $('random').addEventListener('click', function () {
    var pool = s.heroes.map(function (h) { return h.id; }).sort(function () { return Math.random() - 0.5; });
    var na = Math.floor(Math.random() * 5), ne = 1 + Math.floor(Math.random() * 5);
    s.allies = pool.slice(0, na); s.enemies = pool.slice(na, na + ne); s.myHero = null;
    s.rankTier = RANKS[Math.floor(Math.random() * RANKS.length)][1]; $('rank').value = s.rankTier;
    setRole(1 + Math.floor(Math.random() * 5));
    update();
  });

  function update() { renderSides(); renderGrid(); recalc(); }

  // calcolo e overlay
  var timer = null, seq = 0;
  function recalc() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!s.allies.length && !s.enemies.length) { s.last = null; pushState({ status: 'waiting', steamId: 'test', rankTier: s.rankTier, allies: [], enemies: [], role: s.role, suggestion: null }); renderEval(); return; }
      var my = ++seq;
      fetch('/api/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allies: s.allies, enemies: s.enemies, myHero: s.myHero, role: s.role, rankTier: s.rankTier }) })
        .then(function (r) { return r.json(); })
        .then(function (st) {
          if (my !== seq) return;
          if (st.error) { $('provider').textContent = 'Errore del motore: ' + st.error; return; }
          s.last = st; pushState(st); renderEval();
          var p = st.provider;
          $('provider').textContent = p && p.stratz ? 'Dati: OpenDota + STRATZ (sinergia e counter per rank).' : 'Dati: OpenDota (sinergia stimata, STRATZ non attivo).';
        })
        .catch(function (e) { $('provider').textContent = 'Server non raggiungibile: ' + e.message; });
    }, 250);
  }
  function pushState(st) { if (s.ready) frame.contentWindow.postMessage({ type: 'dp-state', state: st }, '*'); }
  // l'iframe puo' caricarsi prima di questo script e perdere 'dp-ready': consideralo pronto anche al load
  function onFrameReady() { s.ready = true; if (s.last) pushState(s.last); }
  frame.addEventListener('load', onFrameReady);
  if (frame.contentDocument && frame.contentDocument.readyState === 'complete' && frame.contentWindow.api) onFrameReady();
  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow || !ev.data) return;
    if (ev.data.type === 'dp-ready') { s.ready = true; if (s.last) pushState(s.last); else recalc(); }
    if (ev.data.type === 'dp-setRole' && ev.data.role) setRole(Number(ev.data.role));
    // "Scegli" su un suggerimento dell'overlay: diventa il tuo eroe
    if (ev.data.type === 'dp-pick' && ev.data.heroId && s.byId[ev.data.heroId]) { s.myHero = Number(ev.data.heroId); update(); }
  });

  // valutazione
  function verdictRow(key) {
    var seg = el('div', { class: 'seg verdict', role: 'group', 'aria-label': 'Giudizio' });
    [['giusto', 'Giusto'], ['discutibile', 'Discutibile'], ['sbagliato', 'Sbagliato']].forEach(function (v) {
      seg.appendChild(el('button', {
        type: 'button', 'data-v': v[0], 'aria-pressed': String(s.verdicts[key] === v[0]), text: v[1],
        onclick: function () { s.verdicts[key] = v[0]; [].forEach.call(seg.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v[0])); }); }
      }));
    });
    return seg;
  }
  function renderEval() {
    var sug = s.last && s.last.suggestion;
    $('eval').hidden = !sug; $('eval-empty').hidden = !!sug;
    s.verdicts = {};
    var box = $('picks'); box.textContent = '';
    if (!sug) return;
    var list = [['top', 'Miglior pick', sug.top]].concat((sug.alternatives || []).map(function (a, i) { return ['alt' + (i + 1), 'Alternativa ' + (i + 1), a]; }));
    if (sug.wildcard) list.push(['jolly', 'Jolly', sug.wildcard]);
    list.forEach(function (it) {
      var p = it[2]; if (!p) return;
      var title = p.teamOnly ? 'Serve alla squadra: ' + (p.needLabel || '') : p.name;
      var sub = it[0] === 'jolly' ? (p.text || '') : 'Punteggio ' + p.score + ' · winrate atteso ' + (p.expectedWinrate != null ? p.expectedWinrate + '%' : '—');
      box.appendChild(el('div', { class: 'pick' + (it[0] === 'jolly' ? ' wild' : '') }, [
        el('div', { class: 'pick-head' }, [p.img ? el('img', { src: p.img, alt: '' }) : null, el('div', {}, [el('small', { text: it[1] }), el('b', { text: title }), el('small', { text: sub })])]),
        verdictRow(it[0])
      ]));
    });
    // lacune Mancante/Scarso con chi le copre e gli oggetti
    var gaps = (sug.teamNeeds || []).filter(function (n) { return n.note === 'Mancante' || n.note === 'Scarso'; });
    var ul = $('gaps'); ul.textContent = '';
    $('gaps-box').hidden = !gaps.length; $('fixes-q').hidden = !gaps.length;
    var inTop = [sug.top].concat(sug.alternatives).map(function (p) { return p.heroId; });
    gaps.forEach(function (n) {
      var f = n.fix || {};
      var kids = [el('div', { class: 'gh' }, [el('span', { text: n.label + (n.threat && n.threat.length ? ' (contro ' + n.threat.slice(0, 3).join(', ') + ')' : '') }),
        el('span', { class: 'tag ' + (n.note === 'Mancante' ? 'miss' : 'weak'), text: n.note === 'Mancante' ? 'Manca' : 'Scarso' })])];
      if (f.hero) {
        var already = inTop.indexOf(f.hero.heroId) >= 0;
        kids.push(el('div', { class: 'fx' }, [el('img', { src: f.hero.img, alt: '' }), el('span', { text: 'Eroe: ' + f.hero.name + (already ? ' (già tra i consigli)' : ' (−' + String(f.hero.winrateGap).replace('.', ',') + ' punti)') })]));
      }
      if (f.items) kids.push(el('div', { class: 'it' }, [el('span', { text: 'Oggetti: ' }), el('b', { text: Array.isArray(f.items) ? f.items.join(', ') : f.items })]));
      if (!f.hero && !f.items) kids.push(el('div', { class: 'it', text: f.text || 'Nessuna soluzione proposta.' }));
      ul.appendChild(el('li', {}, kids));
    });
    s.fixes = null;
    [].forEach.call(document.querySelectorAll('[data-q="fixes"] button'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    // stima di vittoria (solo a draft completa)
    var est = s.last.matchEstimate;
    $('estimate-q').hidden = !est;
    if (est) $('estimate-label').textContent = 'Stima di vittoria ' + String(est.winProbability).replace('.', ',') + '%: ti sembra plausibile?';
    s.estimate = null;
    [].forEach.call(document.querySelectorAll('[data-q="estimate"] button'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    $('saved').textContent = '';
  }
  ['needs', 'overall', 'fixes', 'estimate'].forEach(function (q) {
    var seg = document.querySelector('[data-q="' + q + '"]');
    [].forEach.call(seg.children, function (b) {
      b.addEventListener('click', function () { s[q] = b.dataset.v; [].forEach.call(seg.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });
    });
  });
  $('eval').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!s.last) return;
    var sug = s.last.suggestion;
    var entry = {
      matchEstimate: s.last.matchEstimate ? { winProbability: s.last.matchEstimate.winProbability, judged: s.estimate } : null,
      draft: { rankTier: s.rankTier, role: s.role, myHero: s.myHero ? s.byId[s.myHero].name : null, allies: s.allies.map(function (i) { return s.byId[i].name; }), enemies: s.enemies.map(function (i) { return s.byId[i].name; }) },
      suggested: { top: sug.top.name, alternatives: sug.alternatives.map(function (a) { return a.name; }), wildcard: sug.wildcard ? (sug.wildcard.name || ('squadra: ' + sug.wildcard.needLabel)) : null,
        teamNeeds: sug.teamNeeds.map(function (n) { return n.label + ': ' + n.note + (n.fix && n.fix.text ? ' | ' + n.fix.text : ''); }) },
      verdicts: s.verdicts, needsCorrect: s.needs, fixesUseful: s.fixes, overall: s.overall ? Number(s.overall) : null,
      better: $('better').value.trim() || null, note: $('note').value.trim() || null
    };
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) })
      .then(function (r) { return r.json(); })
      .then(function (r) { $('saved').textContent = 'Salvata. Valutazioni totali: ' + r.count + '.'; $('note').value = ''; $('better').value = ''; })
      .catch(function (err) { $('saved').textContent = 'Non salvata: ' + err.message; });
  });

  // aggiornamenti dal server: motore ricaricato -> ricalcola; renderer o banco cambiati -> ricarica la pagina
  try {
    var es = new EventSource('/api/events');
    es.onmessage = function (ev) {
      if (ev.data === 'engine') { recalc(); $('provider').textContent = 'Motore aggiornato: consigli ricalcolati.'; }
      if (ev.data === 'reload') {
        try { sessionStorage.setItem('dp-draft', JSON.stringify({ allies: s.allies, enemies: s.enemies, myHero: s.myHero, role: s.role, rankTier: s.rankTier })); } catch (e) {}
        location.reload();
      }
    };
  } catch (e) { /* senza aggiornamenti automatici */ }

  fetch('/api/heroes').then(function (r) { return r.json(); }).then(function (list) {
    s.heroes = list; list.forEach(function (h) { s.byId[h.id] = h; $('hero-names').appendChild(el('option', { value: h.name })); });
    // dopo una ricarica automatica ripristina la draft che stavi provando
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('dp-draft') || 'null'); sessionStorage.removeItem('dp-draft'); } catch (e) {}
    if (saved) {
      s.allies = saved.allies.filter(function (i) { return s.byId[i]; }); s.enemies = saved.enemies.filter(function (i) { return s.byId[i]; });
      s.myHero = saved.myHero && s.byId[saved.myHero] ? saved.myHero : null;
      s.rankTier = saved.rankTier; $('rank').value = s.rankTier; setRole(saved.role); renderSides();
    }
    renderGrid();
  });
  fetch('/api/feedback').then(function (r) { return r.json(); }).then(function (a) { if (a.length) $('saved').textContent = 'Valutazioni già salvate: ' + a.length + '.'; });
})();
