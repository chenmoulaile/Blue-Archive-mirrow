/**
 * MomoTalk 单条气泡。
 *
 * 素材策略（与 NineSlice 的设计一致）：BA 图集精灵是白色遮罩，游戏里由
 * NGUI mColor 上色：
 *  - 学生气泡：原件白模（fillCenter 填充），贴图本身就是白色，直接可用；
 *  - 老师气泡 / 「输入中」指示：真机是整体深藏青（#3D4A66 系，见参考
 *    _speechbubbles_check.png 老师侧气泡与三点指示）。border-image 无法
 *    整体染色，所以用 mask-box-image 复用同一张白模形状、颜色交给
 *    background —— 与引擎染色行为一致；缺精灵时落 css-fallback 圆角 +
 *    尖角，不伪造素材。
 *
 * answer 节点在进入本组件前已被换成所选选项的 text 节点（见 ChatRoom）。
 *
 * 图片消息：数据里只有 ImagePath，20 张 Mo_* 照片纹理本地未提取
 * （uis-03_scenario-01_background / 02_character 两个族全扫 0 命中），
 * 因此 <img> onerror 后渲染占位卡；将来文件补进 resources/ui/extra/
 * 无需改代码。
 */
import { useState, type CSSProperties } from 'react';
import { useApp } from '../../core/AppContext';
import { NineSlice } from '../NineSlice';
import type { SpriteEntry } from '../../core/ui-atlas';
import { momoImageUrl } from './data';
import { MOMO_SPRITES, type MomoMessage } from './types';

export interface ChatBubbleProps {
  msg: MomoMessage;
  /** 学生头像 url（老师侧不显示） */
  avatar?: string;
  /** 老师气泡（右侧、深藏青） */
  mine?: boolean;
  /** 同发送者连续发言（行距收紧，真机连发消息排得很密） */
  cont?: boolean;
  onClick?: () => void;
}

export function ChatBubble({ msg, avatar, mine, cont, onClick }: ChatBubbleProps) {
  return (
    <div className={`mt-row${mine ? ' me' : ''}${cont ? ' cont' : ''}`}>
      {!mine && (
        <div className="mt-row-avatar">
          {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="mt-avatar-fallback">?</span>}
        </div>
      )}
      {msg.kind === 'image' && msg.image ? (
        <ImageMessage imagePath={msg.image} />
      ) : mine ? (
        <div className="mt-bubble mt-me" onClick={onClick}>
          <BubbleSkin flip />
          <span className="mt-bubble-text">{msg.text}</span>
        </div>
      ) : (
        <NineSlice
          name={MOMO_SPRITES.bubble}
          className="mt-bubble mt-them"
          fillCenter
          onClick={onClick}
        >
          {msg.text}
        </NineSlice>
      )}
    </div>
  );
}

/**
 * 深藏青气泡皮肤：白模九宫格 mask + CSS 上色（绝对定位背景层，
 * 文字在兄弟节点不受 mask 裁剪）。
 *
 * flip=true 时背景层水平镜像 —— 白模尖角原本在左下（学生侧），
 * 老师气泡在右，尖角要指向右侧头像。
 */
export function BubbleSkin({ flip }: { flip?: boolean }) {
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
      background: 'linear-gradient(160deg, #47546f, #3d4a66 55%, #35405a)',
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
      />
    );
  }
  // css-fallback：圆角 + 尖角（方向由父类的 .flip 控制）
  return (
    <span aria-hidden className={`mt-bubble-skin-css${flip ? ' flip' : ''}`} data-ui-source="css-fallback" />
  );
}

/** 照片消息：圆角照片 + 未提取时的优雅占位 */
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
