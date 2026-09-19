# WaterView · 四模型水下点云对比

在线预览：https://eifw1001.github.io/waterview/

展示 Wat3R、DA3、Water-VGGT、Water-VGGT+WCV 的逐帧预测点云。
各模型通过 Umeyama Sim(3) 对齐到 Wat3R 参考系，并共用中心/半径归一化；无 GT 点云。

## 场景分组

| 分组 | 场景 | 展示内容 |
| --- | --- | --- |
| Wild · 代表 | creature_15 | 高浑浊度鱼群 |
| Wild · 代表 | creature_14 | 低纹理鱼群近景 |
| Wild · 代表 | creature_13 | 密集鱼群与局部运动 |
| Wild · 代表 | arch_08 | 强偏绿结构 |
| Wild · 代表 | creature_01 | 海龟与珊瑚 |
| Water3D · 代表 | cv_1151 | 强偏绿岩礁 |
| Water3D · 代表 | cv_1123 | 低对比度岩礁 |
| Water3D · 代表 | cv_1000 | 纹理较丰富的岩礁 |
| Wat3R 最差 | video_7762649 | 点云散裂（Chamfer 6.37，其余最好 1.38） |
| Wat3R 最差 | video_6430496 | 结构粘连（3.17 vs 0.47） |
| Wat3R 最差 | video_31824524 | 飞点失控（2.14 vs 1.63） |
| Wat3R 最差 | cv_1223 | 浑浊失真（1.18 vs 0.73） |
| Wat3R 最差 | video_15196554 | 噪声淹没（1.17 vs 0.50） |
| Water-VGGT 最差 | video_33847329 | 整体糊化（5.44；该场景四模型 Chamfer 均偏高） |
| Water-VGGT 最差 | video_11273415 | 碎片化（2.55 vs 1.62） |
| Water-VGGT 最差 | video_34172248 | 层间错位（2.52 vs 0.48） |
| Water-VGGT 最差 | video_31550645 | 雪片噪声（2.34；+WCV 9.11 同样失效） |
| Water-VGGT 最差 | video_31824746 | 结构坍缩（2.03 vs 0.30） |

Wild 从原页面的 12 个场景中，按首帧、中间帧、末帧的四模型几何差异筛选前 5 个，
再检查输入画面。差异分数：每模型每帧按索引步长 8 采样，在已有共同坐标系下，
计算六对模型的双向最近邻距离中位数，取双向、模型对、三帧的均值。
五个场景的分数依次为 0.1387、0.1067、0.0893、0.0780、0.0685。
这些值仅用于筛选视觉差异，不是准确度指标或模型排名。
Water3D 按输入画面的色偏、能见度和纹理覆盖选取三个案例。

「最差」两组依据 `eval_water3d/results/metrics.json`（Water3D 真值，42 个场景），
按对应模型点云 Chamfer（point.overall）降序选取：Wat3R 组取绝对误差最大的 5 个，
并剔除 Wat3R 并非四模型中最差的场景（video_33847329、video_11273415、video_31550645）；
Water-VGGT 组取绝对误差最大的 5 个，去掉与 Wat3R 组重复的 video_7762649。
U36K 暂不在页面展示，原始文件保留。

## 加载方式

- 首屏只下载当前帧（512,000 字节）和一张输入图，不抢先下载整段点云或视频；此数值不包括脚本，不等于实测时间减少比例。
- 首帧就绪约 0.25 秒后，后台用 3 个并发把该场景其余帧全部预载进内存缓存（32 帧场景约 16 MiB），输入静帧一并预热；播放和拖进度条不再逐帧等网络。
- 后台预载失败即静默中止，不影响前台；前台加载失败仍显示重试按钮。
- 切场景中止旧预载；内存 LRU 缓存 288 个模型帧（约 36 MiB，够两个完整场景来回切换）。
- 分帧路径含源数据哈希，允许浏览器正常 HTTP 缓存。
- 原始视频点击后才设置下载地址；暂停且视角不变时不重复执行 WebGL 绘制。
- 置信度滑杆表示保留最高置信度点的百分比，100% 保留全部点。

## 维护与预览

`scripts/selected-scenes.json` 保存选中场景的原始二进制元数据。
代表场景（前 8 个）的源 bins 在仓库 `clouds_anim/` 内；
「最差」两组的源 bins 是构建输入，不发布，路径指向
`../experiments/dynamic_underwater/website/clouds_anim_gh/`（由
`experiments/dynamic_underwater/prep_worst_groups.py` 从 eval 结果抽稀生成）。
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
