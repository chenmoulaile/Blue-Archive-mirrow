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
  Physics,
  Vector2,
  type TextureAtlas,
} from '@esotericsoftware/spine-webgl';

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
          base = {
            cx: offset.x + size.x / 2,
            cy: offset.y + size.y / 2,
            w: Math.max(size.x, 1),
            h: Math.max(size.y, 1),
          };

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
