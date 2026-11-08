/**
 * MomoTalk 单条气泡。
 *
 * 素材策略（与 NineSlice 的设计一致）：BA 图集精灵是白色遮罩，游戏里由
 * NGUI mColor 上色，所以学生气泡用原件白模、老师气泡用同一个白模 + CSS
 * 蓝色上色（fillCenter=false 让中心透出 background），与引擎行为一致；
 * 缺精灵时自动落 css-fallback 圆角气泡，不伪造素材。
 *
 * answer 节点在进入本组件前已被换成所选选项的 text 节点（见 ChatRoom）。
 *
 * 图片消息：数据里只有 ImagePath，20 张 Mo_* 照片纹理本地未提取
 * （uis-03_scenario-01_background / 02_character 两个族全扫 0 命中），
 * 因此 <img> onerror 后渲染占位卡；将来文件补进 resources/ui/extra/
 * 无需改代码。
 */
import { useState } from 'react';
import { NineSlice } from '../NineSlice';
import { momoImageUrl } from './data';
import { MOMO_SPRITES, type MomoMessage } from './types';

export interface ChatBubbleProps {
  msg: MomoMessage;
  /** 学生头像 url（老师侧不显示） */
  avatar?: string;
  /** 老师气泡（右侧、蓝色） */
  mine?: boolean;
  onClick?: () => void;
}

export function ChatBubble({ msg, avatar, mine, onClick }: ChatBubbleProps) {
  return (
    <div className={`mt-row${mine ? ' me' : ''}`}>
      {!mine && (
        <div className="mt-row-avatar">
          {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="mt-avatar-fallback">?</span>}
        </div>
      )}
      {msg.kind === 'image' && msg.image ? (
        <ImageMessage imagePath={msg.image} />
      ) : (
        <NineSlice
          name={MOMO_SPRITES.bubble}
          className={`mt-bubble ${mine ? 'mt-me' : 'mt-them'}`}
          fillCenter={!mine}
          onClick={onClick}
        >
          {msg.text}
        </NineSlice>
      )}
    </div>
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
