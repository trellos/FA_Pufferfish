// FishGeometry — single source of truth for the pufferfish's anatomical layout,
// derived from the Unity Pufferfish prefab and Puffer_BreatheIn.anim curves at
// MightierApp/Assets/Hub/InteractiveSkills/Pufferfish/.
//
// PufferFish.ts uses these constants to position face features in the body's
// local space. BreathingManager.ts uses them to project nostril and mouth
// positions into screen space so particles can target them.
//
// Unit reference: the Unity Body sprite is 796 px at 100 px/unit and rendered
// at Body.localScale 0.1 inside PufferFish, giving a body radius of 0.398 in
// PufferFish-local Unity units. All fractional values below are expressed
// relative to baseR (our body radius unit in canvas pixels). +y is down.

// ── Inflation envelope (Unity Puffer_BreatheIn root scale curve) ────────────
// PufferFish.localScale animates 0.56515 → 1.0 over 3.017s during BreatheIn,
// then deflates over Puffer_BreatheOut. We match the ratio (1.0 / 0.565 = 1.77x).
export const SCALE_MIN = 0.56515;
export const SCALE_MAX = 1.0;
// Seconds to go from min → max while held. Matches Puffer_BreatheIn duration
// (Unity uses 3.0167s with an ease-in tangent at the start).
export const FULL_BREATH_SECS = 3;

// ── Face anchor — animated by Puffer_BreatheIn on PufferFish/Face ──────────
// Unity local position y: 0.222 (idle) → 0.267 (peak). Body radius 0.398.
// Canvas +y is down, so multiply by -1.
export const FACE_Y_IDLE_FRAC = -0.222 / 0.398;  // -0.558
export const FACE_Y_PEAK_FRAC = -0.267 / 0.398;  // -0.671
// Face localScale: 1.2224 (idle) → 1.0 (peak). The face shrinks as the body
// inflates so the head doesn't outpace the body — keeps proportions balanced.
export const FACE_SCALE_IDLE = 1.2224;
export const FACE_SCALE_PEAK = 1.0;

// ── Face features (local offsets within the Face transform) ─────────────────
// Unity local positions inside Face:
//   Eyes: (0, 0)
//   Nose: (0, 0.019)   — slightly above eye row
//   Mouth:(0, -0.022)  — slightly below eye row
// Expressed as fraction of baseR (0.398).
export const EYES_LOCAL_Y_FRAC  =  0.0;
export const NOSE_LOCAL_Y_FRAC  = -0.019 / 0.398;  // -0.048 (up)
export const MOUTH_LOCAL_Y_FRAC =  0.022 / 0.398;  // +0.055 (down)

// ── Mouth size animation (Unity Mouth.localScale) ──────────────────────────
// Mouth.localScale: 0.03983 (idle) → 0.07802 (peak), ratio 1.96x.
// Sprite Mouth_Closed is 164 px → 1.64 Unity units. With Mouth scale 0.078 it
// occupies 0.128 units = 0.32 of baseR. With Mouth scale 0.040 it occupies
// 0.0654 units = 0.164 of baseR.
export const MOUTH_CLOSED_WIDTH_IDLE = 0.164;
export const MOUTH_CLOSED_WIDTH_PEAK = 0.321;
// Mouth_Circle (the big O drawn on exhale only) is a 138x138 sprite at the
// same scale envelope. 138 px = 1.38 Unity units; peak 1.38 * 0.078 = 0.108 →
// 0.270 of baseR. Idle 1.38 * 0.040 = 0.055 → 0.139 of baseR.
export const MOUTH_CIRCLE_WIDTH_IDLE = 0.139;
export const MOUTH_CIRCLE_WIDTH_PEAK = 0.270;

// ── Other face-feature widths (constant — only Mouth animates in BreatheIn) ─
// Eyes_Relax sprite 386x45 px = 3.86x0.45 units. At face scale 1.0 inside Face
// scale 1.22 (idle) the eyes appear at 3.86 * 0.1 * 1.22 / 0.398 = 1.18 of baseR.
// At peak (face scale 1.0): 3.86 * 0.1 * 1.0 / 0.398 = 0.97 of baseR.
// We apply face scale at draw time and store the BASE (peak-scale) width.
export const EYES_RELAX_WIDTH   = 0.97;
export const EYES_CLOSED_WIDTH  = 385 / 386 * 0.97;  // 0.966
export const NOSE_OPEN_WIDTH    = 121 / 386 * 0.97;  // 0.304
export const NOSE_CLOSED_WIDTH  = 121 / 386 * 0.97;  // 0.304

// Nostril offset inside Nose_Open sprite — the two dots sit at ~93% of the
// sprite's half-width. With NOSE_OPEN_WIDTH at face scale 1.0:
// NOSE_OPEN_WIDTH * 0.5 * 0.93 = 0.141 of baseR. BreathingManager applies face
// scale at runtime to track the animated nostril position.
export const NOSTRIL_OFFSET_X = NOSE_OPEN_WIDTH * 0.5 * 0.93;

// ── Belly (Unity Body/Body/Belly transform) ────────────────────────────────
// Position y: -2.89 (idle) → -2.15 (peak) in Body-local space.
// Body has scale 0.1, so in PufferFish-local: -0.289 → -0.215.
// As fraction of body radius (0.398), canvas +y down: +0.726 → +0.540.
export const BELLY_Y_IDLE_FRAC = 0.289 / 0.398;  // +0.726
export const BELLY_Y_PEAK_FRAC = 0.215 / 0.398;  // +0.540
// Belly scale: 0.94 (idle) → 1.0 (peak).
export const BELLY_SCALE_IDLE = 0.94;
export const BELLY_SCALE_PEAK = 1.0;
// Belly_Dots position inside Belly. The dots are baked into a 429x144 sprite
// which Belly draws centred. Local position in Unity is (-0.071, -0.379) at
// Belly scale 1.0. In our system we just centre the dots on the belly.
export const BELLY_DOTS_WIDTH = 1.05;  // ~half of body width, fills lower belly

// ── Spikes ─────────────────────────────────────────────────────────────────
// Unity has 9 spike instances at radial distance ~0.95 * body radius. Their
// local scales animate from 0.058..0.069 (idle) down to 0.02..0.03 (peak),
// so spikes get RELATIVELY smaller as the body inflates (subtle ~21% shrink
// in world space). We model this with a multiplier on a base spike size.
export const SPIKE_COUNT = 9;
export const SPIKE_RADIAL_FRAC = 0.95;
// Spike sprite 256x256 px → 2.56 units. World size at peak (scale 0.03):
// 2.56 * 0.1 * 0.03 = 0.00768 → 0.0193 of baseR. At idle (scale 0.067):
// 2.56 * 0.1 * 0.067 * 0.565 (pufferfish) = 0.00969 → 0.0244 of baseR.
// Empirically the spikes read better at 4-5x that size for our canvas; the
// Unity values produce barely-visible thorns. SPIKE_SIZE_FRAC is the visible
// fraction (post-multiplier), tuned to keep recognisable thorns.
export const SPIKE_SIZE_BASE_FRAC = 0.16;
// Multiplier: 1.0 at idle (visible thorns), 0.79 at peak (slightly tucked).
export const SPIKE_SCALE_IDLE = 1.0;
export const SPIKE_SCALE_PEAK = 0.79;

// ── Wings (Unity Wing_R / Wing_L localEulerAngles.z) ───────────────────────
// Wing rotation oscillates 0 ↔ -21.607° on a 0.333s period (Wing_R). Wing_L
// is the mirror. 1 / 0.333 = 3 Hz.
export const WING_FLAP_HZ = 3;
export const WING_FLAP_DEG = 21.607;
// Wing sprite 96x101 px = 0.96 x 1.01 units. At wing scale 0.1 and PufferFish
// scale 1.0: 0.096 x 0.101 units = 0.241 x 0.254 of baseR. Wings sit near the
// body edge — Wing.localPosition (±0.307, 0.226) in PufferFish-local =
// (±0.771, 0.568) of baseR.
export const WING_WIDTH_FRAC  = 0.241;
export const WING_HEIGHT_FRAC = 0.254;
export const WING_ANCHOR_X_FRAC = 0.771;
export const WING_ANCHOR_Y_FRAC = -0.568;  // canvas y up = -

// ── Glow halo ──────────────────────────────────────────────────────────────
// Unity Glow sprite 888x896 px = 8.88 units across. At Glow scale 0.1 and
// PufferFish scale 1.0: 0.888 units = 2.23 of baseR.
export const GLOW_WIDTH_FRAC = 2.23;

// ── Body silhouette (Body.png) and Belly silhouette (Belly_Base.png) ───────
// Body.png is 796 px at 100 px/unit, rendered at Body.scale 0.1 → 0.796 units
// across in PufferFish-local space. With our baseR = body half-extent, both
// the body and belly sprites are drawn at width = baseR * 2 / SHRINK so they
// align with the silhouette. Empirically the visible body fills its bounding
// box so the sprite is drawn at exactly 2 * baseR.
export const BODY_WIDTH_FRAC = 2.0;
export const BELLY_WIDTH_FRAC = 2.0;
export const GRADIENT_WIDTH_FRAC = 2.0;

// ── Colour palette (Unity SpriteRenderer m_Color values) ───────────────────
export const COLOR_BODY        = '#27D8FC';  // (0.153, 0.847, 0.992)
export const COLOR_BELLY_BASE  = '#0694E0';  // (0.024, 0.580, 0.878)
export const COLOR_BELLY_DOTS  = '#0DDBF7';  // (0.051, 0.859, 0.973)
export const COLOR_GRADIENT    = '#0DDBF7';
export const COLOR_SPIKE       = '#0DDBF7';
export const COLOR_GLOW        = '#27D8FC';
export const COLOR_FACE        = '#0078C7';  // (0.000, 0.467, 0.780)
export const COLOR_WING        = '#FFFFFF';
export const COLOR_BACKGROUND  = '#08183C';  // (0.031, 0.094, 0.235)
