'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    const h = (_e, s) => { try { cb(s); } catch (e) { console.error(e); } };
    ipcRenderer.on('state', h);
    return () => ipcRenderer.removeListener('state', h);
  },
  saveSteamId: (id) => ipcRenderer.invoke('steam:save', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  onSettings: (cb) => {
    const h = (_e, s) => { try { cb(s); } catch (e) { console.error(e); } };
    ipcRenderer.on('settings', h);
    return () => ipcRenderer.removeListener('settings', h);
  },
  saveStratzToken: (token) => ipcRenderer.invoke('stratz:save', token),
  startCalibration: () => ipcRenderer.invoke('cal:start'),
  // extra (non nel contratto, opzionali per la UI)
  setRole: (r) => ipcRenderer.invoke('role:set', r),
  setClickThrough: (v) => ipcRenderer.invoke('overlay:clickthrough', v),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  quit: () => ipcRenderer.invoke('overlay:quit'),
});
