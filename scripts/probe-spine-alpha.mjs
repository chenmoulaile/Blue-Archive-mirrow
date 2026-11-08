/**
 * probe-spine-alpha.mjs — SpineView 取景基准第②轮实测（2026-11-09 走查⑤）
 *
 * 背景：走查②已剔除 FX/Fog/Light/Glow/Shadow 命名层（ch0356_home 7033×5410 →
 * 3834×3382），但 Kisaki（ch0139_home）排除 FX 后包围盒几乎不变——撑大的是
 * 「隐藏附件」（attachment.color.a=0 / slot.color.a=0，编辑器里 render 关闭的
 * 附件在 4.2 runtime 里的形态就是 alpha=0）。
 *
 * 本脚本对比三种口径下的 setup 态包围盒：
 *   A 全量 union（= getBounds）
 *   B 排除 FX 命名（= SpineView 现状）
 *   C 排除 FX 命名 + 排除 attachment/slot alpha=0（= 本轮候选修法）
 * 并列出「alpha=0 且撑大包围盒」的附件清单，作为剔除依据。
 *
 * 用法: node scripts/probe-spine-alpha.mjs <dir>   （dir 下 <base>.skel/.atlas）
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('用法: node scripts/probe-spine-alpha.mjs <spine目录>');
  process.exit(2);
}
const base = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('.skel'));
if (!base) {
  console.error('目录里没有 .skel:', dir);
  process.exit(2);
}
const skelPath = path.join(dir, base);
const atlasPath = path.join(dir, base.replace(/\.skel$/, '.atlas'));

const spine = await import('@esotericsoftware/spine-webgl');

const atlas = new spine.TextureAtlas(fs.readFileSync(atlasPath, 'utf8'), () => null);
const loader = new spine.AtlasAttachmentLoader(atlas);
const binary = new spine.SkeletonBinary(loader);
const data = binary.readSkeletonData(fs.readFileSync(skelPath));
const skeleton = new spine.Skeleton(data);
skeleton.setToSetupPose();
skeleton.updateWorldTransform(spine.Physics.update);

const offset = new spine.Vector2();
const size = new spine.Vector2();
skeleton.getBounds(offset, size, []);

const FX = /fx|fog|light|glow|shadow/i;
const items = [];
for (const slot of skeleton.drawOrder) {
  const at = slot.getAttachment();
  if (!at) continue;
  let vs = null;
  if (at instanceof spine.RegionAttachment) {
    vs = new Array(8).fill(0);
    at.computeWorldVertices(slot, vs, 0, 2);
  } else if (at instanceof spine.MeshAttachment) {
    const n = at.worldVerticesLength;
    vs = new Array(n).fill(0);
    at.computeWorldVertices(slot, 0, n, vs, 0, 2);
  }
  if (!vs) continue;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (let k = 0; k < vs.length; k += 2) {
    mnx = Math.min(mnx, vs[k]); mxx = Math.max(mxx, vs[k]);
    mny = Math.min(mny, vs[k + 1]); mxy = Math.max(mxy, vs[k + 1]);
  }
  items.push({
    slot: slot.data.name,
    name: at.name,
    x: mnx, y: mny, w: mxx - mnx, h: mxy - mny,
    fx: FX.test(slot.data.name) || FX.test(at.name),
    a: at.color?.a ?? 1,
    slotA: slot.color?.a ?? 1,
  });
}

const unionOf = (list) => {
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const p of list) {
    mnx = Math.min(mnx, p.x); mny = Math.min(mny, p.y);
    mxx = Math.max(mxx, p.x + p.w); mxy = Math.max(mxy, p.y + p.h);
  }
  return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny };
};

/** D 口径：SpineView 真实渲染状态 = idle 动画 t=0（initialize 里 setAnimation 后立即渲染）。
 *  setup 态挂着的附件可能被 idle 的 attachment/alpha timeline 换掉或隐藏。 */
function poseSnapshot(stateName) {
  const state = new spine.AnimationState(new spine.AnimationStateData(data));
  const anim = data.animations.find((a) => a.name === stateName) ?? data.animations[0];
  state.setAnimation(0, anim.name, true);
  state.update(0);
  state.apply(skeleton);
  skeleton.updateWorldTransform(spine.Physics.update);
  const list = [];
  for (const slot of skeleton.drawOrder) {
    const at = slot.getAttachment();
    if (!at) continue;
    let vs = null;
    if (at instanceof spine.RegionAttachment) {
      vs = new Array(8).fill(0);
      at.computeWorldVertices(slot, vs, 0, 2);
    } else if (at instanceof spine.MeshAttachment) {
      const n = at.worldVerticesLength;
      vs = new Array(n).fill(0);
      at.computeWorldVertices(slot, 0, n, vs, 0, 2);
    }
    if (!vs) continue;
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let k = 0; k < vs.length; k += 2) {
      mnx = Math.min(mnx, vs[k]); mxx = Math.max(mxx, vs[k]);
      mny = Math.min(mny, vs[k + 1]); mxy = Math.max(mxy, vs[k + 1]);
    }
    list.push({ slot: slot.data.name, name: at.name, x: mnx, y: mny, w: mxx - mnx, h: mxy - mny, fx: FX.test(slot.data.name) || FX.test(at.name) });
  }
  return list;
}

const A = { x: offset.x, y: offset.y, w: size.x, h: size.y };
const B = unionOf(items.filter((p) => !p.fx));
const C = unionOf(items.filter((p) => !p.fx && p.a > 0.001 && p.slotA > 0.001));
const f = (u) => `${u.w.toFixed(0)}x${u.h.toFixed(0)} @(${u.x.toFixed(0)},${u.y.toFixed(0)})`;
console.log(`[A] 全量 union           : ${f(A)}`);
console.log(`[B] 排除FX命名 (现状)     : ${f(B)}`);
console.log(`[C] 排除FX+alpha0 (候选)  : ${f(C)}`);

// idle 名称取法与 SpineView 一致：/^idle/i 优先，否则 /loop/i，否则第一个
const idleName =
  data.animations.find((a) => /^idle/i.test(a.name))?.name ??
  data.animations.find((a) => /loop/i.test(a.name))?.name ??
  data.animations[0]?.name;
if (idleName) {
  const posed = poseSnapshot(idleName);
  const D = unionOf(posed.filter((p) => !p.fx));
  console.log(`[D] ${idleName}@t0 排除FX   : ${f(D)}`);
  // idle t=0 与 setup 态的附件差异（换装/隐藏层）
  const setupMap = new Map(items.map((p) => [p.slot, p.name]));
  const posedMap = new Map(posed.map((p) => [p.slot, p.name]));
  for (const [slot, name] of setupMap) {
    const now = posedMap.get(slot);
    if (now !== name) console.log(`  slot ${slot}: setup=${name} → ${idleName}@t0=${now ?? '(无附件)'}`);
  }
  for (const [slot, name] of posedMap) {
    if (!setupMap.has(slot)) console.log(`  slot ${slot}: setup=(无附件) → ${idleName}@t0=${name}`);
  }
}
const hidden = items.filter((p) => (p.a <= 0.001 || p.slotA <= 0.001) && !p.fx);
console.log(`alpha=0 且非FX 的附件 ${hidden.length} 个:`);
for (const p of hidden.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 12)) {
  console.log(
    `  slot=${p.slot} at=${p.name} a=${p.a.toFixed(2)} slotA=${p.slotA.toFixed(2)} ` +
      `${p.w.toFixed(0)}x${p.h.toFixed(0)} @(${p.x.toFixed(0)},${p.y.toFixed(0)})`
  );
}
