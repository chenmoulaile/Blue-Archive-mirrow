/**
 * 主界面（ロビー）—— 进入流程第一屏之后的游戏大厅
 *
 * 布局对照真实游戏（Wiki ロビー分区 + Steam 简中客户端 + 报告二视频一帧 1）：
 *   - 顶栏：老师信息（等级/经验）+ 体力(AP)/信用点/青辉石，数字全部走 store
 *     （AP 按离线时长恢复，参数见 AP_REGEN；信用点/青辉石在 save.currency）
 *   - 中央：学生回忆大厅 Spine 模型（LobbyStage，滚轮缩放/拖拽平移/点击互动）
 *   - 右侧竖排功能菜单：日程表/作战/咖啡厅/商店/社团/制造/招募/邮件/菜单，
 *     九宫格真素材按钮（Common_Btn_Circle_W 底板 + 图集图标）
 *   - 左下：事件横幅（右下三角切角）+ 学生名条（头像+彩带）——同一个 flex
 *     纵列自下而上堆叠；编队/任务入口已并入底部黑条（P0-2，原版左下无此二者）
 *   - 右下：MomoTalk 大入口 + 未读角标（联动桃信轨的 bond 会话未读数）
 *   - 底部黑条：编队/任务/挑战任务/剧情/社团/道具/资料馆/招募（P0-2 原版
 *     入口集）；桃信不进底条（右下大入口）、咖啡厅走右侧菜单
 *
 * 坐标系约定（G-1）：本页渲染在 PortraitStage 的 1080×1920 逻辑画框内，
 * 所有尺寸直接用 game-ui-spec 的逻辑 px，不再读窗口宽度换算（缩放由舞台统一做）。
 *
 * 按钮反馈 SE 统一走 audio.playSe（LOBBY_SE，se_index.json 实测存在）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../core/AppContext';
import { useSave, store, cafeIncome, apRecharge, AP_MAX } from '../core/store';
import { audio } from '../core/audio';
import { UIIcon } from '../components/NineSlice';
import { nineSliceStyle } from '../core/ui-atlas';
import { Glyph, type GlyphName } from '../components/Glyph';
import { LobbyStage, bondFavorKey } from '../components/LobbyStage';
import {
  TOP_BAR,
  BOTTOM_NAV,
  EVENT_BANNER,
  MENU_POPUP,
  SIDE_MENU_REAL,
  SIDE_MENU_REAL_SPEC,
  MOMOTALK_ENTRY,
  TOP_CURRENCY_ICONS,
  AP_REGEN,
  LOBBY_SE,
} from '../core/game-ui-spec';
import { t } from '../core/i18n';
import type { View } from '../core/AppContext';
import type { Student } from '../types';
import '../styles/lobby.css';

/** 右侧菜单的跳转目标；没有实装页的项给 toast 提示 */
const SIDE_TARGET: Partial<Record<string, View>> = {
  mission: 'story',
  cafe: 'cafe',
  gacha: 'gacha',
  mail: 'momotalk',
  schedule: 'events',
};

const NOT_IMPLEMENTED: Partial<Record<string, string>> = {
  shop: '商店尚未实装（信用点与道具在剧情奖励中发放）',
  club: '社团尚未实装',
  craft: '制造尚未实装',
};

/** 图集缺失时 Glyph 兜底用的近似图标（GlyphName 里没有 schedule/shop/club/craft） */
const SIDE_GLYPH_FALLBACK: Record<string, GlyphName> = {
  schedule: 'events',
  mission: 'mission',
  cafe: 'cafe',
  shop: 'item',
  club: 'student',
  craft: 'equipment',
  gacha: 'gacha',
  mail: 'mail',
  menu: 'menu',
};

/**
 * 底部黑条入口的文案与图标（P0-2）：构成来自 BOTTOM_NAV.items（报告二 B4 视频一帧 1）。
 * 动作在组件内 bottomActions（未实装的入口给 toast，保持入口齐全与原版一致）。
 */
type BottomKey = (typeof BOTTOM_NAV.items.value)[number];
const BOTTOM_META: Record<BottomKey, { labelKey: string; icon: GlyphName }> = {
  formation: { labelKey: 'nav.formation', icon: 'formation' },
  mission: { labelKey: 'nav.mission', icon: 'mission' },
  sub: { labelKey: 'nav.sub', icon: 'mission' },
  story: { labelKey: 'nav.story', icon: 'story' },
  club: { labelKey: 'nav.club', icon: 'student' },
  item: { labelKey: 'nav.item', icon: 'item' },
  archive: { labelKey: 'nav.archive', icon: 'scrapbook' },
  gacha: { labelKey: 'nav.gacha', icon: 'gacha' },
};

export default function HomePage() {
  const { assets, go, toast, uiAtlas, restartIntro } = useApp();
  const save = useSave();

  /**
   * 九宫格按钮底板内联样式。
   * 不走 NineSlice 组件的原因：e2e 依赖 `.side-btn[data-zone="④"]`，
   * data-zone 必须直接挂在 button 上（NineSlice 不透传 data-*）。
   * 图集缺失时返回空对象，按钮退回 global.css 的毛玻璃兜底样式。
   */
  const nsPlate = useCallback(
    (name: string): CSSProperties => {
      const sp = uiAtlas.sprites[name];
      return sp ? nineSliceStyle(sp, true) : {};
    },
    [uiAtlas]
  );
  const hasPlate = (name: string): boolean => Boolean(uiAtlas.sprites[name]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [bannerIdx, setBannerIdx] = useState(0);
  const [line, setLine] = useState('');
  const [apNow, setApNow] = useState(() => Date.now());
  const holdTimer = useRef<number | null>(null);
  const lineTimer = useRef<number | null>(null);

  // 中央学生：优先上次选的（599 是记忆大厅默认位），否则第一个有 home 模型的
  const lobbyStudents = useMemo(
    () => assets.students.filter((x) => x.home_spine && !x.is_npc),
    [assets.students]
  );
  const kanban = useMemo(() => {
    const withLobby = lobbyStudents.length > 0 ? lobbyStudents : assets.students;
    return withLobby.find((x) => x.id === 599) ?? withLobby[0] ?? null;
  }, [lobbyStudents, assets.students]);

  // 好感度 key：与桃信轨共用 save.momotalk.favor，key 取 bond 会话前缀
  // （算法在 LobbyStage.bondFavorKey，记忆大厅页共用同一份，2026-11-08 抽出）
  const favorKey = useMemo(
    () => (kanban ? bondFavorKey(assets.storyIndex, kanban) : null),
    [assets.storyIndex, kanban]
  );

  const kanbanBg = useMemo(() => {
    for (const name of ['BG_View_Schale', 'BG_CityOffice', 'BG_MainOffice']) {
      const url = assets.bg(name);
      if (url) return url;
    }
    return null;
  }, [assets]);

  // MomoTalk 未读：羁绊剧情里有会话但没读过的学生数（与桃信轨同一约定）
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
      if (e.key === 'Escape') {
        setMenuOpen(false);
        audio.playSe(LOBBY_SE.popupClose.value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // 体力：每 tickMs 重算显示；离线恢复的部分写回 store（有变化才写）
  useEffect(() => {
    const id = window.setInterval(() => setApNow(Date.now()), AP_REGEN.tickMs.value);
    return () => window.clearInterval(id);
  }, []);
  const apValue = useMemo(() => {
    const base = save.ap ?? { value: AP_MAX, updatedAt: Date.now() };
    return apRecharge(base, apNow).value;
  }, [save.ap, apNow]);
  useEffect(() => {
    const base = save.ap ?? { value: AP_MAX, updatedAt: Date.now() };
    const charged = apRecharge(base, Date.now());
    if (charged.value !== base.value) {
      store.update((d) => {
        d.ap = charged;
      });
    }
  }, [save.ap]);

  // 咖啡厅收益提示
  const { amount } = cafeIncome(
    save.cafe.placed.reduce((a, id) => a + (assets.furniture.find((f) => f.id === id)?.comfort ?? 0), 0),
    Date.now() - save.cafe.lastCollect
  );

  const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));

  const se = useCallback((id: string) => audio.playSe(id), []);

  const handleSide = useCallback(
    (key: string) => {
      se(LOBBY_SE.click.value);
      if (key === 'menu') {
        setMenuOpen(true);
        se(LOBBY_SE.popupOpen.value);
        return;
      }
      if (key === 'mail' && birthdayToday.length > 0) {
        se(LOBBY_SE.bell.value);
      }
      const hint = NOT_IMPLEMENTED[key];
      if (hint) {
        toast(hint);
        return;
      }
      const target = SIDE_TARGET[key];
      if (target) go(target);
    },
    [se, toast, go, birthdayToday]
  );

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

  const showLine = useCallback((msg: string) => {
    setLine(msg);
    if (lineTimer.current) window.clearTimeout(lineTimer.current);
    lineTimer.current = window.setTimeout(() => setLine(''), 2600);
  }, []);

  const teacher = save.teacher;
  const expPct = Math.min(100, (teacher.exp % 1000) / 10);

  // 底部黑条动作（P0-2）：跳页类直跳，未实装类 toast（在渲染前组装好依赖）
  const bottomActions = useMemo(() => {
    const map: Record<BottomKey, () => void> = {
      formation: () => go('memorial'),
      mission: () => go('story'),
      sub: () => toast('挑战任务尚未实装'),
      story: () => go('story'),
      club: () => toast('社团尚未实装'),
      item: () => toast('道具尚未实装'),
      archive: () => toast('资料馆尚未实装'),
      gacha: () => go('gacha'),
    };
    return map;
  }, [go, toast]);

  return (
    <div
      className="home"
      onPointerDown={onHoldStart}
      onPointerUp={onHoldEnd}
      onPointerLeave={onHoldEnd}
    >
      {/* 背景：当前学生的回忆大厅 CG；模型缺失时它也撑住画面 */}
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

      {/* 中央学生 Spine（缩放/拖拽/点击互动见 LobbyStage） */}
      <LobbyStage
        student={kanban}
        favorKey={favorKey}
        onLine={showLine}
        className="home-stage"
      />

      {!uiHidden && (
        <>
          {/* 顶栏 */}
          <header className="home-top" style={{ height: TOP_BAR.height.value, padding: `0 ${TOP_BAR.paddingX.value}px` }}>
            <div className="teacher">
              <div
                className="teacher-avatar"
                style={{ width: TOP_BAR.teacher.avatarSize.value, height: TOP_BAR.teacher.avatarSize.value }}
              >
                {kanban?.avatar ? <img src={kanban.avatar} alt="" /> : 'T'}
              </div>
              <div className="teacher-info">
                <div className="teacher-line">
                  <span className="teacher-name" style={{ fontSize: TOP_BAR.teacher.nameFontSize.value }}>
                    {teacher.name}
                  </span>
                  <span className="teacher-level" style={{ fontSize: TOP_BAR.teacher.levelFontSize.value }}>
                    Lv.{teacher.level}
                  </span>
                </div>
                <div
                  className="exp-bar"
                  style={{ width: TOP_BAR.teacher.expBarWidth.value, height: TOP_BAR.teacher.expBarHeight.value }}
                >
                  <i style={{ width: `${expPct}%` }} />
                </div>
              </div>
            </div>

            <div className="resources" style={{ gap: TOP_BAR.resources.gap.value }}>
              <div className="res" title={`${t('lobby.ap')}（每 ${AP_REGEN.minutesPerPoint.value} 分钟恢复 1 点）`}>
                <UIIcon name={TOP_CURRENCY_ICONS.stamina.value} size={TOP_BAR.resources.iconSize.value} fallback="⚡" />
                <b style={{ fontSize: TOP_BAR.resources.fontSiz.value }}>
                  {apValue}/{AP_REGEN.max.value}
                </b>
                <span className="plus">+</span>
              </div>
              <div className="res" title={t('lobby.credit')}>
                <UIIcon name={TOP_CURRENCY_ICONS.credit.value} size={TOP_BAR.resources.iconSize.value} fallback="◈" />
                <b style={{ fontSize: TOP_BAR.resources.fontSiz.value }}>
                  {(save.currency.credit ?? 0).toLocaleString()}
                </b>
              </div>
              <div className="res" title={t('lobby.pyroxene')}>
                <UIIcon name={TOP_CURRENCY_ICONS.pyroxene.value} size={TOP_BAR.resources.iconSize.value} fallback="✦" />
                <b style={{ fontSize: TOP_BAR.resources.fontSiz.value }}>
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

          {/* 右侧功能菜单（九宫格真素材按钮；咖啡厅入口在此，不进底条） */}
          <aside
            className="home-side"
            style={{
              right: SIDE_MENU_REAL_SPEC.rightMargin.value,
              bottom: SIDE_MENU_REAL_SPEC.bottomOffset.value,
              gap: SIDE_MENU_REAL_SPEC.gap.value,
            }}
          >
            {SIDE_MENU_REAL.map((item) => {
              const plate = SIDE_MENU_REAL_SPEC.plate.value;
              const bday = item.key === 'mail' && birthdayToday.length > 0;
              // 咖啡厅有可领收益时亮角标（真实游戏咖啡厅图标会提示收益）
              const cafeReady = item.key === 'cafe' && amount > 0;
              return (
                <button
                  key={item.key}
                  className={`side-btn${hasPlate(plate) ? ' ns' : ''}${bday ? ' birthday' : ''}`}
                  style={{
                    ...nsPlate(plate),
                    width: SIDE_MENU_REAL_SPEC.iconSize.value,
                    height: SIDE_MENU_REAL_SPEC.iconSize.value,
                  }}
                  data-zone={item.zone}
                  data-ui-sprite={plate}
                  data-ui-source={hasPlate(plate) ? 'assetbundle' : 'css-fallback'}
                  onClick={() => handleSide(item.key)}
                  title={item.label}
                >
                  <UIIcon
                    name={item.icon}
                    size={SIDE_MENU_REAL_SPEC.iconSize.value * 0.58}
                    fallback={<Glyph name={SIDE_GLYPH_FALLBACK[item.key] ?? 'menu'} size={SIDE_MENU_REAL_SPEC.iconSize.value * 0.58} />}
                  />
                  {cafeReady && (
                    <span className="side-badge" style={{ fontSize: 13, minWidth: 22, height: 22 }}>
                      ¥
                    </span>
                  )}
                </button>
              );
            })}
          </aside>

          {/* 左下纵列：事件横幅（右下三角切角）+ 学生名条（头像+彩带）。
              编队/任务入口已并入底部黑条（P0-2，原版左下无独立编队按钮）。 */}
          <div
            className="lb-left"
            style={{ left: EVENT_BANNER.square.left.value, bottom: EVENT_BANNER.square.bottom.value }}
          >
            {/* 事件横幅（方形切角，点击进活动页） */}
            {banners[bannerIdx] && (
              <div
                className="banner-square"
                style={{
                  width: EVENT_BANNER.square.width.value,
                  height: EVENT_BANNER.square.height.value,
                }}
                onClick={() => {
                  se(LOBBY_SE.click.value);
                  go('events');
                }}
              >
                <b>{banners[bannerIdx]!.title}</b>
                <span>
                  {new Date(banners[bannerIdx]!.start * 1000).toLocaleDateString('zh-CN')} 起
                </span>
              </div>
            )}

            {/* 学生名条：头像 + 彩带名字（B5）+ 语音字幕（.lb-namebar span 仍是字幕，
                头像用 <i> 承载避免改变 span 语义） */}
            {kanban && (
              <div className="lb-namebar">
                <i className="lb-avatar" aria-hidden="true">
                  {kanban.avatar ? <img src={kanban.avatar} alt="" /> : <Glyph name="student" size={36} />}
                </i>
                <b>{kanban.name}</b>
                {line && <span>{line}</span>}
              </div>
            )}
          </div>

          {/* 右下：MomoTalk 大入口 + 未读角标（生日当天抖动提示）。
              桃信入口保持在右下（P0-2：不进底条） */}
          <button
            className={`lb-momo${birthdayToday.length > 0 ? ' birthday' : ''}`}
            style={{
              width: MOMOTALK_ENTRY.width.value,
              height: MOMOTALK_ENTRY.height.value,
              right: MOMOTALK_ENTRY.right.value,
              bottom: MOMOTALK_ENTRY.bottom.value,
            }}
            onClick={() => {
              se(LOBBY_SE.click.value);
              go('momotalk');
            }}
            title="MomoTalk"
          >
            <UIIcon
              name={MOMOTALK_ENTRY.icon.value}
              size={MOMOTALK_ENTRY.width.value * 0.72}
              fallback={<Glyph name="momotalk" size={MOMOTALK_ENTRY.width.value * 0.6} />}
            />
            {momoUnread > 0 && (
              <span
                className="lb-momo-badge"
                style={{ fontSize: 13, minWidth: 24, height: 24 }}
              >
                {badgeText(momoUnread)}
              </span>
            )}
          </button>

          {/* 事件横幅（右上圆形，与左下纵列解耦） */}
          {banners[bannerIdx] && (
            <div
              className="banner-round"
              style={{
                width: EVENT_BANNER.round.size.value,
                height: EVENT_BANNER.round.size.value,
                top: EVENT_BANNER.round.top.value,
                right: EVENT_BANNER.round.right.value + SIDE_MENU_REAL_SPEC.iconSize.value + SIDE_MENU_REAL_SPEC.rightMargin.value,
              }}
              onClick={() => {
                se(LOBBY_SE.click.value);
                go('events');
              }}
              title={banners[bannerIdx]!.title}
            >
              <span>{banners[bannerIdx]!.title.slice(0, 6)}</span>
            </div>
          )}

          {/* 底部黑条（P0-2 原版入口集；e2e 依赖 .bottom-item） */}
          <nav className="home-bottom" style={{ height: BOTTOM_NAV.height.value }}>
            {BOTTOM_NAV.items.value.map((key) => {
              const act = BOTTOM_META[key];
              return (
                <button
                  key={key}
                  className="bottom-item"
                  data-bottom-key={key}
                  onClick={() => {
                    se(LOBBY_SE.click.value);
                    bottomActions[key]();
                  }}
                >
                  <UIIcon
                    name={`nav_${key}`}
                    size={BOTTOM_NAV.iconSize.value}
                    fallback={<Glyph name={act.icon} size={BOTTOM_NAV.iconSize.value} />}
                  />
                  <span style={{ fontSize: BOTTOM_NAV.labelFontSize.value }}>{t(act.labelKey)}</span>
                </button>
              );
            })}
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
          onClick={() => {
            setMenuOpen(false);
            se(LOBBY_SE.popupClose.value);
          }}
        >
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            {MENU_POPUP.items.value.map((key) => (
              <button key={key} className="menu-item" onClick={() => se(LOBBY_SE.click.value)}>
                <UIIcon
                  name={`menu_${key}`}
                  size={MENU_POPUP.iconSize.value}
                  fallback={<Glyph name={key as GlyphName} size={MENU_POPUP.iconSize.value} />}
                />
                <span>{t(`menu.${key}`)}</span>
              </button>
            ))}
            <button
              className="menu-item"
              onClick={() => {
                se(LOBBY_SE.click.value);
                setMenuOpen(false);
                go('settings');
              }}
            >
              <UIIcon
                name="menu_settings"
                size={MENU_POPUP.iconSize.value}
                fallback={<Glyph name="settings" size={MENU_POPUP.iconSize.value} />}
              />
              <span>{t('nav.settings')}</span>
            </button>
            {/* 原侧栏「重播启动」入口并入菜单弹窗（P0-1 拆侧栏后功能保持可达） */}
            <button
              className="menu-item"
              onClick={() => {
                se(LOBBY_SE.click.value);
                setMenuOpen(false);
                restartIntro();
              }}
            >
              <UIIcon
                name="menu_restart"
                size={MENU_POPUP.iconSize.value}
                fallback={<Glyph name="restart" size={MENU_POPUP.iconSize.value} />}
              />
              <span>重播启动</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
