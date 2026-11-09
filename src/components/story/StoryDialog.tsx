/**
 * StoryDialog — 剧情对话框 + 右上控制胶囊（E4 裁决② / E3 / S-9）
 *
 * 形制以报告二对照 5 原版截图为准（裁决②，2026-11-10 重构）：
 *   - 深色半透明圆角横板（rgba 深蓝黑底 + 大圆角），不是白蓝底板图；
 *   - 名字白色粗体直接在框内左上（不再用 Dialogue_Event_Background 名字牌图）；
 *   - 正文白色，右下蓝色 ▼ 闪烁（纯三角指示）；
 *   - 整体 UI 微倾斜约 -1.5°（舞台轨全局变量 --ba-tilt）；
 *   - AUTO / MENU 两枚胶囊挂在播放器右上角（不再平铺框内右下）；
 *   - Scenario_Mode_Bg_3 白蓝底板按裁决②移作主线选择页横幅素材（StoryPage）。
 *
 * MENU 弹层承载：回看(LOG)/逐句快进(辅助)/上一句/跳过本集/退出——真机 MENU
 * 是剧情菜单的入口，具体项按本播放器已有能力收敛；跳过本集走独立确认弹窗（S-5）。
 *
 * 降级链不变：说话人不在舞台上（无立绘资源）时显示头像（data-ui-source 标注）。
 */
import type { CSSProperties } from 'react';

export interface StoryDialogProps {
  kind: 'say' | 'info' | 'mark' | 'choice';
  speaker: string;
  text: string;
  /** 打字机已输出字符数 */
  typed: number;
  isTyping: boolean;
  /** 无立绘资源时对话框角落显示的学生头像 url（有立绘时留空） */
  cornerAvatar?: string | null;
  /** info/mark 行的标签（旁白/提示） */
  kindLabel?: string;
}

export function StoryDialog({ kind, speaker, text, typed, isTyping, cornerAvatar, kindLabel }: StoryDialogProps) {
  const shown = text.slice(0, typed);
  const label = kindLabel ?? (kind === 'mark' ? '提示' : kind === 'choice' ? '选项' : '旁白');
  // 数据轨个别行的 speaker 字段混入了未翻译的整句台词（实测 11000 首句为韩文
  // 长串）。真机名字是短标签——超过 24 字符的 speaker 不再渲染为名字（正文已
  // 完整承载内容，不伪造名字，如实省略）。
  const cleanSpeaker = speaker && speaker.length <= 24 ? speaker : '';
  return (
    <div className="player-dialog" data-testid="story-dialog" data-ui-source="css">
      {cornerAvatar && (
        <img className="dialog-corner-avatar" src={cornerAvatar} alt="" loading="lazy" data-ui-source="assetbundle" />
      )}
      {kind === 'say' ? (
        cleanSpeaker ? (
          <span className="speaker">{cleanSpeaker}</span>
        ) : null
      ) : (
        <span className="speaker info">{label}</span>
      )}
      <div className="text">
        {shown}
        {isTyping && <span className="type-cursor">▍</span>}
      </div>
      {!isTyping && <span className="next" aria-label="点击继续">▼</span>}
    </div>
  );
}

/** 右上角胶囊样式（AUTO/MENU 同构，白底深字斜体——对照 5 形制） */
const CAPSULE: CSSProperties = {
  appearance: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '6px 22px',
  borderRadius: 999,
  background: 'rgba(240, 248, 253, 0.82)',
  color: '#2d4a63',
  fontSize: 15,
  fontStyle: 'italic',
  fontWeight: 650,
  letterSpacing: 2,
  fontFamily: 'var(--font-en, "Bender", "Jost", sans-serif)',
  boxShadow: '0 2px 10px rgba(10, 30, 50, 0.35)',
  transition: 'background 0.14s, color 0.14s',
};

export interface StoryTopControlsProps {
  auto: boolean;
  onToggleAuto: () => void;
  onToggleMenu: () => void;
  /** MENU 弹层打开时高亮 */
  menuOpen: boolean;
}

/** 播放器右上角 AUTO/MENU 两胶囊（对照 5：白色半透明底 + 深色斜体字） */
export function StoryTopControls({ auto, onToggleAuto, onToggleMenu, menuOpen }: StoryTopControlsProps) {
  return (
    <div className="player-top-controls" role="group" aria-label="播放控制">
      <button
        type="button"
        className={`capsule${auto ? ' on' : ''}`}
        style={auto ? { ...CAPSULE, background: 'rgba(63, 159, 224, 0.92)', color: '#fff' } : CAPSULE}
        data-testid="story-auto-btn"
        title="自动播放 (AUTO)"
        onClick={(e) => {
          e.stopPropagation();
          onToggleAuto();
        }}
      >
        AUTO
      </button>
      <button
        type="button"
        className={`capsule${menuOpen ? ' on' : ''}`}
        style={menuOpen ? { ...CAPSULE, background: 'rgba(63, 159, 224, 0.92)', color: '#fff' } : CAPSULE}
        data-testid="story-menu-btn"
        title="剧情菜单 (MENU)"
        onClick={(e) => {
          e.stopPropagation();
          onToggleMenu();
        }}
      >
        MENU
      </button>
    </div>
  );
}

export interface StoryMenuPanelProps {
  skip: boolean;
  onToggleSkip: () => void;
  onOpenHistory: () => void;
  onPrev: () => void;
  /** 「跳过本集」：弹确认后直接置末尾并结算通关奖励（S-5） */
  onSkipEpisode: () => void;
  onExit: () => void;
  onClose: () => void;
}

/** MENU 弹层：本播放器的全部控制收敛于此（对话框右下方只留 ▼） */
export function StoryMenuPanel({ skip, onToggleSkip, onOpenHistory, onPrev, onSkipEpisode, onExit, onClose }: StoryMenuPanelProps) {
  return (
    <div
      className="story-menu-panel"
      data-testid="story-menu-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" data-testid="story-log-btn" onClick={onOpenHistory}>
        回看 <span className="en">LOG</span>
      </button>
      <button type="button" data-testid="story-prev-btn" onClick={onPrev}>
        上一句
      </button>
      <button type="button" data-testid="story-skip-btn" className={skip ? 'on' : ''} onClick={onToggleSkip}>
        {skip ? '停止快进' : '快进至未读'} <span className="en">SKIP</span>
      </button>
      <button type="button" data-testid="story-skip-episode-btn" onClick={onSkipEpisode}>
        跳过本集
      </button>
      <button type="button" onClick={onExit}>退出剧情</button>
      <button type="button" className="menu-close" onClick={onClose}>关闭</button>
    </div>
  );
}
