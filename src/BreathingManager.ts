// BreathingManager — screen flow, tap-and-hold breath control, rAF loop,
// particle system, UI rendering.
//
// URL params: ?duration=60 (session length in seconds)

import { PufferFish, BreathPhase } from './PufferFish';
import {
  FACE_Y_IDLE_FRAC, FACE_Y_PEAK_FRAC,
  FACE_SCALE_IDLE,  FACE_SCALE_PEAK,
  NOSE_LOCAL_Y_FRAC,
  MOUTH_LOCAL_Y_FRAC,
  NOSTRIL_OFFSET_X,
  MOUTH_CIRCLE_WIDTH_IDLE, MOUTH_CIRCLE_WIDTH_PEAK,
  SCALE_MIN, SCALE_MAX, FULL_BREATH_SECS,
} from './FishGeometry';

type Screen = 'start' | 'breathing';
type BreathState = 'idle' | 'inhaling' | 'holding' | 'exhaling';

function urlNum(key: string, fallback: number): number {
  const v = new URLSearchParams(window.location.search).get(key);
  if (v === null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

interface InhaleParticle extends ParticleBase {
  kind: 'inhale';
  // The nostril the particle is heading to. `targetSide` is sticky (set at
  // spawn) so a particle commits to one side and doesn't ping-pong; targetX/Y
  // are refreshed every frame to the LIVE position of that nostril so the
  // particle's trajectory tracks the face as the body puffs up.
  targetSide: 'left' | 'right';
  targetX: number; targetY: number;
  // Snapshot of nostril geometry at spawn time.
  spawnLeftNoseX: number;
  spawnRightNoseX: number;
  spawnNoseY: number;
}

interface ExhaleParticle extends ParticleBase {
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
  // the current frame. The face position, face scale, and mouth size all
  // animate with breath progress, so we interpolate them here using the same
  // curves PufferFish.render uses — keeps the spawner and the renderer in
  // lockstep, which is critical for the inhale particles to actually hit
  // the nostrils.
  private computeMetrics(
    fishX: number, fishY: number,
    baseR: number, scale: number, progress: number,
  ): FishMetrics {
    // Face transform: y position and scale animate with progress.
    const faceY     = baseR * lerp(FACE_Y_IDLE_FRAC, FACE_Y_PEAK_FRAC, progress);
    const faceScale = lerp(FACE_SCALE_IDLE, FACE_SCALE_PEAK, progress);

    // Nostril Y = face Y + nose local Y (face-scaled).
    const noseY  = faceY + baseR * NOSE_LOCAL_Y_FRAC  * faceScale;
    // Mouth Y for big-circle (exhale).
    const mouthY = faceY + baseR * MOUTH_LOCAL_Y_FRAC * faceScale;

    // Mouth_Circle radius scales with progress and face scale.
    const mouthCircleW = baseR
      * lerp(MOUTH_CIRCLE_WIDTH_IDLE, MOUTH_CIRCLE_WIDTH_PEAK, progress)
      * faceScale;

    // The body's outer ctx.scale(scale, scale) is applied to face positions
    // too, so multiply by `scale` for screen-space coordinates.
    return {
      fishX, fishY, baseR, scale,
      scaledR:       baseR * scale,
      leftNostrilX:  fishX + (-baseR * NOSTRIL_OFFSET_X * faceScale) * scale,
      rightNostrilX: fishX + ( baseR * NOSTRIL_OFFSET_X * faceScale) * scale,
      nostrilY:      fishY + noseY * scale,
      mouthCX:       fishX,
      mouthCY:       fishY + mouthY * scale,
      mouthR:        (mouthCircleW / 2) * scale,
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
    // Pick the nearer nostril by Euclidean distance — this commits the
    // particle to a side for its whole life so it doesn't switch sides
    // mid-flight when the face shifts. The actual target X/Y is recomputed
    // each frame in updateParticles.
    const dLx = x - m.leftNostrilX,  dLy = y - m.nostrilY;
    const dRx = x - m.rightNostrilX, dRy = y - m.nostrilY;
    const targetSide: 'left' | 'right' =
      (dLx * dLx + dLy * dLy) < (dRx * dRx + dRy * dRy) ? 'left' : 'right';
    const targetX = targetSide === 'left' ? m.leftNostrilX : m.rightNostrilX;
    const targetY = m.nostrilY;
    const dx = targetX - x;
    const dy = targetY - y;
    const norm = Math.hypot(dx, dy) || 1;
    // The particle MUST physically arrive at the nostril before dying.
    // Pick a random lifetime; set speed = distance / lifetime and decay =
    // 1 / lifetime so position at t=lifetime equals the target exactly.
    // The velocity is refreshed every frame in updateParticles, so this
    // initial value is just the first-frame heading.
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
      targetSide,
      targetX, targetY,
      spawnLeftNoseX:  m.leftNostrilX,
      spawnRightNoseX: m.rightNostrilX,
      spawnNoseY:      m.nostrilY,
    });
  }

  private spawnExhaleParticle(m: FishMetrics): void {
    // Spawn INSIDE the mouth disc but in a ring that skips the dead centre
    // (0..20% of mouthR) and the outer rim (80%..100%). Velocity is strictly
    // radially outward from the mouth centre, so every trail stays on its own
    // radial spoke — no two ever cross, and the empty centre keeps the middle
    // of the mouth visually clear of converging trails.
    const ang0 = Math.random() * Math.PI * 2;
    const rad0 = m.mouthR * (0.2 + Math.random() * 0.6);  // 0.2..0.8 * mouthR
    const sx = m.mouthCX + Math.cos(ang0) * rad0;
    const sy = m.mouthCY + Math.sin(ang0) * rad0;
    const dirX = Math.cos(ang0);
    const dirY = Math.sin(ang0);
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

    // Advance every particle; drop expired ones. For inhale particles we
    // re-aim each frame: the nostril moves as the body inflates, so we
    // recompute the live target, then derive velocity = (target - pos) /
    // remaining_life so the particle still arrives at end-of-life even
    // though the destination keeps shifting under it.
    const keep: Particle[] = [];
    for (const p of this.particles) {
      if (p.kind === 'inhale') {
        const liveTargetX = p.targetSide === 'left' ? m.leftNostrilX : m.rightNostrilX;
        const liveTargetY = m.nostrilY;
        const remaining = p.life / p.decay;  // seconds until life hits 0
        if (remaining > 1e-4) {
          p.vx = (liveTargetX - p.x) / remaining;
          p.vy = (liveTargetY - p.y) / remaining;
        }
        p.targetX = liveTargetX;
        p.targetY = liveTargetY;
      }
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life > 0) keep.push(p);
    }
    this.particles = keep;
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    // Comet trails: a small bright head + a fading tail behind the head.
    // Two key constraints control the tail:
    //   • The tail length is CLAMPED to how far the particle has moved
    //     from its spawn point. A particle's tail never extends back
    //     past the spawn point — at spawn the trail is zero length
    //     (just the head), then grows as the particle travels. This is
    //     critical for exhale particles: without clamping, a tail that
    //     spawns inside the mouth disc would point radially inward and
    //     extend through the mouth centre, visually crossing every
    //     other particle's tail. With clamping, each radial spoke owns
    //     its own outward strip and trails never cross.
    //   • Inhale particles keep full opacity for most of their flight
    //     and only fade in the last ~25% of life (right before they
    //     reach the nostril). Exhale particles fade linearly over their
    //     whole life so they dissipate as they spread outward.
    const TRAIL_LEN_SECS = 0.35;
    const HEAD_RADIUS = 3.2;
    const TAIL_LINE_WIDTH = 6.5;

    for (const p of this.particles) {
      const speed = Math.hypot(p.vx, p.vy);
      if (speed < 1) continue;

      const a = p.kind === 'inhale'
        // Stay at full opacity until life drops below 0.25, then linear
        // fade to 0 — produces a sharp puff at the nostril just before
        // disappearance.
        ? Math.max(0, Math.min(1, p.life * 4))
        : Math.max(0, Math.min(1, p.life));

      // Tail length: full = speed * TRAIL_LEN_SECS, clamped to the
      // distance the particle has already travelled from spawn.
      const dxFromSpawn = p.x - p.spawnX;
      const dyFromSpawn = p.y - p.spawnY;
      const distFromSpawn = Math.hypot(dxFromSpawn, dyFromSpawn);
      const fullTailLen = speed * TRAIL_LEN_SECS;
      const tailLen = Math.min(fullTailLen, distFromSpawn);
      // Tail unit vector: -velocity / speed.
      const tailX = p.x - (p.vx / speed) * tailLen;
      const tailY = p.y - (p.vy / speed) * tailLen;

      ctx.save();

      // Gradient stroke from bright head → transparent tail end. Skip
      // when the tail has zero length (just-spawned particles): a
      // degenerate linear gradient on a zero-length line is undefined,
      // and the head dot drawn below renders the particle anyway.
      if (tailLen > 0.5) {
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
      }

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
      ctx.globalCompositeOperation = 'screen';
      const grad = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowR);
      grad.addColorStop(0,    'rgba(150,200,255,0.4)');
      grad.addColorStop(0.5,  'rgba(100,150,255,0.1)');
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

    // Idle hover: gently breathe between min/peak with a slow sine. The fish
    // sits at ~mid-inflation so spikes and face proportions read natural.
    const idleEnvelope = 0.5 + 0.18 * Math.sin(t * 0.8);
    const idleScale = lerp(SCALE_MIN, SCALE_MAX, idleEnvelope);
    const r = Math.min(W, H) * 0.30;
    const fishX = W / 2;
    const fishY = H * 0.40;

    this.drawBackground(ctx, W, H);
    this.fish.render(ctx, fishX, fishY, r, idleScale, idleEnvelope, 'exhale');

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
    const scale = lerp(SCALE_MIN, SCALE_MAX, eased);

    // baseR is the silhouette radius unit. With Unity SCALE_MAX = 1.0 the
    // peak body radius equals baseR. At ~40% of viewport min dimension, the
    // peak body fills ~80% of the viewport width — comfortable on both
    // landscape and portrait phones.
    const r     = Math.min(W, H) * 0.40;
    const fishX = W / 2;
    const fishY = H * 0.50;

    this.drawBackground(ctx, W, H);

    // Cache metrics so getFishMetrics() returns the same numbers the spawner
    // uses, and so the particle update sees consistent geometry this frame.
    this.metrics = this.computeMetrics(fishX, fishY, r, scale, eased);
    this.updateParticles(dt, phase, this.metrics);
    this.fish.render(ctx, fishX, fishY, r, scale, eased, phase);
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
