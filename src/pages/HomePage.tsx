/**
 * 主界面（ロビー）
 *
 * 分区按日文 Wiki ロビー页的 ①~⑲ 标注：
 *   顶部栏（老师信息 / AP / 信用点 / 青辉石）
 *   右侧功能列（MomoTalk ①、Mission ②、Mail ③、Menu ④、Cafe ⑤、Student ⑥、Formation ⑦、Gacha ⑧）
 *   底部导航、事件横幅（右上圆形 + 左下方形）、看板娘、菜单弹窗
 *
 * 所有尺寸取自 game-ui-spec.ts 的 1920×1080 基准，按窗口宽度等比换算。
 * 图标优先用提取到的 UI 图集；没有原件时渲染中性占位并打 data-ui-source="css-fallback"，
 * 不伪造 BA 风格按钮（重构要求 3.3）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../core/AppContext';
import { useSave, store, cafeIncome } from '../core/store';
import { audio } from '../core/audio';
import { UIIcon } from '../components/NineSlice';
import { Glyph, type GlyphName } from '../components/Glyph';
import {
  TOP_BAR,
  SIDE_MENU,
  SIDE_MENU_SPEC,
  BOTTOM_NAV,
  EVENT_BANNER,
  MENU_POPUP,
} from '../core/game-ui-spec';
import { t } from '../core/i18n';
import type { View } from '../core/AppContext';

const SIDE_TARGET: Record<string, View> = {
  momotalk: 'momotalk',
  cafe: 'cafe',
  student: 'memorial',
  formation: 'memorial',
  gacha: 'gacha',
  mission: 'story',
  mail: 'momotalk',
  menu: 'settings',
};

const BOTTOM_ITEMS: { key: string; label: string; view: View; icon: GlyphName }[] = [
  { key: 'story', label: t('nav.story'), view: 'story', icon: 'story' },
  { key: 'momotalk', label: t('nav.momotalk'), view: 'momotalk', icon: 'momotalk' },
  { key: 'cafe', label: t('nav.cafe'), view: 'cafe', icon: 'cafe' },
  { key: 'memorial', label: t('nav.lobby'), view: 'memorial', icon: 'memorial' },
  { key: 'gacha', label: t('nav.gacha'), view: 'gacha', icon: 'gacha' },
];

/**
 * 1920×1080 基准的缩放系数。
 * 窗口比 1280 逻辑像素还窄时不再继续缩小（否则图标小到看不清），
 * 改为固定 1280/1920 的下限，靠布局锚点自适应。
 */
function useScale(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return Math.min(1.6, Math.max(1280 / 1920, w / 1920));
}

export default function HomePage() {
  const { assets, go, toast } = useApp();
  const save = useSave();
  const s = useScale();
  const P = useCallback((n: number) => Math.round(n * s), [s]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [bannerIdx, setBannerIdx] = useState(0);
  const holdTimer = useRef<number | null>(null);

  // 看板娘：优先上次选的学生，否则挑一个有回忆大厅封面的
  const kanban = useMemo(() => {
    const withLobby = assets.students.filter((x) => x.lobby && !x.is_npc);
    return withLobby.find((x) => x.id === 599) ?? withLobby[0] ?? assets.students[0] ?? null;
  }, [assets.students]);

  const kanbanBg = useMemo(() => {
    for (const name of ['BG_View_Schale', 'BG_CityOffice', 'BG_MainOffice']) {
      const url = assets.bg(name);
      if (url) return url;
    }
    return null;
  }, [assets]);

  // MomoTalk 未读：羁绊剧情里有会话但没读过的学生数
  const momoUnread = useMemo(() => {
    const keys = new Set<string>();
    for (const st of assets.storyIndex) {
      if (st.type !== 'bond') continue;
      const k = st.id.split('/')[0] ?? st.id;
      if (!save.momotalk.read.includes(k)) keys.add(k);
    }
    return keys.size;
  }, [assets.storyIndex, save.momotalk.read]);

  // 今天是否有学生过生日
  const birthdayToday = useMemo(() => {
    const d = new Date();
    const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return assets.students.filter((x) => x.birthday === md);
  }, [assets.students]);

  // 事件横幅轮播
  const banners = useMemo(
    () => assets.events.filter((e) => e.server === 'CN' || e.server === 'JP').slice(-8).reverse(),
    [assets.events]
  );
  useEffect(() => {
    if (banners.length <= 1) return;
    const id = window.setInterval(
      () => setBannerIdx((i) => (i + 1) % banners.length),
      EVENT_BANNER.switchIntervalMs.value
    );
    return () => window.clearInterval(id);
  }, [banners.length]);

  // 菜单弹窗：ESC 关闭（端到端测试也依赖这个行为，别再靠点坐标）
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // 咖啡厅收益提示
  const { amount } = cafeIncome(
    save.cafe.placed.reduce((a, id) => a + (assets.furniture.find((f) => f.id === id)?.comfort ?? 0), 0),
    Date.now() - save.cafe.lastCollect
  );

  const badgeText = (n: number): string =>
    n > 99 ? '+' : String(n).slice(0, SIDE_MENU_SPEC.badge.maxDigits.value);

  const handleSide = (key: string): void => {
    if (key === 'menu') {
      setMenuOpen(true);
      return;
    }
    if (key === 'momotalk' && birthdayToday.length > 0) {
      audio.playSe('SE_Celebration');
    }
    const target = SIDE_TARGET[key];
    if (target) go(target);
  };

  const onHoldStart = (): void => {
    holdTimer.current = window.setTimeout(() => {
      setUiHidden(true);
      toast(t('lobby.hideUi'));
    }, 600);
  };
  const onHoldEnd = (): void => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const teacher = save.teacher;
  const expPct = Math.min(100, (teacher.exp % 1000) / 10);

  return (
    <div
      className="home"
      onPointerDown={onHoldStart}
      onPointerUp={onHoldEnd}
      onPointerLeave={onHoldEnd}
    >
      {/* 背景：优先用当前看板娘的回忆大厅 CG，没有则退回校园背景 */}
      <div
        className="home-bg"
        style={
          kanban?.lobby
            ? { backgroundImage: `url(${kanban.lobby})`, filter: 'none', transform: 'scale(1)' }
            : kanbanBg
              ? { backgroundImage: `url(${kanbanBg})` }
              : undefined
        }
      />
      <div className="home-veil" />

      {!uiHidden && (
        <>
          {/* 顶部栏 */}
          <header className="home-top" style={{ height: P(TOP_BAR.height.value), padding: `0 ${P(TOP_BAR.paddingX.value)}px` }}>
            <div className="teacher">
              <div
                className="teacher-avatar"
                style={{ width: P(TOP_BAR.teacher.avatarSize.value), height: P(TOP_BAR.teacher.avatarSize.value) }}
              >
                {kanban?.avatar ? <img src={kanban.avatar} alt="" /> : 'T'}
              </div>
              <div className="teacher-info">
                <div className="teacher-line">
                  <span className="teacher-name" style={{ fontSize: P(TOP_BAR.teacher.nameFontSize.value) }}>
                    {teacher.name}
                  </span>
                  <span className="teacher-level" style={{ fontSize: P(TOP_BAR.teacher.levelFontSize.value) }}>
                    Lv.{teacher.level}
                  </span>
                </div>
                <div
                  className="exp-bar"
                  style={{ width: P(TOP_BAR.teacher.expBarWidth.value), height: P(TOP_BAR.teacher.expBarHeight.value) }}
                >
                  <i style={{ width: `${expPct}%` }} />
                </div>
              </div>
            </div>

            <div className="resources" style={{ gap: P(TOP_BAR.resources.gap.value) }}>
              <div className="res" title={t('lobby.ap')}>
                <UIIcon name="icon_ap" size={P(TOP_BAR.resources.iconSize.value)} fallback="⚡" />
                <b style={{ fontSize: P(TOP_BAR.resources.fontSiz.value) }}>240</b>
                <span className="plus">+</span>
              </div>
              <div className="res" title={t('lobby.credit')}>
                <UIIcon name="icon_credit" size={P(TOP_BAR.resources.iconSize.value)} fallback="◈" />
                <b style={{ fontSize: P(TOP_BAR.resources.fontSiz.value) }}>
                  {(save.currency.pyroxene * 10).toLocaleString()}
                </b>
              </div>
              <div className="res" title={t('lobby.pyroxene')}>
                <UIIcon name="icon_pyroxene" size={P(TOP_BAR.resources.iconSize.value)} fallback="✦" />
                <b style={{ fontSize: P(TOP_BAR.resources.fontSiz.value) }}>
                  {save.currency.pyroxene.toLocaleString()}
                </b>
                <span
                  className="plus"
                  onClick={() => toast('本软件不提供任何购买途径，青辉石只能通过签到、咖啡厅与剧情首通获得')}
                >
                  +
                </span>
              </div>
            </div>
          </header>

          {/* 右侧功能列 */}
          <aside
            className="home-side"
            style={{ right: P(SIDE_MENU_SPEC.rightMargin.value), bottom: P(SIDE_MENU_SPEC.bottomOffset.value), gap: P(SIDE_MENU_SPEC.gap.value) }}
          >
            {SIDE_MENU.map((item) => {
              const isMomo = item.key === 'momotalk';
              const hasBirthday = isMomo && birthdayToday.length > 0;
              const unread = isMomo ? momoUnread : item.key === 'cafe' ? (amount > 0 ? 1 : 0) : 0;
              return (
                <button
                  key={item.key}
                  className={`side-btn${hasBirthday ? ' birthday' : ''}`}
                  style={{ width: P(SIDE_MENU_SPEC.iconSize.value), height: P(SIDE_MENU_SPEC.iconSize.value) }}
                  onClick={() => handleSide(item.key)}
                  title={item.label}
                  data-zone={item.zone}
                >
                  <UIIcon
                    name={`icon_${item.key}`}
                    size={P(SIDE_MENU_SPEC.iconSize.value * 0.6)}
                    fallback={
                      <Glyph
                        name={hasBirthday ? 'gacha' : (item.key as GlyphName)}
                        size={P(SIDE_MENU_SPEC.iconSize.value * 0.6)}
                        style={hasBirthday ? { color: '#ffd76e' } : undefined}
                      />
                    }
                  />
                  {unread > 0 && (
                    <span
                      className="side-badge"
                      style={{
                        fontSize: P(SIDE_MENU_SPEC.badge.fontSiz.value),
                        minWidth: P(SIDE_MENU_SPEC.badge.size.value),
                        height: P(SIDE_MENU_SPEC.badge.size.value),
                      }}
                    >
                      {badgeText(unread)}
                    </span>
                  )}
                </button>
              );
            })}
          </aside>

          {/* 看板娘信息条 */}
          {kanban && (
            <div className="kanban-bar" style={{ left: P(EVENT_BANNER.square.left.value), bottom: P(EVENT_BANNER.square.bottom.value + EVENT_BANNER.square.height.value + 12) }}>
              <span className="kanban-name">{kanban.name}</span>
              <button className="kanban-toggle" onClick={() => go('memorial')} title="进入记忆大厅">
                L2D
              </button>
            </div>
          )}

          {/* 事件横幅 */}
          {banners[bannerIdx] && (
            <>
              <div
                className="banner-round"
                style={{
                  width: P(EVENT_BANNER.round.size.value),
                  height: P(EVENT_BANNER.round.size.value),
                  top: P(EVENT_BANNER.round.top.value),
                  right: P(EVENT_BANNER.round.right.value),
                }}
                onClick={() => go('events')}
                title={banners[bannerIdx]!.title}
              >
                <span>{banners[bannerIdx]!.title.slice(0, 6)}</span>
              </div>
              <div
                className="banner-square"
                style={{
                  width: P(EVENT_BANNER.square.width.value),
                  height: P(EVENT_BANNER.square.height.value),
                  left: P(EVENT_BANNER.square.left.value),
                  bottom: P(EVENT_BANNER.square.bottom.value),
                }}
                onClick={() => go('events')}
              >
                <b>{banners[bannerIdx]!.title}</b>
                <span>
                  {new Date(banners[bannerIdx]!.start * 1000).toLocaleDateString('zh-CN')} 起
                </span>
              </div>
            </>
          )}

          {/* 底部导航 */}
          <nav className="home-bottom" style={{ height: P(BOTTOM_NAV.height.value) }}>
            {BOTTOM_ITEMS.map((it) => (
              <button key={it.key} className="bottom-item" onClick={() => go(it.view)}>
                <UIIcon
                  name={`nav_${it.key}`}
                  size={P(BOTTOM_NAV.iconSize.value)}
                  fallback={<Glyph name={it.icon} size={P(BOTTOM_NAV.iconSize.value)} />}
                />
                <span style={{ fontSize: P(BOTTOM_NAV.labelFontSize.value) }}>{it.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {uiHidden && (
        <button className="show-ui" onClick={() => setUiHidden(false)}>
          {t('lobby.showUi')}
        </button>
      )}

      {/* 菜单弹窗 */}
      {menuOpen && (
        <div
          className="menu-dim"
          style={{ background: `rgba(6,14,24,${MENU_POPUP.dimAlpha.value})` }}
          onClick={() => setMenuOpen(false)}
        >
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            {MENU_POPUP.items.value.map((key) => (
              <button key={key} className="menu-item" onClick={() => setMenuOpen(false)}>
                <UIIcon
                  name={`menu_${key}`}
                  size={P(MENU_POPUP.iconSize.value)}
                  fallback={<Glyph name={key as GlyphName} size={P(MENU_POPUP.iconSize.value)} />}
                />
                <span>{t(`menu.${key}`)}</span>
              </button>
            ))}
            <button
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                go('settings');
              }}
            >
              <UIIcon
                name="menu_settings"
                size={P(MENU_POPUP.iconSize.value)}
                fallback={<Glyph name="settings" size={P(MENU_POPUP.iconSize.value)} />}
              />
              <span>{t('nav.settings')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
