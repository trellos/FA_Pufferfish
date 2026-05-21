// PufferFish — Canvas 2D renderer using sprite layers.
// Layer order (back to front): Spikes(×10) → Wings → Body(bright cyan) → Dark Belly Overlay → Belly_Dots → Face
// Phases (verified by reference frame inspection):
//   inhale (early)                → furrowed brows + Eyes_1     + Nose_Closed + Mouth_Closed
//   inhale (late, scale ≥ 1.05)   → Eyes_Relax    + Nose_Open   + Mouth_Closed
//   hold                          → Eyes_Relax    + Nose_Closed + Mouth_Closed   (peaceful, no brows)
//   exhale                        → Eyes_Relax    + Nose_Open   + Mouth_Circle + puff lines

export type BreathPhase = 'inhale' | 'hold' | 'exhale';

const TINT = {
  wing:     '#ffffff',
  dots:     '#80EEFF',
  eye:      '#0A2060',
  nose:     '#0A2060',
  mouth:    '#0A2060',
  glow:     '#00F0FF',
  // Gradient_1 sprite is currently unused; tint kept for asset loader consistency.
  belly:    '#159FDD',
} as const;

const SPIKE_COUNT = 10;

interface Img { el: HTMLImageElement; tinted: HTMLCanvasElement }

export class PufferFish {
  private imgs: Record<string, Img> = {};
  private ready = false;

  constructor(private base = '/assets/') {}

  async load(): Promise<void> {
    const defs: [string, string][] = [
      ['Wing_R',       TINT.wing     ],
      ['Belly_Dots',   TINT.dots     ],
      ['Eyes_1',       TINT.eye      ],
      ['Eyes_Relax',   TINT.eye      ],
      ['Eyes_Closed',  TINT.eye      ],
      ['Nose_Open',    TINT.nose     ],
      ['Nose_Closed',  TINT.nose     ],
      ['Mouth_Circle', TINT.mouth    ],
      ['Mouth_Closed', TINT.mouth    ],
      ['Glow',         TINT.glow     ],
      ['Gradient_1',   TINT.belly    ],
    ];
    await Promise.all([...defs.map(([n]) => n), 'Spike1'].map(n => this.loadOne(n)));
    for (const [n, c] of defs) this.makeTinted(n, c);
    // Reference spikes are uniform body-cyan rgb(57,232,251). Tint all 10
    // spike variants identically — no per-angle darkening.
    for (let i = 0; i < SPIKE_COUNT; i++) {
      this.makeTintedFrom('Spike1', `spike_${i}`, 'rgb(57,232,251)');
    }
    this.ready = true;
  }

  private loadOne(name: string): Promise<void> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { this.imgs[name] = { el: img, tinted: null! }; resolve(); };
      img.onerror = () => { console.warn(`Missing: ${name}.png`); resolve(); };
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

  // Creates a tinted copy of srcName stored under a different dstName key (for spike variants).
  private makeTintedFrom(srcName: string, dstName: string, color: string): void {
    const src = this.imgs[srcName]?.el;
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
    this.imgs[dstName] = { el: src, tinted: oc };
  }

  // Draw a striped wing fin. sx = +1 for right wing, -1 for left wing.
  // Reference shows a small scalloped fan at the body equator: white fan-shape
  // with ~3 thin dark parallel stripes inside, base attached at the body edge.
  private drawWing(ctx: CanvasRenderingContext2D, sx: number, r: number): void {
    const wW = r * 0.32;          // outward extent past body edge
    const wH = r * 0.28;          // vertical span
    // Position wing at upper-mid level (y=-0.50r) where the body silhouette is
    // narrower (~0.87 of equator width), so wings remain visible past the body
    // even at HOLD scale=1.22 where the equator overflows the canvas.
    // Body x-radius at y=-0.50r is sqrt(1-0.25)*r = 0.866r.
    const anchorY = -r * 0.50;
    const anchorX = sx * r * 0.866;

    ctx.save();
    ctx.translate(anchorX, anchorY);
    ctx.scale(sx, 1);

    // Fan shape — base on the inner side (x=0), curves out and around to tip at wW.
    // Build a leaf/scallop with a pointed tip.
    ctx.beginPath();
    ctx.moveTo(0, -wH * 0.40);                                             // inner upper
    ctx.quadraticCurveTo(wW * 0.55, -wH * 0.55, wW * 1.05, -wH * 0.05);   // arc to tip
    ctx.quadraticCurveTo(wW * 0.70,  wH * 0.25, wW * 0.20,  wH * 0.45);   // arc back to inner lower
    ctx.quadraticCurveTo(-wW * 0.05, wH * 0.10, 0,         -wH * 0.40);   // close along inner edge
    ctx.closePath();

    ctx.fillStyle   = '#E8F0FA';                  // bright off-white like reference
    ctx.strokeStyle = 'rgba(20,50,130,0.45)';
    ctx.lineWidth   = r * 0.012;
    ctx.fill();
    ctx.stroke();

    // Stripes — thin parallel dark lines that radiate from the inner base
    // toward the tip, giving the wing a "feathered" segmented look.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, -wH * 0.40);
    ctx.quadraticCurveTo(wW * 0.55, -wH * 0.55, wW * 1.05, -wH * 0.05);
    ctx.quadraticCurveTo(wW * 0.70,  wH * 0.25, wW * 0.20,  wH * 0.45);
    ctx.quadraticCurveTo(-wW * 0.05, wH * 0.10, 0,         -wH * 0.40);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = 'rgba(20,50,130,0.55)';
    ctx.lineWidth   = r * 0.014;
    ctx.lineCap     = 'round';
    const stripeOffsets = [-wH * 0.15, 0, wH * 0.15];
    for (const so of stripeOffsets) {
      ctx.beginPath();
      ctx.moveTo(wW * 0.05, so + wH * 0.15);
      ctx.quadraticCurveTo(wW * 0.50, so + wH * 0.02, wW * 0.95, so - wH * 0.08);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }

  // cx/cy: center. baseR: radius at scale=1. scale: 0.78–1.22. phaseT: 0–1 within current phase.
  render(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    baseR: number,
    scale: number,
    phase: BreathPhase,
    _phaseT = 0,
  ): void {
    if (!this.ready) return;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const r = baseR;

    // Glow.png is a solid circle — skip it; background radial handles the bloom.

    // ── Spikes (Spike1.png rotated ×10, behind body) ──────────────────────
    const spikeBodyR = r * 0.95;
    const spikeSize  = r * 0.22;
    for (let i = 0; i < SPIKE_COUNT; i++) {
      const angle = (i / SPIKE_COUNT) * Math.PI * 2 - Math.PI / 2;
      const img = this.imgs[`spike_${i}`];
      if (!img?.tinted) continue;
      ctx.save();
      ctx.rotate(angle);
      ctx.translate(0, -spikeBodyR);
      // Bottom edge of sprite at the body-surface; spike extends outward
      ctx.drawImage(img.tinted, -spikeSize / 2, -spikeSize, spikeSize, spikeSize);
      ctx.restore();
    }

    // ── Wings (striped feather-fins at equator) ──────────────────────────────
    // Drawn programmatically — reference shows white wings with 3–4 thin parallel
    // stripes separating "feather" segments. Sprite Wing_R.png is solid so we add
    // stripes by overdrawing dark thin lines.
    this.drawWing(ctx, +1, r);
    this.drawWing(ctx, -1, r);

    // ── Body: solid bright cyan crown ────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#39E8FB';  // crown rgb(57,232,251)
    ctx.fill();

    // ── Dark belly (large ellipse clipped to body circle) ────────────────────
    // Verified by pixel sampling frame_015.jpg (1080×1920, body radius=605 at scale=1.22):
    //   • Dark color rgb(21,159,221). Upper edge is a curve peaking at center y=-0.45r;
    //     it spreads to the body sides by y≈+0.18r (where dark spans full body width).
    //   • The dark belly extends past the bottom of the body and is clipped by the
    //     body circle — so the bottom of the dark region IS the body's lower arc.
    //   • Below the dark belly's bottom-most lighter brightening: a small bright
    //     cyan crescent rim at the very bottom of the body (where the gradient
    //     finishes brightening just inside the body circle).
    //   • Ellipse fit: center (0, +0.30r), rx≈1.05r, ry≈0.75r → top at -0.45r;
    //     spans full body width by y≈+0.20r.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    const bellyCY = r * 0.22;
    const bellyRX = r * 1.05;
    const bellyRY = r * 0.82;
    // Gradient — dark across most of belly, thin bright rim only at very bottom.
    // Reference belly is rgb(21,159,221) #159FDD across upper/middle and brightens
    // only in the last ~10% to produce the thin crescent rim at body bottom.
    const bg = ctx.createLinearGradient(0, bellyCY - bellyRY, 0, bellyCY + bellyRY);
    bg.addColorStop(0.00, '#159FDD');
    bg.addColorStop(0.55, '#159FDD');
    bg.addColorStop(0.78, '#19AEE3');
    bg.addColorStop(0.92, '#27D2EF');
    bg.addColorStop(1.00, '#39E8FB');
    ctx.fillStyle = bg;
    // Custom path: flatter top edge — control points pulled outward (wider)
    // so the top arc is gentler/flatter through the middle instead of pointed.
    ctx.beginPath();
    ctx.moveTo(-bellyRX, bellyCY);
    // Top: flatter curve — control points wider than the bounding rect to push
    // the top peak DOWN (flatter middle).
    ctx.bezierCurveTo(
      -bellyRX * 0.78,    bellyCY - bellyRY * 1.05,
       bellyRX * 0.78,    bellyCY - bellyRY * 1.05,
       bellyRX,           bellyCY,
    );
    // Bottom: standard ellipse-like curve
    ctx.bezierCurveTo(
       bellyRX,           bellyCY + bellyRY * 1.05,
      -bellyRX,           bellyCY + bellyRY * 1.05,
      -bellyRX,           bellyCY,
    );
    ctx.closePath();
    ctx.fill();

    // ── Belly dots (anchored within visible dark belly, fan pattern) ─────────
    // Reference frame_015: 4-row dot fan pattern within the dark belly,
    // located in the upper-middle of the dark belly. Dots are a slightly
    // lighter cyan than the dark belly proper.
    this.drawBellyDots(ctx, r, bellyCY);
    ctx.restore();

    // Face features. Reference frame_015 (1080×1920, body radius=605 @ scale=1.22):
    //   • Nose dots:   ±0.12r horizontal, y = -0.77r  (TOPMOST — above eyes)
    //   • Eye arcs:    ±0.39r horizontal, y = -0.68r  (middle)
    //   • Mouth dash:  centered,          y = -0.61r  (lowest, half-width ~0.12r)
    //   • Feature color: rgb(~10,128,196) ≈ #0B7FC4 (saturated dark teal,
    //     NOT navy — verified by sampling darkest face pixels in the reference)

    const NOSE_Y  = -r * 0.77;
    const EYE_Y   = -r * 0.68;
    const MOUTH_Y = -r * 0.61;
    const FACE_COLOR = '#0B7FC4';

    // ── Eyes ──────────────────────────────────────────────────────────────
    if (phase === 'inhale' && scale < 1.05) {
      // Early inhale: concentration face — furrowed brows + alert round-dot eyes.
      // Position brows above the eye arcs (push to eye row Y).
      ctx.save();
      ctx.strokeStyle = FACE_COLOR;
      ctx.lineWidth   = r * 0.030;
      ctx.lineCap     = 'round';
      ctx.beginPath(); ctx.moveTo(-r * 0.45, EYE_Y - r * 0.10); ctx.lineTo(-r * 0.30, EYE_Y - r * 0.07); ctx.stroke();
      ctx.beginPath(); ctx.moveTo( r * 0.30, EYE_Y - r * 0.07); ctx.lineTo( r * 0.45, EYE_Y - r * 0.10); ctx.stroke();
      // Round alert-dot eyes
      ctx.fillStyle = FACE_COLOR;
      ctx.beginPath(); ctx.arc(-r * 0.39, EYE_Y, r * 0.045, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( r * 0.39, EYE_Y, r * 0.045, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      // Hold / late inhale / exhale: draw closed-U eye arcs flanking the nose.
      // Reference shows thick ∪ arcs (opening upward = sleeping/smiling eyes).
      ctx.save();
      ctx.strokeStyle = FACE_COLOR;
      ctx.lineWidth   = r * 0.030;
      ctx.lineCap     = 'round';
      const eyeR  = r * 0.075;
      const eyeDX = r * 0.39;
      ctx.beginPath(); ctx.arc(-eyeDX, EYE_Y, eyeR, Math.PI, 0, true); ctx.stroke();
      ctx.beginPath(); ctx.arc( eyeDX, EYE_Y, eyeR, Math.PI, 0, true); ctx.stroke();
      ctx.restore();
    }

    // ── Nose: two small dark filled circles, centered, ABOVE eye row ──────
    if (phase === 'exhale' || (phase === 'inhale' && scale >= 1.05)) {
      // Open nose during exhale / late inhale — slightly larger ovals
      ctx.save();
      ctx.fillStyle = FACE_COLOR;
      const nDX = r * 0.12;
      const nRX = r * 0.045;
      const nRY = r * 0.052;
      ctx.beginPath(); ctx.ellipse(-nDX, NOSE_Y, nRX, nRY, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( nDX, NOSE_Y, nRX, nRY, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      // Closed nose: two small dark filled circles
      ctx.save();
      ctx.fillStyle = FACE_COLOR;
      const nDX = r * 0.12;
      const nR  = r * 0.042;
      ctx.beginPath(); ctx.arc(-nDX, NOSE_Y, nR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( nDX, NOSE_Y, nR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ── Mouth ─────────────────────────────────────────────────────────────
    if (phase === 'exhale') {
      // Small puckered "kiss" O-mouth — outlined ring (not solid dot) below
      // the nose row. Fill with a slightly darker cyan than body to give the
      // pursed-lip look from the reference.
      ctx.save();
      ctx.fillStyle = 'rgb(35,180,225)';
      ctx.strokeStyle = FACE_COLOR;
      ctx.lineWidth = r * 0.022;
      ctx.beginPath();
      ctx.arc(0, MOUTH_Y, r * 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // Particle puff is now handled by BreathingManager's particle system.
    } else {
      // Thin horizontal mouth dash — reference is ~0.24r wide, ~0.025r thick.
      ctx.save();
      ctx.strokeStyle = FACE_COLOR;
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 0.028;
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, MOUTH_Y);
      ctx.lineTo( r * 0.12, MOUTH_Y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // Draw the dot pattern matching reference frame_015.
  // Reference shows ~11 elongated teardrop-shaped dots arranged in 3 rows
  // (4 + 4 + 3) within the upper portion of the dark belly. Dots are larger
  // and more elliptical (vertical ovals) than perfect circles.
  private drawBellyDots(
    ctx: CanvasRenderingContext2D,
    r: number,
    _bellyCY: number,
  ): void {
    ctx.save();
    ctx.fillStyle = '#22EEF7';  // bright cyan dot color (~ rgb 34,238,247 from reference)
    // Hand-positioned dots matching the visible reference layout. Reference has
    // organic spacing — not strictly grid-aligned. Each entry: [xR, yR, rxR, ryR].
    // rx < ry to make them tall/oval teardrops like the reference.
    const dots: Array<[number, number, number, number]> = [
      // Top row (4 dots, widest spread) — smaller round dots
      [-0.36, -0.18, 0.045, 0.050],
      [-0.10, -0.22, 0.042, 0.048],
      [ 0.14, -0.21, 0.045, 0.052],
      [ 0.38, -0.18, 0.040, 0.045],
      // Middle row (4 dots, more teardrop-shaped, taller ovals)
      [-0.25,  0.00, 0.048, 0.072],
      [-0.02, -0.02, 0.045, 0.068],
      [ 0.22,  0.00, 0.050, 0.075],
      [ 0.40,  0.04, 0.042, 0.058],
      // Bottom row (3 dots, tear-drop ovals, more elongated vertically)
      [-0.13,  0.16, 0.048, 0.075],
      [ 0.08,  0.18, 0.050, 0.080],
      [ 0.28,  0.16, 0.042, 0.062],
    ];
    for (const [xR, yR, rxR, ryR] of dots) {
      ctx.beginPath();
      ctx.ellipse(xR * r, yR * r, rxR * r, ryR * r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
