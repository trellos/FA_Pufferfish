import { BreathingManager } from './BreathingManager';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const manager = new BreathingManager(canvas);

// Expose for e2e test access
(window as unknown as Record<string, unknown>)['__breathingManager'] = manager;

manager.init();

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  manager.handleClick(e.clientX - rect.left, e.clientY - rect.top);
});

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const rect  = canvas.getBoundingClientRect();
  const touch = e.changedTouches[0];
  manager.handleClick(touch.clientX - rect.left, touch.clientY - rect.top);
}, { passive: false });

