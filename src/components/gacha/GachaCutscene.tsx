/**
 * 招募演出总控（全屏覆盖层）
 *
 * 阶段机：enter（登场）→ pull（爆发）→ flip（翻卡）→ reveal（新★3 揭示，可选）→ result（结果页）
 * - 任意时刻点击遮罩或按 ESC → 清掉全部计时器、停掉 SE，直达 result（e2e 自动化依赖这一点）
 * - prefers-reduced-motion: reduce 时直接进 result（无障碍降级）
 * - SE 用 src/core/audio.ts 的 playSe，按节拍表触发；跳过时 stopSeAll()
 * - 概率/保底逻辑零改动：本组件只消费已抽好的 PullResult[]
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Student } from '../../types';
import type { PullResult } from '../../core/gacha/engine';
import { audio } from '../../core/audio';
import { GachaEnterScene } from './GachaEnterScene';
import { GachaFlipGrid } from './GachaFlipGrid';
import { GachaReveal } from './GachaReveal';
import { GachaResultView } from './GachaResultView';
import {
  SE_FLIP,
  SE_NORMAL_BURST,
  SE_NORMAL_DROP,
  SE_NORMAL_HANDLE,
  SE_RESULT_BG,
  SE_RESULT_IN,
  SE_RESULT_SSR,
  SE_SSR_CHIME,
  SE_SSR_IMPACT,
  SE_SSR_SIGN,
  SE_SSR_TAIL,
  SE_SSR_WIND,
  SE_TRANSITION,
  T,
  bestStar,
} from './gachaData';

type Phase = 'enter' | 'pull' | 'flip' | 'reveal' | 'result';

export interface GachaCutsceneProps {
  results: PullResult[];
  times: 1 | 10;
  /** 限定/FES 池 → 普拉娜（无真素材走 CSS 剪影），其余阿罗娜 */
  plana: boolean;
  /** 本批新获得的 ★3 学生（没有则跳过揭示幕） */
  newStar3: Student | null;
  studentOf: (r: PullResult) => Student | null;
  bannerTitle: string;
  onAgain: () => void;
  onClose: () => void;
}

export function GachaCutscene({
  results,
  times,
  plana,
  newStar3,
  studentOf,
  bannerTitle,
  onAgain,
  onClose,
}: GachaCutsceneProps) {
  const reducedMotion = useRef<boolean>(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [phase, setPhase] = useState<Phase>(() => (reducedMotion.current ? 'result' : 'enter'));
  const timers = useRef<number[]>([]);
  const hasStar3 = useMemo(() => bestStar(results) === 3, [results]);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const skip = useCallback(() => {
    clearTimers();
    audio.stopSeAll();
    setPhase('result');
  }, [clearTimers]);

  // ------------------------------------------------ 阶段推进 + SE 链
  useEffect(() => {
    if (phase === 'result') return;

    if (phase === 'enter') {
      audio.playSe(SE_TRANSITION);
      at(T.ENTER, () => setPhase('pull'));
    } else if (phase === 'pull') {
      audio.playSe(SE_NORMAL_HANDLE);
      if (hasStar3) {
        // SSR 专属链：风 → 铃 → 冲击
        at(450, () => audio.playSe(SE_SSR_WIND));
        at(950, () => audio.playSe(SE_SSR_CHIME));
        at(1250, () => audio.playSe(SE_SSR_IMPACT));
      } else {
        at(500, () => audio.playSe(SE_NORMAL_DROP));
        at(1000, () => audio.playSe(SE_NORMAL_BURST));
      }
      at(T.PULL, () => setPhase('flip'));
    } else if (phase === 'flip') {
      const n = results.length;
      results.forEach((r, i) => {
        at(i * T.FLIP_STEP, () => audio.playSe(SE_FLIP[r.star]));
      });
      at((n - 1) * T.FLIP_STEP + T.FLIP_CARD + T.FLIP_TAIL, () => setPhase(newStar3 ? 'reveal' : 'result'));
    } else if (phase === 'reveal') {
      at(600, () => audio.playSe(SE_SSR_SIGN));
      at(1700, () => audio.playSe(SE_SSR_TAIL));
      at(T.REVEAL, () => setPhase('result'));
    }
    return clearTimers;
  }, [phase, results, hasStar3, newStar3, at, clearTimers]);

  // 结果页音效：进场单独挂，避免随阶段 effect 清理
  useEffect(() => {
    if (phase !== 'result') return;
    audio.playSe(SE_RESULT_IN[times]);
    if (hasStar3) at(450, () => audio.playSe(SE_RESULT_SSR));
    at(150, () => audio.playSe(SE_RESULT_BG));
    return clearTimers;
  }, [phase, times, hasStar3, at, clearTimers]);

  // ESC 跳过
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip]);

  // 卸载时兜底清理
  useEffect(() => clearTimers, [clearTimers]);

  // 预载本幕要用的图，避免中途闪白
  useEffect(() => {
    const urls = [
      '/res/ui/extra/UIWorkAronaSceneBG_Day.png',
      '/res/ui/extra/Image_Char_Arona.png',
      '/res/ui/extra/Image_Char_Arona2.png',
      '/res/ui/extra/FX_TEX_GachaBall9.png',
      '/res/ui/extra/FX_TEX_GT_Aronaeye1.png',
      '/res/ui/extra/Gacha_BG_R.png',
      '/res/ui/extra/Gacha_BG_SR.png',
      '/res/ui/extra/Gacha_BG_SSR.png',
      '/res/ui/extra/Img_Gacha_Char_R_Resume.png',
      '/res/ui/extra/Img_Gacha_Char_SR_Resume.png',
      '/res/ui/extra/Img_Gacha_Char_SSR_Resume.png',
      '/res/ui/extra/Gacha_SubInfo.png',
      '/res/ui/extra/Img_Gacha_BG_Resume.png',
    ];
    for (const u of urls) {
      const im = new Image();
      im.src = u;
    }
  }, []);

  const enterPhase = phase === 'enter' ? 'enter' : 'pull';

  return (
    <div
      className="gcs-overlay"
      data-gacha-overlay=""
      data-gacha-phase={phase}
      role="dialog"
      aria-label="招募演出"
      onClick={skip}
    >
      {phase !== 'result' && (
        <>
          {(phase === 'enter' || phase === 'pull') && (
            <GachaEnterScene plana={plana} hasStar3={hasStar3} phase={enterPhase} />
          )}
          {phase === 'flip' && (
            <GachaFlipGrid results={results} times={times} studentOf={studentOf} />
          )}
          {phase === 'reveal' && <GachaReveal student={newStar3} star={3} />}
          <button
            className="gcs-skip"
            data-gacha-skip
            onClick={(e) => {
              e.stopPropagation();
              skip();
            }}
          >
            跳过 ▸
          </button>
        </>
      )}
      {phase === 'result' && (
        <div onClick={(e) => e.stopPropagation()}>
          <GachaResultView
            results={results}
            times={times}
            bannerTitle={bannerTitle}
            studentOf={studentOf}
            onAgain={onAgain}
            onClose={onClose}
          />
        </div>
      )}
    </div>
  );
}
