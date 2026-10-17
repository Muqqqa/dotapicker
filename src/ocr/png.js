'use strict';
/*
 * Decoder PNG minimale (solo zlib di Node, nessuna dipendenza) -> RGBA {data:Buffer, width, height}.
 * Supporta bit depth 8, color type 0 (grigio), 2 (RGB), 3 (palette), 4 (grigio+alpha), 6 (RGBA), senza interlacciamento.
 * Usato da test, banco prova e strumenti; nell'app la cattura arriva da nativeImage (vedi fromBitmapBGRA).
 */
const zlib = require('zlib');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Non e\' un PNG');
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = d.readUInt32BE(0); height = d.readUInt32BE(4);
      depth = d[8]; ctype = d[9]; interlace = d[12];
    } else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error('PNG: bit depth ' + depth + ' non supportato');
  if (interlace) throw new Error('PNG interlacciato non supportato');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('PNG: color type ' + ctype + ' non supportato');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      out[i] = v & 255;
    }
    prev = out;
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    const k = i * ch;
    if (ctype === 6) { data[j] = px[k]; data[j + 1] = px[k + 1]; data[j + 2] = px[k + 2]; data[j + 3] = px[k + 3]; }
    else if (ctype === 2) { data[j] = px[k]; data[j + 1] = px[k + 1]; data[j + 2] = px[k + 2]; data[j + 3] = 255; }
    else if (ctype === 0) { data[j] = data[j + 1] = data[j + 2] = px[k]; data[j + 3] = 255; }
    else if (ctype === 4) { data[j] = data[j + 1] = data[j + 2] = px[k]; data[j + 3] = px[k + 1]; }
    else {
      const p = px[k] * 3;
      data[j] = palette[p]; data[j + 1] = palette[p + 1]; data[j + 2] = palette[p + 2];
      data[j + 3] = trns && px[k] < trns.length ? trns[px[k]] : 255;
    }
  }
  return { data, width, height };
}

/** Bitmap BGRA (nativeImage.toBitmap() su Windows) -> RGBA. */
function fromBitmapBGRA(bgra, width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bgra[i + 2]; data[i + 1] = bgra[i + 1]; data[i + 2] = bgra[i]; data[i + 3] = bgra[i + 3];
  }
  return { data, width, height };
}

/** Ritaglio RGBA -> nuovo RGBA (rect in pixel, clampato). */
function cropRgba(img, r) {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const w = Math.max(1, Math.min(img.width - x0, Math.round(r.width)));
  const h = Math.max(1, Math.min(img.height - y0, Math.round(r.height)));
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * img.width + x0) * 4;
    Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length).copy(data, y * w * 4, s, s + w * 4);
  }
  return { data, width: w, height: h };
}

let CRC = null;
function crc32(buf) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  }
  let x = 0xffffffff;
  for (let i = 0; i < buf.length; i++) x = CRC[(x ^ buf[i]) & 255] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}
function chunk(type, d) {
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}

/** RGBA -> PNG (Buffer), RGBA 8 bit, filtro 0. */
function encodePng(img) {
  const { width: w, height: h } = img;
  const src = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) src.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Ridimensiona RGBA (bilineare in ingrandimento, media in riduzione). */
function resizeRgba(img, w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const out = Buffer.alloc(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (sx > 1 || sy > 1) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        const acc = [0, 0, 0, 0]; let n = 0;
        for (let yy = y0; yy < Math.min(y1, img.height); yy++) {
          for (let xx = x0; xx < Math.min(x1, img.width); xx++) {
            const i = (yy * img.width + xx) * 4;
            acc[0] += img.data[i]; acc[1] += img.data[i + 1]; acc[2] += img.data[i + 2]; acc[3] += img.data[i + 3]; n++;
          }
        }
        for (let c = 0; c < 4; c++) out[o + c] = n ? Math.round(acc[c] / n) : 0;
      } else {
        const fx = Math.max(0, (x + 0.5) * sx - 0.5), fy = Math.max(0, (y + 0.5) * sy - 0.5);
        const x0 = Math.min(img.width - 1, Math.floor(fx)), y0 = Math.min(img.height - 1, Math.floor(fy));
        const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
        const ax = fx - x0, ay = fy - y0;
        for (let c = 0; c < 4; c++) {
          const p = (xx, yy) => img.data[(yy * img.width + xx) * 4 + c];
          out[o + c] = Math.round((p(x0, y0) * (1 - ax) + p(x1, y0) * ax) * (1 - ay) + (p(x0, y1) * (1 - ax) + p(x1, y1) * ax) * ay);
        }
      }
    }
  }
  return { data: out, width: w, height: h };
}

module.exports = { decodePng, encodePng, resizeRgba, fromBitmapBGRA, cropRgba };
