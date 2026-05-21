// PufferFish — Canvas 2D sprite compositor.
//
// The silhouette is ONE smooth egg-shaped ellipse (slightly wider at the
// bottom). The "dark belly" is NOT a separate body — it's a darker gradient
// region drawn INSIDE the silhouette, clipped to the outer outline. This
// avoids the "snowman bisection" effect where a head circle pokes above a
// belly circle: the outer outline is a single curve.
//
// All drawable bits (spikes, wings, dots, glow, eyes/nose/mouth) are
// pre-tinted PNG sprites blitted with drawImage. The body silhouette is
// drawn with ellipse() so we can apply gradient fills cleanly.
//
// Layer order (back to front):
//   1. Glow.png         — soft halo (low alpha, screen blend)
//   2. Wings            — drawn BEHIND body; inner half is covered by body,
//                         outer half peeks past the body edge
//   3. Spikes ×10       — also BEHIND body; only the outer tips visible
//   4. Body fill        — bright cyan ellipse (the silhouette base)
//   5. Dark belly       — gradient ellipse clipped to the silhouette (inside)
//   6. Belly_Dots.png   — bright cyan, clipped to the silhouette (drawn ONCE)
//   7. Face features    — eyes/nose/mouth in upper third of the silhouette
//
// Phases:
//   inhale  → Eyes_Relax + Nose_Open    + Mouth_Closed
//   hold    → Eyes_Closed + Nose_Closed + Mouth_Closed   (both at eye row → angry look)
//   exhale  → Eyes_Relax  + Mouth_Circle (large central nose; no Nose_Closed)

export type BreathPhase = 'inhale' | 'hold' | 'exhale';

const TINT = {
  wing:        '#FFFFFF',
  dots:        '#80EEFF',
  face:        '#0F80C2',          // medium blue for eyes/nose-marks/mouth-dash
  mouthCircle: '#0F80C2',          // big central nose — same medium blue as other features
  glow:        '#C8F4FF',
  spike:       'rgb(57,232,251)',  // body-cyan
} as const;

const SPIKE_COUNT = 10;

// Silhouette half-extents relative to baseR. Almost a perfect circle in the
// reference — very slightly wider than tall. Bottom-half flare is subtle.
const SX_FACTOR = 1.05;
const SY_FACTOR = 1.02;

interface Img { el: HTMLImageElement; tinted: HTMLCanvasElement }

export class PufferFish {
  private imgs: Record<string, Img> = {};
  private ready = false;

  constructor(private base = '/assets/') {}

  async load(): Promise<void> {
    const defs: [string, string][] = [
      ['Wing_R',       TINT.wing        ],
      ['Belly_Dots',   TINT.dots        ],
      ['Eyes_1',       TINT.face        ],
      ['Eyes_Relax',   TINT.face        ],
      ['Eyes_Closed',  TINT.face        ],
      ['Nose_Open',    TINT.face        ],
      ['Nose_Closed',  TINT.face        ],
      ['Mouth_Circle', TINT.mouthCircle ],  // big nose — belly-cyan, not navy
      ['Mouth_Closed', TINT.face        ],
      ['Glow',         TINT.glow        ],
      ['Spike1',       TINT.spike       ],
    ];
    await Promise.all(defs.map(([n]) => this.loadOne(n)));
    for (const [n, c] of defs) this.makeTinted(n, c);
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

  // Draw a tinted sprite centered at the current origin, scaled to `targetW`
  // while preserving aspect ratio. Optionally offset by (dx,dy) and rotated.
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

  // Build the single outer silhouette path. Almost-circular with a very slight
  // bottom flare. Centered at (0,0).
  // Top half: ellipse with (sx, sy*0.98).
  // Bottom half: ellipse with (sx, sy*1.02) — a touch fuller below.
  private buildBody(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    ctx.beginPath();
    // Top half (left → top → right)
    ctx.ellipse(0, 0, sx, sy * 0.98, 0, Math.PI, 0, false);
    // Bottom half (right → bottom → left) — slightly fuller
    ctx.ellipse(0, 0, sx, sy * 1.02, 0, 0, Math.PI, false);
    ctx.closePath();
  }

  // cx/cy:  fish center in screen space (silhouette center).
  // baseR:  body radius unit at scale=1.
  // scale:  0.78 .. 1.22.
  // phase:  'inhale' | 'hold' | 'exhale'.
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

    const sx = baseR * SX_FACTOR;
    const sy = baseR * SY_FACTOR;
    // Effective bottom-half scale (matches buildBody's bottom-half ellipse).
    const sxBot = sx;
    const syBot = sy * 1.02;
    const syTop = sy * 0.98;

    // ── 1. Glow halo ───────────────────────────────────────────────────────
    // Soft bloom around the fish — a gentle halo of light, not a bright ring.
    // Diameter ~2.6× baseR gives the halo room to extend just past the spikes;
    // alpha 0.18 keeps it visible against the dark sky without washing out.
    const glowW = baseR * 2.6;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    this.blit(ctx, 'Glow', glowW, 0, 0, 0.18);
    ctx.restore();

    // ── 2. Wings (BEHIND body — inner ~30 % covered, outer ~70 % peeks out) ─
    // Anchor the wing NEAR the body edge and offset the sprite so only its
    // INNER ~30 % is tucked behind the silhouette; ~70 % of the wing remains
    // visible outside the body. Matches the reference where wings clearly
    // stick out past the silhouette rather than hiding behind it.
    //
    // Wings FLAP using a fast sine oscillation around the body-edge anchor.
    // Flap is driven by absolute time (not breath phase) so the flutter runs
    // at a consistent rhythm regardless of cycle length — matches the
    // reference video where wings flap continuously through the cycle.
    const flapHz    = 1.8;
    const flapAngle = Math.sin(performance.now() / 1000 * flapHz * Math.PI * 2) * 0.18; // ±~10°
    const wingW  = baseR * 0.36;
    const wingH  = baseR * 0.28;
    // Wings sit UP at face level (above the i=2/i=3 side spikes which are at
    // angle ±18° from equator, y ≈ -0.32*baseR). At wingY = -0.55*baseR with
    // wingH = 0.28*baseR, the wing spans y = -0.69..-0.41 vertically — clears
    // the side spikes (y ≈ -0.32) entirely. wingAnchorX = sx * 0.84 lands on
    // the silhouette edge at this Y (sqrt(1 - 0.55²/1.02²) ≈ 0.84).
    const wingY  = -baseR * 0.55;
    const wingAnchorX = sx * 0.84;
    const wImg = this.imgs['Wing_R']?.tinted;
    if (wImg) {
      // Right wing — sprite anchored so only inner 30 % is hidden by body.
      // Rotate around the anchor so the wing pivots from where it joins the body.
      ctx.save();
      ctx.translate(wingAnchorX, wingY);
      ctx.rotate(flapAngle);
      ctx.drawImage(wImg, -wingW * 0.30, -wingH / 2, wingW, wingH);
      ctx.restore();

      // Left wing — mirrored. Opposite flap direction keeps the motion
      // symmetric (both wings rise/fall together, not in lockstep).
      ctx.save();
      ctx.translate(-wingAnchorX, wingY);
      ctx.scale(-1, 1);
      ctx.rotate(flapAngle);
      ctx.drawImage(wImg, -wingW * 0.30, -wingH / 2, wingW, wingH);
      ctx.restore();
    }

    // ── 3. Spikes (BEHIND body — only outer tips peek past the silhouette) ─
    // Spikes are SMALL thorns evenly spaced around the ellipse. For each
    // angle θ on the outline, the surface point is (sx*cos θ, sy*sin θ)
    // (top or bottom ellipse). The sprite points UP by default; rotate it
    // to align with the outward radial. Drawn before the body fill so the
    // body silhouette covers the inner portion.
    const spikeSize = baseR * 0.18;
    const spImg = this.imgs['Spike1']?.tinted;
    if (spImg) {
      const w = spikeSize;
      const h = spikeSize * (spImg.height / spImg.width);
      // All 10 spikes drawn — no equator skip. Wings sit at face level
      // (wingY = -baseR * 0.55) so the i=2/i=3 side spikes at y ≈ -0.32*baseR
      // are clear of the wing footprint.
      for (let i = 0; i < SPIKE_COUNT; i++) {
        const t  = (i / SPIKE_COUNT) * Math.PI * 2 - Math.PI / 2;
        const dx = Math.cos(t), dy = Math.sin(t);
        const ex = dy > 0 ? sxBot : sx;
        const ey = dy > 0 ? syBot : syTop;
        const px = dx * ex;
        const py = dy * ey;
        const angle = Math.atan2(dy, dx) + Math.PI / 2;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.drawImage(spImg, -w / 2, -h * 0.85, w, h);
        ctx.restore();
      }
    }

    // ── 4. Body fill (the single silhouette in bright cyan) ────────────────
    this.buildBody(ctx, sx, sy);
    ctx.fillStyle = '#39E8FB';
    ctx.fill();

    // ── 5. Dark belly region — clipped to silhouette ───────────────────────
    // Rebuild silhouette path for clipping (clip consumes the path).
    ctx.save();
    this.buildBody(ctx, sx, sy);
    ctx.clip();

    // The dark belly covers ~bottom 70% of the silhouette. Its TOP edge sits
    // at y ≈ -0.40*baseR — about 30% down from the silhouette top — so the
    // bright cyan head arc occupies the upper ~third. Centre is lower
    // (+0.40*baseR) so the ellipse bottom extends past the silhouette bottom
    // and gets clipped flush. The gradient is dark at the top, holds dark
    // through ~mid, then BRIGHTENS noticeably toward the bottom — matching
    // the reference belly which sampled #159FDC → #1CC3ED → #21EDF7 from
    // top to bottom. The bottom is bright cyan but slightly cooler than the
    // head crown (#39E8FB) so head/belly aren't identical.
    const bellyCY = baseR * 0.40;            // belly centre, well below mid
    const bellyRX = baseR * 1.10;            // wider than silhouette → clipped to outline
    const bellyRY = baseR * 0.80;            // tall — top at -0.40, bottom at +1.20 (clipped)
    const bellyTop = bellyCY - bellyRY;       // y of belly top (≈ -0.40)
    const bellyBot = bellyCY + bellyRY;       // y of belly bottom (≈ +1.20, clipped)
    const bg = ctx.createLinearGradient(0, bellyTop, 0, bellyBot);
    bg.addColorStop(0.00, '#159FDC');   // dark blue at top
    bg.addColorStop(0.35, '#159FDC');   // hold dark until ~middle
    bg.addColorStop(0.70, '#1CC3ED');   // medium brightening
    bg.addColorStop(0.90, '#21E0F0');   // bright cyan band
    bg.addColorStop(1.00, '#27E8F5');   // bright cyan, slightly cooler than head crown
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, bellyCY, bellyRX, bellyRY, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── 6. Belly dots (clipped to silhouette) ──────────────────────────────
    // Belly_Dots.png is wide (~429×144). Draw ONCE only — the asset itself
    // contains all the dots. Belly now starts at y ≈ -0.40, so dots sit
    // a bit lower at y ≈ +0.30 to land mid-belly (between belly top -0.40
    // and silhouette bottom +1.05).
    const dotW  = baseR * 1.05;
    const dotDY = baseR * 0.30;
    this.blit(ctx, 'Belly_Dots', dotW, 0, dotDY, 0.95);
    ctx.restore();

    // ── 7. Face features (upper third of silhouette) ───────────────────────
    // Face center sits in the UPPER THIRD of the silhouette. Bright cyan
    // head spans from y ≈ -1.00*baseR (silhouette top) down to ≈ -0.40*baseR
    // (belly top edge), so its midpoint is ≈ -0.70*baseR. y is relative to
    // silhouette centre; negative is up.
    //
    // Important: there are NO separate brow marks. During Hold, Nose_Closed
    // and Eyes_Closed are drawn at the SAME y, so the asset's internal
    // positioning produces the angled "squinty" marks above the eye dashes
    // organically — one merged row, not two.
    const hr = baseR;
    const EYES_Y     = -hr * 0.52;   // Eyes_Relax / Eyes_Closed
    const NOSE_Y     = -hr * 0.52;   // Nose_Open / Nose_Closed — same row as eyes
    const MOUTH_Y    = -hr * 0.30;   // Mouth_Closed dash, just below the eye row
    const BIG_NOSE_Y = -hr * 0.38;   // Mouth_Circle, slightly below eye row

    // Face features are tinted PNGs with set stroke thickness. To make them
    // appear THINNER/SOFTER (closer to the reference), draw at alpha 0.80 so
    // they read as "shaded" features rather than bold paint strokes.
    const FACE_ALPHA = 0.80;

    if (phase === 'inhale') {
      // Eyes_Relax + Nose_Open + Mouth_Closed.
      // Reference p_008 (Breathe In) shows: nose dots close together, and a
      // VERY SHORT mouth dash. Width 0.32*hr keeps the mouth subtle.
      this.blit(ctx, 'Eyes_Relax',   hr * 1.55, 0, EYES_Y,    FACE_ALPHA);
      this.blit(ctx, 'Nose_Open',    hr * 0.30, 0, NOSE_Y,    FACE_ALPHA);
      this.blit(ctx, 'Mouth_Closed', hr * 0.32, 0, MOUTH_Y,   FACE_ALPHA);
    } else if (phase === 'hold') {
      // Hold face: 4 distinct angled marks on the eye row + mouth dash.
      // Eyes_Closed.png has 2 dashes at the FAR L/R edges of its bounding
      // box, so its width controls how far apart the OUTER dashes sit.
      // Nose_Closed.png has 2 angled slashes ALSO at the FAR L/R edges,
      // so drawing it MUCH NARROWER places those slashes near the CENTRE,
      // producing the INNER pair. The big size difference is intentional:
      // outer pair lands at ±~0.62*hr, inner pair at ±~0.20*hr.
      this.blit(ctx, 'Eyes_Closed',  hr * 1.30, 0, EYES_Y,    FACE_ALPHA);
      this.blit(ctx, 'Nose_Closed',  hr * 0.42, 0, NOSE_Y,    FACE_ALPHA);
      this.blit(ctx, 'Mouth_Closed', hr * 0.55, 0, MOUTH_Y,   FACE_ALPHA);
    } else {
      // exhale — Eyes_Relax + Mouth_Circle (big nose). NO Nose_Closed: the
      // big central nose IS the feature; adding brows would clutter it.
      // Reference c_025 shows the central nose much smaller than before —
      // it's a defined feature but doesn't dominate the face. Dropping the
      // width from 0.60 → 0.38 brings it in line with the reference.
      this.blit(ctx, 'Eyes_Relax',   hr * 1.55, 0, EYES_Y,     FACE_ALPHA);
      this.blit(ctx, 'Mouth_Circle', hr * 0.38, 0, BIG_NOSE_Y, FACE_ALPHA);
    }

    ctx.restore();
  }
}
