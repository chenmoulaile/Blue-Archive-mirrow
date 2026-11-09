/**
 * 招募演出总控（全屏覆盖层，D3 重做）
 *
 * 阶段机（裁决①：单张竖卡居中逐张揭示，弃用旧网格翻面）：
 *   enter（阿罗娜/普拉娜抽签进场）→ draw（抽签拉出→光球爆发）
 *   → cards（逐张：普通卡=单卡揭示+彩虹环；★3/新角色=hero 全屏演出；
 *     卡与卡之间插深蓝台词卡）→ result（结果页）
 * - 任意时刻点击遮罩或按 ESC → 清掉全部计时器、停掉 SE/语音，直达 result（e2e 依赖）
 * - prefers-reduced-motion: reduce 时直接进 result（无障碍降级）
 * - 概率/保底逻辑零改动：本组件只消费已抽好的 PullResult[]
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Student } from '../../types';
import type { PullResult } from '../../core/gacha/engine';
import { audio } from '../../core/audio';
import { GachaEnterScene } from './GachaEnterScene';
import { GachaSingleCard } from './GachaSingleCard';
import { GachaReveal } from './GachaReveal';
import { GachaResultView } from './GachaResultView';
import {
  SE_NORMAL_BURST,
  SE_NORMAL_DROP,
  SE_NORMAL_HANDLE,
  SE_RESULT_BG,
  SE_RESULT_IN,
  SE_RESULT_SSR,
  SE_SSR_WIND,
  SE_TRANSITION,
  T,
  artOf,
  bestStar,
  loadCardArt,
  loadStudentsMeta,
  talkLineOf,
  type StudentMeta,
} from './gachaData';

type Phase = 'enter' | 'draw' | 'cards' | 'result';
/** cards 幕的卡间段落：reveal（单卡/hero）→ talk（台词卡）→ 下一张 */
type CardStage = 'reveal' | 'talk';

export interface GachaCutsceneProps {
  results: PullResult[];
  times: 1 | 10;
  /** 限定/FES 池 → 普拉娜，其余阿罗娜（抽签进场角色） */
  plana: boolean;
  /** 本批新获得的 ★3 学生（驱动 hero 的 isNew 入学揭示段） */
  newStar3: Student | null;
  /** 本批「首次获得」的学生名（NEW 徽标 / hero 判定） */
  newNames?: string[];
  studentOf: (r: PullResult) => Student | null;
  bannerTitle: string;
  /** 经典池招募点数（D5 结果页右下展示） */
  classicPoints?: number;
  chargeNow?: number;
  chargeMax?: number;
  mode?: 'classic' | 'charge';
  onAgain?: () => void;
  onClose: () => void;
}

export function GachaCutscene({
  results,
  times,
  plana,
  newStar3,
  newNames,
  studentOf,
  bannerTitle,
  classicPoints,
  chargeNow,
  chargeMax,
  mode,
  onAgain,
  onClose,
}: GachaCutsceneProps) {
  const reducedMotion = useRef<boolean>(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [phase, setPhase] = useState<Phase>(() => (reducedMotion.current ? 'result' : 'enter'));
  const [cardIdx, setCardIdx] = useState(0);
  const [cardStage, setCardStage] = useState<CardStage>('reveal');
  const [cardArt, setCardArt] = useState<Record<string, string>>({});
  const [metaMap, setMetaMap] = useState<Map<number, StudentMeta>>(new Map());
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

  // 卡面立绘与 CV/武器/学园 meta（模块级缓存，缺失静默走兜底）
  useEffect(() => {
    let live = true;
    loadCardArt().then((m) => live && setCardArt(m));
    loadStudentsMeta().then((m) => live && setMetaMap(m));
    return () => {
      live = false;
    };
  }, []);

  // ------------------------------------------------ 总控阶段推进 + SE 链
  useEffect(() => {
    if (phase === 'result') return;

    if (phase === 'enter') {
      audio.playSe(SE_TRANSITION);
      at(T.ENTER, () => setPhase('draw'));
    } else if (phase === 'draw') {
      audio.playSe(SE_NORMAL_HANDLE);
      if (hasStar3) {
        at(450, () => audio.playSe(SE_SSR_WIND));
        at(950, () => audio.playSe(SE_RESULT_SSR));
      } else {
        at(500, () => audio.playSe(SE_NORMAL_DROP));
        at(1000, () => audio.playSe(SE_NORMAL_BURST));
      }
      at(T.DRAW, () => setPhase('cards'));
    } else if (phase === 'cards') {
      // 卡间推进由子组件 onDone 回调驱动，这里不排固定节拍
    }
    return clearTimers;
  }, [phase, hasStar3, at, clearTimers]);

  // 卡内段落推进：reveal 完成 → 台词卡 → 下一张；最后一张 → result。
  // cardIdx 走 ref 同步（回调闭包里取最新值，setState updater 内不排副作用）
  const cardIdxRef = useRef(0);
  const advance = useCallback(
    (from: CardStage) => {
      if (from !== 'reveal') return;
      setCardStage('talk');
      at(T.TALK_GAP + T.TALK, () => {
        const next = cardIdxRef.current + 1;
        if (next >= results.length) {
          setPhase('result');
        } else {
          cardIdxRef.current = next;
          setCardIdx(next);
          setCardStage('reveal');
        }
      });
    },
    [at, results.length]
  );

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
      '/res/ui/extra3/Plana_Composite.png',
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

  const enterPhase = phase === 'enter' ? 'enter' : 'draw';

  // 当前卡解析
  const cur = phase === 'cards' ? results[cardIdx] : undefined;
  const curSt = cur ? studentOf(cur) : null;
  const curArt = curSt ? artOf(curSt, cardArt) : undefined;
  const curMeta = curSt ? metaMap.get(curSt.id) : undefined;
  // hero 判定：★3 或本批首次获得（真机：新角色走全屏演出 + 入学揭示）
  const isHeroCard = !!cur && (cur.star === 3 || (newNames?.includes(cur.name) ?? false));
  const isNewCard = !!cur && (newNames?.includes(cur.name) ?? false);

  const talkSt = curSt;
  const talkLine = talkLineOf(talkSt);

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
          {(phase === 'enter' || phase === 'draw') && (
            <GachaEnterScene plana={plana} hasStar3={hasStar3} phase={enterPhase} />
          )}
          {phase === 'cards' && cur && cardStage === 'reveal' && (
            <>
              {isHeroCard ? (
                <GachaReveal
                  key={`hero-${cardIdx}`}
                  r={cur}
                  st={curSt}
                  art={curArt}
                  isNew={isNewCard && cur.star === 3}
                  meta={curMeta}
                  onDone={() => advance('reveal')}
                />
              ) : (
                <GachaSingleCard
                  key={`card-${cardIdx}`}
                  r={cur}
                  st={curSt}
                  art={curArt}
                  isNew={isNewCard}
                  single={times === 1}
                  onDone={() => advance('reveal')}
                />
              )}
            </>
          )}
          {phase === 'cards' && cardStage === 'talk' && (
            /* 卡与卡之间插深蓝台词卡（D3 帧证据）；台词文本用档案真文本兜底 */
            <div
              className="gcs-talk"
              data-gacha-scene="talk"
              data-ui-source="css-fallback"
              data-fallback-reason="真机台词卡为招募语音字幕，台词文本无数据源，用档案签名/简介真文本"
            >
              <span className="gcs-talk-name">{cur?.name}</span>
              <p className="gcs-talk-line">{talkLine}</p>
            </div>
          )}
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
        <GachaResultView
          results={results}
          times={times}
          bannerTitle={bannerTitle}
          studentOf={studentOf}
          newNames={newNames}
          cardArt={cardArt}
          classicPoints={classicPoints}
          chargeNow={chargeNow}
          chargeMax={chargeMax}
          mode={mode}
          onAgain={onAgain}
          onClose={onClose}
        />
      )}
    </div>
  );
}
