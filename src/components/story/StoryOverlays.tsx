/**
 * StoryOverlays — 剧情播放器的演出覆盖层集合（S-3 / S-4 / S-5 / E6）
 *
 * 数据轨 op → 演出映射（全部为重生成节点实测形态，2026-11-10）：
 *   subtitle {on,text,raw}  → StoryTelop      顶部/底部字幕条（[RRGGBB]..[-] 简单上色）
 *   place {text}            → StoryTelop      地点字幕（顶部样式）
 *   transition {out,in,...} → StoryTransition 全屏遮罩转场（fade 黑 / fade_white 白闪 /
 *                                              bgoverlap 由背景双层交叉淡入承担，不再遮罩）
 *   bgShake                 → .player-stage 屏震动画（父级挂 class，本文件不给组件）
 *   popup {cg}              → StoryCg         全屏 CG 图层，持续至下一背景切换（淡入淡出）
 *   memlobby                → StoryUnlock     回忆大厅解锁横幅（真机样式：金底居中横幅）
 *   结束                    → StoryEndCard    「本集完」标题卡（E6，替换深蓝弹窗）
 *   S-5                     → StorySkipConfirm 「跳过本集」确认弹窗（真机文案）
 *
 * CG 素材：resources/images/cg/（574 文件，popup 唯一名 453 命中 64——缺失按
 * 「有则显示、无则静默」降级，不伪造。jpg/png 双探针预加载，避免 404 刷控制台。
 */
import { useEffect, useState, type CSSProperties } from 'react';

/** [FF6666]…[-] 简单上色解析 → span 数组（telop 字幕用） */
function parseColored(text: string): { t: string; color?: string }[] {
  const out: { t: string; color?: string }[] = [];
  const re = /\[([0-9A-Fa-f]{6})\]([\s\S]*?)\[-\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    out.push({ t: m[2], color: `#${m[1]}` });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

export interface StoryTelopProps {
  /** 字幕文本（空串隐藏） */
  text: string;
  /** place（地点）= 顶部白字带侧线；subtitle = 底部大字幕（默认顶部） */
  variant?: 'place' | 'subtitle';
}

/** 字幕条（S-4 telop）：时间/地点/旁白字幕，白字+阴影，淡入淡出 */
export function StoryTelop({ text, variant = 'subtitle' }: StoryTelopProps) {
  if (!text) return null;
  const parts = parseColored(text);
  return (
    <div className={`story-telop story-telop-${variant}`} data-ui-source="script-op">
      {parts.map((p, i) => (
        <span key={i} style={p.color ? { color: p.color } : undefined}>
          {p.t}
        </span>
      ))}
    </div>
  );
}

export interface StoryTransitionProps {
  /** 转场类型：黑淡入淡出 / 白闪 / 无（bgoverlap 由背景双层承担） */
  fx: 'fade' | 'fade_white' | null;
  /** 遮罩可见性由父级在转场窗口期内置 true */
  active: boolean;
}

/** 转场遮罩（S-4）：fade=黑、fade_white=白闪，动画时长跟随 op 的 outDuration+inDuration */
export function StoryTransition({ fx, active }: StoryTransitionProps) {
  if (!fx || !active) return null;
  return (
    <div
      className={`story-transition story-transition-${fx}`}
      data-testid="story-transition"
      data-ui-source="script-op"
    />
  );
}

export interface StoryCgProps {
  /** CG 资源名（popup 节点的 cg 字段，如 popup215）；null=无 CG */
  cg: string | null;
}

/** 全屏 CG 图层（S-3）：淡入显示、持续到下一个背景切换（父级清 cg），图片加载失败静默 */
export function StoryCg({ cg }: StoryCgProps) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cg) {
      setUrl(null);
      return;
    }
    // 三源预加载探测（实测 popup 唯一名 453 双源命中 440 = 97%，2026-11-10）：
    //   ① /res/images/cg/{name}.jpg —— 画廊轨 574 文件（BG_* 系列为主）
    //   ② /res/images/cg/{name}.png —— 同目录 png 少量
    //   ③ /res/ui/extra3/UIs/03_Scenario/04_ScenarioImage/{name}.png —— CDN
//     轨 502 文件（popup*/Event* 系列，保留原目录结构）
    // 全 miss（13/453）静默不显示，不伪造。
    let alive = true;
    const probe = (u: string) =>
      new Promise<string | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(u);
        img.onerror = () => resolve(null);
        img.src = u;
      });
    void (async () => {
      const hit =
        (await probe(`/res/images/cg/${cg}.jpg`)) ??
        (await probe(`/res/images/cg/${cg}.png`)) ??
        (await probe(`/res/ui/extra3/UIs/03_Scenario/04_ScenarioImage/${cg}.png`));
      if (alive) setUrl(hit);
    })();
    return () => {
      alive = false;
    };
  }, [cg]);
  if (!cg || !url) return null;
  return (
    <div className="story-cg" data-testid="story-cg" data-ui-source="assetbundle" style={{ backgroundImage: `url(${url})` }}>
      <span className="story-cg-tag">CG</span>
    </div>
  );
}

export interface StoryUnlockProps {
  /** 解锁横幅文案（含学生名时由父级拼好）；空隐藏 */
  text: string;
}

/** 回忆大厅解锁横幅（S-3 memlobby → 真机样式横幅） */
export function StoryUnlock({ text }: StoryUnlockProps) {
  if (!text) return null;
  return (
    <div className="story-unlock-banner" data-testid="story-unlock" data-ui-source="script-op">
      <span className="story-unlock-star">★</span>
      <span>{text}</span>
    </div>
  );
}

export interface StorySkipConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/** 「跳过本集」确认弹窗（S-5，真机文案样式：半透明深底 + 白板 + 左右双按钮） */
export function StorySkipConfirm({ onConfirm, onCancel }: StorySkipConfirmProps) {
  return (
    <div className="story-skip-confirm" data-testid="story-skip-confirm" onClick={(e) => e.stopPropagation()}>
      <div className="story-skip-card" data-ui-source="css">
        <b>跳过本集</b>
        <p>跳过本集将直接进行到结尾并结算通关奖励。</p>
        <p>确定要跳过吗？</p>
        <div className="story-skip-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={onConfirm} data-testid="story-skip-confirm-yes">
            跳过
          </button>
        </div>
      </div>
    </div>
  );
}

export interface StoryEndCardProps {
  title: string;
  /** 是否本集首次通关（标题卡上标注奖励） */
  cleared: boolean;
  onReplay: () => void;
  onExit: () => void;
}

/** 「本集完」标题卡（E6：黑场渐显 + 居中标题，替换深蓝弹窗） */
export function StoryEndCard({ title, cleared, onReplay, onExit }: StoryEndCardProps) {
  return (
    <div className="story-end-card" data-testid="story-end" onClick={(e) => e.stopPropagation()}>
      <div className="story-end-inner" data-ui-source="css">
        <span className="story-end-rule" />
        <b className="story-end-title">本集完</b>
        <span className="story-end-sub">{title}</span>
        <span className="story-end-rule" />
        {cleared && <span className="story-end-clear">已通关</span>}
        <div className="story-end-actions">
          <button type="button" onClick={onReplay}>
            重新播放
          </button>
          <button type="button" className="primary" onClick={onExit} data-testid="story-end-exit">
            返回选择页
          </button>
        </div>
      </div>
    </div>
  );
}

/** 演出状态包：StoryPage 用 op 扫描累积、整包传给覆盖层 */
export interface StoryFxState {
  /** telop：subtitle 文本 / place 文本 */
  subtitle: string;
  place: string;
  /** 转场：进行中的转场类型与起止时间戳 */
  transitionFx: 'fade' | 'fade_white' | null;
  transitionUntil: number;
  /** 全屏 CG（popup.cg，持续至下一背景切换） */
  cg: string | null;
  /** 回忆大厅解锁横幅（memlobby，推进后消失） */
  unlock: string;
}

export const EMPTY_FX: StoryFxState = {
  subtitle: '',
  place: '',
  transitionFx: null,
  transitionUntil: 0,
  cg: null,
  unlock: '',
};

/** 屏震触发器：返回挂到 .player-stage 的 class（S-4 bgShake，600ms 后由父级清除） */
export function shakeClass(on: boolean): string {
  return on ? ' stage-shake' : '';
}

/** 白闪遮罩用的通用淡入淡出样式（transition 组件内部已带，这里留给扩展） */
export const TRANSITION_BASE_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 8,
};
