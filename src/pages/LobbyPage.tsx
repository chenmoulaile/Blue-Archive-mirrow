/**
 * 记忆大厅（Recollection Lobby，view=memorial，/lobby 路由）
 *
 * 布局对照（2026-11-08 参考取证：.scratch/reference2 无实机记忆大厅 UI 屏，
 * 官方相关素材 = MemoryBtn 入口 / CHxxxx_MemorialLobby 语音 176 条 /
 * Student_Portrait_*_Collection 收藏卡）+ BA 公知布局：
 *   - 学生 spine 场景全屏居中（fit="cover"，滚轮缩放/拖拽平移保留）
 *   - 顶部：返回 + 学生名（.lobby-name，e2e 契约）+ 好感度
 *     （bond 剧情键，与桃信 save.momotalk.favor / 大厅点击共字段）
 *   - 底部功能条：切换学生 / 回忆重播 / 语音 / 随机 / 设定
 *     （九宫格底板 Common_Btn_Circle_W + ui_atlas 图标；首个 .icon-btn 必须是
 *     「切换学生」——e2e 靠 .lobby-tools .icon-btn first 打开 .lobby-picker）
 *   - 右下竖排：视角工具（放大/缩小/复位），与功能条分离避免污染 e2e 首位
 *   - 点击互动语音保留（voices 顺序轮播 + 好感度累加）
 *
 * 素材来源标注：底板/图标 data-ui-source=assetbundle；图集缺失时按钮退回
 * global.css 的毛玻璃兜底并标 css-fallback，不伪造素材。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp } from '../core/AppContext';
import { audio } from '../core/audio';
import { store, useSave } from '../core/store';
import { SpineView } from '../components/SpineView';
import { UIIcon } from '../components/NineSlice';
import { nineSliceStyle, type SpriteEntry } from '../core/ui-atlas';
import { Glyph, type GlyphName } from '../components/Glyph';
import { bondFavorKey } from '../components/LobbyStage';
import { HOME_STAGE } from '../core/game-ui-spec';
import type { Student } from '../types';

/** 记住上次选的学生，切页面回来不用重选 */
let lastStudentId = 0;
/** 每个模型的缩放/位移，切换学生时各自保留 */
const viewMap = new Map<string, { zoom: number; panX: number; panY: number }>();

/** 功能条按钮底板（白圆，实测 140×142）与图标，全部实测存在于 data/ui_atlas.json */
const BAR_PLATE = 'Common/Common_Btn_Circle_W';
const BAR_ICONS = {
  change: 'Common/Common_Icon_Change',
  memory: 'Common/Common_Icon_MemoryLobby',
  voice: 'Common/Common_Option_Sound_Full',
  random: 'Common/Common_Icon_Random',
  option: 'Common/Common_Icon_Option',
  back: 'Common/Common_Icon_Back',
  heart: 'Common/Common_Icon_Heart',
} as const;

/** 语音字幕：沿用既有格式（ch0356_lobby_1_1 → 「♪ lobby 1 1」） */
function speakLine(desc: string): string {
  return `♪ ${desc.replace(/^[A-Za-z0-9]+_/, '').replace(/_/g, ' ')}`;
}

/**
 * 底部功能条按钮：九宫格白圆底板（内联 border-image）+ 图集图标。
 * 图标是官方白色遮罩原件，压暗后贴近真机「白圆+深色图标」观感；
 * 图集缺失时 sprite 为 undefined，按钮退回 .icon-btn 毛玻璃兜底。
 */
function BarButton(props: {
  sprite: SpriteEntry | undefined;
  icon: string;
  iconSize: number;
  fallback: ReactNode;
  title: string;
  onClick: () => void;
}): ReactNode {
  const plateStyle: CSSProperties = props.sprite ? nineSliceStyle(props.sprite, true) : {};
  return (
    <button
      className={`icon-btn${props.sprite ? ' ns' : ''}`}
      style={plateStyle}
      data-ui-sprite={BAR_PLATE}
      data-ui-source={props.sprite ? 'assetbundle' : 'css-fallback'}
      title={props.title}
      onClick={props.onClick}
    >
      <UIIcon name={props.icon} size={props.iconSize} fallback={props.fallback} />
    </button>
  );
}

export default function LobbyPage() {
  const { assets, toast, go, uiAtlas } = useApp();
  const save = useSave();

  const lobbyStudents = useMemo(
    () => assets.students.filter((s) => s.home_spine && !s.is_npc),
    [assets.students]
  );

  const [student, setStudent] = useState<Student | null>(() => {
    const saved = lobbyStudents.find((s) => s.id === lastStudentId);
    return saved ?? lobbyStudents.find((s) => s.id === 599) ?? lobbyStudents[0] ?? null;
  });
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState('');
  const [spineError, setSpineError] = useState(false);
  // fit="cover" 下 1 = 场景按画幅宽高比恰好铺满（与大厅 LobbyStage 同语义）
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const voiceIdx = useRef(0);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!student) return;
    lastStudentId = student.id;
    const saved = viewMap.get(student.home_spine);
    setView(saved ?? { zoom: 1, panX: 0, panY: 0 });
    setSpineError(false);
  }, [student]);

  const spineRes = student?.home_spine ? assets.spineByName(student.home_spine) : null;

  // 好感度：bond 会话键，点击互动累加（与桃信/大厅舞台同字段）
  const favorKey = useMemo(
    () => (student ? bondFavorKey(assets.storyIndex, student) : null),
    [assets.storyIndex, student]
  );
  const favor = favorKey ? (save.momotalk.favor[favorKey] ?? 0) : null;

  /** 播一条语音并滚字幕；gain=是否累加好感度（点击互动算，功能条按钮不算） */
  const playVoice = useCallback(
    (gain: boolean) => {
      if (!student) return;
      if (student.voices.length === 0) {
        setLine('……（这名学生没有大厅语音）');
        return;
      }
      const v = student.voices[voiceIdx.current % student.voices.length];
      voiceIdx.current += 1;
      if (v) {
        audio.playVoice(v.path);
        setLine(speakLine(v.desc));
        if (gain && favorKey) {
          const gainPerTouch = HOME_STAGE.favorPerTouch.value;
          store.update((d) => {
            d.momotalk.favor[favorKey] = (d.momotalk.favor[favorKey] ?? 0) + gainPerTouch;
          });
        }
      }
    },
    [student, favorKey]
  );

  const onTap = useCallback(() => playVoice(true), [playVoice]);

  /** 回忆重播：优先该学生的 CHxxxx_MemorialLobby 族（全语音 7051 条中仅 176 条），
   *  没有的学生明示改播大厅语音，不伪造「重播成功」。 */
  const replayMemory = useCallback(() => {
    if (!student) return;
    const mem = student.voices.filter((v) => /memoriallobby/i.test(v.desc));
    const target = mem[0];
    if (target) {
      audio.playVoice(target.path);
      setLine(`♪ ${target.desc.replace(/\.ogg$/i, '').replace(/_/g, ' ')}`);
      return;
    }
    const lobby = student.voices.find((v) => /lobby/i.test(v.desc));
    if (lobby) {
      audio.playVoice(lobby.path);
      setLine('（该学生没有记忆大厅语音，改播大厅语音）');
    } else {
      setLine('……（该学生没有可重播的记忆语音）');
    }
  }, [student]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lobbyStudents;
    return lobbyStudents.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.name_en.toLowerCase().includes(q) ||
        s.given_en.toLowerCase().includes(q)
    );
  }, [lobbyStudents, query]);

  if (!student) {
    return (
      <div className="empty-state">
        没有可用的回忆大厅模型。
        <br />
        请先执行 <code>python tools/fetch/kivo.py spine --type home</code> 下载素材。
      </div>
    );
  }

  const updateView = (v: { zoom: number; panX: number; panY: number }) => {
    const next = {
      zoom: Math.min(6, Math.max(0.5, v.zoom)),
      panX: v.panX,
      panY: v.panY,
    };
    setView(next);
    if (student) viewMap.set(student.home_spine, next);
  };

  const plateSprite = uiAtlas.sprites[BAR_PLATE];
  const glyph = (name: GlyphName, size: number): ReactNode => <Glyph name={name} size={size} />;

  return (
    <div
      className="lobby"
      style={{ margin: '-22px', height: 'calc(100% + 44px)' }}
      onWheel={(e) => {
        updateView({ ...view, zoom: view.zoom * (e.deltaY > 0 ? 0.92 : 1.08) });
      }}
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        const rect = e.currentTarget.getBoundingClientRect();
        updateView({
          zoom: view.zoom,
          panX: d.px - (e.clientX - d.x) / Math.max(rect.width, 1),
          panY: d.py + (e.clientY - d.y) / Math.max(rect.height, 1),
        });
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
    >
      {/* 大厅场景由 Spine 自带，背景只做暗色托底，避免与模型边缘产生接缝 */}
      <div
        className="lobby-bg"
        style={{ background: 'radial-gradient(circle at 50% 42%, #1d3b55 0%, #10202e 58%, #070d14 100%)' }}
      />

      {spineRes && !spineError ? (
        <SpineView
          key={student.home_spine}
          className="lobby-canvas"
          skelUrl={spineRes.skel}
          atlasUrl={spineRes.atlas}
          fit="cover"
          zoom={view.zoom}
          panX={view.panX}
          panY={view.panY}
          onTap={onTap}
          onError={(m) => {
            setSpineError(true);
            toast(`Spine 渲染失败：${m}`);
          }}
        />
      ) : (
        <div className="lobby-loading">
          {spineError ? '该模型无法渲染（贴图或版本不匹配）' : '未找到回忆大厅模型'}
        </div>
      )}

      {/* 暗角：把模型的矩形边缘收进画面，避免生硬接缝 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          boxShadow: 'inset 0 0 140px 52px rgba(4,10,16,0.92)',
        }}
      />

      <div className="lobby-hud">
        {/* 顶部：返回 + 学生名 + 好感度 */}
        <header className="lobby-top">
          <button className="icon-btn" title="返回大厅" onClick={() => go('home')}>
            <UIIcon name={BAR_ICONS.back} size={20} fallback="←" />
          </button>
          <div className="lobby-name">
            <b>{student.name}</b>
            <span>
              {student.skin || '原皮'} · {student.home_spine}
            </span>
          </div>
          <div
            className="lobby-favor"
            title="与该学生的好感度（点击学生互动增加；与桃信共用存档字段 save.momotalk.favor）"
          >
            <UIIcon name={BAR_ICONS.heart} size={16} fallback="♥" />
            <b>{favor ?? '—'}</b>
            <span>好感度</span>
          </div>
        </header>

        {line && <div className="lobby-line">{line}</div>}

        {/* 右下视角工具（缩放/拖拽主体在画布上，这里是按钮等价物） */}
        <div className="lobby-viewtools">
          <button
            className="icon-btn"
            title="放大"
            onClick={() => updateView({ ...view, zoom: view.zoom * 1.18 })}
          >
            ＋
          </button>
          <button
            className="icon-btn"
            title="缩小"
            onClick={() => updateView({ ...view, zoom: view.zoom * 0.85 })}
          >
            −
          </button>
          <button
            className="icon-btn"
            title="复位视角"
            onClick={() => updateView({ zoom: 1, panX: 0, panY: 0 })}
          >
            ⌖
          </button>
        </div>

        {/* 底部功能条：首个 .icon-btn 必须是「切换学生」（e2e 契约） */}
        <div className="lobby-tools">
          <BarButton
            sprite={plateSprite}
            icon={BAR_ICONS.change}
            iconSize={26}
            fallback={glyph('student', 26)}
            title="切换学生"
            onClick={() => {
              setPicking(true);
              setQuery('');
            }}
          />
          <BarButton
            sprite={plateSprite}
            icon={BAR_ICONS.memory}
            iconSize={30}
            fallback={glyph('memorial', 30)}
            title="回忆重播"
            onClick={replayMemory}
          />
          <BarButton
            sprite={plateSprite}
            icon={BAR_ICONS.voice}
            iconSize={26}
            fallback="♪"
            title="语音"
            onClick={() => playVoice(false)}
          />
          <BarButton
            sprite={plateSprite}
            icon={BAR_ICONS.random}
            iconSize={26}
            fallback={glyph('restart', 26)}
            title="随机切换"
            onClick={() => {
              const pool = lobbyStudents.filter((s) => s.id !== student.id);
              const next = pool[Math.floor(Math.random() * pool.length)];
              if (next) {
                setStudent(next);
                setLine('');
                setSpineError(false);
              }
            }}
          />
          <BarButton
            sprite={plateSprite}
            icon={BAR_ICONS.option}
            iconSize={26}
            fallback={glyph('settings', 26)}
            title="设定"
            onClick={() => go('settings')}
          />
        </div>
      </div>

      {picking && (
        <div className="lobby-picker">
          <div className="picker-head">
            <div>
              <b style={{ fontSize: 16 }}>选择回忆大厅</b>
              <span style={{ marginLeft: 12, fontSize: 12.5, opacity: 0.75 }}>
                共 {lobbyStudents.length} 位可切换
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索学生…"
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: 'none',
                  outline: 'none',
                  width: 200,
                }}
              />
              <button className="btn ghost sm" onClick={() => setPicking(false)}>
                关闭
              </button>
            </div>
          </div>
          <div className="picker-grid">
            {filtered.map((s) => (
              <button
                key={s.id}
                className="picker-card"
                onClick={() => {
                  setStudent(s);
                  setPicking(false);
                  setLine('');
                  setSpineError(false);
                }}
              >
                {s.lobby ? (
                  <img src={s.lobby} alt={s.name} loading="lazy" />
                ) : s.avatar ? (
                  <img src={s.avatar} alt={s.name} loading="lazy" style={{ objectFit: 'cover' }} />
                ) : (
                  <div
                    style={{
                      height: 132,
                      display: 'grid',
                      placeItems: 'center',
                      color: '#8aa',
                      fontSize: 12,
                    }}
                  >
                    无封面
                  </div>
                )}
                <div className="nm">
                  {s.name}
                  {s.skin ? ` · ${s.skin}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
