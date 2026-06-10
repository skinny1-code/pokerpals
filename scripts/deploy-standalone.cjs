#!/usr/bin/env node
// Standalone deploy — CommonJS, pure ethers v5, no Hardhat
// Usage: node scripts/deploy-standalone.cjs
"use strict";

const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

// Parse .env manually
const envRaw = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const RPC       = env.ARB_SEPOLIA_RPC;
const DEP_KEY   = env.DEPLOYER_KEY && !env.DEPLOYER_KEY.startsWith("0x")
                  ? "0x" + env.DEPLOYER_KEY : env.DEPLOYER_KEY;
const OPERATOR  = env.OPERATOR_SIGNER  || null;
const RAKE_ADDR = env.RAKE_WALLET      || null;
const ORACLE    = env.ANTIBOT_ORACLE   || null;
const DEV       = env.DEV_WALLET       || null;
const OPS       = env.OPS_WALLET       || null;
const COMMUNITY = env.COMMUNITY_WALLET || null;
const LIQUIDITY = env.LIQUIDITY_WALLET || null;

if (!RPC)     { console.error("Missing ARB_SEPOLIA_RPC in .env"); process.exit(1); }
if (!DEP_KEY) { console.error("Missing DEPLOYER_KEY in .env");    process.exit(1); }

function artifact(name) {
  return JSON.parse(fs.readFileSync(
    path.join(root, `artifacts/contracts/${name}.sol/${name}.json`), "utf8"
  ));
}

async function main() {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    RPC, { chainId: 421614, name: "arbitrum-sepolia" }
  );
  const deployer = new ethers.Wallet(DEP_KEY, provider);

  console.log("Deployer:", deployer.address);
  const bal = await provider.getBalance(deployer.address);
  console.log("ETH balance:", ethers.utils.formatEther(bal));
  if (bal.isZero()) { console.error("Deployer has no ETH"); process.exit(1); }

  const dep = deployer.address;
  const op  = OPERATOR  || dep;
  const rk  = RAKE_ADDR || dep;
  const or  = ORACLE    || dep;

  async function deploy(name, args) {
    const { abi, bytecode } = artifact(name);
    const factory  = new ethers.ContractFactory(abi, bytecode, deployer);
    const contract = await factory.deploy(...args);
    await contract.deployed();
    console.log("✅", name + ":", contract.address);
    return contract;
  }

  const token    = await deploy("ChipsToken",        [DEV||dep, COMMUNITY||dep, LIQUIDITY||dep, OPS||dep]);
  const staking  = await deploy("ChipsStaking",      [token.address]);
  const referral = await deploy("ReferralRegistry",  [token.address]);
  const escrow   = await deploy("PokerEscrow",       [token.address, op, rk, or, staking.address, referral.address]);
  const tourn    = await deploy("TournamentManager", [token.address, op, rk, or, staking.address]);
  const registry = await deploy("TableRegistry",     [token.address, rk, staking.address]);
  const handle   = await deploy("PokerHandle",       [token.address]);

  // Seed staking pool
  console.log("Seeding staking pool...");
  const STAKING_POOL = ethers.utils.parseUnits("200000000", 18);
  let tx = await token.transfer(staking.address, STAKING_POOL);
  await tx.wait();
  tx = await staking.initYieldPool();
  await tx.wait();
  console.log("✅ Staking pool seeded (200M CHIPS)");

  // Authorize yield sources — sequential submit, parallel confirm
  const n = await deployer.getTransactionCount("pending");
  const a = await staking.setYieldSource(escrow.address,    true, { nonce: n });
  const b = await staking.setYieldSource(tourn.address,     true, { nonce: n + 1 });
  const c = await staking.setYieldSource(registry.address,  true, { nonce: n + 2 });
  const d = await referral.setAuthorized(escrow.address,    true, { nonce: n + 3 });
  const e = await referral.setAuthorized(tourn.address,     true, { nonce: n + 4 });
  await Promise.all([a.wait(), b.wait(), c.wait(), d.wait(), e.wait()]);
  console.log("✅ Yield sources + referral authorized");

  // Wire contracts
  const n2 = await deployer.getTransactionCount("pending");
  const f  = await escrow.setTableRegistry(registry.address, { nonce: n2 });
  const g  = await token.setEscrowFactory(escrow.address,    { nonce: n2 + 1 });
  await Promise.all([f.wait(), g.wait()]);
  console.log("✅ Escrow wired");

  // Save manifest
  const manifest = {
    network: "arbitrumSepolia", chainId: "421614",
    deployedAt: new Date().toISOString(), deployer: deployer.address,
    contracts: {
      ChipsToken: token.address, ChipsStaking: staking.address,
      ReferralRegistry: referral.address, PokerEscrow: escrow.address,
      TournamentManager: tourn.address, TableRegistry: registry.address,
      PokerHandle: handle.address,
    },
  };
  fs.mkdirSync(path.join(root, "deployments"), { recursive: true });
  fs.writeFileSync(path.join(root, "deployments/arbitrumSepolia.json"), JSON.stringify(manifest, null, 2));

  // Update .env
  const pairs = {
    NEXT_PUBLIC_CHIPS_TOKEN:    token.address,
    NEXT_PUBLIC_ESCROW:         escrow.address,
    NEXT_PUBLIC_STAKING:        staking.address,
    NEXT_PUBLIC_REFERRAL:       referral.address,
    NEXT_PUBLIC_TOURNAMENT:     tourn.address,
    NEXT_PUBLIC_TABLE_REGISTRY: registry.address,
    NEXT_PUBLIC_POKER_HANDLE:   handle.address,
  };
  let out = envRaw;
  for (const [k, v] of Object.entries(pairs)) {
    out = new RegExp(`^${k}=.*$`, "m").test(out) ? out.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : out + `\n${k}=${v}`;
  }
  fs.writeFileSync(path.join(root, ".env"), out);

  console.log("\n── New addresses ──────────────────────────────────────");
  for (const [k, v] of Object.entries(pairs)) console.log(`${k}=${v}`);
  console.log("\n✅ deployments/arbitrumSepolia.json + .env updated");
}

main().catch(e => { console.error(e); process.exit(1); });
