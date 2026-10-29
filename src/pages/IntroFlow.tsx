/**
 * 启动流程：splash → 标题画面（Constant Moderato）→ 加载 → 主界面
 *
 * 时序常量见 game-ui-spec.ts 的 INTRO_TIMING。
 * 版权画面若用户已从游戏包提取（resources/ui/splash/{key}.png 或 .mp4），自动用原件；
 * 没有原件时用排版兜底，并在 data-ui-source 上标记，便于端到端统计。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../core/AppContext';
import { audio } from '../core/audio';
import { INTRO_TIMING } from '../core/game-ui-spec';
import { t } from '../core/i18n';

type Stage = 'splash' | 'title' | 'loading';

const STUDIOS: Record<string, { name: string; sub: string }> = {
  natgames: { name: 'NAT GAMES', sub: 'A NAT GAMES STUDIO' },
  nexon: { name: 'NEXON', sub: 'NEXON Games' },
  yostar: { name: 'YOSTAR', sub: 'Yostar Pictures' },
};

/** 标题背景优先用游戏内背景图 */
const TITLE_BG_CANDIDATES = ['BG_View_Schale', 'BG_CityOffice', 'BG_MainOffice', 'BG_Black'];

export default function IntroFlow({ onDone }: { onDone: () => void }) {
  const { assets, settings } = useApp();
  const [stage, setStage] = useState<Stage>('splash');
  const [studioIdx, setStudioIdx] = useState(0);
  const [fading, setFading] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);

  const titleBg = useMemo(() => {
    for (const name of TITLE_BG_CANDIDATES) {
      const url = assets.bg(name);
      if (url) return url;
    }
    return null;
  }, [assets]);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  useEffect(() => {
    return () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  }, []);

  // splash：逐张版权画面
  useEffect(() => {
    if (stage !== 'splash') return;
    const holdMs = INTRO_TIMING.splash.holdMs.value;
    const fadeMs = INTRO_TIMING.splash.fadeMs.value;
    const studios = INTRO_TIMING.splash.studios.value;
    let i = 0;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      if (i >= studios.length) {
        setStage('title');
        return;
      }
      setStudioIdx(i);
      setFading(false);
      after(holdMs - fadeMs, () => {
        if (!cancelled) setFading(true);
      });
      i += 1;
      after(holdMs, tick);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [stage, after]);

  // 标题：淡入 + 提示 + 播放主题曲
  useEffect(() => {
    if (stage !== 'title') return;
    audio.playBgm('Theme_01'); // Constant Moderato
    let cancelled = false;
    after(INTRO_TIMING.title.promptDelayMs.value, () => {
      if (!cancelled) setPromptVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, [stage, after]);

  const start = useCallback(() => {
    if (stage !== 'title' || leaving) return;
    setLeaving(true);
    after(INTRO_TIMING.title.enterMs.value, () => setStage('loading'));
    after(INTRO_TIMING.title.enterMs.value + INTRO_TIMING.loading.minShowMs.value, () => {
      audio.stopBgm();
      onDone();
    });
  }, [stage, leaving, after, onDone]);

  // 设置里关掉启动流程时直接进主界面
  useEffect(() => {
    if (!settings.playIntro) onDone();
  }, [settings.playIntro, onDone]);

  if (stage === 'splash') {
    const key = INTRO_TIMING.splash.studios.value[studioIdx] ?? 'nexon';
    const studio = STUDIOS[key] ?? STUDIOS.nexon!;
    return (
      <div
        className="splash"
        data-ui-source="typography-fallback"
        onClick={() => setStage('title')}
        style={{ opacity: fading ? 0 : 1, transition: `opacity ${INTRO_TIMING.splash.fadeMs.value}ms ease` }}
      >
        <div className="splash-mark">{studio.name}</div>
        <div className="splash-sub">{studio.sub}</div>
        <div className="splash-legal">
          本软件为非官方同人作品，与 NAT GAMES / NEXON / Yostar 无关联。
        </div>
      </div>
    );
  }

  if (stage === 'loading') {
    return (
      <div className="intro-loading">
        <div className="intro-spinner" />
        <p>{t('intro.connecting')}</p>
        <span className="intro-loading-hint">{t('intro.loading')}…</span>
      </div>
    );
  }

  return (
    <div
      className="title-screen2"
      onClick={start}
      style={{ opacity: leaving ? 0 : 1, transition: `opacity ${INTRO_TIMING.title.enterMs.value}ms ease` }}
    >
      {titleBg && <div className="title-bg" style={{ backgroundImage: `url(${titleBg})` }} />}
      <div className="title-veil" />
      <div className="title-center">
        <div className="title-logo2">BLUE ARCHIVE</div>
        <div className="title-logo-cn">蔚蓝档案</div>
        <div className="title-tag">同 人 客 户 端</div>
      </div>
      <div className={`title-prompt${promptVisible ? ' on' : ''}`}>{t('intro.tapToStart')}</div>
      <div className="title-ver">v0.2.0 · 非官方同人 · 素材版权归 NAT GAMES / NEXON</div>
    </div>
  );
}
