'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const MODELS = ['wat3r', 'da3', 'watervggt', 'watervggt_wcv'];
  const SCENES = window.WATERVIEW_SCENES;
  const BENCH = window.WATERVIEW_BENCHMARK || {metrics: {}, sceneStats: {}, gallery: [], rankings: {}};
  const MODEL_LABELS = BENCH.models || {wat3r: 'Wat3R', da3: 'DA3', watervggt: 'Water-VGGT', watervggt_wcv: 'Water-VGGT+WCV'};
  const panels = {};
  const cache = new Map();
  const CACHE_FRAMES = 288; // Two full 32-frame scenes = 256 model-frames (~32 MiB).
  const imageCache = new Map();
  const IMAGE_CACHE_FRAMES = 48;
  let scene, frame = 0, pendingFrame = 0, confidence = 100, playing = false, loading = false;
  let hdEnabled = false, layout = 'four', focusModel = 'wat3r', caseTask = 'depth', caseQuality = 'good';
  let snap = false; // 吸附到当前帧相机位姿（有 cams 数据的场景默认开启）
  let requestId = 0, controller, timer, dirty = true, syncing = false;
  let lastAdvance = 0;
  let lastTime = performance.now();
  let prefetchAbort = null, prefetchScene = null;
  const inflight = new Map();

  function fatal(error) {
    $('status').textContent = '无法初始化点云';
    MODELS.forEach(m => { $('ld_' + m).textContent = error.message; });
    console.error(error);
  }
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
  function renderBenchmark() {
    const stats = Object.values(BENCH.sceneStats || {});
    const evaluated = stats.map(x => x.evaluatedFrames).filter(Number.isFinite);
    const original = stats.map(x => x.originalFrames).filter(Number.isFinite);
    const exported = (BENCH.resourceScenes || []).length;
    const range = values => values.length ? Math.min(...values) + '–' + Math.max(...values) : '—';
    $('benchmark-stats').innerHTML = [
      ['42', 'Water3D scenes / sequences'],
      [exported, '网页可交互资源（含 Wild）'],
      [range(original), '原始帧数 / scene'],
      [range(evaluated), '实际评测帧数 / scene'],
      ['518 px', '评测 GT 短边 / 模型输入基准']
    ].map(([value, label]) => `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
    $('protocol-note').textContent = BENCH.protocol?.summary + ' ' + BENCH.protocol?.scope + ' ' + BENCH.protocol?.input;
  }
  function renderMetricTable(kind = 'depth') {
    const spec = metricSpec[kind];
    const rows = MODELS.map(model => {
      const entries = Object.values(BENCH.metrics?.[model] || {});
      return {model, values: spec.fields.map(([key]) => {
        const values = entries.map(entry => entry[kind]?.[key]).filter(finite);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      })};
    });
    $('metric-tabs').innerHTML = Object.entries(metricSpec).map(([key, value]) => `<button class="metric-tab${key === kind ? ' active' : ''}" data-metric="${key}" role="tab" aria-selected="${key === kind}">${value.title}</button>`).join('');
    const ranks = spec.fields.map(([, , , higher], index) => rows.map(row => ({row, value: row.values[index]})).filter(x => finite(x.value)).sort((a, b) => higher ? b.value - a.value : a.value - b.value).map(x => x.row.model));
    $('metrics-table-wrap').innerHTML = `<table class="metric-table"><thead><tr><th>model · ${spec.title}</th>${spec.fields.map(([, label, dir]) => `<th>${label} ${dir}<br><small>scene mean</small></th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${esc(MODEL_LABELS[row.model])}</td>${row.values.map((value, index) => { const rank = ranks[index].indexOf(row.model); return `<td class="${rank === 0 ? 'rank-1' : rank === 1 ? 'rank-2' : ''}">${finite(value) ? value.toFixed(4) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    document.querySelectorAll('.metric-tab').forEach(tab => tab.onclick = () => renderMetricTable(tab.dataset.metric));
  }
  function renderGallery() {
    const items = BENCH.gallery || [];
    $('gallery-count').textContent = items.length + ' representative frames';
    $('gt-gallery').innerHTML = items.map(item => `<article class="gallery-card"><div class="gallery-images"><img loading="lazy" src="${esc(item.rgb)}" alt="${esc(item.scene)} RGB frame ${item.frame}"><img loading="lazy" src="${esc(item.gt)}" alt="${esc(item.scene)} filtered geometric GT depth frame ${item.frame}"></div><div class="gallery-caption"><strong>${esc(item.scene)} · frame ${item.frame + 1}</strong><span>${esc(item.note)} · ${esc(item.instance)}</span><span>${esc(item.label)} · valid ${(item.validCoverage * 100).toFixed(1)}% · range ${item.scale[0]}–${item.scale[1]}</span></div></article>`).join('');
  }
  function renderCurrentGt(current, currentFrame) {
    const key = current.sid || current.id;
    const item = (BENCH.gallery || []).find(candidate => candidate.scene === key && candidate.frame === currentFrame);
    $('gt-card').hidden = !item;
    if (!item) return;
    $('gtimg').src = item.gt; $('gtimg').alt = `${key} filtered geometric GT, frame ${currentFrame + 1}`;
    $('gt-note').textContent = `valid ${(item.validCoverage * 100).toFixed(1)}% · geometric`;
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
    MODELS.forEach(model => {
      const box = $('score_' + model);
      if (isWild || !metricEntry(model)) { box.innerHTML = '<span class="score-label">准确度</span>无 GT，暂无准确度分数'; return; }
      const entry = metricEntry(model), rank = ranked.findIndex(x => x.model === model);
      const value = entry[caseTask]?.[primary[0]];
      const cls = rank === 0 ? 'strong' : rank === 1 ? 'under' : '';
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
    renderBenchmark(); renderMetricTable('depth'); renderGallery();
    $('layout').onchange = () => setLayout($('layout').value);
    $('focus-method').onchange = () => { focusModel = $('focus-method').value; renderSceneEvidence(); setLayout(layout); if (scene && scene.group !== 'uveb' && caseQuality !== 'good') showRankedCases(); };
    $('case-task').onchange = () => { caseTask = $('case-task').value; renderSceneEvidence(); if (scene && scene.group !== 'uveb') showRankedCases(); };
    $('case-quality').onchange = () => {
      caseQuality = $('case-quality').value;
      showRankedCases();
    };
    document.querySelectorAll('.quick').forEach(button => button.onclick = () => {
      const wanted = button.dataset.quick === 'gt_missing' ? 'video_7762649' : button.dataset.quick;
      const match = SCENES.find(s => s.id === wanted || s.sid === wanted);
      if (!match) return;
      chooseGroup(match.group, match.id); document.querySelector('.selection').scrollIntoView({behavior: 'smooth', block: 'start'});
      const focusFrame = match.focusFrame != null ? match.focusFrame : (button.dataset.quick === 'creature_15' ? 17 : button.dataset.quick === 'gt_missing' ? 22 : 18);
      setTimeout(() => { $('frame').value = focusFrame; $('frame').dispatchEvent(new Event('input')); }, 250);
    });
  }
  try {
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
      world.add(new THREE.Points(geometry, material));
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
      // Some exports already filtered low-confidence points. Select the requested
      // fraction of the points actually present, including quantized-rank ties.
      const histogram = new Uint32Array(256);
      for (let i = 0; i < n; i++) histogram[ranks[i]]++;
      let tiedBudget = Math.ceil(n * confidence / 100), threshold = 255;
      while (threshold > 0 && tiedBudget > histogram[threshold]) {
        tiedBudget -= histogram[threshold]; threshold--;
      }
      const positions = p.geometry.attributes.position.array;
      const colors = p.geometry.attributes.color.array;
      let shown = 0;
      for (let i = 0; i < n && shown < positions.length / 3; i++) {
        if (ranks[i] < threshold) continue;
        if (ranks[i] === threshold) {
          if (tiedBudget <= 0) continue;
          tiedBudget--;
        }
        positions.set(xyz.subarray(i * 3, i * 3 + 3), shown * 3);
        colors.set(rgb.subarray(i * 3, i * 3 + 3), shown * 3);
        shown++;
      }
      p.geometry.attributes.position.needsUpdate = true;
      p.geometry.attributes.color.needsUpdate = true;
      p.geometry.setDrawRange(0, shown);
      p.geometry.computeBoundingSphere();
      $('count_' + model).textContent = shown.toLocaleString() + ' 点';
      $('ld_' + model).hidden = shown > 0;
      $('ld_' + model).textContent = '当前筛选下没有点';
      dirty = true;
    }
    function stop() {
      playing = false; clearTimeout(timer); $('play').textContent = '▶ 播放';
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
    // Keep only a small moving window ready. Fetching the entire scene at once
    // competes with the frame being shown and makes a cold first play stutter.
    function warmAhead(current, from, distance = 3) {
      if (prefetchScene !== current.id) {
        if (prefetchAbort) prefetchAbort.abort();
        prefetchAbort = new AbortController(); prefetchScene = current.id;
      }
      const signal = prefetchAbort.signal;
      const tasks = [];
      for (let step = 1; step <= distance; step++) {
        const next = (from + step) % current.nf;
        tasks.push(dataFor(current, next, signal), imageFor(current, next));
      }
      return Promise.allSettled(tasks);
    }
    function buffered(current, next) {
      return MODELS.every(m => cache.has(frameMeta(current, m, next).url));
    }
    function scheduleNext() {
      clearTimeout(timer);
      if (playing && !loading) {
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
        renderCurrentGt(selected, frame);
        // Match the projection viewport to the actual input frame. Water3D
        // scenes do not all have the same aspect ratio.
        MODELS.forEach(m => {
          panels[m].renderer.domElement.style.aspectRatio = image.naturalWidth + '/' + image.naturalHeight;
        });
        resize();
        MODELS.forEach((m, i) => {
          panels[m].data = data[i]; panels[m].count = frameMeta(selected, m, frame).count; drawFrame(m);
          panels[m].renderer.domElement.dataset.frame = String(frame);
        });
        $('play').disabled = false; $('status').textContent = '四模型当前帧已就绪';
        if (snap) applyCams(requestedFrame);
        lastAdvance = performance.now();
        warmAhead(selected, frame);
        scheduleNext();
      }
    }
    function loadScene(selected) {
      stop(); scene = selected; frame = 0; pendingFrame = 0;
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
      const hasHd = MODELS.every(m => scene.bins[m]?.hdPath && scene.bins[m]?.hdCounts);
      $('hd').disabled = !hasHd;
      $('hd-note').textContent = hasHd ? '高清模式：按当前场景/帧加载已导出的高密度真实点；抽样和置信度规则与预览一致。' : '当前案例没有已导出的高清数据，保持 8,000 点/帧预览；不会通过增大点尺寸伪造细节。';
      if (!hasHd) hdEnabled = false;
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
      resetView(); requestFrame(0);
    }
    function chooseGroup(group, wanted) {
      const list = SCENES.filter(s => s.group === group);
      $('sel').replaceChildren();
      list.forEach(s => {
        const option = document.createElement('option'); option.value = s.id;
        option.textContent = s.title + ' · ' + (s.sid || s.id); $('sel').appendChild(option);
      });
      loadScene(list.find(s => s.id === wanted) || list[0]);
    }
    document.querySelectorAll('.tab').forEach(tab => {
      tab.onclick = () => { if (scene.group !== tab.dataset.group) chooseGroup(tab.dataset.group); };
    });
    $('sel').onchange = () => loadScene(SCENES.find(s => s.id === $('sel').value));
    $('frame').oninput = () => { stop(); requestFrame(+$('frame').value); };
    $('conf').oninput = () => {
      confidence = +$('conf').value; $('confv').textContent = confidence + '%'; MODELS.forEach(drawFrame);
    };
    $('hd').onchange = () => {
      const hasHd = scene && MODELS.every(m => scene.bins[m]?.hdPath && scene.bins[m]?.hdCounts);
      hdEnabled = !!$('hd').checked && hasHd;
      if (!hasHd) { $('hd').checked = false; $('hd-note').textContent = '当前案例没有已导出的高清数据，保持 8,000 点/帧预览；不会通过增大点尺寸伪造细节。'; return; }
      cache.clear(); requestFrame(frame);
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
    $('play').onclick = () => {
      if (playing) stop();
      else {
        playing = true; $('play').textContent = '❚❚ 暂停';
        const current = scene, id = requestId;
        $('status').textContent = '正在缓冲后续帧…';
        warmAhead(current, frame, 2).then(() => {
          if (!playing || scene !== current || requestId !== id) return;
          lastAdvance = performance.now();
          $('status').textContent = '四模型当前帧已就绪';
          scheduleNext();
        });
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
        if (bounds.width > 0 && bounds.height > 0) p.renderer.setSize(bounds.width, bounds.height, false);
        p.camera.aspect = bounds.width / bounds.height; p.camera.updateProjectionMatrix();
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
          MODELS.forEach(m => { const p = panels[m]; p.renderer.render(p.world, p.camera); });
          dirty = false;
        }
      }
      requestAnimationFrame(tick);
    }
    setupPageMeta();
    resize(); requestAnimationFrame(tick);
    let initial;
    try { initial = SCENES.find(s => s.id === decodeURIComponent(location.hash.slice(1))); } catch (_) {}
    initial = initial || SCENES[0]; chooseGroup(initial.group, initial.id);
  } catch (error) { fatal(error); }
})();
