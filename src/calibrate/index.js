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
    // fuori dallo screen capture: il rilevamento automatico vede il gioco, non le cornici
    try { win.setContentProtection(true); } catch (e) { /* non supportato */ }
    win.loadFile(path.join(__dirname, 'calibrate.html')).catch(() => {});
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('closed', () => { win = null; if (onClose) onClose(); });
    if (onOpen) onOpen();
    return { ok: true };
  }

  // ---- IPC calibrazione v2 (concordato con app-dev; rect in DIP) ----
  const RECT_KEYS = ['x', 'y', 'width', 'height'];
  const cleanRect = (r) => (r && typeof r === 'object' && RECT_KEYS.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]))
    ? { x: r.x, y: r.y, width: r.width, height: r.height } : null);
  const missing = (name) => typeof controller[name] !== 'function';

  ipcMain.handle('cal:init', () => {
    try {
      if (!missing('getCalibrationV2')) return controller.getCalibrationV2();
    } catch (e) { /* sotto: valori minimi */ }
    const d = screen.getPrimaryDisplay();
    return { width: d.size.width, height: d.size.height, scaleFactor: d.scaleFactor || 1,
      aspect: layout.aspectLabel(d.size.width, d.size.height), saved: null };
  });
  ipcMain.handle('cal:auto', async () => {
    if (missing('calAutoDetect')) return { ok: false, error: 'Rilevamento non ancora disponibile in questa versione' };
    try { return await controller.calAutoDetect(); } catch (e) {
      return { ok: false, error: 'Rilevamento non riuscito: ' + String(e && e.message).slice(0, 100) };
    }
  });
  ipcMain.handle('cal:save', async (_e, p) => {
    if (missing('saveCalibrationV2')) return { ok: false, error: 'Salvataggio non ancora disponibile in questa versione' };
    const ms = p && Number.isInteger(p.manualSlot) && p.manualSlot >= 0 && p.manualSlot <= 9 ? p.manualSlot : null;
    let r;
    try {
      r = await controller.saveCalibrationV2({ topBar: cleanRect(p && p.topBar), grid: cleanRect(p && p.grid), manualSlot: ms });
    } catch (e) { r = { ok: false, error: 'Salvataggio non riuscito' }; }
    if (r && r.ok) close();
    return r || { ok: false, error: 'Salvataggio non riuscito' };
  });
  ipcMain.handle('cal:cancel', () => { close(); return { ok: true }; });

  return { open, close, isOpen: () => !!(win && !win.isDestroyed()) };
}

module.exports = { createCalibration };
