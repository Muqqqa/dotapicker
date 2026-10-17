'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { spawnSync, spawn } = require('child_process');
const { ROOT, p, exists } = require('./helpers');

const electronBin = () => {
  try { return require(p('node_modules', 'electron')); } catch (e) { return null; }
};

test('statico: index.html referenzia file esistenti', (t) => {
  if (!exists('src', 'renderer', 'index.html')) return t.skip('renderer assente');
  const html = fs.readFileSync(p('src', 'renderer', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]).filter((r) => !/^https?:/.test(r));
  assert.ok(refs.length > 0);
  for (const r of refs) assert.ok(exists('src', 'renderer', r), 'file mancante: ' + r);
});

test('statico: script del progetto con sintassi valida', () => {
  const files = ['main.js', 'preload.js', 'src/renderer/renderer.js', 'src/renderer/mock.js'].filter((f) => exists(...f.split('/')));
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', p(...f.split('/'))], { encoding: 'utf8' });
    assert.equal(r.status, 0, f + ': ' + r.stderr);
  }
});

test('smoke: renderer index.html?mock=1 carica senza errori in console', { timeout: 60000 }, (t) => {
  const bin = electronBin();
  if (!bin || !exists('src', 'renderer', 'mock.js')) return t.skip('electron o renderer non disponibili');
  const r = spawnSync(bin, [p('tests', 'smoke', 'renderer-mock.electron.js')], { encoding: 'utf8', timeout: 45000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('SMOKE_RESULT '));
  assert.ok(line, 'nessun risultato: ' + r.stdout + r.stderr);
  const res = JSON.parse(line.slice('SMOKE_RESULT '.length));
  assert.deepEqual(res.errors, [], 'errori console: ' + res.errors.join(' | '));
  assert.ok(res.info.appChildren > 0, '#app vuoto');
  assert.ok(res.info.imgs > 0, 'nessuna immagine eroe');
});

test('smoke: l\'app Electron parte e resta viva 6s senza errori su stderr', { timeout: 60000 }, async (t) => {
  const bin = electronBin();
  if (!bin || !exists('main.js')) return t.skip('electron o main.js non disponibili');
  const child = spawn(bin, ['.'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  let exited = null;
  child.stderr.on('data', (d) => { err += d; });
  child.on('exit', (c) => { exited = c; });
  await new Promise((r) => setTimeout(r, 6000));
  const alive = exited === null;
  try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch (e) { child.kill(); }
  assert.ok(alive, 'l\'app e\' terminata prematuramente, codice ' + exited + ' ' + err);
  const bad = err.split('\n').filter((l) => /error|exception|cannot find/i.test(l) && !/autofill|dbus|GPU process|gpu_|special-words/i.test(l));
  assert.deepEqual(bad, [], 'stderr: ' + bad.join('\n'));
});
