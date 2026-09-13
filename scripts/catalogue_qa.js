const { chromium } = require('playwright');
const { spawn } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '4173', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const v of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
      const p = await browser.newPage({ viewport: { width: v.width, height: v.height } });
      const errors = [];
      p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
      await p.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => typeof allProducts !== 'undefined' && allProducts.length > 0, { timeout: 30000 });
      await p.waitForSelector('#kt-home-catalogue .kt-card', { timeout: 30000 });
      await p.evaluate(() => localStorage.removeItem('kt_cart_v1'));
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => typeof allProducts !== 'undefined' && allProducts.length > 0, { timeout: 30000 });
      await p.waitForSelector('#kt-home-catalogue .kt-card', { timeout: 30000 });

      const base = await p.locator('#kt-home-catalogue .kt-card').count();
      if (base < 20) throw new Error(`${v.name}: only ${base} catalogue cards`);
      if (await p.locator('#product-search').count() !== 1) throw new Error(`${v.name}: search count != 1`);
      if (await p.locator('#kt-order-bar').count() !== 1) throw new Error(`${v.name}: order bar count != 1`);
      if (await p.locator('#category-modal').evaluate(e => getComputedStyle(e).display !== 'none')) throw new Error(`${v.name}: legacy category modal visible`);
      if (await p.locator('#search-results').evaluate(e => getComputedStyle(e).display !== 'none')) throw new Error(`${v.name}: legacy search results visible`);

      const cols = await p.locator('#kt-home-catalogue .kt-grid').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
      const expectedCols = v.name === 'mobile' ? 2 : 4;
      if (cols !== expectedCols) throw new Error(`${v.name}: expected ${expectedCols} columns, got ${cols}`);

      const cats = p.locator('#kt-category-strip button[data-cat]');
      if (await cats.count() < 2) throw new Error(`${v.name}: fewer than 2 category filters`);
      await cats.first().click();
      await sleep(100);
      const strip = p.locator('#kt-category-strip');
      const beforeScroll = await strip.evaluate(e => e.scrollLeft);
      await p.locator('#kt-cat-next').click();
      await sleep(200);
      const afterScroll = await strip.evaluate(e => e.scrollLeft);
      const stripOverflow = await strip.evaluate(e => e.scrollWidth > e.clientWidth + 2);
      if (stripOverflow && afterScroll <= beforeScroll) throw new Error(`${v.name}: next category arrow did not scroll`);

      const clickAll = async () => { await p.locator('#kt-category-strip button[data-cat]').first().click(); await sleep(100); };
      await clickAll();
      const allCount = await p.locator('#kt-home-catalogue .kt-card').count();
      await p.locator('#kt-category-strip button[data-cat]').nth(1).click();
      await sleep(150);
      const categoryCount = await p.locator('#kt-home-catalogue .kt-card').count();
      if (categoryCount < 1 || categoryCount >= allCount) throw new Error(`${v.name}: category filter did not narrow (${allCount} -> ${categoryCount})`);

      await clickAll();
      await p.locator('#product-search').fill('milk');
      await sleep(250);
      const searchCount = await p.locator('#kt-home-catalogue .kt-card').count();
      if (searchCount < 1 || searchCount >= allCount) throw new Error(`${v.name}: milk search did not narrow (${allCount} -> ${searchCount})`);
      await p.locator('#product-search').fill('');
      await sleep(150);

      const cards = p.locator('#kt-home-catalogue .kt-card');
      const cardIndex = await cards.evaluateAll(es => es.findIndex(e => e.querySelector('.kt-pack') && e.querySelector('.kt-add:not([disabled])')));
      if (cardIndex < 0) throw new Error(`${v.name}: no in-stock card with pack selector/add button`);
      const card = cards.nth(cardIndex);
      const packs = card.locator('.kt-pack');
      const packCount = await packs.count();
      let expectedPackSize = null;
      if (packCount > 1) {
        expectedPackSize = await p.evaluate(({idx, pi}) => allProducts[idx].packSizes[pi].size, { idx: cardIndex, pi: 1 });
        await packs.nth(1).click();
        await sleep(100);
      }
      const moq = await cards.nth(cardIndex).locator('.kt-moq').count();
      const beforeOrder = await p.locator('#kt-order-bar').textContent();
      await cards.nth(cardIndex).locator('.kt-add').click();
      await p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('kt_cart_v1') || '[]').length === 1; } catch(e) { return false; } }, { timeout: 3000 });
      const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('kt_cart_v1') || '[]'));
      if (stored.length !== 1 || stored[0].qty < (stored[0].minQty || 1)) throw new Error(`${v.name}: stored cart/MOQ invalid`);
      if (expectedPackSize && stored[0].packSize?.size !== expectedPackSize) throw new Error(`${v.name}: selected pack was not carried into cart (${expectedPackSize} -> ${stored[0].packSize?.size || 'none'})`);
      const expectedQty = stored[0].qty;
      await p.waitForFunction(qty => document.getElementById('kt-order-count')?.textContent?.trim() === `${qty} product${qty === 1 ? '' : 's'}`, expectedQty, { timeout: 3000 });
      const afterOrder = await p.locator('#kt-order-bar').textContent();
      if (beforeOrder === afterOrder) throw new Error(`${v.name}: Add to Order did not update persistent bar`);
      if (await p.locator('#cart-drawer').evaluate(e => e.classList.contains('open'))) throw new Error(`${v.name}: Add to Order opened cart drawer`);

      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => typeof allProducts !== 'undefined' && allProducts.length > 0, { timeout: 30000 });
      await sleep(250);
      const persistedText = await p.locator('#kt-order-bar').textContent();
      if (!new RegExp(`\\b${expectedQty}\\s+product${expectedQty === 1 ? '' : 's'}\\b`, 'i').test(persistedText)) throw new Error(`${v.name}: cart count did not persist after reload`);

      results.push({ viewport: v.name, width: v.width, height: v.height, cards: base, categoryFiltered: categoryCount, searchFiltered: searchCount, gridColumns: cols, categoryArrowScrolled: !stripOverflow || afterScroll > beforeScroll, selectedPack: !!expectedPackSize, moqVisible: moq > 0, persistedQty: expectedQty, consoleErrors: errors });
      await p.close();
    }
    const unexpected = results.flatMap(r => r.consoleErrors).filter(e => !/(ERR_BLOCKED_BY_CLIENT|404|animalhealth\\.pk|cloudinary|fonts|fontawesome|tailwind|google-analytics)/i.test(e));
    if (unexpected.length) throw new Error('Unexpected console/page errors:\n' + unexpected.join('\n'));
    console.log(JSON.stringify({ status: 'PASS', results }, null, 2));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
})().catch(e => { console.error(e.stack || e); process.exit(1); });
