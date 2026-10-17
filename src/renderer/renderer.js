(function () {
  'use strict';
  var app = document.getElementById('app');
  var state = null, manualRole = null, lastDetected = undefined, lastSig = '';
  var TIERS = ['', 'Araldo', 'Guardiano', 'Crociato', 'Arconte', 'Leggenda', 'Antico', 'Divino', 'Immortale'];
  var ROLE_NAMES = { 1: 'Carry', 2: 'Mid', 3: 'Offlane', 4: 'Supporto', 5: 'Supporto 5' };

  function rankLabel(t) {
    if (t == null) return '—';
    var major = Math.floor(t / 10), minor = t % 10;
    if (!TIERS[major]) return '—';
    return TIERS[major] + (major < 8 && minor ? ' ' + minor : '');
  }
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function fmt(n, d) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d == null ? 1 : d); }
  function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }
  /* L'engine da' counter e sinergia su scala 0-100 con 50 neutro: mostrali come scarto dal neutro. */
  function delta(n) { return n == null ? null : n - 50; }
  function signedDelta(n) { var d = delta(n); return d == null ? '—' : (d > 0 ? '+' : '') + fmt(d, 0); }

  /* Tile eroe: immagine, con fallback a riquadro neutro + nome (mai sigle). */
  function heroTile(h, extra) {
    var t = el('div', { class: 'hero ' + (extra || '') });
    if (!h) { t.classList.add('empty'); t.setAttribute('aria-label', 'Slot vuoto'); t.appendChild(el('span', { text: '?' })); return t; }
    var name = h.name || 'Eroe';
    t.title = name;
    function fallback() { t.textContent = ''; t.appendChild(el('span', { class: 'fallback', text: name })); }
    if (!h.img) { fallback(); return t; }
    var img = el('img', { src: h.img, alt: name, loading: 'lazy' });
    img.addEventListener('error', fallback);
    t.appendChild(img);
    return t;
  }

  /* ---------- schermate ---------- */
  function renderSetup() {
    var input = el('input', { id: 'sid', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'es. 76561198012345678', 'aria-describedby': 'sid-hint sid-err' });
    var err = el('div', { id: 'sid-err', class: 'err', role: 'alert' });
    var btn = el('button', { class: 'btn', type: 'submit', text: 'Salva e continua' });
    var form = el('form', { class: 'card', novalidate: 'novalidate', onsubmit: function (ev) {
      ev.preventDefault();
      var v = input.value.trim();
      if (!/^\d{5,20}$/.test(v)) { err.textContent = 'Inserisci solo numeri: il tuo Steam ID (o Account ID) di Dota 2.'; input.focus(); return; }
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Salvataggio…';
      Promise.resolve(window.api.saveSteamId(v)).then(function (r) {
        if (r && r.ok === false) throw new Error(r.error || 'Salvataggio non riuscito');
      }).catch(function (e) {
        err.textContent = 'Non riesco a salvare: ' + (e && e.message ? e.message : 'errore sconosciuto'); btn.disabled = false; btn.textContent = 'Salva e continua';
      });
    } }, [
      el('label', { for: 'sid', text: 'Il tuo Steam ID' }), input,
      el('div', { id: 'sid-hint', class: 'hint', text: 'Lo usiamo solo per leggere il tuo rank da OpenDota. Viene salvato su questo PC e non verra’ chiesto di nuovo.' }),
      err, btn
    ]);
    app.replaceChildren(el('div', { class: 'center' }, [
      el('h1', { text: 'Dota Picker' }),
      el('p', { text: 'Il miglior pick, direttamente in draft.' }),
      form
    ]));
    input.focus();
  }

  function renderWaiting(s) {
    app.replaceChildren(el('div', { class: 'center' }, [
      el('div', { class: 'pulse', 'aria-hidden': 'true' }),
      el('h1', { text: 'In attesa del draft' }),
      el('p', { text: 'Apri Dota 2 e avvia una partita classificata. Il consiglio compare appena inizia la selezione degli eroi.' }),
      el('p', { class: 'hint', text: s.rankTier != null ? 'Il tuo rank: ' + rankLabel(s.rankTier) : 'Rank non ancora disponibile.' }),
      el('p', { class: 'hint', text: 'F8 mostra/nasconde l’overlay.' })
    ]));
  }

  function renderError(s) {
    app.replaceChildren(el('div', { class: 'center' }, [
      el('h1', { text: 'Qualcosa non va' }),
      el('div', { class: 'banner', role: 'alert', text: s.message || 'Errore sconosciuto.' }),
      el('button', { class: 'btn', type: 'button', text: 'Riprova', onclick: function () { window.api.getState().then(function (n) { apply(n, true); }); } }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Cambia Steam ID', onclick: function () { renderSetup(); } })
    ]));
  }

  function roleBlock(s) {
    var detected = s.role, active = manualRole || detected;
    var det = detected ? 'Rilevato: Pos ' + detected + ' (OCR)' : 'Ruolo non rilevato: sceglilo tu';
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Ruolo' });
    for (var r = 1; r <= 5; r++) (function (r) {
      var b = el('button', { type: 'button', 'aria-pressed': String(active === r), 'aria-label': 'Posizione ' + r + (r === detected ? ' (rilevata)' : ''), onclick: function () {
        manualRole = (r === detected && !manualRole) ? null : r;
        if (window.api.setRole) try { window.api.setRole(r); } catch (e) {}
        render();
      } }, ['Pos ' + r, r === detected ? el('span', { class: 'dot', text: 'rilevato' }) : null]);
      seg.appendChild(b);
    })(r);
    return el('section', { class: 'role', 'aria-label': 'Ruolo' }, [
      el('div', { class: 'role-head' }, [el('h2', { text: 'Il tuo ruolo' }), el('span', { class: 'det', text: manualRole && manualRole !== detected ? 'Impostato a mano: Pos ' + manualRole : det })]),
      seg
    ]);
  }

  function teamBlock(title, cls2, list, emptyMsg) {
    var row = el('div', { class: 'row' });
    for (var i = 0; i < 5; i++) row.appendChild(heroTile(list[i] || null));
    return el('section', { class: 'team ' + cls2, 'aria-label': title }, [
      el('h2', {}, [el('span', { text: title }), el('span', { text: list.length + '/5' })]), row,
      list.length ? null : el('div', { class: 'row-note', text: emptyMsg })
    ]);
  }

  /* "Scegli": solo dove l'api lo prevede (banco di prova); nell'overlay vero si sceglie nel gioco. */
  function pickBtn(p) {
    if (!window.api || typeof window.api.pickHero !== 'function' || !p || !p.heroId) return null;
    return el('button', { type: 'button', class: 'pick-btn', 'aria-label': 'Scegli ' + p.name + ' come tuo eroe', text: 'Scegli ' + p.name,
      onclick: function () { window.api.pickHero(p.heroId); } });
  }

  function bestCard(p, role) {
    return el('section', { class: 'best', 'aria-label': 'Miglior pick' }, [
      el('div', { class: 'tag', text: 'Miglior pick' + (role ? ' · Pos ' + role : '') }),
      el('div', { class: 'best-main' }, [
        heroTile(p),
        el('div', {}, [
          el('div', { class: 'best-name', text: p.name }),
          el('div', { class: 'score' }, [el('b', { text: fmt(p.score, 0) }), el('span', { text: '/ 100 punteggio' })])
        ])
      ]),
      el('div', { class: 'stats' }, [
        el('div', { class: 'stat' }, [el('small', { text: 'Winrate atteso' }),
          el('b', { text: fmtC(p.expectedWinrate != null ? p.expectedWinrate : p.winrate) + '%' }),
          el('small', { class: 'base', text: 'base ' + fmtC(p.winrate) + '%' })]),
        el('div', { class: 'stat' }, [el('small', { text: 'Counter' }), el('b', { class: cls(delta(p.counter)), text: signedDelta(p.counter) })]),
        el('div', { class: 'stat' }, [el('small', { text: 'Sinergia' }), el('b', { class: cls(delta(p.synergy)), text: signedDelta(p.synergy) })])
      ]),
      (p.reasons && p.reasons.length) ? el('ul', { class: 'reasons', 'aria-label': 'Perche’' }, p.reasons.map(function (r) { return el('li', { text: r }); })) : null,
      pickBtn(p)
    ]);
  }

  function fmtC(n, d) { return fmt(n, d).replace('.', ','); }
  function altCard(p, sg) {
    var top = sg.top || {}, needs = sg.teamNeeds || [];
    function label(k) { for (var i = 0; i < needs.length; i++) if (needs[i].key === k) return needs[i].label; return k; }
    var covers = p.covers || [], topCovers = top.covers || [];
    var newCov = covers.filter(function (k) { return topCovers.indexOf(k) < 0; });
    var dC = (p.counter != null && top.counter != null) ? p.counter - top.counter : 0;
    var dS = (p.synergy != null && top.synergy != null) ? p.synergy - top.synergy : 0;
    var edge = null;
    if (newCov.length) edge = 'Copre: ' + newCov.map(function (k) { return label(k).toLowerCase(); }).join(', ');
    else if (dC >= 3 || dS >= 3) edge = dC >= dS ? 'Più counter' : 'Più sinergia';
    var exp = p.expectedWinrate != null ? p.expectedWinrate : p.winrate;
    var more = (p.reasons || []).slice(1, 4);
    return el('article', { class: 'alt' }, [
      el('div', { class: 'alt-head' }, [
        heroTile(p),
        el('div', { class: 'alt-id' }, [
          el('div', { class: 'n', text: p.name }),
          el('div', { class: 'sc' }, [el('b', { text: fmt(p.score, 0) }), el('span', { text: ' punti' })])
        ])
      ]),
      edge ? el('div', { class: 'edge', text: edge }) : null,
      el('div', { class: 'mini' }, [
        el('div', { class: 'ms' }, [el('small', { text: 'Winrate atteso' }), el('b', { text: fmtC(exp) + '%' }), el('em', { text: 'base ' + fmtC(p.winrate) + '%' })]),
        el('div', { class: 'ms' }, [el('small', { text: 'Counter' }), el('b', { class: cls(delta(p.counter)), text: signedDelta(p.counter) })]),
        el('div', { class: 'ms' }, [el('small', { text: 'Sinergia' }), el('b', { class: cls(delta(p.synergy)), text: signedDelta(p.synergy) })])
      ]),
      covers.length ? el('div', { class: 'covers', 'aria-label': 'Copre' }, covers.map(function (k) { return el('span', { class: 'cov', text: '✓ ' + label(k) }); })) : null,
      more.length ? el('ul', { class: 'alt-reasons' }, more.map(function (r) { return el('li', { text: r }); })) : null,
      pickBtn(p)
    ]);
  }

  function estimateBlock(m) {
    var p = Number(m.winProbability);
    var tone = p > 52 ? 'good' : p < 48 ? 'bad' : 'mid';
    // il verdetto netto solo se tutto l'intervallo sta dalla stessa parte del 50%
    var lo = Number(m.low), hi = Number(m.high);
    var verdict = (!isNaN(lo) && lo > 50) ? 'Favoriti' : (!isNaN(hi) && hi < 50) ? 'Sfavoriti'
      : tone === 'good' ? 'Leggermente favoriti' : tone === 'bad' ? 'Leggermente sfavoriti' : 'Partita equilibrata';
    var pct = Math.max(0, Math.min(100, p));
    var factors = (m.factors || []).slice(0, 4).map(function (f) {
      var v = Number(f.impact), t = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
      var txt = (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%';
      // il valore e' gia' a sinistra: togli l'eventuale '(+5,5%)' finale dal testo
      var label = String(f.text || '').replace(/\s*\([+\-−]?\d+(?:[.,]\d+)?%\)\s*$/, '');
      return el('li', {}, [el('b', { class: 'fv ' + t, text: txt }), el('span', { text: label })]);
    });
    return el('section', { class: 'est ' + tone, 'aria-label': 'Stima di vittoria' }, [
      el('h2', { text: 'Stima di vittoria' }),
      el('div', { class: 'est-main' }, [
        el('div', { class: 'est-num', text: fmtC(p) + '%' }),
        el('div', { class: 'est-side' }, [
          el('div', { class: 'est-verdict', text: verdict }),
          (m.low != null && m.high != null) ? el('div', { class: 'est-rng', text: 'tra ' + fmtC(m.low) + '% e ' + fmtC(m.high) + '%' }) : null,
          m.confidence ? el('div', { class: 'est-rng', text: 'Affidabilità: ' + m.confidence }) : null
        ])
      ]),
      el('div', { class: 'est-bar', role: 'img', 'aria-label': 'Vostra squadra ' + fmtC(p) + '%, avversari ' + fmtC(100 - p) + '%' }, [
        el('span', { class: 'us', style: 'width:' + pct + '%', text: 'Voi ' + fmtC(p) + '%' }),
        el('span', { class: 'them', style: 'width:' + (100 - pct) + '%', text: fmtC(100 - p) + '% Loro' })
      ]),
      factors.length ? el('ul', { class: 'est-f', 'aria-label': 'Fattori' }, factors) : null,
      m.note ? el('p', { class: 'est-note', text: m.note }) : null
    ]);
  }

  var expanded = {};
  function compactAlt(p, sg) {
    var top = sg.top || {}, needs = sg.teamNeeds || [];
    function label(k) { for (var i = 0; i < needs.length; i++) if (needs[i].key === k) return needs[i].label; return k; }
    var covers = p.covers || [], topCovers = top.covers || [];
    var newCov = covers.filter(function (k) { return topCovers.indexOf(k) < 0; });
    var dC = (p.counter != null && top.counter != null) ? p.counter - top.counter : 0;
    var dS = (p.synergy != null && top.synergy != null) ? p.synergy - top.synergy : 0;
    var edge = null;
    if (newCov.length) edge = 'Copre: ' + newCov.map(function (k) { return label(k).toLowerCase(); }).join(', ');
    else if (dC >= 3 || dS >= 3) edge = dC >= dS ? 'Più counter' : 'Più sinergia';
    var exp = p.expectedWinrate != null ? p.expectedWinrate : p.winrate;
    var reasons = p.reasons || [], one = reasons[1] || reasons[0] || '';
    var key = String(p.heroId), open = !!expanded[key];
    var panelId = 'calt-' + key;
    var detail = el('div', { class: 'calt-detail', id: panelId, hidden: open ? null : 'hidden' }, [
      covers.length ? el('div', { class: 'covers', 'aria-label': 'Copre' }, covers.map(function (k) { return el('span', { class: 'cov', text: '✓ ' + label(k) }); })) : null,
      reasons.length > 2 ? el('ul', { class: 'alt-reasons' }, reasons.slice(2, 5).map(function (r) { return el('li', { text: r }); })) : null,
      el('div', { class: 'calt-base', text: 'Winrate base ' + fmtC(p.winrate) + '%' })
    ]);
    var btn = el('button', { type: 'button', class: 'calt-row', 'aria-expanded': String(open), 'aria-controls': panelId, 'aria-label': p.name + ', ' + fmt(p.score, 0) + ' punti. Dettagli' }, [
      heroTile(p, 'calt-h'),
      el('span', { class: 'calt-mid' }, [
        el('span', { class: 'calt-l1' }, [el('b', { class: 'calt-n', text: p.name }), el('span', { class: 'calt-pts', text: fmt(p.score, 0) + ' pt' }), edge ? el('span', { class: 'edge', text: edge }) : null]),
        one ? el('span', { class: 'calt-r', text: one }) : null
      ]),
      el('span', { class: 'calt-st' }, [
        el('span', { class: 'cs' }, [el('small', { text: 'WR' }), el('b', { text: fmtC(exp) + '%' })]),
        el('span', { class: 'cs' }, [el('small', { text: 'Cnt' }), el('b', { class: cls(delta(p.counter)), text: signedDelta(p.counter) })]),
        el('span', { class: 'cs' }, [el('small', { text: 'Sin' }), el('b', { class: cls(delta(p.synergy)), text: signedDelta(p.synergy) })])
      ]),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: open ? '▴' : '▾' })
    ]);
    btn.addEventListener('click', function () {
      expanded[key] = !expanded[key];
      btn.setAttribute('aria-expanded', String(expanded[key]));
      btn.querySelector('.chev').textContent = expanded[key] ? '▴' : '▾';
      if (expanded[key]) detail.removeAttribute('hidden'); else detail.setAttribute('hidden', 'hidden');
    });
    var pb = pickBtn(p);
    return el('article', { class: 'calt' }, [btn, detail, pb ? el('div', { class: 'calt-pick' }, [pb]) : null]);
  }

  function joinIt(a) { return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1]; }

  /* Riga "Chi lo copre": eroe (o gia' tra i consigli) + oggetti, compatta. */
  function fixRow(fix, sg) {
    if (!fix) return null;
    var parts = [], hero = fix.hero;
    if (hero && hero.heroId != null) {
      var ids = [sg.top && sg.top.heroId].concat((sg.alternatives || []).map(function (a) { return a.heroId; }));
      var already = ids.indexOf(hero.heroId) >= 0;
      var g = (hero.winrateGap != null && !isNaN(hero.winrateGap)) ? ' · -' + Math.abs(hero.winrateGap).toFixed(1).replace('.', ',') + ' punti' : '';
      parts.push(el('span', { class: 'fx-hero' }, [
        el('span', { class: 'fx-l', text: 'Chi lo copre:' }), heroTile(hero, 'mini-h'),
        el('b', { text: hero.name }),
        el('span', { class: 'fx-g', text: already ? 'già tra i consigli' : g.slice(3) })
      ]));
    }
    var items = Array.isArray(fix.items) ? fix.items.join(', ') : fix.items;
    if (items) parts.push(el('span', { class: 'fx-it', text: 'Oggetti: ' + items }));
    if (!parts.length && fix.text) parts.push(el('span', { class: 'fx-it', text: fix.text }));
    return parts.length ? el('div', { class: 'fix' }, parts) : null;
  }

  function wildcardBlock(w) {
    var gap = (w.winrateGap != null && !isNaN(w.winrateGap)) ? '-' + Math.abs(w.winrateGap).toFixed(1).replace('.', ',') + ' punti di winrate' : '';
    var withImg = !w.teamOnly && w.heroId != null;
    return el('section', { class: 'wild' + (withImg ? '' : ' team-only'), 'aria-label': 'Jolly' }, [
      el('div', { class: 'tag', text: 'Se ti serve: ' + joinIt((w.needLabels && w.needLabels.length ? w.needLabels : [w.needLabel || '']).map(function (l) { return String(l).toLowerCase(); })) }),
      el('div', { class: 'wild-main' }, [
        withImg ? heroTile(w) : null,
        el('div', {}, [
          withImg ? el('div', { class: 'wild-name', text: w.name }) : null,
          w.text ? el('p', { class: 'wild-text', text: w.text }) : null,
          gap ? el('div', { class: 'wild-gap', text: gap }) : null
        ])
      ])
    ]);
  }

  function needsBlock(needs, sg) {
    function status(n) {
      var t = n.note || '';
      if (/manc/i.test(t)) return 'missing';
      if (/scars|debol|insuff/i.test(t)) return 'weak';
      if (/da definire|incert|sconosc/i.test(t)) return 'unknown';
      if (/coper|suffic|\bok\b|ottim|buon/i.test(t)) return 'ok';
      if (n.level == null) return 'unknown';
      return n.level < 0.3 ? 'missing' : n.level < 0.55 ? 'weak' : 'ok';
    }
    var missing = needs.filter(function (n) { return status(n) === 'missing'; });
    var weak = needs.filter(function (n) { return status(n) === 'weak'; });
    var sum = missing.length
      ? el('p', { class: 'needs-sum' }, ['Alla squadra ', el('b', { text: 'manca' }), ': ' + missing.map(function (n) { return n.label.toLowerCase(); }).join(', ') + '.' + (weak.length ? ' Da rinforzare: ' + weak.map(function (n) { return n.label.toLowerCase(); }).join(', ') + '.' : '')])
      : weak.length ? el('p', { class: 'needs-sum', text: 'Nulla di critico. Da rinforzare: ' + weak.map(function (n) { return n.label.toLowerCase(); }).join(', ') + '.' })
      : el('p', { class: 'needs-sum', text: 'Composizione equilibrata: nessuna lacuna evidente.' });
    var order = { missing: 0, weak: 1, unknown: 2, ok: 3 };
    var items = needs.slice().sort(function (a, b) { return order[status(a)] - order[status(b)]; }).map(function (n) {
      var st = status(n), badge = { missing: 'Manca', weak: 'Scarso', unknown: 'Da definire', ok: 'Ok' }[st];
      var lvl = n.level == null ? 0 : n.level;
      var threat = (n.threat && n.threat.length) ? 'contro: ' + n.threat.join(', ') : '';
      return el('div', { class: 'need ' + st }, [
        el('div', { class: 'ic', 'aria-hidden': 'true', text: { ok: '✓', weak: '!', unknown: '?', missing: '✕' }[st] }),
        el('div', { class: 'lb', text: n.label }),
        el('span', { class: 'badge', text: badge }),
        el('div', { class: 'bar', role: 'img', 'aria-label': n.label + ' ' + Math.round(lvl * 100) + '%' }, [el('i', { style: 'width:' + Math.max(3, Math.round(lvl * 100)) + '%' })]),
        (n.note || threat) ? el('div', { class: 'nt', text: [n.note, threat].filter(Boolean).join(' · ') }) : null,
        (st === 'missing' || st === 'weak') ? fixRow(n.fix, sg) : null
      ]);
    });
    return el('section', { class: 'needs', 'aria-label': 'Composizione squadra' }, [el('h2', { text: 'Composizione squadra' }), sum].concat(items));
  }

  function renderDraft(s) {
    var kids = [];
    kids.push(el('header', { class: 'top' }, [
      el('div', { class: 'mine' }, [heroTile(s.myHero, 'square')]),
      el('div', { class: 'meta' }, [
        el('div', { class: 'title', text: 'Draft in corso' }),
        el('div', { class: 'rank' }, ['Rank lobby ', el('b', { text: rankLabel(s.lobbyRankTier) })]),
        el('div', { class: 'mine-name', text: s.myHero ? 'Il tuo eroe: ' + s.myHero.name : 'Eroe non ancora scelto' })
      ])
    ]));
    if (s.message) kids.push(el('div', { class: 'banner', role: 'status', text: s.message }));
    if (s.matchEstimate) kids.push(estimateBlock(s.matchEstimate));
    kids.push(teamBlockPair(s));
    kids.push(roleBlock(s));
    var sg = s.suggestion;
    if (!sg || !sg.top) {
      kids.push(el('div', { class: 'empty-box' }, [el('b', { text: 'Nessun suggerimento ancora' }), 'Servono almeno un alleato o un nemico scelto: il consiglio compare appena il draft prosegue.']));
    } else {
      kids.push(bestCard(sg.top, manualRole || s.role));
      if (sg.alternatives && sg.alternatives.length) {
        kids.push(el('h2', { text: 'Alternative (' + sg.alternatives.length + ')' }));
        kids.push(el('div', { class: 'alts' }, sg.alternatives.slice(0, 2).map(function (a) { return altCard(a, sg); })));
        if (sg.alternatives.length > 2) kids.push(el('div', { class: 'calts' }, sg.alternatives.slice(2, 5).map(function (a) { return compactAlt(a, sg); })));
      }
      if (sg.wildcard) kids.push(wildcardBlock(sg.wildcard));
      if (sg.teamNeeds && sg.teamNeeds.length) kids.push(needsBlock(sg.teamNeeds, sg));
    }
    app.replaceChildren.apply(app, kids);
  }
  function teamBlockPair(s) {
    return el('div', { class: 'teams' }, [
      teamBlock('Alleati', 'allies', s.allies || [], 'Nessun alleato ancora.'),
      teamBlock('Nemici', 'enemies', s.enemies || [], 'Nessun nemico ancora.')
    ]);
  }

  /* ---------- ciclo ---------- */
  function render() {
    if (!state) return;
    var s = state;
    if (s.status === 'setup' || (!s.steamId && s.status !== 'error')) renderSetup();
    else if (s.status === 'waiting') renderWaiting(s);
    else if (s.status === 'error') renderError(s);
    else renderDraft(s);
    mockBar();
  }
  function apply(s, force) {
    if (!s) return;
    if (s.role !== lastDetected) { lastDetected = s.role; manualRole = null; }
    var sig = JSON.stringify(s);
    if (!force && sig === lastSig) return;
    var wasSetup = state && state.status === 'setup';
    lastSig = sig; state = s;
    if (wasSetup && s.status === 'setup') { mockBar(); return; } // non cancellare l'input mentre si digita
    render();
  }

  function mockBar() {
    if (!window.__mock) return;
    var old = document.getElementById('devbar'); if (old) old.remove();
    var bar = el('div', { id: 'devbar', class: 'devbar', role: 'group', 'aria-label': 'Schermate mock' });
    window.__mock.screens.forEach(function (k) {
      bar.appendChild(el('button', { type: 'button', text: k, 'aria-pressed': String(window.__mock.current() === k), onclick: function () { window.__mock.go(k); } }));
    });
    document.body.appendChild(bar);
  }

  function start() {
    if (!window.api) { apply({ status: 'error', message: 'Collegamento con l’app non disponibile (window.api assente).', steamId: 'x' }); return; }
    window.api.onState(function (s) { apply(s); });
    window.api.getState().then(function (s) { apply(s); }).catch(function (e) {
      apply({ status: 'error', steamId: 'x', message: 'Impossibile leggere lo stato: ' + (e && e.message || e) });
    });
  }
  start();
})();
