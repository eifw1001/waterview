const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true, args: [
    '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
  ]});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const ready = () => page.waitForFunction(() =>
      document.getElementById('status').textContent.startsWith('四模型当前帧已就绪'));
    const assertAligned = async () => {
      const state = await page.evaluate(() => ({
        current: Number(document.getElementById('frv').textContent.split('/')[0].trim()) - 1,
        input: document.getElementById('fimg').dataset.frame,
        clouds: [...document.querySelectorAll('canvas[id^="cv_"]')].map(x => x.dataset.frame),
        image: document.getElementById('fimg').getAttribute('src')
      }));
      assert.equal(state.input, String(state.current));
      assert.deepEqual(state.clouds, Array(4).fill(state.input));
      assert(state.image.endsWith(String(state.current).padStart(3, '0') + '.jpg'));
    };
    const open = async (group, id) => {
      await page.locator(`[data-group="${group}"]`).click();
      if (id) await page.selectOption('#sel', id);
      await ready(); await assertAligned();
      assert.equal(await page.locator('#align').getAttribute('aria-pressed'), 'true');
      const pose = await page.evaluate(() => window.WATERVIEW_SCENES.find(s => s.id ===
        document.getElementById('sel').value).cams.frames[0].slice(0, 3));
      const actual = await page.evaluate(() => window.__WV_CAM__());
      assert(actual.every((v, i) => Math.abs(v - pose[i]) < 1e-3));
      const ratio = await page.locator('#fimg').evaluate(x => x.naturalWidth / x.naturalHeight);
      const canvasRatio = await page.locator('#cv_wat3r').evaluate(x => x.getBoundingClientRect().width / x.getBoundingClientRect().height);
      assert(Math.abs(ratio - canvasRatio) < .01, 'point cloud uses the input image aspect ratio');
    };

    await page.goto('http://127.0.0.1:8765/'); await ready(); await assertAligned();
    assert.equal(await page.locator('#sel option').count(), 6);
    assert.equal(await page.locator('#align').getAttribute('aria-pressed'), 'true', 'Wild gets camera poses');
    assert.equal(await page.locator('#metrics-table-wrap').count(), 0, 'home is exclusively the player');
    assert.equal(await page.locator('.site-nav a').count(), 4);
    assert.match(await page.locator('#score_wat3r').textContent(), /无 GT|Chamfer/);
    await page.selectOption('#layout', 'two');
    assert(await page.locator('#card_wat3r').isVisible() && await page.locator('#card_watervggt').isVisible());
    assert(!(await page.locator('#card_da3').isVisible()), 'two-model layout focuses Wat3R and Water-VGGT');
    await page.selectOption('#layout', 'four');
    for (const [group, id] of [['water3d', 'cv_1000'], ['wat3r_worst_abs', 'video_7762649']]) {
      await open(group, id);
    }
    // That scene used to shift its camera two frames relative to the cloud/image.
    const shifted = await page.evaluate(() => {
      const scene = window.WATERVIEW_SCENES.find(s => s.id === 'video_7762649');
      return scene.cams.frames.slice(0, 3).map(f => f.slice(0, 3));
    });
    assert.notDeepEqual(shifted[0], shifted[2]);
    await open('uveb', 'creature_15');
    await page.locator('.quick[data-quick="creature_03"]').click();
    await ready(); await assertAligned();
    assert.equal(await page.locator('#sel').inputValue(), 'creature_03');
    await page.locator('#frame').fill('0'); await page.locator('#frame').dispatchEvent('input'); await ready();
    assert.equal(await page.locator('#hd').isEnabled(), true, 'focus cases expose real HD exports');

    // A slow model request must never advance only the image or some canvases.
    await page.route('**/clouds_frames/**/010.bin', async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue().catch(() => {});
    });
    await page.locator('#frame').fill('10');
    await page.locator('#frame').dispatchEvent('input');
    await page.waitForTimeout(200);
    await assertAligned();
    assert.equal(await page.locator('#frv').textContent(), '1 / 32');
    await ready(); await assertAligned();
    assert.equal(await page.locator('#frv').textContent(), '11 / 32');
    await page.unroute('**/clouds_frames/**/010.bin');

    // Scrubbing can supersede an in-flight frame without a stale repaint.
    await page.route('**/clouds_frames/**/025.bin', async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue().catch(() => {});
    });
    await page.locator('#frame').fill('25'); await page.locator('#frame').dispatchEvent('input');
    await page.locator('#frame').fill('26'); await page.locator('#frame').dispatchEvent('input');
    await ready(); await page.waitForTimeout(650); await assertAligned();
    assert.equal(await page.locator('#frv').textContent(), '27 / 32');
    await page.unroute('**/clouds_frames/**/025.bin');

    // Buffered playback advances at the requested cadence without a second delay.
    await page.selectOption('#sel', 'creature_14'); await ready();
    await page.locator('#fps').fill('3'); await page.locator('#fps').dispatchEvent('input');
    const ticks = [];
    await page.exposeFunction('reportFrame', f => ticks.push({f, time: Date.now()}));
    await page.evaluate(() => {
      new MutationObserver(() => window.reportFrame(document.getElementById('frv').textContent))
        .observe(document.getElementById('frv'), {childList: true});
    });
    await page.locator('#play').click();
    await page.waitForFunction(() => document.getElementById('frv').textContent === '5 / 32', null, {timeout: 20000});
    await page.locator('#play').click(); await assertAligned();
    const gaps = ticks.slice(1, 5).map((tick, i) => tick.time - ticks[i].time);
    assert(gaps.length >= 3 && gaps.every(gap => gap >= 230 && gap <= 480), 'playback cadence: ' + gaps);
    console.log('PLAYBACK_FRAME_GAPS_MS', gaps.join(','));
    await page.setViewportSize({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: '/tmp/waterview-playback-mobile.png', fullPage: true});
    await page.goto('http://127.0.0.1:8765/benchmark.html');
    assert.equal(await page.locator('#metrics-table-wrap tbody tr').count(), 4);
    assert.equal(await page.locator('#scene-table tbody tr').count(), 42);
    await page.goto('http://127.0.0.1:8765/gt.html');
    assert.equal(await page.locator('#gt-gallery .gallery-card').count(), 10);
    await page.locator('.gallery-images img').first().click();
    assert(await page.locator('dialog').isVisible()); await page.keyboard.press('Escape');
    await page.goto('http://127.0.0.1:8765/depth.html');
    assert.equal(await page.locator('#depth-panels .card').count(), 6);
    assert.equal(await page.locator('#depth-scene option').count(), 10);
    assert.deepEqual(errors, []);
    console.log('PASS: image + four clouds advance atomically; Wild and Water3D cameras match frames; aspect ratios; slow fetch; fast scrub; buffered playback; mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
