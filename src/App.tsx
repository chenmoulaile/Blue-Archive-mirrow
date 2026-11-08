import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, type View } from './core/AppContext';
import { loadAssets, type AssetBundle } from './core/assets';
import { store, useSave } from './core/store';
import { audio } from './core/audio';
import { loadUIAtlas, injectUIFonts, type UIAtlas } from './core/ui-atlas';
import { setLocale, t } from './core/i18n';
import { TOP_CURRENCY_ICONS, TOP_SIGNIN_ICON } from './core/game-ui-spec';
import { UIIcon } from './components/NineSlice';
import { Glyph, type GlyphName } from './components/Glyph';
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

const NAV: { key: View; icon: GlyphName; labelKey: string }[] = [
  { key: 'home', icon: 'home', labelKey: 'nav.lobby' },
  { key: 'memorial', icon: 'memorial', labelKey: 'nav.student' },
  { key: 'story', icon: 'story', labelKey: 'nav.story' },
  { key: 'gacha', icon: 'gacha', labelKey: 'nav.gacha' },
  { key: 'momotalk', icon: 'momotalk', labelKey: 'nav.momotalk' },
  { key: 'cafe', icon: 'cafe', labelKey: 'nav.cafe' },
  { key: 'events', icon: 'events', labelKey: 'nav.events' },
  { key: 'settings', icon: 'settings', labelKey: 'nav.settings' },
];

const TITLE_KEYS: Record<View, string> = {
  home: 'nav.lobby',
  memorial: 'nav.student',
  story: 'nav.story',
  gacha: 'nav.gacha',
  momotalk: 'nav.momotalk',
  cafe: 'nav.cafe',
  events: 'nav.events',
  settings: 'nav.settings',
};

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

  // 主题：默认 dark-game（深色游戏风），可在设置页切回 light
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

  // 主界面是全屏游戏界面，不套侧边栏
  if (view === 'home') {
    return (
      <AppContext.Provider value={ctx}>
        <HomePage />
        {toastMsg && <Toast msg={toastMsg} />}
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="mark">BA</div>
            <div>
              <b>{t('app.title')}</b>
              <span>FAN CLIENT</span>
            </div>
          </div>
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item${view === n.key ? ' on' : ''}`}
              onClick={() => setView(n.key)}
            >
              <span className="ico">
                <Glyph name={n.icon} size={17} />
              </span>
              {t(n.labelKey)}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="nav-item" onClick={restartIntro}>
            <span className="ico">
              <Glyph name="restart" size={17} />
            </span>
            重播启动
          </button>
        </aside>

        <div className="main">
          <div className="topbar">
            <h2>{t(TITLE_KEYS[view])}</h2>
            <div className="wallet">
              {/* 2026-11-08 走查①：内页顶栏货币胶囊统一为主页顶栏同款深色胶囊
                  （深底白字 + 青辉石宝石原件），原来白底浅字 + CSS 圆点对比度极低；
                  「✦ N 天」语义不明，改为「签到 N 天」+ 日历原件。 */}
              <div className="chip" title="虚拟青辉石（仅本软件内可用）">
                <UIIcon
                  name={TOP_CURRENCY_ICONS.pyroxene.value}
                  size={16}
                  fallback={<span>✦</span>}
                />
                {save.currency.pyroxene.toLocaleString()}
              </div>
              <div className="chip" title={`连续签到 ${save.signIn.streak} 天`}>
                <UIIcon name={TOP_SIGNIN_ICON.value} size={15} fallback={<span>✦</span>} />
                签到 {save.signIn.streak} 天
              </div>
            </div>
          </div>

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
      </div>

      {toastMsg && <Toast msg={toastMsg} />}
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
