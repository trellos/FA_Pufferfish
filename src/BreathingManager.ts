// BreathingManager — screen flow, tap-and-hold breath control, rAF loop, particles, UI.
// URL params: ?duration=60 (session length in seconds)

import { PufferFish, BreathPhase } from './PufferFish';

type Screen = 'start' | 'breathing';
type BreathState = 'idle' | 'inhaling' | 'holding' | 'exhaling';

// Seconds to go from min → max scale while held. Exhale uses the same rate,
// so partial inhales exhale in the same time they inhaled.
const FULL_BREATH_SECS = 5;

const SCALE_MIN = 0.78;
const SCALE_MAX = 1.22;

function urlNum(key: string, fallback: number): number {
  const v = new URLSearchParams(window.location.search).get(key);
  if (v === null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  decay: number;
  size: number;
  isLine: boolean;
  angle: number;
  kind: 'inhale' | 'exhale';
}

export class BreathingManager {
  private ctx: CanvasRenderingContext2D;
  private fish: PufferFish;
  private screen: Screen = 'start';
  private sessionSecs: number;
  sessionStart = 0;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private particles: Particle[] = [];
  private idleT = 0;

  // Tap-and-hold breath state
  private breathState: BreathState = 'idle';
  private pressed = false;
  private breathProgress = 0; // 0 = min scale, 1 = max scale

  getScreen(): Screen { return this.screen; }
  getBreathState(): BreathState { return this.breathState; }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx  = canvas.getContext('2d')!;
    this.fish = new PufferFish(`${import.meta.env.BASE_URL}assets/`);
    this.sessionSecs = urlNum('duration', 60);
  }

  async init(): Promise<void> {
    await this.fish.load();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(ts => this.loop(ts, ts));
  }

  private resize(): void {
    this.dpr  = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = rect.width  || window.innerWidth;
    this.cssH = rect.height || window.innerHeight;
    this.canvas.width  = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
  }

  startBreathing(): void {
    this.screen         = 'breathing';
    this.sessionStart   = performance.now();
    this.particles      = [];
    this.breathState    = 'idle';
    this.breathProgress = 0;
    this.pressed        = false;
  }

  // ── Particle system ────────────────────────────────────────────────────────

  private spawnInhaleParticle(mouthX: number, mouthY: number, r: number): void {
    const angle = Math.random() * Math.PI * 2;
    const dist  = r * (1.25 + Math.random() * 0.55);
    const x = mouthX + Math.cos(angle) * dist;
    const y = mouthY + Math.sin(angle) * dist;
    const speed = 180 + Math.random() * 80;
    const dx = mouthX - x;
    const dy = mouthY - y;
    const norm = Math.hypot(dx, dy) || 1;
    this.particles.push({
      x, y,
      vx: (dx / norm) * speed,
      vy: (dy / norm) * speed,
      life: 1,
      decay: 0.9 + Math.random() * 0.3,
      size: 1.5,
      isLine: true,
      angle: 0,
      kind: 'inhale',
    });
  }

  private spawnExhaleParticle(mouthX: number, mouthY: number, _r: number): void {
    const baseDeg = 90;
    const spreadDeg = 50;
    const deg = baseDeg + (Math.random() * 2 - 1) * spreadDeg;
    const angle = deg * Math.PI / 180;
    const speed = 150 + Math.random() * 90;
    this.particles.push({
      x: mouthX + (Math.random() - 0.5) * 4,
      y: mouthY + (Math.random() - 0.5) * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.9 + Math.random() * 0.3,
      size: 1.5,
      isLine: true,
      angle: 0,
      kind: 'exhale',
    });
  }

  private updateParticles(
    dt: number,
    phase: BreathPhase,
    mouthX: number,
    mouthY: number,
    r: number,
  ): void {
    if (phase === 'inhale') {
      if (Math.random() < dt * 20) this.spawnInhaleParticle(mouthX, mouthY, r);
    } else if (phase === 'exhale') {
      if (Math.random() < dt * 30) this.spawnExhaleParticle(mouthX, mouthY, r);
    }

    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life > 0) keep.push(p);
    }
    this.particles = keep;
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    const trailLen = 0.14;
    for (const p of this.particles) {
      const tailX = p.x - p.vx * trailLen;
      const tailY = p.y - p.vy * trailLen;
      const a = Math.max(0, Math.min(1, p.life));
      const headColor   = '#FFFFFF';
      const streakColor = p.kind === 'exhale' ? '255,255,255' : '204,250,255';

      ctx.save();
      const grad = ctx.createLinearGradient(tailX, tailY, p.x, p.y);
      grad.addColorStop(0,   `rgba(${streakColor},0)`);
      grad.addColorStop(0.6, `rgba(${streakColor},${a * 0.65})`);
      grad.addColorStop(1,   `rgba(${streakColor},${a * 0.98})`);
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.lineWidth = p.kind === 'exhale' ? 2.6 : 2.2;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      ctx.globalAlpha = a;
      ctx.fillStyle = headColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.kind === 'exhale' ? 2.4 : 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Background ─────────────────────────────────────────────────────────────

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    W: number, H: number,
    glowX?: number, glowY?: number, glowR?: number,
  ): void {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#193F7E');
    bg.addColorStop(1, '#3A7BE0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (glowX !== undefined && glowY !== undefined && glowR !== undefined) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r2 = glowR * 1.45;
      const grad = ctx.createRadialGradient(glowX, glowY, glowR * 0.85, glowX, glowY, r2);
      grad.addColorStop(0,    'rgba(0,255,255,0.0)');
      grad.addColorStop(0.30, 'rgba(0,240,255,0.55)');
      grad.addColorStop(0.55, 'rgba(0,220,255,0.30)');
      grad.addColorStop(0.80, 'rgba(0,160,240,0.12)');
      grad.addColorStop(1,    'rgba(0,30,190,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  private loop(ts: number, prev: number): void {
    requestAnimationFrame(t => this.loop(t, ts));
    const dt = Math.min((ts - prev) / 1000, 0.1);

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (this.screen === 'start') {
      this.idleT += dt;
      this.drawStart(this.idleT);
    } else {
      const elapsed = (ts - this.sessionStart) / 1000;
      if (elapsed >= this.sessionSecs) {
        this.screen        = 'start';
        this.idleT         = 0;
        this.particles     = [];
        this.breathState   = 'idle';
        this.breathProgress = 0;
        this.pressed       = false;
        this.drawStart(0);
        return;
      }
      this.advanceBreath(dt);
      this.drawBreathing(dt);
    }
  }

  // ── Breath state machine ──────────────────────────────────────────────────

  private advanceBreath(dt: number): void {
    const rate = 1 / FULL_BREATH_SECS; // progress units per second

    if (this.pressed) {
      if (this.breathState === 'idle' || this.breathState === 'exhaling') {
        this.breathState = 'inhaling';
      }
      if (this.breathState === 'inhaling') {
        this.breathProgress = Math.min(1, this.breathProgress + rate * dt);
        if (this.breathProgress >= 1) {
          this.breathProgress = 1;
          this.breathState = 'holding';
        }
      }
      // holding: progress stays at 1
    } else {
      if (this.breathState === 'inhaling' || this.breathState === 'holding') {
        this.breathState = 'exhaling';
      }
      if (this.breathState === 'exhaling') {
        this.breathProgress = Math.max(0, this.breathProgress - rate * dt);
        if (this.breathProgress <= 0) {
          this.breathProgress = 0;
          this.breathState = 'idle';
        }
      }
    }
  }

  // ── Start screen ──────────────────────────────────────────────────────────

  private drawStart(t: number): void {
    const { ctx, cssW: W, cssH: H } = this;

    const idleScale = 0.92 + Math.sin(t * 0.8) * 0.04;
    const r = Math.min(W, H) * 0.30;
    const fishX = W / 2;
    const fishY = H * 0.40;

    this.drawBackground(ctx, W, H, fishX, fishY, r * idleScale);
    this.fish.render(ctx, fishX, fishY, r, idleScale, 'exhale');

    const titleSz = Math.min(W * 0.115, 52);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#FFFFFF';
    ctx.font         = `${titleSz}px system-ui, -apple-system, sans-serif`;
    ctx.fillText('Breathe', W / 2, H * 0.74);

    const subSz = Math.min(W * 0.043, 18);
    ctx.fillStyle = 'rgba(200,230,255,0.80)';
    ctx.font      = `${subSz}px system-ui, -apple-system, sans-serif`;
    ctx.fillText('Follow the pufferfish', W / 2, H * 0.80);

    this.drawPlayButton(W / 2, H * 0.90);
  }

  private drawPlayButton(cx: number, cy: number): void {
    const { ctx, cssW: W } = this;
    const r = Math.min(W * 0.115, 52);

    ctx.save();
    ctx.shadowColor = 'rgba(0,220,255,0.6)';
    ctx.shadowBlur  = 24;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#00DDFF';
    ctx.fill();
    ctx.restore();

    const ts = r * 0.40;
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.55, cy - ts);
    ctx.lineTo(cx - ts * 0.55, cy + ts);
    ctx.lineTo(cx + ts,        cy);
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }

  // ── Breathing screen ──────────────────────────────────────────────────────

  private drawBreathing(dt: number): void {
    const { ctx, cssW: W, cssH: H } = this;

    const phase: BreathPhase =
      this.breathState === 'inhaling' ? 'inhale' :
      this.breathState === 'holding'  ? 'hold'   :
      this.breathState === 'exhaling' ? 'exhale' :
      /* idle */                        'exhale';

    // PufferFish renderer uses phaseT for sub-phase asset swaps during inhale.
    const phaseT = this.breathProgress;

    const eased = easeInOutSine(this.breathProgress);
    const scale = SCALE_MIN + eased * (SCALE_MAX - SCALE_MIN);

    const r     = Math.min(W, H) * 0.46;
    const fishX = W / 2;
    const fishY = H * 0.50;

    this.drawBackground(ctx, W, H, fishX, fishY, r * scale);
    const mouthY = fishY + (-r * 0.61) * scale;
    this.updateParticles(dt, phase, fishX, mouthY, r * scale);
    this.fish.render(ctx, fishX, fishY, r, scale, phase, phaseT);
    this.drawParticles(ctx);

    this.drawBreathBar(W / 2, H * 0.08, Math.min(W * 0.75, 520), 36, this.breathProgress);
  }

  // Top bar: fills from each side toward center; text changes per state.
  private drawBreathBar(cx: number, cy: number, width: number, h: number, progress: number): void {
    const { ctx } = this;
    const rx = h / 2;
    const x  = cx - width / 2;
    const y  = cy - h / 2;

    ctx.save();

    // Track
    ctx.fillStyle = 'rgba(10,20,60,0.7)';
    this.rrect(ctx, x, y, width, h, rx);
    ctx.fill();

    // Twin fill from each side toward center
    if (progress > 0) {
      const halfFill = (width / 2) * progress;
      ctx.save();
      this.rrect(ctx, x, y, width, h, rx);
      ctx.clip();
      ctx.fillStyle = '#FFB84D'; // distinct from the cyan play button & track
      // Left half
      ctx.fillRect(x, y, halfFill, h);
      // Right half
      ctx.fillRect(x + width - halfFill, y, halfFill, h);
      ctx.restore();
    }

    // Text
    const label =
      this.breathState === 'inhaling' ? 'hold to breathe in' :
      this.breathState === 'holding'  ? 'holding'            :
      this.breathState === 'idle'     ? 'tap to breathe in'  :
      /* exhaling */                    '';

    if (label) {
      const fs = Math.min(h * 0.52, 18);
      ctx.fillStyle    = '#FFFFFF';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.font         = `600 ${fs}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(label, cx, cy);
    }

    ctx.restore();
  }

  private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  handleClick(x: number, y: number): void {
    if (this.screen !== 'start') return;
    const bx = this.cssW / 2;
    const by = this.cssH * 0.90;
    const br = Math.min(this.cssW * 0.115, 52);
    if (Math.hypot(x - bx, y - by) <= br * 1.3) {
      this.startBreathing();
    }
  }

  // Press/release drive the breath state machine on the breathing screen.
  handlePressDown(): void {
    if (this.screen !== 'breathing') return;
    this.pressed = true;
  }

  handlePressUp(): void {
    if (this.screen !== 'breathing') return;
    this.pressed = false;
  }
}
