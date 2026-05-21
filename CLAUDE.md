# CLAUDE.md — Cloud session guide

Read [AGENTS.md](AGENTS.md) first for project overview and architecture.
This file covers **how to build and test the project in a cloud Claude Code session**
(claude.ai/code, GitHub Codespaces, or any Linux sandbox).

---

## One-shot setup

```bash
bash setup.sh
```

The script is idempotent and does:

1. `npm ci` (or `npm install` if no lockfile)
2. `npx playwright install --with-deps chromium`
   — falls back to `npx playwright install chromium` if the sandbox blocks `apt`
3. `npm run build` as a smoke test (TypeScript + Vite)

If `setup.sh` succeeds, the environment is ready for everything below.

---

## Build

```bash
npm run build           # tsc --noEmit + vite build into dist/
```

## Dev server

```bash
npm run dev             # Vite on http://localhost:5173
```

Playwright starts this automatically via `webServer` in `playwright.config.ts`,
so you do **not** need to run `npm run dev` separately before tests.

## Run Playwright tests

```bash
npm run test:e2e                       # all projects (chromium + mobile)
npx playwright test --project=chromium # one project only
npx playwright test --headed           # only useful with a display
npx playwright test tests/breathing.spec.ts:31  # single test
```

Reports land in `playwright-report/` and `test-results/` (both gitignored).
Use `npx playwright show-report` to open the HTML report locally.

---

## GitHub Pages deploy

`.github/workflows/pages.yml` deploys `dist/` to GitHub Pages on push to `main`
(after e2e passes). The site lives at `https://<user>.github.io/FA_Pufferfish/`.

Vite's `base` is set conditionally:
- **dev / tests** → `/` (so `page.goto('/')` works)
- **production build** → `/FA_Pufferfish/` (so asset URLs match the Pages path)

Override either with `VITE_BASE=…` if the repo is renamed or a custom domain is added.
Asset loads in code use `import.meta.env.BASE_URL` — never hardcode `/assets/`.

To enable: in the repo's GitHub Settings → Pages, set **Source = GitHub Actions**.

## Cloud sandbox notes

- Tests are **headless** by default and the viewport is fixed in
  `playwright.config.ts`, so they work without a display server.
- `playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, so in CI /
  cloud the dev server is freshly spawned per run and torn down after.
- The Playwright base image (`mcr.microsoft.com/playwright:v1.60.0-jammy`) used by
  the devcontainer already has every system lib Chromium needs — the
  `--with-deps` step in `setup.sh` is a no-op there.
- All PNG assets the app needs at runtime live in `public/assets/` and are
  served by Vite. The `Pufferfish Components/` folder at the repo root is the
  source-of-truth copy; do not edit only one side.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Error: browserType.launch: Executable doesn't exist` | Playwright browsers not installed — re-run `bash setup.sh` or `npx playwright install chromium`. |
| Tests time out waiting for `localhost:5173` | Port already bound by a stale `vite` process. `pkill -f vite` then re-run. |
| `apt-get` permission denied during setup | Sandbox without root; the fallback `npx playwright install chromium` should still work. System libs are pre-installed on the Playwright base image. |
| Build fails with TS errors | Run `npx tsc --noEmit` to see them isolated from Vite. |
