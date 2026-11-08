/**
 * scan-spine-hidden.mjs — 全库扫描 home 族 spine 的「隐藏附件撑大包围盒」案例
 * （2026-11-09 走查⑤实测，配合 scripts/probe-spine-alpha.mjs 单模型深查）
 *
 * 对每个 *_home 目录：A=全量 union，C=排除FX+alpha0 后 union；
 * 输出 C 比 A 缩小超过 5% 的模型（= 存在隐藏附件撑大，候选口径有效的实证）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'resources/spine';
const dirs = fs
  .readdirSync(ROOT)
  .filter((d) => /_home$/i.test(d) && fs.existsSync(path.join(ROOT, d)));

const spine = await import('@esotericsoftware/spine-webgl');
const FX = /fx|fog|light|glow|shadow/i;
const hits = [];
let skipped = 0;

for (const d of dirs) {
  const dir = path.join(ROOT, d);
  const skelFile = fs.readdirSync(dir).find((f) => f.endsWith('.skel'));
  if (!skelFile) continue;
  const atlasFile = skelFile.replace(/\.skel$/i, '.atlas');
  if (!fs.existsSync(path.join(dir, atlasFile))) continue;
  try {
    const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, atlasFile), 'utf8'), () => null);
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const binary = new spine.SkeletonBinary(loader);
    const data = binary.readSkeletonData(fs.readFileSync(path.join(dir, skelFile)));
    const skeleton = new spine.Skeleton(data);
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(spine.Physics.update);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    let cnx = Infinity, cny = Infinity, cxx = -Infinity, cxy = -Infinity;
    let hidden = 0;
    for (const slot of skeleton.drawOrder) {
      const at = slot.getAttachment();
      if (!at) continue;
      const invisible = (at.color?.a ?? 1) <= 0.001 || (slot.color?.a ?? 1) <= 0.001;
      const fx = FX.test(slot.data.name) || FX.test(at.name);
      if (invisible && !fx) hidden++;
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
      for (let k = 0; k < vs.length; k += 2) {
        mnx = Math.min(mnx, vs[k]); mxx = Math.max(mxx, vs[k]);
        mny = Math.min(mny, vs[k + 1]); mxy = Math.max(mxy, vs[k + 1]);
        if (!invisible && !fx) {
          cnx = Math.min(cnx, vs[k]); cxx = Math.max(cxx, vs[k]);
          cny = Math.min(cny, vs[k + 1]); cxy = Math.max(cxy, vs[k + 1]);
        }
      }
    }
    const aw = mxx - mnx, ah = mxy - mny;
    const cw = cxx - cnx, ch = cxy - cny;
    const shrink = aw > 0 && ch > 0 ? 1 - (cw * ch) / (aw * ah) : 0;
    if (shrink > 0.05) {
      hits.push({ dir: d, full: `${aw.toFixed(0)}x${ah.toFixed(0)}`, core: `${cw.toFixed(0)}x${ch.toFixed(0)}`, shrink: (shrink * 100).toFixed(1), hidden });
    }
  } catch {
    skipped++;
  }
}

console.log(`扫描 ${dirs.length} 个 home 模型，解析失败 ${skipped} 个`);
console.log(`C 口径比 A 缩小>5% 的模型 ${hits.length} 个:`);
for (const h of hits.sort((a, b) => b.shrink - a.shrink).slice(0, 25)) {
  console.log(`  ${h.dir}: ${h.full} → ${h.core} (缩 ${(+h.shrink).toFixed ? h.shrink + '%' : ''}, 隐藏附件 ${h.hidden})`);
}
