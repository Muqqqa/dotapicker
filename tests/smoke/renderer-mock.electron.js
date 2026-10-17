'use strict';
// Eseguito DA electron: `electron tests/smoke/renderer-mock.electron.js`
// Carica src/renderer/index.html?mock=1 offscreen, raccoglie errori console, stampa JSON.
const path = require('path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 480, height: 900, webPreferences: { contextIsolation: true } });
  const errors = [];
  const logs = [];
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    // level: 0 verbose,1 info,2 warning,3 error (firma legacy o evento)
    const msg = typeof level === 'object' ? level.message : message;
    const lv = typeof level === 'object' ? level.level : level;
    (lv === 3 || lv === 'error' ? errors : logs).push(msg);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => errors.push(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on('render-process-gone', (_e, d) => errors.push('render-process-gone ' + d.reason));
  await win.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), { query: { mock: '1' } });
  await new Promise((r) => setTimeout(r, 2500));
  const info = await win.webContents.executeJavaScript(`({
    hasApi: typeof window.api,
    appChildren: document.getElementById('app') ? document.getElementById('app').children.length : -1,
    imgs: document.images.length,
    brokenImgs: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
    text: document.body.innerText.slice(0, 600)
  })`);
  console.log('SMOKE_RESULT ' + JSON.stringify({ errors, info, logs: logs.slice(0, 10) }));
  app.exit(0);
});
