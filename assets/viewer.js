'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const MODELS = ['wat3r', 'da3', 'watervggt', 'watervggt_wcv'];
  const SCENES = window.WATERVIEW_SCENES;
  const BENCH = window.WATERVIEW_BENCHMARK || {metrics: {}, sceneStats: {}, gallery: [], rankings: {}};
  const MODEL_LABELS = BENCH.models || {wat3r: 'Wat3R', da3: 'DA3', watervggt: 'VGGT', watervggt_wcv: 'WCV + VGGT'};
  const DEPTH = window.WATERVIEW_DEPTH || [];
  const panels = {};
  const cache = new Map();
  const CACHE_FRAMES = 288; // Two full 32-frame scenes = 256 model-frames (~32 MiB).
  const imageCache = new Map();
  const IMAGE_CACHE_FRAMES = 48;
  let scene, frame = 0, pendingFrame = 0, confidence = 100, playing = false, loading = false;
  let hdEnabled = false, layout = 'four', focusModel = 'wat3r', caseTask = 'point', caseQuality = 'good';
  let snap = false; // 吸附到当前帧相机位姿（有 cams 数据的场景默认开启）
  let requestId = 0, controller, timer, dirty = true, syncing = false;
  let lastAdvance = 0, buffering = false, playbackEpoch = 0;
  let lastTime = performance.now();
  let prefetchAbort = null, prefetchScene = null;
  const inflight = new Map();

  function fatal(error) {
    $('status').textContent = '无法初始化点云';
    MODELS.forEach(m => { $('ld_' + m).textContent = error.message; });
    console.error(error);
  }
  try {
  const esc = value => String(value).replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
  const metricSpec = {
    pose: {title: 'Pose', fields: [['auc30', 'AUC@30', '↑', true], ['auc15', 'AUC@15', '↑', true], ['auc05', 'AUC@5', '↑', true]]},
    depth: {title: 'Depth', fields: [['abs_rel', 'AbsRel', '↓', false], ['rmse', 'RMSE', '↓', false], ['delta1', 'δ1', '↑', true]]},
    point: {title: 'Point Cloud', fields: [['overall', 'CD / Chamfer', '↓', false], ['acc', 'Acc', '↓', false], ['comp', 'Comp', '↓', false], ['fscore', 'F-score', '↑', true]]}
  };
  function metricEntry(model, current = scene) {
    const key = current && (current.sid || current.id);
    return BENCH.metrics?.[model]?.[key] || null;
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function renderDepthEvidence(currentFrame) {
    if (!$('depth-sync-note')) return;
    const key = scene && (scene.sid || scene.id);
    const item = DEPTH.find(x => x.scene === key && x.frame === currentFrame);
    const ids = ['depth-rgb','depth-gt','depth-wat3r','depth-da3','depth-watervggt','depth-watervggt_wcv'];
    if (!item) {
      ids.forEach(id => { const img=$(id); if(img){img.removeAttribute('src'); img.hidden=true;} });
      $('depth-unavailable').hidden = false;
      const sceneItems = DEPTH.filter(x => x.scene === key);
      $('depth-sync-note').textContent = sceneItems.length
        ? '当前帧没有导出的 Depth；本场景已导出代表帧：' + sceneItems.map(x => (x.frame + 1)).join('、') + '。拖到对应帧即可联动查看。'
        : '当前场景暂未导出代表 Depth；点云仍可正常逐帧播放。';
      return;
    }
    $('depth-unavailable').hidden = true;
    const sources = {
      'depth-rgb': item.rgb, 'depth-gt': item.gt,
      'depth-wat3r': item.predictions.wat3r, 'depth-da3': item.predictions.da3,
      'depth-watervggt': item.predictions.watervggt, 'depth-watervggt_wcv': item.predictions.watervggt_wcv
    };
    Object.entries(sources).forEach(([id,src]) => { const img=$(id); img.hidden=false; img.src=src; });
    $('depth-sync-note').textContent = item.scene + ' · frame ' + (item.frame + 1) + ' · ' + item.instance + ' · GT 有效覆盖 ' + (item.validCoverage*100).toFixed(1) + '%。RGB、GT 和四模型 Depth 与当前点云帧匹配。';
  }
  function renderSceneGt(current) {
    const key = current.sid || current.id;
    const item = (BENCH.gallery || []).find(candidate => candidate.scene === key);
    $('gt-card').hidden = !item;
    if (!item) { $('gtimg').removeAttribute('src'); return; }
    $('gtimg').src = item.gt;
    $('gtimg').alt = `${key} 场景参考 GT，原始帧 ${item.instance}`;
    $('gt-note').textContent = `参考帧 ${item.instance} · 有效 ${(item.validCoverage * 100).toFixed(1)}%`;
    $('gt-reference-note').textContent = '该场景的过滤后 GT 代表帧，播放时固定显示；不随当前输入帧变化。';
  }
  function caseRank(model, task, current) {
    const key = current.sid || current.id;
    const group = BENCH.rankings?.[model]?.[task];
    const rows = group?.all || [];
    const row = rows.find(x => x.scene === key);
    return row ? {rank: rows.indexOf(row) + 1, total: rows.length, value: row.value, metric: group.metric} : null;
  }
  function renderSceneEvidence() {
    const key = scene.sid || scene.id;
    const isWild = scene.group === 'uveb';
    const spec = metricSpec[caseTask];
    const entries = MODELS.map(model => ({model, entry: metricEntry(model)}));
    const primary = spec.fields[0];
    const ranked = entries.filter(x => finite(x.entry?.[caseTask]?.[primary[0]])).sort((a, b) => primary[3] ? b.entry[caseTask][primary[0]] - a.entry[caseTask][primary[0]] : a.entry[caseTask][primary[0]] - b.entry[caseTask][primary[0]]);
    const miniSpecs = [
      {path:['depth','abs_rel'], label:'AbsRel↓', higher:false},
      {path:['point','overall'], label:'CD↓', higher:false},
      {path:['point','fscore'], label:'F-score↑', higher:true}
    ];
    const miniRanks = miniSpecs.map(spec => {
      const vals = MODELS.map(model => {
        const e = metricEntry(model);
        const v = e?.[spec.path[0]]?.[spec.path[1]];
        return {model, value:v};
      }).filter(x => finite(x.value)).sort((a,b) => spec.higher ? b.value-a.value : a.value-b.value);
      return [...new Set(vals.map(x=>x.value))];
    });
    MODELS.forEach(model => {
      const strip = $('metrics_' + model);
      if (!strip) return;
      const entry = metricEntry(model);
      if (isWild || !entry) {
        strip.innerHTML = '<span>无 GT 定量分数</span>';
        return;
      }
      strip.innerHTML = miniSpecs.map((spec,i) => {
        const v = entry?.[spec.path[0]]?.[spec.path[1]];
        const r = miniRanks[i].indexOf(v);
        const cls = r===0 ? 'mini-best' : r===1 ? 'mini-second' : '';
        return '<span class="' + cls + '"><b>' + spec.label + '</b> ' + (finite(v) ? v.toFixed(4) : '—') + '</span>';
      }).join('');
    });
    MODELS.forEach(model => {
      const box = $('score_' + model);
      if (isWild || !metricEntry(model)) { box.innerHTML = '<span class="score-label">准确度</span>无 GT，暂无准确度分数'; return; }
      const entry = metricEntry(model), rank = ranked.findIndex(x => x.model === model);
      const value = entry[caseTask]?.[primary[0]];
      const unique = [...new Set(ranked.map(x => x.entry[caseTask][primary[0]]))];
      const distinctRank = unique.indexOf(value);
      const cls = distinctRank === 0 ? 'strong' : distinctRank === 1 ? 'under' : '';
      const detail = spec.fields.slice(1).map(([field, label, dir]) => finite(entry[caseTask]?.[field]) ? `${label}${dir} ${entry[caseTask][field].toFixed(4)}` : `${label}${dir} —`).join(' · ');
      box.innerHTML = `<span class="score-label">${primary[1]}${primary[2]}</span><span class="${cls}">${finite(value) ? value.toFixed(6) : '—'}</span><span class="score-scope">场景平均 · ${detail}</span>`;
    });
    MODELS.forEach(model => {
      const point = metricEntry(model)?.point?.overall;
      const chip = $('cham_' + model);
      chip.textContent = finite(point) ? 'CD ' + point.toFixed(6) : '';
      chip.classList.toggle('focus', model === scene.focus);
    });
    const rank = !isWild ? caseRank(focusModel, caseTask, scene) : null;
    const quality = rank ? `${rank.rank <= 5 ? '较好/较差榜候选' : '完整评测排序'} · ${rank.metric} ${rank.value.toFixed(6)} · ${rank.rank}/${rank.total}` : '定性案例；没有 GT 准确度排序';
    const stats = BENCH.sceneStats[key];
    $('case-context').innerHTML = `<strong>${esc(isWild ? 'Wild / UVEB' : 'Water3D benchmark')} · 关注 ${esc(MODEL_LABELS[focusModel])} · ${esc(caseTask === 'depth' ? 'Depth' : 'Point Cloud')}</strong><br>${esc(quality)}。${esc(scene.focusNote || scene.description || '')}${stats ? ` <span>原始 ${stats.originalFrames || '—'} 帧 · 评测 ${stats.evaluatedFrames} 帧 · 播放器 ${scene.nf} 帧。</span>` : ''}`;
  }
  function setLayout(next) {
    layout = next; $('layout').value = next; document.querySelector('.pgrid').className = 'pgrid layout-' + next;
    document.querySelectorAll('.pgrid .card').forEach(card => {
      card.classList.toggle('focused', card.dataset.model === focusModel);
      card.hidden = next === 'two' ? !['wat3r', 'watervggt'].includes(card.dataset.model) : next === 'single' ? card.dataset.model !== focusModel : false;
    });
    resize(); dirty = true;
  }
  function showRankedCases() {
    const group = BENCH.rankings?.[focusModel]?.[caseTask];
    const rows = group?.available || [];
    const chosen = caseQuality === 'good' ? rows.slice(0, 5) : rows.slice(-5).reverse();
    const list = chosen.map(row => SCENES.find(item => item.sid === row.scene || item.id === row.scene)).filter(Boolean);
    if (!list.length) return;
    $('sel').replaceChildren(...list.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.title} · ${item.sid || item.id}`; return option; }));
    document.querySelectorAll('.tab').forEach(tab => { tab.classList.remove('active'); tab.setAttribute('aria-pressed', 'false'); });
    loadScene(list[0]);
  }
  function setupPageMeta() {
    $('layout').onchange = () => setLayout($('layout').value);
    $('focus-method').onchange = () => { focusModel = $('focus-method').value; renderSceneEvidence(); setLayout(layout); if (scene && scene.group !== 'uveb') showRankedCases(); };
    $('case-task').onchange = () => { caseTask = $('case-task').value; renderSceneEvidence(); if (scene && scene.group !== 'uveb') showRankedCases(); };
    $('case-quality').onchange = () => {
      caseQuality = $('case-quality').value;
      if (scene.group !== 'uveb') showRankedCases();
    };
    document.querySelectorAll('.quick[data-quick]').forEach(button => button.onclick = () => {
      const wanted = button.dataset.quick === 'gt_missing' ? 'video_7762649' : button.dataset.quick;
      const match = SCENES.find(s => s.id === wanted || s.sid === wanted);
      if (!match) return;
      const focusFrame = match.focusFrame != null ? match.focusFrame : (button.dataset.quick === 'creature_15' ? 17 : button.dataset.quick === 'gt_missing' ? 22 - (match.sourceFrameOffset || 0) : 18);
      chooseGroup(match.group, match.id, focusFrame);
      document.querySelector('.selection').scrollIntoView({behavior: 'smooth', block: 'start'});
    });
    document.querySelectorAll('.bottom-five').forEach(button => button.onclick = () => {
      focusModel = button.dataset.bottomModel;
      caseTask = 'depth';
      caseQuality = 'bad';
      $('focus-method').value = focusModel;
      $('case-task').value = 'depth';
      $('case-quality').value = 'bad';
      showRankedCases();
      renderSceneEvidence();
      document.querySelector('.selection').scrollIntoView({behavior: 'smooth', block: 'start'});
    });
  }
    if (!window.THREE || !THREE.OrbitControls || !SCENES || !SCENES.length) {
      throw new Error('页面资源未加载完整，请刷新重试');
    }
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const ctx = dot.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(16, 16, 15, 0, Math.PI * 2); ctx.fill();
    const texture = new THREE.CanvasTexture(dot);
    MODELS.forEach(m => {
      const renderer = new THREE.WebGLRenderer({canvas: $('cv_' + m), antialias: true});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      const world = new THREE.Scene();
      world.background = new THREE.Color(0x090e15);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
      camera.up.set(0, 0, 1);
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableDamping = false;
      controls.minDistance = 0.6; controls.maxDistance = 15;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60000), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(60000), 3, true));
      geometry.setDrawRange(0, 0);
      const material = new THREE.PointsMaterial({size: +$('psz').value / 700, map: texture,
        alphaTest: 0.5, vertexColors: true, sizeAttenuation: true});
      geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
      const cloud = new THREE.Points(geometry, material);
      cloud.frustumCulled = false; // All points are displayed; no per-frame bounds scan.
      world.add(cloud);
      panels[m] = {renderer, world, camera, controls, geometry, material, data: null, dragging: false};
      controls.addEventListener('start', () => { panels[m].dragging = true; });
      controls.addEventListener('end', () => { panels[m].dragging = false; });
      controls.addEventListener('change', () => { dirty = true; syncFrom(m); });
    });

    function syncFrom(model) {
      if (syncing || !$('sync').checked) return;
      syncing = true;
      const src = panels[model];
      MODELS.forEach(m => {
        if (m === model) return;
        const p = panels[m];
        p.camera.position.copy(src.camera.position);
        p.camera.quaternion.copy(src.camera.quaternion);
        p.controls.target.copy(src.controls.target);
        p.controls.update();
      });
      syncing = false; dirty = true;
    }
    function resetView() {
      syncing = true;
      MODELS.forEach(m => {
        const p = panels[m], az = -Math.PI / 6, el = Math.PI / 7, d = 2.6;
        p.controls.target.set(0, 0, 0);
        p.camera.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), d * Math.sin(el));
        p.camera.up.set(0, 0, 1);
        p.camera.fov = 50; p.camera.updateProjectionMatrix();
        p.camera.lookAt(0, 0, 0); p.controls.update();
      });
      syncing = false; dirty = true;
    }
    // 把四个视角吸附到“拍当前输入帧”的相机位姿（与点云同一坐标系，逐帧对应）。
    function applyCams(f) {
      const cf = scene.cams && scene.cams.frames[f];
      if (!cf) return;
      syncing = true;
      MODELS.forEach(m => {
        const p = panels[m];
        p.camera.position.set(cf[0], cf[1], cf[2]);
        p.camera.up.set(cf[6], cf[7], cf[8]);
        p.camera.fov = scene.cams.fov; p.camera.updateProjectionMatrix();
        p.controls.target.set(cf[0] + cf[3], cf[1] + cf[4], cf[2] + cf[5]);
        p.camera.lookAt(p.controls.target.x, p.controls.target.y, p.controls.target.z);
        p.controls.update();
      });
      syncing = false; dirty = true;
    }
    const pad = n => String(n).padStart(3, '0');
    const frameMeta = (current, model, next) => {
      const meta = current.bins[model];
      const hd = hdEnabled && meta.hdPath && meta.hdCounts;
      return {url: (hd ? meta.hdPath : meta.path) + pad(next) + '.bin', count: (hd ? meta.hdCounts : meta.counts)[next], hd};
    };
    async function getFrame(url, count, signal) {
      if (cache.has(url)) {
        const data = cache.get(url); cache.delete(url); cache.set(url, data);
        return data;
      }
      const existing = inflight.get(url);
      if (existing && !existing.signal.aborted) return existing.task;
      if (existing) inflight.delete(url);
      const task = (async () => {
        const response = await fetch(url, {signal, cache: 'default'});
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.arrayBuffer();
        if (data.byteLength !== count * 16) throw new Error('点云数据不完整');
        cache.set(url, data);
        while (cache.size > CACHE_FRAMES) cache.delete(cache.keys().next().value);
        return data;
      })();
      inflight.set(url, {task, signal});
      try { return await task; } finally { if (inflight.get(url)?.task === task) inflight.delete(url); }
    }
    function drawFrame(model) {
      const p = panels[model];
      if (!p.data) return;
      const n = p.count;
      const xyz = new Float32Array(p.data, 0, n * 3);
      const rgb = new Uint8Array(p.data, n * 12, n * 3);
      const ranks = new Uint8Array(p.data, n * 15, n);
      // Grow once if a high-density export exceeds the preview capacity.
      if (p.geometry.attributes.position.count < n) {
        p.geometry.dispose();
        p.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
        p.geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(n * 3), 3, true).setUsage(THREE.DynamicDrawUsage));
      }
      const positions = p.geometry.attributes.position.array;
      const colors = p.geometry.attributes.color.array;
      let shown = 0;
      if (confidence === 100) {
        // Bulk copies avoid creating tens of thousands of temporary subarrays.
        positions.set(xyz); colors.set(rgb); shown = n;
      } else {
        const histogram = new Uint32Array(256);
        for (let i = 0; i < n; i++) histogram[ranks[i]]++;
        let tiedBudget = Math.ceil(n * confidence / 100), threshold = 255;
        while (threshold > 0 && tiedBudget > histogram[threshold]) {
          tiedBudget -= histogram[threshold]; threshold--;
        }
        for (let i = 0; i < n; i++) {
          if (ranks[i] < threshold) continue;
          if (ranks[i] === threshold && tiedBudget-- <= 0) continue;
          const src = i * 3, dst = shown * 3;
          for (let k = 0; k < 3; k++) {
            positions[dst + k] = xyz[src + k]; colors[dst + k] = rgb[src + k];
          }
          shown++;
        }
      }
      for (const attr of [p.geometry.attributes.position, p.geometry.attributes.color]) {
        attr.updateRange.offset = 0; attr.updateRange.count = shown * 3;
        attr.needsUpdate = true;
      }
      p.geometry.setDrawRange(0, shown);
      $('count_' + model).textContent = shown.toLocaleString() + ' 点';
      $('ld_' + model).hidden = shown > 0;
      $('ld_' + model).textContent = '当前筛选下没有点';
      dirty = true;
    }
    function stop() {
      playing = false; buffering = false; playbackEpoch++; clearTimeout(timer); $('play').textContent = '▶ 播放';
    }
    function imageFor(current, next) {
      const url = current.img + pad(next) + '.jpg';
      if (imageCache.has(url)) {
        const task = imageCache.get(url);
        imageCache.delete(url); imageCache.set(url, task);
        return task;
      }
      const image = new Image();
      image.src = url;
      const task = image.decode().then(() => image).catch(error => {
        if (imageCache.get(url) === task) imageCache.delete(url);
        throw error;
      });
      imageCache.set(url, task);
      while (imageCache.size > IMAGE_CACHE_FRAMES) imageCache.delete(imageCache.keys().next().value);
      return task;
    }
    async function dataFor(current, next, signal) {
      return Promise.all(MODELS.map(m => {
        const meta = frameMeta(current, m, next);
        return getFrame(meta.url, meta.count, signal);
      }));
    }
    function cancelPrefetch() {
      if (prefetchAbort) prefetchAbort.abort();
      prefetchAbort = null; prefetchScene = null;
    }
    function prefetchSignal(current) {
      const key = current.id + ':' + hdEnabled;
      if (prefetchScene !== key) {
        cancelPrefetch(); prefetchAbort = new AbortController(); prefetchScene = key;
      }
      return prefetchAbort.signal;
    }
    async function warmAhead(current, from, distance = 3, onProgress = null) {
      const signal = prefetchSignal(current);
      const total = Math.min(distance, current.nf - 1);
      let cursor = 0, done = 0;
      // Two frames in flight, rather than flooding the connection with a clip.
      async function worker() {
        while (cursor < total && !signal.aborted) {
          const step = ++cursor, next = (from + step) % current.nf;
          await Promise.all([dataFor(current, next, signal), imageFor(current, next)]);
          if (signal.aborted) return;
          done++; if (onProgress) onProgress(done, total);
        }
      }
      await Promise.all([worker(), worker()]);
      if (signal.aborted) throw new DOMException('已取消预取', 'AbortError');
    }
    function scheduleNext() {
      clearTimeout(timer);
      if (playing && !loading && !buffering) {
        const delay = Math.max(0, lastAdvance + 1000 / +$('fps').value - performance.now());
        timer = setTimeout(() => requestFrame((frame + 1) % scene.nf), delay);
      }
    }
    async function requestFrame(next) {
      next = Math.max(0, Math.min(next, scene.nf - 1));
      if (loading && pendingFrame === next) return;
      clearTimeout(timer);
      if (controller) controller.abort();
      controller = new AbortController();
      const signal = controller.signal, id = ++requestId, selected = scene;
      const requestedFrame = next;
      const requestedMeta = MODELS.map(m => frameMeta(selected, m, next));
      pendingFrame = requestedFrame;
      loading = true;
      $('play').disabled = false;
      $('retry').hidden = true;
      $('status').textContent = '正在加载当前帧…';
      const results = await Promise.allSettled([dataFor(selected, requestedFrame, signal), imageFor(selected, requestedFrame)]);
      if (id !== requestId) return;
      loading = false;
      const failure = results.find(result => result.status === 'rejected');
      if (failure) {
        stop(); $('play').disabled = true; $('retry').hidden = false;
        $('status').textContent = '当前帧加载失败：' + failure.reason.message;
      } else {
        const data = results[0].value, image = results[1].value;
        frame = requestedFrame;
        $('frame').max = scene.nf - 1; $('frame').value = frame;
        $('frv').textContent = (frame + 1) + ' / ' + scene.nf;
        image.id = 'fimg';
        image.alt = scene.title + '，第 ' + (frame + 1) + ' 帧';
        image.dataset.frame = String(frame);
        $('fimg').replaceWith(image);
        // Match the projection viewport to the actual input frame. Water3D
        // scenes do not all have the same aspect ratio.
        MODELS.forEach(m => {
          panels[m].renderer.domElement.style.aspectRatio = image.naturalWidth + '/' + image.naturalHeight;
        });
        resize();
        MODELS.forEach((m, i) => {
          panels[m].data = data[i]; panels[m].count = requestedMeta[i].count; drawFrame(m);
          panels[m].renderer.domElement.dataset.frame = String(frame);
        });
        $('play').disabled = false; $('status').textContent = '四模型当前帧已就绪';
        renderDepthEvidence(frame);
        if (snap) applyCams(requestedFrame);
        const now = performance.now(), interval = 1000 / +$('fps').value;
        lastAdvance = playing && lastAdvance ? Math.max(lastAdvance + interval, now - interval) : now;
        if (!playing || $('buffer-mode').value === 'stream') warmAhead(selected, frame).catch(() => {});
        scheduleNext();
      }
    }
    function loadScene(selected, initialFrame = 0) {
      stop(); cancelPrefetch(); scene = selected; frame = 0; pendingFrame = 0;
      const blank = new Image();
      blank.id = 'fimg'; blank.alt = '正在加载输入帧';
      $('fimg').replaceWith(blank);
      MODELS.forEach(m => {
        panels[m].data = null; panels[m].geometry.setDrawRange(0, 0);
        delete panels[m].renderer.domElement.dataset.frame;
        $('count_' + m).textContent = '';
        $('ld_' + m).hidden = false; $('ld_' + m).textContent = '加载当前帧…';
      });
      dirty = true;
      $('description').textContent = scene.description;
      $('badge').textContent = scene.badge || '';
      $('scene-id').textContent = scene.sid || scene.id;
      MODELS.forEach(m => {
        const chip = $('cham_' + m), score = scene.chamfer && scene.chamfer[m];
        chip.textContent = score != null ? score.toFixed(2) : '';
        chip.classList.toggle('focus', score != null && scene.focus === m);
      });
      $('tags').textContent = scene.tags;
      renderSceneEvidence();
      renderSceneGt(scene);
      renderDepthEvidence(initialFrame);
      const hasHd = MODELS.every(m => scene.bins[m]?.hdPath && scene.bins[m]?.hdCounts);
      $('hd').disabled = !hasHd;
      $('hd-note').textContent = hasHd ? `高清模式：${Math.max(...scene.bins.wat3r.hdCounts).toLocaleString()} 点/帧真实导出，按当前场景/帧加载。` : '当前案例没有高密度导出，保持预览点云。';
      if (!hasHd) hdEnabled = false;
      $('hd').checked = hdEnabled;
      $('v').pause(); $('v').removeAttribute('src'); $('v').load();
      $('vcard').hidden = !scene.video;
      $('load-video').hidden = false;
      $('v').poster = scene.img + '000.jpg';
      $('sel').value = scene.id;
      snap = !!scene.cams;
      $('align').hidden = !scene.cams;
      $('align').setAttribute('aria-pressed', String(snap));
      $('align').classList.toggle('active', snap);
      if (snap) $('rot').checked = false;
      document.querySelectorAll('.tab').forEach(tab => {
        const active = tab.dataset.group === scene.group;
        tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active));
      });
      try { history.replaceState(null, '', '#' + encodeURIComponent(scene.id)); } catch (_) {}
      resetView(); requestFrame(initialFrame);
    }
    function chooseGroup(group, wanted, initialFrame = 0) {
      const list = SCENES.filter(s => s.group === group);
      $('sel').replaceChildren();
      list.forEach(s => {
        const option = document.createElement('option'); option.value = s.id;
        option.textContent = s.title + ' · ' + (s.sid || s.id); $('sel').appendChild(option);
      });
      loadScene(list.find(s => s.id === wanted) || list[0], initialFrame);
    }
    document.querySelectorAll('.tab').forEach(tab => {
      tab.onclick = () => { if (scene.group !== tab.dataset.group) chooseGroup(tab.dataset.group); };
    });
    $('sel').onchange = () => loadScene(SCENES.find(s => s.id === $('sel').value));
    $('frame').oninput = () => { stop(); cancelPrefetch(); requestFrame(+$('frame').value); };
    $('conf').oninput = () => {
      confidence = +$('conf').value; $('confv').textContent = confidence + '%'; MODELS.forEach(drawFrame);
    };
    $('hd').onchange = () => {
      const hasHd = scene && MODELS.every(m => scene.bins[m]?.hdPath && scene.bins[m]?.hdCounts);
      hdEnabled = !!$('hd').checked && hasHd;
      if (!hasHd) { $('hd').checked = false; $('hd-note').textContent = '当前案例没有高密度导出，保持预览点云。'; return; }
      stop(); cancelPrefetch(); requestFrame(frame);
    };
    $('psz').oninput = () => {
      $('pszv').textContent = $('psz').value;
      MODELS.forEach(m => { panels[m].material.size = +$('psz').value / 700; }); dirty = true;
    };
    $('fps').oninput = () => { $('fpsv').textContent = $('fps').value + ' fps'; scheduleNext(); };
    $('reset').onclick = resetView;
    $('align').onclick = () => {
      snap = !snap;
      $('align').setAttribute('aria-pressed', String(snap));
      $('align').classList.toggle('active', snap);
      if (snap) { $('rot').checked = false; applyCams(frame); }
    };
    // 验收脚本用来核对吸附位姿
    window.__WV_CAM__ = () => panels.wat3r.camera.position.toArray().map(v => Math.round(v * 1e4) / 1e4);
    $('sync').onchange = () => syncFrom(MODELS[0]);
    $('rot').onchange = () => { dirty = true; };
    $('retry').onclick = () => requestFrame(pendingFrame);
    $('buffer-mode').onchange = () => { stop(); cancelPrefetch(); };
    $('play').onclick = async () => {
      if (playing) { stop(); cancelPrefetch(); return; }
      // The pending first frame will finish before a second click starts playback.
      if (loading) return;
      playing = true; buffering = true;
      const epoch = ++playbackEpoch, current = scene, id = requestId;
      $('play').textContent = '❚❚ 暂停';
      const complete = $('buffer-mode').value === 'complete';
      const distance = complete ? current.nf - 1 : Math.min(8, current.nf - 1);
      $('status').textContent = '正在缓冲后续帧…';
      try {
        await warmAhead(current, frame, distance, (done, total) => {
          if (epoch === playbackEpoch) $('status').textContent = `正在缓冲 ${done + 1} / ${total + 1} 帧…`;
        });
        if (!playing || epoch !== playbackEpoch || scene !== current || requestId !== id) return;
        buffering = false; lastAdvance = performance.now();
        $('status').textContent = '四模型当前帧已就绪 · ' + (complete ? '整段已缓存' : '开始播放');
        scheduleNext();
      } catch (error) {
        if (epoch !== playbackEpoch) return;
        stop(); $('status').textContent = '缓冲未完成，请点击播放重试：' + error.message;
      }
    };
    $('load-video').onclick = () => {
      if (!scene.video) return;
      $('v').src = scene.video; $('load-video').hidden = true;
      $('v').play().catch(() => { /* Native video controls remain available. */ });
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else dirty = true; });
    function resize() {
      MODELS.forEach(m => {
        const p = panels[m], bounds = p.renderer.domElement.getBoundingClientRect();
        const width = Math.round(bounds.width), height = Math.round(bounds.height);
        if (width <= 0 || height <= 0) return;
        // setSize reallocates the drawing buffer; only resize on layout changes.
        if (p.width !== width || p.height !== height) {
          p.width = width; p.height = height;
          p.renderer.setSize(width, height, false);
          p.camera.aspect = width / height; p.camera.updateProjectionMatrix();
        }
      }); dirty = true;
    }
    window.addEventListener('resize', resize);
    const axis = new THREE.Vector3(0, 0, 1);
    function tick(now) {
      const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now;
      if (!document.hidden) {
        if ($('rot').checked && !MODELS.some(m => panels[m].dragging)) {
          const rotateModels = $('sync').checked ? [MODELS[0]] : MODELS;
          rotateModels.forEach(m => {
            const p = panels[m];
            p.camera.position.applyAxisAngle(axis, .15 * dt); p.camera.lookAt(p.controls.target);
            p.controls.update();
          }); dirty = true;
        }
        if (dirty) {
          MODELS.forEach(m => { const p = panels[m]; if (!$('card_' + m).hidden) p.renderer.render(p.world, p.camera); });
          dirty = false;
        }
      }
      requestAnimationFrame(tick);
    }
    setupPageMeta();
    resize(); requestAnimationFrame(tick);
    let initial;
    try { initial = SCENES.find(s => s.id === decodeURIComponent(location.hash.slice(1))); } catch (_) {}
    initial = initial || SCENES[0]; chooseGroup(initial.group, initial.id, Number(new URLSearchParams(location.search).get('frame')) || 0);
  } catch (error) { fatal(error); }
})();
