/**
 * 招募演出 · 第二幕：卡片逐张翻面
 *
 * 背面 = 稀有度染色剪影卡（Img_Gacha_Char_R/SR/SSR_Resume，真素材；
 * 游戏内盖着的牌也会先透出稀有度颜色，这里是同一语言）；
 * 正面 = 头像 + 星级 + 名字。翻转节奏由 CSS animation-delay 控制，
 * 音效由父组件按同一节拍用 playSe 触发。
 */
import type { Student } from '../../types';
import type { PullResult } from '../../core/gacha/engine';
import { GACHA_RESUME } from './gachaData';

const STAR_COLOR: Record<1 | 2 | 3, string> = { 1: '#8d9dab', 2: '#9b74d8', 3: '#f0a11a' };

export function GachaFlipGrid({
  results,
  times,
  studentOf,
}: {
  results: PullResult[];
  times: 1 | 10;
  studentOf: (r: PullResult) => Student | null;
}) {
  return (
    <div className={`gcs-flip${times === 1 ? ' single' : ''}`} data-gacha-scene="flip">
      <div className="gcs-flip-grid">
        {results.map((r, i) => {
          const st = studentOf(r);
          return (
            <div className={`gcs-card-wrap s${r.star}`} key={i} style={{ ['--i' as string]: i }}>
              <div className="gcs-card">
                <div className="gcs-face gcs-back" data-ui-source="assetbundle">
                  <img src={GACHA_RESUME[r.star]} alt="" />
                  <span className="gcs-card-q">?</span>
                </div>
                <div className="gcs-face gcs-front">
                  {st?.avatar ? (
                    <img className="gcs-card-avatar" src={st.avatar} alt={r.name} />
                  ) : (
                    <span className="gcs-card-initial">{r.name.slice(0, 1)}</span>
                  )}
                  <b className="gcs-card-star" style={{ color: STAR_COLOR[r.star] }}>
                    {'★'.repeat(r.star)}
                  </b>
                  <span className="gcs-card-name" title={r.name}>
                    {r.name}
                  </span>
                  {r.isUp && <span className="gcs-card-up">UP</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
