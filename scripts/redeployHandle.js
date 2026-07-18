// scripts/redeployHandle.js — deploy the new HandleRenderer + PokerHandle pair
// and rewire escrow/tournament to the new handle contract.
// Existing handles on the old contract are abandoned (testnet); holders re-mint.
// Future art changes will NOT need this script again — deploy a new renderer
// and call PokerHandle.setRenderer instead.
//
// Usage: npm run redeploy:handle   (requires DEPLOYER_KEY in .env)
//
// Uses the prebuilt artifacts in scripts/artifacts/ — no hardhat, no compile
// step. (Hardhat's compiler needs a native module with no Android build, so
// compiling in Termux is impossible; the artifacts are committed instead.)
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

async function deployArtifact(name, deployer, args) {
  const artifact = JSON.parse(readFileSync(new URL(`./artifacts/${name}.json`, import.meta.url), "utf8"));
  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c.getAddress();
}

async function main() {
  if (!process.env.DEPLOYER_KEY) throw new Error("DEPLOYER_KEY not set in .env");

  const manifestPath = new URL("../deployments/arbitrumSepolia.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const c = manifest.contracts;

  const provider = await getProvider();
  const deployer = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
  console.log(`Deployer: ${deployer.address}`);

  const rendererAddr = await deployArtifact("HandleRenderer", deployer, []);
  console.log(`✅ HandleRenderer: ${rendererAddr}`);

  const handleAddr = await deployArtifact("PokerHandle", deployer, [c.ChipsToken, c.PokerEscrow, rendererAddr]);
  console.log(`✅ PokerHandle: ${handleAddr}`);

  const setterAbi = ["function setPokerHandle(address) external"];
  for (const [name, addr] of [["PokerEscrow", c.PokerEscrow], ["TournamentManager", c.TournamentManager]]) {
    const contract = new ethers.Contract(addr, setterAbi, deployer);
    const tx = await contract.setPokerHandle(handleAddr);
    await tx.wait();
    console.log(`✅ ${name}.setPokerHandle(${handleAddr})`);
  }

  manifest.contracts.PokerHandle = handleAddr;
  manifest.contracts.HandleRenderer = rendererAddr;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("✅ deployments/arbitrumSepolia.json updated — COMMIT AND PUSH this change");
  console.log("   (the frontend and server resolve the handle address from the manifest)");
  console.log("\nDone. Re-mint your handle on /handle — the new emblem art is live.");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
