# spr spine 表情差分映射说明（一页）

> 数据来源：`resources/spine/*_spr*/ *.atlas`（624 个，实测）与 ExcelDB `ScenarioScriptDBSchema`（388859 行）。机器可读版：`data/story_meta.json`。

## 1. 剧本行 → (屏幕槽位, 表情号)

ExcelDB `script_kr`（镜像 dump 的 `Script` 字段同构）说话行格式：

```
<slot>;<krName>;<seq>;<text>
3;아루;01;혹시 받고 싶은 포상이라든가 있어?
```

- **slot**（1-5）：立绘屏幕槽位。同一角色在一集内会换槽（实测 group 1000020 里 아루 依次出现在 3/5/4 槽），即"走位"；NPC（检黑西装、马埃斯特罗等）固定槽 3。全库分布：3=111464、5=14204、1=13952、4=5610、2=4881。
- **seq**（两位数字）：表情差分号，直接对应 spr 模型的 attachment 区域名编号。

## 2. 表情号 → attachment

spr atlas 的区域名就是表情差分（akane_spr 实例）：

```
00_default  01_eyeclose  02_nomal  03_respond  04_smile
05_embarassed  06_serious  07_depressed  08
```

规则：

1. **按编号前缀匹配**：`seq="04"` → 区域 `04_*`。**不要按后缀匹配**——后缀是美工手打的，实测存在 `nomal`/`embarassed`/`embrassed`/`defualt` 等拼写变体，还有无后缀的裸编号（如 `08`，3211 处）。
2. **回退**：该模型没有这个编号时，退到最大的 `NN < seq`；再没有则 `00_default`。
3. **seq="99"**：高频特殊值（11460 次），语义未证实，不要当普通表情渲染（建议保持当前表情或隐藏）。
4. 编号覆盖：剧本里出现 00-99（55 个不同值）；atlas 里实际存在 00-46（个别模型到 46）+ 99。

## 3. 动作指令（`#N;cmd` 行）

说话行后面的 `#N;...` 行是对**槽位 N** 角色的动作指令：

| 指令 | 含义 |
| --- | --- |
| `#N;stiff` / `#N;shak` | 僵直 / 摇晃 |
| `#N;em;[?!]` | 头顶情绪符号 |
| `#N;hophop` / `#N;closeup` | 跳跳 / 特写 |
| `#N;m1`~`m4` | 姿态切换 |
| `#all;hide` | 全部立绘隐藏 |
| `#wait;N` / `#st` / `#clearST` / `#na;<名>;<文本>` / `#zmc` / `#bgshake` | 场景级指令（等待/字幕/旁白/运镜） |

## 4. 分支播放（配套 `StoryOp.choice` 扩展）

- `choice` 节点：`{op:'choice', options:[{text, nextGroup}]}`，`nextGroup` 是分支号字符串。
- 分支内容 = choice 之后**连续带 `branch:"N"` 标记**的节点（ExcelDB 侧来自 `selection_group`，镜像侧来自 `SelectionGroup`）；分支节点耗尽即汇合回主线。
- 单独 `[s] 文本`（无编号）是**单选项伪选项**（无分支，全库 4374 处），`options` 只有 1 项且 `nextGroup` 为空——按普通点按台词渲染即可。
- 数据量：ExcelDB 侧 5277 个 choice / 1381 个带文本的分支节点；镜像 bond/event 侧 9977 个 choice / 13521 个选项。主线大量 choice 的分支只有 `#wait` 差异（如 10013005 第一处选项），属正常现象。
