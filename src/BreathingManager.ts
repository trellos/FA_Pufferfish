// BreathingManager — screen flow, timing, rAF loop, particles, UI.
// URL params: ?cycle=8 (seconds per full breath cycle) ?duration=60 (session length)

import { PufferFish, BreathPhase } from './PufferFish';

type Screen = 'start' | 'breathing';

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
  life: number;       // 0–1
  decay: number;      // per second
  size: number;
  isLine: boolean;
  angle: number;
  kind: 'inhale' | 'exhale';
}

export class BreathingManager {
  private ctx: CanvasRenderingContext2D;
  private fish: PufferFish;
  private screen: Screen = 'start';
  private cycleSecs: number;
  private sessionSecs: number;
  sessionStart = 0;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private particles: Particle[] = [];
  private idleT = 0;

  getScreen(): Screen { return this.screen; }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx  = canvas.getContext('2d')!;
    this.fish = new PufferFish('/assets/');
    this.cycleSecs   = urlNum('cycle',    8);
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
    this.screen       = 'breathing';
    this.sessionStart = performance.now();
    this.particles    = [];
  }

  // ── Particle system ────────────────────────────────────────────────────────
  // Phase-aware comet particles:
  //   • INHALE: spawn outside body, velocity directed TOWARD the mouth.
  //             Tail (motion blur) points away from mouth (toward origin).
  //   • EXHALE: spawn at mouth, velocity outward in a downward fan (±50° cone
  //             around +Y). Tail points back to mouth.
  //   • HOLD:   no new particles spawn; existing ones finish their motion.

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
    // Downward fan: ±50° from straight down (+Y). 90° = straight down in canvas.
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
    // 'hold' — no spawn, existing particles continue moving.

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
    // Trail length in seconds of motion. Longer = more visible comet streak.
    const trailLen = 0.14;
    for (const p of this.particles) {
      const tailX = p.x - p.vx * trailLen;
      const tailY = p.y - p.vy * trailLen;
      const a = Math.max(0, Math.min(1, p.life));

      // Exhale particles cross the cyan body — need bright white core.
      // Inhale particles cross the dark blue background — bright cyan works.
      const headColor   = p.kind === 'exhale' ? '#FFFFFF' : '#FFFFFF';
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

      // Bright head dot
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
    // Reference frame_015 sampled (1080×1920):
    //   top edge:    rgb(25,63,126)  ≈ #193F7E
    //   bottom edge: rgb(58,123,224) ≈ #3A7BE0
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#193F7E');
    bg.addColorStop(1, '#3A7BE0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (glowX !== undefined && glowY !== undefined && glowR !== undefined) {
      // Soft halo localized to fish edge — uses lighter blend mode to avoid
      // washing out the body's dark belt color (the screen blend at high alpha
      // was making rgb(21,159,221) appear as rgb(21,249,255)).
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
        this.screen = 'start';
        this.idleT  = 0;
        this.particles = [];
        this.drawStart(0);
        return;
      }
      this.drawBreathing(elapsed, dt);
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

    // Title
    const titleSz = Math.min(W * 0.115, 52);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#FFFFFF';
    ctx.font         = `${titleSz}px system-ui, -apple-system, sans-serif`;
    ctx.fillText('Breathe', W / 2, H * 0.74);

    // Subtitle
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

  private drawBreathing(elapsed: number, dt: number): void {
    const { ctx, cssW: W, cssH: H } = this;

    const cycleT     = (elapsed % this.cycleSecs) / this.cycleSecs;
    const INHALE_END = 0.40;   // 40 % inhale
    const HOLD_END   = 0.50;   // 10 % hold, 50 % exhale

    let phase: BreathPhase;
    let phaseT: number;
    let scale: number;

    if (cycleT < INHALE_END) {
      phase  = 'inhale';
      phaseT = cycleT / INHALE_END;
      scale  = 0.78 + easeInOutSine(phaseT) * 0.44;
    } else if (cycleT < HOLD_END) {
      phase  = 'hold';
      phaseT = (cycleT - INHALE_END) / (HOLD_END - INHALE_END);
      scale  = 1.22;
    } else {
      phase  = 'exhale';
      phaseT = (cycleT - HOLD_END) / (1 - HOLD_END);
      scale  = 1.22 - easeInOutSine(phaseT) * 0.44;
    }

    // Match reference: baseR ≈ 0.43 of min dim, fishY ≈ H*0.50 (verified by
     // measuring frame_015.jpg — fish radius=611 at scale=1.22 → baseR≈500=0.46*min(W,H),
     // center y=962 = 0.50*H). Use 0.43 for slightly more breathing room on portrait.
    const r     = Math.min(W, H) * 0.46;
    const fishX = W / 2;
    const fishY = H * 0.50;

    this.drawBackground(ctx, W, H, fishX, fishY, r * scale);
    // Mouth position in screen space — matches PufferFish.render's MOUTH_Y = -r*0.61
    // applied in the (cx,cy)+scale transform.
    const mouthY = fishY + (-r * 0.61) * scale;
    this.updateParticles(dt, phase, fishX, mouthY, r * scale);
    this.fish.render(ctx, fishX, fishY, r, scale, phase, phaseT);
    // Particles drawn ON TOP of the fish so exhale streaks crossing the body
    // remain visible (matches reference frame_020).
    this.drawParticles(ctx);

    // Label: full alpha during inhale/hold; fades out in second half of exhale
    const label = phase === 'inhale' ? 'Breathe In'
                : phase === 'hold'   ? 'Hold'
                : 'Breathe Out';
    const textAlpha = phase !== 'exhale'  ? 1.0
                    : phaseT < 0.5        ? 1.0
                    : Math.max(0, 1.0 - (phaseT - 0.5) * 2.5);

    const lblSz = Math.min(W * 0.115, 52);
    ctx.save();
    ctx.globalAlpha  = textAlpha;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#FFFFFF';
    ctx.font         = `300 ${lblSz}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(label, W / 2, H * 0.08);
    ctx.restore();

    const progress = 1 - elapsed / this.sessionSecs;
    this.drawTimerBar(W / 2, H * 0.93, W * 0.55, 22, progress);
  }

  private drawTimerBar(cx: number, cy: number, width: number, h: number, progress: number): void {
    const { ctx } = this;
    const rx = h / 2;
    const x  = cx - width / 2;
    const y  = cy - h / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(10,20,60,0.7)';
    this.rrect(ctx, x, y, width, h, rx);
    ctx.fill();

    const fillW = Math.max(width * progress, h);
    ctx.fillStyle = '#00DDFF';
    this.rrect(ctx, x, y, fillW, h, rx);
    ctx.fill();

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

  // ── Hit testing ────────────────────────────────────────────────────────────

  handleClick(x: number, y: number): void {
    if (this.screen !== 'start') return;
    const bx = this.cssW / 2;
    const by = this.cssH * 0.90;
    const br = Math.min(this.cssW * 0.115, 52);
    if (Math.hypot(x - bx, y - by) <= br * 1.3) {
      this.startBreathing();
    }
  }
}
