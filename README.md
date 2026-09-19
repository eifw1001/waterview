# WaterView · 四模型水下点云对比

在线预览：https://eifw1001.github.io/waterview/

展示 Wat3R、DA3、Water-VGGT、Water-VGGT+WCV 的逐帧预测点云。
各模型通过 Umeyama Sim(3) 对齐到 Wat3R 参考系，并共用中心/半径归一化；无 GT 点云。

## 精选场景

| 数据集 | 场景 | 展示内容 |
| --- | --- | --- |
| Wild / UVEB | creature_15 | 高浑浊度鱼群 |
| Wild / UVEB | creature_14 | 低纹理鱼群近景 |
| Wild / UVEB | creature_13 | 密集鱼群与局部运动 |
| Wild / UVEB | arch_08 | 强偏绿结构 |
| Wild / UVEB | creature_01 | 海龟与珊瑚 |
| Water3D | cv_1151 | 强偏绿岩礁 |
| Water3D | cv_1123 | 低对比度岩礁 |
| Water3D | cv_1000 | 纹理较丰富的岩礁 |

Wild 从原页面的 12 个场景中，按首帧、中间帧、末帧的四模型几何差异筛选前 5 个，
再检查输入画面。差异分数：每模型每帧按索引步长 8 采样，在已有共同坐标系下，
计算六对模型的双向最近邻距离中位数，取双向、模型对、三帧的均值。
五个场景的分数依次为 0.1387、0.1067、0.0893、0.0780、0.0685。
这些值仅用于筛选视觉差异，不是准确度指标或模型排名。
Water3D 按输入画面的色偏、能见度和纹理覆盖选取三个案例。
U36K 暂不在页面展示，原始文件保留。

## 加载方式

- 原先首屏下载四个完整点云文件（16,384,000 字节）；现在只下载当前帧（512,000 字节），减少 96.875%。此数值不包括脚本和图片，不等于实测时间减少比例。
- 播放或拖动时按需加载下一帧，不再抢先下载整段点云或全部输入图片。
- 切帧/切场景中止旧请求；内存 LRU 缓存最多 96 个模型帧（约 12 MiB）。
- 分帧路径含源数据哈希，允许浏览器正常 HTTP 缓存；返回相同场景可复用内存数据。
- 原始视频点击后才设置下载地址；暂停且视角不变时不重复执行 WebGL 绘制。
- 置信度滑杆表示保留最高置信度点的百分比，100% 保留全部点。

## 维护与预览

`scripts/selected-scenes.json` 保存选中场景的原始二进制元数据。
运行以下命令无损生成 `clouds_frames/` 和 `assets/scenes.js`：

```sh
python3 scripts/build-frames.py
python3 -m http.server 8765 --bind 127.0.0.1
```

在浏览器打开 http://127.0.0.1:8765/ 。静态页面无需打包。
更新 CSS、JS 或场景清单后，同时更新 `index.html` 中资源版本参数。

浏览器验收：安装 Playwright 及其 Chromium，在预览服务启动后运行
`node scripts/test-viewer.cjs`（或通过 `NODE_PATH` 指向外部 Playwright 安装）。
脚本覆盖首屏请求量、8 场景、四模型、置信度、播放、缓存、刷新定位、失败重试、
过期请求和手机布局；截图写入 `/tmp/waterview-desktop.png` 与 `/tmp/waterview-mobile.png`。
视频数据来自 UVEB（MIT）。
