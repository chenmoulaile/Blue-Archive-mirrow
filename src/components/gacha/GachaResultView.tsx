/**
 * 招募演出 · 终幕：结果页（D5 重做）
 *
 * 报告二 D5 帧证据：无标题头；卡牌 2×5 竖版立绘卡（★3 金框 / ★2 紫框 + 实心星
 * + NEW 金徽）+ 飞散入场动画 + 底部居中单个青色「确认」钮 + 右下招募点数。
 * 删除旧版 header（招募结果·十连+卡池名+最高星）与「再来一次/返回」双钮；
 * 点卡放大详情保留（旧版已有，真机同样支持）。
 *
 * e2e 契约（scripts/e2e.mjs 卡面新结构断言）：[data-gacha-scene="result"] 内
 * .gcs-r-card ×10、.gcs-card-new、img/.gcs-card-initial 兜底字承载；确认钮挂
 * [data-gacha-close]。
 */
import { useState } from 'react';
import type { Student } from '../../types';
import type { PullResult } from '../../core/gacha/engine';
import { GACHA_BG, STAR_COLOR, artOf, bestStar } from './gachaData';

export function GachaResultView({
  results,
  times,
  bannerTitle,
  studentOf,
  newNames,
  cardArt,
  classicPoints,
  chargeNow,
  chargeMax,
  mode,
  onAgain,
  onClose,
}: {
  results: PullResult[];
  times: 1 | 10;
  bannerTitle: string;
  studentOf: (r: PullResult) => Student | null;
  /** 本批首次获得的学生名（缺省 = 全部不标 NEW） */
  newNames?: string[];
  /** 卡面立绘图源（父级已加载） */
  cardArt: Record<string, string>;
  /** 右下招募点数（D5）：经典池=点数，充能池=充能进度 */
  classicPoints?: number;
  chargeNow?: number;
  chargeMax?: number;
  mode?: 'classic' | 'charge';
  /** 兼容旧签名保留（新版无「再来一次」钮，不渲染） */
  onAgain?: () => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  const best = bestStar(results);
  const z = zoom != null ? results[zoom] : null;
  const zst = z ? studentOf(z) : null;
  const zArt = zst ? artOf(zst, cardArt) : undefined;
  const isNew = (r: PullResult): boolean => newNames?.includes(r.name) ?? false;

  const pointLabel =
    mode === 'classic'
      ? `招募点数 ${classicPoints ?? 0}/200`
      : `${mode === 'charge' ? (newNames && results.length ? '' : '') : ''}${
          chargeNow != null && chargeMax ? `充能 ${chargeNow}/${chargeMax}` : ''
        }`;

  return (
    <div
      className={`gcs-result b${best}${times === 1 ? ' single' : ''}`}
      data-gacha-scene="result"
      onClick={onClose}
    >
      <img className="gcs-result-bg" src={GACHA_BG[best]} alt="" data-ui-source="assetbundle" />
      <div className="gcs-result-dim" />

      {/* 2×5 竖版立绘卡（十连）——飞散入场：卡片从中心散向网格位 */}
      <div className="gcs-result-grid" onClick={(e) => e.stopPropagation()}>
        {results.map((r, i) => {
          const st = studentOf(r);
          const art = st ? artOf(st, cardArt) : undefined;
          return (
            <button
              key={i}
              type="button"
              className={`gcs-r-card s${r.star}${art ? ' has-art' : ''}`}
              style={{
                ['--i' as string]: i,
                // 飞散入场：入场前卡片停在中心附近，飞散方向带随机散布（确定性伪随机，避免重渲染抖动）
                ['--sx' as string]: `${((i % 5) - 2) * 60 + (i % 2 === 0 ? 24 : -24)}px`,
                ['--sy' as string]: `${(Math.floor(i / 5) - 0.5) * -120 + (i % 3 - 1) * 18}px`,
              }}
              onClick={() => setZoom(i)}
              title={`${r.name}（点击查看详情）`}
              data-ui-source="assetbundle"
            >
              {art ? (
                <img className="gcs-r-art" src={art} alt={r.name} loading="lazy" data-ui-source="assetbundle" />
              ) : st?.avatar ? (
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
              {isNew(r) && <span className="gcs-card-new">NEW</span>}
              {r.isUp && <span className="gcs-card-up">UP</span>}
            </button>
          );
        })}
      </div>

      {/* 底部居中单个青色确认钮（D5）；e2e 契约 data-gacha-close 挂在确认动作上 */}
      <footer className="gcs-result-foot" onClick={(e) => e.stopPropagation()}>
        <button className="btn gcs-confirm" data-gacha-close onClick={onClose}>
          确认
        </button>
      </footer>

      {/* 右下招募点数（D5） */}
      {pointLabel && <span className="gcs-result-point">{pointLabel}</span>}

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
            {zArt ? (
              <img className="gcs-zoom-art" src={zArt} alt={z.name} data-ui-source="assetbundle" />
            ) : zst?.avatar ? (
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
              {isNew(z) && <span className="gcs-zoom-badge new">NEW</span>}
              {z.isUp && <span className="gcs-zoom-badge up">当期 UP</span>}
              {z.forced !== 'none' && (
                <span className="gcs-zoom-badge">
                  {z.forced === 'spark'
                    ? '天井'
                    : z.forced === 'soft'
                      ? '软保底'
                      : z.forced === 'hard'
                        ? '硬保底'
                        : z.forced === 'starter'
                          ? '新手必出'
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
