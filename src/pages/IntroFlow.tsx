/**
 * 启动流程：splash → 标题画面 → 加载过场（阿罗娜）→ 大厅
 *
 * 时序常量见 game-ui-spec.ts 的 INTRO_TIMING / TITLE_SCREEN / LOADING_ARONA。
 *
 * 素材策略（全部实测过再写）：
 *   - splash：NEXON / Yostar 用图集原件（NEXON_CI、nexonCiWhite、Icon_Logo_Yostar），
 *     NAT GAMES 没有提取到 logo（图集 grep 无命中），排版兜底并打 data-ui-source。
 *   - 标题：BA 标题 logo 是艺术字，图集无原件，文字版式兜底（typography-fallback）；
 *     2026-11-08 走查⑧复核：卡池横幅 jpg 上的 logo 与底纹焊死无 alpha，
 *     不可裁用；待从游戏 bundle 提取 Title_Logo 后替换。
 *     「TOUCH TO START」为标题页按钮原文（wiki_layout）。
 *     标题 BGM 是 Theme_01（Constant Moderato），物理缺失
 *     （data/bgm_map.json 里 extracted=false，BGM.molru 尾表未解出），
 *     按 TITLE_SCREEN.bgmFallbackOrder 取第一个可用曲目，playBgm 缺失会静音兜底。
 *   - 加载过场：任务指定的 resources/npc_portrait 里实测没有 Arona
 *     （grep 无命中），改用图集原件 Image_Char_Arona.png（阿罗娜半身立绘）
 *     + Common/Loading_Arona.png（加载提示框兔头角标），提示文案同人自撰轮换。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../core/AppContext';
import { audio } from '../core/audio';
import {
  INTRO_TIMING,
  TITLE_SCREEN,
  LOADING_ARONA,
  LOADING_TIPS,
} from '../core/game-ui-spec';
import { t } from '../core/i18n';

type Stage = 'splash' | 'title' | 'loading';

/** splash 版权画面：优先图集原件，没有则排版兜底 */
const STUDIOS: Record<string, { name: string; sub: string; sprite?: string }> = {
  natgames: { name: 'NAT GAMES', sub: 'A NAT GAMES STUDIO' },
  nexon: { name: 'NEXON', sub: 'NEXON Games', sprite: 'nexonCiWhite/nexonCiWhite' },
  yostar: { name: 'YOSTAR', sub: 'Yostar Pictures', sprite: 'Icon_Logo_Yostar' },
};

/** 标题背景优先用游戏内背景图 */
const TITLE_BG_CANDIDATES = ['BG_View_Schale', 'BG_CityOffice', 'BG_MainOffice', 'BG_Black'];

export default function IntroFlow({ onDone }: { onDone: () => void }) {
  const { assets, settings, uiAtlas } = useApp();
  const [stage, setStage] = useState<Stage>('splash');
  const [studioIdx, setStudioIdx] = useState(0);
  const [fading, setFading] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * LOADING_TIPS.value.length));
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
  // Theme_01 物理缺失（bgm_map.json extracted=false），HEAD 探测降级到第一个可用曲目；
  // audio.playBgm 的缺失标记是 error 事件异步写入的，同步循环里判断不了，所以在这里探测。
  useEffect(() => {
    if (stage !== 'title') return;
    let cancelled = false;
    void (async () => {
      const ids = [TITLE_SCREEN.bgmPrimary.value, ...TITLE_SCREEN.bgmFallbackOrder.value];
      for (const id of ids) {
        try {
          const r = await fetch(`/res/bgm/${id}.ogg`, { method: 'HEAD' });
          if (r.ok) {
            if (!cancelled) audio.playBgm(id);
            return;
          }
        } catch {
          /* 探测失败换下一首 */
        }
      }
      // 全部缺失：仍按契约调用，playBgm 内部会静音兜底
      if (!cancelled) audio.playBgm(TITLE_SCREEN.bgmPrimary.value);
    })();
    let cancelled2 = false;
    after(INTRO_TIMING.title.promptDelayMs.value, () => {
      if (!cancelled2) setPromptVisible(true);
    });
    return () => {
      cancelled = true;
      cancelled2 = true;
    };
  }, [stage, after]);

  // 加载过场：轮换提示文案 + 开场 SE
  useEffect(() => {
    if (stage !== 'loading') return;
    audio.playSe(LOADING_ARONA.seOpen.value);
    const id = window.setInterval(
      () => setTipIdx((i) => (i + 1) % LOADING_TIPS.value.length),
      LOADING_ARONA.tipSwitchMs.value
    );
    return () => window.clearInterval(id);
  }, [stage]);

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
    const sprite = studio.sprite ? uiAtlas.sprites[studio.sprite] : undefined;
    return (
      <div
        className="splash"
        data-ui-source={sprite ? 'assetbundle' : 'typography-fallback'}
        onClick={() => setStage('title')}
        style={{ opacity: fading ? 0 : 1, transition: `opacity ${INTRO_TIMING.splash.fadeMs.value}ms ease` }}
      >
        {sprite ? (
          <img
            src={sprite.file}
            alt={studio.name}
            style={{ height: 56, objectFit: 'contain' }}
            data-ui-sprite={studio.sprite}
          />
        ) : (
          <div className="splash-mark">{studio.name}</div>
        )}
        <div className="splash-sub">{studio.sub}</div>
        <div className="splash-legal">
          本软件为非官方同人作品，与 NAT GAMES / NEXON / Yostar 无关联。
        </div>
      </div>
    );
  }

  if (stage === 'loading') {
    const tip = LOADING_TIPS.value[tipIdx] ?? '';
    return (
      <div className="ih-loading">
        <div className="ih-arona">
          {/* 阿罗娜立绘：图集原件 Image_Char_Arona.png（npc_portrait 无 Arona，见文件头说明） */}
          <img
            className="ih-portrait"
            src={LOADING_ARONA.portrait.value}
            alt="Arona"
            draggable={false}
            data-ui-source="assetbundle"
          />
          <div className="ih-tip" data-ui-source="assetbundle">
            <img className="ih-badge" src={LOADING_ARONA.badge.value} alt="" draggable={false} />
            <span key={tipIdx} className="ih-tip-text">
              {tip}
            </span>
          </div>
        </div>
        <div className="ih-progress">
          <i />
        </div>
        <div className="ih-hint">{t('intro.loading')}…</div>
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
        {/* 走查⑧：BA 艺术字 logo 原件不在库——UI 图集 2536 精灵与 asset_map
            images 5453 张全量检索无命中；卡池横幅 jpg 上的 logo 与底纹焊死
            （无 alpha 通道，裁下带矩形色块，_crop-banner-jpg-logo.png 实测），
            不能当独立 logo 复用。按「没有原件就不伪造」继续走文字版式兜底，
            打 typography-fallback 标注；后续从游戏 bundle 提取 Title_Logo 后替换。 */}
        <div className="title-logo2" data-ui-source="typography-fallback" data-ui-sprite="BA_Title_Logo">
          BLUE ARCHIVE
        </div>
        <div className="title-logo-cn" data-ui-source="typography-fallback" data-ui-sprite="BA_Title_Logo">
          蔚蓝档案
        </div>
        <div className="title-tag">同 人 客 户 端</div>
      </div>
      <div className={`title-prompt${promptVisible ? ' on' : ''}`}>
        <span className="prompt-en">{TITLE_SCREEN.promptEn.value}</span>
        <span className="prompt-zh">{t('intro.tapToStart')}</span>
      </div>
      <div className="title-ver">v0.2.0 · 非官方同人 · 素材版权归 NAT GAMES / NEXON</div>
    </div>
  );
}
