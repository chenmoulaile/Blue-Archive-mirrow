/**
 * 学生正在输入指示器：头像 + 深藏青小气泡 + 白色三点跳动。
 * 参照官方 SpeechBubble 切片（_speechbubbles_check.png）：
 * 「输入中」是深藏青圆角气泡 + 白点的深色款（BubbleSkin 复用白模形状）。
 */
import { BubbleSkin } from './ChatBubble';

export function TypingDots({ avatar }: { avatar?: string }) {
  return (
    <div className="mt-row">
      <div className="mt-row-avatar">
        {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="mt-avatar-fallback">?</span>}
      </div>
      <div className="mt-bubble mt-them mt-typing" aria-label="正在输入">
        <BubbleSkin />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
