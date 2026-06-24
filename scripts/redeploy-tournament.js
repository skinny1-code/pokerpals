// scripts/redeploy-tournament.js — redeploys only TournamentManager, preserving all other contracts
// Usage: npx hardhat run scripts/redeploy-tournament.js --network arbitrumSepolia
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

  // Load existing deployment to reuse dependency addresses
  const deplPath = path.resolve(__dirname, `../deployments/${networkName}.json`);
  if (!fs.existsSync(deplPath)) {
    throw new Error(`No existing deployment found at ${deplPath}. Run deploy.js first.`);
  }
  const existing = JSON.parse(fs.readFileSync(deplPath, "utf8"));
  const {
    ChipsToken:       tokenAddr,
    ChipsStaking:     stakingAddr,
    KingOfSpadesPool: kingsPoolAddr,
    PokerHandle:      handleAddr,
  } = existing.contracts;
  if (!tokenAddr || !stakingAddr) {
    throw new Error("Missing required dependency address(es) in deployment JSON — run deploy.js first.");
  }
  const oldTournAddr = existing.contracts.TournamentManager;
  console.log("Using ChipsToken:      ", tokenAddr);
  console.log("Using ChipsStaking:    ", stakingAddr);
  console.log("Using KingOfSpadesPool:", kingsPoolAddr || "(not deployed)");

  // Deploy new TournamentManager — same constructor args pattern as scripts/deploy.js
  const Tourn = await ethers.getContractFactory("TournamentManager");
  const tourn = await Tourn.deploy(tokenAddr, OPERATOR, RAKE_ADDR, stakingAddr);
  await tourn.waitForDeployment();
  const tournAddr = await tourn.getAddress();
  console.log("✅ TournamentManager (new):", tournAddr);

  // Re-wire only the calls that reference the tournament address (mirrors scripts/deploy.js)
  const staking = await ethers.getContractAt("ChipsStaking", stakingAddr);

  await (await staking.setYieldSource(tournAddr, true)).wait();
  console.log("✅ ChipsStaking: new tournament authorized as yield source");

  if (kingsPoolAddr) {
    const kingsPool = await ethers.getContractAt("KingOfSpadesPool", kingsPoolAddr);
    await (await kingsPool.setAuthorized(tournAddr, true)).wait();
    await (await tourn.setKingsPool(kingsPoolAddr)).wait();
    console.log("✅ KingOfSpadesPool wired to new tournament");
  } else {
    console.log("ℹ️  KingOfSpadesPool not deployed on this network — skipping");
  }

  if (handleAddr) {
    await (await tourn.setPokerHandle(handleAddr)).wait();
    console.log("✅ PokerHandle wired to new tournament (isHandleEligible gate)");
  } else {
    console.log("ℹ️  PokerHandle not deployed on this network — skipping (register() will revert until set)");
  }

  // Update deployment JSON — keep all other contracts, replace only TournamentManager.
  // The old tournament address is simply abandoned (testnet, nothing of value stranded).
  existing.contracts.TournamentManager = tournAddr;
  existing.deployedAt = new Date().toISOString();
  fs.writeFileSync(deplPath, JSON.stringify(existing, null, 2));
  console.log(`✅ deployments/${networkName}.json updated`);

  // Update .env
  const envArgs = `NEXT_PUBLIC_TOURNAMENT=${tournAddr}`;
  try {
    execSync(`node ${__dirname}/updateEnv.js ${envArgs}`, { stdio: "inherit" });
    console.log("✅ .env updated");
  } catch {
    console.log(`Paste into .env manually: NEXT_PUBLIC_TOURNAMENT=${tournAddr}`);
  }

  console.log("\nOld TournamentManager address (abandoned):", oldTournAddr || "(none)");
  console.log("New TournamentManager address:            ", tournAddr);
}

main().catch(e => { console.error(e); process.exit(1); });
