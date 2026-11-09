/**
 * 招募演出 · ★3/新角色全屏揭示（D3 hero 演出 + C-9 入学揭示时序融合）
 *
 * D8 裁决（报告二）：入学揭示覆盖于「单卡揭示之后」随逐张流程内嵌，不再是
 * 独立白屏阶段。时序（帧证据对齐真机）：
 *   剪影卡停驻 → 剪影碎裂 → 立绘放大/右滑入 + 光环爆发 → 契约书竖卡滑入
 *   （星级/姓名/社团/武器/生日）→ [新角色] SVG 签名笔迹描边 → 左下蓝色名字条
 *   + NEW 金徽 → 底部语音字幕 → 完成。
 *
 * 素材：剪影卡 Img_Gacha_Char_SSR_Resume、光环 FX_TEX_GachaBall9（加算 screen）、
 * 申请表纸 Gacha_SubInfo；立绘 = card_art 卡面（缺失回退头像）。
 * 兜底：剪影碎裂与签名笔迹无真素材，CSS/SVG 兜底并打 data-fallback-reason。
 */
import { useEffect, useRef, useState } from 'react';
import type { Student } from '../../types';
import type { PullResult } from '../../core/gacha/engine';
import { audio } from '../../core/audio';
import type { StudentMeta } from './gachaData';
import {
  BALL_FX,
  EYE_FX,
  GACHA_RESUME,
  SCHOOL_LABEL,
  SE_SSR_CHIME,
  SE_SSR_IMPACT,
  SE_SSR_SIGN,
  SE_SSR_TAIL,
  SE_SSR_WIND,
  SE_FLIP,
  STAR_COLOR,
  lobbyVoiceOf,
} from './gachaData';

/** 时序（毫秒）：剪影 0 → 碎裂 900 → 立绘 1500 → 契约书 2300 → 签名 3100 → 定格 4400 → 字幕 5000 → 完成 */
const STEP = {
  SHATTER: 900,
  PORTRAIT: 1500,
  CONTRACT: 2300,
  SIGN: 3100,
  SIGN_DONE: 4400,
  NAMEBAR: 5000,
  VOICE: 5200,
  DONE_NEW: 7400,
  DONE_OLD: 6200,
} as const;

type Phase =
  | 'silhouette'
  | 'shatter'
  | 'portrait'
  | 'contract'
  | 'sign'
  | 'namebar'
  | 'voice';

export function GachaReveal({
  r,
  st,
  art,
  isNew,
  meta,
  onDone,
}: {
  r: PullResult;
  st: Student | null;
  /** 立绘图源（card_art → avatar，父级解析） */
  art?: string;
  isNew?: boolean;
  /** students_meta 字段（CV/武器/学园），缺失时契约书如实留空 */
  meta?: StudentMeta;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('silhouette');
  const doneRef = useRef(false);
  const timers = useRef<number[]>([]);

  const name = st?.name ?? r.name;
  const school = meta?.school != null ? SCHOOL_LABEL[meta.school] : undefined;
  const weapon = meta?.weaponType || undefined;
  const birthday = st?.birthday || undefined;
  const voice = lobbyVoiceOf(st ?? null);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    // SSR 链节拍：风 → 铃 → 冲击（对齐真机 hero 演出三段）
    at(150, () => audio.playSe(SE_SSR_WIND));
    at(STEP.PORTRAIT, () => audio.playSe(SE_SSR_CHIME));
    at(STEP.CONTRACT - 100, () => audio.playSe(SE_FLIP[3]));
    at(STEP.PORTRAIT + 400, () => audio.playSe(SE_SSR_IMPACT));
    if (isNew) {
      at(STEP.SIGN, () => audio.playSe(SE_SSR_SIGN));
      at(STEP.SIGN_DONE, () => audio.playSe(SE_SSR_TAIL));
    }
    at(STEP.SHATTER, () => setPhase('shatter'));
    at(STEP.PORTRAIT, () => setPhase('portrait'));
    at(STEP.CONTRACT, () => setPhase('contract'));
    if (isNew) at(STEP.SIGN, () => setPhase('sign'));
    at(isNew ? STEP.NAMEBAR : STEP.CONTRACT + 700, () => setPhase('namebar'));
    at(isNew ? STEP.VOICE : STEP.CONTRACT + 1000, () => setPhase('voice'));
    at(isNew ? STEP.DONE_NEW : STEP.DONE_OLD, () => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    });
    return () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 语音在进入 voice 段时播（不在 timers 里，避免卸载时重复调度）；
  // 跳过时父组件 stopSeAll() 兜底停掉
  useEffect(() => {
    if (phase === 'voice' && voice) audio.playVoice(voice.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 签名 SVG 描边动画的 dasharray 预算：中文名 3-10 字 × 字号 52 的笔画周长量级
  const SIGN_DASH = 2200;

  return (
    <div className={`gcsh st-${phase}`} data-gacha-scene="hero-reveal">
      {/* 底纹 + 光环爆发（加算贴图必须为本层直接子节点，防 stacking context 隔离黑底） */}
      <img className="gcsh-resume-bg" src={GACHA_RESUME[3]} alt="" data-ui-source="assetbundle" />
      {phase !== 'silhouette' && phase !== 'shatter' && (
        <img className="gcsh-burst" src={BALL_FX} alt="" data-ui-source="assetbundle" />
      )}
      {phase === 'portrait' && (
        <img className="gcsh-eye-fx" src={EYE_FX} alt="" data-ui-source="assetbundle" />
      )}

      {/* 剪影卡停驻 → 碎裂（C-9 前段） */}
      {phase === 'silhouette' && (
        <div className="gcsh-silhouette" data-ui-source="assetbundle">
          <img src={GACHA_RESUME[3]} alt="" />
        </div>
      )}
      {phase === 'shatter' && (
        <div className="gcsh-shatter" data-ui-source="css-fallback" data-fallback-reason="剪影碎裂无真素材帧序列，CSS clip-path 碎片飞散近似真机">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={`gcsh-shard sd-${i}`}>
              <img src={GACHA_RESUME[3]} alt="" />
            </i>
          ))}
        </div>
      )}

      {/* 立绘放大/右滑入 + 契约书竖卡（D3） */}
      {(phase === 'portrait' || phase === 'contract' || phase === 'sign' || phase === 'namebar' || phase === 'voice') && (
        <>
          <div className="gcsh-portrait">
            {art ? (
              <img src={art} alt={name} data-ui-source="assetbundle" />
            ) : (
              <span className="gcsc-initial big">{name.slice(0, 1)}</span>
            )}
          </div>

          {/* 契约书竖卡：星级/姓名/社团/武器/生日（社团/武器/生日数据缺失如实留「—」） */}
          {phase !== 'portrait' && (
            <aside className="gcsh-contract">
              <span className="gcsh-contract-title">招募 · 契约书</span>
              <b className="gcsh-contract-name" style={{ color: STAR_COLOR[3] }}>
                {name}
              </b>
              <span className="gcsh-contract-stars">★★★</span>
              <dl>
                <div>
                  <dt>社团</dt>
                  <dd>{school ?? '—'}</dd>
                </div>
                <div>
                  <dt>武器</dt>
                  <dd>{weapon ?? '—'}</dd>
                </div>
                <div>
                  <dt>生日</dt>
                  <dd>{birthday ?? '—'}</dd>
                </div>
              </dl>
              {/* 新角色：SVG 签名笔迹手写绘制（C-9，stroke 描边沿文字近似手写） */}
              {isNew && st?.signature && (
                <svg
                  className="gcsh-sign"
                  viewBox="0 0 560 130"
                  data-ui-source="css-fallback"
                  data-fallback-reason="签名笔迹无真素材，用 signature 真文本 + SVG stroke-dashoffset 描边动画近似手写绘制"
                >
                  <text
                    className="gcsh-sign-text"
                    x="280"
                    y="92"
                    textAnchor="middle"
                    style={{ strokeDasharray: SIGN_DASH, strokeDashoffset: SIGN_DASH }}
                  >
                    {st.signature}
                  </text>
                </svg>
              )}
              {isNew && <span className="gcsh-new">NEW</span>}
            </aside>
          )}

          {/* 左下蓝色名字条（D3） */}
          {(phase === 'namebar' || phase === 'voice') && (
            <div className="gcsh-namebar">
              <b>{name}</b>
              {meta?.cv && <span>CV. {meta.cv}</span>}
            </div>
          )}

          {/* 底部语音字幕（D3）：台词文本无数据源，如实显示语音族标签 */}
          {phase === 'voice' && voice && (
            <div
              className="gcsh-subtitle"
              data-ui-source="css-fallback"
              data-fallback-reason="语音台词文本无数据源（voice_id 为 CRC hash 型未破解），显示语音族标签"
            >
              ▶ {name} · {voice.label}
            </div>
          )}
        </>
      )}

      {/* 剪影/碎裂阶段的 ★3 徽标提示 */}
      {(phase === 'silhouette' || phase === 'shatter') && (
        <span className="gcsh-star-mark" style={{ color: STAR_COLOR[3] }}>
          ★★★
        </span>
      )}
    </div>
  );
}
