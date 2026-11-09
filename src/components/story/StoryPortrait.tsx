/**
 * StoryPortrait — 剧情立绘（spr spine 模型）
 *
 * 与 SpineView（大厅模型用）的区别：
 * - 动画由外部控制：speaking=true 且 expression prop（两位编号 "03"）有效时在
 *   track 0 播同名表情动画（spr 骨架的动画名就是表情编号，2026-11-08 实测
 *   7 模型一致）；说话人切换/停下后回落 Idle_01（真机行为：推进对话时待机动画）。
 * - 取景是「立绘构图」：模型高度 = 视口高 × zoom（默认 0.75 ≈ 立绘约占屏 3/4），
 *   模型脚底对齐「对话框上沿」（bottomInset = 对话框高度），水平按 pos 站位。
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
import { posFacesRight, posIsFar, type StagePos } from './storyStage';

export interface StoryPortraitProps {
  skelUrl: string;
  atlasUrl: string;
  /** 表情差分编号（两位），null = 播 Idle */
  expression: string | null;
  pos: StagePos;
  /** 是否正在说话（表情差分只在本角色说话时播，其余时刻 Idle） */
  speaking?: boolean;
  /** 对话框上沿到舞台底部的距离（css px）：模型脚底对齐这条线，0 = 舞台底 */
  bottomInset?: number;
  /** 相对「模型高度 = 视口高度」的倍数，0.75 ≈ 立绘约占屏 3/4 */
  zoom?: number;
  /** 高亮/压暗由 CSS filter 实现（说话人 1，其余 0.55） */
  dim?: boolean;
  onFail?: () => void;
}

/**
 * 站位对应的水平构图（视口比例中心点）。
 * 五站位（S-1）：远景槽（far-left/far-right）更靠边且更小（FAR_ZOOM）。
 */
const POS_FRAC: Record<StagePos, number> = {
  'far-left': 0.16,
  left: 0.27,
  center: 0.5,
  right: 0.73,
  'far-right': 0.84,
};

/** 远景缩小系数（报告一 S-1「含远景缩小」） */
const FAR_ZOOM = 0.76;

/** bottomInset（css px）→ 设备像素（相机以设备像素工作） */
function bottomDevicePx(bottomInsetCss: number, canvas: HTMLCanvasElement, vh: number): number {
  const cssH = canvas.clientHeight || canvas.getBoundingClientRect().height || 1;
  return bottomInsetCss * (vh / cssH);
}

export function StoryPortrait({
  skelUrl,
  atlasUrl,
  expression,
  pos,
  speaking = false,
  bottomInset = 0,
  zoom = 0.75,
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
  const bottomInsetRef = useRef(bottomInset);
  const [failed, setFailed] = useState(false);

  zoomRef.current = zoom;
  posRef.current = pos;
  bottomInsetRef.current = bottomInset;

  /** 生效取景倍数：远景槽（1/5 号位）整体缩小（S-1 远景缩小 + S-8 站位构图） */
  const effZoom = () => (posIsFar(posRef.current) ? zoomRef.current * FAR_ZOOM : zoomRef.current);

  // 表情切换：说话时播表情差分，停下/换人回落 Idle_01（直接操作 AnimationState，不重建 Spine）
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    const idle = animsRef.current.has('Idle_01') ? 'Idle_01' : null;
    const target =
      speaking && expression && animsRef.current.has(expression) ? expression : idle;
    if (target) {
      const entry = st.setAnimation(0, target, true);
      entry.mixDuration = 0.18;
    }
  }, [expression, speaking]);

  useEffect(() => {
    fracRef.current = POS_FRAC[pos];
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = camObjRef.current;
    if (!cam) return;
    const vw = Math.max(canvas.width, 1);
    const vh = Math.max(canvas.height, 1);
    const z = effZoom();
    cam.setViewport(vw, vh);
    const fitH = baseRef.current.h / vh;
    cam.zoom = fitH / Math.max(z, 0.2);
    cam.position.set(
      baseRef.current.cx - (fracRef.current - 0.5) * (vw * cam.zoom),
      baseRef.current.cy - (baseRef.current.h * (z - 1)) / (2 * z) - bottomDevicePx(bottomInsetRef.current, canvas, vh) * cam.zoom,
      0
    );
    cam.update();
  }, [pos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    let disposed = false;

    const applyCam = () => {
      const cam = camObjRef.current;
      if (!cam) return;
      const vw = Math.max(canvas.width, 1);
      const vh = Math.max(canvas.height, 1);
      const z = effZoom();
      cam.setViewport(vw, vh);
      // 高度 = 视口高 × zoom：fit = 模型高 / 视口高（世界单位每像素），zoom 0.75 ≈ 占屏 3/4
      const fitH = baseRef.current.h / vh;
      cam.zoom = fitH / Math.max(z, 0.2);
      // 站位：模型中心要落在画面 frac 处 => cam.x = cx - (frac-0.5)*视野世界宽
      // 底部对齐：模型脚对到「对话框上沿」 => cam.y = cy - h(z-1)/(2z) - bottomInset*zoom
      cam.position.set(
        baseRef.current.cx - (fracRef.current - 0.5) * (vw * cam.zoom),
        baseRef.current.cy - (baseRef.current.h * (z - 1)) / (2 * z) - bottomDevicePx(bottomInsetRef.current, canvas, vh) * cam.zoom,
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
          baseRef.current = { cx: offset.x + size.x / 2, cy: offset.y + size.y / 2, h: Math.max(size.y, 1) };

          camObjRef.current = c.renderer.camera as unknown as typeof camObjRef.current;
          applyCam();
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
      applyCam();
    });
    ro.observe(canvas);

    return () => {
      disposed = true;
      ro.disconnect();
      sc.dispose();
      stateRef.current = null;
      skeletonRef.current = null;
      camObjRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skelUrl, atlasUrl]);

  if (failed) return null;
  // S-8：spr 默认构图朝画面右（story-vis-02-multi-actor.png 实测），站画面右半
  // 的立绘水平镜像后面向中心；交叉淡入 ~200ms（进场 opacity 动画，global.css）
  const mirrored = posFacesRight(pos);
  return (
    <div
      className="story-portrait"
      data-pos={pos}
      data-active={dim ? 'n' : 'y'}
      data-mirrored={mirrored ? 'y' : 'n'}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        filter: dim ? 'brightness(0.55) saturate(0.8)' : 'none',
        // transform 交给 CSS 层（说话人浮动 / 非说话人微缩轻移），这里必须放行 transition；
        // 镜像只翻转本组件内层 canvas，不与外层 .story-actor 的 transform 叠加
        transition: 'filter 0.25s, transform 0.3s, opacity 0.2s',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          transform: mirrored ? 'scaleX(-1)' : undefined,
        }}
      />
    </div>
  );
}
