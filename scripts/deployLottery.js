// scripts/deployLottery.js — deploy the StakerLottery (weekly no-loss draw).
// Uses the prebuilt artifact in scripts/artifacts/ — no hardhat, no compile,
// works from Termux. Usage: npm run deploy:lottery  (DEPLOYER_KEY in .env)
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { ethers } from "ethers";

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
  if (!process.env.DEPLOYER_KEY) throw new Error("DEPLOYER_KEY not set in .env");

  const manifestPath = new URL("../deployments/arbitrumSepolia.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const c = manifest.contracts;

  const provider = await getProvider();
  const deployer = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
  console.log(`Deployer: ${deployer.address}`);

  const artifact = JSON.parse(readFileSync(new URL("./artifacts/StakerLottery.json", import.meta.url), "utf8"));
  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const lottery  = await factory.deploy(c.ChipsToken, c.ChipsStaking);
  await lottery.waitForDeployment();
  const addr = await lottery.getAddress();
  console.log(`✅ StakerLottery: ${addr}`);

  manifest.contracts.StakerLottery = addr;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("✅ deployments/arbitrumSepolia.json updated — COMMIT AND PUSH this change");
  console.log("\nWeekly routine: npm run lottery:draw  (funds the prize from PromotionsPool and settles the epoch)");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
