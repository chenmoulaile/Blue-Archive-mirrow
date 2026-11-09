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
 * 站位（2026-11-10 S-1 接线，报告一 S-1 / 裁决④）：
 *   数据轨重生成后 script 节点带原剧本 slot 屏幕槽位（实测值域 1..5，11000 全库
 *   统计 1:34 / 2:66 / 3:1389 / 4:92 / 5:213），映射五站位：1=左远 2=左近
 *   3=中 4=右近 5=右远，远景（1/5）缩小。slot 缺失的节点回退登场次序启发式
 *   左/右/中三槽（旧行为，标注 near-miss）。
 *
 * 朝向（S-8，报告一）：spr 默认构图朝画面右（story-vis-02-multi-actor.png 实测：
 *   白子/茜香正面偏右），站右侧（right/far-right）的立绘水平镜像后面向画面中心，
 *   与「真机通常站右侧镜像」的规则一致。
 */
import type { AssetBundle } from '../../core/assets';
import type { StoryOp, Student } from '../../types';

/** 五站位：far = 远景（缩小），left/right = 近景 */
export type StagePos = 'far-left' | 'left' | 'center' | 'right' | 'far-right';

/** 原剧本槽位号（1..5）→ 舞台站位；非法/缺失返回 null（回退启发式） */
export function slotToPos(slot: unknown): StagePos | null {
  const n = typeof slot === 'number' ? slot : Number.parseInt(String(slot ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  switch (n) {
    case 1: return 'far-left';
    case 2: return 'left';
    case 3: return 'center';
    case 4: return 'right';
    case 5: return 'far-right';
    default: return null;
  }
}

/** 站位是否在画面右半（S-8：右半站位镜像，使立绘面向中心） */
export function posFacesRight(pos: StagePos): boolean {
  return pos === 'right' || pos === 'far-right';
}

/** 站位是否为远景槽（1/5，缩小） */
export function posIsFar(pos: StagePos): boolean {
  return pos === 'far-left' || pos === 'far-right';
}

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
  /** S-8：站画面右半时水平镜像（面向中心） */
  mirrored: boolean;
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
 * NPC 中文别名表（S-8 剧情轨实测补缺）：asset_map.character_spine 未收录的
 * 高频剧情 NPC/系统显示名（实测 11000 全库扫描：琳/七神琳/部长 等映射缺失）。
 * 值 = character_spine 已有的键（罗马字/NPC 编号），命中后走正常 spine 链。
 * 只登记可验证的名字——宁缺勿造，查不到的仍走头像/对话框标签兜底。
 */
const NPC_NAME_ALIASES: Record<string, string> = {
  琳: 'rin', // 四轩琳（联邦学生会秘书长，np0097_spr，实测 character_spine.rin）
  七神琳: 'rin',
  // 「莲实」映射缺失（character_spine 无 renri 键，2026-11-10 实测）——不编造，
  // 该说话人走头像/对话框标签兜底
};

/**
 * NPC 对话立绘（2026-11-08 走查⑤）：resources/npc_portrait/ 里 239 张官方
 * NPC_Portrait_*.png（252×204 对话半身像）此前完全没有接入，无 spr 无头像的
 * NPC 说话人只剩悬空名牌。这里借 character_spine 的 NPC 映射反查文件名——
 * 实测映射值如 np0109_spr / pmcdirector_spr / fuuki_normal1_spr，对应
 * NPC_Portrait_NP0109.png / NPC_Portrait_Pmcdirector.png / NPC_Portrait_Fuuki_Normal1.png
 * （Windows 文件系统大小写不敏感；前端 img onError 会兜住真缺失）。
 * 别名表也未收录的 NPC 查不到 → 返回 null，如实走头像/对话框标签兜底。
 */
function npcPortraitOf(assets: AssetBundle, displayName: string): string | null {
  const model = modelOf(assets, displayName);
  if (!model || !/_spr/.test(model)) return null;
  const base = model.replace(/_spr.*$/i, '');
  if (!/^(np\d+|[a-z][a-z0-9_]*)$/.test(base)) return null;
  return `/res/npc_portrait/NPC_Portrait_${base}.png`;
}

/** 反查模型名（assets.spine() 不返回模型名，这里重复一次映射；先过 NPC 别名表） */
function modelOf(assets: AssetBundle, displayName: string): string | null {
  const key = displayName.trim().toLowerCase();
  const aliased = NPC_NAME_ALIASES[key] ?? NPC_NAME_ALIASES[key.split('(')[0].trim()];
  const probe = aliased ?? key;
  const cs = assets.map.character_spine as Record<string, string>;
  return cs[probe] ?? cs[probe.split('(')[0].trim()] ?? null;
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
 * 舞台站位回退（启发式）：slot 缺失的说话人按登场次序给左/右/中三槽。
 * 顺序参考 BA 剧情的常见构图 —— 第一位说话者站左（玩家视角的对话主角位），
 * 第二位站右，第三位中央。已登场的角色槽位保持不动；
 * 新角色优先拿空槽，三槽全满时挤掉最早登场的角色并继承其槽位。
 */
function assignFallback(orderedKeys: string[]): Map<string, StagePos> {
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
 * 应用一句台词到舞台（S-1）：
 * - script.slot 有值 → slotToPos 五站位直映射（进出时机由槽位驱动，多人站位
 *   与真机一致）；slot 缺失 → 回退登场次序启发式（标注为近似）
 * - 已存在的角色保持既有站位（slot 是入场坐标，不随台词漂移）；
 *   仅当说话者站位为空（首次登场）才按 slot 落位
 * - 舞台最多 3 名近景角色：第 4 人入场时替换最早登场的非说话者
 * - S-8：站画面右半的立绘 mirrored=true（默认构图朝画面右，镜像后面向中心）
 */
export function applySpeaker(
  prev: ActorState[],
  displayName: string,
  expression: string | null,
  resources: Map<string, { resource: ActorResource | null; student: Student | null; npcPortrait: string | null }>,
  slot?: unknown
): StageUpdate {
  const ordered = prev.map((a) => a.key);
  const isNew = !ordered.includes(displayName);
  if (isNew) ordered.push(displayName);
  // 最多 3 人：把最早登场的请下台（当前说话者除外）
  const MAX = 3;
  while (ordered.length > MAX) {
    const idx = ordered.findIndex((k) => k !== displayName);
    if (idx < 0) break;
    ordered.splice(idx, 1);
  }
  // 站位解析：slot 优先（仅说话者本人且已有 slot 值），其余沿用旧站位，
  // 全无 slot 的角色组走登场次序启发式
  const slotPos = slotToPos(slot);
  const fallback = assignFallback(ordered);
  const actors = ordered.map((key) => {
    const old = prev.find((a) => a.key === key);
    const r = resources.get(key);
    const resource = r ? r.resource : (old?.resource ?? null);
    const student = r ? r.student : (old?.student ?? null);
    const npcPortrait = r ? r.npcPortrait : (old?.npcPortrait ?? null);
    // 站位：本句说话者且带 slot → 直映射；否则旧站位；再否则启发式
    let pos: StagePos;
    if (key === displayName && slotPos) pos = slotPos;
    else pos = old?.pos ?? fallback.get(key) ?? 'center';
    return {
      key,
      displayName: key,
      resource,
      student,
      npcPortrait,
      expression: key === displayName ? expression : (old?.expression ?? null),
      pos,
      active: key === displayName,
      mirrored: posFacesRight(pos),
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
