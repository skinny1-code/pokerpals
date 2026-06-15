// scripts/deployHandle.js — redeploys only PokerHandle, preserving all other contracts
// Usage: npx hardhat run scripts/deployHandle.js --network arbitrumSepolia
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

  // Load existing deployment to get ChipsToken address
  const deplPath = path.resolve(__dirname, `../deployments/${networkName}.json`);
  if (!fs.existsSync(deplPath)) {
    throw new Error(`No existing deployment found at ${deplPath}. Run deploy.js first.`);
  }
  const existing = JSON.parse(fs.readFileSync(deplPath, "utf8"));
  const tokenAddr = existing.contracts.ChipsToken;
  if (!tokenAddr) throw new Error("ChipsToken address not found in deployment JSON");
  console.log("Using ChipsToken:", tokenAddr);

  // Deploy new PokerHandle
  const Handle = await ethers.getContractFactory("PokerHandle");
  const handle = await Handle.deploy(tokenAddr);
  await handle.waitForDeployment();
  const handleAddr = await handle.getAddress();
  console.log("✅ PokerHandle (new):", handleAddr);

  // Update deployment JSON — keep all other contracts, replace only PokerHandle
  existing.contracts.PokerHandle = handleAddr;
  existing.deployedAt = new Date().toISOString();
  fs.writeFileSync(deplPath, JSON.stringify(existing, null, 2));
  console.log(`✅ deployments/${networkName}.json updated`);

  // Update .env
  const envArgs = `NEXT_PUBLIC_POKER_HANDLE=${handleAddr}`;
  try {
    execSync(`node ${__dirname}/updateEnv.js ${envArgs}`, { stdio: "inherit" });
    console.log("✅ .env updated");
  } catch {
    console.log(`Paste into .env manually: NEXT_PUBLIC_POKER_HANDLE=${handleAddr}`);
  }
  console.log("\nNew PokerHandle address:", handleAddr);
}

main().catch(e => { console.error(e); process.exit(1); });
