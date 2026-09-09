#!/usr/bin/env bash
# Smoke-test launcher for All In.
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
# Kill by listening port, NOT by command pattern. A broad `pkill -f
# "node.*server/index.js"` also matches the Claude Code harness's own node
# process in web/CI sessions and tears down the session (exit 144). `fuser -k`
# is scoped to whatever holds the port, so it only reaps our own servers.
fuser -k 4000/tcp >/dev/null 2>&1 || true
fuser -k 3000/tcp >/dev/null 2>&1 || true

# ── Operator key for the WS server ───────────────────────────────────────────
# The server requires OPERATOR_PRIVATE_KEY (it signs settlement payouts). In web
# / CI sessions the SessionStart hook rewrites .env to contract addresses only,
# stripping the real secret — and we deliberately do NOT want the production
# settlement key inside an ephemeral sandbox anyway. If the key isn't already in
# the environment, mint a throwaway one in-memory: it boots the server, WS, and
# game loop without ever persisting a secret to disk or git. It signs nothing the
# deployed escrow would accept, so its blast radius if leaked is zero.
# TESTNET_SKIP_CHAIN_VERIFY lets table ops run without a reachable RPC.
if [ -z "${OPERATOR_PRIVATE_KEY:-}" ] && ! grep -q '^OPERATOR_PRIVATE_KEY=' .env 2>/dev/null; then
  OPERATOR_PRIVATE_KEY="$(node -e "console.log(require('ethers').Wallet.createRandom().privateKey)")"
  echo "[smoke] no OPERATOR_PRIVATE_KEY found — using an ephemeral throwaway key (not persisted)"
fi

# ── Start WS game server ─────────────────────────────────────────────────────
OPERATOR_PRIVATE_KEY="${OPERATOR_PRIVATE_KEY:-}" \
OPS_WALLET_KEY="${OPS_WALLET_KEY:-$OPERATOR_PRIVATE_KEY}" \
TESTNET_SKIP_CHAIN_VERIFY="${TESTNET_SKIP_CHAIN_VERIFY:-true}" \
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

# ── Wait for readiness ───────────────────────────────────────────────────────
# Plain poll loop: `&& break` exits on the first success, so it retries on ANY
# curl failure code — important because right after `fuser -k` the port can
# briefly return a TCP reset rather than a clean connection-refused, which
# `curl --retry-connrefused` would NOT retry. WS gets extra headroom since it
# competes with `next start` for CPU during cold boot.
for i in $(seq 1 40); do
  curl -sf http://localhost:4000/tables >/dev/null 2>&1 && break
  sleep 1
done
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/ >/dev/null 2>&1 && break
  sleep 1
done

# Tolerant summary — never abort the run (set -e) if the WS server is down.
# Two-step parse (assign then format): a backslash-escaped quote inside an
# f-string expression is a Python SyntaxError, so do the subscript first.
WS_TABLES="$(curl -s --max-time 4 http://localhost:4000/tables 2>/dev/null \
  | python3 -c 'import sys,json; t=json.load(sys.stdin)["tables"]; print(f"{len(t)} tables")' 2>/dev/null || echo "unreachable")"
echo "[smoke] WS  :4000 $WS_TABLES"
echo "[smoke] Next:3000 $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ || true)"

# ── Run Playwright script ─────────────────────────────────────────────────────
PLAYWRIGHT_MODULE="$PLAYWRIGHT_MOD" node "$SCRIPT"
