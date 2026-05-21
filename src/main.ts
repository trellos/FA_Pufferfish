import { BreathingManager } from './BreathingManager';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const manager = new BreathingManager(canvas);

// Expose for e2e test access
(window as unknown as Record<string, unknown>)['__breathingManager'] = manager;

manager.init();

function localPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// Start screen: click the play button to enter breathing.
canvas.addEventListener('mousedown', (e) => {
  const p = localPoint(e.clientX, e.clientY);
  // Start screen play-button hit-test happens inside handleClick.
  manager.handleClick(p.x, p.y);
  // Breathing screen: pressing anywhere begins the inhale.
  manager.handlePressDown();
});

canvas.addEventListener('mouseup', () => {
  manager.handlePressUp();
});

canvas.addEventListener('mouseleave', () => {
  // Treat leaving the canvas as a release so the fish doesn't get stuck inhaling.
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
