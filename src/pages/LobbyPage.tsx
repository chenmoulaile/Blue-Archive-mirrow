/**
 * 记忆大厅（Recollection Lobby，view=memorial，/lobby 路由）
 *
 * 2026-11-10 L-1~L-6 竖屏还原重排（审计报告一六.2 L-1~L-6 + 报告二 F1~F5/P1-13~15）：
 *   - L-1 移除自创交互：右下视角工具三钮与「随机切换」按钮删除；滚轮缩放/拖拽
 *     平移保留为隐藏能力（不暴露 UI）；切学生恢复默认视角（真机视角即模型
 *     默认构图，fit="cover" 已接近）。
 *   - L-2/F2 底部功能条按真机收敛为少量按钮：大厅选择 / 回忆重播。返回箭头在
 *     顶部（App 级 TopCurrencyBar 的 .nav-item 返回钮）、设定在右上（同一顶栏
 *     的菜单钮 Common_Icon_Option→设置页），本页不再重复渲染。
 *     首个 .icon-btn 仍是「大厅选择」——e2e 契约（.lobby-tools .icon-btn first）。
 *   - L-3 大厅 BGM：按 MEMORY_LOBBY_BGM（ExcelDB MemoryLobby 表解码的官方映射）
 *     播放该学生的记忆大厅曲，离开/切学生停止；音量走设置页 bgmVolume
 *     （App.tsx audio.setVolumes 既有接线）。
 *   - L-4/F4 触摸分区递进 + ❤ 粒子：屏幕上半/下半映射不同触摸语音组
 *     （MemorialLobby_N 组号为官方分组线索，奇偶分组是审计建议的区域近似版，
 *     官方部位→组号映射无数据）；连点在同组内递进 M 序号、组内耗尽轮到下一组；
 *     点击位置冒出 ❤（CSS 粒子，样式见 lobby.css .lobby-heart）。
 *   - L-5/F3 顶部信息条清理：删调试信息（皮肤/Spine 模型名）与常驻好感度数值
 *     （好感度点击仍累加，与桃信/大厅舞台同字段）；学生名移入切换抽屉
 *     （.lobby-name 类保留在抽屉内，e2e 契约）；切换学生改为横向轮播卡片
 *     （已可用大厅序列 + 左右箭头，搜索保留给 265 名学生的超量场景）。
 *   - L-6 去暗角：移除暗色托底与径向渐变/内阴影暗角，直接观察 spine 场景接缝；
 *     确有接缝再改画布边缘极窄透明渐隐遮罩（2026-11-10 e2e 截图观察见 TrackResult）。
 *
 * 素材来源标注：底板/图标 data-ui-source=assetbundle；图集缺失时按钮退回
 * global.css 的毛玻璃兜底并标 css-fallback，不伪造素材。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useApp } from '../core/AppContext';
import { audio } from '../core/audio';
import { store } from '../core/store';
import { SpineView } from '../components/SpineView';
import { UIIcon } from '../components/NineSlice';
import { nineSliceStyle, type SpriteEntry } from '../core/ui-atlas';
import { Glyph, type GlyphName } from '../components/Glyph';
import { bondFavorKey } from '../components/LobbyStage';
import { HOME_STAGE } from '../core/game-ui-spec';
import type { Student } from '../types';

/** 记住上次选的学生，切页面回来不用重选 */
let lastStudentId = 0;

/** 功能条按钮底板（白圆，实测 140×142）与图标，全部实测存在于 data/ui_atlas.json */
const BAR_PLATE = 'Common/Common_Btn_Circle_W';
const BAR_ICONS = {
  change: 'Common/Common_Icon_Change',
  memory: 'Common/Common_Icon_MemoryLobby',
} as const;

/**
 * 学生 → 记忆大厅 BGM（data/bgm_map.json 的 key，如 Theme_38 → /res/bgm/Theme_38.ogg）。
 *
 * 数据来源（2026-11-10 解码，非杜撰）：ExcelDB MemoryLobbyDBSchema flatbuffer
 * （.scratch/story/stage/BlueArchive.fbs:12570 MemoryLobbyExcel.slot8 = BGMId long）
 * × BGMDBSchema 官方表（.scratch/exceldb/dump/bgm.json，Id→Audio/BGM/xxx 路径），
 * 经 students_full.json character_datas[].character_id（dev id）联接 slim.id。
 * 同 dev 两行时取 category 1 普通大厅行（category 2 的 *_multi 特殊大厅全为
 * Theme_12，不覆盖基础映射）。
 * 校验：265 名有大厅模型的学生 264 名有映射；所有 key 在 bgm_map.json 且
 * extracted=true 且 /res/bgm/ 磁盘文件在库（join_bgm.js 全绿）。
 * 未映射：雪玲(606, dev 10144) 本版 ExcelDB 无表行——不伪造「通用大厅曲」，如实静音。
 */
const MEMORY_LOBBY_BGM: Record<number, string> = {
  1: 'Theme_22', 2: 'Theme_54', 3: 'Theme_36', 4: 'Theme_36', 6: 'Theme_53', 7: 'Theme_21',
  8: 'Theme_36', 9: 'Theme_104', 10: 'Theme_36', 11: 'Theme_77', 18: 'Theme_21',
  20: 'Theme_37', 22: 'Theme_09', 23: 'Theme_46', 24: 'Theme_09', 25: 'Theme_44',
  26: 'Theme_37', 27: 'Theme_36', 28: 'Theme_46', 29: 'Theme_63', 30: 'Theme_214',
  31: 'Theme_220', 32: 'Theme_103', 33: 'Theme_105', 34: 'Theme_38', 35: 'Theme_21',
  36: 'Theme_105', 37: 'Theme_103', 38: 'Theme_44', 39: 'Theme_38', 40: 'Theme_46',
  41: 'Theme_37', 42: 'Theme_120', 43: 'Theme_264', 44: 'Theme_09', 45: 'Theme_103',
  46: 'Theme_46', 47: 'Theme_121', 48: 'Theme_103', 49: 'Theme_43', 50: 'Theme_43',
  51: 'Theme_39', 52: 'Theme_17', 53: 'Theme_131', 54: 'Theme_09', 55: 'Theme_109',
  56: 'Theme_21', 57: 'Theme_103', 58: 'Theme_120', 59: 'Theme_221', 60: 'Theme_104',
  61: 'Theme_135', 62: 'Theme_36', 63: 'Theme_36', 65: 'Theme_267', 66: 'Theme_266',
  67: 'Theme_263', 68: 'BlueNewWorld_Lobby', 69: 'Theme_21', 70: 'Theme_80', 71: 'Theme_21',
  72: 'Theme_02', 73: 'Theme_38', 74: 'Theme_82', 75: 'Theme_86', 76: 'Theme_12',
  77: 'Theme_103', 78: 'Theme_09', 79: 'Theme_39', 80: 'Theme_80', 81: 'Theme_50',
  82: 'Theme_38', 83: 'Theme_46', 84: 'Theme_63', 85: 'Theme_39', 86: 'Theme_09',
  87: 'Theme_39', 88: 'Theme_38', 89: 'Theme_36', 90: 'Theme_09', 91: 'Theme_43',
  92: 'Theme_09', 93: 'Theme_09', 94: 'Theme_47', 95: 'Theme_21', 96: 'Theme_09',
  97: 'Theme_36', 98: 'Theme_38', 99: 'Theme_37', 100: 'Theme_17', 101: 'Theme_104',
  102: 'Theme_97', 103: 'Theme_36', 106: 'Theme_135', 107: 'Theme_28', 108: 'Theme_67',
  109: 'Theme_46', 110: 'Theme_36', 111: 'Theme_02', 112: 'Theme_38', 113: 'Theme_38',
  114: 'Theme_192', 115: 'Theme_199', 116: 'Theme_08', 117: 'Theme_37', 118: 'Theme_09',
  119: 'Theme_12', 120: 'Theme_99', 121: 'Theme_21', 122: 'Theme_86', 123: 'Theme_67',
  124: 'Theme_39', 126: 'Theme_192', 127: 'Theme_216', 128: 'Theme_44', 129: 'Theme_02',
  130: 'Theme_94', 131: 'Theme_171', 132: 'Theme_37', 133: 'Theme_265', 134: 'Theme_104',
  135: 'Theme_228', 136: 'Theme_50', 137: 'Theme_94', 138: 'Theme_36', 139: 'Theme_36',
  140: 'Theme_21', 141: 'Theme_36', 142: 'Theme_67', 143: 'Theme_44', 144: 'Theme_44',
  145: 'Theme_09', 146: 'Theme_141', 152: 'Theme_36', 153: 'Theme_139', 154: 'Theme_39',
  155: 'Theme_09', 156: 'Theme_141', 157: 'Theme_38', 158: 'Theme_36', 159: 'Theme_244',
  160: 'Theme_36', 163: 'Theme_210', 166: 'Theme_44', 167: 'Theme_36', 175: 'Theme_21',
  176: 'Theme_37', 177: 'Theme_97', 178: 'Theme_62', 179: 'Theme_62', 180: 'Theme_57',
  181: 'Theme_21', 182: 'Theme_36', 185: 'Theme_02', 186: 'Theme_09', 187: 'Theme_39',
  192: 'Theme_43', 194: 'Theme_109', 195: 'Theme_36', 203: 'Theme_105', 211: 'Theme_17',
  212: 'Theme_37', 213: 'Theme_53', 214: 'Theme_39', 215: 'Theme_57', 216: 'Theme_192',
  227: 'Theme_135', 228: 'Theme_02', 229: 'Theme_43', 230: 'Theme_09', 254: 'Theme_190',
  264: 'Theme_21', 269: 'Theme_80', 271: 'Theme_237', 278: 'Theme_104', 279: 'Theme_165',
  280: 'Theme_09', 286: 'Theme_186', 299: 'Theme_173', 300: 'Theme_09', 301: 'Theme_38',
  302: 'Theme_173', 308: 'Theme_265', 309: 'Theme_09', 315: 'Theme_38', 316: 'Theme_103',
  318: 'Theme_50', 319: 'Theme_36', 320: 'Theme_37', 334: 'Theme_103', 340: 'Theme_193',
  341: 'Theme_37', 342: 'Theme_263', 343: 'Theme_240', 345: 'Theme_103',
  346: 'Theme_179_Inst2', 347: 'Theme_240', 350: 'Theme_21', 351: 'Theme_135',
  352: 'Theme_209', 353: 'Theme_265', 356: 'Theme_21', 360: 'Theme_209', 362: 'Theme_216',
  365: 'Theme_266', 366: 'Theme_268', 368: 'Theme_210', 369: 'Theme_222', 370: 'Theme_215',
  371: 'Theme_221', 373: 'Theme_234', 375: 'Theme_216', 376: 'Theme_214', 377: 'Theme_220',
  378: 'Theme_228', 381: 'Theme_215', 382: 'Theme_237', 383: 'Theme_214', 384: 'Theme_222',
  388: 'Theme_192', 389: 'Theme_222', 498: 'Theme_234', 499: 'Theme_226', 500: 'Theme_221',
  505: 'Theme_216', 506: 'Theme_209', 508: 'Theme_266', 512: 'Theme_266', 513: 'Theme_267',
  514: 'Theme_268', 517: 'Theme_216', 518: 'Theme_339', 520: 'Theme_244', 521: 'Theme_255',
  523: 'Theme_268', 525: 'Theme_267', 533: 'Theme_267', 534: 'Theme_264', 535: 'Theme_244',
  537: 'Theme_300', 541: 'Theme_240', 542: 'Theme_135', 543: 'Theme_299', 544: 'Theme_300',
  545: 'Theme_298', 548: 'Theme_216', 549: 'Theme_268', 550: 'Theme_209', 554: 'Theme_239',
  559: 'Theme_297_Inst2', 560: 'Theme_209', 561: 'Theme_263', 563: 'Theme_240',
  565: 'Theme_228', 568: 'Theme_103', 569: 'Theme_268', 571: 'Theme_340', 572: 'Theme_341',
  573: 'Theme_342', 574: 'Theme_298', 576: 'Theme_265', 577: 'Theme_239', 598: 'Theme_268',
  599: 'Theme_342',
};

/** 触摸语音条目（desc 用于字幕，path 为 /res/voice/ 直链） */
interface VoiceItem {
  desc: string;
  path: string;
  m: number;
}

/** 上下两个分区的组池；fallback 是没有组号的散语音 */
interface ZonePools {
  upper: VoiceItem[][];
  lower: VoiceItem[][];
  fallback: VoiceItem[];
}

/**
 * L-4 触摸分区池：MemorialLobby_N 组号为官方分组线索（真机触摸语音按组成链，
 * 组内 M 为递进序号）。真机「部位→组号」映射无数据，按审计 L-4 的区域近似版：
 * 组号奇偶拆成上下两个分区池（奇=上半/偶=下半）；学生没有 MemorialLobby 族时
 * 同规则拆纯 Lobby 族（265/265 名都有），两者都没有才落到 fallback 顺序池。
 */
function buildTouchPools(student: Student): ZonePools {
  const memGroups = new Map<number, VoiceItem[]>();
  const lobGroups = new Map<number, VoiceItem[]>();
  const fallback: VoiceItem[] = [];
  for (const v of student.voices) {
    const mem = /memoriallobby[_-]?(\d+)(?:[_-]?(\d+))?/i.exec(v.desc);
    if (mem) {
      const item: VoiceItem = { desc: v.desc, path: v.path, m: mem[2] ? Number(mem[2]) : 0 };
      if (!memGroups.has(Number(mem[1]))) memGroups.set(Number(mem[1]), []);
      memGroups.get(Number(mem[1]))!.push(item);
      continue;
    }
    // (?<!memorial) 防止 MemorialLobby_N 里的 "Lobby_N" 被误归纯大厅族
    const lob = /(?<!memorial)lobby[_-]?(\d+)(?:[_-]?(\d+))?/i.exec(v.desc);
    if (lob) {
      const item: VoiceItem = { desc: v.desc, path: v.path, m: lob[2] ? Number(lob[2]) : 0 };
      if (!lobGroups.has(Number(lob[1]))) lobGroups.set(Number(lob[1]), []);
      lobGroups.get(Number(lob[1]))!.push(item);
      continue;
    }
    fallback.push({ desc: v.desc, path: v.path, m: 0 });
  }
  // 组号奇偶拆池；组内按 M 升序（递进链顺序）
  const split = (g: Map<number, VoiceItem[]>): [VoiceItem[][], VoiceItem[][]] => {
    const keys = [...g.keys()].sort((a, b) => a - b);
    const odd: VoiceItem[][] = [];
    const even: VoiceItem[][] = [];
    for (const k of keys) (k % 2 === 1 ? odd : even).push(g.get(k)!.sort((a, b) => a.m - b.m));
    return [odd, even];
  };
  const useMem = memGroups.size > 0;
  const [memOdd, memEven] = useMem ? split(memGroups) : [[], []] as [VoiceItem[][], VoiceItem[][]];
  const [lobOdd, lobEven] = split(lobGroups);
  return {
    upper: useMem ? memOdd : lobOdd,
    lower: useMem ? memEven : lobEven,
    fallback,
  };
}

/**
 * 语音字幕占位：真实台词文本数据还没有，按组/序号占位（同 LobbyStage 的做法）。
 * MemorialLobby_3_1 → 「触摸语音 组3·第1句」；Lobby_2 → 「大厅语音 #2」；其余 → 「语音片段」。
 */
function captionOf(desc: string): string {
  const stem = desc.replace(/\.ogg$/i, '');
  const mem = /memoriallobby[_-]?(\d+)(?:[_-]?(\d+))?/i.exec(stem);
  if (mem) return `♪ 触摸语音 组${mem[1]}${mem[2] ? `·第${mem[2]}句` : ''}`;
  const lob = /(?<!memorial)lobby[_-]?(\d+)/i.exec(stem);
  if (lob) return `♪ 大厅语音 #${lob[1]}`;
  return '♪ 语音片段';
}

/** 回忆重播字幕：CHxxxx_MemorialLobby 族原样展开 */
function replayCaption(desc: string): string {
  return `♪ ${desc.replace(/\.ogg$/i, '').replace(/_/g, ' ')}`;
}

/**
 * 底部功能条按钮：九宫格白圆底板（内联 border-image）+ 图集图标。
 * 图标是官方白色遮罩原件，压暗后贴近真机「白圆+深色图标」观感；
 * 图集缺失时 sprite 为 undefined，按钮退回 .icon-btn 毛玻璃兜底。
 */
function BarButton(props: {
  sprite: SpriteEntry | undefined;
  icon: string;
  iconSize: number;
  fallback: ReactNode;
  title: string;
  onClick: () => void;
}): ReactNode {
  const plateStyle: CSSProperties = props.sprite ? nineSliceStyle(props.sprite, true) : {};
  return (
    <button
      className={`icon-btn${props.sprite ? ' ns' : ''}`}
      style={plateStyle}
      data-ui-sprite={BAR_PLATE}
      data-ui-source={props.sprite ? 'assetbundle' : 'css-fallback'}
      title={props.title}
      onClick={props.onClick}
    >
      <UIIcon name={props.icon} size={props.iconSize} fallback={props.fallback} />
    </button>
  );
}

/** ❤ 粒子：点击位置冒出的小爱心（CSS 动画，见 lobby.css .lobby-heart） */
interface HeartFx {
  id: number;
  x: number;
  y: number;
  /** 水平散开偏移 px 与出现延迟 ms，三颗一组错落 */
  dx: number;
  delay: number;
  big: boolean;
}

export default function LobbyPage() {
  const { assets, toast, uiAtlas } = useApp();

  const lobbyStudents = useMemo(
    () => assets.students.filter((s) => s.home_spine && !s.is_npc),
    [assets.students]
  );

  const [student, setStudent] = useState<Student | null>(() => {
    const saved = lobbyStudents.find((s) => s.id === lastStudentId);
    return saved ?? lobbyStudents.find((s) => s.id === 599) ?? lobbyStudents[0] ?? null;
  });
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState('');
  const [spineError, setSpineError] = useState(false);
  // L-1：真机不允许自由缩放平移——滚轮/拖拽只是隐藏能力，切学生恢复默认视角
  const [view, setView] = useState({ zoom: HOME_STAGE.initialZoom.value, panX: 0, panY: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const [hearts, setHearts] = useState<HeartFx[]>([]);
  const heartId = useRef(0);
  const stripRef = useRef<HTMLDivElement>(null);
  /** 两个分区的递进游标：{g: 组池下标, m: 组内序号}（L-4 连点递进） */
  const zoneState = useRef<{ upper: { g: number; m: number }; lower: { g: number; m: number } }>({
    upper: { g: 0, m: 0 },
    lower: { g: 0, m: 0 },
  });

  const spineRes = student?.home_spine ? assets.spineByName(student.home_spine) : null;

  // 切学生：恢复默认视角（真机视角即模型默认构图）、复位触摸递进、清错误态
  useEffect(() => {
    if (!student) return;
    lastStudentId = student.id;
    setView({ zoom: HOME_STAGE.initialZoom.value, panX: 0, panY: 0 });
    setSpineError(false);
    setLine('');
    zoneState.current = { upper: { g: 0, m: 0 }, lower: { g: 0, m: 0 } };
  }, [student]);

  // L-3 大厅 BGM：按官方映射播放该学生的记忆大厅曲；切学生换曲、离开停止。
  // 音量由 App.tsx 的 audio.setVolumes(save.settings.bgmVolume, ...) 统一走设置页。
  useEffect(() => {
    if (!student) return;
    const theme = MEMORY_LOBBY_BGM[student.id];
    if (theme) audio.playBgm(theme);
    else audio.stopBgm(); // 无官方映射的学生（雪玲等）：不伪造通用曲，静音
    return () => audio.stopBgm();
  }, [student]);

  // 好感度：bond 会话键，触摸累加（与桃信/大厅舞台同字段）；数值不再常驻页面（L-5）
  const favorKey = useMemo(
    () => (student ? bondFavorKey(assets.storyIndex, student) : null),
    [assets.storyIndex, student]
  );

  const pools = useMemo(() => (student ? buildTouchPools(student) : null), [student]);

  /** L-4：按分区递进取一条语音——组内 M 递进，组内耗尽轮到该分区下一组 */
  const pickZoned = useCallback(
    (zone: 'upper' | 'lower'): VoiceItem | null => {
      if (!pools) return null;
      const order: ('upper' | 'lower')[] = zone === 'upper' ? ['upper', 'lower'] : ['lower', 'upper'];
      for (const z of order) {
        const pool = pools[z];
        if (pool.length === 0) continue;
        const st = zoneState.current[z];
        const group = pool[st.g % pool.length];
        const item = group[st.m % group.length];
        // 递进：组内 +1，耗尽轮到下一组
        st.m += 1;
        if (st.m >= group.length) {
          st.m = 0;
          st.g = (st.g + 1) % pool.length;
        }
        return item;
      }
      return null;
    },
    [pools]
  );

  /** ❤ 粒子：三颗一组，水平散开 + 交错出现（CSS 动画驱动） */
  const spawnHearts = useCallback((x: number, y: number) => {
    const burst: HeartFx[] = [0, 1, 2].map((i) => ({
      id: ++heartId.current,
      x,
      y,
      dx: (Math.random() - 0.5) * 56,
      delay: i * 90,
      big: i === 0,
    }));
    setHearts((hs) => [...hs.slice(-9), ...burst]);
    window.setTimeout(() => {
      setHearts((hs) => hs.filter((h) => !burst.some((b) => b.id === h.id)));
    }, 1400);
  }, []);

  /** 触摸互动：上半/下半分区递进语音 + 反应动画（SpineView 内部 onClick）+ ❤ + 好感度 */
  const onTapAt = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!student) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const zone = y <= rect.height / 2 ? 'upper' : 'lower';
      const item = pickZoned(zone) ?? pools?.fallback[0];
      if (item) {
        audio.playVoice(item.path);
        setLine(captionOf(item.desc));
      } else {
        setLine('……（这名学生没有大厅语音）');
      }
      if (favorKey) {
        const gain = HOME_STAGE.favorPerTouch.value;
        store.update((d) => {
          d.momotalk.favor[favorKey] = (d.momotalk.favor[favorKey] ?? 0) + gain;
        });
      }
      spawnHearts(x, y);
    },
    [student, favorKey, pickZoned, pools, spawnHearts]
  );

  /** 回忆重播：优先该学生的 CHxxxx_MemorialLobby 族（全语音 7051 条中仅 176 条），
   *  没有的学生明示改播大厅语音，不伪造「重播成功」。 */
  const replayMemory = useCallback(() => {
    if (!student) return;
    const mem = student.voices.filter((v) => /memoriallobby/i.test(v.desc));
    const target = mem[0];
    if (target) {
      audio.playVoice(target.path);
      setLine(replayCaption(target.desc));
      return;
    }
    const lobby = student.voices.find((v) => /lobby/i.test(v.desc));
    if (lobby) {
      audio.playVoice(lobby.path);
      setLine('（该学生没有记忆大厅语音，改播大厅语音）');
    } else {
      setLine('……（该学生没有可重播的记忆语音）');
    }
  }, [student]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lobbyStudents;
    return lobbyStudents.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.name_en.toLowerCase().includes(q) ||
        s.given_en.toLowerCase().includes(q)
    );
  }, [lobbyStudents, query]);

  // 打开抽屉：把当前学生的卡片滚到可视中央（轮播对齐）
  useEffect(() => {
    if (!picking) return;
    const el = stripRef.current?.querySelector('.picker-card.current');
    el?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
  }, [picking]);

  if (!student) {
    return (
      <div className="empty-state">
        没有可用的回忆大厅模型。
        <br />
        请先执行 <code>python tools/fetch/kivo.py spine --type home</code> 下载素材。
      </div>
    );
  }

  /** 隐藏视角能力：滚轮缩放 / 拖拽平移（L-1：保留但不暴露 UI，切学生即复位） */
  const updateView = (v: { zoom: number; panX: number; panY: number }) => {
    setView({
      zoom: Math.min(HOME_STAGE.maxZoom.value, Math.max(HOME_STAGE.minZoom.value, v.zoom)),
      panX: v.panX,
      panY: v.panY,
    });
  };

  const scrollStrip = (dir: number) => {
    const el = stripRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.72, behavior: 'smooth' });
  };

  const plateSprite = uiAtlas.sprites[BAR_PLATE];
  const glyph = (name: GlyphName, size: number): ReactNode => <Glyph name={name} size={size} />;

  return (
    // L-6：不再自绘托底/暗角——spine 场景随模型自带，画布外只留 global.css 的
    // 纯色底（仅在场景矩形没铺满时可见）。滚轮/拖拽为隐藏视角能力。
    <div
      className="lobby"
      onWheel={(e) => {
        updateView({ ...view, zoom: view.zoom * (e.deltaY > 0 ? 0.92 : 1.08) });
      }}
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY, moved: false };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        const rect = e.currentTarget.getBoundingClientRect();
        updateView({
          zoom: view.zoom,
          panX: d.px - dx / Math.max(rect.width, 1),
          panY: d.py + dy / Math.max(rect.height, 1),
        });
      }}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
      onClick={(e) => {
        // 拖拽结束不算点击（pointerup 不清 dragRef，留到 click 判定后消费）
        if (dragRef.current?.moved) {
          dragRef.current = null;
          return;
        }
        dragRef.current = null;
        onTapAt(e);
      }}
    >
      {spineRes && !spineError ? (
        <SpineView
          key={student.home_spine}
          className="lobby-canvas"
          skelUrl={spineRes.skel}
          atlasUrl={spineRes.atlas}
          fit="cover"
          zoom={view.zoom}
          panX={view.panX}
          panY={view.panY}
          onTap={() => {
            /* 反应动画由 SpineView 内部 onClick 触发；语音/❤/好感度走外层 onClick 分区逻辑 */
          }}
          onError={(m) => {
            setSpineError(true);
            toast(`Spine 渲染失败：${m}`);
          }}
        />
      ) : (
        <div className="lobby-loading">
          {spineError ? '该模型无法渲染（贴图或版本不匹配）' : '未找到回忆大厅模型'}
        </div>
      )}

      {line && <div className="lobby-line">{line}</div>}

      {/* 语音字幕 ❤ 粒子层 */}
      {hearts.map((h) => (
        <span
          key={h.id}
          className={`lobby-heart${h.big ? ' big' : ''}`}
          style={{ left: h.x, top: h.y, ['--dx' as string]: `${h.dx}px`, animationDelay: `${h.delay}ms` }}
        >
          ♥
        </span>
      ))}

      {/* L-2/F2 底部功能条：真机少量按钮——大厅选择 / 回忆重播。
          返回箭头在顶部（TopCurrencyBar .nav-item）、设定在右上（同一顶栏菜单钮）。
          首个 .icon-btn 必须是「大厅选择」（e2e 契约） */}
      <div className="lobby-tools">
        <BarButton
          sprite={plateSprite}
          icon={BAR_ICONS.change}
          iconSize={26}
          fallback={glyph('student', 26)}
          title="大厅选择"
          onClick={() => {
            setPicking(true);
            setQuery('');
          }}
        />
        <BarButton
          sprite={plateSprite}
          icon={BAR_ICONS.memory}
          iconSize={30}
          fallback={glyph('memorial', 30)}
          title="回忆重播"
          onClick={replayMemory}
        />
      </div>

      {/* L-5：切换抽屉 = 横向轮播卡片（已可用大厅序列 + 左右箭头）+ 搜索
          （265 名学生的超量场景保留搜索能力，报告 L-5 解决思路）。 */}
      {picking && (
        <div className="lobby-picker">
          <div className="picker-head">
            <div className="picker-title">
              <b>选择回忆大厅</b>
              {/* 学生名移入抽屉（真机形态）；.lobby-name 类是 e2e 学生名契约 */}
              <div className="lobby-name">
                <b>{student.name}</b>
              </div>
              <span className="picker-count">共 {lobbyStudents.length} 位可用</span>
            </div>
            <div className="picker-actions">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索学生…"
              />
              <button className="btn ghost sm" onClick={() => setPicking(false)}>
                关闭
              </button>
            </div>
          </div>
          <div className="picker-strip-wrap">
            <button className="picker-arrow" title="向左" onClick={() => scrollStrip(-1)}>
              ‹
            </button>
            <div className="picker-strip" ref={stripRef}>
              {filtered.map((s) => (
                <button
                  key={s.id}
                  className={`picker-card${s.id === student.id ? ' current' : ''}`}
                  onClick={() => {
                    setStudent(s);
                    setPicking(false);
                    setLine('');
                    setSpineError(false);
                  }}
                >
                  {s.lobby ? (
                    <img src={s.lobby} alt={s.name} loading="lazy" />
                  ) : s.avatar ? (
                    <img src={s.avatar} alt={s.name} loading="lazy" style={{ objectFit: 'cover' }} />
                  ) : (
                    <div className="picker-card-empty">无封面</div>
                  )}
                  <div className="nm">
                    {s.name}
                    {s.skin ? ` · ${s.skin}` : ''}
                  </div>
                </button>
              ))}
            </div>
            <button className="picker-arrow" title="向右" onClick={() => scrollStrip(1)}>
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
