const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const context = await browser.newContext({viewport: {width: 1600, height: 1100}});
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  const ready = () => page.waitForFunction(() => document.getElementById('status').textContent === '四模型当前帧已就绪');
  const start = Date.now();
  await page.goto('http://127.0.0.1:8765/'); await ready();
  console.log('FIRST_READY_MS', Date.now() - start);
  assert.equal(requests.filter(x=>x.endsWith('.bin')).length,4);
  assert.equal(requests.filter(x=>x.endsWith('.mp4')).length,0);
  assert.equal(new Set(requests.filter(x=>x.endsWith('.jpg'))).size,1);
  assert.equal(await page.locator('#sel option').count(),5);
  assert.deepEqual(await page.locator('[id^="count_"]').allTextContents(),Array(4).fill('8,000 点'));
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(x => ({name:x.name,size:x.decodedBodySize})));
  console.log('INITIAL_CLOUD_BYTES',resources.filter(x=>x.name.endsWith('.bin')).reduce((a,b)=>a+b.size,0));
  await page.screenshot({path:'/tmp/waterview-desktop.png',fullPage:true});
  await page.locator('#conf').fill('50'); await page.locator('#conf').dispatchEvent('input');
  for(const x of await page.locator('[id^="count_"]').allTextContents()) {
    const n=Number(x.replace(/\D/g,'')); assert(n>3900 && n<4100);
  }
  await page.locator('#conf').fill('100'); await page.locator('#conf').dispatchEvent('input');
  await page.locator('#play').click();
  await page.waitForFunction(()=>document.getElementById('frv').textContent !== '1 / 32');
  await page.locator('#play').click(); await ready();
  await page.selectOption('#sel','creature_14'); await ready();
  const before = requests.filter(x=>x.endsWith('.bin')).length;
  await page.selectOption('#sel','creature_15'); await ready();
  assert.equal(requests.filter(x=>x.endsWith('.bin')).length,before,'return uses cached frames');
  for(const id of ['creature_13','arch_08','creature_01']) {await page.selectOption('#sel',id); await ready();}
  await page.locator('[data-group="water3d"]').click(); await ready();
  assert.equal(await page.locator('#sel option').count(),3);
  assert(await page.locator('#vcard').isHidden());
  assert.equal(await page.locator('#badge').textContent(),'代表场景');
  for(const id of ['cv_1123','cv_1000']) {await page.selectOption('#sel',id); await ready();}
  await page.locator('[data-group="wat3r_worst"]').click(); await ready();
  assert.equal(await page.locator('#sel option').count(),5);
  assert.equal(await page.locator('#badge').textContent(),'Wat3R 最差 TOP1');
  assert.deepEqual(await page.locator('[id^="count_"]').allTextContents(),Array(4).fill('8,000 点'));
  for(const id of ['video_6430496','cv_1223']) {await page.selectOption('#sel',id); await ready();}
  await page.locator('[data-group="watervggt_worst"]').click(); await ready();
  assert.equal(await page.locator('#sel option').count(),5);
  assert.equal(await page.locator('#badge').textContent(),'Water-VGGT 最差 TOP1');
  await page.selectOption('#sel','video_11273415'); await ready();
  assert.equal(await page.locator('#frv').textContent(),'1 / 16');
  await page.screenshot({path:'/tmp/waterview-worst.png',fullPage:true});
  await page.locator('[data-group="uveb"]').click(); await ready();
  assert.equal(await page.locator('#badge').textContent(),'代表场景');
  await page.reload(); await ready(); assert.equal(await page.locator('#sel').inputValue(),'creature_15');
  await page.route('**/clouds_frames/**/010.bin',route=>route.abort());
  await page.locator('#frame').fill('10'); await page.locator('#frame').dispatchEvent('input');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('加载失败'));
  assert(await page.locator('#retry').isVisible());
  await page.unroute('**/clouds_frames/**/010.bin'); await page.locator('#retry').click(); await ready();
  // Race: obsolete frame requests must not overwrite the final choice.
  await page.route('**/clouds_frames/**/011.bin',async route=>{await new Promise(r=>setTimeout(r,400));await route.continue().catch(()=>{});});
  await page.locator('#frame').fill('11'); await page.locator('#frame').dispatchEvent('input');
  await page.locator('#frame').fill('12'); await page.locator('#frame').dispatchEvent('input');
  await ready(); await page.waitForTimeout(600);
  assert.equal(await page.locator('#frv').textContent(),'13 / 32');
  await page.unroute('**/clouds_frames/**/011.bin');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/waterview-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no mobile horizontal overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS: 18 scenes / 4 groups / 4 models; badges; no eager video or image preload; cache; confidence; playback; reload; failure/retry; race; mobile; no JS errors');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
