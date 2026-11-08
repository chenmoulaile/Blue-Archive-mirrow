/**
 * Spine 4.2 渲染组件
 *
 * 素材是 4.2.x 的二进制 skel，pixi-spine（最高 4.1）读不了，
 * 所以这里用官方 @esotericsoftware/spine-webgl 4.2 的 SpineCanvas。
 *
 * 相机：OrthoCamera 的 zoom 语义是「一个像素代表多少世界单位」。
 * 自动适配按「附件包围盒」把整个模型装进视口（zoom = 1），
 * 再叠加用户传入的 zoom / pan 微调 —— 434 个大厅模型尺度差异很大，
 * 用统一常数适配必然翻车，交给用户微调更实际。
 */
import { useEffect, useRef, useState } from 'react';
import {
  SpineCanvas,
  type SpineCanvasApp,
  Skeleton,
  SkeletonBinary,
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  MeshAttachment,
  Physics,
  RegionAttachment,
  Vector2,
  type TextureAtlas,
} from '@esotericsoftware/spine-webgl';

/** FX/特效层命名（雾效、光晕、投影）：只做氛围，不参与取景基准计算 */
const FX_LAYER_RE = /fx|fog|light|glow|shadow/i;

/**
 * cover/contain 取景用的「场景」包围盒（2026-11-08 走查②，2026-11-09 走查⑤补）。
 *
 * skeleton.getBounds() 的全量 union 会把横跨全场的雾效大四边形算进来——
 * 实测 CH0356_home 单块 Fx_Fog mesh 就有 3010×2429，把 union 撑到 7033×5410，
 * cover 取景按这个基准缩放后，真场景（3834×3382）只占画布中央约一半，
 * 边缘露出硬边矩形。这里逐 attachment 计算世界包围盒，剔除后取并集：
 *   1) FX/Fog/Light/Glow/Shadow 命名的槽位与附件（走查②，渲染不剔除，雾效照画）；
 *   2) 不可见附件：attachment.color.a=0 或 slot.color.a=0（编辑器 render 关闭的
 *      附件在 4.2 runtime 的形态就是 alpha=0；渲染管线同样画出 0 alpha = 不可见，
 *      取景以「实际能看到的内容」为准）。2026-11-09 全库实测
 *      （scripts/scan-spine-hidden.mjs，266 个 home 族）：45 个模型 A→C 有缩小，
 *      极端如 ch0251_home 有 34 个 slot.color.a=0 的整槽隐藏件。
 *      airi_home 3460×2568、ch0139_home 4867×4456 三口径全不变，不回归。
 * 剔除后没有可用几何时退回全量 getBounds。
 */
function fitBoundsOf(
  skeleton: Skeleton,
  offset: Vector2,
  size: Vector2
): { cx: number; cy: number; w: number; h: number } {
  let mnx = Infinity;
  let mny = Infinity;
  let mxx = -Infinity;
  let mxy = -Infinity;
  for (const slot of skeleton.drawOrder) {
    const at = slot.getAttachment();
    if (!at) continue;
    if (FX_LAYER_RE.test(slot.data.name) || FX_LAYER_RE.test(at.name)) continue;
    // 走查⑤：编辑器 render 关闭的附件在 4.2 runtime 里是 attachment/slot alpha=0，
    // 渲染管线画出来也不可见（乘 0），取景基准一并剔除
    const slotAlpha = slot.color?.a ?? 1;
    if (slotAlpha <= 0.001) continue;
    let vs: number[] | null = null;
    let alpha = 1;
    if (at instanceof RegionAttachment) {
      alpha = at.color.a;
      vs = new Array(8).fill(0);
      at.computeWorldVertices(slot, vs, 0, 2);
    } else if (at instanceof MeshAttachment) {
      alpha = at.color.a;
      const n = at.worldVerticesLength;
      vs = new Array(n).fill(0);
      at.computeWorldVertices(slot, 0, n, vs, 0, 2);
    }
    if (!vs || alpha <= 0.001) continue;
    for (let k = 0; k < vs.length; k += 2) {
      mnx = Math.min(mnx, vs[k]);
      mxx = Math.max(mxx, vs[k]);
      mny = Math.min(mny, vs[k + 1]);
      mxy = Math.max(mxy, vs[k + 1]);
    }
  }
  const w = mxx - mnx;
  const h = mxy - mny;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return {
      cx: offset.x + size.x / 2,
      cy: offset.y + size.y / 2,
      w: Math.max(size.x, 1),
      h: Math.max(size.y, 1),
    };
  }
  return { cx: mnx + w / 2, cy: mny + h / 2, w, h };
}

export interface SpineViewProps {
  skelUrl: string;
  atlasUrl: string;
  /** 相对基准取景的缩放倍数：contain 下 1 = 整只模型装进画面，cover 下 1 = 恰好铺满画面 */
  zoom?: number;
  /** 画面偏移，单位是模型宽/高的比例 */
  panX?: number;
  panY?: number;
  /**
   * 取景语义（2026-11-08 走查③）：
   * - contain（默认，旧行为）：整模型装进画面（两边取大），竖幅模型在横幅画布
   *   上会两侧露底，像贴图拼贴；
   * - cover：按画幅宽高比铺满画面（两边取小），溢出部分裁掉——回忆大厅场景
   *   的满屏构图（对照 cafe_ui_steam.jpg）。
   */
  fit?: 'contain' | 'cover';
  /**
   * 模型锚点（0..1，CSS 语义：0=左/上，1=右/下）。cover 裁切时决定保留哪一带
   * （如 anchorY=1 = 模型底边贴画面底边）；contain 时决定模型在画面中的位置。
   * 默认 0.5 居中，保持旧行为。
   */
  anchorX?: number;
  anchorY?: number;
  loop?: boolean;
  /**
   * 点击时额外播放一次的动画（用正则挑，找不到就只触发 onTap）。
   * 大厅模型的反应动画命名不统一：Touch_* / Talk_* / React_* 都见过，
   * 所以这里按优先级给一串候选，而不是写死一个名字。
   */
  touchAnimation?: RegExp;
  /**
   * 外部触摸信号：数值变化时在 track 1 播一次反应动画。
   * 大厅中央舞台（LobbyStage）的点击层不在 canvas 上，用它触发；
   * 不传时保持旧行为（canvas 自己的 onClick 触发）。
   */
  touchSignal?: number;
  /** 骨架加载完成后回调动画名列表，便于调试「这个模型到底有哪些动画」 */
  onAnimations?: (names: string[]) => void;
  onTap?: () => void;
  onReady?: () => void;
  onError?: (msg: string) => void;
  className?: string;
}

export function SpineView({
  skelUrl,
  atlasUrl,
  zoom = 1,
  panX = 0,
  panY = 0,
  fit = 'contain',
  anchorX = 0.5,
  anchorY = 0.5,
  loop = true,
  touchAnimation,
  touchSignal,
  onAnimations,
  onTap,
  onReady,
  onError,
  className,
}: SpineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<AnimationState | null>(null);
  const skeletonRef = useRef<Skeleton | null>(null);
  const camRef = useRef<((z: number, px: number, py: number) => void) | null>(null);
  const idleRef = useRef<string | null>(null);
  const animsRef = useRef<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  /** 点击：在 track 1 播一次反应动画，播完自动接回 idle（idle 在 track 0 不受影响） */
  const playTouch = (): void => {
    const st = stateRef.current;
    if (!st) return;
    const re = touchAnimation ?? /^touch|^tap|^react|^talk/i;
    const hit = animsRef.current.find((n) => re.test(n));
    if (!hit) return;
    const entry = st.setAnimation(1, hit, false);
    entry.mixDuration = 0.12;
    const idle = idleRef.current;
    if (idle) st.addAnimation(1, idle, true, 0);
  };

  // zoom / pan 变化只动相机，不重建 Spine
  useEffect(() => {
    camRef.current?.(zoom, panX, panY);
  }, [zoom, panX, panY]);

  // 外部触摸信号：播一次反应动画（模型没有交互动画时静默跳过，由宿主 CSS 兜底）
  useEffect(() => {
    if (touchSignal === undefined || touchSignal === 0) return;
    playTouch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchSignal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    let disposed = false;
    let base = { cx: 0, cy: 0, w: 1000, h: 1000 };
    let cur = { z: zoom, px: panX, py: panY };

    const app: SpineCanvasApp = {
      loadAssets(c) {
        c.assetManager.loadBinary(skelUrl);
        c.assetManager.loadTextureAtlas(atlasUrl);
      },
      initialize(c) {
        if (disposed) return;
        try {
          const atlas = c.assetManager.require(atlasUrl) as TextureAtlas;
          const loader = new AtlasAttachmentLoader(atlas);
          const binary = new SkeletonBinary(loader);
          const data = binary.readSkeletonData(c.assetManager.require(skelUrl) as Uint8Array);
          const skeleton = new Skeleton(data);
          skeleton.setToSetupPose();
          skeleton.updateWorldTransform(Physics.update);

          const stateData = new AnimationStateData(data);
          stateData.defaultMix = 0.25;
          const state = new AnimationState(stateData);

          const idle =
            data.animations.find((a) => /^idle/i.test(a.name)) ??
            data.animations.find((a) => /loop/i.test(a.name)) ??
            data.animations[0];
          if (idle) state.setAnimation(0, idle.name, loop).mixDuration = 0;

          idleRef.current = idle?.name ?? null;
          animsRef.current = data.animations.map((a) => a.name);
          onAnimations?.(animsRef.current);

          skeletonRef.current = skeleton;
          stateRef.current = state;

          const offset = new Vector2();
          const size = new Vector2();
          skeleton.getBounds(offset, size, []);
          // 取景基准（2026-11-08 走查② + 2026-11-09 走查⑤）：setup 态全量 union
          // 会被横跨全场的雾效/光效层与 alpha=0 隐藏附件撑大，cover 取景因此把
          // 真场景缩成中央一块。这里逐 attachment 计算世界包围盒，排除 FX 层与
          // 不可见附件后作为取景基准；渲染仍画全部层（雾效/隐藏件画了也不可见）。
          // 已离线验证（tools/recon/spine-fit-lab.mjs + scripts/scan-spine-hidden.mjs，
          // 后者扫全库 266 个 home：45 个有缩小、airi/ch0139 三口径全不变）。
          base = fitBoundsOf(skeleton, offset, size);

          const cam = c.renderer.camera;
          // 锚点夹到 0..1（CSS 语义：0=左/上，1=右/下）
          const ax = Math.min(1, Math.max(0, anchorX));
          const ay = Math.min(1, Math.max(0, anchorY));
          const apply = (z: number, px: number, py: number) => {
            cur = { z, px, py };
            const vw = Math.max(canvas.width, 1);
            const vh = Math.max(canvas.height, 1);
            cam.setViewport(vw, vh);
            // zoom = 世界单位 / 像素：contain 两边取大（整模型装下），
            // cover 两边取小（铺满画面、裁掉溢出）
            let fitPx = fit === 'cover'
              ? Math.min(base.h / vh, base.w / vw)
              : Math.max(base.h / vh, base.w / vw);
            if (!Number.isFinite(fitPx) || fitPx <= 0) fitPx = 1;
            cam.zoom = fitPx / Math.max(z, 0.05);
            // 锚点对位：模型 (ax,ay) 点落在视口同比例位置——
            // cover 裁切时决定保留哪一带（anchorY=1 = 模型底边贴画面底边），
            // contain 时决定模型贴哪条边；pan 叠加在其上（语义不变）
            const wv = vw * cam.zoom;
            const hv = vh * cam.zoom;
            const cx = base.cx + (ax - 0.5) * base.w + (0.5 - ax) * wv;
            const cy = base.cy + (0.5 - ay) * base.h + (ay - 0.5) * hv;
            cam.position.set(cx + px * base.w, cy + py * base.h, 0);
            cam.update();
          };
          camRef.current = apply;
          apply(cur.z, cur.px, cur.py);

          setStatus('ready');
          onReady?.();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus('error');
          setErrMsg(msg);
          onError?.(msg);
        }
      },
      update(_c, delta) {
        const st = stateRef.current;
        const sk = skeletonRef.current;
        if (!st || !sk) return;
        st.update(delta);
        st.apply(sk);
        sk.updateWorldTransform(Physics.update);
      },
      render(c) {
        const sk = skeletonRef.current;
        if (!sk) return;
        c.clear(0, 0, 0, 0);
        c.renderer.begin();
        // BA 的 atlas 是直通 alpha，必须传 false；传 true 会出现大片白色块
        c.renderer.drawSkeleton(sk, false);
        c.renderer.end();
      },
      error(_c, errors) {
        const msg = Object.values(errors).join('; ') || 'Spine 资源加载失败';
        setStatus('error');
        setErrMsg(msg);
        onError?.(msg);
      },
    };

    const sc = new SpineCanvas(canvas, {
      app,
      webglConfig: { alpha: true, premultipliedAlpha: true, antialias: true },
    });

    // 2026-11-08 走查②：本机 GPU 栈出现过 GL_OUT_OF_MEMORY → context lost，
    // SpineCanvas 不监听该事件，上下文丢了以后画布静默变黑、界面无任何提示。
    // 这里显式监听并走 onError（宿主会切到 .ls-fallback 兜底）。
    const onContextLost = (e: Event): void => {
      e.preventDefault();
      if (disposed) return;
      const msg = 'WebGL 上下文丢失（GPU 资源不足或驱动重置）';
      setStatus('error');
      setErrMsg(msg);
      onError?.(msg);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      camRef.current?.(cur.z, cur.px, cur.py);
    });
    ro.observe(canvas);

    return () => {
      disposed = true;
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      sc.dispose();
      stateRef.current = null;
      skeletonRef.current = null;
      camRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skelUrl, atlasUrl, loop]);

  return (
    <div className={className} style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        onClick={() => {
          playTouch();
          onTap?.();
        }}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: onTap ? 'pointer' : 'default',
        }}
      />
      {status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(200,230,250,0.75)',
            fontSize: 12.5,
            letterSpacing: 2,
            pointerEvents: 'none',
          }}
        >
          Spine 加载中…
        </div>
      )}
      {status === 'error' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#ffb3b3',
            fontSize: 12.5,
            letterSpacing: 1,
            pointerEvents: 'none',
            textAlign: 'center',
            padding: 20,
          }}
        >
          该 Spine 资源无法渲染
          <br />
          <span style={{ fontSize: 11, opacity: 0.7 }}>{errMsg}</span>
        </div>
      )}
    </div>
  );
}
