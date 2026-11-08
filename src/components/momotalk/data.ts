/**
 * MomoTalk 数据装载与解锁/已读规则。
 *
 * 文件走 /data/momotalk/（electron/main.ts 把 /data 映射到仓库 data/，
 * 见 electron/main.ts:177 与 DATA_DIR 定义）。index 里的 file 字段写的
 * /res/momotalk/... 实际不存在（resources/ 下没有 momotalk 目录），因此
 * 这里统一按 /data/momotalk/<characterId>.json 取，不使用 file 字段。
 */
import type { SaveData } from '../../types';
import type { MomoCharFile, MomoMessage, MomoStudentRef, MomoThread } from './types';

const jsonCache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string): Promise<T> {
  let p = jsonCache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`加载失败 ${url} (${r.status})`);
      return r.json() as Promise<T>;
    });
    jsonCache.set(url, p as Promise<unknown>);
  }
  return p;
}

let indexPromise: Promise<MomoStudentRef[]> | null = null;

/** 会话索引；生成数据缺失时回退空列表（界面照常起来，只是没有会话） */
export function loadMomoIndex(): Promise<MomoStudentRef[]> {
  if (!indexPromise) {
    indexPromise = getJson<{ students?: MomoStudentRef[] }>('/data/momotalk/index.json')
      .then((d) => d.students ?? [])
      .catch(() => []);
  }
  return indexPromise;
}

const charCache = new Map<number, Promise<MomoCharFile | null>>();

/** 单个学生的完整消息记录（懒加载，模块级缓存） */
export function loadMomoChar(characterId: number): Promise<MomoCharFile | null> {
  let p = charCache.get(characterId);
  if (!p) {
    p = getJson<MomoCharFile>(`/data/momotalk/${characterId}.json`).catch(() => null);
    charCache.set(characterId, p);
  }
  return p;
}

// ---------------------------------------------------------------- 存档键

export const mtThreadKey = (cid: number, threadIdx: number): string => `${cid}:${threadIdx}`;
export const mtMsgKey = (cid: number, threadIdx: number, msgIdx: number): string =>
  `${cid}:${threadIdx}:${msgIdx}`;

/** favor 存档键统一用 characterId 字符串 */
export const favorOf = (save: SaveData, cid: number): number =>
  save.momotalk.favor[String(cid)] ?? DEFAULT_FAVOR;

/**
 * 初始好感度等级。游戏里 MomoTalk 从好感 2 开始解锁（数据里 264 个角色的
 * 第一段 threads[].favorRank=2），所以新账号有效好感从 2 起。
 */
export const DEFAULT_FAVOR = 2;

export const isThreadRead = (save: SaveData, cid: number, threadIdx: number): boolean =>
  save.momotalk.read.includes(mtThreadKey(cid, threadIdx));

/** 剧情触发是否已看过（同时是 HomePage 侧栏未读徽标的 key 空间） */
export const isStoryWatched = (save: SaveData, scenarioGroup: number): boolean =>
  save.momotalk.read.includes(String(scenarioGroup));

// ---------------------------------------------------------------- 解锁与未读

/** 按当前好感度解锁的 threads（升序） */
export function unlockedThreads(charFile: MomoCharFile, favor: number): MomoThread[] {
  return charFile.threads.filter((t) => t.favorRank <= favor);
}

/** 解锁线程里第 idx 条消息（供流式渲染） */
export function flatMessages(threads: MomoThread[]): { threadIdx: number; msg: MomoMessage }[] {
  const out: { threadIdx: number; msg: MomoMessage }[] = [];
  threads.forEach((t, threadIdx) => t.messages.forEach((msg) => out.push({ threadIdx, msg })));
  return out;
}

/** 一个学生当前未读的会话段数（解锁但整段没读完） */
export function unreadCount(save: SaveData, charFile: MomoCharFile, favor: number): number {
  return charFile.threads.filter((t, i) => t.favorRank <= favor && !isThreadRead(save, charFile.characterId, i))
    .length;
}

/** 下一段还没解锁的 threads[].favorRank（聊天页提示"继续交流解锁"） */
export function nextUnlockRank(charFile: MomoCharFile, favor: number): number | null {
  for (const t of charFile.threads) if (t.favorRank > favor) return t.favorRank;
  return null;
}

// ---------------------------------------------------------------- 预览与排序

/** 会话列表最近一条消息预览 */
export function previewOf(threads: MomoThread[]): { text: string; from: 'student' | 'teacher' } | null {
  if (threads.length === 0) return null;
  const last = threads[threads.length - 1]?.messages;
  if (!last || last.length === 0) return null;
  for (let i = last.length - 1; i >= 0; i--) {
    const m = last[i];
    if (m.kind === 'text' && m.text) return { text: m.text, from: m.from };
    if (m.kind === 'image') return { text: '[照片]', from: m.from };
    if (m.kind === 'answer') return { text: '[等待回复]', from: 'teacher' };
  }
  return null;
}

// ---------------------------------------------------------------- 图片与剧情

/**
 * 照片消息 URL。数据里是 'UIs/03_Scenario/04_ScenarioImage/Mo_Yuuka_01'，
 * 提取约定是 resources/ui/extra/<Name>.png（见 tools/fetch/extract_momotalk_images.py）。
 * 实测这 20 张纹理在本地 bundle 里未提取到（uis-03_scenario-01_background /
 * 02_character 两个族全扫 0 命中），所以组件按 onerror 优雅占位；
 * 将来文件补齐后这里无需改代码。
 */
export function momoImageUrl(imagePath: string): string {
  const base = imagePath.split('/').pop() ?? imagePath;
  return `/res/ui/extra/${base}.png`;
}

/** 羁绊剧情触发 → 剧情索引条目（StoryPage 用 entry.id 跳转） */
export function storyEntry(
  scenarioGroup: number,
  storyIndex: { id: string; type: string; title: string }[]
): { id: string; type: string; title: string } | null {
  return storyIndex.find((s) => s.id === String(scenarioGroup)) ?? null;
}
