/**
 * 招募演出 · 终幕：结果页
 *
 * 背景按本批最高稀有度选真素材（Gacha_BG_R/SR/SSR），
 * 网格 = 翻开的卡片，点单卡看大图（头像 + 星级 + 名字 + UP 标记），
 * 底部「再来一次 / 返回」。这一幕不再自动推进，等待点击。
 */
import { useState } from 'react';
import type { Student } from '../../types';
import type { PullResult } from '../../core/gacha/engine';
import { NineSlice } from '../NineSlice';
import { GACHA_BG, bestStar } from './gachaData';

const STAR_COLOR: Record<1 | 2 | 3, string> = { 1: '#8d9dab', 2: '#9b74d8', 3: '#f0a11a' };

export function GachaResultView({
  results,
  times,
  bannerTitle,
  studentOf,
  onAgain,
  onClose,
}: {
  results: PullResult[];
  times: 1 | 10;
  bannerTitle: string;
  studentOf: (r: PullResult) => Student | null;
  onAgain: () => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  const best = bestStar(results);
  const z = zoom != null ? results[zoom] : null;
  const zst = z ? studentOf(z) : null;

  return (
    <div className={`gcs-result b${best}`} data-gacha-scene="result" onClick={onClose}>
      <img className="gcs-result-bg" src={GACHA_BG[best]} alt="" data-ui-source="assetbundle" />
      <div className="gcs-result-dim" />

      <header className="gcs-result-head">
        <div>
          <span className="gcs-result-kicker">招募结果 · {times === 10 ? '十连' : '单抽'}</span>
          <b className="gcs-result-title">{bannerTitle}</b>
        </div>
        <span className="gcs-result-best">
          最高 <b style={{ color: STAR_COLOR[best] }}>{'★'.repeat(best)}</b>
        </span>
      </header>

      <div className={`gcs-result-grid${times === 1 ? ' single' : ''}`} onClick={(e) => e.stopPropagation()}>
        {results.map((r, i) => {
          const st = studentOf(r);
          return (
            <NineSlice
              key={i}
              name="Dreammaker/Common_Bg_Raius10px"
              as="button"
              className={`gcs-r-card s${r.star}`}
              style={{ ['--i' as string]: i }}
              onClick={() => setZoom(i)}
              title={`${r.name}（点击查看详情）`}
            >
              {st?.avatar ? (
                <img className="gcs-r-avatar" src={st.avatar} alt={r.name} />
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
            </NineSlice>
          );
        })}
      </div>

      <footer className="gcs-result-foot" onClick={(e) => e.stopPropagation()}>
        <button className="btn gcs-again" data-gacha-again onClick={onAgain}>
          再来一次
        </button>
        <button className="btn ghost" data-gacha-close onClick={onClose}>
          返回
        </button>
        <span className="gcs-result-hint">点击卡片查看详情</span>
      </footer>

      {z && (
        <div
          className="gcs-zoom"
          role="dialog"
          aria-label={`${z.name} 详情`}
          onClick={(e) => {
            e.stopPropagation();
            setZoom(null);
          }}
        >
          <div className="gcs-zoom-card" onClick={(e) => e.stopPropagation()}>
            {zst?.avatar ? (
              <img className="gcs-zoom-avatar" src={zst.avatar} alt={z.name} />
            ) : (
              <span className="gcs-card-initial big">{z.name.slice(0, 1)}</span>
            )}
            <div className="gcs-zoom-info">
              <b className="gcs-zoom-name" style={{ color: STAR_COLOR[z.star] }}>
                {z.name}
              </b>
              <span className="gcs-zoom-stars">
                {'★'.repeat(z.star)}
                <span className="gcs-zoom-dim2">{'★'.repeat(3 - z.star)}</span>
              </span>
              {z.isUp && <span className="gcs-zoom-badge up">当期 UP</span>}
              {z.forced !== 'none' && (
                <span className="gcs-zoom-badge">
                  {z.forced === 'spark'
                    ? '天井'
                    : z.forced === 'soft'
                      ? '软保底'
                      : z.forced === 'hard'
                        ? '硬保底'
                        : '十连保底'}
                </span>
              )}
              <span className="gcs-zoom-sub">触发本抽后的保底计数：{z.pityAfter}</span>
            </div>
          </div>
          <button className="btn ghost gcs-zoom-close" onClick={() => setZoom(null)}>
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
