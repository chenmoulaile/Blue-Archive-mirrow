# BA 抽卡动画重构计划（极致还原版）

## 🎯 目标：逐帧复刻官方视频 https://www.bilibili.com/video/BV1yF411Z7RD/

### 真实 BA 抽卡镜头序列（基于观察）

#### **单抽流程**（总时长~10 秒）
```
[Stage 0] 招募结果页 (点击抽卡按钮)
    ↓ [0.3s] fadeOut 暗化 + SE_Confirm_02
    ↓
[Stage 1] 街道全景转场 (约 1.5s)
    - BG: 阿拜多斯/凯撒等学校街道全景图 (资源中应已有)
    - Camera: 轻微 zoom out + parallax
    - FX: 星光粒子从中心汇聚 (CSS/Canvas 生成)
    - SE: 星光汇聚音效
    ↓ [1.8s]
[Stage 2] 光柱升起 (约 2s)
    - 垂直光柱从地面射向天空 (SVG 渐变动画)
    - 颜色根据稀有度渐变 (SSR=金/SR=蓝/R=灰)
    - 镜头跟随光柱上移 (translateY + zoom)
    - SE: 上升音效 (持续 1.5s)
    ↓ [3.8s]
[Stage 3] 天空场景切换 (约 0.5s)
    - 切至蓝天白云 + 地平线
    - 光柱顶端炸开成光点散开
    - SE: 爆炸音效
    ↓ [4.3s]
[Stage 4] 飞机划过 (关键！约 3s)
    - 飞机从右侧远方飞来 → 靠近 → 留下彩虹轨迹
    - 相机跟踪飞机 (横向平移)
    - 背景视差滚动
    - SE: 飞机引擎声 (由远及近再远去)
    - Music: Theme_01 副歌起
    ↓ [7.3s]
[Stage 5] 卡片翻转展示 (单抽约 2.5s)
    - 卡片从飞机方向飞入屏幕中央
    - 3D 翻转 (背面→正面)
    - SSR/SR/R 稀有度光芒扫过 (横向光带)
    - 立绘淡入 (fadeIn 0.5s)
    - NEW 徽标闪烁 (如果首次获得)
    - 语音片段播放
    - SE: 翻卡牌 + 稀有度 chime
    ↓ [9.8s]
[Stage 6] 结果页淡入 (约 0.5s)
    - 网格布局显示所有结果
    - "再来一次"按钮出现
```

#### **十连流程**（总时长~15 秒）
```
[Stage 0-4] 同上单抽前段 (共用开头)
    ↓ [5s] 
[Stage 5a] 十张光柱同时升起
    - 排列：2 行×5 列 或 横排 10 个
    - 依次亮起节奏 (ssr 优先放大)
    ↓ [6.5s]
[Stage 5b] 飞机连续划过多道轨迹
    - 每个光柱对应一道彩虹线
    ↓ [8s]
[Stage 6a] 快速扫过卡片 (节奏感强)
    - 依次翻转 (每张 0.2s)
    - SSR 卡片额外放大停留
    ↓ [11s]
[Stage 7] 结果网格完整呈现
```

---

## 📦 所需素材清单（最小流量方案）

### A. 必下载素材（总计 ~5MB）

| 文件名 | 来源 | URL | 大小 | 用途 |
|--------|------|-----|------|------|
| `bg_gacha_street_aoydos.jpg` | kivo gallery | static.kivo.wiki/gallery/... | ~800KB | 阿拜多斯街道背景 (单抽用) |
| `bg_gacha_street_caeasr.jpg` | kivo gallery | static.kivo.wiki/gallery/... | ~800KB | 凯撒街道背景 (十连用) |
| `gacha_airplane_transition.gif` | GitHub 提取 | github.com/BA-assets/... | ~300KB | 飞机转场 GIF (核心！) |
| `se_gacha_lift.ogg` | ba-archive | bgm.blue-archive.io/se/... | ~50KB | 光柱上升音效 |
| `se_gacha_plane.ogg` | ba-archive | bgm.blue-archive.io/se/... | ~80KB | 飞机音效 |
| `se_gacha_flip_ssr.ogg` | ba-archive | ... | ~30KB | SSR 翻卡牌音效 |
| `se_gacha_flip_sr.ogg` | ba-archive | ... | ~30KB | SR 翻卡牌音效 |
| `se_gacha_flip_r.ogg` | ba-archive | ... | ~30KB | R 翻卡牌音效 |
| `ui_gacha_card_back.png` | assets bundle | .baad/cn/... | ~150KB | 卡片背面图案 |
| `fx_gacha_stars.png` | assets bundle | .baad/cn/... | ~100KB | 星光粒子 sprite sheet |

**合计：~2.5MB**（压缩后可能更低）

### B. 代码生成（零流量）

| 元素 | 技术栈 | 说明 |
|------|--------|------|
| 光柱渐变动画 | SVG + CSS keyframes | `<linearGradient>`+`@keyframes translateY` |
| 星星粒子系统 | HTML5 Canvas API | 50-100 个粒子，random position/speed |
| 彩虹轨迹 | SVG path anim | 贝塞尔曲线 + opacity 动画 |
| 稀有度光芒扫过 | CSS clip-path animation | `inset` 动画模拟光带扫过 |
| 3D 卡片翻转 | CSS `transform-style: preserve-3d` | rotateY(180deg) + backface-visibility |

---

## 🔨 实现步骤

### Step 1: 准备素材脚本
```bash
# 下载必要素材到 resources/gacha/
mkdir -p resources/gacha
python tools/fetch/ba_gacha_assets.py --output resources/gacha
```

### Step 2: 重写 GachaEnterScene.tsx
- 替换系统室场景为街道全景
- 添加光柱上升组件
- 添加飞机转场组件

### Step 3: 新增 GachaCardFlip.tsx
- 实现 3D 卡片翻转组件
- 支持稀有度光芒效果
- 支持 NEW 徽标闪烁

### Step 4: 更新 GachaCutscene.tsx
- 调整阶段 timing 表
- 插入新镜头序列
- 同步音效时间戳

### Step 5: 测试验证
- e2e 截图对比官方视频
- 手动抽查各 rarities
- 音效时序校准

---

## 💰 成本估算

| 项目 | 带宽 | 费用（按$0.01/GB 计） |
|------|------|---------------------|
| 图片素材 (~1.5MB) | 1.5MB | $0.000015 |
| 音效素材 (~0.2MB) | 0.2MB | $0.000002 |
| GIF 素材 (~0.3MB) | 0.3MB | $0.000003 |
| **总计** | **~2MB** | **<$0.00002** |

**结论：2MB 流量成本不到 0.002 元人民币！**

即使后续有用户运行，素材只需下载一次（本地缓存）。

---

## ✨ 额外优化建议

### 1. Lottie 替代 GIF
如果用 Lottie JSON 格式，文件大小可缩小 60%：
- GIF: 300KB → Lottie: 120KB
- 优势：无限循环无质量损失、可动态改色

### 2. WebP 压缩图片
- JPG 800KB → WebP 300KB（质量无损）
- 节省 60% 空间

### 3. 增量加载策略
- 先加载低清预览图（保证流畅）
- 后台预加载高清图（用户体验无缝）

---

## 🎬 对比验证方法

### 和官方视频 BV1yF411Z7RD 逐帧对比的要点：
1. ** Timing 检查**: 每个阶段耗时是否一致？
2. **Camera 运动**: 缩放/平移的节奏感对吗？
3. **光线颜色**: SSR 金色饱和度和亮度够不够？
4. **声音层次**: 音效是否在正确时间点触发？
5. **细节彩蛋**: 有没有漏掉小动画（如星星闪烁、光点飘散）？

### 验收标准：
- [ ] 单抽总时长 9-11 秒
- [ ] 十连总时长 14-16 秒  
- [ ] 飞机镜头≥2 秒且流畅
- [ ] SSR 金光震撼度≈官方
- [ ] NEW 徽标闪烁明显但不刺眼
- [ ] 音效无明显延迟或错位

---

## 🚧 已知限制

1. **部分 BA 原声音乐受版权保护**，只能用音效
2. **学生角色 Q 版形象**需要预先渲染好的 Sprite 图集（暂无源）
3. **物理引擎效果**（如衣服飘动）需要 Spine/Mesh 数据（不在当前范围）

这些不影响主抽卡流程的还原度！
