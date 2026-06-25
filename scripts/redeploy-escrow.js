// scripts/redeploy-escrow.js — redeploys only PokerEscrow, preserving all other contracts
// Usage: npx hardhat run scripts/redeploy-escrow.js --network arbitrumSepolia
import "dotenv/config";
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const networkName = process.env.DEPLOY_NETWORK || "arbitrumSepolia";

async function main() {
  const conn = await network.connect({ network: networkName });
  const ethers = conn.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const OPERATOR  = process.env.OPERATOR_SIGNER || deployer.address;
  const RAKE_ADDR = process.env.RAKE_WALLET      || deployer.address;
  const ORACLE    = process.env.ANTIBOT_ORACLE   || deployer.address;

  // Load existing deployment to reuse dependency addresses
  const deplPath = path.resolve(__dirname, `../deployments/${networkName}.json`);
  if (!fs.existsSync(deplPath)) {
    throw new Error(`No existing deployment found at ${deplPath}. Run deploy.js first.`);
  }
  const existing = JSON.parse(fs.readFileSync(deplPath, "utf8"));
  const {
    ChipsToken:       tokenAddr,
    ChipsStaking:     stakingAddr,
    ReferralRegistry: referralAddr,
    TableRegistry:    registryAddr,
    KingOfSpadesPool: kingsPoolAddr,
    PokerHandle:      handleAddr,
  } = existing.contracts;
  if (!tokenAddr || !stakingAddr || !referralAddr) {
    throw new Error("Missing required dependency address(es) in deployment JSON — run deploy.js first.");
  }
  const oldEscrowAddr = existing.contracts.PokerEscrow;
  console.log("Using ChipsToken:      ", tokenAddr);
  console.log("Using ChipsStaking:    ", stakingAddr);
  console.log("Using ReferralRegistry:", referralAddr);
  console.log("Using TableRegistry:   ", registryAddr || "(not deployed)");
  console.log("Using KingOfSpadesPool:", kingsPoolAddr || "(not deployed)");

  // Deploy new PokerEscrow — same constructor args pattern as scripts/deploy.js
  const Escrow = await ethers.getContractFactory("PokerEscrow");
  const escrow = await Escrow.deploy(tokenAddr, OPERATOR, RAKE_ADDR, ORACLE, stakingAddr, referralAddr);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✅ PokerEscrow (new):", escrowAddr);

  // Re-wire only the calls that reference the escrow address (mirrors scripts/deploy.js)
  const staking  = await ethers.getContractAt("ChipsStaking", stakingAddr);
  const referral = await ethers.getContractAt("ReferralRegistry", referralAddr);
  const token    = await ethers.getContractAt("ChipsToken", tokenAddr);

  await (await staking.setYieldSource(escrowAddr, true)).wait();
  console.log("✅ ChipsStaking: new escrow authorized as yield source");

  await (await referral.setAuthorized(escrowAddr, true)).wait();
  console.log("✅ ReferralRegistry: new escrow authorized");

  if (registryAddr) {
    await (await escrow.setTableRegistry(registryAddr)).wait();
    console.log("✅ PokerEscrow wired to TableRegistry");
  }

  if (kingsPoolAddr) {
    const kingsPool = await ethers.getContractAt("KingOfSpadesPool", kingsPoolAddr);
    await (await kingsPool.setAuthorized(escrowAddr, true)).wait();
    await (await escrow.setKingsPool(kingsPoolAddr)).wait();
    console.log("✅ KingOfSpadesPool wired to new escrow");
  } else {
    console.log("ℹ️  KingOfSpadesPool not deployed on this network — skipping (rake split degrades gracefully, PokerEscrow.sol settle())");
  }

  await (await token.setEscrowFactory(escrowAddr)).wait();
  console.log("✅ ChipsToken wired to new escrow");

  if (handleAddr) {
    await (await escrow.setPokerHandle(handleAddr)).wait();
    console.log("✅ PokerHandle wired to new escrow (isHandleEligible gate)");
  } else {
    console.log("ℹ️  PokerHandle not deployed on this network — skipping (createTable/buyIn will revert until set)");
  }

  // Update deployment JSON — keep all other contracts, replace only PokerEscrow.
  // The old escrow address is simply abandoned (testnet, nothing of value stranded).
  existing.contracts.PokerEscrow = escrowAddr;
  existing.deployedAt = new Date().toISOString();
  fs.writeFileSync(deplPath, JSON.stringify(existing, null, 2));
  console.log(`✅ deployments/${networkName}.json updated`);

  // Update .env
  const envArgs = `NEXT_PUBLIC_ESCROW=${escrowAddr}`;
  try {
    execSync(`node ${__dirname}/updateEnv.js ${envArgs}`, { stdio: "inherit" });
    console.log("✅ .env updated");
  } catch {
    console.log(`Paste into .env manually: NEXT_PUBLIC_ESCROW=${escrowAddr}`);
  }

  console.log("\nOld PokerEscrow address (abandoned):", oldEscrowAddr || "(none)");
  console.log("New PokerEscrow address:            ", escrowAddr);
}

main().catch(e => { console.error(e); process.exit(1); });
