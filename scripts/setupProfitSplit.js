// scripts/setupProfitSplit.js — deploy ProfitSplitter and route ALL owner income to it.
// After this runs, every income stream (PokerEscrow treasury rake, TournamentManager
// rake, TableRegistry lease rake, ChipsToken dev vest) lands in the splitter, and
// `npm run distribute-profits` splits it: 50% straight to PAYOUT_WALLET, 50% staked
// in ChipsStaking (held by the splitter, yield harvestable, principal unstakeable
// to the payout wallet by the owner).
//
// Usage: npm run setup:profit-split -- 0xPAYOUT_WALLET
// Requires DEPLOYER_KEY (contract owner) in .env.
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { ethers } from "ethers";
import hre from "hardhat";

const RPCS = [
  process.env.ARB_SEPOLIA_RPC,
  "https://sepolia-rollup.arbitrum.io/rpc",
  "https://arbitrum-sepolia.drpc.org",
].filter(Boolean);

async function getProvider() {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      return p;
    } catch { /* try next */ }
  }
  throw new Error("All RPC endpoints failed. Check your internet connection.");
}

async function main() {
  const payout = process.argv[2] || process.env.PAYOUT_WALLET;
  if (!payout || !ethers.isAddress(payout)) {
    throw new Error("Pass the payout wallet: npm run setup:profit-split -- 0xADDR");
  }
  if (!process.env.DEPLOYER_KEY) throw new Error("DEPLOYER_KEY not set in .env");

  const manifestPath = new URL("../deployments/arbitrumSepolia.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const c = manifest.contracts;

  const provider = await getProvider();
  const deployer = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Payout wallet: ${payout}`);

  // 1. Deploy the splitter
  const artifact = await hre.artifacts.readArtifact("ProfitSplitter");
  const Splitter = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const splitter = await Splitter.deploy(c.ChipsToken, c.ChipsStaking, payout);
  await splitter.waitForDeployment();
  const splitterAddr = await splitter.getAddress();
  console.log(`✅ ProfitSplitter deployed: ${splitterAddr}`);

  // 2. Point every income stream at it
  const setterAbi = ["function setRakeRecipient(address) external"];
  for (const [name, addr] of [
    ["PokerEscrow", c.PokerEscrow],
    ["TournamentManager", c.TournamentManager],
    ["TableRegistry", c.TableRegistry],
  ]) {
    const contract = new ethers.Contract(addr, setterAbi, deployer);
    const tx = await contract.setRakeRecipient(splitterAddr);
    await tx.wait();
    console.log(`✅ ${name}.setRakeRecipient(${splitterAddr})`);
  }

  const token = new ethers.Contract(c.ChipsToken, ["function setDevWallet(address) external"], deployer);
  const tx = await token.setDevWallet(splitterAddr);
  await tx.wait();
  console.log(`✅ ChipsToken.setDevWallet(${splitterAddr})`);

  // 3. Record in the deployment manifest
  manifest.contracts.ProfitSplitter = splitterAddr;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✅ deployments/arbitrumSepolia.json updated (commit this change)`);

  console.log("\n── Profit routing ────────────────────────────────────");
  console.log(`All rake treasury shares + dev vest → ${splitterAddr}`);
  console.log(`On distribute(): 50% → ${payout}`);
  console.log(`                 50% → staked in ChipsStaking (earning APR)`);
  console.log("\nRun 'npm run distribute-profits' anytime to split what has accumulated.");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
