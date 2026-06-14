#!/bin/bash
# Run this from your local machine (not the cloud editor).
# It decrypts .env, sets Fly secrets, and deploys the WS game server.
#
# Usage:
#   ENV_PASSPHRASE="<your-passphrase-from-password-manager>" bash scripts/fly-deploy.sh
#
# First-time only: installs flyctl and creates the Fly app.
# Subsequent deploys: just runs `fly deploy`.

set -euo pipefail
cd "$(dirname "$0")/.."

# ── 1. flyctl ────────────────────────────────────────────────────────────────
if ! command -v fly &>/dev/null; then
  echo "Installing flyctl..."
  curl -fsSL https://fly.io/install.sh | sh
  export PATH="$HOME/.fly/bin:$PATH"
fi

# ── 2. Auth ──────────────────────────────────────────────────────────────────
if ! fly auth whoami &>/dev/null 2>&1; then
  echo "Not logged in — opening browser..."
  fly auth login
fi

# ── 3. Decrypt .env if needed ────────────────────────────────────────────────
if [ ! -f .env ] && [ -f .env.enc ]; then
  if [ -z "${ENV_PASSPHRASE:-}" ]; then
    echo "❌ ENV_PASSPHRASE is not set — copy it from your password manager"
    exit 1
  fi
  openssl enc -d -aes-256-cbc -pbkdf2 -pass env:ENV_PASSPHRASE -in .env.enc -out .env
  echo "✅ .env decrypted"
fi

[ -f .env ] || { echo "❌ .env not found — decrypt .env.enc first"; exit 1; }

# Source .env (strip comments and blank lines)
set -a
# shellcheck disable=SC1090
source <(grep -E '^[A-Z_]+=.+' .env | grep -v '^#')
set +a

# ── 4. Create app (first time only) ──────────────────────────────────────────
if ! fly status --app pokerpals-server &>/dev/null 2>&1; then
  echo "Creating Fly app pokerpals-server..."
  fly launch --no-deploy --name pokerpals-server --region iad --yes
fi

# ── 5. Set secrets ───────────────────────────────────────────────────────────
echo "Setting Fly secrets..."
fly secrets set \
  OPERATOR_PRIVATE_KEY="${OPERATOR_PRIVATE_KEY}" \
  OPS_WALLET_KEY="${OPS_WALLET_KEY}" \
  ANTIBOT_ORACLE_KEY="${ANTIBOT_ORACLE_KEY}" \
  ARB_SEPOLIA_RPC="${ARB_SEPOLIA_RPC}" \
  NEXT_PUBLIC_CHIPS_TOKEN="${NEXT_PUBLIC_CHIPS_TOKEN}" \
  NEXT_PUBLIC_ESCROW="${NEXT_PUBLIC_ESCROW}" \
  NEXT_PUBLIC_STAKING="${NEXT_PUBLIC_STAKING}" \
  NEXT_PUBLIC_REFERRAL="${NEXT_PUBLIC_REFERRAL}" \
  NEXT_PUBLIC_TOURNAMENT="${NEXT_PUBLIC_TOURNAMENT}" \
  NEXT_PUBLIC_TABLE_REGISTRY="${NEXT_PUBLIC_TABLE_REGISTRY}" \
  TESTNET_SKIP_CHAIN_VERIFY="${TESTNET_SKIP_CHAIN_VERIFY:-true}" \
  TESTNET_SKIP_HUMAN_CHECK="${TESTNET_SKIP_HUMAN_CHECK:-true}" \
  --app pokerpals-server

# ── 6. Deploy ─────────────────────────────────────────────────────────────────
echo "Deploying..."
fly deploy --app pokerpals-server

echo ""
echo "✅ Deploy complete!"
echo "   WS URL: wss://pokerpals-server.fly.dev"
echo ""
echo "Next: set in Vercel environment variables:"
echo "   NEXT_PUBLIC_WS_URL=wss://pokerpals-server.fly.dev"
