'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const MODELS = ['wat3r', 'da3', 'watervggt', 'watervggt_wcv'];
  const SCENES = window.WATERVIEW_SCENES;
  const panels = {};
  const cache = new Map();
  const CACHE_FRAMES = 288; // Two full 32-frame scenes = 256 model-frames (~32 MiB).
  const imageCache = new Map();
  const IMAGE_CACHE_FRAMES = 48;
  let scene, frame = 0, pendingFrame = 0, confidence = 100, playing = false, loading = false;
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
        const meta = current.bins[m];
        return getFrame(meta.path + pad(next) + '.bin', meta.counts[next], signal);
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
      return MODELS.every(m => cache.has(current.bins[m].path + pad(next) + '.bin'));
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
        // Match the projection viewport to the actual input frame. Water3D
        // scenes do not all have the same aspect ratio.
        MODELS.forEach(m => {
          panels[m].renderer.domElement.style.aspectRatio = image.naturalWidth + '/' + image.naturalHeight;
        });
        resize();
        MODELS.forEach((m, i) => {
          panels[m].data = data[i]; panels[m].count = selected.bins[m].counts[frame]; drawFrame(m);
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
    resize(); requestAnimationFrame(tick);
    let initial;
    try { initial = SCENES.find(s => s.id === decodeURIComponent(location.hash.slice(1))); } catch (_) {}
    initial = initial || SCENES[0]; chooseGroup(initial.group, initial.id);
  } catch (error) { fatal(error); }
})();
