/**
 * spine fit 包围盒实验（2026-11-08 走查②修复用）
 *
 * 用 spine-core 真类（SkeletonBinary + TextureAtlas 无纹理）离线计算：
 *   1. setup 态全量 union（= SpineView 现状取景基准）
 *   2. 排除 FX/Fog/Light/Glow/Shadow 槽位后的 union（候选修法）
 *   3. 按 SpineView 的 cover/anchor 公式模拟取景，输出两种口径下
 *      场景 mesh 在画布上的覆盖率
 *
 * 用法：node tools/recon/spine-fit-lab.mjs <skel> <atlas> [画布宽 高]
 */
import fs from 'node:fs';

const [, , skelPath, atlasPath, vwArg, vhArg] = process.argv;
if (!skelPath || !atlasPath) {
  console.error('用法: node tools/recon/spine-fit-lab.mjs <skel> <atlas> [vw vh]');
  process.exit(2);
}
const VW = Number(vwArg) || 2882;
const VH = Number(vhArg) || 1802;

const spine = await import('@esotericsoftware/spine-webgl');

const atlasText = fs.readFileSync(atlasPath, 'utf8');
const atlas = new spine.TextureAtlas(atlasText, () => null);
const loader = new spine.AtlasAttachmentLoader(atlas);
const binary = new spine.SkeletonBinary(loader);
const data = binary.readSkeletonData(fs.readFileSync(skelPath));
const skeleton = new spine.Skeleton(data);
skeleton.setToSetupPose();
skeleton.updateWorldTransform(spine.Physics.update);

const offset = new spine.Vector2();
const size = new spine.Vector2();
skeleton.getBounds(offset, size, []);
console.log(`全量 union: ${size.x.toFixed(0)}x${size.y.toFixed(0)} @(${offset.x.toFixed(0)},${offset.y.toFixed(0)})`);

// 逐 attachment 世界包围盒
const per = [];
for (const slot of skeleton.drawOrder) {
  const at = slot.getAttachment();
  if (!at) continue;
  let n = 0;
  let vs = null;
  if (at instanceof spine.RegionAttachment) {
    n = 8;
    vs = new Array(n).fill(0);
    at.computeWorldVertices(slot, vs, 0, 2);
  } else if (at instanceof spine.MeshAttachment) {
    n = at.worldVerticesLength;
    vs = new Array(n).fill(0);
    at.computeWorldVertices(slot, 0, n, vs, 0, 2);
  }
  if (!vs) continue;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (let k = 0; k < vs.length; k += 2) {
    mnx = Math.min(mnx, vs[k]);
    mxx = Math.max(mxx, vs[k]);
    mny = Math.min(mny, vs[k + 1]);
    mxy = Math.max(mxy, vs[k + 1]);
  }
  per.push({ slot: slot.data.name, name: at.name, x: mnx, y: mny, w: mxx - mnx, h: mxy - mny });
}
console.log('attachment 数:', per.length);

const unionOf = (list) => {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const p of list) {
    mnx = Math.min(mnx, p.x);
    mny = Math.min(mny, p.y);
    mxx = Math.max(mxx, p.x + p.w);
    mxy = Math.max(mxy, p.y + p.h);
  }
  return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny };
};

// SpineView 的 cover + anchor 取景模拟：返回给定基准 base 下画布映射的世界矩形
function coverViewport(base, anchorX = 0.5, anchorY = 1) {
  const fitPx = Math.min(base.h / VH, base.w / VW);
  const zoom = fitPx;
  const wv = VW * zoom;
  const hv = VH * zoom;
  const cx = base.x + base.w / 2 + (0.5 - 0.5) * base.w + (0.5 - anchorX) * wv * 0;
  // SpineView: cx = base.cx + (ax-0.5)*base.w + (0.5-ax)*wv; ax=0.5 时 cx=base.cx
  const cy = base.y + base.h / 2 + (0.5 - anchorY) * base.h + (anchorY - 0.5) * hv;
  return { left: cx - wv / 2, right: cx + wv / 2, bottom: cy - hv / 2, top: cy + hv / 2, zoom };
}

// 两种口径下：场景（全部 mesh）被画布覆盖的比例
function coverage(view) {
  const u = { x: offset.x, y: offset.y, w: size.x, h: size.y };
  const ix = Math.max(0, Math.min(view.right, u.x + u.w) - Math.max(view.left, u.x));
  const iy = Math.max(0, Math.min(view.top, u.y + u.h) - Math.max(view.bottom, u.y));
  return (ix / u.w) * 100 + '% x ' + ((iy / u.h) / u.h === 0 ? 0 : ((iy / u.h)) * 100) + '%';
}

for (const anchorY of [1]) {
  const full = coverViewport({ x: offset.x, y: offset.y, w: size.x, h: size.y }, 0.5, anchorY);
  console.log(`anchorY=${anchorY} 全量口径 cover: zoom=${full.zoom.toFixed(3)} 视口世界=[x ${full.left.toFixed(0)}..${full.right.toFixed(0)}, y ${full.bottom.toFixed(0)}..${full.top.toFixed(0)}]`);

  const core = per.filter((p) => !/fx|fog|light|glow|shadow/i.test(p.slot) && !/fx|fog|light|glow|shadow/i.test(p.name));
  const cu = unionOf(core);
  console.log(`排除FX union: ${cu.w.toFixed(0)}x${cu.h.toFixed(0)} @(${cu.x.toFixed(0)},${cu.y.toFixed(0)})`);
  const cv = coverViewport({ x: cu.x, y: cu.y, w: cu.w, h: cu.h }, 0.5, anchorY);
  console.log(`anchorY=${anchorY} 排除FX口径 cover: zoom=${cv.zoom.toFixed(3)} 视口世界=[x ${cv.left.toFixed(0)}..${cv.right.toFixed(0)}, y ${cv.bottom.toFixed(0)}..${cv.top.toFixed(0)}]`);

  // 边缘留白：排除FX口径下，全量内容有多少落在视口外（雾效溢出属预期）
  const out = per.filter((p) => p.x < cv.left || p.x + p.w > cv.right || p.y < cv.bottom || p.y + p.h > cv.top);
  console.log(`排除FX口径下仍有内容越界的 attachment 数: ${out.length}/${per.length}`);
}
