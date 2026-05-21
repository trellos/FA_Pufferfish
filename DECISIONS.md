# DECISIONS.md

This file records architectural and design decisions made during implementation.
Update it whenever a significant decision is made or reversed.

---

## 1. Canvas 2D for rendering (not CSS/DOM)

**Decision:** Use a single full-screen `<canvas>` element with Canvas 2D API.

**Rationale:** The spec requires 60fps on mobile. Canvas 2D with `requestAnimationFrame`
gives direct control over every draw call and avoids reflow/paint overhead from DOM
manipulation. All pufferfish layers are composited on the canvas each frame.

---

## 2. Pre-tinted layer cache

**Decision:** Tint each PNG layer once at load time (via `source-in` composite op)
rather than re-tinting every frame.

**Rationale:** Creating an offscreen canvas per-frame per-layer would generate GC
pressure and reduce frame rate on low-end mobile devices. Pre-tinting reduces the
per-frame cost to simple `drawImage` calls (~22 total).

---

## 3. White-on-transparent PNG tinting via `source-in`

**Decision:** Colorize the white PNG assets by drawing the image, then overlaying a
solid fill with `globalCompositeOperation = 'source-in'`.

**Rationale:** All component PNGs are white shapes on a transparent background. The
`source-in` operation preserves the alpha channel (shape) of the image and replaces
all color data with the desired tint color. This is the correct technique for this
asset format.

---

## 4. URL parameters for timing

**Decision:** `?cycle=N` sets seconds per full breath cycle (default 8); `?duration=N`
sets total session length in seconds (default 60).

**Rationale:** The spec requests adjustable timing via URL variable. Two parameters give
independent control over breath speed and session length, which is useful for testing
and therapeutic customization.

---

## 5. DPR-aware canvas scaling

**Decision:** Canvas physical dimensions are set to `cssSize * devicePixelRatio`.
All draw calls use CSS-pixel coordinates; `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` is
applied at the start of each frame.

**Rationale:** Without DPR scaling, the canvas would be blurry on retina/HiDPI displays.
Setting the transform once per frame is cleaner than manually scaling every coordinate.

---

## 6. Single-panel start screen

**Decision:** The start screen shows only the "Breathe" panel — no colour-choice intro
or multi-panel flow. The entry in the original video before 0:07 and the "stay blue"
variant were removed as specified.

---

## 7. No "PERFECT" end screen

**Decision:** When the session timer expires, the app returns directly to the start
screen rather than showing an intermediate "PERFECT" screen.

**Rationale:** Specified in the product brief.

---

## 8. Thermometer.png — not used as a timer widget

**Decision:** The provided `Thermometer.png` is not used for the on-screen timer.
A custom rounded-rect progress bar is drawn instead.

**Rationale:** The Thermometer sprite appears to show two states side-by-side (outline
and filled), making it ambiguous as a single progress element. A custom bar is easier
to animate smoothly and keeps the code self-contained.

---

## 9. `window.__breathingManager` test hook

**Decision:** The `BreathingManager` instance is exposed on `window` in `main.ts`
so Playwright tests can read the current screen without screenshot comparison.

**Rationale:** All rendering is canvas-based (no DOM text to query), so the cleanest
test interface is a direct JS property. This is a non-production concern — only useful
for automated tests.

---

## 10. Tap-and-hold breath control (supersedes auto-cycle in §?)

**Decision:** On the breathing screen the pufferfish no longer runs an automatic
inhale/hold/exhale cycle. Instead, the user presses the screen to inhale and
releases to exhale.

- Idle (min size): top bar reads "tap to breathe in".
- Pressing: state = inhaling, scale grows from min → max over 5s. Bar reads
  "hold to breathe in" and fills from both sides toward the center.
- After 5s held: state = holding, scale pinned at max. Bar reads "holding".
- Release: state = exhaling. Scale shrinks back to min at the same rate as the
  inhale, so a partial inhale exhales in the same time it inhaled (capped at 5s).
  Bar text is blank while the fill retreats back to the sides.
- The `?cycle` URL param is removed; `?duration` (session length) is retained.

**Rationale:** Gives the child direct control over their breath rather than
forcing them to follow a fixed tempo. The fill-from-sides bar gives a
non-numeric visual cue of how full the breath is.
