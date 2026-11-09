/**
 * 招募演出 · 单张竖卡居中揭示（D3/C-8）
 *
 * 裁决①：删除旧 GachaFlipGrid 的网格翻面——真机（视频抽帧 48 帧证据）是
 * 单张竖卡居中逐张揭示：卡背（稀有度剪影卡）出现 → 翻转 → 卡面（立绘+星行+名字）
 * → 普卡青绿彩虹环扩散特效（conic-gradient 环 + 扩散动画，CSS 兜底如实标注）。
 *
 * 单抽（C-8）复用同一组件但加 .single：居中大卡、时序一致（真机单抽与十连
 * 的差异在网格动线，单卡本身形态一致；大卡尺寸差由 CSS 类承载）。
 *
 * 音效在本组件 flip 时刻按稀有度播 SE_FLIP；跳过时父组件 stopSeAll() 统一停。
 */
import { useEffect, useRef, useState } from 'react';
import type { PullResult } from '../../core/gacha/engine';
import { audio } from '../../core/audio';
import { GACHA_RESUME, SE_FLIP, STAR_COLOR } from './gachaData';

/** 单卡内部时序（毫秒） */
const STEP = { FLIP: 520, FACE: 1050, RING: 1120, DONE: 1980 } as const;

export function GachaSingleCard({
  r,
  art,
  isNew,
  single,
  onDone,
}: {
  r: PullResult;
  /** 学生档案（保留参数：台词卡/兜底展示由父级消费） */
  st?: unknown;
  /** 卡面立绘图源（card_art → avatar 兜底，父级已解析） */
  art?: string;
  isNew?: boolean;
  /** 单抽模式：居中大卡（C-8） */
  single?: boolean;
  /** 揭示完成后回调（父级推台词卡/下一张）；只触发一次 */
  onDone: () => void;
}) {
  const [step, setStep] = useState<'back' | 'flip' | 'face'>('back');
  const doneRef = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    at(STEP.FLIP, () => {
      audio.playSe(SE_FLIP[r.star]);
      setStep('flip');
    });
    at(STEP.FACE, () => setStep('face'));
    at(STEP.DONE, () => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    });
    return () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`gcsc${single ? ' single' : ''}`} data-gacha-scene="single-card">
      {/* 卡体：3D 翻转容器 */}
      <div className={`gcsc-card s${r.star} st-${step}`}>
        {/* 卡背：稀有度剪影卡（真素材），游戏内盖着的牌同样透出稀有度色 */}
        <div className="gcsc-face gcsc-back" data-ui-source="assetbundle">
          <img src={GACHA_RESUME[r.star]} alt="" />
          <span className="gcsc-q">?</span>
        </div>
        {/* 卡面：竖版立绘卡 */}
        <div className="gcsc-face gcsc-front">
          {art ? (
            <img className="gcsc-art" src={art} alt={r.name} data-ui-source="assetbundle" />
          ) : (
            <span className="gcsc-initial">{r.name.slice(0, 1)}</span>
          )}
          <b className="gcsc-stars" style={{ color: STAR_COLOR[r.star] }}>
            {'★'.repeat(r.star)}
          </b>
          <span className="gcsc-name" title={r.name}>
            {r.name}
          </span>
          {isNew && <span className="gcsc-new">NEW</span>}
          {r.isUp && <span className="gcsc-up">UP</span>}
        </div>
      </div>

      {/* 普卡青绿彩虹环扩散特效（D3 帧证据；CSS conic-gradient 兜底标注） */}
      {step !== 'back' && (
        <i
          className="gcsc-ring"
          data-ui-source="css-fallback"
          data-fallback-reason="彩虹环扩散特效无独立贴图素材，用 conic-gradient 动画还原真机观感"
        />
      )}
      {step !== 'back' && <i className="gcsc-flashline" />}
    </div>
  );
}
