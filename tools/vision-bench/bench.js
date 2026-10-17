'use strict';
// Banco prova della lettura schermo: client. Il browser decodifica l'immagine e manda i pixel RGBA al server.
(function () {
  const $ = (id) => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const C = (n) => css.getPropertyValue('--' + n).trim();
  const SLOT_LABEL = (i) => (i < 5 ? 'R' + (i + 1) : 'D' + (i - 4));
  const STATUS_IT = { banned: 'bannato', unavailable: 'non disponibile', available: 'disponibile', unknown: 'incerto' };
  const store = {
    get(k) { try { return localStorage.getItem('vb.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('vb.' + k, v); } catch (e) { /* niente */ } }
  };

  const st = { img: null, label: '', result: null, busy: false, again: false, tile: null, layers: { slots: true, names: true, grid: true, tiles: true } };
  const imgC = $('img'), ovC = $('ov');

  // ---------- nomi a mano ----------
  const nameInputs = [];
  for (let i = 0; i < 10; i++) {
    const id = 'name' + i;
    const lab = document.createElement('label');
    lab.htmlFor = id; lab.textContent = SLOT_LABEL(i); lab.className = i < 5 ? 'radiant' : 'dire';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.id = id; inp.autocomplete = 'off'; inp.spellcheck = false; inp.placeholder = 'nome letto (vuoto = dall\'OCR)';
    inp.addEventListener('input', debounce(analyze, 500));
    $('names').append(lab, inp); nameInputs.push(inp);
  }

  // ---------- stato moduli ----------
  async function refreshStatus() {
    try {
      const s = await (await fetch('/api/status')).json();
      const bar = $('modbar'); bar.textContent = '';
      for (const [k, v] of Object.entries(s.modules)) {
        const el = document.createElement('span');
        el.className = 'mod ' + (v.ok ? 'ok' : 'ko');
        const b = document.createElement('b'); b.textContent = k + '.js';
        el.append(b, document.createTextNode(v.ok ? ' caricato' : ' ' + (v.missing ? 'modulo non ancora disponibile' : v.message)));
        if (!v.ok && v.message) el.title = v.message;
        bar.append(el);
      }
      if (s.ocr) {
        const el = document.createElement('span');
        el.className = 'mod ' + (s.ocr.ok ? 'ok' : 'ko');
        el.textContent = s.ocr.ok ? 'OCR nomi pronto' : 'OCR nomi: ' + s.ocr.message;
        bar.append(el);
      }
    } catch (e) { $('modbar').textContent = 'Server non raggiungibile: avvia node tools/vision-bench/server.js'; }
  }

  // ---------- caricamento immagine ----------
  let loadSeq = 0;
  function loadImage(src, label) {
    const im = new Image(), my = ++loadSeq;
    im.onload = () => {
      if (my !== loadSeq) return; // nel frattempo e' stata chiesta un'altra immagine
      st.img = im; st.label = label; st.result = null; st.tile = null; $('tileOut').textContent = '';
      imgC.width = ovC.width = im.naturalWidth; imgC.height = ovC.height = im.naturalHeight;
      imgC.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0);
      $('frame').hidden = false; $('empty').hidden = true;
      analyze();
    };
    im.onerror = () => say('Immagine non leggibile: ' + label);
    im.src = src;
  }

  $('file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { $('fixture').value = ''; loadImage(URL.createObjectURL(f), f.name); } });
  const drop = $('drop'), stage = $('stage');
  for (const el of [drop, stage]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    el.addEventListener('dragleave', () => drop.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
      if (f) { $('fixture').value = ''; loadImage(URL.createObjectURL(f), f.name); } else say('Il file trascinato non è un\'immagine.');
    });
  }
  $('fixture').addEventListener('change', (e) => { const v = e.target.value; store.set('fixture', v); if (v) loadImage('/fixtures/' + encodeURIComponent(v), v); });
  $('nick').value = store.get('nick') || '';
  $('nick').addEventListener('input', debounce(() => { store.set('nick', $('nick').value); analyze(); }, 400));
  $('useOcr').addEventListener('change', analyze);
  $('run').addEventListener('click', analyze);
  document.querySelectorAll('[data-layer]').forEach((cb) => cb.addEventListener('change', () => { st.layers[cb.dataset.layer] = cb.checked; draw(); }));

  // ---------- analisi ----------
  function body(meta, pixels) {
    const json = new TextEncoder().encode(JSON.stringify(meta));
    const head = new Uint8Array(4); new DataView(head.buffer).setUint32(0, json.length);
    return new Blob([head, json, pixels]);
  }
  async function analyze() {
    if (!st.img) return;
    if (st.busy) { st.again = true; return; }
    st.busy = true; stage.classList.add('loading');
    try {
      const px = imgC.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, imgC.width, imgC.height).data;
      const meta = { width: imgC.width, height: imgC.height, nick: $('nick').value, names: nameInputs.map((x) => x.value), ocr: $('useOcr').checked };
      const t0 = performance.now();
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: body(meta, px) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.status);
      out.roundTripMs = Math.round(performance.now() - t0);
      if (meta.width !== imgC.width || meta.height !== imgC.height) return; // immagine cambiata durante l'analisi
      st.result = out;
      render();
    } catch (e) {
      say('Analisi non riuscita: ' + e.message);
    } finally {
      st.busy = false; stage.classList.remove('loading');
      if (st.again) { st.again = false; analyze(); }
    }
  }

  // ---------- disegno ----------
  function draw() {
    const g = ovC.getContext('2d');
    g.clearRect(0, 0, ovC.width, ovC.height);
    const r = st.result; if (!r) return;
    const W = ovC.width, lw = Math.max(2, Math.round(W / 700)), fs = Math.max(12, Math.round(W / 110));
    g.font = `600 ${fs}px Barlow, system-ui, sans-serif`; g.textBaseline = 'top';
    const box = (rc, color, width, dash) => { g.save(); g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.strokeRect(rc.x + width / 2, rc.y + width / 2, rc.w - width, rc.h - width); g.restore(); };
    const tag = (text, x, y, color, ink) => {
      const pad = Math.round(fs * 0.3), tw = g.measureText(text).width;
      x = Math.max(0, Math.min(W - tw - 2 * pad, x)); y = Math.max(0, y);
      g.fillStyle = color; g.fillRect(x, y, tw + 2 * pad, fs + 2 * pad);
      g.fillStyle = ink || '#0b0f14'; g.fillText(text, x + pad, y + pad);
    };

    // riquadri della griglia
    const grid = r.grid;
    if (grid && grid.tiles && st.layers.tiles) {
      for (const t of grid.tiles) {
        const rc = t.rect;
        if (t.status === 'banned') {
          box(rc, C('banned'), lw * 1.5);
          g.save(); g.strokeStyle = C('banned'); g.lineWidth = lw; g.beginPath(); g.moveTo(rc.x, rc.y + rc.h); g.lineTo(rc.x + rc.w, rc.y); g.stroke(); g.restore();
        } else if (t.status === 'unavailable') box(rc, C('unavailable'), lw * 1.5, [lw * 3, lw * 2]);
        else if (t.status === 'available') box(rc, C('available'), Math.max(1, lw * 0.75));
        else {
          box(rc, C('unknown'), lw * 1.5, [lw, lw]);
          g.save(); g.fillStyle = C('unknown'); g.textAlign = 'center'; g.fillText('?', rc.x + rc.w / 2, rc.y + rc.h / 2 - fs / 2); g.restore();
        }
      }
    }
    if (grid && grid.rect && st.layers.grid) {
      box(grid.rect, C('amber'), lw * 1.5, [lw * 5, lw * 3]);
      tag('Griglia eroi', grid.rect.x, grid.rect.y - fs * 1.7, C('amber'));
    }

    // barra in alto
    const bar = r.topbar && r.topbar.result;
    const me = r.match ? r.match.index : null;
    if (bar && st.layers.slots) {
      for (const s of bar.slots) {
        const col = s.side === 'radiant' ? C('radiant') : C('dire');
        box(s.portrait, col, lw, s.found ? [] : [lw * 2, lw * 2]);
        box(s.bar, col, lw, s.found ? [] : [lw * 2, lw * 2]);
        tag(SLOT_LABEL(s.index) + (s.found ? '' : ' ?'), s.portrait.x, s.portrait.y, col);
      }
    }
    if (bar && st.layers.names) {
      bar.slots.forEach((s, i) => {
        box(s.name, 'rgba(230,235,240,.55)', Math.max(1, lw / 2), [lw, lw]);
        const n = r.names && r.names[i];
        if (n) tag(n, s.name.x, s.name.y + s.name.h + lw, '#e6ebf0');
        const hh = r.heroes && r.heroes[i];
        if (hh && hh.name) tag(hh.name + (typeof hh.score === 'number' ? ' ' + Math.round(hh.score * 100) + '%' : ''), s.portrait.x, s.portrait.y + s.portrait.h - fs * 1.6, C('amber'), C('amber-ink'));
      });
    }
    if (bar && me != null) {
      const s = bar.slots[me];
      const u = union([s.portrait, s.bar, s.name]);
      const pad = lw * 2;
      box({ x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad }, C('me'), lw * 2);
      tag('Sei tu', u.x - pad, u.y + u.h + pad + lw + (st.layers.names ? fs * 1.8 : 0), C('me'));
    }

    // controllo manuale di un riquadro
    if (st.tile) {
      const t = st.tile, col = t.status ? C(t.status) || C('amber') : C('amber');
      box(t.rect, col, lw * 2);
      if (t.status) tag(STATUS_IT[t.status] || t.status, t.rect.x, t.rect.y + t.rect.h + lw, col);
    }
  }
  const union = (rs) => { const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }; };

  // ---------- pannello numeri ----------
  function render() {
    draw();
    const r = st.result;
    const bar = r.topbar && r.topbar.result;
    const v = $('verdict');
    if (!r.modules.topbar.ok) { v.className = 'verdict none'; v.textContent = 'topbar.js: modulo non ancora disponibile'; }
    else if (r.topbar && r.topbar.error) { v.className = 'verdict none'; v.textContent = 'Errore in findTopBar: ' + r.topbar.error; }
    else if (!bar) { v.className = 'verdict none'; v.textContent = 'Barra degli eroi non trovata'; }
    else if (r.match) {
      const dire = r.match.side === 'dire';
      v.className = 'verdict ' + r.match.side;
      v.textContent = `Sei ${dire ? 'Dire' : 'Radiant'}: alleati a ${dire ? 'destra' : 'sinistra'} (slot ${SLOT_LABEL(r.match.index)})`;
    } else { v.className = 'verdict none'; v.textContent = $('nick').value.trim() ? 'Nickname non trovato: lato sconosciuto' : 'Inserisci il nickname'; }

    const rows = [];
    const add = (k, val) => rows.push([k, val]);
    const sep = () => rows.push(null);
    add('Immagine', `${st.label} · ${r.width}×${r.height}`);
    sep();
    if (bar) {
      add('Barra: confidenza', pct(bar.confidence));
      add('Slot trovati', `${bar.slots.filter((s) => s.found).length} su 10`);
      add('findTopBar', r.topbar.timeMs + ' ms');
      if (r.ocrTimeMs != null) add('OCR nomi', r.ocrTimeMs + ' ms' + (r.namesSource ? ' · ' + r.namesSource : ''));
      else if (r.namesSource) add('Nomi', r.namesSource);
      if (r.heroes) { add('Eroi riconosciuti', r.heroes.filter(Boolean).length + ' su 10 in ' + r.heroesTimeMs + ' ms'); }
      if (r.match) { add('Nickname: punteggio', pct(r.match.score)); add('matchNickname', r.matchTimeMs + ' ms'); }
    } else if (r.modules.topbar.ok) add('Barra', 'non trovata' + (r.topbar && r.topbar.timeMs != null ? ` (${r.topbar.timeMs} ms)` : ''));
    else add('Barra', 'modulo non ancora disponibile');
    sep();
    const grid = r.grid;
    if (!r.modules.heroGrid.ok) add('Griglia', 'modulo non ancora disponibile');
    else if (grid && grid.error) add('Griglia', 'errore: ' + grid.error);
    else if (grid && grid.rect) {
      add('Griglia', `${grid.rect.w}×${grid.rect.h} a (${grid.rect.x}, ${grid.rect.y})`);
      add('findHeroGrid', grid.timeMs + ' ms');
      if (grid.tiles) {
        const c = { banned: 0, unavailable: 0, available: 0, unknown: 0 };
        grid.tiles.forEach((t) => { c[t.status] = (c[t.status] || 0) + 1; });
        add('Riquadri controllati', `${grid.tiles.length} in ${grid.tilesTimeMs} ms`);
        add('Bannati', c.banned); add('Non disponibili', c.unavailable); add('Disponibili', c.available); add('Incerti', c.unknown);
      }
    } else add('Griglia', 'non trovata');
    sep();
    add('Totale server', r.totalMs + ' ms'); add('Andata e ritorno', r.roundTripMs + ' ms');
    const dl = $('stats'); dl.textContent = '';
    for (const row of rows) {
      if (!row) { const d = document.createElement('div'); d.className = 'sep'; d.setAttribute('role', 'presentation'); dl.append(d); continue; }
      const dt = document.createElement('dt'); dt.textContent = row[0];
      const dd = document.createElement('dd'); dd.textContent = row[1];
      dl.append(dt, dd);
    }

    renderPortraits(r, bar);
    const tb = $('slotTable').tBodies[0]; tb.textContent = '';
    for (let i = 0; i < 10; i++) {
      const s = bar && bar.slots[i];
      const tr = document.createElement('tr');
      if (r.match && r.match.index === i) tr.className = 'me';
      const cells = [
        SLOT_LABEL(i) + (r.match && r.match.index === i ? ' · tu' : ''),
        s ? (s.found ? 'sì' : 'ricostruito') : '—',
        (r.names && r.names[i]) || '—',
        r.nameScores && r.nameScores[i] != null ? pct(r.nameScores[i]) : '—'
      ];
      cells.forEach((txt, k) => { const td = document.createElement(k === 0 ? 'th' : 'td'); if (k === 0) { td.scope = 'row'; td.className = i < 5 ? 'radiant' : 'dire'; } td.textContent = txt; tr.append(td); });
      tb.append(tr);
    }
    const ul = $('notes'); ul.textContent = '';
    const notes = r.notes.slice();
    for (const [k, m] of Object.entries(r.modules)) if (!m.ok) notes.unshift(m.message);
    if (!notes.length) notes.push('Nessuna nota.');
    for (const n of notes) { const li = document.createElement('li'); li.textContent = n; ul.append(li); }
  }
  // ritaglio del ritratto di ogni slot + eroe riconosciuto (r.heroes[i] = {name, score}, se il server lo calcola)
  function renderPortraits(r, bar) {
    const ol = $('portraits'); ol.textContent = '';
    if (!bar) { const li = document.createElement('li'); li.textContent = 'Barra non trovata'; ol.append(li); return; }
    const src = imgC;
    for (const s of bar.slots) {
      const li = document.createElement('li'); if (r.match && r.match.index === s.index) li.className = 'me';
      const cv = document.createElement('canvas'); const p = s.portrait;
      cv.width = Math.max(1, p.w); cv.height = Math.max(1, p.h);
      try { cv.getContext('2d').drawImage(src, p.x, p.y, p.w, p.h, 0, 0, cv.width, cv.height); } catch (e) { /* fuori immagine */ }
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Ritaglio ritratto slot ' + SLOT_LABEL(s.index) + ', ' + p.w + ' per ' + p.h + ' pixel');
      const who = document.createElement('div'); who.className = 'who';
      const sl = document.createElement('span'); sl.className = 'slot ' + s.side; sl.textContent = SLOT_LABEL(s.index);
      const hero = r.heroes && r.heroes[s.index];
      const nm = document.createElement('span'); nm.className = 'hero'; nm.textContent = hero ? (hero.name || '—') : (r.heroes ? 'vuoto/incerto' : 'eroe n/d');
      who.append(sl, nm);
      const sc = document.createElement('div'); sc.className = 'sc';
      sc.textContent = (hero && typeof hero.score === 'number' ? 'punteggio ' + pct(hero.score) + ' · distacco ' + pct(hero.margin) + ' · ' : '') + p.w + '×' + p.h + ' px';
      li.append(cv, who, sc); ol.append(li);
    }
  }
  const pct = (x) => (typeof x === 'number' ? Math.round(x * 100) + '%' : '—');
  function say(msg) { const ul = $('notes'); ul.textContent = ''; const li = document.createElement('li'); li.textContent = msg; ul.append(li); $('verdict').textContent = msg; $('verdict').className = 'verdict none'; }

  // ---------- controllo di un riquadro trascinando ----------
  let dragStart = null;
  const toImg = (e) => { const b = ovC.getBoundingClientRect(); return { x: (e.clientX - b.left) * (ovC.width / b.width), y: (e.clientY - b.top) * (ovC.height / b.height) }; };
  ovC.addEventListener('pointerdown', (e) => { if (!st.result) return; dragStart = toImg(e); ovC.setPointerCapture(e.pointerId); });
  ovC.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    const p = toImg(e);
    st.tile = { rect: { x: Math.min(p.x, dragStart.x), y: Math.min(p.y, dragStart.y), w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y) } };
    draw();
  });
  ovC.addEventListener('pointerup', async () => {
    if (!dragStart) return; dragStart = null;
    const t = st.tile;
    if (!t || t.rect.w < 4 || t.rect.h < 4) { st.tile = null; draw(); return; }
    t.rect = { x: Math.round(t.rect.x), y: Math.round(t.rect.y), w: Math.round(t.rect.w), h: Math.round(t.rect.h) };
    try {
      const res = await fetch('/api/tile', { method: 'POST', body: JSON.stringify({ imageId: st.result.imageId, rect: t.rect }) });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || res.status);
      t.status = out.status;
      const d = out.detail && Object.keys(out.detail).length ? ' · ' + Object.entries(out.detail).map(([k, v]) => k + ' ' + v).join(', ') : '';
      $('tileOut').textContent = `Riquadro ${t.rect.w}×${t.rect.h} a (${t.rect.x}, ${t.rect.y}): ${STATUS_IT[out.status] || out.status} (${out.timeMs} ms)${d}`;
    } catch (e) { $('tileOut').textContent = 'Controllo non riuscito: ' + e.message; }
    draw();
  });

  // ---------- ricarica a caldo ----------
  try {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      if (e.data === 'reload') location.reload();
      if (e.data === 'modules') { refreshStatus(); analyze(); }
    };
  } catch (e) { /* niente ricarica a caldo */ }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // ---------- avvio ----------
  (async function init() {
    await refreshStatus();
    try {
      const files = await (await fetch('/api/fixtures')).json();
      const sel = $('fixture');
      for (const f of files) { const o = document.createElement('option'); o.value = f; o.textContent = f; sel.append(o); }
      const last = store.get('fixture');
      if (last && files.includes(last)) { sel.value = last; loadImage('/fixtures/' + encodeURIComponent(last), last); }
    } catch (e) { /* server assente: messaggio gia' nella barra */ }
  })();
})();
