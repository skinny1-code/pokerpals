// scripts/distributeProfits.js — trigger the ProfitSplitter: harvest staking
// yield, claim any vested dev CHIPS, then split the accumulated balance
// (50% payout wallet / 50% staked by default).
// Usage: npm run distribute-profits
import "dotenv/config";
import { readFileSync } from "fs";
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
  const manifest = JSON.parse(readFileSync(new URL("../deployments/arbitrumSepolia.json", import.meta.url), "utf8"));
  const splitterAddr = manifest.contracts.ProfitSplitter;
  if (!splitterAddr) throw new Error("ProfitSplitter not deployed — run npm run setup:profit-split first");

  const key = process.env.DEPLOYER_KEY || process.env.OPS_WALLET_KEY;
  if (!key) throw new Error("DEPLOYER_KEY (or OPS_WALLET_KEY) not set in .env");

  const provider = await getProvider();
  const signer   = new ethers.Wallet(key, provider);
  const splitter = new ethers.Contract(splitterAddr, [
    "function distribute() external",
    "function harvestYield() external",
    "function claimDevVest() external",
    "function payoutWallet() view returns (address)",
  ], signer);
  const token = new ethers.Contract(manifest.contracts.ChipsToken, [
    "function balanceOf(address) view returns (uint256)",
    "function devClaimable() view returns (uint256)",
  ], provider);

  // Pull in anything claimable first so the split covers it all
  try {
    if ((await token.devClaimable()) > 0n) {
      await (await splitter.claimDevVest()).wait();
      console.log("✅ Dev vest claimed into splitter");
    }
  } catch { /* not devWallet or nothing vested */ }
  try {
    await (await splitter.harvestYield()).wait();
    console.log("✅ Staking yield harvested into splitter");
  } catch { /* no stake or no yield yet */ }

  const bal = await token.balanceOf(splitterAddr);
  if (bal === 0n) { console.log("Nothing to distribute — splitter balance is 0."); return; }

  console.log(`Distributing ${ethers.formatUnits(bal, 18)} CHIPS...`);
  const tx = await splitter.distribute();
  await tx.wait();
  console.log(`✅ Distributed. Payout wallet: ${await splitter.payoutWallet()}  tx: ${tx.hash}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
