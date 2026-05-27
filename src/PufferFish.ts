// PufferFish — Canvas 2D sprite compositor matching the Unity Pufferfish
// prefab at MightierApp/Assets/Hub/InteractiveSkills/Pufferfish/.
//
// Body shape comes from Body.png (the actual Unity silhouette); the dark
// belly band comes from Belly_Base.png clipped to the body via an offscreen
// composite mask; Gradient_1.png paints the belly highlight. All face/wing/
// spike sprites are pre-tinted PNGs blitted with drawImage.
//
// Sort order (back → front) mirrors the Unity SpriteRenderer m_SortingOrder
// values from the prefab:
//   46-47  ambient meter art (not rendered here)
//   48     Glow halo, Wings
//   49     Spikes
//   50     Body silhouette (Body.png)
//   51     Belly_Base — clipped to body
//   52     Belly_Dots, Gradient_1 — clipped to body
//   53     Face features (Eyes, Nose, Mouth)
//
// Phase-driven face swaps:
//   inhale  → Eyes_Relax + Nose_Open    + Mouth_Closed
//   hold    → Eyes_Closed + Nose_Closed + Mouth_Closed (squinty)
//   exhale  → Eyes_Relax  + Nose_Closed + Mouth_Circle (big O)
//
// Inflation drives a separate `progress` (0..1) parameter so the renderer
// can animate face Y position, face scale, mouth scale, belly position,
// belly scale, and spike scale to mirror the Puffer_BreatheIn keyframes.

import {
  FACE_Y_IDLE_FRAC, FACE_Y_PEAK_FRAC,
  FACE_SCALE_IDLE,  FACE_SCALE_PEAK,
  EYES_LOCAL_Y_FRAC, NOSE_LOCAL_Y_FRAC, MOUTH_LOCAL_Y_FRAC,
  MOUTH_CLOSED_WIDTH_IDLE, MOUTH_CLOSED_WIDTH_PEAK,
  MOUTH_CIRCLE_WIDTH_IDLE, MOUTH_CIRCLE_WIDTH_PEAK,
  EYES_RELAX_WIDTH, EYES_CLOSED_WIDTH,
  NOSE_OPEN_WIDTH,  NOSE_CLOSED_WIDTH,
  BELLY_Y_IDLE_FRAC, BELLY_Y_PEAK_FRAC,
  BELLY_SCALE_IDLE,  BELLY_SCALE_PEAK,
  BELLY_DOTS_WIDTH,
  SPIKE_COUNT, SPIKE_RADIAL_FRAC,
  SPIKE_SIZE_BASE_FRAC, SPIKE_SCALE_IDLE, SPIKE_SCALE_PEAK,
  WING_FLAP_HZ, WING_FLAP_DEG,
  WING_WIDTH_FRAC, WING_HEIGHT_FRAC,
  WING_ANCHOR_X_FRAC, WING_ANCHOR_Y_FRAC,
  GLOW_WIDTH_FRAC,
  BODY_WIDTH_FRAC, BELLY_WIDTH_FRAC, GRADIENT_WIDTH_FRAC,
  COLOR_BODY, COLOR_BELLY_BASE, COLOR_BELLY_DOTS, COLOR_GRADIENT,
  COLOR_SPIKE, COLOR_GLOW, COLOR_FACE, COLOR_WING,
} from './FishGeometry';

export type BreathPhase = 'inhale' | 'hold' | 'exhale';

// Face-feature alpha — the tinted PNGs are bold strokes; 0.85 reads as a
// shaded feature rather than ink stamped on the body.
const FACE_ALPHA = 0.85;

interface Img { el: HTMLImageElement; tinted: HTMLCanvasElement }

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class PufferFish {
  private imgs: Record<string, Img> = {};
  private ready = false;
  // Reusable offscreen canvas for masking belly art to the body silhouette.
  // Sized lazily to the largest render request we've seen.
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;

  constructor(private base: string) {}

  async load(): Promise<void> {
    const defs: [string, string][] = [
      ['Body',         COLOR_BODY        ],
      ['Belly_Base',   COLOR_BELLY_BASE  ],
      ['Belly_Dots',   COLOR_BELLY_DOTS  ],
      ['Gradient_1',   COLOR_GRADIENT    ],
      ['Wing_R',       COLOR_WING        ],
      ['Eyes_Relax',   COLOR_FACE        ],
      ['Eyes_Closed',  COLOR_FACE        ],
      ['Eyes_1',       COLOR_FACE        ],
      ['Nose_Open',    COLOR_FACE        ],
      ['Nose_Closed',  COLOR_FACE        ],
      ['Mouth_Circle', COLOR_FACE        ],
      ['Mouth_Closed', COLOR_FACE        ],
      ['Glow',         COLOR_GLOW        ],
      ['Spike1',       COLOR_SPIKE       ],
    ];
    const failures: string[] = [];
    await Promise.all(defs.map(([n]) => this.loadOne(n, failures)));
    if (failures.length > 0) {
      console.error(`PufferFish: failed to load ${failures.length} asset(s): ${failures.join(', ')}`);
    }
    for (const [n, c] of defs) this.makeTinted(n, c);
    this.ready = true;
  }

  private loadOne(name: string, failures: string[]): Promise<void> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { this.imgs[name] = { el: img, tinted: null! }; resolve(); };
      img.onerror = () => { failures.push(`${name}.png`); resolve(); };
      img.src = `${this.base}${name}.png`;
    });
  }

  private makeTinted(name: string, color: string): void {
    const src = this.imgs[name]?.el;
    if (!src) return;
    const w = src.naturalWidth  || 64;
    const h = src.naturalHeight || 64;
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const cx = oc.getContext('2d')!;
    cx.drawImage(src, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, w, h);
    this.imgs[name].tinted = oc;
  }

  // Draw a tinted sprite centered at (dx,dy), scaled to `targetW` preserving
  // aspect ratio. Alpha applied via globalAlpha when not 1.
  private blit(
    ctx: CanvasRenderingContext2D,
    name: string,
    targetW: number,
    dx = 0, dy = 0,
    alpha = 1,
  ): void {
    const img = this.imgs[name]?.tinted;
    if (!img) return;
    const aspect = img.height / img.width;
    const w = targetW;
    const h = targetW * aspect;
    if (alpha !== 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, dx - w / 2, dy - h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, dx - w / 2, dy - h / 2, w, h);
    }
  }

  // Ensure the offscreen mask canvas can hold a render of `side` px square.
  private ensureMaskCanvas(side: number): CanvasRenderingContext2D {
    const needed = Math.ceil(side);
    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskCanvas.width  = needed;
      this.maskCanvas.height = needed;
      this.maskCtx = this.maskCanvas.getContext('2d')!;
    } else if (this.maskCanvas.width < needed || this.maskCanvas.height < needed) {
      this.maskCanvas.width  = needed;
      this.maskCanvas.height = needed;
      this.maskCtx = this.maskCanvas.getContext('2d')!;
    }
    return this.maskCtx!;
  }

  // cx/cy:   fish center in screen space.
  // baseR:   body radius unit at scale=1.
  // scale:   current PufferFish.localScale (animates SCALE_MIN..SCALE_MAX).
  // progress: 0 (idle/exhaled) .. 1 (peak inhaled) — drives face Y, face
  //           scale, mouth scale, belly position/scale, spike size.
  // phase:   'inhale' | 'hold' | 'exhale' — selects face sprite set.
  render(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    baseR: number,
    scale: number,
    progress: number,
    phase: BreathPhase,
  ): void {
    if (!this.ready) return;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // ── 1. Glow halo (sort order 48, screen blend) ─────────────────────────
    const glowW = baseR * GLOW_WIDTH_FRAC;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    this.blit(ctx, 'Glow', glowW, 0, 0, 0.22);
    ctx.restore();

    // ── 2. Wings (sort 48) — behind body, anchored at body edge ────────────
    // Unity Wing_R/Wing_L localEulerAngles.z oscillates 0 ↔ -21.6° at ~3 Hz.
    // Wing_L is the mirror; its sign is flipped so both wings rise/fall
    // together rather than in alternating lockstep.
    const flapAngle = Math.sin(performance.now() / 1000 * WING_FLAP_HZ * Math.PI * 2)
                    * (WING_FLAP_DEG * Math.PI / 180);
    const wingW = baseR * WING_WIDTH_FRAC;
    const wingH = baseR * WING_HEIGHT_FRAC;
    const wingAnchorX = baseR * WING_ANCHOR_X_FRAC;
    const wingAnchorY = baseR * WING_ANCHOR_Y_FRAC;
    const wImg = this.imgs['Wing_R']?.tinted;
    if (wImg) {
      // Right wing — sprite anchored so the inner edge tucks behind the body.
      ctx.save();
      ctx.translate(wingAnchorX, wingAnchorY);
      ctx.rotate(flapAngle);
      ctx.drawImage(wImg, -wingW * 0.30, -wingH / 2, wingW, wingH);
      ctx.restore();

      // Left wing — mirrored.
      ctx.save();
      ctx.translate(-wingAnchorX, wingAnchorY);
      ctx.scale(-1, 1);
      ctx.rotate(flapAngle);
      ctx.drawImage(wImg, -wingW * 0.30, -wingH / 2, wingW, wingH);
      ctx.restore();
    }

    // ── 3. Spikes (sort 49) — behind body, 9 around the silhouette ─────────
    // Unity has 9 spike instances at irregular angles ~0.95 * body radius
    // from center. Their local scales shrink slightly as the body inflates,
    // so we interpolate a size multiplier from SPIKE_SCALE_IDLE → PEAK.
    // Approximate Unity's 9 angles using their measured positions (atan2).
    const spikeAngles = [
       0.011,   // Spike_1 (5) right
       0.853,   // Spike_1     upper right
       1.353,   // Spike_1 (1) top right
       1.861,   // Spike_1 (2) top left
       2.359,   // Spike_1 (3) upper left
       3.135,   // Spike_1 (4) left
       3.916,   // Spike_1 (6) lower left
       4.530,   // Spike_1 (7) bottom
       5.236,   // Spike_1 (8) lower right
    ];
    const spikeScale = lerp(SPIKE_SCALE_IDLE, SPIKE_SCALE_PEAK, progress);
    const spikeSize  = baseR * SPIKE_SIZE_BASE_FRAC * spikeScale;
    const spImg = this.imgs['Spike1']?.tinted;
    if (spImg) {
      const w = spikeSize;
      const h = spikeSize * (spImg.height / spImg.width);
      const r = baseR * SPIKE_RADIAL_FRAC;
      for (let i = 0; i < SPIKE_COUNT && i < spikeAngles.length; i++) {
        // Unity angle uses +x right, +y up. Canvas +y down → flip y component.
        const theta = spikeAngles[i];
        const dx = Math.cos(theta);
        const dy = -Math.sin(theta);
        const px = dx * r;
        const py = dy * r;
        // Sprite points UP by default; rotate outward radial.
        const angle = Math.atan2(dy, dx) + Math.PI / 2;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.drawImage(spImg, -w / 2, -h * 0.85, w, h);
        ctx.restore();
      }
    }

    // ── 4. Body silhouette (sort 50) — Body.png drives the actual shape ────
    const bodyImg = this.imgs['Body']?.tinted;
    const bodyW   = baseR * BODY_WIDTH_FRAC;
    if (bodyImg) {
      const aspect = bodyImg.height / bodyImg.width;
      const bH = bodyW * aspect;
      ctx.drawImage(bodyImg, -bodyW / 2, -bH / 2, bodyW, bH);
    }

    // ── 5-6. Belly + dots + gradient (sort 51-52) — clipped to Body shape ──
    // The Unity prefab uses a SpriteMask on Body so the belly art (sorts 51,
    // 52) only shows inside the body silhouette. We replicate that by
    // compositing belly art on an offscreen canvas with the body alpha as a
    // destination-in mask, then drawing the result onto the main canvas.
    if (bodyImg) {
      const bAspect = bodyImg.height / bodyImg.width;
      const bH = bodyW * bAspect;
      const side = Math.max(bodyW, bH);
      const mctx = this.ensureMaskCanvas(side);
      mctx.save();
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, this.maskCanvas!.width, this.maskCanvas!.height);
      // Move origin to centre of the working square.
      mctx.translate(side / 2, side / 2);

      // a. Belly_Base — sort 51. Position animates -2.89 → -2.15 (Body-local),
      //    scale 0.94 → 1.0.
      const bellyY     = baseR * lerp(BELLY_Y_IDLE_FRAC, BELLY_Y_PEAK_FRAC, progress);
      const bellyScale = lerp(BELLY_SCALE_IDLE, BELLY_SCALE_PEAK, progress);
      const bellyImg   = this.imgs['Belly_Base']?.tinted;
      if (bellyImg) {
        const baAspect = bellyImg.height / bellyImg.width;
        const baW = baseR * BELLY_WIDTH_FRAC * bellyScale;
        const baH = baW * baAspect;
        mctx.drawImage(bellyImg, -baW / 2, bellyY - baH / 2, baW, baH);
      }

      // b. Gradient_1 — sort 52. Belly highlight, tinted cyan.
      const gradImg = this.imgs['Gradient_1']?.tinted;
      if (gradImg) {
        const gAspect = gradImg.height / gradImg.width;
        const gW = baseR * GRADIENT_WIDTH_FRAC * bellyScale;
        const gH = gW * gAspect;
        // Unity Gradient_1 sits at y=-1.39 in Belly-local = -0.139 in
        // PufferFish-local at scale 1.0, with x-scale 1.6 (the gradient is
        // stretched horizontally). Composes with the belly position.
        mctx.save();
        mctx.scale(1.6, 1.0);
        mctx.drawImage(gradImg, -gW / 2, bellyY - 0.139 * baseR - gH / 2, gW, gH);
        mctx.restore();
      }

      // c. Belly_Dots — sort 52. Bright cyan dots scattered across the belly.
      // Unity Belly_Dots local position (0, 2.13) is INSIDE Belly (which is
      // inside Body sprite at Body's 0.1 scale), so the dots end up near the
      // PufferFish-local origin: dots_y = 0.1 * (belly_scale * 2.13 + (-2.15))
      // = 0.1 * (belly_scale * 2.13 - 2.15). At peak that's -0.002 (≈centre);
      // at idle ~-0.015. In canvas (Y down) as a fraction of baseR (0.398):
      // tiny positive offset, so dots sit just below the body centre.
      // Drawn with 'lighter' so the bright cyan dots pop against the dark
      // belly base — at plain source-over they read as muddy and faint.
      const dotsImg = this.imgs['Belly_Dots']?.tinted;
      if (dotsImg) {
        const dAspect = dotsImg.height / dotsImg.width;
        const dW = baseR * BELLY_DOTS_WIDTH * bellyScale;
        const dH = dW * dAspect;
        const dotsUnityY = bellyScale * 2.13 - 2.15;  // PufferFish-local Unity y
        const dotsCY = baseR * (-dotsUnityY / 0.398); // canvas Y down
        mctx.save();
        mctx.globalCompositeOperation = 'lighter';
        mctx.drawImage(dotsImg, -dW / 2, dotsCY - dH / 2, dW, dH);
        mctx.restore();
      }

      // d. Clip everything to the body alpha (sprite mask).
      mctx.globalCompositeOperation = 'destination-in';
      mctx.drawImage(bodyImg, -bodyW / 2, -bH / 2, bodyW, bH);
      mctx.restore();

      // Draw the composited belly back onto the main canvas at centre.
      ctx.drawImage(this.maskCanvas!, -side / 2, -side / 2);
    }

    // ── 7. Face features (sort 53) ─────────────────────────────────────────
    // Face transform animates: position y -0.558 → -0.671 (baseR fractions),
    // scale 1.22 → 1.0. Eyes/Nose/Mouth are children with sub-offsets.
    const faceY     = baseR * lerp(FACE_Y_IDLE_FRAC, FACE_Y_PEAK_FRAC, progress);
    const faceScale = lerp(FACE_SCALE_IDLE, FACE_SCALE_PEAK, progress);

    const eyesY     = faceY + baseR * EYES_LOCAL_Y_FRAC  * faceScale;
    const noseY     = faceY + baseR * NOSE_LOCAL_Y_FRAC  * faceScale;
    const mouthY    = faceY + baseR * MOUTH_LOCAL_Y_FRAC * faceScale;

    if (phase === 'inhale') {
      // Reference Unity Puffer_BreatheIn: Eyes_Relax + Nose_Open + Mouth_Closed.
      // Mouth_Closed scale animates with progress (matches Unity Mouth scale curve).
      const mouthW = baseR * lerp(MOUTH_CLOSED_WIDTH_IDLE, MOUTH_CLOSED_WIDTH_PEAK, progress) * faceScale;
      this.blit(ctx, 'Eyes_Relax',   baseR * EYES_RELAX_WIDTH  * faceScale, 0, eyesY,  FACE_ALPHA);
      this.blit(ctx, 'Nose_Open',    baseR * NOSE_OPEN_WIDTH   * faceScale, 0, noseY,  FACE_ALPHA);
      this.blit(ctx, 'Mouth_Closed', mouthW,                                  0, mouthY, FACE_ALPHA);
    } else if (phase === 'hold') {
      // Squinty hold pose — both Eyes_Closed and Nose_Closed at the eye row
      // produce a merged set of 4 angled marks.
      const mouthW = baseR * MOUTH_CLOSED_WIDTH_PEAK * faceScale;
      this.blit(ctx, 'Eyes_Closed',  baseR * EYES_CLOSED_WIDTH * faceScale, 0, eyesY,  FACE_ALPHA);
      this.blit(ctx, 'Nose_Closed',  baseR * NOSE_CLOSED_WIDTH * faceScale, 0, noseY,  FACE_ALPHA);
      this.blit(ctx, 'Mouth_Closed', mouthW,                                  0, mouthY, FACE_ALPHA);
    } else {
      // exhale — Eyes_Relax + Nose_Closed + Mouth_Circle. Per Unity
      // Puffer_BreatheOut pptrCurveMapping, Eyes stays Eyes_Relax, Nose
      // becomes Nose_Closed, Mouth becomes Mouth_Circle (the big O).
      const circleW = baseR * lerp(MOUTH_CIRCLE_WIDTH_IDLE, MOUTH_CIRCLE_WIDTH_PEAK, progress) * faceScale;
      this.blit(ctx, 'Eyes_Relax',   baseR * EYES_RELAX_WIDTH  * faceScale, 0, eyesY,  FACE_ALPHA);
      this.blit(ctx, 'Nose_Closed',  baseR * NOSE_CLOSED_WIDTH * faceScale, 0, noseY,  FACE_ALPHA);
      this.blit(ctx, 'Mouth_Circle', circleW,                                 0, mouthY, FACE_ALPHA);
    }

    ctx.restore();
  }
}
