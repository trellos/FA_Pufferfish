#!/usr/bin/env bash
# Bootstrap script for cloud sandboxes (Claude Code web, Codespaces, plain Linux).
# Idempotent: safe to re-run.

set -euo pipefail

cd "$(dirname "$0")"

echo "==> Node $(node --version), npm $(npm --version)"

# 1. Install JS deps. Prefer ci when lockfile + node_modules out of sync.
if [ -f package-lock.json ]; then
  echo "==> npm ci"
  npm ci
else
  echo "==> npm install"
  npm install
fi

# 2. Install Playwright browsers. --with-deps pulls system libs on Linux;
#    if the sandbox blocks apt, fall back to a browser-only install.
echo "==> Installing Playwright Chromium"
if ! npx playwright install --with-deps chromium; then
  echo "   --with-deps failed (likely no apt/sudo); installing browser only"
  npx playwright install chromium
fi

# 3. Sanity check: type-check & build.
echo "==> Type-check + build"
npm run build

echo "==> Setup complete. Run 'npm run test:e2e' to execute Playwright tests."
