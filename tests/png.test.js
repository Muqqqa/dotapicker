'use strict';
// Decodifica PNG (tests/png.js): fixture reali + PNG sintetici con tutti i filtri e tipi colore.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { p } = require('./helpers');
const { decodePNG, scaleRGBA, cropRGBA } = require('./png');

// ---- mini encoder (solo per i test) ----
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
// rows: array di Buffer (byte grezzi non filtrati). Applica il filtro (y % 5) a ogni riga.
function encode({ width, height, depth, color, rows, bpp, plte, trns }) {
  const parts = [];
  let prev = Buffer.alloc(rows[0].length);
  rows.forEach((row, y) => {
    const ft = y % 5, f = Buffer.alloc(row.length);
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let pr = 0;
      if (ft === 1) pr = a; else if (ft === 2) pr = b; else if (ft === 3) pr = (a + b) >> 1;
      else if (ft === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      f[i] = (row[i] - pr) & 255;
    }
    parts.push(Buffer.from([ft]), f); prev = row;
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = color;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...(plte ? [chunk('PLTE', plte)] : []), ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(parts))), chunk('IEND', Buffer.alloc(0))]);
}
const W = 7, H = 6;
const px = (x, y) => [(x * 37 + y * 11) & 255, (x * 5 + y * 71) & 255, (x * 113 + y * 3) & 255, (x * 29 + y * 53 + 7) & 255];

test('PNG RGBA 8 bit, tutti i filtri', () => {
  const rows = []; for (let y = 0; y < H; y++) { const r = Buffer.alloc(W * 4); for (let x = 0; x < W; x++) r.set(px(x, y), x * 4); rows.push(r); }
  const img = decodePNG(encode({ width: W, height: H, depth: 8, color: 6, rows, bpp: 4 }));
  assert.equal(img.width, W); assert.equal(img.height, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.deepEqual([...img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)], px(x, y), `pixel ${x},${y}`);
});

test('PNG RGB 8 bit -> alfa 255', () => {
  const rows = []; for (let y = 0; y < H; y++) { const r = Buffer.alloc(W * 3); for (let x = 0; x < W; x++) r.set(px(x, y).slice(0, 3), x * 3); rows.push(r); }
  const img = decodePNG(encode({ width: W, height: H, depth: 8, color: 2, rows, bpp: 3 }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.deepEqual([...img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)], [...px(x, y).slice(0, 3), 255]);
});

test('PNG scala di grigi 8 bit e 1 bit', () => {
  const rows8 = []; for (let y = 0; y < H; y++) rows8.push(Buffer.from(Array.from({ length: W }, (_, x) => px(x, y)[0])));
  const g = decodePNG(encode({ width: W, height: H, depth: 8, color: 0, rows: rows8, bpp: 1 }));
  assert.deepEqual([...g.data.subarray(4 * 3, 4 * 3 + 4)], [px(3, 0)[0], px(3, 0)[0], px(3, 0)[0], 255]);
  // 1 bit: scacchiera 9x3 (righe da 2 byte)
  const bit = (x, y) => (x + y) & 1;
  const rows1 = []; for (let y = 0; y < 3; y++) { const r = Buffer.alloc(2); for (let x = 0; x < 9; x++) if (bit(x, y)) r[x >> 3] |= 0x80 >> (x & 7); rows1.push(r); }
  const b = decodePNG(encode({ width: 9, height: 3, depth: 1, color: 0, rows: rows1, bpp: 1 }));
  for (let y = 0; y < 3; y++) for (let x = 0; x < 9; x++) assert.equal(b.data[(y * 9 + x) * 4], bit(x, y) ? 255 : 0);
});

test('PNG a palette con tRNS', () => {
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const trns = Buffer.from([255, 128]);
  const rows = [Buffer.from([0, 1, 2]), Buffer.from([2, 1, 0])];
  const img = decodePNG(encode({ width: 3, height: 2, depth: 8, color: 3, rows, bpp: 1, plte, trns }));
  assert.deepEqual([...img.data.subarray(0, 12)], [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255]);
});

test('file non PNG -> errore chiaro', () => {
  assert.throws(() => decodePNG(Buffer.from('ciao mondo, non sono un png')), /PNG/);
});

test('fixture reali: dimensioni e pixel (confrontati con System.Drawing)', () => {
  const g = decodePNG(p('tests', 'fixtures', 'griglia-ban-reali.png'));
  assert.equal(g.width, 1675); assert.equal(g.height, 891);
  const at = (im, x, y) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];
  assert.deepEqual(at(g, 10, 10), [35, 45, 53, 255]);
  assert.deepEqual(at(g, 798, 260), [97, 77, 84, 255]);
  const d = decodePNG(p('tests', 'fixtures', 'draft-allpick-dire.png'));
  assert.equal(d.width, 2000); assert.equal(d.height, 837);
  assert.deepEqual(at(d, 1000, 500), [176, 171, 161, 255]);
});

test('scaleRGBA e cropRGBA', () => {
  const img = { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4).fill(200) };
  const s = scaleRGBA(img, 1.5); assert.equal(s.width, 6); assert.equal(s.height, 3); assert.equal(s.data[0], 200);
  const c = cropRGBA(img, { x: 1, y: 0, w: 10, h: 1 }); assert.equal(c.width, 3); assert.equal(c.height, 1);
});
