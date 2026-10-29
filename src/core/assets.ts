/** 素材与数据加载。所有路径经本地 http 服务器映射到 /res 与 /data */

import type { AssetMap, Banner, Furniture, StoryEntry, StoryFile, Student } from '../types';

const jsonCache = new Map<string, Promise<unknown>>();

async function getJson<T>(url: string): Promise<T> {
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

/** asset_map 里存的是 "resources/images/..."，转成 http 路径 "/res/images/..." */
function toUrl(p: string): string {
  return '/' + p.replace(/^resources\//, 'res/').replace(/\\/g, '/');
}

export interface EventEntry {
  id: number;
  server: string;
  title: string;
  start: number;
  end: number;
  image: string;
  summary: string;
  url: string;
}

export interface AssetBundle {
  map: AssetMap;
  students: Student[];
  storyIndex: StoryEntry[];
  banners: Banner[];
  furniture: Furniture[];
  events: EventEntry[];
  studentById: Map<number, Student>;
  studentByName: Map<string, Student>;
  /** 背景名（BG_xxx）-> 图片 url */
  bg: (name: string) => string | null;
  /** 角色显示名 -> Spine 资源 url */
  spine: (charName: string) => { skel: string; atlas: string } | null;
  /** 回忆大厅模型名（xxx_home）-> Spine 资源 url */
  spineByName: (modelName: string) => { skel: string; atlas: string } | null;
}

let bundle: AssetBundle | null = null;

export async function loadAssets(): Promise<AssetBundle> {
  if (bundle) return bundle;

  const [map, students, storyIndex, banners, furniture, rawEvents] = await Promise.all([
    getJson<AssetMap>('/data/asset_map.json'),
    getJson<Student[]>('/data/students_slim.json'),
    getJson<StoryEntry[]>('/data/story_index.json'),
    getJson<Banner[]>('/data/banners.json'),
    getJson<Furniture[]>('/data/furniture.json'),
    getJson<Record<string, unknown>[]>('/data/event_timeline.json'),
  ]);

  const events: EventEntry[] = rawEvents.map((e) => ({
    id: Number(e.id ?? 0),
    server: String(e.line_type ?? 'JP'),
    title: String(e.title ?? ''),
    start: Number(e.start_time ?? 0),
    end: Number(e.end_time ?? 0),
    image: String(e.image ?? ''),
    summary: String(e.body_summary ?? ''),
    url: String(e.url ?? ''),
  }));

  const studentById = new Map(students.map((s) => [s.id, s]));
  const studentByName = new Map<string, Student>();
  for (const s of students) {
    if (s.given) studentByName.set(s.given.toLowerCase(), s);
    if (s.given_en) studentByName.set(s.given_en.toLowerCase(), s);
    if (s.name) studentByName.set(s.name.toLowerCase(), s);
    if (s.name_en) studentByName.set(s.name_en.toLowerCase(), s);
  }

  const bg = (name: string): string | null => {
    const p = map.images[name];
    return p ? toUrl(p) : null;
  };

  const spineByName = (modelName: string) => {
    const s = map.spines[modelName];
    if (!s) return null;
    return { skel: toUrl(s.skel), atlas: toUrl(s.atlas) };
  };

  const spine = (charName: string): { skel: string; atlas: string } | null => {
    const key = charName.trim().toLowerCase();
    let model = map.character_spine[key];
    if (!model) {
      const base = key.split('(')[0].trim();
      model = map.character_spine[base];
    }
    if (!model) return null;
    return spineByName(model);
  };

  bundle = {
    map,
    students,
    storyIndex,
    banners,
    furniture,
    events,
    studentById,
    studentByName,
    bg,
    spine,
    spineByName,
  };
  return bundle;
}

export async function loadStoryFile(path: string): Promise<StoryFile> {
  return getJson<StoryFile>(path);
}

/** 清空缓存（切换素材目录后用） */
export function clearAssetCache(): void {
  jsonCache.clear();
  bundle = null;
}

export function audioUrl(kind: 'voice' | 'bgm' | 'se', file: string): string {
  return `/res/${kind}/${file}`;
}
