/**
 * 集成轨：把 data/asset_map.net2.json（网络素材猎手轨 net2 的 side-file）折叠进
 * data/asset_map.json，然后删除 side-file（由调用方删，本脚本只做折叠+校验）。
 *
 * 规则（对齐既有管线约定）：
 *  - images 段 schema：{文件 stem: 相对 repo 根路径}（net2_meta._comment 与
 *    build_asset_map.py 对齐）；
 *  - key 冲突沿用 build_asset_map.py:42 的策略：路径更短者优先，平手保既有；
 *  - exists 校验：折叠后全量 images 条目逐条 existsSync，死链剔除并计数
 *    （主 map 既有条目与 net2 新增条目分开计数）；
 *  - 计数同步：counts.images 更新为折叠+剔死链后的实际条数；
 *  - 写出：json.dumps(indent=1) 等价格式（JSON.stringify(null,1)）、ensure_ascii
 *    等价（不转义非 ASCII）、无 BOM、无尾随换行 —— 与 build_asset_map.py:140 一致；
 *  - net2 元数据整体并入为新顶层键 net2_meta（folded_from/at/by + fold_stats），
 *    原 net_meta（net 轨 2026-11-09 折叠记录）保持不动。
 *
 * 用法：node scripts/fold_asset_map_net2.mjs [--dry]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MAP = 'data/asset_map.json';
const SIDE = 'data/asset_map.net2.json';
const dry = process.argv.includes('--dry');

const map = JSON.parse(readFileSync(MAP, 'utf8'));
const net2 = JSON.parse(readFileSync(SIDE, 'utf8'));

// ---- 1. images 段折叠（短路径优先，平手保既有）
let added = 0;
let keptExisting = 0;
for (const [key, rel] of Object.entries(net2.images)) {
  if (!(key in map.images)) {
    map.images[key] = rel;
    added++;
  } else if (rel.length < map.images[key].length) {
    // 本轮实测不触发（net2 全部重叠 key 均为更长路径），保留策略防未来回归
    map.images[key] = rel;
    keptExisting++;
  } else {
    keptExisting++;
  }
}

// ---- 2. exists 校验（全量 images 条目；死链剔除并分开计数）
let deadMain = 0;
let deadNet2 = 0;
const deadSample = [];
for (const [key, rel] of Object.entries(map.images)) {
  if (!existsSync(rel)) {
    if (key in net2.images) deadNet2++;
    else deadMain++;
    if (deadSample.length < 10) deadSample.push(`${key} -> ${rel}`);
    delete map.images[key];
  }
}

// ---- 3. 计数同步 + 元数据并入
const before = map.counts.images;
map.counts.images = Object.keys(map.images).length;
map.net2_meta = {
  folded_from: 'data/asset_map.net2.json',
  folded_at: '2026-11-10 集成轨（集成验收官）',
  folded_by: 'scripts/fold_asset_map_net2.mjs',
  ...net2.net2_meta,
  fold_stats: {
    net2_images_total: Object.keys(net2.images).length,
    added_new_keys: added,
    kept_existing_shorter_path: keptExisting,
    dead_links_removed_main: deadMain,
    dead_links_removed_net2: deadNet2,
    images_count_before_fold: before,
    images_count_after_fold: map.counts.images,
  },
  source_counts: net2.counts,
};

// ---- 4. 写出（无 BOM；indent=1 对齐 build_asset_map.py）
if (!dry) writeFileSync(MAP, JSON.stringify(map, null, 1), 'utf8');

console.log(`折叠${dry ? '（dry）' : ''}: net2.images=${Object.keys(net2.images).length}`);
console.log(`  新增 key: ${added}，保既有（含更短路径优先）: ${keptExisting}`);
console.log(`  死链剔除: 主 map ${deadMain} / net2 新增 ${deadNet2}${deadSample.length ? '，样例: ' + deadSample.join(' | ') : ''}`);
console.log(`  counts.images: ${before} -> ${map.counts.images}`);
