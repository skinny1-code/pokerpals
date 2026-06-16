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
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const c = d.contracts;
    return {
      NEXT_PUBLIC_CHIPS_TOKEN:    c.PvPToken       || c.ChipsToken       || '',
      NEXT_PUBLIC_ESCROW:         c.PokerEscrow    || '',
      NEXT_PUBLIC_STAKING:        c.PvPStaking     || c.ChipsStaking     || '',
      NEXT_PUBLIC_REFERRAL:       c.ReferralRegistry  || '',
      NEXT_PUBLIC_TOURNAMENT:     c.TournamentManager || '',
      NEXT_PUBLIC_TABLE_REGISTRY: c.TableRegistry  || '',
      NEXT_PUBLIC_POKER_HANDLE:   c.PokerHandle    || '',
      ...(d.deployBlock ? { NEXT_PUBLIC_DEPLOY_BLOCK: String(d.deployBlock) } : {}),
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

// MetaMask SDK and WalletConnect pull in React Native / Node-only modules.
// Turbopack needs a real stub file; webpack accepts false (empty module).
const STUB_MODULES = [
  '@react-native-async-storage/async-storage',
  'pino-pretty',
];

const nextConfig = {
  reactStrictMode: true,
  env,
  turbopack: {
    resolveAlias: Object.fromEntries(STUB_MODULES.map(m => [m, './src/stubs/empty.js'])),
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(STUB_MODULES.map(m => [m, false])),
    };
    return config;
  },
};

export default nextConfig;
