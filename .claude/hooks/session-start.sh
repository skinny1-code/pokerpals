#!/bin/bash
set -euo pipefail

# Only run in remote (cloud) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install dependencies
npm install

ENV_FILE="$CLAUDE_PROJECT_DIR/.env"

# ── Decrypt .env from committed .env.enc ─────────────────────────────────────
# Passphrase is the Alchemy API key (embedded in RPC URLs, not a new secret).
PASS="${ALCHEMY_API_KEY:-d9thqdp49ecerdec}"
if [ -f "$CLAUDE_PROJECT_DIR/.env.enc" ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$PASS" \
    -in "$CLAUDE_PROJECT_DIR/.env.enc" \
    -out "$ENV_FILE" 2>/dev/null && echo "✅ .env decrypted from .env.enc"
fi

# ── Overlay fresh contract addresses from deployment manifest ─────────────────
if [ -f "$CLAUDE_PROJECT_DIR/deployments/arbitrumSepolia.json" ]; then
  echo "Syncing contract addresses from deployment..."
  node "$CLAUDE_PROJECT_DIR/scripts/setupEnv.js" 2>/dev/null || true
fi

echo "✅ .env ready"
