/**
 * 招募演出 · 第三幕：新学生入学揭示（录取 / 签字演出）
 *
 * 只在新获得的 ★3 时进入。用 Gacha_SubInfo（真素材申请表纸）承载：
 * 头像 + 名字 + 星级 + 签名（students_slim 的 signature 真实文本，非伪造笔迹图），
 * 右侧剪影卡（Resume，真素材）交叉淡入成头像 + 光环爆发。
 * 签名的手写笔迹没有真素材，用 CSS 描边动画兜底并标注。
 */
import type { Student } from '../../types';
import { BALL_FX, RESUME_BG, SUBINFO_PAPER } from './gachaData';

export function GachaReveal({ student, star }: { student: Student | null; star: 1 | 2 | 3 }) {
  const name = student?.name ?? '？？？';
  const avatar = student?.avatar ?? '';
  const signature = student?.signature || '';

  return (
    <div className="gcs-reveal" data-gacha-scene="reveal">
      <img className="gcs-reveal-bg" src={RESUME_BG} alt="" data-ui-source="assetbundle" />

      {/* 右侧：剪影 → 头像 + 光球爆发 */}
      <div className="gcs-reveal-show">
        <img className="gcs-reveal-burst" src={BALL_FX} alt="" data-ui-source="assetbundle" />
        {avatar ? (
          <img className="gcs-reveal-avatar" src={avatar} alt={name} data-ui-source="assetbundle" />
        ) : (
          <span className="gcs-card-initial big">{name.slice(0, 1)}</span>
        )}
      </div>

      {/* 左侧：申请表纸 */}
      <div className="gcs-paper-wrap">
        <img className="gcs-paper" src={SUBINFO_PAPER} alt="" data-ui-source="assetbundle" />
        <div className="gcs-paper-inner">
          <span className="gcs-paper-title">招募 · 新学生</span>
          {avatar && <img className="gcs-paper-avatar" src={avatar} alt="" />}
          <b className="gcs-paper-name">{name}</b>
          <span className="gcs-paper-stars" aria-label={`${star} 星`}>
            {'★'.repeat(star)}
          </span>
          {signature && (
            <span
              className="gcs-paper-sign"
              data-ui-source="css-fallback"
              data-fallback-reason="手写笔迹无真素材，用 signature 真实文本 + CSS 描边动画"
            >
              {signature}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
