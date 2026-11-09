import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * S-9：DEV 调试信息用 import.meta.env.DEV 判定（生产构建隐藏）。
 * 本仓库未建 src/vite-env.d.ts，此处补最小声明（tsconfig include src）。
 */
declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
import { useApp, navState } from '../core/AppContext';
import { audio } from '../core/audio';
import { loadStoryFile } from '../core/assets';
import { markRead, STORY_CLEAR_REWARD, store, useSave } from '../core/store';
import { useViewStack, StackOverlay } from '../components/stage';
import type {
  EventChapter,
  EventStoryGroup,
  StoryChoiceOption,
  StoryEntry,
  StoryFile,
  StoryOp,
} from '../types';
import {
  applySpeaker,
  collectSpeakers,
  fmtPeriod,
  parseExpression,
  resolveActor,
  slotToPos,
  type ActorState,
  type StagePos,
} from '../components/story/storyStage';
import { StoryDialog, StoryMenuPanel, StoryTopControls } from '../components/story/StoryDialog';
import { StoryChoices } from '../components/story/StoryChoices';
import { StoryHistory, type HistoryRow } from '../components/story/StoryHistory';
import { StoryPortrait } from '../components/story/StoryPortrait';
import { storyVoice } from '../components/story/StoryVoice';
import {
  EMPTY_FX,
  StoryCg,
  StoryEndCard,
  StorySkipConfirm,
  StoryTelop,
  StoryTransition,
  StoryUnlock,
  shakeClass,
  type StoryFxState,
} from '../components/story/StoryOverlays';

// ---------------------------------------------------------------- 主线卷→章分组（data/main_story_map.json）
// 数据源：ExcelDB ScenarioModeDBSchema ModeType=1（VolumeId/ChapterId/EpisodeId →
// ScenarioScript 遗留组）。story_index 的 main 820 条是活动剧情错分类（见 build_main_story_map.py 头注）。

interface MainEpisode {
  id: string;
  episode: number;
  title: string;
  path: string;
  lines: number;
  groups: number[];
  chars: string[];
}
interface MainChapter {
  chapter: number;
  name: string;
  range: string;
  /** ScenarioModeSubTypes Series2 = 卷内副篇系列（如 Vol.1「首席行政官的假日」） */
  side?: boolean;
  episodes: MainEpisode[];
}
interface MainVolume {
  volume: number;
  label: string;
  name: string;
  nameEn?: string;
  chapters: MainChapter[];
}

/** 地图集 -> 播放器条目（openStory 只用 id/path/lines/title） */
function mainEpisodeToEntry(e: MainEpisode): StoryEntry {
  return { id: e.id, type: 'main', title: e.title, summary: '', path: e.path, nodes: 0, lines: e.lines, chars: e.chars ?? [] };
}

/**
 * 卷封面轮转（对照 4 左侧拼贴横幅）：官方 Scenario_Title_01_1/01_2/02/03/04
 * （resources/ui/extra/，原版主线选择页场景图，带宝丽来相框）。卷→图精确映射
 * 数据轨无据，按卷序轮转取用并 data-ui-source 标注；Scenario_Mode_Bg_3（裁决②
 * 移作选择页横幅素材）做横幅底部纹理。
 */
const VOLUME_TITLES = [
  '/res/ui/extra/Scenario_Title_01_1.png',
  '/res/ui/extra/Scenario_Title_01_2.png',
  '/res/ui/extra/Scenario_Title_02.png',
  '/res/ui/extra/Scenario_Title_03.png',
  '/res/ui/extra/Scenario_Title_04.png',
];
const VOLUME_BANNER_DECO = '/res/ui/extra3/Scenario_Mode_Bg_3.png';

function volumeCover(volume: number): string {
  return VOLUME_TITLES[((volume % VOLUME_TITLES.length) + VOLUME_TITLES.length) % VOLUME_TITLES.length];
}

interface Line {
  speaker: string;
  text: string;
  kind: 'say' | 'info' | 'mark' | 'choice';
}

/**
 * 可对话行。popup/memlobby 不再产占位文字行（S-3）：popup → 全屏 CG 图层、
 * memlobby → 解锁横幅，均为演出 op，由 fx 状态渲染（StoryOverlays）。
 */
function opText(n: StoryOp): Line | null {
  if (n.op === 'script') {
    const s = n as StoryScriptNode;
    return { speaker: s.speaker, text: s.text, kind: 'say' };
  }
  if (n.op === 'info') return { speaker: '', text: nodeText(n), kind: 'info' };
  if (n.op === 'choice') return null; // choice 由分支状态机单独渲染
  return null;
}

/** 可停下来的节点（对话框、选择点、telop 字幕停顿） */
function isDisplayable(n: StoryOp): boolean {
  if (n.op === 'subtitle') return Boolean((n as { on?: boolean }).on); // S-4：字幕显示时停顿（真机点击继续，off 清除）
  return Boolean(opText(n)) || (n.op === 'choice' && ((n as { options?: StoryChoiceOption[] }).options?.length ?? 0) > 0);
}

function branchOf(n: StoryOp): string | undefined {
  // 分支段 = 选项后 selection_group==N 的连续行（数据轨契约），script/info 都可能带
  // branch 字段（实测 11000 choice@152 的分支落点是 info 节点——此前只认 script，
  // info 分支行会被当主线节点显示/搜不到，徽标失效）。S-4 telop 停顿接入后，
  // subtitle 也可能带 branch（全库实测 1123 个）——同样参与分支过滤。
  if (n.op !== 'script' && n.op !== 'info' && n.op !== 'subtitle') return undefined;
  const b = (n as { branch?: unknown }).branch;
  return typeof b === 'string' ? b : undefined;
}

/** scan 途中累积的 fx 快照（subtitle/place/cg 随落点一起呈现） */
interface FxSnapshot {
  subtitle: string;
  place: string;
  cg: string | null;
}

type Mode = 'main' | 'event' | 'bond' | 'group';

/**
 * 数据轨 2026-11-10 重生成后的 script 节点扩展字段（S-1 槽位 / S-2 语音）。
 * types.ts 的 StoryOp.script 尚未收录（公共类型文件不在本轨领地），这里做
 * 局部收窄；字段实测见 resources/story/main/episode/11000.json：
 *   slot(1..5) / voiceId(CRC) / voiceJp("Audio/VOC_JP/..") / voiceKr("Audio/VOC_KR/..")
 */
interface StoryScriptNode extends Extract<StoryOp, { op: 'script' }> {
  slot?: number;
  voiceId?: number;
  voiceJp?: string;
  voiceKr?: string;
}

/** 演出 op 的宽松访问（place/subtitle/popup/enter/slotCmd/castAll/transition 落兜底分支） */
function nodeField(n: StoryOp, key: string): unknown {
  return (n as { [k: string]: unknown })[key];
}
function nodeText(n: StoryOp): string {
  const v = nodeField(n, 'text');
  return typeof v === 'string' ? v : '';
}

export default function StoryPage() {
  const { assets, toast } = useApp();
  const save = useSave();
  const stack = useViewStack<'player'>();

  // ---- 选择页状态（E2/S-7：主线=原版形制主体；活动/羁绊/社团=右上胶囊覆盖层） ----
  const [mode, setMode] = useState<Mode>('main');
  const [activeVol, setActiveVol] = useState(0);
  const [activeChapter, setActiveChapter] = useState(0);
  const [groupFilter, setGroupFilter] = useState('');
  const [selected, setSelected] = useState<StoryEntry | null>(null);
  // ---- 播放器状态 ----
  const [file, setFile] = useState<StoryFile | null>(null);
  const [fileTitle, setFileTitle] = useState('');
  const [idx, setIdx] = useState(-1);
  const [line, setLine] = useState<Line | null>(null);
  const [choice, setChoice] = useState<{ index: number; options: StoryChoiceOption[] } | null>(null);
  const [branchGroup, setBranchGroup] = useState<string | null>(null);
  const [actors, setActors] = useState<ActorState[]>([]);
  const [failedActors, setFailedActors] = useState<string[]>([]);
  const [bgName, setBgName] = useState('');
  const [bgName2, setBgName2] = useState(''); // 背景双层（S-4 bgoverlap 交叉淡入）
  const [bgmName, setBgmName] = useState('');
  const [fx, setFx] = useState<StoryFxState>(EMPTY_FX);
  const [shake, setShake] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [auto, setAuto] = useState(false);
  const [skip, setSkip] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [typed, setTyped] = useState(0);
  const [ended, setEnded] = useState(false);

  // 活动剧情分组（data/event_story_map.json，数据轨交付；缺失时活动覆盖层退回平铺）
  const [eventGroups, setEventGroups] = useState<EventStoryGroup[] | null>(null);
  // 主线卷→章分组（data/main_story_map.json，本轨交付；缺失时主线退回提示态）
  const [mainMap, setMainMap] = useState<MainVolume[] | null>(null);
  // 对话框上沿到舞台底部的高度（立绘底部与其对齐，见 StoryPortrait.bottomInset）
  const [dialogH, setDialogH] = useState(360);

  const typingRef = useRef<number | null>(null);
  const autoTimer = useRef<number | null>(null);
  const fxTimers = useRef<number[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const actorsRef = useRef<ActorState[]>([]);
  /** 说话人 -> 立绘资源/学生档案（openStory 时一次性解析） */
  const resourcesRef = useRef<Map<string, ReturnType<typeof resolveActor>>>(new Map());
  const branchRef = useRef<string | null>(null);
  /** 静默重放循环累积的舞台/fx（applyNode 用） */
  const replayFxRef = useRef<FxSnapshot>({ subtitle: '', place: '', cg: null });

  /** 定时清除 fx 的一次性副作用（转场/屏震/解锁横幅），openStory 时统一清 */
  const scheduleFx = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    fxTimers.current.push(id);
  }, []);
  const clearFxTimers = useCallback(() => {
    for (const id of fxTimers.current) window.clearTimeout(id);
    fxTimers.current = [];
  }, []);

  // ---- 选择页数据 ----
  useEffect(() => {
    if (eventGroups) return;
    let alive = true;
    fetch('/data/event_story_map.json')
      .then((r) => (r.ok ? (r.json() as Promise<{ events?: EventStoryGroup[] }>) : null))
      .then((d) => {
        if (alive) setEventGroups(d?.events ?? []);
      })
      .catch(() => {
        if (alive) setEventGroups([]);
      });
    return () => {
      alive = false;
    };
  }, [eventGroups]);

  useEffect(() => {
    if (mainMap) return;
    let alive = true;
    fetch('/data/main_story_map.json')
      .then((r) => (r.ok ? (r.json() as Promise<MainVolume[]>) : null))
      .then((d) => {
        if (alive && Array.isArray(d) && d.length > 0) {
          setMainMap(d);
          setActiveVol(d[0].volume);
          setActiveChapter(d[0].chapters[0]?.chapter ?? 0);
        } else if (alive) setMainMap([]);
      })
      .catch(() => {
        if (alive) setMainMap([]);
      });
    return () => {
      alive = false;
    };
  }, [mainMap]);

  /** 活动/羁绊/社团覆盖层条目（groupFilter 消费来自活动页的 pendingStoryQuery） */
  const groupEntries = useMemo(() => {
    const q = groupFilter.trim().toLowerCase();
    return assets.storyIndex
      .filter((s) => s.type === mode && s.lines > 0)
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 300);
  }, [assets.storyIndex, mode, groupFilter]);

  /** 活动分组视图（事件分组 + 未归类兜底，沿用原分组渲染） */
  const eventSections = useMemo(() => {
    if (mode !== 'event' || !eventGroups) return null;
    const q = groupFilter.trim().toLowerCase();
    const byId = new Map(assets.storyIndex.map((s) => [s.id, s]));
    const used = new Set<string>();
    type SectionItem = { entry: StoryEntry; chapter?: EventChapter };
    const sections = eventGroups
      .map((g, gi) => {
        if (q && !(g.name ?? '').toLowerCase().includes(q)) return null;
        const items = [...g.chapters]
          .sort((a, b) => a.order - b.order)
          .map((ch: EventChapter): SectionItem | null => {
            used.add(ch.storyId);
            const e = byId.get(ch.storyId);
            // 0 句的空章节同样不列出——走查⑥
            return e && e.lines > 0 ? { entry: e, chapter: ch } : null;
          })
          .filter((x): x is SectionItem => x !== null);
        const period = g.period ? `${fmtPeriod(g.period.start)} ~ ${fmtPeriod(g.period.end)}` : '';
        return {
          key: `ev-${g.eventId}-${gi}`,
          header: g.name ?? `活动剧情 #${g.eventId}`,
          sub: period,
          items,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null && s.items.length > 0);
    const rest = assets.storyIndex.filter(
      (s) =>
        s.type === 'event' &&
        s.lines > 0 &&
        !used.has(s.id) &&
        !(s.events && s.events.length > 0) &&
        (!q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    );
    if (rest.length > 0) {
      sections.push({
        key: 'ev-rest',
        header: '未归类活动剧情',
        sub: '',
        items: rest.slice(0, 200).map((e) => ({ entry: e })),
      });
    }
    return sections;
  }, [mode, eventGroups, assets.storyIndex, groupFilter]);

  const fullText = line?.text ?? '';
  const isTyping = typed < fullText.length;

  // ---- 主线章节锁定（S-7/E2 对照4：锁定灰/选中白+黄点青边） ----
  // 章解锁 = 前一章全部话目已通关；第一章无条件解锁。不伪造「解锁」——存档
  // cleared 是唯一进度源，无存档时只有第一章可点。
  const chapterState = useCallback(
    (vol: MainVolume) => {
      let prevDone = true; // 第一章无条件解锁
      return vol.chapters.map((ch) => {
        const eps = ch.episodes.filter((e) => e.lines > 0);
        const clearedCount = eps.filter((e) => save.story.cleared.includes(e.id)).length;
        const done = eps.length > 0 && clearedCount === eps.length;
        const unlocked = prevDone;
        prevDone = done; // 本章全通才解锁下一章
        return { chapter: ch, clearedCount, total: eps.length, done, unlocked };
      });
    },
    [save.story.cleared]
  );

  const activeVolume = useMemo(
    () => mainMap?.find((v) => v.volume === activeVol) ?? mainMap?.[0] ?? null,
    [mainMap, activeVol]
  );
  const activeChapterState = useMemo(() => {
    if (!activeVolume) return null;
    const states = chapterState(activeVolume);
    return states.find((s) => s.chapter.chapter === activeChapter) ?? states[0] ?? null;
  }, [activeVolume, activeChapter, chapterState]);

  // 对话框高度测量：立绘底部对齐对话框上沿（.player-dialog 挂载/内容变化都会改高度）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !stack.has('player')) return;
    const el = stage.querySelector<HTMLElement>('.player-dialog');
    if (!el) return; // 选项层/结束层顶替时保持上一次的对齐，不跳动
    const update = () => setDialogH(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [file, line, choice, ended, showHistory, menuOpen, stack]);

  // 打字机（保留原有行为：速度跟随设置，快进时立即完成）
  useEffect(() => {
    if (typingRef.current) window.clearInterval(typingRef.current);
    if (!line) return;
    setTyped(0);
    if (skip) {
      setTyped(fullText.length);
      return;
    }
    const stepMs = Math.max(8, Math.round(1000 / Math.max(save.settings.textSpeed, 1)));
    typingRef.current = window.setInterval(() => {
      setTyped((t) => {
        if (t >= fullText.length) {
          if (typingRef.current) window.clearInterval(typingRef.current);
          return t;
        }
        return t + 1;
      });
    }, stepMs);
    return () => {
      if (typingRef.current) window.clearInterval(typingRef.current);
    };
  }, [line, fullText, save.settings.textSpeed, skip]);

  /**
   * 沿 dir 扫描直到遇到可显示节点。
   * 分支规则（数据轨契约 + 2026-11-08 实测拓扑）：
   * - 正向：branchGroup 存在时只显示 branch === group 的节点；遇到无 branch
   *   字段的可显示节点即汇合（显示并清分组）；branch !== group 的节点是
   *   其他分支，跳过。branchGroup 为 null 时跳过一切带 branch 的节点
   *   （主线扫描不落入分支段）。
   * - 回退：分支内先回退本分支节点；无分组上下文时整段跳过 branch 节点，
   *   直接回到上一个 choice 或更早的主线节点。
   *
   * 演出 op 消费（S-3/S-4，2026-11-10）：
   * - fx 累积（subtitle/place/popup.cg）：无论 silent 与否都更新快照（快进/
   *   回退重建时字幕与 CG 状态保持连贯），on=false 的 subtitle 清空 telop；
   * - 一次性副作用（se/transition 遮罩/bgShake/memlobby 横幅/语音）：silent
   *   （重放与回退）时跳过；transition/popup 的 outResource 型转场映射为
   *   fade / fade_white 两类遮罩，bgoverlap 由背景双层交叉淡入承担不遮罩。
   */
  const scan = useCallback(
    (
      f: StoryFile,
      start: number,
      dir: 1 | -1,
      ctx: string | null,
      silent = false
    ): { index: number; line: Line | null; isChoice: boolean; bg: string; bgm: string; fx: FxSnapshot } => {
      let i = start;
      let bg = '';
      let bgm = '';
      const snap: FxSnapshot = { ...replayFxRef.current };
      while (i >= 0 && i < f.nodes.length) {
        const n = f.nodes[i] as StoryOp;
        if (n.op === 'background') {
          bg = (n as { bg: string }).bg;
          snap.cg = null; // S-3：CG 持续到下一个背景切换
        } else if (n.op === 'bgm') bgm = (n as { id: string }).id;
        else if (n.op === 'bgmStop') bgm = '';
        else if (n.op === 'subtitle') {
          const s = n as { on?: boolean; text?: string };
          snap.subtitle = s.on ? (s.text ?? '') : '';
        } else if (n.op === 'place') {
          snap.place = nodeText(n) ?? '';
        } else if (n.op === 'popup') {
          const cg = (n as { cg?: string }).cg;
          if (cg) snap.cg = cg;
        } else if (n.op === 'se' && !silent) audio.playSe((n as { id: string }).id);
        else if (n.op === 'transition' && !silent) {
          // S-4：fade=黑场、fade_white=白闪；bgoverlap 交给背景双层交叉淡入
          const t = n as { out?: string; outDuration?: number; inDuration?: number };
          const kind = t.out === 'fade_white' ? 'fade_white' : t.out === 'bgoverlap' ? null : 'fade';
          if (kind) {
            const total = (t.outDuration ?? 1000) + (t.inDuration ?? 1000);
            setFx((p) => ({ ...p, transitionFx: kind, transitionUntil: Date.now() + total }));
            scheduleFx(total, () => setFx((p) => ({ ...p, transitionFx: null, transitionUntil: 0 })));
          }
        } else if (n.op === 'bgShake' && !silent) {
          setShake(true);
          scheduleFx(620, () => setShake(false));
        } else if (n.op === 'memlobby' && !silent) {
          setFx((p) => ({ ...p, unlock: '解锁了回忆大厅' }));
          scheduleFx(3200, () => setFx((p) => ({ ...p, unlock: '' })));
        } else if (n.op === 'choice') {
          const options = (n as { options?: StoryChoiceOption[] }).options ?? [];
          if (options.length > 0) return { index: i, line: null, isChoice: true, bg, bgm, fx: snap };
        } else if (n.op === 'subtitle' && (n as { on?: boolean }).on) {
          // S-4 telop 停顿点：字幕显示、无对话框，等待点击/自动推进（off 清除）。
          // 空文本的 on 指令（实测 80000005@58：raw "[0,0];instant;1;" 无 text）
          // 不停顿；带 branch 的字幕（实测 1123 个）参与分支过滤，不属于本分支的跳过
          const br = branchOf(n);
          if (br !== undefined && (!ctx || br !== ctx)) {
            i += dir;
            continue;
          }
          if (snap.subtitle) return { index: i, line: null, isChoice: false, bg, bgm, fx: snap };
        } else if (isDisplayable(n)) {
          const br = branchOf(n);
          if (dir === 1) {
            if (br !== undefined) {
              if (ctx && br === ctx) return { index: i, line: opText(n), isChoice: false, bg, bgm, fx: snap };
              i += dir; // 其他分支 / 无上下文：跳过
              continue;
            }
            // 无 branch 字段 = 主线节点（ctx 存在时意味着分支段结束，由调用者清 ctx）
            return { index: i, line: opText(n), isChoice: false, bg, bgm, fx: snap };
          } else {
            if (br !== undefined) {
              if (ctx && br === ctx) return { index: i, line: opText(n), isChoice: false, bg, bgm, fx: snap };
              i += dir; // 分支段整段跳过，回退直接落 choice 或更早主线
              continue;
            }
            return { index: i, line: opText(n), isChoice: false, bg, bgm, fx: snap };
          }
        }
        i += dir;
      }
      return { index: -1, line: null, isChoice: false, bg, bgm, fx: snap };
    },
    [scheduleFx]
  );

  const applyNode = useCallback(
    (f: StoryFile, target: number, dir: 1 | -1) => {
      // 静默重放 [0, target)：从空舞台全量重建背景/BGM/站位与 fx 快照（含
      // enter/castAll/slotCmd 站位进出与 script 的 slot 落位，choice 落点的舞台因此正确）
      let bg = '';
      let bgm = '';
      let actors: ActorState[] = [];
      const rp: FxSnapshot = { subtitle: '', place: '', cg: null };
      for (let i = 0; i < target; i++) {
        const n = f.nodes[i] as StoryOp;
        if (n.op === 'background') {
          bg = (n as { bg: string }).bg;
          rp.cg = null;
        } else if (n.op === 'bgm') bgm = (n as { id: string }).id;
        else if (n.op === 'bgmStop') bgm = '';
        else if (n.op === 'subtitle') {
          const s = n as { on?: boolean; text?: string };
          rp.subtitle = s.on ? (s.text ?? '') : '';
        } else if (n.op === 'place') rp.place = nodeText(n) ?? '';
        else if (n.op === 'popup') {
          const cg = (n as { cg?: string }).cg;
          if (cg) rp.cg = cg;
        } else if (n.op === 'enter') {
          const e = n as { slot?: number; speaker?: string; sequence?: string };
          if (e.speaker) {
            const upd = applySpeaker(
              actors,
              e.speaker,
              parseExpression(e.sequence),
              resourcesRef.current,
              e.slot
            );
            actors = upd.actors;
          }
        } else if (n.op === 'castAll') {
          const act = (n as { action?: string }).action;
          if (act === 'hide') actors = [];
        } else if (n.op === 'slotCmd') {
          const c = n as { slot?: number; action?: string };
          if (c.action === 'hide' && slotToPos(c.slot)) {
            const pos = slotToPos(c.slot) as StagePos;
            actors = actors.filter((a) => a.pos !== pos);
          }
        } else if (n.op === 'script') {
          const s = n as StoryScriptNode;
          const who = s.spine || s.speaker || '';
          if (who) {
            const upd = applySpeaker(
              actors,
              who,
              parseExpression(s.sequence),
              resourcesRef.current,
              s.slot
            );
            actors = upd.actors;
          }
        }
      }
      actorsRef.current = actors;
      setActors(actors);
      replayFxRef.current = rp;

      const ctx = branchRef.current;
      const r = scan(f, target, dir, ctx);
      const finalBg = r.bg || bg;
      const finalBgm = r.bgm || bgm;
      setBgName2((p) => (finalBg === bgName ? p : bgName)); // 旧背景转底层（交叉淡入）
      setBgName(finalBg);
      setBgmName(finalBgm);
      if (finalBgm) audio.playBgm(finalBgm);
      else audio.stopBgm();
      setFx((p) => ({ ...p, subtitle: r.fx.subtitle, place: r.fx.place, cg: r.fx.cg }));
      replayFxRef.current = r.fx;

      // S-2 语音：正向新消费的 script 播台词语音；回退（dir=-1）与快进（skip）
      // 不播（各自的 stop 由回退入口/快进 effect 承担）
      if (dir === 1 && !skip && r.index >= 0 && !r.isChoice) {
        const n = f.nodes[r.index] as StoryOp;
        if (n.op === 'script') {
          const s = n as StoryScriptNode;
          if (s.voiceJp || s.voiceKr) storyVoice.play(s.voiceJp, s.voiceKr);
        }
      }

      if (r.index === -1) {
        setEnded(true);
        setIdx(f.nodes.length);
        setChoice(null);
        setLine(null);
        branchRef.current = null;
        setBranchGroup(null);
        storyVoice.stop();
        if (target >= f.nodes.length && f.story_id) {
          const id = f.story_id;
          if (!save.story.cleared.includes(id)) {
            store.update((d) => {
              d.story.cleared.push(id);
              d.currency.pyroxene += STORY_CLEAR_REWARD;
            });
            toast(`首次通关 +${STORY_CLEAR_REWARD} 青辉石`);
          }
        }
        return;
      }

      const n = f.nodes[r.index] as StoryOp;
      setIdx(r.index);
      setEnded(false);

      if (r.isChoice) {
        // 选择点：对话框让位给选项层，等待用户选择
        const options = (n as { options?: StoryChoiceOption[] }).options ?? [];
        setChoice({ index: r.index, options });
        setLine(null);
        branchRef.current = null;
        setBranchGroup(null);
        if (skip) {
          setSkip(false);
          toast('遇到选项，已停止快进');
        }
        return;
      }
      setChoice(null);

      const shown = r.line as Line;
      setLine(shown);
      setHistory((h) => [...h.slice(-300), { kind: shown.kind, speaker: shown.speaker, text: shown.text }]);

      if (n.op === 'script') {
        const s = n as StoryScriptNode;
        const who = s.spine || s.speaker || '';
        const expr = parseExpression(s.sequence);
        const upd = applySpeaker(actorsRef.current, who, expr, resourcesRef.current, s.slot);
        actorsRef.current = upd.actors;
        setActors(upd.actors);
      }

      // 分支上下文维护
      const br = branchOf(n);
      if (dir === 1) {
        if (ctx && br === undefined) {
          branchRef.current = null;
          setBranchGroup(null);
        }
      } else {
        // 回退落点：choice 已在上面处理（清 ctx）；branch 节点恢复 ctx；主线节点清 ctx
        if (br !== undefined) {
          branchRef.current = br;
          setBranchGroup(br);
        } else {
          branchRef.current = null;
          setBranchGroup(null);
        }
      }

      store.update((d) => {
        markRead(d, f.story_id, r.index);
        d.story.progress[f.story_id] = r.index;
        d.story.lastPlayed = f.story_id; // 走查⑦：空态「继续播放」入口的真实数据源
      });
    },
    [scan, save.story.cleared, skip, toast]
  );

  const openStory = useCallback(
    async (entry: StoryEntry) => {
      clearFxTimers();
      setSelected(entry);
      setLine(null);
      setChoice(null);
      setHistory([]);
      setEnded(false);
      setFx(EMPTY_FX);
      setShake(false);
      setMenuOpen(false);
      setSkipConfirm(false);
      actorsRef.current = [];
      setActors([]);
      setFailedActors([]);
      branchRef.current = null;
      setBranchGroup(null);
      replayFxRef.current = { subtitle: '', place: '', cg: null };
      stack.open('player', { id: entry.id });
      try {
        const f = await loadStoryFile(entry.path);
        setFile(f);
        // 真实标题（剧本行 "第N话;标题" 分号转空格；无名集兜底 #id）
        const raw = entry.title && entry.title !== entry.id ? entry.title : f.title;
        setFileTitle(raw && raw !== entry.id ? raw.replace(';', ' ') : `剧情 #${entry.id}`);
        // 一次性解析本集所有说话人的立绘资源（内存映射，无 IO 阻塞）
        const res = new Map<string, ReturnType<typeof resolveActor>>();
        for (const name of collectSpeakers(f.nodes)) {
          if (!res.has(name)) res.set(name, resolveActor(assets, name));
        }
        resourcesRef.current = res;
        const start = save.story.progress[entry.id] ?? 0;
        applyNode(f, Math.min(start, Math.max(0, f.nodes.length - 1)), 1);
      } catch (e) {
        toast(`剧情加载失败：${e instanceof Error ? e.message : e}`);
        stack.close('player');
      }
    },
    [applyNode, assets, clearFxTimers, save.story.progress, stack, toast]
  );

  /** 关闭播放器回选择页（MENU「退出剧情」/ 结尾卡「返回选择页」共用） */
  /** 关闭播放器回选择页：内容保留（对话框停在最后一句）让滑出动画平滑，
      停音频即可；下一次 openStory 会全量重置状态 */
  const exitPlayer = useCallback(() => {
    storyVoice.stop();
    clearFxTimers();
    audio.stopBgm();
    setMenuOpen(false);
    setSkipConfirm(false);
    stack.close('player');
  }, [clearFxTimers, stack]);

  /** S-5 跳过本集：确认后直接置末尾（结算通关奖励），语音/快进态一并复位 */
  const skipEpisode = useCallback(() => {
    if (!file) return;
    setSkipConfirm(false);
    setMenuOpen(false);
    setSkip(false);
    setAuto(false);
    storyVoice.stop();
    applyNode(file, file.nodes.length, 1);
  }, [applyNode, file]);

  /** 选择一个选项：跳进分支段（nextGroup），缺失分支按单选项继续主线 */
  const selectChoice = useCallback(
    (opt: StoryChoiceOption) => {
      if (!file || !choice) return;
      setHistory((h) => [...h.slice(-300), { kind: 'choice', speaker: '', text: '', chosen: opt.text }]);
      const from = choice.index;
      setChoice(null);
      if (!opt.nextGroup) {
        branchRef.current = null;
        setBranchGroup(null);
        applyNode(file, from + 1, 1);
        return;
      }
      let j = -1;
      for (let i = from + 1; i < file.nodes.length; i++) {
        if (branchOf(file.nodes[i] as StoryOp) === opt.nextGroup) {
          j = i;
          break;
        }
      }
      if (j < 0) {
        // 分支段缺失（实测 10000005 choice@50 的 6/7 号分支无内容）：当单选项继续
        branchRef.current = null;
        setBranchGroup(null);
        applyNode(file, from + 1, 1);
        return;
      }
      branchRef.current = opt.nextGroup;
      setBranchGroup(opt.nextGroup);
      applyNode(file, j, 1);
    },
    [choice, file, applyNode]
  );

  const advance = useCallback(() => {
    if (!file) return;
    if (choice) return; // 选项等待用户点击
    if (menuOpen || skipConfirm || showHistory) return; // 弹层打开时不推进
    if (isTyping) {
      setTyped(fullText.length);
      return;
    }
    if (ended) return;
    applyNode(file, idx + 1, 1);
  }, [file, choice, idx, isTyping, fullText.length, ended, applyNode, menuOpen, skipConfirm, showHistory]);

  const goPrev = useCallback(() => {
    if (!file || choice || idx <= 0) return;
    storyVoice.stop(); // S-2：回退停止当前语音
    setMenuOpen(false);
    applyNode(file, idx - 1, -1);
  }, [applyNode, choice, file, idx]);

  // 自动 / 快进（选项出现时暂停等待）
  useEffect(() => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    if (!auto || !file || ended || showHistory || choice || menuOpen || skipConfirm) return;
    if (isTyping) return;
    autoTimer.current = window.setTimeout(() => {
      advance();
    }, save.settings.autoDelay);
    return () => {
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
  }, [auto, file, ended, isTyping, idx, choice, advance, save.settings.autoDelay, showHistory, menuOpen, skipConfirm]);

  // 快进只跳已读节点（选项与分支停快进；S-2：快进启动即停当前语音）
  useEffect(() => {
    if (!skip || !file || ended || choice) return;
    storyVoice.stop();
    const timer = window.setTimeout(() => {
      const next = idx + 1;
      const node = file.nodes[next];
      if (!node) {
        setSkip(false);
        setEnded(true);
        return;
      }
      if (node.op === 'choice') {
        setSkip(false); // 选项处停下（applyNode 里也会兜底停一次）
        return;
      }
      const l = opText(node);
      if (!l) {
        applyNode(file, next, 1);
        return;
      }
      const read = save.story.read[file.story_id]?.includes(next) ?? false;
      if (read || save.settings.skipUnread) applyNode(file, next, 1);
      else {
        setSkip(false);
        toast('遇到未读内容，已自动停止快进');
      }
    }, 90);
    return () => window.clearTimeout(timer);
  }, [skip, file, idx, ended, choice, applyNode, save.story.read, save.settings.skipUnread, toast]);

  useEffect(() => {
    return () => {
      audio.stopBgm();
      storyVoice.stop();
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
  }, []);

  // 消费来自桃信 / 活动页的跳转参数：
  // pendingStoryId 直开播放器；pendingStoryQuery（活动页带入的活动名）进活动
  // 覆盖层并过滤（搜索框按 E2 删除，查询词改为覆盖层内过滤）
  useEffect(() => {
    if (navState.pendingStoryId) {
      const entry = assets.storyIndex.find((s) => s.id === navState.pendingStoryId);
      navState.pendingStoryId = null;
      if (entry) {
        setMode(entry.type === 'group' ? 'group' : entry.type === 'bond' ? 'bond' : 'event');
        void openStory(entry);
      }
      return;
    }
    if (navState.pendingStoryQuery) {
      setMode('event');
      setGroupFilter(navState.pendingStoryQuery);
      navState.pendingStoryQuery = null;
    }
  }, [assets.storyIndex, openStory]);

  const bgUrl = bgName ? assets.bg(bgName) : null;
  const bgUrl2 = bgName2 ? assets.bg(bgName2) : null;
  const stageSpeaker = line?.kind === 'say' ? line.speaker : '';
  /** 当前说话人是否在舞台上有立绘（决定对话框角落头像是否显示） */
  const onStage = stageSpeaker ? actors.some((a) => a.key === stageSpeaker && a.resource) : false;
  // 角落头像：不在舞台上的说话人显示学生头像；没有学生的 NPC 用对话立绘（走查⑤）
  const cornerRes = line?.kind === 'say' && !onStage ? resourcesRef.current.get(stageSpeaker) : undefined;
  const cornerAvatar = cornerRes ? (cornerRes.student?.avatar ?? cornerRes.npcPortrait ?? null) : null;

  // 走查⑦：选择页「继续播放」——最近播放（save.story.lastPlayed）的那一集。
  const resumeEntry = useMemo(() => {
    const id = save.story.lastPlayed;
    if (!id) return null;
    const inIndex = assets.storyIndex.find((s) => s.id === id);
    if (inIndex) return inIndex;
    if (!mainMap) return null;
    for (const vol of mainMap) {
      for (const ch of vol.chapters) {
        const hit = ch.episodes.find((e) => e.id === id);
        if (hit) return mainEpisodeToEntry(hit);
      }
    }
    return null;
  }, [save.story.lastPlayed, assets.storyIndex, mainMap]);
  const resumeTitle = resumeEntry
    ? !resumeEntry.title || resumeEntry.title === resumeEntry.id
      ? `剧情 #${resumeEntry.id}`
      : resumeEntry.title.replace(';', ' ')
    : '';

  const playerOpen = stack.has('player');

  return (
    <div className="story-page">
      {/* ---------- 选择页（E2/S-7：主线原版形制 = 拼贴横幅 + 斜切章节条 + 几何纹理背景） ---------- */}
      <div className="story-picker" data-testid="story-list">
        {mode === 'main' ? (
          <>
            <div className="story-caps">
              <div className="seg story-mode-seg">
                {(['event', 'bond', 'group'] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)}>
                    {m === 'event' ? '活动' : m === 'bond' ? '羁绊' : '社团'}
                  </button>
                ))}
              </div>
            </div>
            {mainMap && mainMap.length > 0 && activeVolume ? (
              <>
                {/* 卷轮播标签 */}
                <div className="volume-tabs">
                  {mainMap.map((v) => (
                    <button
                      key={v.volume}
                      className={`volume-tab${v.volume === activeVolume.volume ? ' on' : ''}`}
                      onClick={() => {
                        setActiveVol(v.volume);
                        setActiveChapter(v.chapters[0]?.chapter ?? 0);
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                {/* 左上拼贴横幅（对照 4：场景图 + 卷名白条 + 简介） */}
                <div className="volume-banner" data-ui-source="assetbundle">
                  <div className="volume-banner-photos">
                    <img className="photo-a" src={volumeCover(activeVolume.volume)} alt="" />
                    <img className="photo-b" src={volumeCover(activeVolume.volume + 2)} alt="" />
                  </div>
                  <div className="volume-banner-caption">
                    <b>
                      {activeVolume.label} {activeVolume.name}
                    </b>
                    {activeVolume.nameEn && <span className="en">{activeVolume.nameEn}</span>}
                    <p>
                      {activeVolume.chapters.reduce((a, c) => a + c.episodes.length, 0)} 话 ·{' '}
                      {activeVolume.chapters.length} 章
                      {save.story.cleared.length > 0 && ' · 进度以通关为准'}
                    </p>
                  </div>
                </div>
                {/* 斜切章节条列表（对照 4：锁定灰 / 选中白+黄点青边） */}
                <div className="chapter-rail">
                  {chapterState(activeVolume).map((st) => {
                    const on = st.chapter.chapter === activeChapter;
                    return (
                      <button
                        key={st.chapter.chapter}
                        className={`chapter-bar${on ? ' on' : ''}${st.unlocked ? '' : ' locked'}`}
                        onClick={() => {
                          if (!st.unlocked) return;
                          setActiveChapter(st.chapter.chapter);
                        }}
                        data-testid="chapter-bar"
                      >
                        <span className="dot" />
                        <b>
                          {st.chapter.name}
                          {st.chapter.side && <i className="side-tag">番外</i>}
                        </b>
                        <span className="range">{st.chapter.range}</span>
                        <span className="status">
                          {st.unlocked ? (st.done ? '已通关' : `${st.clearedCount}/${st.total}`) : '🔒'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* 选中章的话目（story-item 契约保留） */}
                {activeChapterState && (
                  <div className="episode-list">
                    {activeChapterState.chapter.episodes
                      .filter((e) => e.lines > 0)
                      .map((e) => (
                        <StoryListItem
                          key={e.id}
                          entry={mainEpisodeToEntry(e)}
                          cleared={save.story.cleared.includes(e.id)}
                          active={selected?.id === e.id}
                          banner
                          onOpen={() => void openStory(mainEpisodeToEntry(e))}
                        />
                      ))}
                  </div>
                )}
                {resumeEntry && !playerOpen && (
                  <button className="story-resume" data-testid="story-resume" onClick={() => void openStory(resumeEntry)}>
                    <span className="resume-glyph">▶</span>
                    <span>
                      继续播放 · {resumeTitle}
                      {save.story.cleared.includes(resumeEntry.id) ? '（重温）' : ''}
                    </span>
                  </button>
                )}
              </>
            ) : (
              <div className="story-picker-empty">
                {mainMap === null ? '主线卷章数据加载中…' : '主线卷章数据缺失（data/main_story_map.json）'}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="story-caps">
              <div className="seg story-mode-seg">
                <button className="on" onClick={() => setMode('main')}>
                  返回主线
                </button>
                <input
                  className="group-filter"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  placeholder="过滤标题…"
                />
              </div>
            </div>
            {mode === 'event' && eventSections ? (
              <div className="story-group-list">
                {eventSections.map((sec) => (
                  <div key={sec.key} className="story-section">
                    <div className="story-section-head">
                      <b>{sec.header}</b>
                      {sec.sub && <span>{sec.sub}</span>}
                      <span>{sec.items.length} 章</span>
                    </div>
                    {sec.items.map(({ entry, chapter }) => (
                      <StoryListItem
                        key={entry.id}
                        entry={entry}
                        cleared={save.story.cleared.includes(entry.id)}
                        active={selected?.id === entry.id}
                        chapterTitle={chapter && !chapter.isRecollection ? undefined : chapter?.title}
                        recollection={chapter?.isRecollection}
                        onOpen={() => void openStory(entry)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="story-group-list">
                {groupEntries.map((s) => (
                  <StoryListItem
                    key={s.id}
                    entry={s}
                    cleared={save.story.cleared.includes(s.id)}
                    active={selected?.id === s.id}
                    onOpen={() => void openStory(s)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------- 播放器页栈层（E3：全屏接管，fixed 盖住顶栏） ---------- */}
      {stack.entries.map((e) => (
        <StackOverlay key={e.key} entry={e} className="story-player-stack" label="剧情播放器">
          {e.key === 'player' && file && (
            <div className={`story-player${skip ? ' skipping' : ''}`}>
              <div
                className={`player-stage${shakeClass(shake)}`}
                onClick={advance}
                data-testid="player-stage"
                ref={stageRef}
              >
                {/* 背景双层（S-4 bgoverlap 交叉淡入）：旧图在底层，新图淡入盖上；
                    key=bgName 强制换图重挂载以重播淡入动画 */}
                <div className="player-bg player-bg-under" style={bgUrl2 ? { backgroundImage: `url(${bgUrl2})` } : undefined} />
                <div
                  key={bgName || 'none'}
                  className={`player-bg${bgUrl ? '' : ' missing'}`}
                  data-name={bgName ? `素材缺失：${bgName}` : ''}
                  style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
                />

                {/* CG 全屏层（S-3：淡入，持续至下一个背景切换）；key 换图重播淡入 */}
                <StoryCg key={fx.cg ?? 'no-cg'} cg={fx.cg} />

                {/* 立绘层（S-1 五站位 + S-8 镜像；底部对齐对话框上沿） */}
                <div className="story-actors" style={{ ['--dialog-h' as never]: `${dialogH}px` }}>
                  {actors.map((a) => {
                    // 2026-11-08 走查⑤：降级链 spine → 学生头像 → NPC 对话立绘
                    const npcPortrait = a.npcPortrait && !failedActors.includes(`npc:${a.key}`) ? a.npcPortrait : null;
                    if (
                      !(a.resource && !failedActors.includes(a.key)) &&
                      !(a.student?.avatar || a.resource?.student?.avatar) &&
                      !npcPortrait
                    ) {
                      return null;
                    }
                    return (
                      <div key={a.key} className={`story-actor story-actor-${a.pos}${a.active ? ' active' : ''}`}>
                        {a.resource && !failedActors.includes(a.key) ? (
                          <StoryPortrait
                            skelUrl={a.resource.skel}
                            atlasUrl={a.resource.atlas}
                            expression={a.expression}
                            pos={a.pos}
                            speaking={a.active}
                            bottomInset={dialogH}
                            dim={!a.active}
                            onFail={() =>
                              setFailedActors((prev) => (prev.includes(a.key) ? prev : [...prev, a.key]))
                            }
                          />
                        ) : a.student?.avatar || a.resource?.student?.avatar ? (
                          <div className="story-actor-avatar" data-actor={a.key}>
                            <img src={a.student?.avatar ?? a.resource?.student?.avatar ?? ''} alt={a.displayName} />
                          </div>
                        ) : npcPortrait ? (
                          <img
                            className="story-actor-npc"
                            data-actor={a.key}
                            data-ui-source="assetbundle"
                            src={npcPortrait}
                            alt={a.displayName}
                            onError={() =>
                              setFailedActors((prev) => (prev.includes(`npc:${a.key}`) ? prev : [...prev, `npc:${a.key}`]))
                            }
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* 字幕条 / 解锁横幅 / 转场遮罩（S-4 / S-3） */}
                {fx.place && <StoryTelop text={fx.place} variant="place" />}
                {fx.subtitle && <StoryTelop text={fx.subtitle} variant="subtitle" />}
                {fx.unlock && <StoryUnlock text={fx.unlock} />}
                <StoryTransition fx={fx.transitionFx} active={Date.now() < fx.transitionUntil} />

                {choice && <StoryChoices options={choice.options} onSelect={selectChoice} />}

                {line && !choice && (
                  <StoryDialog
                    kind={line.kind}
                    speaker={line.speaker}
                    text={line.text}
                    typed={typed}
                    isTyping={isTyping}
                    cornerAvatar={cornerAvatar}
                  />
                )}

                {ended && (
                  <StoryEndCard
                    title={fileTitle}
                    cleared={save.story.cleared.includes(file.story_id)}
                    onReplay={() => {
                      setEnded(false);
                      setIdx(-1);
                      setLine(null);
                      setChoice(null);
                      setHistory([]);
                      actorsRef.current = [];
                      setActors([]);
                      setFx(EMPTY_FX);
                      replayFxRef.current = { subtitle: '', place: '', cg: null };
                      branchRef.current = null;
                      setBranchGroup(null);
                      applyNode(file, 0, 1);
                    }}
                    onExit={exitPlayer}
                  />
                )}

                {showHistory && <StoryHistory rows={history} onClose={() => setShowHistory(false)} />}

                {menuOpen && !ended && (
                  <StoryMenuPanel
                    skip={skip}
                    onToggleSkip={() => {
                      setSkip((v) => !v);
                      setAuto(false);
                    }}
                    onOpenHistory={() => {
                      setMenuOpen(false);
                      setShowHistory(true);
                    }}
                    onPrev={goPrev}
                    onSkipEpisode={() => setSkipConfirm(true)}
                    onExit={exitPlayer}
                    onClose={() => setMenuOpen(false)}
                  />
                )}

                {skipConfirm && (
                  <StorySkipConfirm onConfirm={skipEpisode} onCancel={() => setSkipConfirm(false)} />
                )}
              </div>

              {/* 右上角 AUTO/MENU 胶囊（E4 对照 5；--ba-tilt 微倾斜由 CSS 层统一） */}
              <StoryTopControls
                auto={auto}
                menuOpen={menuOpen}
                onToggleAuto={() => {
                  setAuto((v) => !v);
                  setSkip(false);
                }}
                onToggleMenu={() => setMenuOpen((v) => !v)}
              />

              {/* 开发模式调试信息（S-9：真机不展示 BGM 名/分支号，DEV 才渲染） */}
              {import.meta.env.DEV && (
                <div className="player-debug" data-testid="player-debug">
                  <span>{bgmName ? `BGM ${bgmName}` : '无 BGM'}</span>
                  {branchGroup && (
                    <span className="branch-badge" data-testid="branch-badge">
                      分支 {branchGroup}
                    </span>
                  )}
                  <span>
                    {idx >= 0 ? `${Math.min(idx + 1, file.nodes.length)} / ${file.nodes.length}` : '—'}
                  </span>
                </div>
              )}
              {/* 分支徽标在生产构建也要保留（e2e 契约 data-testid=branch-badge） */}
              {!import.meta.env.DEV && branchGroup && (
                <span className="branch-badge" data-testid="branch-badge">
                  分支
                </span>
              )}
            </div>
          )}
        </StackOverlay>
      ))}
    </div>
  );
}

/** 剧集列表项（主线话目横幅 / 活动章节 / 覆盖层平铺共用） */
function StoryListItem({
  entry,
  cleared,
  active,
  chapterTitle,
  recollection,
  banner,
  onOpen,
}: {
  entry: StoryEntry;
  cleared: boolean;
  active: boolean;
  chapterTitle?: string;
  recollection?: boolean;
  /** 主线话目用 Scenario_Title 横幅样式（Deco 底 + Frame 装饰框） */
  banner?: boolean;
  onOpen: () => void;
}) {
  // 剧本行标题是 "第N话;标题" 格式，分号转空格便于阅读；
  // 无名剧集（数据轨 title 以 ID 顶替，如 Vol.0 序章 11000）兜底成「剧情 #id」——走查⑥
  const raw = chapterTitle ?? entry.title;
  const title = !raw || raw === entry.id ? `剧情 #${entry.id}` : raw.replace(';', ' ');
  return (
    <button
      className={`story-item${banner ? ' story-item-banner' : ''}${active ? ' on' : ''}`}
      data-ui-source={banner ? 'assetbundle' : undefined}
      onClick={onOpen}
    >
      <b>
        {title}
        {recollection && <span className="recollection-tag">回忆</span>}
      </b>
      <span>
        {cleared && <span className="cleared">已通关 · </span>}
        {entry.lines} 句 · {entry.id.replace(/_/g, ' ').slice(0, 46)}
      </span>
    </button>
  );
}
