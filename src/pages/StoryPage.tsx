import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, navState } from '../core/AppContext';
import { audio } from '../core/audio';
import { loadStoryFile } from '../core/assets';
import { markRead, STORY_CLEAR_REWARD, store, useSave } from '../core/store';
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
  type ActorState,
  type StagePos,
} from '../components/story/storyStage';
import { StoryDialog } from '../components/story/StoryDialog';
import { StoryChoices } from '../components/story/StoryChoices';
import { StoryHistory, type HistoryRow } from '../components/story/StoryHistory';
import { StoryPortrait } from '../components/story/StoryPortrait';

type Tab = 'all' | 'main' | 'bond' | 'event' | 'group';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'main', label: '主线' },
  { key: 'bond', label: '羁绊' },
  { key: 'event', label: '活动' },
  { key: 'group', label: '社团' },
];

// ---------------------------------------------------------------- 主线卷→章分组（data/main_story_map.json，本轨交付）
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

/** 卷头装饰横幅（resources/ui/extra/Scenario_Title_Deco.png，uis-03_scenario 官方切片） */
const VOLUME_HEAD_DECO = '/res/ui/extra/Scenario_Title_Deco.png';


interface Line {
  speaker: string;
  text: string;
  kind: 'say' | 'info' | 'mark' | 'choice';
}

function opText(n: StoryOp): Line | null {
  if (n.op === 'script') {
    const s = n as Extract<StoryOp, { op: 'script' }>;
    return { speaker: s.speaker, text: s.text, kind: 'say' };
  }
  if (n.op === 'info') return { speaker: '', text: (n as { text: string }).text, kind: 'info' };
  if (n.op === 'choice') return null; // choice 由分支状态机单独渲染
  if (n.op === 'memlobby')
    return { speaker: '', text: '★ 此处解锁该学生的回忆大厅', kind: 'mark' };
  if (n.op === 'popup') return { speaker: '', text: '（剧情插图）', kind: 'mark' };
  return null;
}

/** 可停下来的节点（对话框或选择点） */
function isDisplayable(n: StoryOp): boolean {
  return Boolean(opText(n)) || (n.op === 'choice' && ((n as { options?: StoryChoiceOption[] }).options?.length ?? 0) > 0);
}

function branchOf(n: StoryOp): string | undefined {
  // 分支段 = 选项后 selection_group==N 的连续行（数据轨契约），script/info 都可能带
  // branch 字段（实测 11000 choice@152 的分支落点是 info 节点——此前只认 script，
  // info 分支行会被当主线节点显示/搜不到，徽标失效）
  if (n.op !== 'script' && n.op !== 'info') return undefined;
  const b = (n as { branch?: unknown }).branch;
  return typeof b === 'string' ? b : undefined;
}

export default function StoryPage() {
  const { assets, toast } = useApp();
  const save = useSave();

  const [tab, setTab] = useState<Tab>('main');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<StoryEntry | null>(null);
  const [file, setFile] = useState<StoryFile | null>(null);
  const [idx, setIdx] = useState(-1);
  const [line, setLine] = useState<Line | null>(null);
  const [choice, setChoice] = useState<{ index: number; options: StoryChoiceOption[] } | null>(null);
  const [branchGroup, setBranchGroup] = useState<string | null>(null);
  const [actors, setActors] = useState<ActorState[]>([]);
  const [failedActors, setFailedActors] = useState<string[]>([]);
  const [bgName, setBgName] = useState('');
  const [bgmName, setBgmName] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [auto, setAuto] = useState(false);
  const [skip, setSkip] = useState(false);
  const [typed, setTyped] = useState(0);
  const [ended, setEnded] = useState(false);

  // 活动剧情分组（data/event_story_map.json，数据轨交付；缺失时活动 tab 退回平铺）
  const [eventGroups, setEventGroups] = useState<EventStoryGroup[] | null>(null);
  // 主线卷→章分组（data/main_story_map.json，本轨交付；缺失时主线 tab 退回平铺）
  const [mainMap, setMainMap] = useState<MainVolume[] | null>(null);
  // 对话框上沿到舞台底部的高度（立绘底部与其对齐，见 StoryPortrait.bottomInset）
  const [dialogH, setDialogH] = useState(172);

  const typingRef = useRef<number | null>(null);
  const autoTimer = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const actorsRef = useRef<ActorState[]>([]);
  /** 说话人 -> 立绘资源/学生档案（openStory 时一次性解析） */
  const resourcesRef = useRef<Map<string, ReturnType<typeof resolveActor>>>(new Map());
  const branchRef = useRef<string | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.storyIndex
      .filter((s) => tab === 'all' || s.type === tab)
      // 空集（0 句，实测 31 个：10000000、1901702…）不可播，真实游戏不列出——走查⑥
      .filter((s) => s.lines > 0)
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 400);
  }, [assets.storyIndex, tab, query]);

  // 活动分组数据：首次进入剧情页时拉一次（404 静默，退回平铺）
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

  // 主线卷章数据：首次进入剧情页时拉一次（404 静默，主线 tab 退回平铺）
  useEffect(() => {
    if (mainMap) return;
    let alive = true;
    fetch('/data/main_story_map.json')
      .then((r) => (r.ok ? (r.json() as Promise<MainVolume[]>) : null))
      .then((d) => {
        if (alive) setMainMap(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (alive) setMainMap([]);
      });
    return () => {
      alive = false;
    };
  }, [mainMap]);

  /** 活动 tab 的分组视图：活动名+周期做组头，章节按 order 排列 */
  const eventSections = useMemo(() => {
    if (tab !== 'event' || !eventGroups) return null;
    const byId = new Map(assets.storyIndex.map((s) => [s.id, s]));
    const used = new Set<string>();
    type SectionItem = { entry: StoryEntry; chapter?: EventChapter };
    const sections = eventGroups
      .map((g, gi) => {
        const items = [...g.chapters]
          .sort((a, b) => a.order - b.order)
          .map((ch: EventChapter): SectionItem | null => {
            used.add(ch.storyId);
            const e = byId.get(ch.storyId);
            // 0 句的空章节同样不列出（与平铺列表一致）——走查⑥
            return e && e.lines > 0 ? { entry: e, chapter: ch } : null;
          })
          .filter((x): x is SectionItem => x !== null);
        const period = g.period
          ? `${fmtPeriod(g.period.start)} ~ ${fmtPeriod(g.period.end)}`
          : '';
        return {
          key: `ev-${g.eventId}-${gi}`,
          header: g.name ?? `活动剧情 #${g.eventId}`,
          sub: period,
          items,
        };
      })
      .filter((s) => s.items.length > 0);
    const rest = assets.storyIndex.filter(
      (s) => s.type === 'event' && s.lines > 0 && !used.has(s.id) && !(s.events && s.events.length > 0)
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
  }, [tab, eventGroups, assets.storyIndex]);

  const fullText = line?.text ?? '';
  const isTyping = typed < fullText.length;

  /**
   * 主线 tab 的卷→章两级视图：
   * 卷头 = Vol 标签+卷名（Scenario_Title_Deco 横幅），章头 = 第N章+話数范围，章内集列表。
   * 搜索命中卷名时整卷列出，命中集标题/ID 时逐集过滤；0 句集不可播不列出（与走查⑥一致）。
   */
  const mainSections = useMemo(() => {
    if (tab !== 'main' || !mainMap) return null;
    const q = query.trim().toLowerCase();
    return mainMap
      .map((vol) => {
        const volMatch =
          !q ||
          vol.name.toLowerCase().includes(q) ||
          vol.label.toLowerCase().includes(q) ||
          (vol.nameEn ? vol.nameEn.toLowerCase().includes(q) : false);
        const chapters = vol.chapters
          .map((ch) => {
            const items = ch.episodes
              .filter((e) => e.lines > 0)
              .filter((e) => volMatch || !q || e.title.toLowerCase().includes(q) || e.id.includes(q))
              .map((e) => ({ entry: mainEpisodeToEntry(e) }));
            return { key: `mc-${vol.volume}-${ch.chapter}`, chapter: ch, items };
          })
          .filter((ch) => ch.items.length > 0);
        return {
          key: `mv-${vol.volume}`,
          volume: vol,
          count: chapters.reduce((a, ch) => a + ch.items.length, 0),
          chapters,
        };
      })
      .filter((v) => v.chapters.length > 0);
  }, [tab, mainMap, query]);
  const mainCount = mainSections?.reduce((a, v) => a + v.count, 0) ?? 0;

  // 对话框高度测量：立绘底部对齐对话框上沿（.player-dialog 挂载/内容变化都会改高度）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const el = stage.querySelector<HTMLElement>('.player-dialog');
    if (!el) return; // 选项层/结束层顶替时保持上一次的对齐，不跳动
    const update = () => setDialogH(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [file, line, choice, ended, showHistory]);

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
   */
  const scan = useCallback(
    (
      f: StoryFile,
      start: number,
      dir: 1 | -1,
      ctx: string | null,
      silent = false
    ): { index: number; line: Line | null; isChoice: boolean; bg: string; bgm: string } => {
      let i = start;
      let bg = '';
      let bgm = '';
      while (i >= 0 && i < f.nodes.length) {
        const n = f.nodes[i] as StoryOp;
        if (n.op === 'background') bg = (n as { bg: string }).bg;
        else if (n.op === 'bgm') bgm = (n as { id: string }).id;
        else if (n.op === 'bgmStop') bgm = '';
        else if (n.op === 'se' && !silent) audio.playSe((n as { id: string }).id);
        else if (n.op === 'choice') {
          const options = (n as { options?: StoryChoiceOption[] }).options ?? [];
          if (options.length > 0) return { index: i, line: null, isChoice: true, bg, bgm };
        } else if (isDisplayable(n)) {
          const br = branchOf(n);
          if (dir === 1) {
            if (br !== undefined) {
              if (ctx && br === ctx) return { index: i, line: opText(n), isChoice: false, bg, bgm };
              i += dir; // 其他分支 / 无上下文：跳过
              continue;
            }
            // 无 branch 字段 = 主线节点（ctx 存在时意味着分支段结束，由调用者清 ctx）
            return { index: i, line: opText(n), isChoice: false, bg, bgm };
          } else {
            if (br !== undefined) {
              if (ctx && br === ctx) return { index: i, line: opText(n), isChoice: false, bg, bgm };
              i += dir; // 分支段整段跳过，回退直接落 choice 或更早主线
              continue;
            }
            return { index: i, line: opText(n), isChoice: false, bg, bgm };
          }
        }
        i += dir;
      }
      return { index: -1, line: null, isChoice: false, bg, bgm };
    },
    []
  );

  const applyNode = useCallback(
    (f: StoryFile, target: number, dir: 1 | -1) => {
      // 先静默重放到目标前一格，重建背景与 BGM（副作用逻辑与旧版一致）
      let bg = '';
      let bgm = '';
      for (let i = 0; i < target; i++) {
        const n = f.nodes[i] as StoryOp;
        if (n.op === 'background') bg = (n as { bg: string }).bg;
        else if (n.op === 'bgm') bgm = (n as { id: string }).id;
        else if (n.op === 'bgmStop') bgm = '';
      }
      const ctx = branchRef.current;
      const r = scan(f, target, dir, ctx);
      const finalBg = r.bg || bg;
      const finalBgm = r.bgm || bgm;
      setBgName(finalBg);
      setBgmName(finalBgm);
      if (finalBgm) audio.playBgm(finalBgm);
      else audio.stopBgm();

      if (r.index === -1) {
        setEnded(true);
        setIdx(f.nodes.length);
        setChoice(null);
        branchRef.current = null;
        setBranchGroup(null);
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
        const s = n as Extract<StoryOp, { op: 'script' }>;
        const who = s.spine || s.speaker || '';
        const expr = parseExpression(s.sequence);
        const upd = applySpeaker(actorsRef.current, who, expr, resourcesRef.current);
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
      });
    },
    [scan, save.story.cleared, skip, toast]
  );

  const openStory = useCallback(
    async (entry: StoryEntry) => {
      setSelected(entry);
      setLine(null);
      setChoice(null);
      setHistory([]);
      setEnded(false);
      actorsRef.current = [];
      setActors([]);
      setFailedActors([]);
      branchRef.current = null;
      setBranchGroup(null);
      try {
        const f = await loadStoryFile(entry.path);
        setFile(f);
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
      }
    },
    [applyNode, assets, save.story.progress, toast]
  );

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
    if (isTyping) {
      setTyped(fullText.length);
      return;
    }
    if (ended) return;
    applyNode(file, idx + 1, 1);
  }, [file, choice, idx, isTyping, fullText.length, ended, applyNode]);

  // 自动 / 快进（保留原有行为；选项出现时暂停等待）
  useEffect(() => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    if (!auto || !file || ended || showHistory || choice) return;
    if (isTyping) return;
    autoTimer.current = window.setTimeout(() => {
      advance();
    }, save.settings.autoDelay);
    return () => {
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
  }, [auto, file, ended, isTyping, idx, choice, advance, save.settings.autoDelay, showHistory]);

  // 快进只跳已读节点（保留原有行为；选项与分支停快进）
  useEffect(() => {
    if (!skip || !file || ended || choice) return;
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
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
  }, []);

  // 消费来自桃信 / 活动页的跳转参数
  useEffect(() => {
    if (navState.pendingStoryId) {
      const entry = assets.storyIndex.find((s) => s.id === navState.pendingStoryId);
      navState.pendingStoryId = null;
      if (entry) {
        setTab(entry.type);
        void openStory(entry);
      }
      return;
    }
    if (navState.pendingStoryQuery) {
      setTab('all');
      setQuery(navState.pendingStoryQuery);
      navState.pendingStoryQuery = null;
    }
  }, [assets.storyIndex, openStory]);

  const bgUrl = bgName ? assets.bg(bgName) : null;
  const stageSpeaker = line?.kind === 'say' ? line.speaker : '';
  /** 当前说话人是否在舞台上有立绘（决定对话框角落头像是否显示） */
  const onStage = stageSpeaker ? actors.some((a) => a.key === stageSpeaker && a.resource) : false;
  const cornerAvatar =
    line?.kind === 'say' && !onStage
      ? (resourcesRef.current.get(stageSpeaker)?.student?.avatar ?? null)
      : null;

  return (
    <div className="story-layout">
      <div className="story-side">
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索剧集标题…"
          style={{
            padding: '8px 13px',
            borderRadius: 9,
            border: '1px solid var(--line)',
            outline: 'none',
            background: '#fff',
          }}
        />
        <div className="muted" style={{ fontSize: 11.5 }}>
          {tab === 'main' && mainSections
            ? `共 ${mainCount} 集`
            : `共 ${assets.storyIndex.filter((s) => (tab === 'all' || s.type === tab) && s.lines > 0).length} 集`}
        </div>
        <div className="story-list" data-testid="story-list">
          {tab === 'main' && mainSections
            ? mainSections.map((vol) => (
                <div key={vol.key} className="story-volume" data-volume={vol.volume.volume}>
                  <div
                    className="story-volume-head"
                    style={{
                      backgroundImage: `linear-gradient(rgba(255,255,255,0.42), rgba(255,255,255,0.42)), url(${VOLUME_HEAD_DECO})`,
                    }}
                  >
                    <b>
                      {vol.volume.label} {vol.volume.name}
                    </b>
                    {vol.volume.nameEn && <span className="en">{vol.volume.nameEn}</span>}
                    <span>{vol.count} 集</span>
                  </div>
                  {vol.chapters.map((ch) => (
                    <div key={ch.key} className="story-chapter">
                      <div className="story-chapter-head">
                        <b>{ch.chapter.name}</b>
                        {ch.chapter.side && <span className="side-tag">番外</span>}
                        <span>
                          {ch.chapter.range} · {ch.items.length} 集
                        </span>
                      </div>
                      {ch.items.map(({ entry }) => (
                        <StoryListItem
                          key={entry.id}
                          entry={entry}
                          cleared={save.story.cleared.includes(entry.id)}
                          active={selected?.id === entry.id}
                          onOpen={() => void openStory(entry)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))
            : tab === 'event' && eventSections
            ? eventSections.map((sec) => (
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
              ))
            : list.map((s) => (
                <StoryListItem
                  key={s.id}
                  entry={s}
                  cleared={save.story.cleared.includes(s.id)}
                  active={selected?.id === s.id}
                  onOpen={() => void openStory(s)}
                />
              ))}
        </div>
      </div>

      <div className="player">
        <div className="player-stage" onClick={advance} data-testid="player-stage" ref={stageRef}>
          <div
            className={`player-bg${bgUrl ? '' : ' missing'}`}
            data-name={bgName ? `素材缺失：${bgName}` : ''}
            style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
          />

          {/* 立绘层：入场滑入、说话人高亮放大、非说话人压暗微缩；
              底部对齐对话框上沿（--dialog-h + StoryPortrait.bottomInset 同源）；
              资源缺失降级头像/名字牌 */}
          <div className="story-actors" style={{ ['--dialog-h' as never]: `${dialogH}px` }}>
            {actors.map((a) => (
              <div key={a.key} className={`story-actor story-actor-${a.pos}${a.active ? ' active' : ''}`}>
                {a.resource && !failedActors.includes(a.key) ? (
                  <PortraitWithFallback
                    actorKey={a.key}
                    resource={a.resource}
                    expression={a.expression}
                    pos={a.pos}
                    speaking={a.active}
                    bottomInset={dialogH}
                    dim={!a.active}
                    onFail={(k) =>
                      setFailedActors((prev) => (prev.includes(k) ? prev : [...prev, k]))
                    }
                  />
                ) : a.student?.avatar || a.resource?.student?.avatar ? (
                  <div className="story-actor-avatar" data-actor={a.key}>
                    <img src={a.student?.avatar ?? a.resource?.student?.avatar ?? ''} alt={a.displayName} />
                  </div>
                ) : (
                  <div className="story-actor-nameplate" data-actor={a.key}>
                    {a.displayName}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!file && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: '#7f9cb3',
                fontSize: 13,
                letterSpacing: 2,
              }}
            >
              从左侧选择一集剧情开始播放
            </div>
          )}

          {file && choice && <StoryChoices options={choice.options} onSelect={selectChoice} />}

          {file && line && !choice && (
            <StoryDialog
              kind={line.kind}
              speaker={line.speaker}
              text={line.text}
              typed={typed}
              isTyping={isTyping}
              ended={ended}
              auto={auto}
              skip={skip}
              cornerAvatar={cornerAvatar}
              onToggleAuto={() => {
                setAuto((v) => !v);
                setSkip(false);
              }}
              onToggleSkip={() => {
                setSkip((v) => !v);
                setAuto(false);
              }}
              onOpenHistory={() => setShowHistory(true)}
            />
          )}

          {file && ended && (
            <div className="choice-box" onClick={(e) => e.stopPropagation()}>
              <div
                style={{
                  background: 'rgba(10,24,38,0.9)',
                  color: '#dff0fb',
                  padding: '22px 26px',
                  borderRadius: 12,
                  textAlign: 'center',
                }}
              >
                <b style={{ fontSize: 16, letterSpacing: 2 }}>本集结束</b>
                <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    className="btn sm"
                    onClick={() => {
                      setEnded(false);
                      setIdx(-1);
                      setLine(null);
                      setChoice(null);
                      setHistory([]);
                      actorsRef.current = [];
                      setActors([]);
                      branchRef.current = null;
                      setBranchGroup(null);
                      applyNode(file, 0, 1);
                    }}
                  >
                    重播
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setFile(null);
                      setSelected(null);
                      setLine(null);
                      setChoice(null);
                      audio.stopBgm();
                    }}
                  >
                    返回列表
                  </button>
                </div>
              </div>
            </div>
          )}

          {showHistory && <StoryHistory rows={history} onClose={() => setShowHistory(false)} />}
        </div>

        <div className="player-bar">
          <button
            onClick={() => {
              if (!file || choice || idx <= 0) return;
              applyNode(file, idx - 1, -1);
            }}
          >
            上一句
          </button>
          <button onClick={advance}>下一句</button>
          <div className="spacer" />
          <span style={{ opacity: 0.65 }}>{bgmName ? `BGM ${bgmName}` : '无 BGM'}</span>
          {branchGroup && (
            <span className="branch-badge" data-testid="branch-badge">
              分支 {branchGroup}
            </span>
          )}
          <div className="progress" title="进度">
            <i
              style={{
                width:
                  file && idx >= 0 ? `${Math.min(100, ((idx + 1) / file.nodes.length) * 100)}%` : '0%',
              }}
            />
          </div>
          <span style={{ opacity: 0.65, minWidth: 62, textAlign: 'right' }}>
            {file && idx >= 0 ? `${Math.min(idx + 1, file.nodes.length)} / ${file.nodes.length}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 立绘包装：加载失败上报，父级降级头像 */
function PortraitWithFallback({
  actorKey,
  resource,
  expression,
  pos,
  speaking,
  bottomInset,
  dim,
  onFail,
}: {
  actorKey: string;
  resource: NonNullable<ReturnType<typeof resolveActor>['resource']>;
  expression: string | null;
  pos: StagePos;
  /** 是否正在说话：说话播表情差分，停了回落 Idle_01 */
  speaking: boolean;
  /** 对话框上沿到舞台底部的距离（css px）：立绘脚底对齐这条线 */
  bottomInset: number;
  dim: boolean;
  onFail: (key: string) => void;
}) {
  return (
    <StoryPortrait
      skelUrl={resource.skel}
      atlasUrl={resource.atlas}
      expression={expression}
      pos={pos}
      speaking={speaking}
      bottomInset={bottomInset}
      dim={dim}
      onFail={() => onFail(actorKey)}
    />
  );
}

/** 侧栏列表项（普通条目 / 活动章节条目共用） */
function StoryListItem({
  entry,
  cleared,
  active,
  chapterTitle,
  recollection,
  onOpen,
}: {
  entry: StoryEntry;
  cleared: boolean;
  active: boolean;
  chapterTitle?: string;
  recollection?: boolean;
  onOpen: () => void;
}) {
  // 剧本行标题是 "第N话;标题" 格式，分号转空格便于阅读（主线卷章/活动章节/平铺通用）；
  // 无名剧集（数据轨 title 以 ID 顶替，如 Vol.0 序章 11000）兜底成「剧情 #id」——走查⑥
  const raw = chapterTitle ?? entry.title;
  const title = !raw || raw === entry.id ? `剧情 #${entry.id}` : raw.replace(';', ' ');
  return (
    <button className={`story-item${active ? ' on' : ''}`} onClick={onOpen}>
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
