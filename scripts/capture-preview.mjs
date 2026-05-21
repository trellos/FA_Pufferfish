// Captures public/preview.png — the pufferfish at peak inhale.
// Assumes a dev server (npm run dev) is already running on $URL or :5173.
// Usage: node scripts/capture-preview.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL ?? 'http://localhost:5173/?cycle=20&duration=300';
const OUT = process.env.OUT ?? 'public/preview.png';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 800, height: 1000 },
  deviceScaleFactor: 2,
});
await page.goto(URL, { waitUntil: 'networkidle' });

// Click the play button (canvas region, ~83% down)
const box = await page.locator('#canvas').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.90);
await page.waitForFunction(() => window.__breathingManager?.getScreen?.() === 'breathing');

// Pin time so we render exactly at end-of-inhale (cycleT = 0.38, scale ≈ 1.22).
// Wait one rAF tick so the next frame paints with the new sessionStart.
await page.evaluate(() => {
  const m = window.__breathingManager;
  // cycleT ≈ 0.30: clearly within inhale (< 0.40), fish well inflated.
  m.sessionStart = performance.now() - 6000;
});
await page.waitForTimeout(50);

await mkdir(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
await page.locator('#canvas').screenshot({ path: OUT, omitBackground: false });
console.log('wrote', OUT);

await browser.close();
