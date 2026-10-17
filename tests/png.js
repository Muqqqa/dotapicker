'use strict';
// Decodifica PNG -> RGBA {data:Uint8ClampedArray, width, height} con il solo zlib di Node. Possiede: tester.
// Supporta: profondita' 1/2/4/8/16, tipi colore 0 (grigio), 2 (RGB), 3 (palette + tRNS), 4 (grigio+alfa), 6 (RGBA),
// interlacciamento Adam7. Piu' due utilita' per i test: scaleRGBA (bilineare) e cropRGBA.
const fs = require('fs');
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Toglie i filtri di una sotto-immagine (w x h) partendo da raw[off]; ritorna { rows:[Buffer], next }
function unfilter(raw, off, w, h, bpp, bitsPerPixel) {
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    if (off >= raw.length) throw new Error('PNG troncato (dati immagine insufficienti)');
    const ft = raw[off++];
    const cur = Buffer.from(raw.subarray(off, off + stride));
    off += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      switch (ft) {
        case 0: break;
        case 1: cur[i] = (cur[i] + a) & 255; break;
        case 2: cur[i] = (cur[i] + b) & 255; break;
        case 3: cur[i] = (cur[i] + ((a + b) >> 1)) & 255; break;
        case 4: cur[i] = (cur[i] + paeth(a, b, c)) & 255; break;
        default: throw new Error('filtro PNG sconosciuto: ' + ft);
      }
    }
    rows.push(cur);
    prev = cur;
  }
  return { rows, next: off };
}

function decodePNG(buf) {
  if (typeof buf === 'string') buf = fs.readFileSync(buf);
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('non e\' un file PNG');
  let off = 8, ihdr = null, palette = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      ihdr = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG senza IHDR');
  const { width, height, depth, color, interlace } = ihdr;
  const ch = CHANNELS[color];
  if (!ch) throw new Error('tipo colore PNG non supportato: ' + color);
  if (color === 3 && !palette) throw new Error('PNG a palette senza PLTE');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = ch * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8ClampedArray(width * height * 4);
  const maxV = (1 << depth) - 1;

  const sample = (row, x, c) => { // valore del canale c del pixel x, a 8 bit (eccetto palette: indice)
    if (depth === 8) return row[x * ch + c];
    if (depth === 16) return row[(x * ch + c) * 2]; // byte alto
    const bit = (x * ch + c) * depth;
    const v = (row[bit >> 3] >> (8 - depth - (bit & 7))) & maxV;
    return color === 3 ? v : Math.round((v * 255) / maxV);
  };
  const raw16 = (row, x, c) => (depth === 16 ? row.readUInt16BE((x * ch + c) * 2) : null);
  const put = (row, x, ox, oy) => {
    const o = (oy * width + ox) * 4;
    let r, g, b, a = 255;
    if (color === 0 || color === 4) {
      r = g = b = sample(row, x, 0);
      if (color === 4) a = sample(row, x, 1);
      else if (trns && trns.length >= 2) {
        const tv = trns.readUInt16BE(0);
        const v = depth === 16 ? raw16(row, x, 0) : (depth === 8 ? row[x] : Math.round((r * maxV) / 255));
        if (v === tv) a = 0;
      }
    } else if (color === 2 || color === 6) {
      r = sample(row, x, 0); g = sample(row, x, 1); b = sample(row, x, 2);
      if (color === 6) a = sample(row, x, 3);
      else if (trns && trns.length >= 6) {
        const same = depth === 16
          ? raw16(row, x, 0) === trns.readUInt16BE(0) && raw16(row, x, 1) === trns.readUInt16BE(2) && raw16(row, x, 2) === trns.readUInt16BE(4)
          : r === trns.readUInt16BE(0) && g === trns.readUInt16BE(2) && b === trns.readUInt16BE(4);
        if (same) a = 0;
      }
    } else { // palette
      const i = sample(row, x, 0);
      r = palette[i * 3]; g = palette[i * 3 + 1]; b = palette[i * 3 + 2];
      if (trns && i < trns.length) a = trns[i];
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  };

  if (!interlace) {
    const { rows } = unfilter(raw, 0, width, height, bpp, bitsPerPixel);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(rows[y], x, x, y);
  } else {
    let p = 0;
    for (const [x0, y0, dx, dy] of ADAM7) {
      const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy);
      if (w <= 0 || h <= 0) continue;
      const { rows, next } = unfilter(raw, p, w, h, bpp, bitsPerPixel);
      p = next;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(rows[y], x, x0 + x * dx, y0 + y * dy);
    }
  }
  return { data: out, width, height };
}

// Ridimensiona (bilineare) di un fattore s o a {width,height}.
function scaleRGBA(img, s) {
  const W = typeof s === 'number' ? Math.max(1, Math.round(img.width * s)) : s.width;
  const H = typeof s === 'number' ? Math.max(1, Math.round(img.height * s)) : s.height;
  const out = new Uint8ClampedArray(W * H * 4);
  const sx = img.width / W, sy = img.height / H, src = img.data, iw = img.width;
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5), y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5), x0 = Math.floor(fx), x1 = Math.min(iw - 1, x0 + 1), wx = fx - x0;
      const a = (y0 * iw + x0) * 4, b = (y0 * iw + x1) * 4, c = (y1 * iw + x0) * 4, d = (y1 * iw + x1) * 4, o = (y * W + x) * 4;
      for (let k = 0; k < 4; k++) {
        out[o + k] = (src[a + k] * (1 - wx) + src[b + k] * wx) * (1 - wy) + (src[c + k] * (1 - wx) + src[d + k] * wx) * wy;
      }
    }
  }
  return { data: out, width: W, height: H };
}

// Ritaglia {x,y,w,h} (limitato ai bordi).
function cropRGBA(img, r) {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  const w = Math.min(img.width - x, Math.round(r.w)), h = Math.min(img.height - y, Math.round(r.h));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) out.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  return { data: out, width: w, height: h };
}

module.exports = { decodePNG, scaleRGBA, cropRGBA };
