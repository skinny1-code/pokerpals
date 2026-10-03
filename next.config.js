/** @type {import('next').NextConfig} */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-load contract addresses from deployment JSON if not already in .env
// This means you never need to run setup:env manually — just deploy and go.
function loadDeployedAddresses() {
  // Order = precedence: the first manifest that exists wins. Mainnet target is
  // Robinhood Chain (4663); Arbitrum Sepolia stays the testnet. Once
  // deployments/robinhood.json exists it takes over from the testnet manifest.
  for (const net of ['robinhood', 'robinhoodTestnet', 'arbitrumSepolia', 'arbitrum']) {
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
      NEXT_PUBLIC_HAND_HISTORY:   c.HandHistory    || '',
      NEXT_PUBLIC_LOTTERY:        c.StakerLottery  || '',
      ...(d.deployBlock ? { NEXT_PUBLIC_DEPLOY_BLOCK: String(d.deployBlock) } : {}),
    };
  }
  return {};
}

const deployed = loadDeployedAddresses();

// Merge: the committed deployment manifest wins; env values only fill blanks.
// Env vars set in a hosting dashboard (Vercel) are a snapshot that rots
// silently across contract redeploys — the manifest is updated by every
// deploy script and committed, so it is always the current generation.
// (Stale Vercel vars once had the live frontend reading balances and
// humanVerified from a retired contract generation.)
const env = {};
for (const [k, v] of Object.entries(deployed)) {
  if (v && process.env[k] && process.env[k].toLowerCase() !== v.toLowerCase()) {
    console.warn(`[next.config] WARNING: ${k} env (${process.env[k]}) differs from deployment manifest (${v}) — using the manifest. Remove or update the stale env var.`);
  }
  env[k] = v || process.env[k];
}

// MetaMask SDK and WalletConnect pull in React Native / Node-only modules.
// Turbopack needs a real stub file; webpack accepts false (empty module).
const STUB_MODULES = [
  '@react-native-async-storage/async-storage',
  'pino-pretty',
];

// Security response headers. Deliberately conservative: we set clickjacking
// protection (scoped to still allow the Farcaster Mini App to embed us) plus the
// safe hardening headers, but NOT a strict script/style/connect CSP — this app
// uses inline styles and third-party wallet SDKs throughout, so a strict CSP
// needs dedicated testing before it can ship without breaking the site.
const FARCASTER_FRAME_ANCESTORS = "frame-ancestors 'self' https://warpcast.com https://*.warpcast.com https://farcaster.xyz https://*.farcaster.xyz";
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: FARCASTER_FRAME_ANCESTORS },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise "X-Powered-By: Next.js"
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
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
