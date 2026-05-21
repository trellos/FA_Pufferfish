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

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  decay: number;
  size: number;
  isLine: boolean;
  angle: number;
  kind: 'inhale' | 'exhale';
  // Spawn position at the time the particle was created. Used by tests to
  // verify exhale particles only spawn inside the mouth sprite disc.
  spawnX: number; spawnY: number;
  // Target position the particle is headed toward (inhale only — the chosen
  // nostril). Exhale particles don't have a target.
  targetX?: number; targetY?: number;
  // Snapshot of the relevant face metrics AT SPAWN TIME. Stored so tests can
  // compare against the geometry the spawner actually used, rather than the
  // current frame's geometry (which differs because scale changes over time).
  spawnLeftNoseX?: number;
  spawnRightNoseX?: number;
  spawnNoseY?: number;
  spawnMouthCX?: number;
  spawnMouthCY?: number;
  spawnMouthR?: number;
}

// Snapshot of fish geometry, returned by getFishMetrics(). Tests use this to
// know where the mouth sprite and nostrils are in screen space without
// reaching into private state.
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
  sessionStart = 0;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private particles: Particle[] = [];
  private idleT = 0;
  private _metrics: FishMetrics | null = null;

  // Tap-and-hold breath state
  private breathState: BreathState = 'idle';
  private pressed = false;
  private breathProgress = 0; // 0 = min scale, 1 = max scale

  getScreen(): Screen { return this.screen; }
  getBreathState(): BreathState { return this.breathState; }

  // Read-only access for tests. Returns a snapshot of live particle state
  // including each particle's spawnX/Y and (for inhale) targetX/Y.
  getParticles(): Particle[] {
    return this.particles.map(p => ({ ...p }));
  }

  // Most recent fish metrics from the last rendered frame, or null if the
  // breathing screen has not rendered yet. Tests use this to verify spawn
  // points lie within the mouth disc and inhale targets equal a nostril.
  getFishMetrics(): FishMetrics | null {
    return this._metrics ? { ...this._metrics } : null;
  }

  // Compute the screen-space positions of the nostrils and the mouth sprite
  // for the current frame. PufferFish.ts defines:
  //   NOSE_Y     = -hr * 0.52  (nostril row)
  //   BIG_NOSE_Y = -hr * 0.38  (Mouth_Circle center during exhale)
  //   Mouth_Circle width = hr * 0.38  → radius = hr * 0.19
  //   Nose_Open width = hr * 0.30 → dots at ±0.14 of asset-center
  private computeMetrics(
    fishX: number, fishY: number,
    baseR: number, scale: number,
  ): FishMetrics {
    const scaledR = baseR * scale;
    return {
      fishX, fishY, baseR, scale, scaledR,
      leftNostrilX:  fishX + (-baseR * 0.14) * scale,
      rightNostrilX: fishX + ( baseR * 0.14) * scale,
      nostrilY:      fishY + (-baseR * 0.52) * scale,
      mouthCX:       fishX,
      mouthCY:       fishY + (-baseR * 0.38) * scale,
      mouthR:        baseR * 0.19 * scale,
    };
  }

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
  // Phase-aware comet particles:
  //   • INHALE: spawn outside body, velocity directed TOWARD the NEAREST
  //             NOSTRIL (Nose_Open dot at ±0.14*baseR, NOSE_Y = -0.52*baseR).
  //             Particles on the left of the fish flow to the left nostril
  //             and vice versa, picked by Euclidean distance. Speed/decay
  //             are tuned so the head physically reaches the nostril at
  //             end-of-life.
  //   • EXHALE: spawn AT a uniform random point inside the mouth sprite
  //             disc (Mouth_Circle at -0.38*baseR, radius 0.19*baseR).
  //             Velocity is RADIAL OUTWARD from the mouth center with a
  //             small downward bias, so puffs radiate out of the mouth.
  //             drawParticles runs AFTER fish.render so streaks stay in
  //             front of the body.
  //   • HOLD/IDLE: no new particles spawn; existing ones finish their motion.
  private spawnInhaleParticle(
    fishX: number,
    fishY: number,
    leftNostrilX: number,
    rightNostrilX: number,
    nostrilY: number,
    r: number,
  ): void {
    const angle = Math.random() * Math.PI * 2;
    const dist  = r * (1.25 + Math.random() * 0.55);
    const x = fishX + Math.cos(angle) * dist;
    const y = fishY + Math.sin(angle) * dist;
    // Pick the NEAREST nostril by Euclidean distance — particles spawned
    // anywhere around the fish flow to whichever nostril is closer.
    const dLx = x - leftNostrilX,  dLy = y - nostrilY;
    const dRx = x - rightNostrilX, dRy = y - nostrilY;
    const distL2 = dLx * dLx + dLy * dLy;
    const distR2 = dRx * dRx + dRy * dRy;
    const targetX = distL2 < distR2 ? leftNostrilX : rightNostrilX;
    const targetY = nostrilY;
    const dx = targetX - x;
    const dy = targetY - y;
    const norm = Math.hypot(dx, dy) || 1;
    // The particle MUST physically arrive at the nostril before dying.
    // Pick a random lifetime; set speed = distance / lifetime and decay =
    // 1 / lifetime so the head reaches the target at exactly the moment its
    // life hits 0. (Position at t=lifetime = spawn + velocity * lifetime
    // = spawn + (target - spawn) = target.)
    const lifetimeSec = 0.55 + Math.random() * 0.30;   // 0.55..0.85s
    const speed = norm / lifetimeSec;
    const decay = 1 / lifetimeSec;
    this.particles.push({
      x, y,
      vx: (dx / norm) * speed,
      vy: (dy / norm) * speed,
      life: 1,
      decay,
      // Reference p_008 shows comet trails: a small bright head and a LONG
      // thicker fading tail (like shooting stars). `size` here is the HEAD dot
      // radius. The long tail is drawn in drawParticles using a gradient line
      // aligned with velocity.
      size: 2.6 + Math.random() * 0.8,
      isLine: false,
      angle: 0,
      kind: 'inhale',
      spawnX: x, spawnY: y,
      targetX, targetY,
      spawnLeftNoseX:  leftNostrilX,
      spawnRightNoseX: rightNostrilX,
      spawnNoseY:      nostrilY,
    });
  }

  // Exhale particles spawn at a random point WITHIN the mouth sprite disc
  // (Mouth_Circle, drawn at BIG_NOSE_Y = -0.38*baseR with width hr*0.38, so
  // radius = 0.19*baseR). Velocity is RADIAL OUTWARD from the mouth center
  // with a small downward bias.
  private spawnExhaleParticle(
    mouthCX: number,
    mouthCY: number,
    mouthR: number,
  ): void {
    // Uniform point in disc: sqrt(uniform) gives even areal density.
    const ang0 = Math.random() * Math.PI * 2;
    const rad0 = Math.sqrt(Math.random()) * mouthR;
    const sx = mouthCX + Math.cos(ang0) * rad0;
    const sy = mouthCY + Math.sin(ang0) * rad0;
    // Velocity = radial outward from mouth center, biased downward so the
    // overall flow still reads as "exhaling toward the floor". If the spawn
    // landed exactly at the center, pick a random outward angle.
    let dirX: number, dirY: number;
    if (rad0 < 1e-3) {
      const a = Math.random() * Math.PI * 2;
      dirX = Math.cos(a);
      dirY = Math.sin(a);
    } else {
      const norm = Math.hypot(sx - mouthCX, sy - mouthCY) || 1;
      dirX = (sx - mouthCX) / norm;
      dirY = (sy - mouthCY) / norm;
    }
    // Add a small downward bias to the radial direction. Re-normalize.
    dirY += 0.35;
    const n2 = Math.hypot(dirX, dirY) || 1;
    dirX /= n2; dirY /= n2;
    const speed = 140 + Math.random() * 80;
    this.particles.push({
      x: sx, y: sy,
      vx: dirX * speed,
      vy: dirY * speed,
      life: 1,
      decay: 0.9 + Math.random() * 0.3,
      // Comet trail — small bright head, long fading tail drawn in
      // drawParticles. `size` is the HEAD dot radius only.
      size: 2.2 + Math.random() * 0.7,
      isLine: false,
      angle: 0,
      kind: 'exhale',
      spawnX: sx, spawnY: sy,
      spawnMouthCX: mouthCX,
      spawnMouthCY: mouthCY,
      spawnMouthR:  mouthR,
    });
  }

  private updateParticles(
    dt: number,
    phase: BreathPhase,
    fishX: number,
    fishY: number,
    leftNostrilX: number,
    rightNostrilX: number,
    nostrilY: number,
    mouthCX: number,
    mouthCY: number,
    mouthR: number,
    r: number,
  ): void {
    if (phase === 'inhale') {
      // Inhale particles converge ON the nostrils (Nose_Open dots), high on
      // the face. Each particle targets the CLOSEST nostril by Euclidean
      // distance — particles on the left half flow to the left nostril and
      // vice versa, but the choice is by true distance, not just side.
      if (Math.random() < dt * 25) {
        this.spawnInhaleParticle(fishX, fishY, leftNostrilX, rightNostrilX, nostrilY, r);
      }
    } else if (phase === 'exhale') {
      // Spawn WITHIN the mouth sprite disc (Mouth_Circle at -0.38*baseR with
      // radius hr*0.19). Velocity radiates OUTWARD from the mouth center
      // with a slight downward bias.
      if (Math.random() < dt * 18) this.spawnExhaleParticle(mouthCX, mouthCY, mouthR);
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
    // Reference p_008 (Breathe In) shows COMET TRAILS: a small bright head
    // followed by a LONG fading tail (like shooting stars). Each particle
    // renders as a gradient stroke head→tail plus a small bright dot at
    // the head.
    const trailLen = 0.35;
    for (const p of this.particles) {
      const a = Math.max(0, Math.min(1, p.life));
      const speed = Math.hypot(p.vx, p.vy);
      if (speed < 1) continue;

      // Tail end = position - velocity * trailLen. The tail is BEHIND the
      // particle (opposite of motion direction). For inhale this points
      // outward toward where the particle spawned; for exhale this points
      // back toward the nose.
      const tailX = p.x - p.vx * trailLen;
      const tailY = p.y - p.vy * trailLen;

      ctx.save();

      // Gradient stroke from bright head → transparent tail end. Head alpha
      // bumped to 0.95 so the leading edge of each trail reads brightly against
      // the dark sky. Line width bumped from 2.5 → 4.5 to match the visibly
      // THICK trails in reference p_008 (no longer hairline-thin).
      const grad = ctx.createLinearGradient(p.x, p.y, tailX, tailY);
      grad.addColorStop(0,    `rgba(216, 244, 255, ${a * 0.95})`);
      grad.addColorStop(0.25, `rgba(216, 244, 255, ${a * 0.55})`);
      grad.addColorStop(1,    `rgba(216, 244, 255, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();

      // Bright dot at the head for the particle itself.
      ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.95})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
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

    // PufferFish renderer uses phaseT for sub-phase asset swaps during inhale.
    const phaseT = this.breathProgress;

    const eased = easeInOutSine(this.breathProgress);
    const scale = SCALE_MIN + eased * (SCALE_MAX - SCALE_MIN);

    // baseR is the silhouette radius unit. With a single ellipse silhouette
    // (sx=1.05*baseR, sy=1.02*baseR, bottom slightly fuller), the silhouette
    // is ~2.10*baseR wide and ~2.04*baseR tall before scale. At scale=1.22
    // that's ~2.56*baseR wide and ~2.49*baseR tall. Reference frames show
    // the fish filling ~85-87% of viewport width at peak inflation.
    //   On 540×960:  baseR = 540 * 0.34 ≈ 184 → full-width@1.22 ≈ 470px
    //   (~87% of 540), full-height@1.22 ≈ 448px. Centred at H*0.48.
    const r     = Math.min(W, H) * 0.34;
    const fishX = W / 2;
    const fishY = H * 0.48;

    // Background paints the gradient sky and a soft localized halo behind
    // the fish. The PufferFish sprite layer also draws Glow.png directly,
    // so the two layers together produce the bloom.
    this.drawBackground(ctx, W, H, fishX, fishY, r * scale);
    // Cache metrics so getFishMetrics() can return the same numbers we use
    // for spawning. This is read by Playwright tests to verify behavior.
    this._metrics = this.computeMetrics(fishX, fishY, r, scale);
    const m = this._metrics;
    this.updateParticles(
      dt, phase,
      fishX, fishY,
      m.leftNostrilX, m.rightNostrilX, m.nostrilY,
      m.mouthCX, m.mouthCY, m.mouthR,
      r * scale,
    );
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
