#!/usr/bin/env bash
# scripts/healthcheck.sh — pre-test readiness check for Saloon (testnet)
#
# Confirms the three live layers a tester depends on are actually up:
#   1. Frontend  (Vercel)        — the site loads
#   2. Game server (Fly.io, WS)  — /tables responds; without this NO table works
#   3. Contracts (Arb. Sepolia)  — PokerEscrow has bytecode (optional: needs an RPC)
#
# Usage:
#   bash scripts/healthcheck.sh
#
# Override any default with an env var:
#   SITE_URL=https://pokervsplayer.xyz \
#   WS_URL=wss://pokerpals-server.fly.dev \
#   ARB_SEPOLIA_RPC=https://... \
#   bash scripts/healthcheck.sh
#
# Dependencies: bash, curl, grep, sed (no Node required) — runs fine on Termux.

set -u

SITE_URL="${SITE_URL:-https://pokervsplayer.xyz}"
WS_URL="${WS_URL:-wss://pokerpals-server.fly.dev}"
# Health endpoint = the WS host over https, /tables (the server serves it as plain HTTP)
HEALTH_URL="$(printf '%s' "$WS_URL" | sed -E 's#^wss?://#https://#')/tables"
ESCROW="${NEXT_PUBLIC_ESCROW:-0x3CACF9dcA501503761505cb3F1123c387a567d65}"
RPC="${ARB_SEPOLIA_RPC:-}"

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }
info() { printf '  \033[36mℹ\033[0m %s\n' "$1"; }

echo "Saloon — testnet readiness check"
echo "========================================"

# 1. Frontend ----------------------------------------------------------------
echo "Frontend  ($SITE_URL)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE_URL" 2>/dev/null) || code=000
if [ "$code" = "200" ]; then
  ok "site responds HTTP 200"
else
  bad "site returned HTTP $code (expected 200)"
fi

# 2. Game server (the critical multiplayer dependency) -----------------------
echo "Game server  ($HEALTH_URL)"
body=$(curl -s --max-time 20 "$HEALTH_URL" 2>/dev/null || echo "")
if printf '%s' "$body" | grep -q '"tables"'; then
  ok "WS server reachable — /tables returns JSON"
else
  bad "WS server NOT reachable / no table JSON — multiplayer will NOT work"
  info "fix: deploy it (e.g. 'fly deploy') and set Vercel NEXT_PUBLIC_WS_URL=$WS_URL"
fi

# 3. Contracts (optional — only runs if an RPC is provided) -------------------
echo "Contracts  (PokerEscrow $ESCROW)"
if [ -n "$RPC" ]; then
  result=$(curl -s --max-time 20 -X POST "$RPC" \
    -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$ESCROW\",\"latest\"]}" \
    2>/dev/null | grep -oE '"result":"0x[0-9a-fA-F]*"' || echo "")
  if printf '%s' "$result" | grep -qE '0x[0-9a-fA-F]{10,}'; then
    ok "PokerEscrow has bytecode on-chain"
  else
    bad "no bytecode at $ESCROW — wrong address or not deployed"
  fi
else
  info "set ARB_SEPOLIA_RPC to auto-verify contract deployment (skipped)"
fi

# Manual gates the script can't check ---------------------------------------
echo "----------------------------------------"
echo "Manual gates (verify by hand before inviting testers):"
echo "  • WalletConnect: add $SITE_URL to allowed origins on cloud.reown.com"
echo "    (else wallet connect fails with 'origin not allowed' / close code 3000)"
echo "  • Game server secrets: OPERATOR_PRIVATE_KEY matches the escrow operatorSigner,"
echo "    plus ARB_SEPOLIA_RPC and TESTNET_SKIP_HUMAN_CHECK=true"
echo "  • Testers funded: Arbitrum Sepolia ETH (gas) + CHIPS (npm run faucet)"

# Summary --------------------------------------------------------------------
echo "========================================"
if [ "$fail" -eq 0 ]; then
  printf '\033[32mAll %d automated checks passed.\033[0m Confirm the manual gates above, then go.\n' "$pass"
  exit 0
else
  printf '\033[31m%d of %d automated checks FAILED.\033[0m Fix the ✗ items before testing.\n' "$fail" "$((pass + fail))"
  exit 1
fi
