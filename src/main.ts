import { BreathingManager } from './BreathingManager';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const manager = new BreathingManager(canvas);

// ── Test instrumentation (do not consume from runtime code) ─────────────────
// Playwright tests reach the manager through `window.__breathingManager`.
(window as unknown as Record<string, unknown>)['__breathingManager'] = manager;

manager.init().catch(err => {
  console.error('BreathingManager init failed:', err);
});

function localPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// On press, fire BOTH handlers. handleClick no-ops outside the start screen;
// handlePressDown no-ops outside the breathing screen. The order matters:
// handleClick may transition us from start → breathing, after which the same
// press should immediately begin the inhale.
canvas.addEventListener('mousedown', (e) => {
  const p = localPoint(e.clientX, e.clientY);
  manager.handleClick(p.x, p.y);
  manager.handlePressDown();
});

canvas.addEventListener('mouseup', () => {
  manager.handlePressUp();
});

// Treat leaving the canvas as a release so the fish doesn't get stuck inhaling
// if the user drags off the canvas mid-press.
canvas.addEventListener('mouseleave', () => {
  manager.handlePressUp();
});

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.changedTouches[0];
  const p = localPoint(touch.clientX, touch.clientY);
  manager.handleClick(p.x, p.y);
  manager.handlePressDown();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  manager.handlePressUp();
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  manager.handlePressUp();
}, { passive: false });
