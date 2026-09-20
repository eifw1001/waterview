# WaterView · 水下重建证据浏览器

在线预览：https://eifw1001.github.io/waterview/

展示 Wat3R、DA3、VGGT、WCV + VGGT 的逐帧预测点云，并把
`metrics.json` 的场景平均分数、排名、过滤后的 geometric GT 和播放器放在同一页。
各模型通过 Umeyama Sim(3) 对齐到 Wat3R 参考系，并共用中心/半径归一化；
Wild 没有 GT 准确度分数，Water3D 分数按固定本地协议展示。

本阶段新增：

- Pose / Depth / Point Cloud 分开的定量表格，按未舍入值和 ↑ / ↓ 自动排名；
- 10 张 geometric GT + valid_mask 画廊，明确原图、GT、输入/评测尺寸与帧数口径；
- 当前场景四个模型的场景平均分数、跨模型名次、Depth / Point Cloud 切换；
- 四模型、Wat3R/VGGT 两模型大画面、单模型放大布局；
- `creature_15` 鲨鱼、`creature_03` 背景细杆、GT 缺失候选快捷入口；
- 所有已展示场景均可切换已有真实高密度导出：Wild 约 20,000 点/帧，Water3D 约 12,000 点/帧；仅勾选高清模式时按当前帧请求。

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
| Wat3R 绝对最差 | video_7762649 | 点云散裂 · Chamfer 6.37（本场最优 da3 1.38） |
| Wat3R 绝对最差 | video_33847329 | 全场皆难 · 5.35（四模型均 >5，Wat3R 反而最完整） |
| Wat3R 绝对最差 | video_6430496 | 结构粘连 · 3.17（最优 watervggt 0.47） |
| Wat3R 绝对最差 | video_31824524 | 飞点失控 · 2.14（最优 watervggt 1.63） |
| Wat3R 绝对最差 | video_11273415 | 碎片化 · 1.62（Wat3R 实为四家最优，次优 da3 2.23） |
| Wat3R 相对最差 | video_11634794 | 点云塌缩 · 0.60 vs 最优 0.06（10.0×） |
| Wat3R 相对最差 | video_6430496 | 3.17 vs 0.47（6.8×） |
| Wat3R 相对最差 | video_7762649 | 6.37 vs 1.38（4.6×） |
| Wat3R 相对最差 | video_31650576 | 远场漂移 · 0.68 vs 0.24（2.8×） |
| Wat3R 相对最差 | video_11138687 | 结构发散 · 0.62 vs 0.23（2.7×） |
| VGGT 绝对最差 | video_33847329 | 整体糊化 · 5.44（四模型均 >5） |
| VGGT 绝对最差 | video_7762649 | 2.64（最优 da3 1.38） |
| VGGT 绝对最差 | video_11273415 | 2.55（最优 wat3r 1.62） |
| VGGT 绝对最差 | video_34172248 | 层间错位 · 2.52（最优 da3 0.48） |
| VGGT 绝对最差 | video_31550645 | 雪片噪声 · 2.34（最优 wat3r 1.14） |
| VGGT 相对最差 | video_31824746 | 结构坍缩 · 2.03 vs 0.30（6.8×） |
| VGGT 相对最差 | video_34172248 | 2.52 vs 0.48（5.2×） |
| VGGT 相对最差 | video_34808164 | 碎片条带 · 0.69 vs 0.17（4.1×） |
| VGGT 相对最差 | video_34675110 | 断裂散落 · 1.43 vs 0.42（3.4×） |
| VGGT 相对最差 | cv_1326 | 远场毛刺 · 0.44 vs 0.14（3.2×） |

Wild 从原页面的 12 个场景中，按首帧、中间帧、末帧的四模型几何差异筛选前 5 个，
再检查输入画面。差异分数：每模型每帧按索引步长 8 采样，在已有共同坐标系下，
计算六对模型的双向最近邻距离中位数，取双向、模型对、三帧的均值。
五个场景的分数依次为 0.1387、0.1067、0.0893、0.0780、0.0685。
这些值仅用于筛选视觉差异，不是准确度指标或模型排名。
Water3D 按输入画面的色偏、能见度和纹理覆盖选取三个案例。

「最差」四组依据 `eval_water3d/results/metrics.json`（Water3D 真值，42 个场景）
的 Chamfer（point.overall），分两个口径各取前 5：

- **绝对最差**：该模型自身 Chamfer 最大的 5 个场景——可能是全场都难
  （video_33847329 四家均 >5），甚至该模型仍是四家最优（video_11273415 的 Wat3R）。
- **相对最差**：该模型 ÷ 同场最优模型 倍数最大的 5 个场景——反映该模型独有的失效，
  如 video_11634794 的 Wat3R 落后 10.0 倍。

同一场景可出现在多个分组（如 video_7762649 同时在 Wat3R 绝对/相对与 VGGT 绝对三组）；
条目 id 加后缀去重，`sid` 保留真实场景名，帧数据共用同一目录。
页面卡片标题栏的数字即各模型在本场的 Chamfer，越小越好，当前关注的模型高亮。
U36K 暂不在页面展示，原始文件保留。
video_7762649 的源视频是剪辑合辑，开头有一段泳池镜头与主体硬切；
已剪掉片头（保留 30 帧，静帧重新编号），保证输入帧与点云对应。

## 加载方式

- 首屏只下载当前帧（512,000 字节）和一张输入图，不抢先下载整段点云或视频；此数值不包括脚本，不等于实测时间减少比例。
- 只预取当前帧后面 3 帧的点云与输入图；点击播放时先缓冲 2 帧，避免整场景预载抢占带宽。加载失败可重试。
- 图片和四模型点云都解码完才一起更新画面、帧号与相机位姿；快速拖动时丢弃过期请求。
- 切场景中止旧预取；内存 LRU 缓存最多 288 个模型帧和 48 张输入图。
- 分帧路径含源数据哈希，允许浏览器正常 HTTP 缓存。
- 原始视频点击后才设置下载地址；暂停且视角不变时不重复执行 WebGL 绘制。
- 置信度滑杆表示保留最高置信度点的百分比，100% 保留全部点。
- 「对齐输入帧视角」把四个视角吸附到拍当前帧的相机位姿（Wat3R pred 的
  extrinsic 经与点云相同的中心/半径归一化恢复，逐帧精确对应），拖动时间轴时
  相机跟随帧移动，点云呈现与输入帧一致的构图。有相机数据的场景默认开启，
  可切回自由视角；Wild 五个场景也从预测位姿恢复了相机视角。
  点云画布使用输入图的真实宽高比。裁剪过片头的 video_7762649 使用源帧 2 起的位姿。

## 维护与预览

`scripts/selected-scenes.json` 保存选中场景的原始二进制元数据。
有 pred.npz 的场景还带 `cams`（逐帧相机中心/朝向/上向量 + fov），由
`experiments/dynamic_underwater/make_cam_poses.py` 从 Wat3R 的 extrinsic 生成
（与点云同一套中心/半径归一化，剪过片头的场景补上 2 帧偏移）。
代表场景（前 8 个）的源 bins 在仓库 `clouds_anim/` 内；
「最差」四组的源 bins 是构建输入，不发布，路径指向
`../experiments/dynamic_underwater/website/clouds_anim_gh/`（由
`experiments/dynamic_underwater/make_worst_groups.py` 按两个口径从 metrics.json
选出并抽稀生成）。
运行以下命令生成/更新逐帧资源、GT 画廊和 benchmark manifest：

```sh
python3 scripts/build-gt-gallery.py
python3 scripts/build-metadata.py
python3 scripts/build-frames.py
python3 -m http.server 8765 --bind 127.0.0.1
```

在浏览器打开 http://127.0.0.1:8765/ 。静态页面无需打包。
更新 CSS、JS 或场景清单后，同时更新 `index.html` 中资源版本参数。

`build-metadata.py` 只读取现有 `metrics.json` / `common_frames.json`，不会重跑模型。
`build-frames.py` 只对已有导出做切帧；高清源来自已有的
`experiments/dynamic_underwater/website/clouds_anim`，Wild 和 Water3D 均按需复制到网站资源目录。

浏览器验收：安装 Playwright 及其 Chromium，在预览服务启动后运行
`node scripts/test-viewer.cjs`（或通过 `NODE_PATH` 指向外部 Playwright 安装）。
脚本覆盖 Wild/Water3D 相机位姿、输入图与画布宽高比、慢速请求时的同帧显示、
快速拖动、缓冲后播放节奏和手机布局；截图写入 `/tmp/waterview-playback-mobile.png`。
视频数据来自 UVEB（MIT）。

## 2026-09-20：点云首页与独立报告页

- `index.html` 恢复四模型横排点云首页，保留两模型/单模型布局、分数和重点案例入口。
- `benchmark.html`：总体指标与 42 个场景的帧数/分辨率明细。
- `gt.html`：10 个过滤后 GT 代表帧，图片可放大。
- `depth.html`：上述 10 个代表帧的 RGB、geometric GT 和四模型深度，附场景平均分数。
  这是代表帧浏览页，尚非完整逐帧深度播放器。运行 `python3 scripts/build-depth-page.py`
  从现有预测重建静态图；逐帧 least-squares scale+shift 与本地深度评测一致。

播放器默认 8 fps（可调 1–15），仅控制抽帧序列的展示速度，不表示原视频帧率。
点击播放默认先缓冲当前整段点云和 RGB，再从内存连续播放；会显示缓冲进度。
也可选择边加载边播放，网络不足时该模式仍可能等待。首屏仍只加载当前帧并少量预取。
预取限制为两个帧任务并发，暂停缓冲/切场景会取消未完成的点云请求。

修复每帧重复 `renderer.setSize`、逐点临时数组分配及多余包围球计算；隐藏面板不绘制。
播放采用目标时间调度，避免每帧处理时间累加到播放间隔。
重点案例跳转改为直接指定初始帧，移除 250ms 延时竞争；剪片头的场景通过
`sourceFrameOffset` 对应原 GT，`video_7762649` 的展示帧 20 对应评测帧 22（均为零基）。

浏览器检查：
```
node scripts/test-viewer.cjs
node scripts/test-buffering.cjs
```
第二个脚本验证每请求额外 160ms 延迟时，整段缓存后仍可按 10 fps 循环播放，
并检查高清切换、场景取消、裁剪后的 GT 帧对应。外部 Playwright 安装可通过 `NODE_PATH` 指定。

GT 参考卡按场景显示：切帧和播放时保留该场景的 GT 代表图，标注其原始参考帧名；切换场景时更新，无参考图的场景隐藏卡片。该静态参考图不表示当前播放帧的 GT。
