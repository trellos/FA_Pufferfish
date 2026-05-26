// BreathingManager — screen flow, tap-and-hold breath control, rAF loop,
// particle system, UI rendering.
//
// URL params: ?duration=60 (session length in seconds)

import { PufferFish, BreathPhase } from './PufferFish';
import {
  NOSE_Y_FRAC,
  BIG_NOSE_Y_FRAC,
  MOUTH_CIRCLE_RADIUS,
  NOSTRIL_OFFSET_X,
} from './FishGeometry';

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

// ── Particle types ─────────────────────────────────────────────────────────
// Discriminated union by `kind`. Inhale particles fly toward a chosen nostril;
// exhale particles spawn inside the mouth disc and radiate outward.
//
// The spawn* snapshot fields record the geometry the spawner used at creation
// time. They exist so tests can verify particle behavior against the geometry
// the spawner SAW (which differs from the live frame because scale animates).

interface ParticleBase {
  x: number;  y: number;
  vx: number; vy: number;
  life: number;
  decay: number;
  spawnX: number; spawnY: number;
}

export interface InhaleParticle extends ParticleBase {
  kind: 'inhale';
  targetX: number; targetY: number;
  // Snapshot of nostril geometry at spawn time.
  spawnLeftNoseX: number;
  spawnRightNoseX: number;
  spawnNoseY: number;
}

export interface ExhaleParticle extends ParticleBase {
  kind: 'exhale';
  // Snapshot of mouth-disc geometry at spawn time.
  spawnMouthCX: number;
  spawnMouthCY: number;
  spawnMouthR: number;
}

export type Particle = InhaleParticle | ExhaleParticle;

// Snapshot of fish geometry from the most recently rendered frame. Tests use
// this to know where the mouth sprite and nostrils are in screen space.
export interface FishMetrics {
  fishX: number; fishY: number;
  baseR: number; scale: number;
  scaledR: number;
  leftNostrilX: number; rightNostrilX: number; nostrilY: number;
  mouthCX: number; mouthCY: number; mouthR: number;
}

export class BreathingManager {
  private ctx: CanvasRenderingContext2D;
  private fish: PufferFish;
  private screen: Screen = 'start';
  private sessionSecs: number;
  private sessionStart = 0;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private particles: Particle[] = [];
  private idleT = 0;
  private metrics: FishMetrics | null = null;

  // Tap-and-hold breath state.
  private breathState: BreathState = 'idle';
  private pressed = false;
  private breathProgress = 0; // 0 = min scale, 1 = max scale

  // Loop and lifecycle bookkeeping (kept so dispose() can tear them down).
  private rafHandle: number | null = null;
  private resizeHandler = (): void => this.resize();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx  = canvas.getContext('2d')!;
    this.fish = new PufferFish(`${import.meta.env.BASE_URL}assets/`);
    this.sessionSecs = urlNum('duration', 60);
  }

  async init(): Promise<void> {
    await this.fish.load();
    this.resize();
    window.addEventListener('resize', this.resizeHandler);
    this.rafHandle = requestAnimationFrame(ts => this.loop(ts, ts));
  }

  // Stop the rAF loop and unsubscribe listeners. Not called by the current
  // single-page entry point, but exists so this class can be embedded as a
  // component without leaking.
  dispose(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    window.removeEventListener('resize', this.resizeHandler);
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
    this.screen       = 'breathing';
    this.sessionStart = performance.now();
    this.resetBreathSession();
  }

  // Reset all per-session breathing state. Called when entering breathing
  // (fresh start) and when leaving it (timer expiry).
  private resetBreathSession(): void {
    this.particles      = [];
    this.breathState    = 'idle';
    this.breathProgress = 0;
    this.pressed        = false;
  }

  // Compute screen-space positions of the nostrils and the mouth sprite for
  // the current frame, using the canonical body-local fractions from
  // FishGeometry. This is the only place those fractions get projected.
  private computeMetrics(
    fishX: number, fishY: number,
    baseR: number, scale: number,
  ): FishMetrics {
    return {
      fishX, fishY, baseR, scale,
      scaledR:       baseR * scale,
      leftNostrilX:  fishX + (-baseR * NOSTRIL_OFFSET_X) * scale,
      rightNostrilX: fishX + ( baseR * NOSTRIL_OFFSET_X) * scale,
      nostrilY:      fishY + ( baseR * NOSE_Y_FRAC)      * scale,
      mouthCX:       fishX,
      mouthCY:       fishY + ( baseR * BIG_NOSE_Y_FRAC)  * scale,
      mouthR:        baseR * MOUTH_CIRCLE_RADIUS * scale,
    };
  }

  // ── Particle system ────────────────────────────────────────────────────────
  // Phase-aware comet particles:
  //   • INHALE: spawn outside the body, velocity directed toward the NEAREST
  //             nostril. Particles on the left of the fish flow to the left
  //             nostril and vice versa, picked by Euclidean distance.
  //             Speed/decay are tuned so the head physically reaches the
  //             nostril exactly at end-of-life.
  //   • EXHALE: spawn at a uniform random point inside the mouth sprite disc
  //             (Mouth_Circle). Velocity is RADIAL OUTWARD from the mouth
  //             center with a small downward bias.
  //   • HOLD / IDLE: no new particles spawn; existing ones finish their motion.
  // drawParticles runs AFTER fish.render so streaks stay in front of the body.

  private spawnInhaleParticle(fishX: number, fishY: number, m: FishMetrics): void {
    // Spawn somewhere in a ring around the fish.
    const angle = Math.random() * Math.PI * 2;
    const dist  = m.scaledR * (1.25 + Math.random() * 0.55);
    const x = fishX + Math.cos(angle) * dist;
    const y = fishY + Math.sin(angle) * dist;
    // Pick the nearer nostril by Euclidean distance.
    const dLx = x - m.leftNostrilX,  dLy = y - m.nostrilY;
    const dRx = x - m.rightNostrilX, dRy = y - m.nostrilY;
    const targetX = (dLx * dLx + dLy * dLy) < (dRx * dRx + dRy * dRy)
      ? m.leftNostrilX
      : m.rightNostrilX;
    const targetY = m.nostrilY;
    const dx = targetX - x;
    const dy = targetY - y;
    const norm = Math.hypot(dx, dy) || 1;
    // The particle MUST physically arrive at the nostril before dying.
    // Pick a random lifetime; set speed = distance / lifetime and decay =
    // 1 / lifetime so position at t=lifetime equals the target exactly.
    const lifetimeSec = 0.55 + Math.random() * 0.30; // 0.55..0.85s
    const speed = norm / lifetimeSec;
    const decay = 1 / lifetimeSec;
    this.particles.push({
      kind: 'inhale',
      x, y,
      vx: (dx / norm) * speed,
      vy: (dy / norm) * speed,
      life: 1,
      decay,
      spawnX: x, spawnY: y,
      targetX, targetY,
      spawnLeftNoseX:  m.leftNostrilX,
      spawnRightNoseX: m.rightNostrilX,
      spawnNoseY:      m.nostrilY,
    });
  }

  private spawnExhaleParticle(m: FishMetrics): void {
    // Uniform point in disc: sqrt(uniform) gives even areal density.
    const ang0 = Math.random() * Math.PI * 2;
    const rad0 = Math.sqrt(Math.random()) * m.mouthR;
    const sx = m.mouthCX + Math.cos(ang0) * rad0;
    const sy = m.mouthCY + Math.sin(ang0) * rad0;
    // Direction = radial outward from mouth center. If the spawn landed
    // exactly at the center, pick a random outward angle instead.
    let dirX: number, dirY: number;
    if (rad0 < 1e-3) {
      const a = Math.random() * Math.PI * 2;
      dirX = Math.cos(a);
      dirY = Math.sin(a);
    } else {
      const norm = Math.hypot(sx - m.mouthCX, sy - m.mouthCY) || 1;
      dirX = (sx - m.mouthCX) / norm;
      dirY = (sy - m.mouthCY) / norm;
    }
    // Small downward bias so the overall flow reads as "exhaling toward the
    // floor". Re-normalize after biasing.
    dirY += 0.35;
    const n2 = Math.hypot(dirX, dirY) || 1;
    dirX /= n2; dirY /= n2;
    const speed = 140 + Math.random() * 80;
    this.particles.push({
      kind: 'exhale',
      x: sx, y: sy,
      vx: dirX * speed,
      vy: dirY * speed,
      life: 1,
      decay: 0.9 + Math.random() * 0.3,
      spawnX: sx, spawnY: sy,
      spawnMouthCX: m.mouthCX,
      spawnMouthCY: m.mouthCY,
      spawnMouthR:  m.mouthR,
    });
  }

  private updateParticles(dt: number, phase: BreathPhase, m: FishMetrics): void {
    if (phase === 'inhale') {
      // Spawn rate ~25/sec (Poisson approximation).
      if (Math.random() < dt * 25) this.spawnInhaleParticle(m.fishX, m.fishY, m);
    } else if (phase === 'exhale') {
      // Spawn rate ~18/sec.
      if (Math.random() < dt * 18) this.spawnExhaleParticle(m);
    }

    // Advance every particle; drop expired ones.
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
    // Comet trails (reference p_008): a small bright head + a long fading
    // tail aligned with velocity (tail points BEHIND the motion direction).
    const TRAIL_LEN = 0.35;
    const HEAD_RADIUS = 3.2;
    const TAIL_LINE_WIDTH = 6.5;

    for (const p of this.particles) {
      const a = Math.max(0, Math.min(1, p.life));
      const speed = Math.hypot(p.vx, p.vy);
      if (speed < 1) continue;

      const tailX = p.x - p.vx * TRAIL_LEN;
      const tailY = p.y - p.vy * TRAIL_LEN;

      ctx.save();

      // Gradient stroke from bright head → transparent tail end.
      const grad = ctx.createLinearGradient(p.x, p.y, tailX, tailY);
      grad.addColorStop(0,    `rgba(216, 244, 255, ${a * 0.95})`);
      grad.addColorStop(0.25, `rgba(216, 244, 255, ${a * 0.55})`);
      grad.addColorStop(1,    `rgba(216, 244, 255, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.lineWidth = TAIL_LINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();

      // Bright dot at the head.
      ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.95})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, HEAD_RADIUS, 0, Math.PI * 2);
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
  //
  // Session timing note: elapsed is computed from absolute performance.now()
  // (not the dt-summed time), so tabbing away keeps the clock running. dt is
  // clamped to 0.1s so a long tab-out doesn't produce a giant per-frame step.

  private loop(ts: number, prev: number): void {
    this.rafHandle = requestAnimationFrame(t => this.loop(t, ts));
    const dt = Math.min((ts - prev) / 1000, 0.1);

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (this.screen === 'start') {
      this.idleT += dt;
      this.drawStart(this.idleT);
    } else {
      const elapsed = (ts - this.sessionStart) / 1000;
      if (elapsed >= this.sessionSecs) {
        this.screen = 'start';
        this.idleT  = 0;
        this.resetBreathSession();
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
    const r = Math.min(W, H) * 0.26;
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

    const eased = easeInOutSine(this.breathProgress);
    const scale = SCALE_MIN + eased * (SCALE_MAX - SCALE_MIN);

    // baseR is the silhouette radius unit. With sx=1.05*baseR, sy=1.02*baseR
    // (slightly fuller bottom), the silhouette is ~2.10*baseR wide × ~2.04*baseR
    // tall before scaling. At scale=1.22 that's ~2.56*baseR wide × ~2.49*baseR
    // tall, filling ~85-87% of viewport width at peak inflation.
    const r     = Math.min(W, H) * 0.34;
    const fishX = W / 2;
    const fishY = H * 0.48;

    // Background paints the gradient sky and a soft halo behind the fish. The
    // PufferFish sprite layer also draws Glow.png directly, so the two layers
    // together produce the bloom.
    this.drawBackground(ctx, W, H, fishX, fishY, r * scale);

    // Cache metrics so getFishMetrics() returns the same numbers the spawner
    // uses, and so the particle update sees consistent geometry this frame.
    this.metrics = this.computeMetrics(fishX, fishY, r, scale);
    this.updateParticles(dt, phase, this.metrics);
    this.fish.render(ctx, fishX, fishY, r, scale, phase);
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

    // Twin fill from each side toward center.
    if (progress > 0) {
      const halfFill = (width / 2) * progress;
      ctx.save();
      this.rrect(ctx, x, y, width, h, rx);
      ctx.clip();
      ctx.fillStyle = '#FFB84D'; // distinct from the cyan play button & track
      ctx.fillRect(x, y, halfFill, h);                          // left half
      ctx.fillRect(x + width - halfFill, y, halfFill, h);       // right half
      ctx.restore();
    }

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

  // ── Test instrumentation (do not call from runtime code) ──────────────────
  // These accessors exist so Playwright tests can observe screen state,
  // breath state, and particle behavior without reaching into private fields.

  getScreen(): Screen { return this.screen; }
  getBreathState(): BreathState { return this.breathState; }

  // Returns shallow-copied snapshots of every live particle.
  getParticles(): Particle[] {
    return this.particles.map(p => ({ ...p }));
  }

  // Returns the metrics from the most recently rendered breathing frame, or
  // null if the breathing screen has not rendered yet.
  getFishMetrics(): FishMetrics | null {
    return this.metrics ? { ...this.metrics } : null;
  }
}
