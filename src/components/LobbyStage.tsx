/**
 * 大厅中央的学生舞台（回忆大厅 Spine 模型）
 *
 * 与 /lobby 记忆大厅（LobbyPage）的区别：这里是嵌入大厅主界面的「看板娘」，
 * 模型之上还叠着顶栏/右侧菜单等 HUD，所以缩放与拖拽的缓存键独立（home: 前缀）。
 *
 * 交互（对照真实游戏大厅）：
 *   - 滚轮缩放 / 拖拽平移（沿用 LobbyPage 的相机语义）
 *   - 点击学生：随机 touch 语音（voices 里 *_Lobby_* 族）+ Spine 反应动画
 *     （SpineView 按 touchSignal 播 /^touch|^tap|^react|^talk/i 命中的动画，
 *     模型没有交互动画时用 CSS 微动效兜底）
 *   - 连点在 rapidWindowMs 内累计，好感度反馈浮出 ❤（写 save.momotalk.favor）
 *
 * 语音族名实测：students_slim.json voices[].desc 如 Hoshino_Lobby_1.ogg 或
 * 无后缀的 CH0139_Lobby_1，280/513 名学生有 *lobby* 族（/lobby/i 匹配）；
 * 没有该族时回退任意语音，再没有就文字提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SpineView } from './SpineView';
import { useApp } from '../core/AppContext';
import { audio } from '../core/audio';
import { store } from '../core/store';
import { HOME_STAGE } from '../core/game-ui-spec';
import type { Student } from '../types';

/** 每个模型的缩放/位移，切换学生时各自保留（与 LobbyPage 的 viewMap 互不覆盖） */
const viewMap = new Map<string, { zoom: number; panX: number; panY: number }>();

export interface LobbyStageProps {
  student: Student | null;
  /** 好感度写入 save.momotalk.favor 的 key（桃信轨的会话 key）；null 表示不累计 */
  favorKey: string | null;
  /** 语音字幕回调（大厅左下信息条用） */
  onLine?: (line: string) => void;
  /** 点击时的宿主侧回调（播放按钮 SE 等） */
  onTouch?: () => void;
  className?: string;
}

/**
 * 生成语音字幕：Hoshino_Lobby_1.ogg / CH0139_Lobby_2_1 → 「大厅语音 #2」。
 * desc 两种实测形态：带 .ogg 的 `Name_Lobby_N.ogg` 和无后缀的 `CHxxxx_Lobby_N_M`
 * （students_slim 8068 条 desc 里 4799 条含 lobby，其中 3716 条无后缀——
 * 2026-11-08 走查④：旧正则要求 .ogg 结尾导致后者全部漏配，回退池把
 * season_birthday 之类的片段名当字幕）。真实台词文本数据还没有，
 * 先用序号占位，拿到台词数据后整体替换。
 */
function lineOf(desc: string): string {
  const stem = desc.replace(/\.ogg$/i, '');
  const m = /lobby(?:[_-](\d+))?/i.exec(stem);
  if (m) return m[1] ? `♪ 大厅语音 #${m[1]}` : '♪ 大厅语音';
  // 回退池里的非大厅族（活动/生日语音等）：不把片段名当字幕，给中性占位
  return '♪ 语音片段';
}

export function LobbyStage({ student, favorKey, onLine, onTouch, className }: LobbyStageProps) {
  const { assets, toast } = useApp();
  const [view, setView] = useState({ zoom: HOME_STAGE.initialZoom.value, panX: 0, panY: 0 });
  const [spineError, setSpineError] = useState(false);
  /** 触摸信号：每次点击 +1，SpineView 据此在 track 1 播一次反应动画 */
  const [touchSignal, setTouchSignal] = useState(0);
  const [bounce, setBounce] = useState(false);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const lastTouchRef = useRef(0);
  const touchCountRef = useRef(0);
  const heartId = useRef(0);
  const bounceTimer = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // 切学生：恢复该模型上次的视角
  useEffect(() => {
    setSpineError(false);
    setView(
      (student && viewMap.get(student.home_spine)) ?? {
        zoom: HOME_STAGE.initialZoom.value,
        panX: 0,
        panY: 0,
      }
    );
  }, [student]);

  useEffect(() => {
    return () => {
      if (bounceTimer.current) window.clearTimeout(bounceTimer.current);
    };
  }, []);

  const updateView = useCallback(
    (next: { zoom: number; panX: number; panY: number }) => {
      const v = {
        zoom: Math.min(HOME_STAGE.maxZoom.value, Math.max(HOME_STAGE.minZoom.value, next.zoom)),
        panX: next.panX,
        panY: next.panY,
      };
      setView(v);
      if (student) viewMap.set(student.home_spine, v);
    },
    [student]
  );

  const onTap = useCallback(
    (clientX: number, clientY: number) => {
      if (!student) return;
      const now = Date.now();
      if (now - lastTouchRef.current < HOME_STAGE.touchCooldownMs.value) return;
      // 连点窗口：窗口外重新计数
      touchCountRef.current =
        now - lastTouchRef.current <= HOME_STAGE.rapidWindowMs.value ? touchCountRef.current + 1 : 1;
      lastTouchRef.current = now;

      // 大厅语音池：/lobby/i 且不要求 .ogg 后缀（CHxxxx_Lobby_N 无后缀形态，
      // 513 名学生里 280 名有该族）——2026-11-08 走查④
      const pool = student.voices.filter((v) => /lobby/i.test(v.desc));
      const all = pool.length > 0 ? pool : student.voices;
      if (all.length === 0) {
        onLine?.('……（这名学生没有大厅语音）');
      } else {
        const v = all[Math.floor(Math.random() * all.length)];
        if (v) {
          audio.playVoice(v.path);
          onLine?.(lineOf(v.desc));
        }
      }
      onTouch?.();

      // Spine 反应动画 + CSS 微动效兜底
      setTouchSignal((s) => s + 1);
      setBounce(true);
      if (bounceTimer.current) window.clearTimeout(bounceTimer.current);
      bounceTimer.current = window.setTimeout(() => setBounce(false), 620);

      // 好感度反馈：点击位置浮出 ❤，favor 写进桃信共享字段
      const rect = stageRef.current?.getBoundingClientRect();
      const id = ++heartId.current;
      setHearts((hs) => [
        ...hs.slice(-5),
        { id, x: rect ? clientX - rect.left : 0, y: rect ? clientY - rect.top : 0 },
      ]);
      window.setTimeout(() => setHearts((hs) => hs.filter((h) => h.id !== id)), 1100);

      if (favorKey) {
        const gain = HOME_STAGE.favorPerTouch.value;
        store.update((d) => {
          d.momotalk.favor[favorKey] = (d.momotalk.favor[favorKey] ?? 0) + gain;
        });
      }
    },
    [student, favorKey, onLine, onTouch]
  );

  if (!student) return null;

  const spineRes = student.home_spine ? assets.spineByName(student.home_spine) : null;

  return (
    <div
      ref={stageRef}
      className={[className, 'ls-stage', bounce ? 'ls-bounce' : ''].filter(Boolean).join(' ')}
      onWheel={(e) => {
        updateView({
          ...view,
          zoom: view.zoom * (e.deltaY > 0 ? 1 / HOME_STAGE.zoomStep.value : HOME_STAGE.zoomStep.value),
        });
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
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
      onClick={(e) => {
        // 拖拽结束不算点击
        if (dragRef.current?.moved) return;
        onTap(e.clientX, e.clientY);
      }}
    >
      {spineRes && !spineError ? (
        <SpineView
          key={`home-${student.home_spine}`}
          skelUrl={spineRes.skel}
          atlasUrl={spineRes.atlas}
          zoom={view.zoom}
          panX={view.panX}
          panY={view.panY}
          fit="cover"
          anchorX={HOME_STAGE.anchorX.value}
          anchorY={HOME_STAGE.anchorY.value}
          touchSignal={touchSignal}
          onError={(m) => {
            setSpineError(true);
            toast(`Spine 渲染失败：${m}`);
          }}
        />
      ) : (
        <div className="ls-fallback" data-ui-source="css-fallback">
          {student.avatar ? <img src={student.avatar} alt={student.name} draggable={false} /> : null}
          <span>{spineError ? '该模型无法渲染' : '未找到回忆大厅模型'}</span>
        </div>
      )}

      {hearts.map((h) => (
        <span key={h.id} className="ls-heart" style={{ left: h.x, top: h.y }}>
          ♥
        </span>
      ))}
    </div>
  );
}
