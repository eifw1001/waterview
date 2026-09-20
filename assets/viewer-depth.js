'use strict';
(()=> {
  const data = window.WATERVIEW_DEPTH || [];
  const labels = window.WATERVIEW_MODEL_LABELS || {};
  const byScene = new Map(data.map(x => [x.scene, x]));
  const sel = document.getElementById('sel');
  const empty = document.getElementById('inline-depth-empty');
  const content = document.getElementById('inline-depth-content');
  const note = document.getElementById('inline-depth-note');
  if (!sel || !empty || !content) return;

  const setImg = (id, src, alt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.src = src || '';
    el.alt = alt;
  };
  function render() {
    const sceneId = sel.value;
    const scene = (window.WATERVIEW_SCENES || []).find(s => s.id === sceneId);
    const key = scene ? (scene.sid || scene.id) : sceneId;
    const item = byScene.get(key);
    if (!item) {
      content.hidden = true;
      empty.hidden = false;
      empty.textContent = '当前案例没有已导出的代表深度帧；Wild 场景也可能没有 GT。可切到 Water3D 案例或打开“深度画廊”。';
      return;
    }
    empty.hidden = true;
    content.hidden = false;
    note.textContent = key + ' · 参考帧 ' + item.instance + ' · GT 有效覆盖 ' + (item.validCoverage * 100).toFixed(1) + '%。以下图像使用同一参考帧。';
    setImg('inline-rgb', item.rgb, key + ' RGB');
    setImg('inline-gt', item.gt, key + ' filtered GT depth');
    ['wat3r','da3','watervggt','watervggt_wcv'].forEach(m => setImg('inline-'+m, item.predictions?.[m], key + ' ' + (labels[m] || m) + ' depth'));
  }
  sel.addEventListener('change', () => setTimeout(render, 0));
  const sceneId = document.getElementById('scene-id');
  if (sceneId && window.MutationObserver) new MutationObserver(render).observe(sceneId,{childList:true,subtree:true,characterData:true});
  setTimeout(render, 300);
})();
