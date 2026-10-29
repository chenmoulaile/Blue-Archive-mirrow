/** 渲染层可用的受控 API（contextBridge 暴露，不放开 Node） */
import { contextBridge, ipcRenderer } from 'electron';

export interface AppConfig {
  resourceDir: string;
  gameDir: string | null;
  wikiDir: string | null;
  setupDone: boolean;
}

export interface AppInfo {
  resourceDir: string;
  defaultResourceDir: string;
  dataDir: string;
  userData: string;
  version: string;
  setupDone: boolean;
  config: AppConfig;
}

const api = {
  info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  setResourceDir: (): Promise<string | null> => ipcRenderer.invoke('config:setResourceDir'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  patchConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke('config:patch', patch),
  pickDir: (title?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pickDir', title),
  loadSave: (): Promise<unknown> => ipcRenderer.invoke('save:read'),
  writeSave: (data: unknown): Promise<boolean> => ipcRenderer.invoke('save:write', data),
  resetSave: (): Promise<boolean> => ipcRenderer.invoke('save:reset'),
  openResourceDir: (): Promise<void> => ipcRenderer.invoke('shell:openResourceDir'),
};

contextBridge.exposeInMainWorld('baApi', api);

export type BaApi = typeof api;
