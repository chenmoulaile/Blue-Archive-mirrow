/**
 * StoryPortrait — 剧情立绘（spr spine 模型）
 *
 * 与 SpineView（大厅模型用）的区别：
 * - 动画由外部控制：expression prop（两位编号 "03"）变化时在 track 0 播放
 *   同名动画（spr 骨架的动画名就是表情编号，2026-11-08 实测 7 模型一致）；
 *   无表情时播 Idle_01。
 * - 取景是「立绘构图」：模型底部对齐舞台底部、高度按 zoom 铺满略出血，
 *   水平按 pos（left/right/center）站位。
 * - 加载失败走 onError 上报，由父级降级成头像/名字牌，舞台内不渲染错误文案。
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
import type { StagePos } from './storyStage';

export interface StoryPortraitProps {
  skelUrl: string;
  atlasUrl: string;
  /** 表情差分编号（两位），null = 播 Idle */
  expression: string | null;
  pos: StagePos;
  /** 相对「模型高度 = 视口高度」的倍数，1.1 ≈ 略出血的立绘构图 */
  zoom?: number;
  /** 高亮/压暗由 CSS filter 实现（说话人 1，其余 0.55） */
  dim?: boolean;
  onFail?: () => void;
}

/** 站位对应的水平构图（视口比例中心点） */
const POS_FRAC: Record<StagePos, number> = { left: 0.27, center: 0.5, right: 0.73 };

export function StoryPortrait({
  skelUrl,
  atlasUrl,
  expression,
  pos,
  zoom = 1.12,
  dim = false,
  onFail,
}: StoryPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<AnimationState | null>(null);
  const skeletonRef = useRef<Skeleton | null>(null);
  /** 表情动画是否真实存在（spr 骨架动画名与 sequence 一一对应，缺失就回落 Idle） */
  const animsRef = useRef<Set<string>>(new Set());
  const camObjRef = useRef<{ setViewport: (w: number, h: number) => void; zoom: number; position: { set: (x: number, y: number, z: number) => void; x: number; y: number }; update: () => void } | null>(null);
  const zoomRef = useRef(zoom);
  const posRef = useRef<StagePos>(pos);
  const fracRef = useRef(POS_FRAC[pos]);
  const baseRef = useRef({ cx: 0, cy: 0, h: 1000 });
  const [failed, setFailed] = useState(false);

  zoomRef.current = zoom;
  posRef.current = pos;

  // 表情切换：直接操作已就绪的 AnimationState，不重建 Spine
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    const idle = animsRef.current.has('Idle_01') ? 'Idle_01' : null;
    const target = expression && animsRef.current.has(expression) ? expression : idle;
    if (target) {
      const entry = st.setAnimation(0, target, true);
      entry.mixDuration = 0.18;
    }
  }, [expression]);

  useEffect(() => {
    camRef.current?.(POS_FRAC[posRef.current], zoomRef.current);
  }, [pos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    let disposed = false;
    let base = { cx: 0, cy: 0, h: 1000 };
    let fracX = POS_FRAC[posRef.current];

    const applyCam = (f: number, z: number) => {
      fracX = f;
      const cam = camRef.currentCam;
      if (!cam) return;
      const vw = Math.max(canvas.width, 1);
      const vh = Math.max(canvas.height, 1);
      cam.setViewport(vw, vh);
      // 高度铺满：fit = 模型高 / 视口高（世界单位每像素）；zoom 再放大出血
      const fitH = base.h / vh;
      cam.zoom = fitH / Math.max(z, 0.2);
      // 底部对齐：zoom>1 时模型上下各出血 (z-1)/2，把相机中心下移一半出血量，
      // 让出血全部留在上方（立绘脚底贴住对话框上沿）
      cam.position.set(
        base.cx + (f - 0.5) * (vw * cam.zoom),
        base.cy - (base.h * (z - 1)) / 2,
        0
      );
      cam.update();
    };

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
          stateData.defaultMix = 0.18;
          const state = new AnimationState(stateData);

          animsRef.current = new Set(data.animations.map((a) => a.name));
          const idle = animsRef.current.has('Idle_01') ? 'Idle_01' : data.animations[0]?.name;
          if (idle) state.setAnimation(0, idle, true).mixDuration = 0;

          skeletonRef.current = skeleton;
          stateRef.current = state;

          const offset = new Vector2();
          const size = new Vector2();
          skeleton.getBounds(offset, size, []);
          base = { cx: offset.x + size.x / 2, cy: offset.y + size.y / 2, h: Math.max(size.y, 1) };

          const cam = c.renderer.camera;
          camRef.currentCam = cam;
          applyCam(fracX, zoomRef.current);
        } catch (e) {
          if (!disposed) {
            setFailed(true);
            onFail?.();
            void e;
          }
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
        // BA atlas 直通 alpha（与 SpineView 同款配置，传 true 会出白块）
        c.renderer.drawSkeleton(sk, false);
        c.renderer.end();
      },
      error(_c, errors) {
        if (disposed) return;
        void errors;
        setFailed(true);
        onFail?.();
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
      applyCam(fracX, zoomRef.current);
    });
    ro.observe(canvas);

    return () => {
      disposed = true;
      ro.disconnect();
      sc.dispose();
      stateRef.current = null;
      skeletonRef.current = null;
      camRef.currentCam = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skelUrl, atlasUrl]);

  if (failed) return null;
  return (
    <div
      className="story-portrait"
      data-pos={pos}
      data-active={dim ? 'n' : 'y'}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        filter: dim ? 'brightness(0.55) saturate(0.8)' : 'none',
        transition: 'filter 0.25s',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
