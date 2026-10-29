# Spine 4.2 渲染踩坑记录

记忆大厅是本项目技术风险最高的部分。这里记录实测出来的几个坑，避免以后重踩。

## 1. 运行时只能用 4.2

kivo 的 `.skel` 二进制头是 `4.2.33` / `4.2.37` / `4.2.40` / `4.2.43`。

`pixi-spine` 最高支持 4.1，读到 4.2 的二进制会直接抛错或渲染错乱。
最终方案：官方 `@esotericsoftware/spine-webgl@4.2.120` 的 `SpineCanvas`，
独立 `<canvas>` 层叠在界面之上，不跟 Pixi 混用。

## 2. `drawSkeleton` 的第二个参数必须传 `false`

```ts
renderer.drawSkeleton(skeleton, premultipliedAlpha)
```

BA 的 atlas **没有** `pma: true` 标记，贴图是直通 alpha。
如果传 `true`，整只角色会变成大片白色色块（因为半透明像素被当成已预乘处理）。
这个坑很隐蔽：资源能加载、没有报错、就是画面白一片。

## 3. 相机 `zoom` 是「世界单位 / 像素」

`OrthoCamera.update()` 里是：

```js
projection.ortho(zoom * -vw/2, zoom * vw/2, zoom * -vh/2, zoom * vh/2, near, far)
```

也就是说可见世界高度 = `zoom * viewportHeight`。想把骨架高度 `h` 铺满视口：

```
zoom = h / (viewportHeight * fit)      ← 正确
zoom = viewportHeight * fit / h        ← 反了，会钻进贴图内部看到一片纯色
```

写反时的现象很好认：画面是整片渐变或纯色，没有角色轮廓。

## 4. 不能用附件包围盒做「自动适配」

`Skeleton.getBounds()` 会把所有附件算进去，而 BA 的回忆大厅模型常带有远处的道具、
背景板、备用差分，包围盒能比角色本体大 3~5 倍。用统一常数 `fit` 适配，
不同角色忽大忽小，必然翻车。

最终方案：**按包围盒把整个模型装进视口（zoom = 1 即完整可见），
再叠加用户自己的缩放/平移**，每个模型独立记忆视角。这样任何模型都不会被裁切，
用户想拉近就滚轮放大。

`SpineView` 的 `zoom` / `panX` / `panY` 就是这套机制，改动只作用于相机，不重建骨架。

## 5. 截图要用 Electron 的 `capturePage`

Playwright 的 `page.screenshot()` 抓不到 WebGL 画布，会拍成空白。
端到端测试里必须用：

```js
const img = await win.webContents.capturePage();
```

同理，`canvas.toDataURL()` / `drawImage(canvas)` 在 `preserveDrawingBuffer: false`
（默认）下读到的是已被清空的缓冲，会得到全透明，不能用来判断渲染结果。

## 6. GPU 进程在部分虚拟化环境会崩

在容器 / 远程桌面里 Electron 的 GPU 进程可能直接崩溃（`exit_code=-1073741819`），
表现为窗口白屏 + 主进程 fatal。启动时加 `--no-sandbox` 可以绕过。

`scripts/start.mjs` 只处理了 `ELECTRON_RUN_AS_NODE`；
在受限环境里跑端到端测试时，`scripts/e2e.mjs` 会额外传 `--no-sandbox`。
