// scripts/deploy.js — deploys all PokerVsPals contracts in order
// npx hardhat run scripts/deploy.js
// Set DEPLOY_NETWORK=arbitrum for mainnet; defaults to arbitrumSepolia
import "dotenv/config";
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_NETWORKS = ["arbitrumSepolia", "arbitrum"];
const CHAIN_IDS      = { arbitrumSepolia: "421614", arbitrum: "42161" };

const networkName = process.env.DEPLOY_NETWORK || "arbitrumSepolia";
if (!VALID_NETWORKS.includes(networkName)) {
  throw new Error(`Unknown DEPLOY_NETWORK="${networkName}". Valid: ${VALID_NETWORKS.join(", ")}`);
}

async function main() {
  const conn = await network.connect({ network: networkName });
  const ethers = conn.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const OPERATOR  = process.env.OPERATOR_SIGNER  || deployer.address;
  const RAKE_ADDR = process.env.RAKE_WALLET       || deployer.address;
  const ORACLE    = process.env.ANTIBOT_ORACLE    || deployer.address;
  const DEV       = process.env.DEV_WALLET        || deployer.address;
  const OPS       = process.env.OPS_WALLET        || deployer.address;
  const COMMUNITY = process.env.COMMUNITY_WALLET  || deployer.address;
  const LIQUIDITY = process.env.LIQUIDITY_WALLET  || deployer.address;

  // 1. ChipsToken
  //    Mints: 10% dev (vested in-contract), 10% community, 10% ops, 50% liquidity,
  //    20% staking pool to deployer (transferred to staking contract in step 6).
  const Token = await ethers.getContractFactory("ChipsToken");
  const token = await Token.deploy(DEV, COMMUNITY, LIQUIDITY, OPS);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("✅ ChipsToken:", tokenAddr);

  // 2. ChipsStaking
  const Staking = await ethers.getContractFactory("ChipsStaking");
  const staking = await Staking.deploy(tokenAddr);
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();
  console.log("✅ ChipsStaking:", stakingAddr);

  // 3. ReferralRegistry
  const Referral = await ethers.getContractFactory("ReferralRegistry");
  const referral = await Referral.deploy(tokenAddr);
  await referral.waitForDeployment();
  const referralAddr = await referral.getAddress();
  console.log("✅ ReferralRegistry:", referralAddr);

  // 4. PokerEscrow
  const Escrow = await ethers.getContractFactory("PokerEscrow");
  const escrow = await Escrow.deploy(
    tokenAddr, OPERATOR, RAKE_ADDR, ORACLE, stakingAddr, referralAddr
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✅ PokerEscrow:", escrowAddr);

  // 5. TournamentManager
  const Tourn = await ethers.getContractFactory("TournamentManager");
  const tourn = await Tourn.deploy(tokenAddr, OPERATOR, RAKE_ADDR, ORACLE, stakingAddr);
  await tourn.waitForDeployment();
  const tournAddr = await tourn.getAddress();
  console.log("✅ TournamentManager:", tournAddr);

  // 6. TableRegistry
  const Registry = await ethers.getContractFactory("TableRegistry");
  const registry = await Registry.deploy(tokenAddr, RAKE_ADDR, stakingAddr);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("✅ TableRegistry:", registryAddr);

  // 7. PokerHandle — username NFT (burn 5,000 CHIPS to mint at tier-0)
  const Handle = await ethers.getContractFactory("PokerHandle");
  const handle = await Handle.deploy(tokenAddr);
  await handle.waitForDeployment();
  const handleAddr = await handle.getAddress();
  console.log("✅ PokerHandle:", handleAddr);

  // 7. Seed staking yield pool: transfer 200M CHIPS from deployer → staking
  const STAKING_POOL = ethers.parseUnits("200000000", 18);
  await token.transfer(stakingAddr, STAKING_POOL);
  await staking.initYieldPool();
  console.log("✅ Staking yield pool seeded with 200M CHIPS");

  // 8+9. Authorize yield sources and referral registry — all independent, batch in parallel
  {
    const n = await deployer.getNonce('pending');
    const [a, b, c, d, e] = await Promise.all([
      staking.setYieldSource(escrowAddr,    true, { nonce: n }),
      staking.setYieldSource(tournAddr,     true, { nonce: n + 1 }),
      staking.setYieldSource(registryAddr,  true, { nonce: n + 2 }),
      referral.setAuthorized(escrowAddr,    true, { nonce: n + 3 }),
      referral.setAuthorized(tournAddr,     true, { nonce: n + 4 }),
    ]);
    await Promise.all([a.wait(), b.wait(), c.wait(), d.wait(), e.wait()]);
  }
  console.log("✅ Yield sources authorized (escrow + tournament + registry)");
  console.log("✅ Referral registry authorized");

  // 10+11. Wire escrow → table registry and token → escrow factory — independent, batch in parallel
  {
    const n = await deployer.getNonce('pending');
    const [f, g] = await Promise.all([
      escrow.setTableRegistry(registryAddr, { nonce: n }),
      token.setEscrowFactory(escrowAddr,    { nonce: n + 1 }),
    ]);
    await Promise.all([f.wait(), g.wait()]);
  }
  console.log("✅ PokerEscrow wired to TableRegistry");
  console.log("✅ Token wired to escrow");

  console.log("\n── Role wallets used in this deploy ──────────────────");
  console.log(`Deployer:          ${deployer.address}`);
  console.log(`Operator signer:   ${OPERATOR}`);
  console.log(`Rake recipient:    ${RAKE_ADDR}   ← personal income stream`);
  console.log(`Anti-bot oracle:   ${ORACLE}`);
  console.log(`Dev wallet:        ${DEV}   ← personal equity (100M CHIPS vested 24 mo)`);
  console.log(`Ops wallet:        ${OPS}   ← devops budget (100M CHIPS)`);
  console.log(`Community wallet:  ${COMMUNITY}   ← 100M CHIPS`);
  console.log(`Liquidity wallet:  ${LIQUIDITY}   ← 500M CHIPS`);
  console.log("\n── Token economy ─────────────────────────────────────");
  console.log("  10% Dev       — 100M CHIPS, vested linearly over 24 months");
  console.log("  20% Staking   — 200M CHIPS, seeded into yield pool");
  console.log("  10% Ops       — 100M CHIPS → ops wallet (devops budget)");
  console.log("  10% Community — 100M CHIPS → community wallet");
  console.log("  50% Liquidity — 500M CHIPS → liquidity wallet");
  console.log("\n── Rake split per hand ───────────────────────────────");
  console.log("  35% burned | 35% staking yield | 20% treasury | 10% referral");
  console.log("\n── Room lease fee split ──────────────────────────────");
  console.log("  35% burned | 35% staking yield | 30% treasury");
  console.log("\n── Handle NFT ────────────────────────────────────────");
  console.log("  Mint cost: 5,000 CHIPS burned tier-0 (rises with supply — see PokerHandle.tierCosts)");
  console.log("  Fully on-chain SVG — no IPFS needed");

  // Save deployment manifest
  const deplDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(deplDir)) fs.mkdirSync(deplDir, { recursive: true });
  fs.writeFileSync(
    path.join(deplDir, `${networkName}.json`),
    JSON.stringify({
      network: networkName,
      chainId: CHAIN_IDS[networkName],
      deployedAt: new Date().toISOString(),
      deployer: deployer.address,
      contracts: {
        ChipsToken:        tokenAddr,
        ChipsStaking:      stakingAddr,
        ReferralRegistry:  referralAddr,
        PokerEscrow:       escrowAddr,
        TournamentManager: tournAddr,
        TableRegistry:     registryAddr,
        PokerHandle:       handleAddr,
      },
    }, null, 2)
  );
  console.log(`✅ deployments/${networkName}.json saved`);

  // Auto-write contract addresses into .env
  const envArgs = [
    `NEXT_PUBLIC_CHIPS_TOKEN=${tokenAddr}`,
    `NEXT_PUBLIC_ESCROW=${escrowAddr}`,
    `NEXT_PUBLIC_STAKING=${stakingAddr}`,
    `NEXT_PUBLIC_REFERRAL=${referralAddr}`,
    `NEXT_PUBLIC_TOURNAMENT=${tournAddr}`,
    `NEXT_PUBLIC_TABLE_REGISTRY=${registryAddr}`,
    `NEXT_PUBLIC_POKER_HANDLE=${handleAddr}`,
  ].join(" ");
  try {
    execSync(`node ${__dirname}/updateEnv.js ${envArgs}`, { stdio: "inherit" });
    console.log("\n✅ Contract addresses written to .env automatically");
  } catch {
    console.log("\n── Paste into .env manually if auto-write failed ─────");
    console.log(`NEXT_PUBLIC_CHIPS_TOKEN=${tokenAddr}`);
    console.log(`NEXT_PUBLIC_ESCROW=${escrowAddr}`);
    console.log(`NEXT_PUBLIC_STAKING=${stakingAddr}`);
    console.log(`NEXT_PUBLIC_REFERRAL=${referralAddr}`);
    console.log(`NEXT_PUBLIC_TOURNAMENT=${tournAddr}`);
    console.log(`NEXT_PUBLIC_TABLE_REGISTRY=${registryAddr}`);
    console.log(`NEXT_PUBLIC_POKER_HANDLE=${handleAddr}`);
  }
  console.log("──────────────────────────────────────────────────────");
}

main().catch(e => { console.error(e); process.exit(1); });
