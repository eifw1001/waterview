'use strict';
(()=>{
const $=id=>document.getElementById(id);
const BENCH=window.WATERVIEW_BENCHMARK;
const MODELS=Object.keys(BENCH.models);
const MODEL_LABELS=BENCH.models;
  const esc = value => String(value).replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
  const metricSpec = {
    pose: {title: 'Pose', fields: [['auc30', 'AUC@30', '↑', true], ['auc15', 'AUC@15', '↑', true], ['auc05', 'AUC@5', '↑', true], ['auc03', 'AUC@3', '↑', true]]},
    depth: {title: 'Depth', fields: [['abs_rel', 'AbsRel', '↓', false], ['rmse', 'RMSE', '↓', false], ['delta1', 'δ1', '↑', true], ['sq_rel', 'SqRel', '↓', false], ['rmse_log', 'RMSE log', '↓', false], ['i_rmse', 'iRMSE', '↓', false], ['silog', 'SILog', '↓', false], ['delta2', 'δ2', '↑', true], ['delta3', 'δ3', '↑', true]]},
    point: {title: 'Point Cloud', fields: [['overall', 'CD / Chamfer', '↓', false], ['acc', 'Acc', '↓', false], ['comp', 'Comp', '↓', false], ['fscore', 'F-score', '↑', true], ['precision', 'Precision', '↑', true], ['recall', 'Recall', '↑', true]]}
  };
  function metricEntry(model, current) {
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
      ['逐场景', '分辨率详见下方明细']
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
    const ranks = spec.fields.map(([, , , higher], index) => rows.map(row => ({row, value: row.values[index]})).filter(x => finite(x.value)).sort((a, b) => higher ? b.value - a.value : a.value - b.value).map(x => x.value));
    $('metrics-table-wrap').innerHTML = `<table class="metric-table"><thead><tr><th>model · ${spec.title}</th>${spec.fields.map(([, label, dir]) => `<th>${label} ${dir}<br><small>scene mean</small></th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${esc(MODEL_LABELS[row.model])}</td>${row.values.map((value, index) => { const rank = [...new Set(ranks[index])].indexOf(value); return `<td class="${rank === 0 ? 'rank-1' : rank === 1 ? 'rank-2' : ''}">${finite(value) ? value.toFixed(4) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    const explanation = {
      pose: '<strong>Pose：</strong>AUC@30 / 15 / 5 / 3 衡量相机相对位姿在不同角度误差阈值内的整体准确度，<b>↑ 越高越好</b>。',
      depth: '<strong>Depth：</strong>AbsRel / RMSE / SqRel 等衡量预测深度与 GT 的差异，通常 <b>↓ 越低越好</b>；δ1 / δ2 / δ3 表示落在相对误差阈值内的像素比例，<b>↑ 越高越好</b>。',
      point: '<strong>Point Cloud：</strong>Chamfer / Acc / Comp 衡量预测点云与 GT 的几何距离与完整性，通常 <b>↓ 越低越好</b>；F-score / Precision / Recall <b>↑ 越高越好</b>。'
    };
    if ($('metric-explanation')) $('metric-explanation').innerHTML = explanation[kind];
    document.querySelectorAll('.metric-tab').forEach(tab => tab.onclick = () => renderMetricTable(tab.dataset.metric));
  }
  function renderGallery() {
    const items = BENCH.gallery || [];
    $('gallery-count').textContent = items.length + ' representative frames';
    $('gt-gallery').innerHTML = items.map(item => `<article class="gallery-card"><div class="gallery-images"><img loading="lazy" src="${esc(item.rgb)}" alt="${esc(item.scene)} RGB frame ${item.frame}"><img loading="lazy" src="${esc(item.gt)}" alt="${esc(item.scene)} filtered geometric GT depth frame ${item.frame}"></div><div class="gallery-caption"><strong>${esc(item.scene)} · frame ${item.frame + 1}</strong><span>${esc(item.note)} · ${esc(item.instance)}</span><span>${esc(item.label)} · valid ${(item.validCoverage * 100).toFixed(1)}% · range ${item.scale[0]}–${item.scale[1]}</span></div></article>`).join('');
  }

if ($('metric-tabs') && $('metrics-table-wrap')) renderMetricTable();
if ($('benchmark-stats')) {renderBenchmark();
 const res=v=>Array.isArray(v)?v.join(' × '):'—';
 if ($('scene-table')) $('scene-table').innerHTML='<table class="metric-table"><thead><tr><th>场景</th><th>原始帧数</th><th>评测帧数</th><th>原图</th><th>GT</th><th>Water-VGGT 输入</th></tr></thead><tbody>'+Object.entries(BENCH.sceneStats).map(([id,s])=>`<tr><td>${esc(id)}</td><td>${s.originalFrames}</td><td>${s.evaluatedFrames}</td><td>${res(s.sourceResolution)}</td><td>${res(s.gtResolution)}</td><td>${res(s.inputResolution)}</td></tr>`).join('')+'</tbody></table>';
}
if ($('gt-gallery')) renderGallery();
const dialog=document.createElement('dialog');dialog.className='image-dialog';dialog.innerHTML='<button aria-label="关闭大图">关闭</button><img alt="放大查看">';document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close()};
document.querySelectorAll('.gallery-images img').forEach(img=>{img.tabIndex=0;const open=()=>{dialog.querySelector('img').src=img.src;dialog.querySelector('img').alt=img.alt;dialog.showModal()};img.onclick=open;img.onkeydown=e=>{if(e.key==='Enter')open()}});
document.querySelectorAll('.site-nav a').forEach(a=>{if(a.pathname===location.pathname)a.setAttribute('aria-current','page')});
})();
