'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Calibrazione v2 (docs/CONTRACT-v2.md): rect in DIP del display principale.
contextBridge.exposeInMainWorld('calApi', {
  init: () => ipcRenderer.invoke('cal:init'),
  autoDetect: () => ipcRenderer.invoke('cal:auto'),
  save: (p) => ipcRenderer.invoke('cal:save', {
    topBar: p && p.topBar ? p.topBar : null,
    grid: p && p.grid ? p.grid : null,
    manualSlot: p && Number.isInteger(p.manualSlot) ? p.manualSlot : null,
  }),
  cancel: () => ipcRenderer.invoke('cal:cancel'),
});
