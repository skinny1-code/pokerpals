// scripts/fundRakeback.js — activate the escrow's built-in 5% rakeback by
// funding its pool from the PromotionsPool. Accrual only happens while
// rakebackPool > 0, so keep it topped up.
// Usage: npm run fund:rakeback -- 100000   (owner; amount in SALOON)
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
  if (!process.env.DEPLOYER_KEY) throw new Error("DEPLOYER_KEY not set in .env");
  const amountChips = process.argv[2] || "100000";
  const amount = ethers.parseUnits(amountChips, 18);

  const manifest = JSON.parse(readFileSync(new URL("../deployments/arbitrumSepolia.json", import.meta.url), "utf8"));
  const c = manifest.contracts;

  const provider = await getProvider();
  const owner    = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);

  const promotions = new ethers.Contract(c.PromotionsPool,
    ["function withdraw(address to, uint256 amount, string note) external"], owner);
  const token = new ethers.Contract(c.ChipsToken,
    ["function approve(address,uint256) returns (bool)"], owner);
  const escrow = new ethers.Contract(c.PokerEscrow, [
    "function fundRakebackPool(uint256) external",
    "function rakebackPool() view returns (uint256)",
  ], owner);

  console.log(`Pulling ${amountChips} SALOON from PromotionsPool...`);
  await (await promotions.withdraw(owner.address, amount, "rakeback pool top-up")).wait();
  await (await token.approve(c.PokerEscrow, amount)).wait();
  await (await escrow.fundRakebackPool(amount)).wait();
  console.log(`✅ Rakeback pool funded. Current pool: ${ethers.formatUnits(await escrow.rakebackPool(), 18)} SALOON`);
  console.log("Players now accrue 5% of the rake they pay, claimable on the Stake page.");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
