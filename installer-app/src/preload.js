"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Minimal, explicit API surface exposed to the renderer. No Node access leaks.
contextBridge.exposeInMainWorld("api", {
  status: () => ipcRenderer.invoke("status"),
  installStart: () => ipcRenderer.invoke("install-start"),
  stop: () => ipcRenderer.invoke("stop"),
  update: () => ipcRenderer.invoke("update"),
  uninstall: () => ipcRenderer.invoke("uninstall"),
  openGuac: () => ipcRenderer.invoke("open-guac"),
  openDockerDownload: () => ipcRenderer.invoke("open-docker-download"),
  logsStart: () => ipcRenderer.invoke("logs-start"),
  logsStop: () => ipcRenderer.invoke("logs-stop"),
  onLog: (cb) => ipcRenderer.on("log", (_e, data) => cb(data)),
});
