// Pont sécurisé (contextIsolation) entre l'application web et le bureau Windows.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ndcDesktop', {
  isDesktop: true,
  /** Impression (directe sans fenêtre si l'option est activée dans le menu « Scanner et impression »). */
  print: () => ipcRenderer.invoke('ndc:print'),
  info: () => ipcRenderer.invoke('ndc:info'),
  retry: () => ipcRenderer.invoke('ndc:retry'),
});
