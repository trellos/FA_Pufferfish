import { test, expect, Page } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────────

// Confirm the canvas drew something beyond a flat fill. The start screen draws
// white text ("Breathe", "Follow the pufferfish") and a near-white play-button
// triangle. Any near-white pixel proves the foreground rendered — the gradient
// sky alone never reaches this brightness.
async function canvasHasContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas || canvas.width === 0) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) return true;
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

async function getBreathState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = (window as Record<string, unknown>)['__breathingManager'] as { getBreathState: () => string };
    return m.getBreathState();
  });
}

async function clickPlayButton(page: Page): Promise<void> {
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.83);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Pufferfish Breathing App', () => {

  test('loading the page displays the start screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#canvas')).toBeVisible();
    expect(await getScreen(page)).toBe('start');
    expect(await canvasHasContent(page)).toBe(true);
  });

  test('pressing Play once brings up the pufferfish (breathing screen)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(await getScreen(page)).toBe('start');
    await clickPlayButton(page);
    // Give one animation frame to process the state change.
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
    await clickPlayButton(page);
    await page.waitForTimeout(150);
    expect(await getScreen(page)).toBe('breathing');

    // Idle: no breath progress yet.
    expect(await getBreathState(page)).toBe('idle');

    // Press and hold — should transition to inhaling.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    expect(await getBreathState(page)).toBe('inhaling');

    // Release — should transition to exhaling.
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(await getBreathState(page)).toBe('exhaling');
  });

  test('timer expiring returns to start screen', async ({ page }) => {
    // Use a 2-second session so the test finishes quickly.
    await page.goto('/?duration=2');
    await page.waitForLoadState('networkidle');
    await clickPlayButton(page);
    await page.waitForTimeout(200);
    expect(await getScreen(page)).toBe('breathing');
    // Wait for session to expire (2s + buffer).
    await page.waitForTimeout(2500);
    expect(await getScreen(page)).toBe('start');
  });

  // ── Particle behavior tests ──────────────────────────────────────────────
  // These verify the user-specified contracts on the particle system:
  //   • Every inhale particle has a target that equals one of the two nostril
  //     positions (the particle is heading to a nostril).
  //   • Every inhale particle physically reaches its target at end-of-life.
  //   • Every exhale particle spawns within the mouth sprite disc.

  test('breathe-in particles target a live nostril', async ({ page }) => {
    await page.goto('/?duration=60');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await clickPlayButton(page);
    await page.waitForTimeout(150);
    // Press and hold to drive the inhale state — particles only spawn while
    // the breath state is 'inhaling'.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);

    const result = await page.evaluate(() => {
      type P = {
        kind: 'inhale' | 'exhale';
        targetSide?: 'left' | 'right';
        targetX?: number; targetY?: number;
        spawnLeftNoseX?: number; spawnRightNoseX?: number; spawnNoseY?: number;
      };
      type M = { leftNostrilX: number; rightNostrilX: number; nostrilY: number };
      const mgr = (window as unknown as {
        __breathingManager: {
          getParticles: () => P[];
          getFishMetrics: () => M | null;
        };
      }).__breathingManager;
      const particles = mgr.getParticles().filter(p => p.kind === 'inhale');
      const metrics = mgr.getFishMetrics();
      return { particles, metrics };
    });

    expect(result.particles.length).toBeGreaterThan(0);
    expect(result.metrics).not.toBeNull();
    const m = result.metrics!;
    for (const p of result.particles) {
      // Every inhale particle is committed to a side at spawn and continues
      // to chase the LIVE position of that nostril as the face shifts.
      expect(p.targetSide === 'left' || p.targetSide === 'right').toBe(true);
      const expectedX = p.targetSide === 'left' ? m.leftNostrilX : m.rightNostrilX;
      expect(p.targetX!).toBeCloseTo(expectedX, 5);
      expect(p.targetY!).toBeCloseTo(m.nostrilY, 5);
      // Spawn snapshot fields are still recorded so we can reason about the
      // particle's original geometry.
      expect(p.spawnLeftNoseX).not.toBeUndefined();
      expect(p.spawnRightNoseX).not.toBeUndefined();
      expect(p.spawnNoseY).not.toBeUndefined();
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
    await clickPlayButton(page);
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

  test('breathe-out particles spawn in an inner ring of the mouth disc (0.2..0.8 of mouthR)', async ({ page }) => {
    // Drive an inhale, then release to enter exhale and spawn exhale particles.
    await page.goto('/?duration=60');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('#canvas');
    const box    = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await clickPlayButton(page);
    await page.waitForTimeout(150);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    // Inhale fully so the release produces a long exhale.
    await page.waitForTimeout(2000);
    await page.mouse.up();
    // Wait into exhale so particles spawn — sample early so trails haven't
    // traveled far from their spawn point.
    await page.waitForTimeout(120);

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
      // Each exhale particle remembers the mouth disc it was spawned around.
      expect(p.spawnMouthCX).not.toBeUndefined();
      expect(p.spawnMouthCY).not.toBeUndefined();
      expect(p.spawnMouthR).not.toBeUndefined();
      const dx = p.spawnX - p.spawnMouthCX!;
      const dy = p.spawnY - p.spawnMouthCY!;
      const dist = Math.hypot(dx, dy);
      // Spawn point lies in the inner mouth ring: between 0.2 and 0.8 of
      // mouthR from the mouth centre. The empty centre keeps trails from
      // converging visually; the empty outer rim is filled by the mouth
      // sprite itself.
      const ratio = dist / p.spawnMouthR!;
      expect(ratio).toBeGreaterThanOrEqual(0.2 - 1e-6);
      expect(ratio).toBeLessThanOrEqual(0.8 + 1e-6);
    }
  });

});
