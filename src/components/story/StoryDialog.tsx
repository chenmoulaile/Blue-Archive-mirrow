/**
 * StoryDialog — 剧情对话框
 *
 * 2026-11-09 走查⑦：extra2 已有官方真素材（ui_atlas 键 ChatArchive/*）——
 *   ChatArchive/Scenario_Mode_Bg_3.png（1292x437 主线对话大底板，左端蓝竖条为名字区）
 *   ChatArchive/Dialogue_Event_Background.png（1056x288 活动气泡底板，用作名字牌底）
 * 底板/名字牌命中即挂 background-image（两张图在 ui_nineslice 无 border 记录，
 * 九宫格映射缺失，按走查约定用 background-image 而非 border-image），文字配色
 * 随之切换（.player-dialog.official 深字系）；任一素材缺失时整体退回 CSS 兜底
 * （旧深板白字），data-ui-source 如实标注。
 *
 * 右下控制按钮用已提取的通用真素材：
 *   Common/Common_Log_Icon（86x62）Common/Common_AutoBg（82x71 九宫格）
 *   Common/Common_Skip_Icon（87x51）
 */
import { NineSlice } from '../NineSlice';
import { useApp } from '../../core/AppContext';
import type { CSSProperties } from 'react';

/**
 * 白色遮罩 sprite 的正确上色方式：形状用 CSS mask 取原件，颜色走 CSS
 * （对应引擎里 NGUI mColor 的上色行为）。NineSlice 的 border-image 路径
 * 对无 border 的图标退化为整图拉伸、白遮罩不可上色，所以图标类单独走 mask。
 */
function MaskedIcon({ file, color }: { file: string; color: string }) {
  const style: CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    backgroundColor: color,
    WebkitMaskImage: `url(${file})`,
    maskImage: `url(${file})`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  };
  return <span style={style} data-ui-source="assetbundle-mask" />;
}

export interface StoryDialogProps {
  kind: 'say' | 'info' | 'mark' | 'choice';
  speaker: string;
  text: string;
  /** 打字机已输出字符数 */
  typed: number;
  isTyping: boolean;
  ended: boolean;
  /** AUTO 激活（右下按钮） */
  auto: boolean;
  skip: boolean;
  /** 无立绘资源时对话框角落显示的学生头像 url（有立绘时留空） */
  cornerAvatar?: string | null;
  onToggleAuto: () => void;
  onToggleSkip: () => void;
  onOpenHistory: () => void;
}

export function StoryDialog({
  kind,
  speaker,
  text,
  typed,
  isTyping,
  ended,
  auto,
  skip,
  cornerAvatar,
  onToggleAuto,
  onToggleSkip,
  onOpenHistory,
}: StoryDialogProps) {
  const { uiAtlas } = useApp();
  const shown = text.slice(0, typed);
  const kindLabel = kind === 'mark' ? '提示' : kind === 'choice' ? '选项' : '旁白';
  const logSprite = uiAtlas.sprites['Common/Common_Log_Icon'];
  const skipSprite = uiAtlas.sprites['Common/Common_Skip_Icon'];
  // 走查⑦：官方底板/名字牌（ChatArchive/*，extra2 提取件）
  const bgSprite = uiAtlas.sprites['ChatArchive/Scenario_Mode_Bg_3.png'];
  const plateSprite = uiAtlas.sprites['ChatArchive/Dialogue_Event_Background.png'];
  const official = Boolean(bgSprite && plateSprite);
  const bgStyle: CSSProperties | undefined = official
    ? {
        backgroundImage: `url(${bgSprite!.file})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }
    : undefined;
  const plateStyle: CSSProperties | undefined = official
    ? {
        backgroundImage: `url(${plateSprite!.file})`,
        backgroundSize: 'auto 100%',
        backgroundPosition: 'left center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#fdf0f1', // 图缩放宽不足长名时右侧补同色底
      }
    : undefined;
  // LOG/SKIP 遮罩图标的上色：官方白底板用深字色，CSS 兜底深板用白字色
  const ctrlColor = official ? 'rgba(63, 88, 112, 0.88)' : 'rgba(226, 242, 252, 0.92)';

  return (
    <div
      className={`player-dialog${official ? ' official' : ''}`}
      style={bgStyle}
      data-ui-source={official ? 'assetbundle' : 'css-fallback'}
      data-testid="story-dialog"
    >
      {kind === 'say' ? (
        <span className="speaker" style={plateStyle}>
          {speaker}
        </span>
      ) : (
        <span className="speaker info" style={plateStyle}>
          {kindLabel}
        </span>
      )}
      <div className="text">
        {shown}
        {isTyping && <span className="type-cursor">▍</span>}
      </div>
      {!isTyping && !ended && <span className="next">▼ 点击继续</span>}

      {cornerAvatar && (
        <img
          className="dialog-corner-avatar"
          src={cornerAvatar}
          alt=""
          loading="lazy"
        />
      )}

      {/* 游戏同款右下控制按钮组：LOG / AUTO / SKIP */}
      <div className="dialog-controls" role="group" aria-label="播放控制">
        <button
          type="button"
          className="ctrl-btn ctrl-log"
          data-testid="story-log-btn"
          title="对话回看 (LOG)"
          onClick={(e) => {
            e.stopPropagation();
            onOpenHistory();
          }}
        >
          {logSprite ? (
            <span className="ctrl-img">
              <MaskedIcon file={logSprite.file} color={ctrlColor} />
            </span>
          ) : (
            <span className="ctrl-img ctrl-fallback">
              <span className="ctrl-glyph">LOG</span>
            </span>
          )}
        </button>
        <button
          type="button"
          className={`ctrl-btn ctrl-auto${auto ? ' on' : ''}`}
          data-testid="story-auto-btn"
          title="自动播放 (AUTO)"
          onClick={(e) => {
            e.stopPropagation();
            onToggleAuto();
          }}
        >
          <NineSlice
            name="Common/Common_AutoBg"
            className="ctrl-slice"
            fillCenter={false}
            fallbackClassName="ctrl-slice"
            fallbackStyle={{ background: 'rgba(255,255,255,0.14)' }}
            style={{ backgroundColor: auto ? 'rgba(63,159,224,0.92)' : 'rgba(18,34,48,0.78)' }}
          >
            <span className="ctrl-glyph">AUTO</span>
          </NineSlice>
        </button>
        <button
          type="button"
          className={`ctrl-btn ctrl-skip${skip ? ' on' : ''}`}
          data-testid="story-skip-btn"
          title="快进 (SKIP)"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSkip();
          }}
        >
          {skipSprite ? (
            <span className="ctrl-img">
              <MaskedIcon file={skipSprite.file} color={ctrlColor} />
            </span>
          ) : (
            <span className="ctrl-img ctrl-fallback">
              <span className="ctrl-glyph">▶▶</span>
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
