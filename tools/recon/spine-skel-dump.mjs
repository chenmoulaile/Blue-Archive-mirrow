/**
 * ch0139_home skel 结构 dump（2026-11-08 走查②修复用）
 *
 * 用 spine-webgl 的 SkeletonBinary 纯解析（不建 GL 上下文），stub 掉
 * AttachmentLoader，统计 slots / skins / attachments 类型与尺寸，
 * 判断模型里是否带整幅背景矩形 mesh。
 *
 * 用法：node tools/recon/spine-skel-dump.mjs <skel路径> <atlas路径>
 */
import fs from 'node:fs';

const [, , skelPath, atlasPath] = process.argv;
if (!skelPath) {
  console.error('用法: node tools/recon/spine-skel-dump.mjs <skel> <atlas>');
  process.exit(2);
}

const spine = await import('@esotericsoftware/spine-webgl');

// 记录型 stub：只统计，不产几何
function makeStubLoader() {
  const stats = { region: 0, mesh: 0, path: 0, point: 0, boundingBox: 0, clipping: 0, other: 0 };
  const bigMeshes = [];
  const seen = [];
  const record = (kind, name, w, h) => {
    stats[kind] = (stats[kind] ?? 0) + 1;
    seen.push(`${kind}:${name}`);
    if (kind === 'mesh' || kind === 'region') {
      bigMeshes.push({ kind, name, w: Number(w.toFixed(0)), h: Number(h.toFixed(0)) });
    }
  };
  // SkeletonBinary 会往 attachment.color 上写 rgba8888ToColor 的结果
  const color = () => ({ r: 1, g: 1, b: 1, a: 1 });
  return {
    stats,
    bigMeshes,
    seen,
    loader: {
      newRegionAttachment(slot, name, path) {
        record('region', name, 0, 0);
        return {
          name, type: 'region', color: color(), sequence: null,
          region: { width: 0, height: 0, renderObject: null }, vertices: [], uvs: [],
          triangles: [], updateRegion() {}, update() {},
        };
      },
      newMeshAttachment(slot, name, path) {
        record('mesh', name, 0, 0);
        return {
          name, type: 'mesh', color: color(), sequence: null,
          region: { width: 0, height: 0, renderObject: null }, vertices: [], uvs: [],
          triangles: [], edges: [], updateRegion() {}, update() {},
        };
      },
      newBoundingBoxAttachment(slot, name) {
        record('boundingBox', name, 0, 0);
        return { name, type: 'boundingBox', color: color(), vertices: [] };
      },
      newPathAttachment(slot, name) {
        record('path', name, 0, 0);
        return { name, type: 'path', color: color(), vertices: [], lengths: [], closed: false, constantSpeed: false };
      },
      newPointAttachment(slot, name) {
        record('point', name, 0, 0);
        return { name, type: 'point', color: color() };
      },
      newClippingAttachment(slot, name) {
        record('clipping', name, 0, 0);
        return { name, type: 'clipping', color: color(), worldVerticesLength: 0 };
      },
    },
  };
}

const stub = makeStubLoader();
const binary = new spine.SkeletonBinary(stub.loader);
const data = binary.readSkeletonData(fs.readFileSync(skelPath));

console.log('=== 版本:', data.x, data.y ?? '', '| hash:', data.hash?.slice(0, 12));
console.log('骨架尺寸: w', data.width, 'h', data.height);
console.log('slots:', data.slots.length, 'skins:', data.skins.length, 'animations:', data.animations.length);
console.log('动画名:', data.animations.map((a) => a.name).join(', '));
for (const skin of data.skins) {
  console.log(`--- skin「${skin.name}」attachments:`, skin.attachments.size ?? skin.attachments.length);
}
console.log('attachment 类型统计:', JSON.stringify(stub.stats));
console.log('attachment 名样本(前30):', stub.seen.slice(0, 30).join(', '));

// 各动画的时间轴类型（attachment/deform 是否存在决定动画态包围盒是否变化）
for (const a of data.animations) {
  const kinds = {};
  for (const t of a.timelines) kinds[t.constructor.name] = (kinds[t.constructor.name] ?? 0) + 1;
  console.log(`动画「${a.name}」时长 ${a.duration.toFixed(2)}s 时间轴:`, JSON.stringify(kinds));
}

// atlas 区块尺寸（跟 attachment path 对照，找整幅大图）
if (atlasPath) {
  const text = fs.readFileSync(atlasPath, 'utf8');
  const atlas = new spine.TextureAtlas(text, () => null); // 纹理不加载，只要 region 尺寸
  const regions = [...atlas.regions]
    .map((r) => ({ name: r.name, w: r.width, h: r.height }))
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 12);
  console.log('atlas region 总数:', atlas.regions.length);
  console.log('最大的 12 个 region:', JSON.stringify(regions));
}
