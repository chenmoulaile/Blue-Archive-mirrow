# BA 资源全面解包执行计划

## ✅ 已启动
- [x] 记忆大厅 Spine 模型 (266 族) - **正在后台提取**

## 📋 待启动（按优先级排序）

### P0 - 核心动画资源
1. **抽卡动画** (extract_gacha_assets.py)
   - 阿罗娜 NPC 模型 (Arona_Original_*)
   - 稀有度背景 (Gacha_BG_*)
   - 卡片特效 (FX_TEX_GT_*)

2. **剧情立绘** (extract_local_spr.py)
   - 学生全身立绘 (*_spr 家族)

### P1 - 交互系统资源  
3. **咖啡厅家具** (extract_local_furniture.py)
   - 可互动家具模型

4. **音效系统** (extract_local_se.py)
   - 确认音效 SE_Confirm_02
   - 翻牌音效 SE_FLIP_*

### P2 - 辅助资源
5. **学生头像** (extract_local_avatar.py)
   - 所有学生 avatar 图片

6. **UI 图集** (extract_local_ui.py)
   - NGUI 图集切片（九宫格）
   - 界面元素

7. **剧情文本** (extract_local_story.py)
   - 完整剧本数据
   - 分支对话

8. **桃信聊天记录** (extract_momotalk.py)
   - 完整对话树

9. **NPC 头像** (extract_npc_portrait.py)
   - 剧情中出现的人物立绘

## 🎯 执行顺序建议

```bash
# Step 1: Spine 模型（已启动）
python tools/fetch/extract_local_spine.py --all-safe

# Step 2: 抽卡动画素材
python tools/fetch/extract_gacha_assets.py

# Step 3: 剧情立绘  
python tools/fetch/extract_local_spr.py

# Step 4: 其他资源（并行执行）
python tools/fetch/extract_local_avatar.py &
python tools/fetch/extract_local_furniture.py &
python tools/fetch/extract_local_se.py &
python tools/fetch/extract_local_ui.py &
python tools/fetch/extract_local_story.py &
wait

# Step 5: 辅助资源（低优先级）
python tools/fetch/extract_momotalk.py &
python tools/fetch/extract_npc_portrait.py &
wait
```

## 📊 预估产出

| 资源类型 | 文件数量 | 预估大小 |
|----------|----------|----------|
| Spine 模型 | ~266 套 × 3文件 | 500MB |
| 学生立绘 | ~200 张 | 150MB |
| UI 图集 | ~1500 PNG | 80MB |
| 头像 | ~500 张 | 50MB |
| 家具模型 | ~100 套 | 30MB |
| 音效 | ~600 个 OGG | 80MB |
| 剧情数据 | ~3000 JSON | 20MB |
| **总计** | **~5000 文件** | **~900MB** |

## ⚠️ 注意事项

1. **硬盘空间**: 确保 D 盘有至少 5GB 可用空间
2. **运行时间**: Spine 提取可能需要 10-15 分钟
3. **依赖关系**: 部分资源依赖 `data/asset_map.json` 索引文件
4. **去重处理**: 不同资源源可能有重复，注意用 catalog 版本控制

## 📝 后续步骤

完成提取后：
1. 运行 `npm run build` 更新 UI
2. 检查新提取的资源是否被正确引用
3. 运行 e2e 测试验证功能完整性
4. 更新 asset_map.json 索引
