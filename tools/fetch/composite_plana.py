#!/usr/bin/env python3
"""
C-10 落地：从 Plana_Original_* 的 Mesh 顶点/UV 反推各部件在立绘里的区域，
正面投影合成完整立绘 -> resources/ui/extra3/Plana_Composite.png。

原理（社区合成思路，本轮实现）
    《蔚蓝档案》标题立绘（Arona/Plana_Original_*）是一套 3D 模型：
    每个部件（Body/Hair/Face/Eyes/Halo/Tablet/Umbrella）是一个 SkinnedMeshRenderer，
    部件贴图是独立 Texture2D，mesh 的 UV 指向贴图区域、顶点给出模型空间位置。
    把每个三角形按「顶点 (x,z) -> 画布、UV -> 贴图」做仿射栅格化（正面投影，
    丢弃 y 轴），按部件顺序叠加，即得完整立绘。蒙皮顶点世界位置 =
    Σ_j weight_j · (bone_world_j · bindpose_j) · v（骨骼世界矩阵取 prefab
    Transform 层级的默认姿态）；无骨骼的部件（Halo）直接用其 GameObject 的
    Transform 世界矩阵。

数据源
    KR CDN assets-_mx-npcs-plana-_mxdependency-{meshes,prefabs,materials,
    textures,animationclips,timelines}-2026-07-02（fetch 到 .scratch/infra/plana/）。
    贴图不读 bundle（iOS ASTC），直接用本地已提取的 resources/ui/extra/<同名>.png。

产物
    resources/ui/extra3/Plana_Composite.png
    .scratch/infra/plana_composite_report.json

用法
    .venv/Scripts/python.exe tools/fetch/composite_plana.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
BUNDLES = ROOT.parent / ".scratch" / "infra" / "plana"
TEX_DIR = ROOT / "resources" / "ui" / "extra"
OUT = ROOT / "resources" / "ui" / "extra3" / "Plana_Composite.png"
REPORT = ROOT.parent / ".scratch" / "infra" / "plana_composite_report.json"

CANVAS_W = 1024

# 部件渲染顺序（先远后近 / 先底层后顶层）。mesh 名 -> [(submesh 序, 贴图名)]
# 顺序按 Body 渲染器的材质表 + 目视迭代校正；贴图 None 表示跳过（FX 光效等）
# 摆放策略：skin=按骨骼蒙皮；base=用 Body 骨骼0 的 W·B（站姿基础变换，头部姿态
# 增量会让脸/眼被拉伸，故脸族不用自身骨骼）；go=渲染器 Transform 世界矩阵。
# Tablet/Sack 原始顶点是局部空间（raw z 2.19~2.98 超过身体顶 1.96），蒙皮结果
# 悬在头顶，本轮剔除（见报告 note 与 icon-found 替代建议）。
PARTS: list[tuple[str, str, list[tuple[int, str | None]], str]] = [
    ("Plana_Original_Body", "Plana_Original_Body", [(0, "Plana_Original_Body")], "skin"),
    ("Plana_Original_Face", "Plana_Original_Face", [(0, "Plana_Original_Face")], "base"),
    ("Plana_Original_FaceBase", "Plana_Original_FaceBase", [(0, "Plana_Original_Face")], "base"),
    ("Plana_Original_Eye01_Mesh", "Plana_Original_Eyes", [(0, "Plana_Original_Eyes")], "base"),
    ("Plana_Original_Eye02_Mesh", "Plana_Original_Eyes", [(0, "Plana_Original_Eyes")], "base"),
    ("Plana_Original_Body", "Plana_Original_Hair", [(3, "Plana_Original_Hair")], "skin"),
    ("Plana_Original_Body", "Plana_Original_Face(sub4)", [(4, "Plana_Original_Face")], "skin"),
    ("Plana_Original_Umbrella", "Plana_Original_Umbrella", [(0, "Plana_Original_Umbrella")], "skin"),
    ("Plana_Original_Halo", "Plana_Original_Halo", [(0, "Plana_Original_Halo")], "go"),
]


def mat44(pos, quat, scale) -> np.ndarray:
    """Unity 四元数 (x,y,z,w) + 位移 + 缩放 -> 4x4 矩阵。"""
    pos = [float(pos.x), float(pos.y), float(pos.z)]
    scale = [float(scale.x), float(scale.y), float(scale.z)]
    x = float(quat.x)
    y = float(quat.y)
    z = float(quat.z)
    w = float(quat.w)
    R = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    M = np.eye(4)
    M[:3, :3] = R @ np.diag(scale)
    M[:3, 3] = pos
    return M


def build_transform_worlds(env) -> dict[int, np.ndarray]:
    """path_id -> 世界矩阵（默认姿态，逐级累计局部 TRS）。"""
    transforms = {}
    for o in env.objects:
        if o.type.name == "Transform":
            transforms[o.path_id] = o.read()
    world: dict[int, np.ndarray] = {}

    def get(pid: int) -> np.ndarray:
        if pid in world:
            return world[pid]
        t = transforms[pid]
        M = mat44(t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale)
        father = getattr(t, "m_Father", None)
        if father and getattr(father, "path_id", 0) in transforms:
            M = get(father.path_id) @ M
        world[pid] = M
        return M

    for pid in transforms:
        get(pid)
    return world


def load_textures(names: set[str]) -> dict[str, np.ndarray]:
    out = {}
    for n in names:
        p = TEX_DIR / f"{n}.png"
        if not p.exists():
            print(f"  [warn] 本地缺贴图 {p}，跳过该部件")
            continue
        out[n] = np.array(Image.open(p).convert("RGBA")).astype(np.float32)
    return out


def skin_world(verts: np.ndarray, mesh, renderer, tworld: dict[int, np.ndarray], go_world: np.ndarray) -> np.ndarray:
    """返回 (N,3) 世界顶点。verts 为 MeshHandler 处理后的 (N,>=3)。"""
    v = verts[:, :3]
    bones = renderer.m_Bones or []
    skin = getattr(mesh, "m_Skin", None)
    bind = getattr(mesh, "m_BindPose", None)
    if not bones or not skin or not bind:
        return (go_world @ np.hstack([v, np.ones((len(v), 1))]).T).T[:, :3]
    # (N,4) 骨骼索引与权重
    idx = np.array([[getattr(bw, f"boneIndex{k}") for k in range(4)] for bw in skin])
    wts = np.array([[getattr(bw, f"weight{k}") for k in range(4)] for bw in skin])
    wsum = wts.sum(axis=1, keepdims=True)
    wsum[wsum == 0] = 1
    wts = wts / wsum
    # M_j = bone_world_j · bindpose_j
    bone_mats = np.zeros((len(bones), 4, 4))
    for j, bp in enumerate(bones):
        W = tworld.get(bp.path_id)
        bone_mats[j] = (W if W is not None else np.eye(4)) @ np.array(bind[j], dtype=np.float64).reshape(4, 4)
    # 线性混合蒙皮：M = Σ w·M_j；v' = M·v
    sel = bone_mats[idx.reshape(-1)].reshape(len(v), 4, 4, 4)  # (N,4,4,4)
    blended = (wts[..., None, None] * sel).sum(axis=1)  # (N,4,4)
    homo = np.hstack([v, np.ones((len(v), 1))])
    return (blended @ homo[..., None])[..., 0, :3]


def rasterize(canvas: np.ndarray, verts2: np.ndarray, uvs: np.ndarray, tris, tex: np.ndarray) -> int:
    """把 (mesh,submesh) 的三角形仿射栅格化到画布。返回画的三角形数。

    对画布三角 P 求 canvas 像素的重心坐标 (b0,b1,b2)，再以同一组权重插值 UV
    采样贴图（仿射一致性：P 空间的重心坐标即 UV 空间的重心坐标）。
    """
    H, W = canvas.shape[:2]
    th, tw = tex.shape[:2]
    drawn = 0
    for tri in tris:
        i0, i1, i2 = tri
        p = verts2[[i0, i1, i2]]  # (3,2) canvas px
        tuv = uvs[[i0, i1, i2]]  # (3,2) 归一化 UV
        xmin = max(int(np.floor(p[:, 0].min())), 0)
        xmax = min(int(np.ceil(p[:, 0].max())), W - 1)
        ymin = max(int(np.floor(p[:, 1].min())), 0)
        ymax = min(int(np.ceil(p[:, 1].max())), H - 1)
        if xmin > xmax or ymin > ymax:
            continue
        xs, ys = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
        # canvas 三角的重心坐标
        d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(d) < 1e-9:
            continue
        b0 = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / d
        b1 = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / d
        b2 = 1 - b0 - b1
        mask = (b0 >= -1e-3) & (b1 >= -1e-3) & (b2 >= -1e-3)
        if not mask.any():
            continue
        # 同权重插值 UV（归一化）后映射到贴图像素；Unity UV 原点左下
        uu = b0 * tuv[0, 0] + b1 * tuv[1, 0] + b2 * tuv[2, 0]
        vvn = b0 * tuv[0, 1] + b1 * tuv[1, 1] + b2 * tuv[2, 1]
        uu = np.clip(np.round(uu * (tw - 1)).astype(int), 0, tw - 1)
        vv = np.clip(np.round(vvn * (th - 1)).astype(int), 0, th - 1)
        colors = tex[th - 1 - vv, uu]
        alpha = colors[..., 3:4] / 255.0
        region = canvas[ymin:ymax + 1, xmin:xmax + 1]
        m3 = mask[..., None]
        region[..., :3] = np.where(m3, colors[..., :3] * alpha + region[..., :3] * (1 - alpha), region[..., :3])
        region[..., 3:] = np.where(m3, np.maximum(region[..., 3:], alpha * 255), region[..., 3:])
        drawn += 1
    return drawn


def main() -> None:
    import UnityPy
    from UnityPy.helpers.MeshHelper import MeshHandler

    env = UnityPy.load(str(BUNDLES))
    objs = {o.path_id: o for o in env.objects}
    tworld = build_transform_worlds(env)

    # 收集 mesh / renderer / 贴图
    meshes: dict[str, object] = {}
    for o in env.objects:
        if o.type.name == "Mesh":
            m = o.read()
            meshes.setdefault(m.m_Name, m)  # 同名去重（两套 prefab）
    renderers: dict[str, object] = {}
    for o in env.objects:
        if o.type.name in ("SkinnedMeshRenderer", "MeshRenderer"):
            r = o.read()
            mp = getattr(r, "m_Mesh", None)
            mp = getattr(mp, "path_id", None) if mp is not None else None
            if not mp or mp not in objs:
                continue
            mesh_name = objs[mp].read().m_Name
            prev = renderers.get(mesh_name)
            # 同名 mesh 有多个 prefab 变体时，优先带骨骼（蒙皮摆放）的渲染器
            has_bones = bool(getattr(r, "m_Bones", None))
            if prev is None or (has_bones and not getattr(prev, "m_Bones", None)):
                renderers[mesh_name] = r
    # GameObject -> Transform path_id
    go_transform: dict[int, int] = {}
    for o in env.objects:
        if o.type.name == "Transform":
            t = o.read()
            go_transform[t.m_GameObject.path_id] = o.path_id

    tex_names = {tex for _, _, subs, _ in PARTS for _, tex in subs if tex}
    textures = load_textures(tex_names)

    def m2np(m):
        return np.array(
            [[m.e00, m.e01, m.e02, m.e03], [m.e10, m.e11, m.e12, m.e13],
             [m.e20, m.e21, m.e22, m.e23], [m.e30, m.e31, m.e32, m.e33]],
            dtype=np.float64,
        )

    # 站姿基础变换 = Body 骨骼0 的 W·B（把「躺姿原始空间 z=高度」转成世界 y=高度）
    base_mat = None
    body_mesh = meshes.get("Plana_Original_Body")
    body_r = renderers.get("Plana_Original_Body")
    if body_mesh is not None and body_r is not None and getattr(body_r, "m_Bones", None):
        W = tworld.get(body_r.m_Bones[0].path_id)
        if W is not None and getattr(body_mesh, "m_BindPose", None):
            base_mat = W @ m2np(body_mesh.m_BindPose[0])
            print("base_mat（Body 骨骼0 W·B）平移:", np.round(base_mat[:3, 3], 3))

    def transform_verts(mesh, r, strategy: str, go_world: np.ndarray, verts: np.ndarray) -> np.ndarray:
        if strategy == "base" and base_mat is not None:
            homo = np.hstack([verts[:, :3], np.ones((len(verts), 1))])
            return (base_mat @ homo.T).T[:, :3]
        return skin_world(verts, mesh, r, tworld, go_world)

    # 先算所有部件的世界顶点 (x,y)，定画布范围
    placed = []
    for mesh_name, label, subs, strategy in PARTS:
        mesh = meshes.get(mesh_name)
        r = renderers.get(mesh_name)
        if mesh is None or r is None:
            print(f"  [warn] 缺 {mesh_name}（mesh={mesh is not None} renderer={r is not None}），跳过")
            placed.append(None)
            continue
        go_pid = r.m_GameObject.path_id
        go_world = (
            tworld.get(go_transform.get(go_pid, -1), np.eye(4)) if go_pid in go_transform else np.eye(4)
        )
        h0 = MeshHandler(mesh)
        h0.process()
        verts = np.asarray(h0.m_Vertices, dtype=np.float64)
        wv = transform_verts(mesh, r, strategy, go_world, verts)
        placed.append((mesh_name, label, subs, mesh, r, wv, strategy))

    valid = [p for p in placed if p]
    allx = np.concatenate([p[5][:, 0] for p in valid])
    ally = np.concatenate([p[5][:, 1] for p in valid])
    x0, x1, y0, y1 = allx.min(), allx.max(), ally.min(), ally.max()
    span_x = max(x1 - x0, 1e-6)
    span_y = max(y1 - y0, 1e-6)
    scale = CANVAS_W / span_x
    H = int(np.ceil(span_y * scale)) + 2
    print(f"世界范围 x[{x0:.3f},{x1:.3f}] y[{y0:.3f},{y1:.3f}] -> 画布 {CANVAS_W}x{H}")

    def to_px(wv: np.ndarray) -> np.ndarray:
        px = (wv[:, 0] - x0) * scale
        py = (y1 - wv[:, 1]) * scale  # 世界 y 上 -> 画布 y 下
        return np.stack([px, py], axis=1)

    canvas = np.zeros((H, CANVAS_W, 4), dtype=np.float32)
    # 全局画家算法：收集全部 (部件, submesh, 三角形) 按「世界 z 平均深度」排序，
    # 远的先画、近的后画（正面表面盖住背面壳），PARTS 顺序作同深度的次序兜底。
    queue = []
    for order, p in enumerate(placed):
        if not p:
            continue
        mesh_name, label, subs, mesh, r, wv, strategy = p
        h = MeshHandler(mesh)
        h.process()
        uv = np.asarray(h.m_UV0, dtype=np.float64)[:, :2]
        px = to_px(wv)
        z = wv[:, 2]
        tris_all = h.get_triangles()
        for si, texname in subs:
            if texname is None or texname not in textures:
                continue
            if si >= len(tris_all):
                print(f"  [warn] {mesh_name} submesh {si} 不存在（共 {len(tris_all)}）")
                continue
            tris = tris_all[si]
            depth = np.array([z[list(t)].mean() for t in tris])
            for i, tri in enumerate(tris):
                queue.append((float(depth[i]), order, label, strategy, si, texname, px, uv, int(tri[0]), int(tri[1]), int(tri[2])))
    queue.sort(key=lambda e: (e[0] + (0.12 if e[2] == "Plana_Original_Halo" else 0.0), e[1]))
    total = 0
    from collections import Counter as _C
    stat = _C()
    for d, order, label, strategy, si, texname, px, uv, i0, i1, i2 in queue:
        n = rasterize(canvas, px, uv, [(i0, i1, i2)], textures[texname])
        total += n
        stat[f"{label}[{strategy}]({texname})"] += n
    for k, v in stat.items():
        print(f"  {k}: {v} tris")

    img = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    report = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "bundles": str(BUNDLES),
        "canvas": [CANVAS_W, H],
        "world_bounds": {"x": [x0, x1], "y": [y0, y1]},
        "triangles_drawn": total,
        "parts": [
            {"mesh": p[0], "strategy": p[6]} for p in placed if p
        ],
        "excluded": [
            "Plana_Original_Tablet_01/010（蒙皮放置悬在头顶，原始顶点为局部空间，本轮剔除）",
            "Plana_Original_Sack（同上）",
            "FaceEmo01-03（表情叠加层，非基础立绘）",
            "FX submesh、OL_ 变体、Arona_*（另一角色）",
        ],
        "note": "正面投影 (x,y)：蒙皮用 prefab 序列化姿态骨骼；脸族（Face/FaceBase/Eyes）用 Body 骨骼0 的 W·B 基础变换避免头部姿态增量拉伸；Halo 用渲染器 Transform",
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[ok] {OUT}")
    print(f"[ok] {REPORT}")


if __name__ == "__main__":
    main()
