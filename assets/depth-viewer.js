 'use strict';
(()=>{
const $=id=>document.getElementById(id), items=window.WATERVIEW_DEPTH, bench=window.WATERVIEW_BENCHMARK;
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dialog=document.createElement('dialog');dialog.className='image-dialog';dialog.innerHTML='<button>关闭</button><img alt="深度放大">';document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close()};
$('depth-scene').innerHTML=items.map((x,i)=>`<option value="${i}">${esc(x.scene)} · ${esc(x.instance)}</option>`).join('');
function render(){
 const item=items[+$('depth-scene').value];
 $('depth-note').textContent=`${item.note} · 原始帧 ${item.instance} · GT 有效覆盖 ${(item.validCoverage*100).toFixed(1)}% · 色图范围 ${item.scale.join('–')}（COLMAP 相对尺度）`;
 const available=bench.resourceScenes.includes(item.scene);
 $('cloud-link').hidden=!available;$('cloud-link').href='viewer.html#'+encodeURIComponent(item.scene);
 const values=Object.keys(item.predictions).map(m=>bench.metrics[m]?.[item.scene]?.depth?.abs_rel).filter(Number.isFinite);
 const ranks=[...new Set(values)].sort((a,b)=>a-b);
 const panels=[{name:'RGB',url:item.rgb},{name:'Filtered GT',url:item.gt},...Object.entries(item.predictions).map(([m,url])=>{
  const d=bench.metrics[m]?.[item.scene]?.depth;const rank=ranks.indexOf(d?.abs_rel);
  return {name:bench.models[m],url,score:d?`<span class="${rank===0?'strong':rank===1?'under':''}">AbsRel↓ ${d.abs_rel.toFixed(6)}</span> · RMSE↓ ${d.rmse.toFixed(4)} · δ1↑ ${d.delta1.toFixed(4)}<br>场景平均`: '暂无指标'};
 })];
 $('depth-panels').innerHTML=panels.map(x=>`<article class="card"><h2>${esc(x.name)}</h2><div class="score">${x.score||'同帧参考'}</div><img src="${esc(x.url)}" alt="${esc(x.name)} ${esc(item.instance)}" tabindex="0"></article>`).join('');
 document.querySelectorAll('#depth-panels img').forEach(img=>{const open=()=>{dialog.querySelector('img').src=img.src;dialog.showModal()};img.onclick=open;img.onkeydown=e=>{if(e.key==='Enter')open()}});
}
$('depth-scene').onchange=render;render();
document.querySelectorAll('.site-nav a').forEach(a=>{if(a.pathname===location.pathname)a.setAttribute('aria-current','page')});
})();
