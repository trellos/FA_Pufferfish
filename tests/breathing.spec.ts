import { test, expect, Page } from '@playwright/test';

// Helper: read every pixel in the canvas and confirm content rendered
async function canvasHasContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas || canvas.width === 0) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // At least one non-background pixel exists
    const bg = [13, 26, 51, 255]; // #0d1a33
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - bg[0]) > 10 || Math.abs(d[i+1] - bg[1]) > 10 || Math.abs(d[i+2] - bg[2]) > 10) {
        return true;
      }
    }
    return false;
  });
}

async function getScreen(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = (window as Record<string, unknown>)['__breathingManager'] as { getScreen: () => string } | undefined;
    return m ? m.getScreen() : 'unknown';
  });
}

test.describe('Pufferfish Breathing App', () => {

  test('loading the page displays the start screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Canvas must exist and be visible
    await expect(page.locator('#canvas')).toBeVisible();
    // Manager must report start screen
    const screen = await getScreen(page);
    expect(screen).toBe('start');
    // Canvas must have rendered content
    expect(await canvasHasContent(page)).toBe(true);
  });

  test('pressing Play once brings up the pufferfish (breathing screen)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Confirm start screen first
    expect(await getScreen(page)).toBe('start');
    // Click the play button area (center-bottom of canvas)
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const bx = box!.x + box!.width  / 2;
    const by = box!.y + box!.height * 0.83;
    await page.mouse.click(bx, by);
    // Give one animation frame to process the state change
    await page.waitForTimeout(100);
    expect(await getScreen(page)).toBe('breathing');
  });

  test('pufferfish animates during breathing — canvas changes over time', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Start breathing
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.83);
    await page.waitForTimeout(200);
    // Capture pixel hash at t=0 and t=500ms — they must differ (fish is scaling)
    const snapshot1 = await page.evaluate(() => {
      const c = document.getElementById('canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 16) sum += d[i];
      return sum;
    });
    await page.waitForTimeout(500);
    const snapshot2 = await page.evaluate(() => {
      const c = document.getElementById('canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 16) sum += d[i];
      return sum;
    });
    expect(snapshot1).not.toBe(snapshot2);
  });

  test('timer expiring returns to start screen', async ({ page }) => {
    // Use a 2-second session so the test finishes quickly
    await page.goto('/?duration=2&cycle=1');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // Start breathing
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.83);
    await page.waitForTimeout(200);
    expect(await getScreen(page)).toBe('breathing');
    // Wait for session to expire (2s + buffer)
    await page.waitForTimeout(2500);
    expect(await getScreen(page)).toBe('start');
  });

});
