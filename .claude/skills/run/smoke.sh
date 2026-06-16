#!/usr/bin/env bash
# Smoke-test launcher for PokerVsPlayer.
# Starts the WS game server + Next.js production server, waits for readiness,
# then runs a Playwright script (first arg, or /tmp/run_pokerpals.cjs by
# default) and cleans up.
#
# Usage:
#   bash .claude/skills/run/smoke.sh            # launches + screenshots
#   bash .claude/skills/run/smoke.sh /tmp/my.cjs  # custom Playwright script

set -euo pipefail

PLAYWRIGHT_MOD="/opt/node22/lib/node_modules/playwright"
SCRIPT="${1:-/tmp/run_pokerpals.cjs}"

# ── Kill any previous instances ──────────────────────────────────────────────
pkill -f "node.*server/index.js" 2>/dev/null || true
pkill -f "next start"            2>/dev/null || true
sleep 0.5

# ── Start WS game server ─────────────────────────────────────────────────────
node --env-file=.env server/index.js > /tmp/pokerpals_ws.log 2>&1 &
WS_PID=$!

# ── Start Next.js (production) ───────────────────────────────────────────────
NODE_ENV=production npx next start -p 3000 > /tmp/pokerpals_next.log 2>&1 &
NEXT_PID=$!

cleanup() {
  kill "$WS_PID"   2>/dev/null || true
  kill "$NEXT_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ── Wait for WS server ───────────────────────────────────────────────────────
for i in $(seq 1 15); do
  curl -sf http://localhost:4000/tables >/dev/null 2>&1 && break
  sleep 1
done

# ── Wait for Next.js ─────────────────────────────────────────────────────────
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/ >/dev/null 2>&1 && break
  sleep 1
done

echo "[smoke] WS  :4000 $(curl -s http://localhost:4000/tables | python3 -c 'import sys,json; t=json.load(sys.stdin)["tables"]; print(f"{len(t)} tables")')"
echo "[smoke] Next:3000 $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)"

# ── Run Playwright script ─────────────────────────────────────────────────────
PLAYWRIGHT_MODULE="$PLAYWRIGHT_MOD" node "$SCRIPT"
