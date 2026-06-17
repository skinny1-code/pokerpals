#!/usr/bin/env node
// scripts/setupEnv.js
// Re-syncs .env with contract addresses from the latest deployment JSON.
// Run: npm run setup:env

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT     = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const NETWORKS = ["arbitrumSepolia", "arbitrum"];

function loadDeployment() {
  for (const net of NETWORKS) {
    const p = path.join(ROOT, "deployments", `${net}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return null;
}

function setEnvKey(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  return re.test(content) ? content.replace(re, line) : content + `\n${line}`;
}

const depl = loadDeployment();
if (!depl) {
  console.error("❌ No deployment JSON found in deployments/. Run npm run deploy:testnet first.");
  process.exit(1);
}

const c = depl.contracts;
let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";

const keys = {
  NEXT_PUBLIC_CHIPS_TOKEN:    c.PvPToken          || c.ChipsToken          || "",
  NEXT_PUBLIC_ESCROW:         c.PokerEscrow        || "",
  NEXT_PUBLIC_STAKING:        c.PvPStaking         || c.ChipsStaking        || "",
  NEXT_PUBLIC_REFERRAL:       c.ReferralRegistry   || "",
  NEXT_PUBLIC_TOURNAMENT:     c.TournamentManager  || "",
  NEXT_PUBLIC_TABLE_REGISTRY: c.TableRegistry      || "",
  NEXT_PUBLIC_POKER_HANDLE:   c.PokerHandle        || "",
  NEXT_PUBLIC_KINGS_POOL:     c.KingOfSpadesPool   || "",
  NEXT_PUBLIC_PROMOTIONS_POOL: c.PromotionsPool    || "",
  NEXT_PUBLIC_STABLECOIN_POOL: c.StablecoinPool    || "",
  NEXT_PUBLIC_LIQUIDITY_POOL: c.ChipsLiquidityPool || "",
  NEXT_PUBLIC_MOCK_USDC:      c.MockUSDC           || "",
};

for (const [key, value] of Object.entries(keys)) {
  env = setEnvKey(env, key, value);
}

fs.writeFileSync(ENV_PATH, env);

console.log("\n✅ .env updated from", depl.network, "deployment");
console.log("   Deployer:", depl.deployer);
console.log("   Deployed:", depl.deployedAt);
console.log("");
for (const [key, value] of Object.entries(keys)) {
  const status = value ? "✅" : "⚠️  (not deployed)";
  console.log(`   ${status} ${key}=${value || "empty"}`);
}
console.log("");

if (!keys.NEXT_PUBLIC_ESCROW) {
  console.error("❌ NEXT_PUBLIC_ESCROW is missing — redeploy with: npm run deploy:testnet");
  process.exit(1);
}

if (!process.env.OPERATOR_PRIVATE_KEY && !env.match(/^OPERATOR_PRIVATE_KEY=0x[0-9a-fA-F]{64}/m)) {
  console.warn("⚠️  OPERATOR_PRIVATE_KEY not set in .env — server won't start without it");
}

console.log("Run 'npm run server' to start.");
