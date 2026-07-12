import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
await page.goto('http://localhost:5174/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game?.isBooted, null, { timeout: 15000 });
const box = await page.locator('canvas').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForFunction(() => window.game?.__test != null, null, { timeout: 15000 });
await page.evaluate(() =>
  window.game.__test.applyScenario({ player: [10, 10], trees: [[13, 10]], rocks: [[10, 13], [7, 10]], inventory: { wood: 63, stone: 12 } }),
);
await page.waitForTimeout(400);
await page.screenshot({ path: process.argv[2] });
await browser.close();
console.log('shot saved');
