"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/preload.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
var api = {
  info: () => import_electron.ipcRenderer.invoke("app:info"),
  setResourceDir: () => import_electron.ipcRenderer.invoke("config:setResourceDir"),
  getConfig: () => import_electron.ipcRenderer.invoke("config:get"),
  patchConfig: (patch) => import_electron.ipcRenderer.invoke("config:patch", patch),
  pickDir: (title) => import_electron.ipcRenderer.invoke("dialog:pickDir", title),
  loadSave: () => import_electron.ipcRenderer.invoke("save:read"),
  writeSave: (data) => import_electron.ipcRenderer.invoke("save:write", data),
  resetSave: () => import_electron.ipcRenderer.invoke("save:reset"),
  openResourceDir: () => import_electron.ipcRenderer.invoke("shell:openResourceDir")
};
import_electron.contextBridge.exposeInMainWorld("baApi", api);
