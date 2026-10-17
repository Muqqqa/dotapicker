'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calApi', {
  init: () => ipcRenderer.invoke('cal:init'),
  save: (regions, useDefault) => ipcRenderer.invoke('cal:save', { regions, useDefault: !!useDefault }),
  test: (regions) => ipcRenderer.invoke('cal:test', regions),
  cancel: () => ipcRenderer.invoke('cal:cancel'),
});
