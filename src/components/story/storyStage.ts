/**
 * storyStage.ts — 剧情舞台的纯逻辑层
 *
 * 立绘解析链路（数据轨交付的契约）：
 *   script.spine（说话人显示名）
 *     -> asset_map.character_spine[小写]（552 条显示名 -> 模型名，如 星野 -> hoshino_spr）
 *     -> asset_map.spines[模型名]（skel/atlas/textures 路径）
 *
 * 表情差分（2026-11-08 实测 7 个 spr 模型归纳）：
 *   spr 骨架的动画名就是两位编号 "00".."NN"（另含 99 / Eye_Close_01 / Idle_01），
 *   与剧本 sequence 直接对应 —— 播放动画 <seq> 即切表情，比按 attachment 前缀匹配稳
 *   （slot 名不统一：00_default / 06_drop shadow / 01_normal 都见过）。
 *
 * 站位启发式：转换后的剧情节点没有保留原剧本的 <slot> 屏幕槽位字段
 * （story_meta.speakerLine 记录了槽位直方图但数据轨未回填到节点），
 * 因此按登场次序分配左右中三槽：说话人高亮、其余压暗 —— BA 玩家熟悉的视觉模式。
 */
import type { AssetBundle } from '../../core/assets';
import type { StoryOp, Student } from '../../types';

export type StagePos = 'left' | 'center' | 'right';

export interface ActorResource {
  /** character_spine 解析出的模型名，如 hoshino_spr */
  model: string;
  skel: string;
  atlas: string;
  /** 对得上的学生档案（有头像/名字可用），NPC 为 null */
  student: Student | null;
  /** 解析失败的显示名（渲染层做名字牌兜底） */
  displayName: string;
}

export interface ActorState {
  /** 立绘唯一 key（spine 显示名） */
  key: string;
  displayName: string;
  resource: ActorResource | null;
  /** 学生档案（无立绘时用头像兜底） */
  student: Student | null;
  /** NPC 对话立绘 url（2026-11-08 走查⑤新增，无 spine/头像时的降级一级） */
  npcPortrait: string | null;
  /** 当前表情动画名（两位编号）或 null=保持 Idle */
  expression: string | null;
  pos: StagePos;
  /** 是否是当前说话者（高亮） */
  active: boolean;
}

/** 把说话人显示名解析成 spr spine 资源；解析不出返回 null（渲染层头像/名字牌兜底） */
export function resolveActor(
  assets: AssetBundle,
  displayName: string
): { resource: ActorResource | null; student: Student | null; npcPortrait: string | null } {
  const name = displayName.trim();
  const spine = assets.spine(name); // assets.ts:120 已实现 character_spine 查找 + 去括号兜底
  if (!spine) {
    const student = lookupStudent(assets, name);
    return { resource: null, student, npcPortrait: student ? null : npcPortraitOf(assets, name) };
  }
  const model = modelOf(assets, name);
  return {
    resource: {
      model: model ?? name,
      skel: spine.skel,
      atlas: spine.atlas,
      student: lookupStudent(assets, name),
      displayName: name,
    },
    student: lookupStudent(assets, name),
    npcPortrait: null,
  };
}

/**
 * NPC 对话立绘（2026-11-08 走查⑤）：resources/npc_portrait/ 里 239 张官方
 * NPC_Portrait_*.png（252×204 对话半身像）此前完全没有接入，无 spr 无头像的
 * NPC 说话人只剩悬空名牌。这里借 character_spine 的 NPC 映射反查文件名——
 * 实测映射值如 np0109_spr / pmcdirector_spr / fuuki_normal1_spr，对应
 * NPC_Portrait_NP0109.png / NPC_Portrait_Pmcdirector.png / NPC_Portrait_Fuuki_Normal1.png
 * （Windows 文件系统大小写不敏感；前端 img onError 会兜住真缺失）。
 * 七神琳等未收录中文映射的 NPC 查不到 → 返回 null，如实走头像/对话框标签兜底。
 */
function npcPortraitOf(assets: AssetBundle, displayName: string): string | null {
  const model = modelOf(assets, displayName);
  if (!model || !/_spr/.test(model)) return null;
  const base = model.replace(/_spr.*$/i, '');
  if (!/^(np\d+|[a-z][a-z0-9_]*)$/.test(base)) return null;
  return `/res/npc_portrait/NPC_Portrait_${base}.png`;
}

/** 反查模型名（assets.spine() 不返回模型名，这里重复一次映射） */
function modelOf(assets: AssetBundle, displayName: string): string | null {
  const key = displayName.trim().toLowerCase();
  const cs = assets.map.character_spine as Record<string, string>;
  return cs[key] ?? cs[key.split('(')[0].trim()] ?? null;
}

function lookupStudent(assets: AssetBundle, displayName: string): Student | null {
  const s = assets.studentByName.get(displayName.trim().toLowerCase());
  return s ?? null;
}

/** 两位表情编号（"03"/"99"）→ 动画名；非法输入返回 null */
export function parseExpression(seq: string | undefined | null): string | null {
  if (!seq) return null;
  const s = String(seq).trim();
  return /^\d{2}$/.test(s) ? s : null;
}

/**
 * 舞台站位：按登场次序给左右中三槽。
 * 顺序参考 BA 剧情的常见构图 —— 第一位说话者站左（玩家视角的对话主角位），
 * 第二位站右，第三位中央。已登场的角色槽位保持不动；
 * 新角色优先拿空槽，三槽全满时挤掉最早登场的角色并继承其槽位。
 */
export function assignPositions(orderedKeys: string[]): Map<string, StagePos> {
  const slots: StagePos[] = ['left', 'right', 'center'];
  const out = new Map<string, StagePos>();
  const occupied = new Map<StagePos, string>(); // pos -> key
  for (const key of orderedKeys) {
    if (out.has(key)) continue;
    let target: StagePos | null = null;
    for (const pos of slots) {
      if (!occupied.has(pos)) {
        target = pos;
        break;
      }
    }
    if (!target) {
      // 全满：挤掉最早登场者（orderedKeys 即出场序），新角色继承其槽位
      for (const k of orderedKeys) {
        if (k === key) continue;
        const pos = out.get(k);
        if (pos && occupied.get(pos) === k) {
          target = pos;
          break;
        }
      }
      target = target ?? 'center';
    }
    occupied.set(target, key);
    out.set(key, target);
  }
  return out;
}

/** 一次「说话」带来的舞台增量 */
export interface StageUpdate {
  /** 舞台上完整的立绘列表（按出场顺序） */
  actors: ActorState[];
}

/**
 * 应用一句台词到舞台：
 * - 新说话人入场（分配槽位），已存在的更新表情/高亮
 * - 舞台最多 3 人，第 4 人入场时替换最早登场的
 */
export function applySpeaker(
  prev: ActorState[],
  displayName: string,
  expression: string | null,
  resources: Map<string, { resource: ActorResource | null; student: Student | null; npcPortrait: string | null }>
): StageUpdate {
  const ordered = prev.map((a) => a.key);
  if (!ordered.includes(displayName)) ordered.push(displayName);
  // 最多 3 人：把最早登场的请下台（当前说话者除外）
  const MAX = 3;
  while (ordered.length > MAX) {
    const idx = ordered.findIndex((k) => k !== displayName);
    if (idx < 0) break;
    ordered.splice(idx, 1);
  }
  const positions = assignPositions(ordered);
  const actors = ordered.map((key) => {
    const old = prev.find((a) => a.key === key);
    const r = resources.get(key);
    const resource = r ? r.resource : (old?.resource ?? null);
    const student = r ? r.student : (old?.student ?? null);
    const npcPortrait = r ? r.npcPortrait : (old?.npcPortrait ?? null);
    return {
      key,
      displayName: key,
      resource,
      student,
      npcPortrait,
      expression: key === displayName ? expression : (old?.expression ?? null),
      pos: positions.get(key) ?? 'center',
      active: key === displayName,
    } satisfies ActorState;
  });
  return { actors };
}

/** 从剧情节点流里预取所有说话人的资源（开场一次性解析，避免每句阻塞） */
export function collectSpeakers(nodes: StoryOp[]): string[] {
  const seen: string[] = [];
  for (const n of nodes) {
    if (n.op === 'script') {
      const name = (n as { spine?: string; speaker?: string }).spine || (n as { speaker?: string }).speaker || '';
      if (name && !seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

/** 活动周期格式化：unix 秒 -> YYYY/MM/DD */
export function fmtPeriod(unix: number): string {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
