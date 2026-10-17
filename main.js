'use strict';
const path = require('path');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, nativeImage, safeStorage, shell } = require('electron');
const ALLOWED_HOSTS = ['stratz.com'];
const { Store } = require('./src/main/store');
const { Controller } = require('./src/main/controller');
const { createCalibration } = require('./src/calibrate');

const SHOW_KEY = 'F8';
const CLICK_KEY = 'F9';
const CALIBRATE_KEY = 'F10';
let calibration = null;
const OVERLAY_WIDTH = 480;

let win = null;
let controller = null;
let store = null;
let clickThrough = false;

function applyClickThrough() {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: wa.x + wa.width - OVERLAY_WIDTH - 16,
    y: wa.y + 16,
    width: OVERLAY_WIDTH,
    height: Math.max(400, wa.height - 32),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  // link esterni: solo https verso host consentiti, nel browser di sistema; mai nuove finestre Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      const ok = u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
      if (ok) shell.openExternal(u.toString()).catch(() => {});
    } catch (e) { /* URL non valido: ignora */ }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  // esclude l'overlay dallo screen capture, cosi' l'OCR non vede l'overlay stesso
  try { win.setContentProtection(true); } catch (e) { /* non supportato */ }
  // sempre cliccabile all'avvio: un click-through rimasto salvato da una sessione precedente renderebbe l'overlay
  // muto (i clic passano a Dota) senza alcun segno visibile. F9 lo attiva solo per la sessione in corso.
  clickThrough = false;
  store.set('clickThrough', false);
  applyClickThrough();
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html')).catch((e) => {
    console.error('[main] renderer non caricabile:', e.message);
  });
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { win = null; });
}

// Chiusura a prova di blocco: se un worker OCR o un'attivita' in corso impedisce l'uscita, dopo 1,5 s si esce comunque.
let quitting = false;
function quitApp() {
  if (quitting) return;
  quitting = true;
  try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
  try { if (controller) controller.dispose().catch(() => {}); } catch (e) { /* ignore */ }
  try { if (win && !win.isDestroyed()) win.hide(); } catch (e) { /* ignore */ }
  app.quit();
  const t = setTimeout(() => app.exit(0), 1500);
  if (t.unref) t.unref();
}

function toggleVisible() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
}

function toggleClickThrough(v) {
  clickThrough = typeof v === 'boolean' ? v : !clickThrough;
  store.set('clickThrough', clickThrough);
  applyClickThrough();
  return clickThrough;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    controller = new Controller({
      store,
      userDataDir: app.getPath('userData'),
      desktopCapturer, screen, nativeImage, safeStorage,
      emit: (s) => { if (win && !win.isDestroyed()) win.webContents.send('state', s); },
      emitSettings: (s) => { if (win && !win.isDestroyed()) win.webContents.send('settings', s); },
    });

    let overlayWasVisible = false;
    calibration = createCalibration({
      BrowserWindow, ipcMain, screen, controller,
      onOpen: () => { overlayWasVisible = !!(win && !win.isDestroyed() && win.isVisible()); if (overlayWasVisible) win.hide(); },
      onClose: () => { if (overlayWasVisible && win && !win.isDestroyed()) win.showInactive(); },
    });
    ipcMain.handle('settings:get', () => controller.getSettings());
    ipcMain.handle('stratz:save', (_e, t) => controller.saveStratzToken(t));
    ipcMain.handle('cal:start', () => calibration.open());

    ipcMain.handle('state:get', () => controller.getState());
    ipcMain.handle('steam:save', (_e, id) => controller.saveSteamId(id));
    ipcMain.handle('role:set', (_e, r) => controller.setRole(Number(r)));
    ipcMain.handle('overlay:clickthrough', (_e, v) => toggleClickThrough(v));
    ipcMain.handle('overlay:hide', () => { if (win) win.hide(); });
    ipcMain.handle('overlay:quit', () => { quitApp(); });

    createWindow();
    if (!globalShortcut.register(SHOW_KEY, toggleVisible)) console.warn('[main] scorciatoia ' + SHOW_KEY + ' non registrata');
    globalShortcut.register(CLICK_KEY, () => toggleClickThrough());
    globalShortcut.register(CALIBRATE_KEY, () => { if (calibration.isOpen()) calibration.close(); else calibration.open(); });
    // gli eventi di stato partono dopo il caricamento del renderer
    win.webContents.once('did-finish-load', () => controller.start(1500));
  });

  app.on('second-instance', () => { if (win) win.showInactive(); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); });
  app.on('window-all-closed', () => { quitApp(); });
}

process.on('uncaughtException', (e) => console.error('[main] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[main] unhandledRejection:', e));
