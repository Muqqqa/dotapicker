'use strict';
/*
 * Griglia eroi del draft (funzioni PURE su RGBA {data, width, height}, nessuna dipendenza).
 *
 * - findTiles: trova i riquadri dei ritratti senza posizioni fisse. Cerca componenti "con texture"
 *   di forma verticale (ritratti), ne ricava la misura tipica e il reticolo (colonne/righe), poi
 *   riempie le posizioni del reticolo che contengono qualcosa (anche riquadri spenti).
 * - tileStatus: 'banned' (linea rossa diagonale basso-sx -> alto-dx), 'unavailable' (riquadro spento,
 *   quasi senza dettagli), 'available', 'unknown' (vuoto/indecidibile).
 * - locateHero: confronto in scala di grigi (NCC) tra l'icona dell'eroe e ogni riquadro, ignorando la
 *   banda diagonale (dove passa la linea del ban) e il bordo basso (numeri/indicatori). L'icona CDN e'
 *   orizzontale (16:9) mentre il riquadro e' verticale: si provano piu' ritagli dell'icona.
 * Tutte le soglie sono relative alla misura dei riquadri: indipendente da risoluzione e proporzioni.
 */

function lumaOf(img) {
  const { data, width: W, height: H } = img;
  const L = new Float32Array(W * H);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return L;
}

const lumaCache = new WeakMap();
function luma(img) {
  let L = lumaCache.get(img.data);
  if (!L || L.length !== img.width * img.height) { L = lumaOf(img); lumaCache.set(img.data, L); }
  return L;
}

function median(a) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function cluster(values, tol) {
  const s = values.slice().sort((a, b) => a - b);
  const out = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last.vals[last.vals.length - 1] <= tol) last.vals.push(v); else out.push({ vals: [v] });
  }
  return out.map((c) => ({ v: median(c.vals), n: c.vals.length }));
}

/** Statistiche di un rettangolo: luminanza media, deviazione standard, saturazione media. */
function rectStats(img, r, L) {
  const { data, width: W } = img;
  L = L || luma(img);
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(img.width, Math.round(r.x + r.width)), y1 = Math.min(img.height, Math.round(r.y + r.height));
  let n = 0, s = 0, s2 = 0, sat = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x, l = L[i], j = i * 4;
      n++; s += l; s2 += l * l;
      sat += Math.max(data[j], data[j + 1], data[j + 2]) - Math.min(data[j], data[j + 1], data[j + 2]);
    }
  }
  if (!n) return { mean: 0, sd: 0, sat: 0 };
  const m = s / n;
  return { mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)), sat: sat / n };
}

/** Componenti di celle con texture (gradiente medio sopra soglia). */
function textureComponents(img, area) {
  const W = img.width, H = img.height;
  const L = luma(img);
  const c = Math.max(2, Math.round(Math.min(W, H) / 300));
  const ax = area ? Math.max(0, Math.floor(area.x)) : 0, ay = area ? Math.max(0, Math.floor(area.y)) : 0;
  const aw = area ? Math.min(W - ax, Math.ceil(area.width)) : W, ah = area ? Math.min(H - ay, Math.ceil(area.height)) : H;
  const cw = Math.floor(aw / c), ch = Math.floor(ah / c);
  const T = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let s = 0, n = 0;
      for (let y = ay + cy * c; y < ay + cy * c + c; y++) {
        if (y + 1 >= H) continue;
        for (let x = ax + cx * c; x < ax + cx * c + c; x++) {
          if (x + 1 >= W) continue;
          const i = y * W + x;
          s += Math.abs(L[i + 1] - L[i]) + Math.abs(L[i + W] - L[i]); n++;
        }
      }
      T[cy * cw + cx] = n && s / n > 8 ? 1 : 0;
    }
  }
  const lab = new Int32Array(cw * ch).fill(-1);
  const comps = [];
  const st = [];
  for (let i = 0; i < T.length; i++) {
    if (!T[i] || lab[i] >= 0) continue;
    lab[i] = comps.length; st.push(i);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    while (st.length) {
      const j = st.pop(), x = j % cw, y = (j / cw) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && T[j - 1] && lab[j - 1] < 0) { lab[j - 1] = comps.length; st.push(j - 1); }
      if (x < cw - 1 && T[j + 1] && lab[j + 1] < 0) { lab[j + 1] = comps.length; st.push(j + 1); }
      if (y > 0 && T[j - cw] && lab[j - cw] < 0) { lab[j - cw] = comps.length; st.push(j - cw); }
      if (y < ch - 1 && T[j + cw] && lab[j + cw] < 0) { lab[j + cw] = comps.length; st.push(j + cw); }
    }
    comps.push({ x: ax + x0 * c, y: ay + y0 * c, width: (x1 - x0 + 1) * c, height: (y1 - y0 + 1) * c, fill: n / ((x1 - x0 + 1) * (y1 - y0 + 1)) });
  }
  return { comps, cell: c };
}

const tilesCache = new WeakMap();

/**
 * Riquadri della griglia eroi.
 * @returns {{tiles:Array<{x,y,width,height,row,col}>, tileW:number, tileH:number, grid:Rect}|null}
 */
function findTiles(img, area) {
  if (!img || !img.data || !img.width || !img.height) return null;
  const key = area ? `${area.x},${area.y},${area.width},${area.height}` : '*';
  let per = tilesCache.get(img.data);
  if (per && per.has(key)) return per.get(key);
  const res = computeTiles(img, area);
  if (!per) { per = new Map(); tilesCache.set(img.data, per); }
  per.set(key, res);
  return res;
}

function computeTiles(img, area) {
  const H = img.height;
  const { comps, cell } = textureComponents(img, area);
  const minH = (area ? area.height : H) * 0.03;
  // ritratti: verticali (h/w ~1.7), pieni di texture
  const shaped = comps.filter((k) => k.height >= minH && k.height / k.width > 1.4 && k.height / k.width < 2.2 && k.fill > 0.5);
  if (shaped.length < 4) return null;
  // misura tipica: mediana delle misure piu' frequenti
  let tw = median(shaped.map((k) => k.width)), th = median(shaped.map((k) => k.height));
  const seeds = shaped.filter((k) => Math.abs(k.width - tw) <= tw * 0.2 && Math.abs(k.height - th) <= th * 0.2);
  if (seeds.length < 4) return null;
  tw = median(seeds.map((k) => k.width)) - cell / 2; // le celle arrotondano per eccesso
  th = median(seeds.map((k) => k.height)) - cell / 2;
  // colonne: componenti larghe come un riquadro (anche fuse in verticale)
  const colSrc = comps.filter((k) => Math.abs(k.width - tw) <= tw * 0.25 && k.height >= th * 0.8);
  const rowSrc = comps.filter((k) => Math.abs(k.height - th) <= th * 0.2 && k.width >= tw * 0.8);
  let cols = cluster(colSrc.map((k) => k.x), tw * 0.3).filter((c) => c.n >= 1).map((c) => c.v);
  let rows = cluster(rowSrc.map((k) => k.y), th * 0.2).filter((c) => c.n >= 2).map((c) => c.v);
  // una riga/colonna deve contenere almeno un riquadro "pulito"
  rows = rows.filter((y) => seeds.some((s) => Math.abs(s.y - y) <= th * 0.2));
  cols = cols.filter((x) => seeds.some((s) => Math.abs(s.x - x) <= tw * 0.3) || colSrc.filter((s) => Math.abs(s.x - x) <= tw * 0.3).length >= 2);
  if (!rows.length) return null;
  // colonne anche dal profilo orizzontale di ogni riga (fascia centrale del riquadro, dove gli spazi
  // tra riquadri sono puliti): evita le fusioni verticali dovute a numeri/indicatori sotto i ritratti
  const L0 = luma(img);
  const W = img.width;
  const ax0 = area ? Math.max(0, Math.floor(area.x)) : 0, ax1 = area ? Math.min(W - 1, Math.ceil(area.x + area.width)) : W - 1;
  const starts = [];
  for (const y of rows) {
    const ya = Math.round(y + th * 0.2), yb = Math.min(img.height - 1, Math.round(y + th * 0.75));
    const prof = new Float32Array(W);
    for (let yy = ya; yy < yb; yy++) {
      for (let x = ax0; x < ax1; x++) {
        const i = yy * W + x;
        if (Math.abs(L0[i + 1] - L0[i]) + Math.abs(L0[i + W] - L0[i]) > 8) prof[x]++;
      }
    }
    const n = Math.max(1, yb - ya);
    let s = -1;
    for (let x = ax0; x <= ax1; x++) {
      const on = x < ax1 && prof[x] / n > 0.12;
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        const w = x - s;
        if (w >= tw * 0.8 && w <= tw * 1.2) starts.push(s);
        s = -1;
      }
    }
  }
  // il profilo e' piu' preciso delle componenti (celle grossolane): ha la precedenza
  const profCols = cluster(starts, tw * 0.3).map((c) => c.v);
  cols = [...profCols, ...cols.filter((x) => !profCols.some((c) => Math.abs(c - x) <= tw * 0.5))];
  cols.sort((a, b) => a - b);
  if (!cols.length) return null;
  // colonne/righe mancanti in mezzo (es. tutta una colonna spenta): passo regolare
  const fill = (arr, size) => {
    const out = arr.slice();
    const gaps = [];
    for (let i = 1; i < arr.length; i++) gaps.push(arr[i] - arr[i - 1]);
    const pitch = gaps.length ? Math.min(...gaps.filter((g) => g > size)) : 0;
    if (!(pitch > size && pitch < size * 1.6)) return out;
    for (let i = 1; i < arr.length; i++) {
      const g = arr[i] - arr[i - 1], k = Math.round(g / pitch);
      if (k >= 2 && Math.abs(g / pitch - k) < 0.12) for (let m = 1; m < k; m++) out.push(arr[i - 1] + (g * m) / k);
    }
    return out.sort((a, b) => a - b);
  };
  cols = fill(cols, tw);
  rows = fill(rows, th);
  const L = luma(img);
  const tiles = [];
  rows.forEach((y, ri) => {
    cols.forEach((x, ci) => {
      const r = { x: Math.round(x), y: Math.round(y), width: Math.round(tw), height: Math.round(th) };
      if (r.x + r.width > img.width || r.y + r.height > img.height) return;
      const st = rectStats(img, r, L);
      if (st.sd < 4.5) return; // sfondo: nessun riquadro in questa posizione
      tiles.push({ ...r, row: ri, col: ci });
    });
  });
  if (tiles.length < 4) return null;
  const gx0 = Math.min(...tiles.map((t) => t.x)), gy0 = Math.min(...tiles.map((t) => t.y));
  const gx1 = Math.max(...tiles.map((t) => t.x + t.width)), gy1 = Math.max(...tiles.map((t) => t.y + t.height));
  // piccolo margine: i bordi dei riquadri sono sfumati
  const pad = Math.max(2, Math.round(tw * 0.06));
  const x0 = Math.max(0, gx0 - pad), y0 = Math.max(0, gy0 - pad);
  const grid = { x: x0, y: y0, width: Math.min(img.width, gx1 + pad) - x0, height: Math.min(img.height, gy1 + pad) - y0 };
  return { tiles, tileW: Math.round(tw), tileH: Math.round(th), grid };
}

/** Area della griglia eroi (pixel) o null. */
function findHeroGrid(rgba) {
  const t = findTiles(rgba);
  return t && t.tiles.length >= 10 ? t.grid : null;
}

/**
 * Linea rossa diagonale dal basso-sx all'alto-dx: per ogni riga cerca il picco di "rosso" vicino alla
 * diagonale attesa, poi verifica che i picchi siano allineati (retta con pendenza giusta) e sottili.
 * @returns {number} 0..1 frazione di righe che confermano la linea
 */
function banLineScore(img, r) {
  const { data, width: W } = img;
  const x0 = Math.round(r.x), y0 = Math.round(r.y), w = Math.round(r.width), h = Math.round(r.height);
  if (w < 6 || h < 6) return 0;
  const win = Math.max(3, Math.round(w * 0.22));
  const side = Math.max(2, Math.round(w * 0.1));
  const red = (x, y) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return -999;
    const j = (y * W + x) * 4;
    return data[j] - Math.max(data[j + 1], data[j + 2]); // rosso vero: l oro (R~G) non conta
  };
  const pts = [];
  let rowsTried = 0;
  for (let yy = Math.round(h * 0.08); yy < Math.round(h * 0.92); yy++) {
    const y = y0 + yy;
    rowsTried++;
    const ex = x0 + w * (1 - yy / h); // diagonale ideale
    let best = -1e9, bx = -1;
    for (let x = Math.round(ex - win); x <= Math.round(ex + win); x++) {
      if (x < x0 || x >= x0 + w) continue;
      const v = (red(x - 1, y) + 2 * red(x, y) + red(x + 1, y)) / 4;
      if (v > best) { best = v; bx = x; }
    }
    if (bx < 0) continue;
    const l = Math.max(red(bx - side, y), red(bx - side - 1, y));
    const rr = Math.max(red(bx + side, y), red(bx + side + 1, y));
    // linea sottile: il picco supera entrambi i lati
    if (best - l >= 6 && best - rr >= 6 && best > -10) pts.push({ x: bx - x0, y: yy });
  }
  if (rowsTried < 4 || pts.length < rowsTried * 0.3) return 0;
  // retta robusta x = a + b*y (b atteso ~ -w/h)
  let best = 0;
  const expB = -w / h;
  const y8 = Math.round(h * 0.08), span = Math.max(1, Math.round(h * 0.92) - y8);
  for (let it = 0; it < 40; it++) {
    const p = pts[(it * 7919) % pts.length], q = pts[(it * 104729 + 13) % pts.length];
    if (Math.abs(p.y - q.y) < h * 0.2) continue;
    const b = (q.x - p.x) / (q.y - p.y);
    if (b > expB * 0.4 || b < expB * 1.8) continue;
    const a = p.x - b * p.y;
    const tol = Math.max(1.5, w * 0.05);
    let n = 0;
    const thirds = [0, 0, 0];
    for (const s of pts) {
      if (Math.abs(a + b * s.y - s.x) <= tol) { n++; thirds[Math.min(2, Math.floor((s.y - y8) / span * 3))]++; }
    }
    // la linea del ban attraversa tutto il riquadro: ogni terzo deve confermarla
    const sc = Math.min(n / rowsTried, 1.2 * Math.min(...thirds) / (rowsTried / 3));
    if (sc > best) best = sc;
  }
  return best;
}

/**
 * @returns {'banned'|'unavailable'|'available'|'unknown'}
 */
function tileStatus(rgba, tileRect, detail) {
  if (!rgba || !tileRect || tileRect.width < 4 || tileRect.height < 4) return 'unknown';
  const st = rectStats(rgba, tileRect);
  const line = banLineScore(rgba, tileRect);
  if (detail) Object.assign(detail, { mean: Math.round(st.mean), sd: Math.round(st.sd), sat: Math.round(st.sat), line: Math.round(line * 100) / 100 });
  if (st.sd < 4) return 'unknown';           // sfondo: nessun riquadro
  // riquadro spento: basta una linea debole; riquadro acceso: serve una linea netta (la texture
  // del ritratto produce falsi picchi fino a ~0.45 sulle fixture)
  if (st.sd < 19) return line >= 0.3 ? 'banned' : 'unavailable';
  if (line >= 0.6) return 'banned';
  if (line >= 0.47 || st.sd < 24) return 'unknown'; // zona grigia: nel dubbio il controller esclude
  return 'available';
}

// ---- riconoscimento eroe ---------------------------------------------------------

const DW = 9, DH = 15;           // descrittore del riquadro (scala di grigi)
const MASK = (() => {             // ignora banda diagonale e fascia bassa (numeri, indicatori)
  const m = new Uint8Array(DW * DH);
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const u = (x + 0.5) / DW, v = 1 - (y + 0.5) / DH;
      m[y * DW + x] = Math.abs(u - v) > 0.13 && y < DH * 0.85 ? 1 : 0;
    }
  }
  return m;
})();

/** Media su aree di un rettangolo (luma) -> vettore DW x DH. */
function sampleGray(L, W, H, r) {
  const v = new Float32Array(DW * DH);
  for (let gy = 0; gy < DH; gy++) {
    const ya = r.y + (gy * r.height) / DH, yb = r.y + ((gy + 1) * r.height) / DH;
    for (let gx = 0; gx < DW; gx++) {
      const xa = r.x + (gx * r.width) / DW, xb = r.x + ((gx + 1) * r.width) / DW;
      let s = 0, n = 0;
      const sy = Math.max(1, Math.round((yb - ya) / 3)), sx = Math.max(1, Math.round((xb - xa) / 3));
      for (let y = Math.floor(ya); y < Math.ceil(yb); y += sy) {
        if (y < 0 || y >= H) continue;
        for (let x = Math.floor(xa); x < Math.ceil(xb); x += sx) {
          if (x < 0 || x >= W) continue;
          s += L[y * W + x]; n++;
        }
      }
      v[gy * DW + gx] = n ? s / n : 0;
    }
  }
  return v;
}

function maskedNcc(a, b) {
  let ma = 0, mb = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (MASK[i]) { ma += a[i]; mb += b[i]; n++; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    if (!MASK[i]) continue;
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-6 ? -1 : num / den;
}

const tplCache = new WeakMap();
/** Ritagli verticali dell'icona orizzontale (piu' scale e posizioni) -> descrittori. */
function templateVariants(template) {
  let v = tplCache.get(template.data);
  if (v) return v;
  const L = luma(template);
  const W = template.width, H = template.height;
  v = [];
  const aspect = DW / DH * 1.0; // ~0.6 come i riquadri reali
  for (const s of [1, 0.85, 0.72, 0.6]) {
    const h = H * s, w = Math.min(W, h * aspect);
    for (const fx of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      for (const fy of s < 1 ? [0, 0.5, 1] : [0]) {
        const x = (W - w) * fx, y = (H - h) * fy;
        v.push(sampleGray(L, W, H, { x, y, width: w, height: h }));
      }
    }
  }
  if (W / H < 1) v.push(sampleGray(L, W, H, { x: 0, y: 0, width: W, height: H })); // icona gia' verticale
  tplCache.set(template.data, v);
  return v;
}

const tileDescCache = new WeakMap();
function tileDescriptors(rgba, tiles) {
  let d = tileDescCache.get(tiles);
  if (d) return d;
  const L = luma(rgba);
  d = tiles.map((t) => sampleGray(L, rgba.width, rgba.height, t));
  tileDescCache.set(tiles, d);
  return d;
}

/**
 * @param rgba schermata
 * @param gridRect area della griglia (o null = tutta l'immagine)
 * @param template RGBA dell'icona dell'eroe (CDN 16:9 o ritratto verticale)
 * @param {{minScore?:number, minMargin?:number, tiles?:Array}} [opts]
 * @returns {{rect, score, margin}|null}
 */
function locateHero(rgba, gridRect, template, opts = {}) {
  if (!rgba || !template || !template.data) return null;
  let tiles = opts.tiles;
  if (!tiles) {
    const area = gridRect ? { x: gridRect.x - 4, y: gridRect.y - 4, width: gridRect.width + 8, height: gridRect.height + 8 } : null;
    const t = findTiles(rgba, area);
    tiles = t ? t.tiles : null;
  }
  if (!tiles || !tiles.length) return null;
  const desc = tileDescriptors(rgba, tiles);
  const vars = templateVariants(template);
  let best = -2, bi = -1, second = -2;
  for (let i = 0; i < desc.length; i++) {
    let s = -2;
    for (const tv of vars) { const c = maskedNcc(desc[i], tv); if (c > s) s = c; }
    if (s > best) { second = best; best = s; bi = i; } else if (s > second) second = s;
  }
  const minScore = opts.minScore != null ? opts.minScore : 0.6;
  const minMargin = opts.minMargin != null ? opts.minMargin : 0.04;
  if (bi < 0 || best < minScore || best - second < minMargin) return null;
  const t = tiles[bi];
  return { rect: { x: t.x, y: t.y, width: t.width, height: t.height }, score: Math.round(best * 1000) / 1000, margin: Math.round((best - second) * 1000) / 1000 };
}

// ---- mappa per ordine (ordinamento "Attributi") ------------------------------------

const ATTR_ORDER = ['str', 'agi', 'int', 'all'];

/** Divide i riquadri in blocchi (spazi piu' larghi del passo tra colonne/righe), in ordine di lettura. */
function gridBlocks(tiles) {
  if (!tiles || !tiles.length) return [];
  const groups = (vals) => {
    const s = [...new Set(vals)].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < s.length; i++) gaps.push(s[i] - s[i - 1]);
    // passo = mediana della meta' bassa degli spazi (robusta a una colonna un po' fuori posto)
    const low = gaps.slice().sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(gaps.length / 2)));
    const pitch = low.length ? low[low.length >> 1] : 0;
    const map = new Map();
    let g = 0;
    s.forEach((v, i) => { if (i && s[i] - s[i - 1] > pitch * 1.18) g++; map.set(v, g); });
    return map;
  };
  const gx = groups(tiles.map((t) => t.x)), gy = groups(tiles.map((t) => t.y));
  const blocks = new Map();
  for (const t of tiles) {
    const k = gy.get(t.y) * 1000 + gx.get(t.x);
    if (!blocks.has(k)) blocks.set(k, []);
    blocks.get(k).push(t);
  }
  return [...blocks.keys()].sort((a, b) => a - b).map((k) => blocks.get(k).sort((a, b) => (a.y - b.y) || (a.x - b.x)));
}

/**
 * Identifica gli eroi dalla posizione: con l'ordinamento per attributi il client mostra i blocchi
 * Forza / Agilita' / Intelligenza / Universale, ciascuno in ordine alfabetico. Un blocco viene usato
 * solo se il numero di riquadri coincide ESATTAMENTE col numero di eroi di quell'attributo.
 * @param {Array<{id:number, name:string, attr:'str'|'agi'|'int'|'all'}>} heroes
 * @returns {{byHero:Map<number,Rect>, mappedBlocks:number, blocks:number, counts:number[]}}
 */
function mapGridByOrder(rgba, gridRect, heroes, opts = {}) {
  const out = { byHero: new Map(), mappedBlocks: 0, blocks: 0, counts: [] };
  let tiles = opts.tiles;
  if (!tiles) {
    const area = gridRect ? { x: gridRect.x - 4, y: gridRect.y - 4, width: gridRect.width + 8, height: gridRect.height + 8 } : null;
    const t = findTiles(rgba, area);
    tiles = t ? t.tiles : null;
  }
  if (!tiles || !Array.isArray(heroes) || !heroes.length) return out;
  const blocks = gridBlocks(tiles);
  out.blocks = blocks.length;
  out.counts = blocks.map((b) => b.length);
  const byAttr = {};
  for (const a of ATTR_ORDER) {
    byAttr[a] = heroes.filter((h) => h.attr === a)
      .sort((p, q) => String(p.name).localeCompare(String(q.name), 'en', { sensitivity: 'base', ignorePunctuation: true }));
  }
  // i blocchi seguono l'ordine degli attributi; se ne manca uno (fuori schermo) si allinea per conteggio
  let ai = 0;
  for (const b of blocks) {
    while (ai < ATTR_ORDER.length && byAttr[ATTR_ORDER[ai]].length !== b.length) ai++;
    if (ai >= ATTR_ORDER.length) break;
    const list = byAttr[ATTR_ORDER[ai]];
    b.forEach((t, i) => out.byHero.set(list[i].id, { x: t.x, y: t.y, width: t.width, height: t.height }));
    out.mappedBlocks++;
    ai++;
  }
  return out;
}

module.exports = { findHeroGrid, findTiles, tileStatus, locateHero, mapGridByOrder, gridBlocks, banLineScore, rectStats };
