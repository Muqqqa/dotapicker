'use strict';
const path = require('path');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, nativeImage } = require('electron');
const { Store } = require('./src/main/store');
const { Controller } = require('./src/main/controller');

const SHOW_KEY = 'F8';
const CLICK_KEY = 'F9';
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
  // esclude l'overlay dallo screen capture, cosi' l'OCR non vede l'overlay stesso
  try { win.setContentProtection(true); } catch (e) { /* non supportato */ }
  clickThrough = !!store.get('clickThrough', false);
  applyClickThrough();
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html')).catch((e) => {
    console.error('[main] renderer non caricabile:', e.message);
  });
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { win = null; });
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
      desktopCapturer, screen, nativeImage,
      emit: (s) => { if (win && !win.isDestroyed()) win.webContents.send('state', s); },
    });

    ipcMain.handle('state:get', () => controller.getState());
    ipcMain.handle('steam:save', (_e, id) => controller.saveSteamId(id));
    ipcMain.handle('role:set', (_e, r) => controller.setRole(Number(r)));
    ipcMain.handle('overlay:clickthrough', (_e, v) => toggleClickThrough(v));
    ipcMain.handle('overlay:hide', () => { if (win) win.hide(); });
    ipcMain.handle('overlay:quit', () => { app.quit(); });

    createWindow();
    if (!globalShortcut.register(SHOW_KEY, toggleVisible)) console.warn('[main] scorciatoia ' + SHOW_KEY + ' non registrata');
    globalShortcut.register(CLICK_KEY, () => toggleClickThrough());
    // gli eventi di stato partono dopo il caricamento del renderer
    win.webContents.once('did-finish-load', () => controller.start(1500));
  });

  app.on('second-instance', () => { if (win) win.showInactive(); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); });
  app.on('window-all-closed', () => {
    if (controller) controller.dispose().catch(() => {});
    app.quit();
  });
}

process.on('uncaughtException', (e) => console.error('[main] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[main] unhandledRejection:', e));
