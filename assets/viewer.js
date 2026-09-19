'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const MODELS = ['wat3r', 'da3', 'watervggt', 'watervggt_wcv'];
  const SCENES = window.WATERVIEW_SCENES;
  const panels = {};
  const cache = new Map();
  const CACHE_FRAMES = 288; // Two full 32-frame scenes = 256 model-frames (~32 MiB).
  let scene, frame = 0, confidence = 100, playing = false, loading = false;
  let requestId = 0, controller, timer, dirty = true, syncing = false;
  let lastTime = performance.now();
  let prefetchAbort = null, prefetchScene = null;

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
        p.camera.lookAt(0, 0, 0); p.controls.update();
      });
      syncing = false; dirty = true;
    }
    const pad = n => String(n).padStart(3, '0');
    async function getFrame(url, count, signal) {
      if (cache.has(url)) {
        const data = cache.get(url); cache.delete(url); cache.set(url, data);
        return data;
      }
      const response = await fetch(url, {signal, cache: 'default'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.arrayBuffer();
      if (data.byteLength !== count * 16) throw new Error('点云数据不完整');
      cache.set(url, data);
      while (cache.size > CACHE_FRAMES) cache.delete(cache.keys().next().value);
      return data;
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
    // After the first frame paints, quietly load the whole scene in the
    // background so playback and timeline drags never wait on the network.
    function ensurePrefetch(current) {
      if (prefetchScene === current.id) return;
      if (prefetchAbort) prefetchAbort.abort();
      prefetchScene = current.id;
      const signal = (prefetchAbort = new AbortController()).signal;
      const tasks = [];
      for (let step = 1; step < current.nf; step++) {
        const f = (frame + step) % current.nf;
        MODELS.forEach(m => tasks.push({m, f}));
      }
      for (let k = 0; k < current.nf; k++) { // stills are small; warm them all
        new Image().src = current.img + pad(k) + '.jpg';
      }
      let next = 0, done = 0;
      const worker = async () => {
        while (!signal.aborted && next < tasks.length) {
          const t = tasks[next++];
          try {
            const meta = current.bins[t.m];
            await getFrame(meta.path + pad(t.f) + '.bin', meta.counts[t.f], signal);
          } catch (error) {
            if (!signal.aborted) prefetchAbort.abort(); // on-demand loading still reports errors
            return;
          }
          if (++done % 16 === 0 && !loading && scene === current)
            $('status').textContent = '四模型当前帧已就绪 · 预载 ' + done + '/' + tasks.length;
        }
      };
      Promise.all([worker(), worker(), worker()]).then(() => {
        if (!signal.aborted && scene === current && !loading)
          $('status').textContent = '四模型当前帧已就绪 · 全部帧已缓存';
      });
    }
    function scheduleNext() {
      clearTimeout(timer);
      if (playing && !loading) timer = setTimeout(() => requestFrame((frame + 1) % scene.nf), 1000 / +$('fps').value);
    }
    async function requestFrame(next) {
      clearTimeout(timer);
      if (controller) controller.abort();
      controller = new AbortController();
      const signal = controller.signal, id = ++requestId, selected = scene;
      frame = Math.max(0, Math.min(next, scene.nf - 1));
      const requestedFrame = frame;
      loading = true;
      $('play').disabled = !playing;
      $('retry').hidden = true;
      $('status').textContent = '正在加载当前帧…';
      $('frame').max = scene.nf - 1; $('frame').value = frame;
      $('frv').textContent = (frame + 1) + ' / ' + scene.nf;
      $('fimg').src = scene.img + pad(frame) + '.jpg';
      $('fimg').alt = scene.title + '，第 ' + (frame + 1) + ' 帧';
      MODELS.forEach(m => {
        panels[m].data = null; panels[m].geometry.setDrawRange(0, 0);
        $('count_' + m).textContent = '';
        $('ld_' + m).hidden = false; $('ld_' + m).textContent = '加载当前帧…';
      });
      dirty = true;
      const results = await Promise.allSettled(MODELS.map(async m => {
        const meta = selected.bins[m];
        const count = meta.counts[requestedFrame];
        const data = await getFrame(meta.path + pad(requestedFrame) + '.bin', count, signal);
        if (id !== requestId) return;
        panels[m].data = data; panels[m].count = count; drawFrame(m);
      }));
      if (id !== requestId) return;
      loading = false;
      let failures = 0;
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          failures++;
          $('ld_' + MODELS[i]).hidden = false;
          $('ld_' + MODELS[i]).textContent = '加载失败：' + result.reason.message;
        }
      });
      if (failures) {
        stop(); $('play').disabled = true; $('retry').hidden = false;
        $('status').textContent = failures + ' 个模型加载失败';
      } else {
        $('play').disabled = false; $('status').textContent = '四模型当前帧已就绪';
        scheduleNext();
        const current = selected;
        setTimeout(() => { if (scene === current) ensurePrefetch(current); }, 250);
      }
    }
    function loadScene(selected) {
      stop(); scene = selected;
      $('description').textContent = scene.description;
      $('badge').textContent = scene.badge || '';
      $('scene-id').textContent = scene.id;
      $('tags').textContent = scene.tags;
      $('v').pause(); $('v').removeAttribute('src'); $('v').load();
      $('vcard').hidden = !scene.video;
      $('load-video').hidden = false;
      $('v').poster = scene.img + '000.jpg';
      $('sel').value = scene.id;
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
        option.textContent = s.title + ' · ' + s.id; $('sel').appendChild(option);
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
    $('sync').onchange = () => syncFrom(MODELS[0]);
    $('rot').onchange = () => { dirty = true; };
    $('retry').onclick = () => requestFrame(frame);
    $('play').onclick = () => {
      if (playing) stop();
      else { playing = true; $('play').textContent = '❚❚ 暂停'; scheduleNext(); }
    };
    $('load-video').onclick = () => {
      if (!scene.video) return;
      $('v').src = scene.video; $('load-video').hidden = true;
      $('v').play().catch(() => { /* Native video controls remain available. */ });
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else dirty = true; });
    function resize() {
      MODELS.forEach(m => {
        const p = panels[m], width = p.renderer.domElement.getBoundingClientRect().width;
        if (width > 0) p.renderer.setSize(width, width, false);
        p.camera.aspect = 1; p.camera.updateProjectionMatrix();
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
