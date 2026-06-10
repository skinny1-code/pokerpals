// Standalone deploy — pure ethers v5, no Hardhat runtime
// Run from Termux: node scripts/deploy-standalone.mjs
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import pkg from "ethers";
const { ethers } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.resolve(__dirname, "..");
const require   = createRequire(import.meta.url);

// Load .env manually (dotenv not needed)
const envRaw = readFileSync(path.join(root, ".env"), "utf8");
const env = Object.fromEntries(
  envRaw.split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const RPC       = env.ARB_SEPOLIA_RPC;
const DEP_KEY   = env.DEPLOYER_KEY?.startsWith("0x") ? env.DEPLOYER_KEY : "0x" + env.DEPLOYER_KEY;
const DEV       = env.DEV_WALLET       || null;
const OPS       = env.OPS_WALLET       || null;
const COMMUNITY = env.COMMUNITY_WALLET || null;
const LIQUIDITY = env.LIQUIDITY_WALLET || null;

if (!RPC)     { console.error("Missing ARB_SEPOLIA_RPC in .env"); process.exit(1); }
if (!DEP_KEY) { console.error("Missing DEPLOYER_KEY in .env");    process.exit(1); }

const provider = new ethers.providers.StaticJsonRpcProvider(RPC, { chainId: 421614, name: "arbitrum-sepolia" });
const deployer = new ethers.Wallet(DEP_KEY, provider);

console.log("Deployer:", deployer.address);
const bal = await provider.getBalance(deployer.address);
console.log("ETH balance:", ethers.utils.formatEther(bal));
if (bal.isZero()) { console.error("Deployer has no ETH for gas"); process.exit(1); }

function artifact(name) {
  const p = path.join(root, `artifacts/contracts/${name}.sol/${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

async function deploy(name, args = []) {
  const { abi, bytecode } = artifact(name);
  const factory = new ethers.ContractFactory(abi, bytecode, deployer);
  const contract = await factory.deploy(...args);
  await contract.deployed();
  console.log(`✅ ${name}: ${contract.address}`);
  return contract;
}

const OPERATOR  = env.OPERATOR_SIGNER  || deployer.address;
const RAKE_ADDR = env.RAKE_WALLET      || deployer.address;
const ORACLE    = env.ANTIBOT_ORACLE   || deployer.address;
const STAKING_POOL = ethers.utils.parseUnits("200000000", 18);

// 1. ChipsToken
const token = await deploy("ChipsToken", [
  DEV       || deployer.address,
  COMMUNITY || deployer.address,
  LIQUIDITY || deployer.address,
  OPS       || deployer.address,
]);

// 2. ChipsStaking
const staking = await deploy("ChipsStaking", [token.address]);

// 3. ReferralRegistry
const referral = await deploy("ReferralRegistry", [token.address]);

// 4. PokerEscrow
const escrow = await deploy("PokerEscrow", [
  token.address, OPERATOR, RAKE_ADDR, ORACLE, staking.address, referral.address,
]);

// 5. TournamentManager
const tourn = await deploy("TournamentManager", [
  token.address, OPERATOR, RAKE_ADDR, ORACLE, staking.address,
]);

// 6. TableRegistry
const registry = await deploy("TableRegistry", [token.address, RAKE_ADDR, staking.address]);

// 7. PokerHandle
const handle = await deploy("PokerHandle", [token.address]);

// 8. Seed staking yield pool
console.log("Seeding staking pool...");
let tx = await token.transfer(staking.address, STAKING_POOL);
await tx.wait();
tx = await staking.initYieldPool();
await tx.wait();
console.log("✅ Staking yield pool seeded with 200M CHIPS");

// 9. Authorize yield sources (sequential submit, parallel confirm)
console.log("Authorizing yield sources...");
const n = (await deployer.getTransactionCount("pending"));
const a = await staking.setYieldSource(escrow.address,    true, { nonce: n });
const b = await staking.setYieldSource(tourn.address,     true, { nonce: n + 1 });
const c = await staking.setYieldSource(registry.address,  true, { nonce: n + 2 });
const d = await referral.setAuthorized(escrow.address,    true, { nonce: n + 3 });
const e = await referral.setAuthorized(tourn.address,     true, { nonce: n + 4 });
await Promise.all([a.wait(), b.wait(), c.wait(), d.wait(), e.wait()]);
console.log("✅ Yield sources + referral authorized");

// 10. Wire contracts
const n2 = (await deployer.getTransactionCount("pending"));
const f = await escrow.setTableRegistry(registry.address, { nonce: n2 });
const g = await token.setEscrowFactory(escrow.address,    { nonce: n2 + 1 });
await Promise.all([f.wait(), g.wait()]);
console.log("✅ Escrow wired to TableRegistry + Token");

// Save deployment manifest
const manifest = {
  network: "arbitrumSepolia",
  chainId: "421614",
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  contracts: {
    ChipsToken:        token.address,
    ChipsStaking:      staking.address,
    ReferralRegistry:  referral.address,
    PokerEscrow:       escrow.address,
    TournamentManager: tourn.address,
    TableRegistry:     registry.address,
    PokerHandle:       handle.address,
  },
};
mkdirSync(path.join(root, "deployments"), { recursive: true });
writeFileSync(path.join(root, "deployments/arbitrumSepolia.json"), JSON.stringify(manifest, null, 2));
console.log("✅ deployments/arbitrumSepolia.json saved");

// Update .env NEXT_PUBLIC_* values
const updates = {
  NEXT_PUBLIC_CHIPS_TOKEN:   token.address,
  NEXT_PUBLIC_ESCROW:        escrow.address,
  NEXT_PUBLIC_STAKING:       staking.address,
  NEXT_PUBLIC_REFERRAL:      referral.address,
  NEXT_PUBLIC_TOURNAMENT:    tourn.address,
  NEXT_PUBLIC_TABLE_REGISTRY: registry.address,
  NEXT_PUBLIC_POKER_HANDLE:  handle.address,
};
let envOut = envRaw;
for (const [k, v] of Object.entries(updates)) {
  const re = new RegExp(`^${k}=.*$`, "m");
  envOut = re.test(envOut) ? envOut.replace(re, `${k}=${v}`) : envOut + `\n${k}=${v}`;
}
writeFileSync(path.join(root, ".env"), envOut);
console.log("\n✅ .env updated with new contract addresses");
console.log("\n── New contract addresses ───────────────────────────");
for (const [k, v] of Object.entries(updates)) console.log(`${k}=${v}`);
