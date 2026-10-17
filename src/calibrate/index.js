'use strict';
// Finestra di calibrazione: trasparente, a tutto schermo, sopra il gioco (lato main).
const path = require('path');
const layout = require('../ocr/layout');

function createCalibration({ BrowserWindow, ipcMain, screen, controller, onOpen, onClose }) {
  let win = null;

  function close() {
    if (win && !win.isDestroyed()) win.close();
  }

  function open() {
    if (win && !win.isDestroyed()) { win.focus(); return { ok: true }; }
    const d = screen.getPrimaryDisplay();
    win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, transparent: true, alwaysOnTop: true, resizable: false, movable: false,
      skipTaskbar: true, hasShadow: false, fullscreenable: false, show: false, backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'cal-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // fuori dallo screen capture: "Prova lettura" vede il gioco, non i riquadri
    try { win.setContentProtection(true); } catch (e) { /* non supportato */ }
    win.loadFile(path.join(__dirname, 'calibrate.html')).catch(() => {});
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('closed', () => { win = null; if (onClose) onClose(); });
    if (onOpen) onOpen();
    return { ok: true };
  }

  ipcMain.handle('cal:init', () => {
    const ri = controller.refreshRegions();
    return {
      width: ri.width, height: ri.height, scaleFactor: ri.scaleFactor, aspect: ri.aspect, source: ri.source,
      regions: ri.regions, preset: ri.preset,
      defs: layout.REGION_IDS.map((id) => ({ id, label: layout.REGION_LABELS[id] })),
    };
  });
  ipcMain.handle('cal:save', (_e, p) => {
    const r = controller.saveCalibration(p && p.regions, p && p.useDefault);
    if (r.ok) close();
    return r;
  });
  ipcMain.handle('cal:test', (_e, regions) => controller.testRead(regions).catch((e) => ({ error: String(e.message).slice(0, 100), slots: {}, notes: [] })));
  ipcMain.handle('cal:cancel', () => { close(); return { ok: true }; });

  return { open, close, isOpen: () => !!(win && !win.isDestroyed()) };
}

module.exports = { createCalibration };
