const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('四模型当前帧已就绪'));
  let transfers=0;
  await page.route('**/clouds_frames/**',async route=>{transfers++;await new Promise(r=>setTimeout(r,160));await route.continue().catch(()=>{});});
  await page.goto('http://127.0.0.1:8765/');await ready();
  // Home must not request the report gallery or initialize it in hidden panels.
  assert.equal(await page.locator('#gt-gallery').count(),0);
  await page.locator('#fps').fill('10');await page.locator('#fps').dispatchEvent('input');
  const frames=[];await page.exposeFunction('bufferTick',f=>frames.push({f,t:Date.now()}));
  await page.evaluate(()=>new MutationObserver(()=>window.bufferTick(document.querySelector('#frv').textContent)).observe(document.querySelector('#frv'),{childList:true}));
  await page.click('#play');
  await page.waitForFunction(()=>document.querySelector('#frv').textContent==='2 / 32',null,{timeout:30000});
  const countAtStart=transfers;
  await page.waitForTimeout(3800);await page.click('#play');
  assert.equal(transfers,countAtStart,'complete-buffer playback including wraparound makes no network requests');
  const gaps=frames.slice(1).map((v,i)=>v.t-frames[i].t);
  assert(gaps.length>=30,'played an entire clip');
  assert(gaps.every(x=>x>=50&&x<180),'10 fps slow-network gaps: '+gaps);
  console.log('SLOW_NETWORK_BUFFERED_GAPS_MS',Math.min(...gaps),Math.max(...gaps));
  // Switch density during playback, then switch to a scene without HD.
  await page.check('#hd');await ready();
  assert.match(await page.locator('#count_wat3r').textContent(),/20,000/);
  await page.click('#play');await page.waitForTimeout(150);
  await page.click('[data-group="water3d"]');await ready();
  assert.equal(await page.locator('#hd').isChecked(),false);
  assert.equal(await page.locator('#play').textContent(),'▶ 播放');
  // Quick-link uses the trimmed display frame corresponding to GT frame 22.
  await page.click('[data-quick="gt_missing"]');await ready();
  assert.equal(await page.locator('#frv').textContent(),'21 / 30');
  assert(await page.locator('#gt-card').isVisible());
  assert((await page.locator('#gtimg').getAttribute('src')).includes('_022_gt'));
  await page.screenshot({path:'/tmp/waterview-home-fixed.png',fullPage:true});
  // Switching layouts must never assign NaN aspect ratios to hidden cameras.
  await page.selectOption('#layout','two');await page.selectOption('#layout','four');
  assert.deepEqual(errors,[]);
  console.log('PASS: slow network, cache wraparound, HD mode, scene cancellation, trimmed GT, layouts');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
