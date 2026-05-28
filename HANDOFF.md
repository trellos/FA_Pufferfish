# HANDOFF — 2026-05-28

Notes for the next Claude session. Replace this file's contents with your own
handoff when you finish — keep it short and current, not a changelog.

---

## What shipped

Brought the visuals and animation in line with the original Unity Pufferfish
prefab at `C:/dev/MightierApp/Assets/Hub/InteractiveSkills/Pufferfish/`.

**Two commits on `main`** (already fast-forwarded, NOT yet pushed):
- `2f2f195` Remove deprecated code
- `3ef5e17` Match Unity Pufferfish prefab: real textures, animated face/belly, refined particles

### Visual / animation changes
- **Real Unity textures**: `Body.png`, `Belly_Base.png`, `Gradient_1.png`,
  `Eyes_1.png` copied into `public/assets/` and `Pufferfish Components/`.
  Synthetic ellipse silhouette removed in favour of `Body.png` tinted at runtime.
- **Background**: flat `#08183C` (matches Deep Breathing prefab "Extra Large BG").
- **Animation envelope** from `Puffer_BreatheIn.anim` keyframes:
  - PufferFish root scale `0.56515 → 1.0` over 3 s (was `0.78 → 1.22` over 5 s)
  - Face y `-0.558 → -0.671` of baseR, face scale `1.22 → 1.0`
  - Mouth scale roughly doubles during inhale
  - Belly y/scale shifts, spike scale shrinks
  - Wings flap 3 Hz, ±21.6°
- **Belly composite**: `Belly_Base` + `Gradient_1` + `Belly_Dots` rendered
  into an offscreen canvas, then `destination-in` masked to the body alpha
  so the belly art is clipped to the silhouette (Unity does this via a
  SpriteMask). Dots drawn with `globalCompositeOperation = 'lighter'` so
  they pop against the dark belly.

### Particles
- **Inhale**: commit to a `targetSide` ('left' | 'right') at spawn, then
  re-aim every frame at the LIVE nostril position. Velocity is rewritten
  to `(liveTarget - pos) / remainingLife` so the trajectory tracks the
  face as the body puffs up but still arrives exactly at end-of-life.
  Alpha = `min(1, life × 4)` — full brightness until last 25 % of life,
  then linear fade so the puff disappears right at the nostril.
- **Exhale**: spawn in an inner ring of the mouth disc
  (`mouthR × (0.2 + rand × 0.6)` = 0.2..0.8 mouthR), velocity strictly
  radially outward from mouth centre. Trail length CLAMPED to
  `min(speed × TRAIL_LEN_SECS, distFromSpawn)` — at spawn the tail is
  zero length, then grows from the spawn point outward. This is the key
  fix that prevents trails from extending backward through the mouth
  centre and crossing each other.

---

## State you'll start in

### Branches
- `main` is **2 commits ahead of `origin/main`** — push when ready.
- Local `claude/elated-germain-c1c83b` is checked out in this worktree
  and is fully merged into main.
- Remote stale branch `origin/claude/flamboyant-bose-e15a0e` already deleted.

### Worktrees
- `C:/dev/FA_Pufferfish` → `main`
- `C:/dev/FA_Pufferfish/.claude/worktrees/elated-germain-c1c83b` → branch
  of the same name (THIS worktree). It can be removed once you start a
  fresh session — `git worktree remove --force` from the main path —
  along with its branch.

### Working tree
- Clean on this branch.
- Main worktree has an untracked `_archived_tmp_flamboyant_bose/` folder
  that was already there before this session — not mine to delete.

---

## Pending follow-ups

1. **Push to `origin/main`** when ready (not done this session — wasn't
   explicitly requested):
   `git -C C:/dev/FA_Pufferfish push origin main`
2. **Remove this worktree + branch** after starting a new session so you're
   not deleting your own workspace:
   ```
   git -C C:/dev/FA_Pufferfish worktree remove --force C:/dev/FA_Pufferfish/.claude/worktrees/elated-germain-c1c83b
   git -C C:/dev/FA_Pufferfish branch -D claude/elated-germain-c1c83b
   ```
3. **`AGENTS.md` asset list is stale.** It still lists only the original
   sprite set (`Wing_R, Belly_Dots, Eyes_Relax, …`). The currently rendered
   set now also includes `Body`, `Belly_Base`, `Gradient_1`, `Eyes_1`.
   Update the list if you touch that file.
4. **`DECISIONS.md` may want a new entry** describing the Unity-match
   decision and the offscreen-belly-mask technique, but I held off so as
   not to bloat docs without a request.
5. **Playwright tests not run this session.** Build is green (`tsc + vite`)
   and the new particle contracts are encoded in `tests/breathing.spec.ts`,
   but I didn't actually execute `npm run test:e2e`. Worth running before
   pushing.

---

## Subtle things to know

- **Preview tab is "hidden"**: when verifying in `mcp__Claude_Preview`,
  `document.hidden === true` and `requestAnimationFrame` is throttled to
  0 Hz, so the rAF loop never ticks on its own. To capture a frame, drive
  `m.drawBreathing(dt)` / `m.drawStart(t)` manually via `preview_eval`.
  Don't waste time chasing this — it's not a real bug.
- **PNG round-trip via `preview_eval` is broken**: base64-encoded canvas
  output saved through eval comes back as a malformed file the API
  image reader rejects. Use pixel-sampling via `getImageData` for
  verification instead.
- **Body radius math**: in PufferFish-local Unity units, body radius is
  `0.398` (Body.png 7.96 sprite units × Body's 0.1 scale ÷ 2). The Body
  *container* has scale 1 (not 10 — line 6213's scale-10 object is
  "BreathOut", a different node). All FishGeometry fractions divide by
  `0.398`.
- **Belly hierarchy**: `Belly` and `Belly_Dots` are nested INSIDE the
  scale-0.1 Body sprite, so their local positions get the 0.1 factor.
  The dots ending up near body centre (not in the lower belly) is
  correct per Unity — the dots sprite itself is wide-and-short and sits
  across the mid-body area.
- **`Particle` and `FishMetrics`** are exported from `BreathingManager.ts`
  only to satisfy the Playwright test hook (`window.__breathingManager`).
  `ts-prune` flags them as "used in module" — that's a false positive,
  don't remove the exports.
