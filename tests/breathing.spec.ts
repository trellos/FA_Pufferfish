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

  test('pressing and holding inflates the pufferfish; releasing deflates it', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // Enter breathing screen.
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.83);
    await page.waitForTimeout(150);
    expect(await getScreen(page)).toBe('breathing');

    // Idle: no breath progress, state should be 'idle'.
    const idleState = await page.evaluate(() => {
      const m = (window as Record<string, unknown>)['__breathingManager'] as { getBreathState: () => string };
      return m.getBreathState();
    });
    expect(idleState).toBe('idle');

    // Press and hold — should transition to inhaling.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    const inhalingState = await page.evaluate(() => {
      const m = (window as Record<string, unknown>)['__breathingManager'] as { getBreathState: () => string };
      return m.getBreathState();
    });
    expect(inhalingState).toBe('inhaling');

    // Release — should transition to exhaling.
    await page.mouse.up();
    await page.waitForTimeout(100);
    const exhalingState = await page.evaluate(() => {
      const m = (window as Record<string, unknown>)['__breathingManager'] as { getBreathState: () => string };
      return m.getBreathState();
    });
    expect(exhalingState).toBe('exhaling');
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

  // ── Particle behavior tests ──────────────────────────────────────────────
  // These verify the user-specified contracts on the particle system:
  //   • Every inhale particle has a target that equals one of the two nostril
  //     positions (the particle is heading to a nostril).
  //   • Every exhale particle spawns within the mouth sprite disc.

  test('breathe-in particles target a nostril', async ({ page }) => {
    await page.goto('/?duration=60');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // Enter breathing screen via the play button.
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.83);
    await page.waitForTimeout(150);
    // Press and hold to drive the inhale state — particles only spawn while
    // the breath state is 'inhaling'.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);

    const result = await page.evaluate(() => {
      type P = {
        kind: 'inhale' | 'exhale';
        targetX?: number; targetY?: number;
        spawnLeftNoseX?: number; spawnRightNoseX?: number; spawnNoseY?: number;
      };
      const mgr = (window as unknown as {
        __breathingManager: { getParticles: () => P[] };
      }).__breathingManager;
      const particles = mgr.getParticles().filter(p => p.kind === 'inhale');
      return { particles };
    });

    expect(result.particles.length).toBeGreaterThan(0);
    for (const p of result.particles) {
      // Every inhale particle must have a target and remember which nostril
      // positions it was given at spawn.
      expect(p.targetX).not.toBeUndefined();
      expect(p.targetY).not.toBeUndefined();
      expect(p.spawnLeftNoseX).not.toBeUndefined();
      expect(p.spawnRightNoseX).not.toBeUndefined();
      expect(p.spawnNoseY).not.toBeUndefined();
      // The target Y must equal the nostril row from the SAME frame as spawn.
      expect(p.targetY!).toBe(p.spawnNoseY!);
      // The target X must equal EITHER the left or right nostril X from spawn.
      const onLeft  = p.targetX! === p.spawnLeftNoseX!;
      const onRight = p.targetX! === p.spawnRightNoseX!;
      expect(onLeft || onRight).toBe(true);
    }
    await page.mouse.up();
  });

  test('breathe-in particles physically reach their target nostril', async ({ page }) => {
    // Verify the trajectory math: at end of life (life=0), the particle's
    // position should equal its target. With speed = distance / lifetime and
    // decay = 1 / lifetime, position at t=lifetime = target.
    await page.goto('/?duration=60');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.83);
    await page.waitForTimeout(150);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);

    const result = await page.evaluate(() => {
      type P = {
        kind: 'inhale' | 'exhale';
        x: number; y: number;
        vx: number; vy: number;
        life: number; decay: number;
        targetX?: number; targetY?: number;
      };
      const mgr = (window as unknown as {
        __breathingManager: { getParticles: () => P[] };
      }).__breathingManager;
      const particles = mgr.getParticles().filter(p => p.kind === 'inhale');
      return { particles };
    });

    expect(result.particles.length).toBeGreaterThan(0);
    for (const p of result.particles) {
      // Compute remaining time until life hits 0: life / decay (seconds).
      const remaining = p.life / p.decay;
      // Predict the particle's position at end-of-life.
      const endX = p.x + p.vx * remaining;
      const endY = p.y + p.vy * remaining;
      // The predicted end position must be the target (within tiny float error).
      expect(Math.hypot(endX - p.targetX!, endY - p.targetY!)).toBeLessThan(0.5);
    }
    await page.mouse.up();
  });

  test('breathe-out particles only spawn within the mouth sprite disc', async ({ page }) => {
    // Drive an inhale, then release to enter exhale and spawn exhale particles.
    await page.goto('/?duration=60');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.83);
    await page.waitForTimeout(150);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    // Inhale fully so the release produces a long exhale.
    await page.waitForTimeout(2000);
    await page.mouse.up();
    // Wait into exhale so particles spawn.
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => {
      type P = {
        kind: 'inhale' | 'exhale';
        spawnX: number; spawnY: number;
        spawnMouthCX?: number; spawnMouthCY?: number; spawnMouthR?: number;
      };
      const mgr = (window as unknown as {
        __breathingManager: { getParticles: () => P[] };
      }).__breathingManager;
      const particles = mgr.getParticles().filter(p => p.kind === 'exhale');
      return { particles };
    });

    expect(result.particles.length).toBeGreaterThan(0);
    for (const p of result.particles) {
      // Each exhale particle remembers the mouth disc it was spawned in.
      expect(p.spawnMouthCX).not.toBeUndefined();
      expect(p.spawnMouthCY).not.toBeUndefined();
      expect(p.spawnMouthR).not.toBeUndefined();
      const dx = p.spawnX - p.spawnMouthCX!;
      const dy = p.spawnY - p.spawnMouthCY!;
      const dist = Math.hypot(dx, dy);
      // The spawn point must lie inside the mouth sprite disc.
      // Tiny floating-point slack (1e-6) is allowed; the spawn function uses
      // sqrt(random) * mouthR so dist is at most mouthR exactly.
      expect(dist).toBeLessThanOrEqual(p.spawnMouthR! + 1e-6);
    }
  });

});
