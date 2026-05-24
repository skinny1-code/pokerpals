#!/bin/bash
set -euo pipefail

# Only run in remote (cloud) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install dependencies
npm install

# ── Reconstruct .env from session environment variables ───────────────────────
# Add your secrets at code.claude.com → Session settings → Environment variables.
# The contract NEXT_PUBLIC_* addresses are filled automatically from
# deployments/arbitrumSepolia.json via `npm run setup:env` below.

ENV_FILE="$CLAUDE_PROJECT_DIR/.env"
> "$ENV_FILE"

write_env() {
  local key="$1"
  local val="${!key:-}"
  if [ -n "$val" ]; then
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

# Private keys & role wallets
write_env DEPLOYER_KEY
write_env OPERATOR_PRIVATE_KEY
write_env OPERATOR_SIGNER
write_env RAKE_WALLET
write_env RAKE_WALLET_KEY
write_env ANTIBOT_ORACLE
write_env ANTIBOT_ORACLE_KEY
write_env DEV_WALLET
write_env DEV_WALLET_KEY
write_env OPS_WALLET
write_env OPS_WALLET_KEY
write_env COMMUNITY_WALLET
write_env COMMUNITY_WALLET_KEY
write_env LIQUIDITY_WALLET
write_env LIQUIDITY_WALLET_KEY

# RPC endpoints
write_env ARB_SEPOLIA_RPC
write_env ARB_RPC

# API keys
write_env ALCHEMY_API_KEY
write_env GITCOIN_PASSPORT_API
write_env GITCOIN_SCORER_ID
write_env ARBISCAN_API_KEY

# Game server flags
write_env TESTNET_SKIP_HUMAN_CHECK

# Frontend
write_env NEXT_PUBLIC_WC_PROJECT_ID
write_env NEXT_PUBLIC_TRANSAK_API_KEY
write_env NEXT_PUBLIC_CHAIN_ID
write_env NEXT_PUBLIC_WS_URL

# Fill NEXT_PUBLIC_* contract addresses from deployments/arbitrumSepolia.json
if [ -f "$CLAUDE_PROJECT_DIR/deployments/arbitrumSepolia.json" ]; then
  echo "Syncing contract addresses from deployment..."
  node "$CLAUDE_PROJECT_DIR/scripts/setupEnv.js" 2>/dev/null || true
fi

echo "✅ .env ready"
