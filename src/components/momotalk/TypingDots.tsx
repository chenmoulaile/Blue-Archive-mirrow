/** 学生正在输入指示器：头像 + 白色小气泡 + 三点跳动动画 */
import { NineSlice } from '../NineSlice';
import { MOMO_SPRITES } from './types';

export function TypingDots({ avatar }: { avatar?: string }) {
  return (
    <div className="mt-row">
      <div className="mt-row-avatar">
        {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="mt-avatar-fallback">?</span>}
      </div>
      <NineSlice name={MOMO_SPRITES.bubble} className="mt-bubble mt-them mt-typing" aria-label="正在输入">
        <i />
        <i />
        <i />
      </NineSlice>
    </div>
  );
}
