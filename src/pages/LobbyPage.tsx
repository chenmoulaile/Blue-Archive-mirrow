import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../core/AppContext';
import { audio } from '../core/audio';
import { SpineView } from '../components/SpineView';
import type { Student } from '../types';

/** 记住上次选的学生，切页面回来不用重选 */
let lastStudentId = 0;
/** 每个模型的缩放/位移，切换学生时各自保留 */
const viewMap = new Map<string, { zoom: number; panX: number; panY: number }>();

export default function LobbyPage() {
  const { assets, toast } = useApp();

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
  const [view, setView] = useState({ zoom: 1.35, panX: 0, panY: 0 });
  const voiceIdx = useRef(0);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!student) return;
    lastStudentId = student.id;
    const saved = viewMap.get(student.home_spine);
    setView(saved ?? { zoom: 1.35, panX: 0, panY: 0 });
    setSpineError(false);
  }, [student]);

  const spineRes = student?.home_spine ? assets.spineByName(student.home_spine) : null;

  const onTap = useCallback(() => {
    if (!student) return;
    if (student.voices.length === 0) {
      setLine('……（这名学生没有大厅语音）');
      return;
    }
    const v = student.voices[voiceIdx.current % student.voices.length];
    voiceIdx.current += 1;
    if (v) {
      audio.playVoice(v.path);
      setLine(`♪ ${v.desc.replace(/^[A-Za-z0-9]+_/, '').replace(/_/g, ' ')}`);
      window.setTimeout(() => setLine(''), 2600);
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
        <div className="lobby-name">
          <b>{student.name}</b>
          <span>
            {student.skin || '原皮'} · {student.home_spine}
          </span>
        </div>

        {line && <div className="lobby-line">{line}</div>}

        <div className="lobby-tools">
          <button
            className="icon-btn"
            title="换一位学生"
            onClick={() => {
              setPicking(true);
              setQuery('');
            }}
          >
            ☰
          </button>
          <button
            className="icon-btn"
            title="随机一位"
            onClick={() => {
              const pool = lobbyStudents.filter((s) => s.id !== student.id);
              const next = pool[Math.floor(Math.random() * pool.length)];
              if (next) {
                setStudent(next);
                setLine('');
                setSpineError(false);
              }
            }}
          >
            ⟳
          </button>
          <button className="icon-btn" title="缩小" onClick={() => updateView({ ...view, zoom: view.zoom * 0.85 })}>
            −
          </button>
          <button className="icon-btn" title="放大" onClick={() => updateView({ ...view, zoom: view.zoom * 1.18 })}>
            ＋
          </button>
          <button
            className="icon-btn"
            title="复位视角"
            onClick={() => updateView({ zoom: 1.35, panX: 0, panY: 0 })}
          >
            ⌖
          </button>
          <button className="icon-btn" title="打招呼" onClick={onTap}>
            ♪
          </button>
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
