'use strict';
// Electron preloads execute as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-var-requires, no-undef
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('readerDev', {
  refetch: () => ipcRenderer.invoke('preview:refetch'),
  copy: text => ipcRenderer.invoke('preview:copy', text),
});
