# AGENTS.md

Project overview for future Claude Code sessions.
**Keep this file up to date as the project evolves.**

---

## What this is

A breathing-exercise web app for children. An animated pufferfish inflates and deflates
on screen to guide the user through slow, deep breaths. Built with TypeScript + Vite,
rendered with Canvas 2D at up to 60fps.

---

## File map

```
FA_Pufferfish/
  index.html              Entry point — single <canvas id="canvas">
  src/
    main.ts               App entry: creates BreathingManager, wires click/touch events
    BreathingManager.ts   Controls screen state (start → breathing → start), timing,
                          the rAF loop, UI rendering (text, timer bar, play button)
    PufferFish.ts         Loads & renders the layered pufferfish assets on a Canvas 2D
                          context; handles phase-based eye/mouth/nose swapping
  public/
    assets/               PNG component images (copied from "Pufferfish Components/")
  tests/
    breathing.spec.ts     Playwright e2e test suite (4 tests)
  playwright.config.ts    Playwright config — runs dev server on port 5173
  vite.config.ts          Vite config (minimal)
  tsconfig.json           TypeScript config (strict mode, bundler module resolution)
  DECISIONS.md            Architectural decision log — see below
  AGENTS.md               This file
```

---

## Running locally

```bash
npm install
npm run dev          # http://localhost:5173
```

URL parameters (both optional):
- `?cycle=8`      — seconds per full breath cycle (default 8)
- `?duration=60`  — total session length in seconds (default 60)

---

## Running tests

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

---

## Architecture overview

```
main.ts
  └── BreathingManager
        ├── owns the rAF loop (60fps)
        ├── manages screen: 'start' | 'breathing'
        ├── reads URL params for timing
        └── PufferFish
              ├── loads PNG layers from /assets/
              ├── pre-tints them once at load (source-in composite)
              └── renders layered fish each frame given (cx,cy,radius,scale,phase)
```

---

## DECISIONS.md

`DECISIONS.md` records every significant architectural or design decision.
**When you make a change that diverges from or extends a prior decision, update
DECISIONS.md with a new numbered entry** explaining what changed and why. Do not
delete old entries — mark them superseded if necessary.

---

## Maintaining .md files

- **AGENTS.md** — update whenever the file structure, architecture, or run commands change.
- **DECISIONS.md** — update whenever a new significant decision is made.
- Both files should stay accurate. Stale docs are worse than no docs.

---

## Asset notes

All PNG files in `public/assets/` are **white shapes on a transparent background**
(except `Thermometer.png` which has its own colour data and is currently unused).
They are tinted at runtime using the `source-in` Canvas 2D composite technique.
See `PufferFish.ts` and `DECISIONS.md §3` for details.
