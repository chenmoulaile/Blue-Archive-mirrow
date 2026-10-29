/** 存档与全局状态。所有数据落在工作目录下的 .userdata/save.json */

import { useSyncExternalStore } from 'react';
import type { SaveData } from '../types';
import { DEFAULT_SETTINGS, resetSettings } from './config';

const SAVE_VERSION = 1;

export const DAILY_PYROXENE = 120;
export const WEEKLY_BONUS = 360;
export const STORY_CLEAR_REWARD = 40;
export const PULL_COST = 120;

export function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    // 新账号的初始状态：Lv.1 / 0 经验 / 名称「老师」
    teacher: { name: '老师', level: 1, exp: 0 },
    currency: { pyroxene: 1200, tickets: 0 },
    signIn: { lastDate: '', streak: 0, total: 0 },
    story: { read: {}, progress: {}, cleared: [] },
    gacha: {
      mode: 'charge',
      classicPoints: 0,
      chargeNormal: 0,
      chargeLimited: 0,
      history: [],
      owned: {},
    },
    cafe: { placed: [], lastCollect: Date.now(), visits: [] },
    momotalk: { read: [], favor: {} },
    settings: resetSettings(),
  };
}

/** 咖啡厅离线收益：每小时 pyroxene = 舒适度 / 12，最多累积 12 小时 */
export function cafeIncome(comfort: number, ms: number): { amount: number; cappedMs: number } {
  const hours = Math.min(ms / 3_600_000, 12);
  const rate = comfort / 12;
  return { amount: Math.floor(rate * hours), cappedMs: ms };
}

class SaveStore {
  private data: SaveData = createDefaultSave();
  private listeners = new Set<() => void>();
  private saveTimer: number | null = null;
  private ready = false;

  get snapshot(): SaveData {
    return this.data;
  }

  get isReady(): boolean {
    return this.ready;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 启动时载入存档，并结算签到与咖啡厅收益 */
  async init(): Promise<void> {
    try {
      const raw = (await window.baApi.loadSave()) as Partial<SaveData> | null;
      if (raw && typeof raw === 'object') {
        this.data = { ...createDefaultSave(), ...raw } as SaveData;
        this.data.currency = { ...createDefaultSave().currency, ...(raw.currency ?? {}) };
        // 老存档没有新字段时用默认值补齐；locale/voice 缺省即 zh-CN + ja
        this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
      }
    } catch {
      /* 首次运行没有存档 */
    }
    this.applyDailySignIn();
    this.ready = true;
    this.emit();
  }

  /** 每日签到：首次启动自动发放，连续 7 天额外奖励 */
  private applyDailySignIn(): void {
    const today = todayStr();
    if (this.data.signIn.lastDate === today) return;

    const yesterday = todayStr(new Date(Date.now() - 86_400_000));
    const streak = this.data.signIn.lastDate === yesterday ? this.data.signIn.streak + 1 : 1;
    const bonus = streak % 7 === 0 ? WEEKLY_BONUS : 0;

    this.data.signIn = {
      lastDate: today,
      streak,
      total: this.data.signIn.total + 1,
    };
    this.data.currency.pyroxene += DAILY_PYROXENE + bonus;
    this.data.cafe.lastCollect = this.data.cafe.lastCollect || Date.now();
    this.scheduleSave();
  }

  update(mutator: (draft: SaveData) => void): void {
    const next = structuredClone(this.data);
    mutator(next);
    this.data = next;
    this.emit();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void window.baApi.writeSave(this.data);
    }, 400);
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await window.baApi.writeSave(this.data);
  }

  async reset(): Promise<void> {
    await window.baApi.resetSave();
    this.data = createDefaultSave();
    this.applyDailySignIn();
    this.emit();
    await this.flush();
  }
}

export const store = new SaveStore();

export function useSave(): SaveData {
  return useSyncExternalStore(store.subscribe, () => store.snapshot, () => store.snapshot);
}

/** 故事节点是否已读 */
export function isRead(save: SaveData, storyId: string, index: number): boolean {
  return save.story.read[storyId]?.includes(index) ?? false;
}

/** 标记节点已读（返回新数组，配合 store.update 使用） */
export function markRead(draft: SaveData, storyId: string, index: number): void {
  const arr = draft.story.read[storyId] ?? [];
  if (!arr.includes(index)) {
    arr.push(index);
    draft.story.read[storyId] = arr;
  }
}
