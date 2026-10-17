'use strict';
/*
 * Calibrazione automatica (contratto v2). Rect sempre in DIP del display principale;
 * la finestra copre il display, quindi 1 DIP ~ 1 px CSS (k corregge eventuali differenze).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const api = window.calApi;
  const MIN = 12;
  const SLOT_NAMES = ['R1', 'R2', 'R3', 'R4', 'R5', 'D1', 'D2', 'D3', 'D4', 'D5'];

  let W = 0, H = 0, k = 1;
  let det = null;            // ultimo esito di autoDetect
  let saved = null;          // calibrazione salvata {topBar, grid, manualSlot}
  let nickname = null;
  let manualSlot = null;     // slot scelto a mano (0..9) o null
  let busy = false, moving = false;
  // rect correnti delle due cornici e se sono state posizionate a mano
  const fr = { topBar: { rect: null, manual: false }, grid: { rect: null, manual: false } };
  let slotRel = [];          // slot relativi alla barra rilevata (seguono la cornice se la sposti)

  const el = { top: $('fTop'), grid: $('fGrid'), me: $('me'), msg: $('msg'), live: $('live'),
    outcome: $('outcome'), manual: $('manual'), move: $('move'), hint: $('moveHint') };
  const frameOf = { topBar: el.top, grid: el.grid };

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const isRect = (r) => r && [r.x, r.y, r.width, r.height].every((v) => typeof v === 'number' && Number.isFinite(v));
  const copyR = (r) => (isRect(r) ? { x: r.x, y: r.y, width: r.width, height: r.height } : null);
  const sideOf = (i) => (i < 5 ? 'radiant' : 'dire');
  const slotLabel = (i) => 'slot ' + ((i % 5) + 1) + ' di ' + (i < 5 ? 'sinistra' : 'destra');

  function fix(r) {
    r.width = clamp(Math.round(r.width), MIN, W);
    r.height = clamp(Math.round(r.height), MIN, H);
    r.x = clamp(Math.round(r.x), 0, W - r.width);
    r.y = clamp(Math.round(r.y), 0, H - r.height);
    return r;
  }
  function place(node, r) {
    node.style.left = r.x * k + 'px'; node.style.top = r.y * k + 'px';
    node.style.width = r.width * k + 'px'; node.style.height = r.height * k + 'px';
  }
  function setMsg(t, err) { el.msg.textContent = t || ''; el.msg.classList.toggle('err', !!err); }
  function announce(t) { el.live.textContent = ''; setTimeout(() => { el.live.textContent = t; }, 30); }

  // ---------- cornici ----------
  function paintFrames() {
    for (const id of ['topBar', 'grid']) {
      const f = fr[id], node = frameOf[id];
      node.hidden = !f.rect;
      if (!f.rect) continue;
      place(node, f.rect);
      node.classList.toggle('manual-pos', f.manual);
      // etichetta sotto la cornice; sopra o dentro se non c'e' spazio
      const below = f.rect.y + f.rect.height + 30 < H;
      node.classList.toggle('lbl-up', !below && f.rect.y > 30);
      node.classList.toggle('lbl-in', !below && f.rect.y <= 30);
      const what = id === 'topBar' ? 'Barra eroi' : 'Griglia eroi';
      const how = f.manual ? 'posizionata a mano' : (id === 'grid' ? 'trovata in automatico · per i ban' : 'trovata in automatico');
      node.querySelector('.flabel').textContent = what + ' · ' + how;
      node.setAttribute('aria-label', 'Cornice ' + what.toLowerCase() + ', ' + how);
    }
    paintMe();
  }
  function paintMe() {
    const slot = currentSlot();
    const r = fr.topBar.rect, rel = slot != null ? slotRel[slot] : null;
    if (!r || !rel) { el.me.hidden = true; return; }
    el.me.hidden = false;
    // posizione relativa alla cornice (il nodo e' figlio della cornice)
    el.me.style.left = rel.x * r.width * k - 2 + 'px';
    el.me.style.top = rel.y * r.height * k - 2 + 'px';
    el.me.style.width = rel.w * r.width * k + 'px';
    el.me.style.height = rel.h * r.height * k + 'px';
  }

  function computeSlotRel() {
    slotRel = [];
    const tb = det && copyR(det.topBar);
    if (!tb || !Array.isArray(det.slots)) return;
    for (const s of det.slots) {
      const parts = [s.portrait, s.bar, s.name].filter(isRect);
      if (!parts.length || typeof s.index !== 'number') continue;
      const x0 = Math.min(...parts.map((p) => p.x)), y0 = Math.min(...parts.map((p) => p.y));
      const x1 = Math.max(...parts.map((p) => p.x + p.width)), y1 = Math.max(...parts.map((p) => p.y + p.height));
      slotRel[s.index] = { x: (x0 - tb.x) / tb.width, y: (y0 - tb.y) / tb.height, w: (x1 - x0) / tb.width, h: (y1 - y0) / tb.height };
    }
  }

  // ---------- stato dei passi ----------
  const nickFound = () => !!(det && det.ok && det.slotSource === 'nickname' && det.mySlot != null);
  function currentSlot() {
    if (nickFound()) return det.mySlot;
    if (manualSlot != null) return manualSlot;
    return null;
  }
  function step(id, state, title, detailNodes) {
    const li = $(id);
    li.dataset.state = state;
    li.querySelector('.st-title').textContent = title;
    li.querySelector('.st-state').textContent = state === 'ok' ? ' (fatto)' : state === 'warn' ? ' (da verificare)' : ' (in corso)';
    const d = li.querySelector('.st-detail');
    d.textContent = '';
    for (const n of [].concat(detailNodes || [])) d.append(n);
  }
  const b = (t) => { const s = document.createElement('b'); s.textContent = t; return s; };

  function render() {
    paintFrames();
    if (busy || !det) {
      step('s1', 'wait', 'Barra degli eroi', 'Ricerca in corso…');
      step('s2', 'wait', 'Nickname', 'In attesa della barra');
      step('s3', 'wait', 'Squadra dedotta dal nickname', '');
      el.outcome.hidden = true; el.manual.hidden = true;
      return;
    }
    if (!det.ok) {
      step('s1', 'warn', 'Barra degli eroi non trovata', det.error || 'Rilevamento non riuscito.');
      step('s2', 'warn', 'Nickname non letto', 'Serve la barra degli eroi.');
      step('s3', 'warn', 'Squadra non dedotta', 'Riprova con “Rileva di nuovo” quando sei nel draft.');
      el.outcome.hidden = true; el.manual.hidden = true;
      return;
    }

    // 1. barra
    const nSlots = Array.isArray(det.slots) ? det.slots.length : 0;
    const nFound = nSlots ? det.slots.filter((s) => s.found).length : 0;
    if (det.topBar) {
      const extra = nFound < nSlots ? ' (' + (nSlots - nFound) + ' ricostruite per simmetria)' : '';
      step('s1', 'ok', 'Barra degli eroi trovata', [b(nFound + ' barre colorate'), ' degli slot riconosciute in alto' + extra + '.']);
    } else if (fr.topBar.manual) {
      step('s1', 'ok', 'Barra degli eroi posizionata a mano', 'Verrà usata come zona di ricerca a ogni draft.');
    } else {
      step('s1', 'warn', 'Barra degli eroi non trovata', 'Entra nel draft e premi “Rileva di nuovo”, oppure spostala a mano.');
    }

    // 2. nickname
    const nick = det.nickname || nickname;
    if (nickFound()) {
      step('s2', 'ok', 'Nickname trovato', ['OCR dei nomi sotto i 10 slot: ', b(nick || 'il tuo nome'), ' è nello ', b(slotLabel(det.mySlot)), '.']);
    } else if (!nick) {
      step('s2', 'warn', 'Nickname non trovato', 'Nessun nickname dal profilo Steam: controlla lo Steam ID nelle impostazioni.');
    } else if (!det.topBar) {
      step('s2', 'warn', 'Nickname non trovato', ['Cercherò ', b(nick), ' sotto i 10 slot quando la barra è visibile.']);
    } else {
      step('s2', 'warn', 'Nickname non trovato', ['Cercato ', b(nick), ' tra i nomi letti: nessuna corrispondenza sicura.']);
    }

    // 3. squadra
    const slot = currentSlot();
    if (slot != null) {
      const side = sideOf(slot), sideName = side === 'radiant' ? 'Radiant' : 'Dire';
      const where = side === 'radiant' ? 'a sinistra' : 'a destra';
      const why = nickFound() ? 'Nick ' + where : 'Slot scelto a mano ' + where;
      step('s3', 'ok', nickFound() ? 'Squadra dedotta dal nickname' : 'Squadra dal tuo slot', [why + ' → sei ', b(sideName), '. Riletto a ogni draft, mai fisso.']);
      el.outcome.hidden = false;
      el.outcome.className = 'outcome ' + side;
      el.outcome.textContent = '';
      const s = document.createElement('strong'); s.textContent = sideName.toUpperCase();
      el.outcome.append(s, ' · ' + (side === 'radiant' ? 'Alleati a sinistra, nemici a destra' : 'Alleati a destra, nemici a sinistra') +
        ' · slot ' + ((slot % 5) + 1) + ' di 5');
    } else {
      step('s3', 'warn', 'Squadra non ancora dedotta', 'Serve il tuo nickname o il tuo slot.');
      el.outcome.hidden = true;
    }

    // scelta manuale dello slot se il nick non e' stato letto
    el.manual.hidden = nickFound();
    for (const btn of document.querySelectorAll('.slotbtn')) btn.setAttribute('aria-pressed', String(Number(btn.dataset.slot) === manualSlot));
  }

  function summary() {
    if (!det || !det.ok) return 'Rilevamento non riuscito. ' + ((det && det.error) || '');
    const parts = [det.topBar ? 'Barra degli eroi trovata.' : 'Barra degli eroi non trovata.'];
    parts.push(nickFound() ? 'Nickname trovato.' : 'Nickname non trovato: indica tu il tuo slot.');
    const slot = currentSlot();
    if (slot != null) parts.push('Sei ' + (slot < 5 ? 'Radiant' : 'Dire') + ', slot ' + ((slot % 5) + 1) + ' di 5.');
    return parts.join(' ');
  }

  // ---------- rilevamento ----------
  async function detect(resetManual) {
    if (busy) return;
    busy = true; det = null;
    el.move.disabled = true; $('redetect').disabled = true; $('confirm').disabled = true;
    setMsg(''); render(); announce('Rilevamento in corso');
    try {
      const r = await api.autoDetect();
      det = r && typeof r === 'object' ? r : { ok: false, error: 'Risposta non valida' };
    } catch (e) {
      det = { ok: false, error: 'Rilevamento non disponibile: ' + String((e && e.message) || e).slice(0, 80) };
    }
    if (det.width && det.height) { W = det.width; H = det.height; k = window.innerWidth / W || 1; }
    if (det.ok && det.manualSlot != null && manualSlot == null) manualSlot = det.manualSlot;
    computeSlotRel();
    for (const id of ['topBar', 'grid']) {
      if (resetManual) fr[id].manual = false;
      if (!fr[id].manual) fr[id].rect = det.ok ? copyR(det[id]) : null;
    }
    busy = false;
    el.move.disabled = false; $('redetect').disabled = false; $('confirm').disabled = false;
    render();
    if (det.ok && Array.isArray(det.notes) && det.notes.length) setMsg(det.notes.join(' · '));
    announce(summary());
  }

  // ---------- slot manuali ----------
  function buildSlotButtons() {
    SLOT_NAMES.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'slotbtn'; btn.dataset.slot = String(i); btn.textContent = name;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', (i < 5 ? 'Radiant' : 'Dire') + ' slot ' + ((i % 5) + 1));
      btn.addEventListener('click', () => {
        manualSlot = manualSlot === i ? null : i;
        render();
        announce(manualSlot == null ? 'Scelta dello slot annullata' : 'Scelto ' + (i < 5 ? 'Radiant' : 'Dire') + ' slot ' + ((i % 5) + 1) + '. Premi Conferma per salvare.');
      });
      $(i < 5 ? 'pickR' : 'pickD').appendChild(btn);
    });
  }

  // ---------- spostamento a mano delle 2 cornici ----------
  let selected = 'topBar';
  function selectFrame(id) {
    selected = id;
    for (const k2 of Object.keys(frameOf)) frameOf[k2].classList.toggle('sel', moving && k2 === id);
  }
  function setMoving(on) {
    moving = on;
    document.body.classList.toggle('moving', on);
    el.move.setAttribute('aria-pressed', String(on));
    el.move.textContent = on ? 'Fine spostamento' : 'Sposta la barra a mano';
    el.hint.hidden = !on;
    if (on) {
      // senza rilevamento si parte da una posizione plausibile
      if (!fr.topBar.rect) { fr.topBar.rect = fix({ x: W * 0.2, y: 0, width: W * 0.6, height: H * 0.09 }); fr.topBar.manual = true; }
      if (!fr.grid.rect) { fr.grid.rect = fix({ x: W * 0.15, y: H * 0.28, width: W * 0.7, height: H * 0.42 }); fr.grid.manual = true; }
      for (const node of Object.values(frameOf)) node.tabIndex = 0;
      render();
      selectFrame('topBar');
      el.top.focus();
      announce('Spostamento attivo: trascina le cornici Barra eroi e Griglia eroi.');
    } else {
      for (const node of Object.values(frameOf)) node.removeAttribute('tabindex');
      selectFrame(selected);
      el.move.focus();
      render();
    }
  }
  function changed(id) { fr[id].manual = true; paintFrames(); }

  function startDrag(ev, id) {
    if (!moving || !fr[id].rect) return;
    ev.preventDefault();
    selectFrame(id);
    frameOf[id].focus();
    const dir = ev.target.dataset && ev.target.dataset.d;
    const start = { ...fr[id].rect }, sx = ev.clientX, sy = ev.clientY;
    const node = frameOf[id];
    node.setPointerCapture(ev.pointerId);
    const move = (e) => {
      const dx = (e.clientX - sx) / k, dy = (e.clientY - sy) / k;
      const r = { ...start };
      if (!dir) { r.x += dx; r.y += dy; } else {
        if (dir.includes('e')) r.width = start.width + dx;
        if (dir.includes('s')) r.height = start.height + dy;
        if (dir.includes('w')) { r.x = start.x + dx; r.width = start.width - dx; }
        if (dir.includes('n')) { r.y = start.y + dy; r.height = start.height - dy; }
        if (r.width < MIN) { if (dir.includes('w')) r.x = start.x + start.width - MIN; r.width = MIN; }
        if (r.height < MIN) { if (dir.includes('n')) r.y = start.y + start.height - MIN; r.height = MIN; }
      }
      fr[id].rect = fix(r); changed(id);
    };
    const up = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
  }
  for (const [id, node] of Object.entries(frameOf)) {
    for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const h = document.createElement('div'); h.className = 'h'; h.dataset.d = d; node.appendChild(h);
    }
    node.addEventListener('pointerdown', (ev) => startDrag(ev, id));
    node.addEventListener('focus', () => { if (moving) selectFrame(id); });
    node.addEventListener('keydown', (e) => {
      const v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!moving || !v || !fr[id].rect) return;
      e.preventDefault();
      const s = e.ctrlKey ? 10 : 1, r = { ...fr[id].rect };
      if (e.shiftKey) { r.width += v[0] * s; r.height += v[1] * s; } else { r.x += v[0] * s; r.y += v[1] * s; }
      fr[id].rect = fix(r); changed(id);
    });
  }

  // pannello trascinabile dall'intestazione (per scoprire cio' che copre)
  (function () {
    const panel = $('panel'), grip = $('grip');
    grip.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      ev.preventDefault();
      const rc = panel.getBoundingClientRect();
      const ox = ev.clientX - rc.left, oy = ev.clientY - rc.top;
      panel.style.transform = 'none'; panel.style.left = rc.left + 'px'; panel.style.top = rc.top + 'px';
      grip.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const r2 = panel.getBoundingClientRect();
        panel.style.left = clamp(e.clientX - ox, 0, window.innerWidth - r2.width) + 'px';
        panel.style.top = clamp(e.clientY - oy, 0, window.innerHeight - r2.height) + 'px';
      };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
  })();

  // ---------- comandi ----------
  function cancel() { if (api) api.cancel(); }
  $('close').addEventListener('click', cancel);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (moving) setMoving(false); else cancel();
  });
  el.move.addEventListener('click', () => setMoving(!moving));
  $('redetect').addEventListener('click', () => { if (moving) setMoving(false); detect(true); });
  $('confirm').addEventListener('click', async () => {
    if (busy) return;
    if (moving) setMoving(false);
    const payload = {
      topBar: fr.topBar.manual ? copyR(fr.topBar.rect) : null, // null = rilevamento automatico a ogni draft
      grid: fr.grid.manual ? copyR(fr.grid.rect) : null,
      manualSlot: nickFound() ? (saved && saved.manualSlot != null ? saved.manualSlot : null) : manualSlot,
    };
    $('confirm').disabled = true;
    setMsg('Salvataggio…');
    let r;
    try { r = await api.save(payload); } catch (e) { r = { ok: false, error: String((e && e.message) || e).slice(0, 80) }; }
    $('confirm').disabled = false;
    if (r && r.ok) { saved = payload; setMsg('Calibrazione salvata.'); announce('Calibrazione salvata'); } else {
      setMsg('Errore: ' + ((r && r.error) || 'salvataggio non riuscito'), true);
      announce('Salvataggio non riuscito');
    }
  });

  // ---------- avvio ----------
  buildSlotButtons();
  if (!api) {
    setMsg('Finestra di calibrazione senza collegamento all\'app. Nel browser apri calibrate.html?mock=1', true);
    return;
  }
  W = window.innerWidth; H = window.innerHeight;
  render();
  Promise.resolve(api.init ? api.init() : null).catch(() => null).then((d) => {
    if (d && d.width && d.height) { W = d.width; H = d.height; k = window.innerWidth / W || 1; }
    nickname = (d && d.nickname) || null;
    saved = d && d.saved ? d.saved : null;
    if (saved) {
      if (typeof saved.manualSlot === 'number' && saved.manualSlot >= 0 && saved.manualSlot <= 9) manualSlot = saved.manualSlot;
      for (const id of ['topBar', 'grid']) if (isRect(saved[id])) fr[id] = { rect: copyR(saved[id]), manual: true };
    }
    $('confirm').focus();
    detect(false);
  });
  window.addEventListener('resize', () => { k = window.innerWidth / (W || window.innerWidth) || 1; paintFrames(); });
})();
