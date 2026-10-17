'use strict';
// Banco tools/vision-bench: parte senza Electron, serve la pagina, analizza una fixture con i moduli veri.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { p, exists } = require('./helpers');
const { decodePNG } = require('./png');

function startServer() {
  return new Promise((ok, ko) => {
    const child = spawn(process.execPath, [p('tools', 'vision-bench', 'server.js')], { env: Object.assign({}, process.env, { PORT: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); ko(new Error('il banco non parte: ' + out)); }, 10000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(timer); ok({ child, base: 'http://localhost:' + m[1] }); }
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => { clearTimeout(timer); ko(new Error('il banco e\' uscito (' + code + '): ' + out)); });
  });
}
function body(meta, px) {
  const json = Buffer.from(JSON.stringify(meta));
  const head = Buffer.alloc(4); head.writeUInt32BE(json.length);
  return Buffer.concat([head, json, Buffer.from(px.buffer, px.byteOffset, px.length)]);
}

test('vision-bench: pagina, fixture e analisi di draft-allpick-dire', async (t) => {
  if (!exists('tools', 'vision-bench', 'server.js')) return t.skip('banco assente');
  const { child, base } = await startServer();
  try {
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /Banco prova lettura schermo/);
    for (const f of ['/bench.js', '/bench.css']) assert.equal((await fetch(base + f)).status, 200, f);
    const fixtures = await (await fetch(base + '/api/fixtures')).json();
    assert.ok(fixtures.includes('draft-allpick-dire.png'));
    assert.equal((await fetch(base + '/fixtures/..%2F..%2Fpackage.json')).status, 403, 'path traversal non bloccato');

    const img = decodePNG(p('tests', 'fixtures', 'draft-allpick-dire.png'));
    const meta = { width: img.width, height: img.height, nick: "Mooq'a#PEPPE", names: Array.from({ length: 10 }, (_, i) => (i === 5 ? "Mooq'a#PE…" : '')), ocr: false };
    const res = await fetch(base + '/api/analyze', { method: 'POST', body: body(meta, img.data) });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    if (!out.modules.topbar.ok) return t.skip('topbar.js non disponibile: ' + out.modules.topbar.message);
    assert.equal(out.topbar.result.slots.length, 10);
    assert.deepEqual(out.match && { index: out.match.index, side: out.match.side }, { index: 5, side: 'dire' });
    if (out.modules.heroGrid.ok) assert.ok(out.grid && out.grid.rect, 'griglia non trovata');

    const bad = await fetch(base + '/api/analyze', { method: 'POST', body: body({ width: 10, height: 10 }, new Uint8Array(12)) });
    assert.equal(bad.status, 500, 'pixel incoerenti accettati');
    if (out.modules.heroGrid.ok) {
      const tile = await (await fetch(base + '/api/tile', { method: 'POST', body: JSON.stringify({ imageId: out.imageId, rect: { x: 359, y: 161, w: 34, h: 59 } }) })).json();
      assert.ok(['available', 'banned', 'unavailable', 'unknown'].includes(tile.status), JSON.stringify(tile));
    }
  } finally {
    child.kill();
  }
});
