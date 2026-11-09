/**
 * MomoTalk 单条气泡（报告一 M-8/M-9、报告二 C3，裁决③）。
 *
 * 素材策略（与 NineSlice 的设计一致）：BA 图集精灵 School_Chat_BG 是白色
 * 遮罩，游戏里由 NGUI mColor 上色。两侧气泡共用同一白模形状，颜色走
 * BubbleSkin 的 mask-box-image + 背景染色（与引擎染色行为一致，
 * data-ui-source / data-ui-sprite 保留素材来源标注）：
 *  - 学生气泡：深藏青染色 + 白字（对照 6 原版截图采样 #4A5768 系），
 *    气泡上方红字名字（采样 #F88A9E；原版每条学生气泡上方都显示名字）；
 *  - 老师气泡：青色染色 + 白字 + 右对齐（对照 6 原版采样 #4D89C8 系；
 *    裁决③以报告二剧情内嵌截图为准，替换旧「老师深藏青 #3D4A66」取证）；
 *  - 「输入中」指示：深藏青圆角气泡 + 白点（TypingDots，深色款）。
 * 缺精灵时落 css-fallback 圆角 + 尖角（data-ui-source=css-fallback），
 * 不伪造素材。
 *
 * answer 节点在进入本组件前已被换成所选选项的 text 节点（见 ChatRoom）。
 *
 * 图片消息：Mo_* 剧情照片已由 CDN 轨补进 resources/ui/extra3/（桃信数据
 * 20 个引用逐一比对全部命中，2026-11-10 复核），onerror 占位卡保留兜底。
 *
 * M-9 入场动画：animate=true 时整行播 mtMsgIn（scale 0.9→1 + translateY
 * 8px→0 + opacity，200ms）；已读直显区（instantCount 之前）不传该 prop，
 * 打开聊天页时整块直显不播动画。
 */
import { useState, type CSSProperties } from 'react';
import { useApp } from '../../core/AppContext';
import type { SpriteEntry } from '../../core/ui-atlas';
import { momoImageUrl } from './data';
import { MOMO_SPRITES, type MomoMessage } from './types';

export interface ChatBubbleProps {
  msg: MomoMessage;
  /** 学生头像 url（老师侧不显示） */
  avatar?: string;
  /** 老师气泡（右侧、青色、白字） */
  mine?: boolean;
  /** 同发送者连续发言（行距收紧，真机连发消息排得很密） */
  cont?: boolean;
  /** 气泡上方红字名字（学生侧；对照 6 原版每条气泡上方都显示） */
  name?: string;
  /** 播放入场弹出动画（M-9；已读直显区不播） */
  animate?: boolean;
  onClick?: () => void;
}

export function ChatBubble({ msg, avatar, mine, cont, name, animate, onClick }: ChatBubbleProps) {
  const rowCls = `mt-row${mine ? ' me' : ''}${cont ? ' cont' : ''}${animate ? ' anim' : ''}`;
  // 学生侧：头像 + 名字 + 气泡竖列（名字挂在气泡上方，与气泡左缘对齐）
  if (!mine) {
    return (
      <div className={rowCls}>
        <div className="mt-row-avatar">
          {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="mt-avatar-fallback">?</span>}
        </div>
        <div className="mt-col">
          {name && <span className="mt-name">{name}</span>}
          {msg.kind === 'image' && msg.image ? (
            <ImageMessage imagePath={msg.image} />
          ) : (
            <div className="mt-bubble mt-them" onClick={onClick}>
              <BubbleSkin />
              <span className="mt-bubble-text">{msg.text}</span>
            </div>
          )}
        </div>
      </div>
    );
  }
  // 老师侧：青色气泡右对齐，无头像无名字
  return (
    <div className={rowCls}>
      <div className="mt-col">
        <div className="mt-bubble mt-me" onClick={onClick}>
          <BubbleSkin flip tone="cyan" />
          <span className="mt-bubble-text">{msg.text}</span>
        </div>
      </div>
    </div>
  );
}

/** 气泡染色档位：navy=学生/输入中（深藏青），cyan=老师（青色） */
export type BubbleTone = 'navy' | 'cyan';

const TONE_GRADIENTS: Record<BubbleTone, string> = {
  // 对照 6 原版截图（报告二 p14 视频抽帧）采样：学生深藏青 ≈#4A5768、老师青 ≈#4D89C8
  navy: 'linear-gradient(160deg, #56637a, #4a5768 55%, #3f4c5e)',
  cyan: 'linear-gradient(160deg, #5693ce, #4d89c8 55%, #427cb8)',
};

/**
 * 染色气泡皮肤：白模九宫格 mask + CSS 上色（绝对定位背景层，
 * 文字在兄弟节点不受 mask 裁剪）。
 *
 * flip=true 时背景层水平镜像 —— 白模尖角原本在左下（学生侧），
 * 老师气泡在右，尖角要指向右侧。
 */
export function BubbleSkin({ flip, tone = 'navy' }: { flip?: boolean; tone?: BubbleTone }) {
  const { uiAtlas } = useApp();
  const sprite: SpriteEntry | undefined = uiAtlas.sprites[MOMO_SPRITES.bubble];

  if (sprite?.border) {
    const b = sprite.border;
    // 与 nineSliceStyle 相同的渲染宽上限：防止小控件上切边互相挤压
    const capX = Math.max(1, Math.round(sprite.w / 3));
    const capY = Math.max(1, Math.round(sprite.h / 3));
    const wt = Math.min(b[1], capY);
    const wr = Math.min(b[2], capX);
    const wb = Math.min(b[3], capY);
    const wl = Math.min(b[0], capX);
    const style: CSSProperties = {
      position: 'absolute',
      inset: 0,
      background: TONE_GRADIENTS[tone],
      WebkitMaskBoxImageSource: `url(${sprite.file})`,
      WebkitMaskBoxImageSlice: `${b[1]} ${b[2]} ${b[3]} ${b[0]} fill`,
      WebkitMaskBoxImageWidth: `${wt}px ${wr}px ${wb}px ${wl}px`,
      WebkitMaskBoxImageRepeat: 'stretch',
      transform: flip ? 'scaleX(-1)' : undefined,
      pointerEvents: 'none',
    };
    return (
      <span
        aria-hidden
        style={style}
        data-ui-sprite={MOMO_SPRITES.bubble}
        data-ui-source={sprite.origin ?? 'assetbundle'}
        data-ui-tone={tone}
      />
    );
  }
  // css-fallback：圆角 + 尖角（方向由父类的 .flip 控制，色由 tone 类提供）
  return (
    <span
      aria-hidden
      className={`mt-bubble-skin-css tone-${tone}${flip ? ' flip' : ''}`}
      data-ui-source="css-fallback"
    />
  );
}

/** 照片消息：圆角照片 + 缺图时的优雅占位（20/20 引用已命中 extra3，兜底仅防缺档） */
function ImageMessage({ imagePath }: { imagePath: string }) {
  const [failed, setFailed] = useState(false);
  const url = momoImageUrl(imagePath);

  if (failed) {
    return (
      <div className="mt-photo mt-photo-missing" data-ui-source="css-fallback">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2" />
          <circle cx="9" cy="10.2" r="1.7" />
          <path d="m4.6 17.4 4.6-4.4 3.2 3 3.4-3.4 3.6 3.6" />
        </svg>
        <span>照片素材未提取</span>
        <code>{imagePath.split('/').pop()}</code>
      </div>
    );
  }
  return (
    <div className="mt-photo">
      <img
        src={url}
        alt="照片消息"
        loading="lazy"
        data-ui-source="assetbundle"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
