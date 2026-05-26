// FishGeometry — single source of truth for the pufferfish's anatomical layout.
//
// PufferFish.ts uses these constants to position face features in the body's
// local space. BreathingManager.ts uses them to project nostril and mouth
// positions into screen space so particles can target them.
//
// All values are fractions of baseR (the body radius unit). The local-space
// origin is the silhouette center; +y is down.
//
// If you change a constant here, both the renderer and the particle spawner
// pick it up automatically. Do NOT transcribe these numbers into either file.

// ── Face-feature Y positions (negative = above center) ──────────────────────
export const EYES_Y_FRAC      = -0.52;  // Eyes_Relax / Eyes_Closed row
export const NOSE_Y_FRAC      = -0.52;  // Nose_Open / Nose_Closed row (same as eyes)
export const MOUTH_Y_FRAC     = -0.30;  // Mouth_Closed dash, just below eye row
export const BIG_NOSE_Y_FRAC  = -0.38;  // Mouth_Circle (big central nose), exhale only

// ── Face-feature widths and derived dimensions ──────────────────────────────
// Render widths are fractions of baseR. The Mouth_Circle sprite is 1:1 aspect,
// so its on-screen radius is half its render width.
export const EYES_RELAX_WIDTH    = 1.55;
export const EYES_CLOSED_WIDTH   = 1.30;
export const NOSE_OPEN_WIDTH     = 0.30;
export const NOSE_CLOSED_WIDTH   = 0.42;
export const MOUTH_CLOSED_INHALE_WIDTH = 0.32;
export const MOUTH_CLOSED_HOLD_WIDTH   = 0.55;
export const MOUTH_CIRCLE_WIDTH  = 0.38;
export const MOUTH_CIRCLE_RADIUS = MOUTH_CIRCLE_WIDTH / 2;  // 0.19, 1:1 aspect sprite

// Position of each nostril dot inside the Nose_Open sprite, expressed as a
// fraction of baseR. This is determined by the asset's internal geometry
// (the two dots are baked into the PNG at ~±93% of the sprite's half-width)
// combined with NOSE_OPEN_WIDTH. If you change NOSE_OPEN_WIDTH, re-measure
// this from the rendered asset.
export const NOSTRIL_OFFSET_X = 0.14;
