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
# ⚠ SECURITY: The fallback passphrase below is committed in plaintext.
# Anyone with repo read access can decrypt .env.enc with it.
# BEFORE MAINNET: rotate the Alchemy key, re-encrypt .env.enc with a new
# passphrase stored only in GitHub Secrets, and remove the hardcoded fallback.
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

# ── Seed Hardhat 3 compiler cache ────────────────────────────────────────────
# Network-restricted cloud sessions can't download solc binaries. Copy the
# soljson.js already bundled in node_modules/solc (exact version 0.8.26) into
# the Hardhat compiler cache. A zero-byte native stub with .does.not.work causes
# Hardhat to fall through to the WASM compiler, which is available from
# node_modules.
SOLC_CACHE_DIR="$HOME/.cache/hardhat-nodejs/compilers-v3"
SOLJSON_SRC="$CLAUDE_PROJECT_DIR/node_modules/solc/soljson.js"
SOLJSON_FNAME="soljson-v0.8.26+commit.8a97fa7a.js"

if [ -f "$SOLJSON_SRC" ]; then
  SHA256=$(node -e "const {createHash}=require('crypto'),{readFileSync}=require('fs');console.log('0x'+createHash('sha256').update(readFileSync('$SOLJSON_SRC')).digest('hex'))")
  LIST_JSON="{\"builds\":[{\"path\":\"$SOLJSON_FNAME\",\"version\":\"0.8.26\",\"longVersion\":\"0.8.26+commit.8a97fa7a\",\"keccak256\":\"0x0000000000000000000000000000000000000000000000000000000000000000\",\"sha256\":\"$SHA256\",\"urls\":[]}],\"releases\":{\"0.8.26\":\"$SOLJSON_FNAME\"},\"latestRelease\":\"0.8.26\"}"

  mkdir -p "$SOLC_CACHE_DIR/wasm"
  cp "$SOLJSON_SRC" "$SOLC_CACHE_DIR/wasm/$SOLJSON_FNAME"
  echo "$LIST_JSON" > "$SOLC_CACHE_DIR/wasm/list.json"

  mkdir -p "$SOLC_CACHE_DIR/linux-amd64"
  touch "$SOLC_CACHE_DIR/linux-amd64/$SOLJSON_FNAME"
  touch "$SOLC_CACHE_DIR/linux-amd64/$SOLJSON_FNAME.does.not.work"
  echo "$LIST_JSON" > "$SOLC_CACHE_DIR/linux-amd64/list.json"

  echo "✅ Hardhat solc 0.8.26 cache seeded (WASM fallback)"
fi

echo "✅ .env ready"
