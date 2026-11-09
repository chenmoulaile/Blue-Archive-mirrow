/**
 * 学生正在输入指示器：头像 + 深藏青小气泡 + 白色三点跳动。
 * 参照官方 SpeechBubble 切片（_speechbubbles_check.png）：
 * 「输入中」是深藏青圆角气泡 + 白点的深色款（BubbleSkin 复用白模形状）。
 * animate=true 时整行播 M-9 入场弹出动画（打字指示只出现在流式区）。
 */
import { BubbleSkin } from './ChatBubble';

export function TypingDots({ avatar, animate }: { avatar?: string; animate?: boolean }) {
  return (
    <div className={`mt-row${animate ? ' anim' : ''}`}>
      <div className="mt-row-avatar">
        {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="mt-avatar-fallback">?</span>}
      </div>
      <div className="mt-col">
        <div className="mt-bubble mt-them mt-typing" aria-label="正在输入">
          <BubbleSkin />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}
