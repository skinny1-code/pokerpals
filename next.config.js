/** @type {import('next').NextConfig} */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-load contract addresses from deployment JSON if not already in .env
// This means you never need to run setup:env manually — just deploy and go.
function loadDeployedAddresses() {
  for (const net of ['arbitrumSepolia', 'arbitrum']) {
    const p = join(__dirname, 'deployments', `${net}.json`);
    if (!existsSync(p)) continue;
    const c = JSON.parse(readFileSync(p, 'utf8')).contracts;
    return {
      NEXT_PUBLIC_CHIPS_TOKEN:    c.PvPToken       || c.ChipsToken       || '',
      NEXT_PUBLIC_ESCROW:         c.PokerEscrow    || '',
      NEXT_PUBLIC_STAKING:        c.PvPStaking     || c.ChipsStaking     || '',
      NEXT_PUBLIC_REFERRAL:       c.ReferralRegistry  || '',
      NEXT_PUBLIC_TOURNAMENT:     c.TournamentManager || '',
      NEXT_PUBLIC_TABLE_REGISTRY: c.TableRegistry  || '',
      NEXT_PUBLIC_POKER_HANDLE:   c.PokerHandle    || '',
    };
  }
  return {};
}

const deployed = loadDeployedAddresses();

// Merge: .env values win if set, deployment JSON fills in the blanks
const env = {};
for (const [k, v] of Object.entries(deployed)) {
  env[k] = process.env[k] || v;
}

const nextConfig = {
  reactStrictMode: true,
  env,
};

export default nextConfig;
