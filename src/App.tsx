import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, type View } from './core/AppContext';
import { loadAssets, type AssetBundle } from './core/assets';
import { store, useSave } from './core/store';
import { audio } from './core/audio';
import { loadUIAtlas, injectUIFonts, type UIAtlas } from './core/ui-atlas';
import { setLocale, t } from './core/i18n';
import { apRecharge, AP_MAX } from './core/store';
import { AP_REGEN } from './core/game-ui-spec';
import PortraitStage from './components/stage/PortraitStage';
import TopCurrencyBar from './components/stage/TopCurrencyBar';
import type { AppInfo } from './types';
import IntroFlow from './pages/IntroFlow';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import StoryPage from './pages/StoryPage';
import GachaPage from './pages/GachaPage';
import MomoTalkPage from './pages/MomoTalkPage';
import CafePage from './pages/CafePage';
import EventsPage from './pages/EventsPage';
import SettingsPage from './pages/SettingsPage';
import SetupWizard from './pages/SetupWizard';
import './styles/cursors.css';
import './styles/game-theme.css';

export type { View };

/**
 * 极简路由：view ↔ URL。
 *
 * 不引 react-router —— 页面之间没有嵌套路由，也没有 loader，
 * 用 History API 把 view 同步到地址栏就够了。主进程的静态服务器
 * 对无扩展名路径做了 index.html 回退，所以 /lobby 直接刷新也能进。
 *
 * 约定：/ = 大厅（标题页只在启动流程里出现）、/lobby = 记忆大厅、/settings = 设置。
 */
const PATH_OF: Record<View, string> = {
  home: '/',
  memorial: '/lobby',
  story: '/story',
  gacha: '/gacha',
  momotalk: '/momotalk',
  cafe: '/cafe',
  events: '/events',
  settings: '/settings',
};

const VIEW_OF: Record<string, View> = Object.fromEntries(
  (Object.keys(PATH_OF) as View[]).map((v) => [PATH_OF[v], v])
);

function viewFromPath(pathname: string): View {
  const p = pathname.replace(/\/+$/, '') || '/';
  return VIEW_OF[p] ?? 'home';
}

export default function App() {
  const [assets, setAssets] = useState<AssetBundle | null>(null);
  const [uiAtlas, setUiAtlas] = useState<UIAtlas>({
    source: 'none',
    sprites: {},
    fonts: {},
    nineslice: {},
  });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [setupDone, setSetupDone] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(() => viewFromPath(window.location.pathname));
  const [intro, setIntro] = useState(true);
  const [toastMsg, setToastMsg] = useState<string>('');
  const save = useSave();

  // 切换页面时同步地址栏；浏览器的前进/后退也能回到对应页面
  const setView = useCallback((v: View) => {
    setViewState(v);
    const p = PATH_OF[v];
    if (window.location.pathname !== p) window.history.pushState({ view: v }, '', p);
  }, []);

  useEffect(() => {
    const onPop = (): void => setViewState(viewFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [a, i, atlas] = await Promise.all([loadAssets(), window.baApi.info(), loadUIAtlas()]);
        await store.init();
        if (!alive) return;
        injectUIFonts(atlas);
        setAssets(a);
        setInfo(i);
        setSetupDone(i.setupDone);
        setUiAtlas(atlas);
      } catch (e) {
        if (alive) setBootError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 语言：默认 zh-CN，改设置立即生效
  useEffect(() => {
    setLocale(save.settings.locale);
    document.documentElement.lang = save.settings.locale;
  }, [save.settings.locale]);

  // 鼠标指针开关
  useEffect(() => {
    document.documentElement.classList.toggle('no-custom-cursor', !save.settings.useCustomCursor);
  }, [save.settings.useCustomCursor]);

  // 主题：默认明亮浅色（P0-3），设置页可切深色 dark-game
  useEffect(() => {
    document.documentElement.dataset.theme = save.settings.theme;
  }, [save.settings.theme]);

  useEffect(() => {
    audio.setVolumes(save.settings.bgmVolume, save.settings.seVolume);
  }, [save.settings.bgmVolume, save.settings.seVolume]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? '' : cur)), 2600);
  }, []);

  const restartIntro = useCallback(() => setIntro(true), []);

  const ctx = useMemo(
    () =>
      assets && info
        ? {
            assets,
            uiAtlas,
            resourceDir: info.resourceDir,
            version: info.version,
            settings: save.settings,
            locale: save.settings.locale,
            toast,
            go: setView,
            restartIntro,
          }
        : null,
    [assets, info, uiAtlas, save.settings, toast, restartIntro]
  );

  // 内页顶栏的实时体力（与主界面同一套离线恢复逻辑）
  const apValue = useMemo(() => {
    const base = save.ap ?? { value: AP_MAX, updatedAt: Date.now() };
    return apRecharge(base, Date.now()).value;
  }, [save.ap]);

  if (bootError) {
    return (
      <div className="boot">
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <h2 style={{ color: '#c0392b' }}>启动失败</h2>
          <p style={{ color: '#4a5b6a', lineHeight: 1.8 }}>{bootError}</p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            请确认已运行 <code>python tools/fetch/kivo.py meta</code> 生成 data/ 下的数据文件，
            且 resources/ 目录中有素材。
          </p>
        </div>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="boot" data-loading="true">
        <div>
          <div className="halo" style={{ margin: '0 auto' }} />
          <p>{t('intro.connecting')}…</p>
        </div>
      </div>
    );
  }

  // 首次启动向导：确认素材来源（游戏解包目录 / 跳过走截图切图兜底）
  if (!setupDone && info) {
    return <SetupWizard info={info} onDone={() => setSetupDone(true)} />;
  }

  if (intro) {
    return (
      <AppContext.Provider value={ctx}>
        <IntroFlow onDone={() => setIntro(false)} />
      </AppContext.Provider>
    );
  }

  // 通用货币顶栏（P0-1）：体力/信用点/青辉石 + 左上返回 + 右侧商店/菜单。
  // backLabel「大厅」保留 e2e 以 .nav-item 回主界面的既有语义。
  const currencyBar = (
    <TopCurrencyBar
      ap={{ value: apValue, max: AP_REGEN.max.value, title: `体力（每 ${AP_REGEN.minutesPerPoint.value} 分钟恢复 1 点）` }}
      credit={save.currency.credit ?? 0}
      pyroxene={save.currency.pyroxene}
      currencyHint="虚拟青辉石（仅本软件内可用）"
      onBack={() => setView('home')}
      backClassName="nav-item"
      onShop={() => ctx.toast('商店尚未实装（信用点与道具在剧情奖励中发放）')}
      onMenu={() => setView('settings')}
    />
  );

  return (
    <AppContext.Provider value={ctx}>
      {/* G-1 竖屏舞台：全部游戏页面都渲染进 1080×1920 逻辑画框，外层 letterbox */}
      <PortraitStage>
        {view === 'home' ? (
          <HomePage />
        ) : (
          <div className="inner-page">
            {currencyBar}
            <div className="content">
              {view === 'memorial' && <LobbyPage />}
              {view === 'story' && <StoryPage />}
              {view === 'gacha' && <GachaPage />}
              {view === 'momotalk' && <MomoTalkPage />}
              {view === 'cafe' && <CafePage />}
              {view === 'events' && <EventsPage onGo={setView} />}
              {view === 'settings' && <SettingsPage onGo={setView} />}
            </div>
          </div>
        )}
        {toastMsg && <Toast msg={toastMsg} />}
      </PortraitStage>
    </AppContext.Provider>
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 34,
        transform: 'translateX(-50%)',
        background: 'rgba(30,50,70,0.92)',
        color: '#fff',
        padding: '10px 22px',
        borderRadius: 999,
        fontSize: 13,
        zIndex: 999,
        boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
        animation: 'fadeUp 0.2s',
      }}
    >
      {msg}
    </div>
  );
}
