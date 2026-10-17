'use strict';
(function () {
  const stage = document.getElementById('stage');
  const infoEl = document.getElementById('info');
  const resultEl = document.getElementById('result');
  const MIN = 8;
  let W = 0, H = 0, preset = {}, defs = [], regions = {}, useDefault = false, selected = null;
  const boxes = {}; // id -> {el, res}

  const colorOf = (id) => (id.startsWith('ally') ? 'var(--ally)' : id.startsWith('enemy') ? 'var(--enemy)' : id === 'myHero' ? 'var(--me)' : 'var(--amber)');
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  function fix(r) {
    r.width = clamp(Math.round(r.width), MIN, W);
    r.height = clamp(Math.round(r.height), MIN, H);
    r.x = clamp(Math.round(r.x), 0, W - r.width);
    r.y = clamp(Math.round(r.y), 0, H - r.height);
  }
  function paint(id) {
    const r = regions[id], b = boxes[id];
    b.el.style.left = r.x + 'px'; b.el.style.top = r.y + 'px';
    b.el.style.width = r.width + 'px'; b.el.style.height = r.height + 'px';
    // etichette sempre visibili: dentro il riquadro se non c'e' spazio sopra/sotto
    b.el.classList.toggle('lbl-in', r.y < 22);
    b.el.classList.toggle('res-in', r.y + r.height > H - 22);
  }

  // barra trascinabile dalla maniglia
  (function () {
    const bar = document.getElementById('bar'), grip = document.getElementById('grip');
    grip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const rc = bar.getBoundingClientRect();
      const ox = ev.clientX - rc.left, oy = ev.clientY - rc.top;
      bar.style.transform = 'none'; bar.style.left = rc.left + 'px'; bar.style.top = rc.top + 'px';
      grip.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const r2 = bar.getBoundingClientRect();
        bar.style.left = clamp(e.clientX - ox, 0, window.innerWidth - r2.width) + 'px';
        bar.style.top = clamp(e.clientY - oy, 0, window.innerHeight - r2.height) + 'px';
      };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
  })();
  function select(id) {
    selected = id;
    for (const k of Object.keys(boxes)) boxes[k].el.classList.toggle('sel', k === id);
  }
  function edited() { useDefault = false; }

  function build() {
    stage.textContent = '';
    for (const d of defs) {
      const el = document.createElement('div');
      el.className = 'box'; el.style.setProperty('--c', colorOf(d.id)); el.dataset.id = d.id;
      const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = d.label;
      const res = document.createElement('span'); res.className = 'res'; res.hidden = true;
      el.append(lbl, res);
      for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const h = document.createElement('div'); h.className = 'h'; h.dataset.d = dir; el.appendChild(h);
      }
      stage.appendChild(el);
      boxes[d.id] = { el, res };
      paint(d.id);
      el.addEventListener('pointerdown', (ev) => startDrag(ev, d.id));
    }
    select(selected && boxes[selected] ? selected : defs[0].id);
  }

  function startDrag(ev, id) {
    ev.preventDefault();
    select(id);
    const dir = ev.target.dataset && ev.target.dataset.d;
    const start = { ...regions[id] }, sx = ev.clientX, sy = ev.clientY;
    const el = boxes[id].el;
    el.setPointerCapture(ev.pointerId);
    const move = (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const r = { ...start };
      if (!dir) { r.x = start.x + dx; r.y = start.y + dy; }
      else {
        if (dir.includes('e')) r.width = start.width + dx;
        if (dir.includes('s')) r.height = start.height + dy;
        if (dir.includes('w')) { r.x = start.x + dx; r.width = start.width - dx; }
        if (dir.includes('n')) { r.y = start.y + dy; r.height = start.height - dy; }
        if (r.width < MIN) { if (dir.includes('w')) r.x = start.x + start.width - MIN; r.width = MIN; }
        if (r.height < MIN) { if (dir.includes('n')) r.y = start.y + start.height - MIN; r.height = MIN; }
      }
      fix(r); regions[id] = r; paint(id); edited();
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { window.calApi.cancel(); return; }
    const ids = defs.map((d) => d.id);
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = ids.indexOf(selected);
      select(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      return;
    }
    const step = e.ctrlKey ? 10 : 1;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir || !selected) return;
    e.preventDefault();
    const r = { ...regions[selected] };
    if (e.shiftKey) { r.width += dir[0] * step; r.height += dir[1] * step; }
    else { r.x += dir[0] * step; r.y += dir[1] * step; }
    fix(r); regions[selected] = r; paint(selected); edited();
  });

  function copy(o) { const c = {}; for (const k of Object.keys(o)) c[k] = { ...o[k] }; return c; }

  document.getElementById('cancel').onclick = () => window.calApi.cancel();
  document.getElementById('reset').onclick = () => {
    regions = copy(preset); useDefault = true;
    for (const d of defs) paint(d.id);
    resultEl.textContent = 'Predefiniti ripristinati: premi Salva per applicarli.';
  };
  document.getElementById('save').onclick = async () => {
    const r = await window.calApi.save(regions, useDefault);
    if (r && !r.ok) resultEl.textContent = 'Errore: ' + (r.error || 'salvataggio non riuscito');
  };
  document.getElementById('test').onclick = async () => {
    resultEl.textContent = 'Lettura in corso...';
    for (const k of Object.keys(boxes)) boxes[k].res.hidden = true;
    const r = await window.calApi.test(regions);
    const parts = [];
    if (r.error) parts.push(r.error);
    parts.push('Ruolo: ' + (r.role ? 'Pos ' + r.role : 'non letto') + (r.roleText ? ' ("' + r.roleText + '")' : ''));
    if (boxes.roleText) {
      const b = boxes.roleText.res; b.hidden = false;
      b.className = 'res ' + (r.role ? 'ok' : 'no'); b.textContent = r.role ? 'Pos ' + r.role : 'non letto';
    }
    for (const id of Object.keys(r.slots || {})) {
      const b = boxes[id]; if (!b) continue;
      const s = r.slots[id];
      b.res.hidden = false; b.res.className = 'res ' + (s ? 'ok' : 'no'); b.res.textContent = s ? s.name : 'non riconosciuto';
    }
    for (const n of r.notes || []) parts.push(n);
    resultEl.textContent = parts.join(' | ');
  };

  window.calApi.init().then((d) => {
    W = d.width; H = d.height; preset = d.preset; defs = d.defs; regions = copy(d.regions);
    infoEl.textContent = `Risoluzione ${d.width}x${d.height} (scala ${d.scaleFactor}, ${d.aspect}). Regioni: ${d.source === 'utente' ? 'tue' : 'predefinite'}.`;
    build();
  });
})();
