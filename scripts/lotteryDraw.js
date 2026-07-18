// scripts/lotteryDraw.js — weekly lottery routine (owner):
//   1. If the current epoch's prize is below LOTTERY_PRIZE (default 100,000
//      CHIPS), pull the difference from the PromotionsPool and fund it.
//   2. If the epoch has ended, draw() and report the winner.
// Safe to run any time; each step no-ops when not applicable.
// Usage: npm run lottery:draw   (DEPLOYER_KEY in .env)
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
  const manifest = JSON.parse(readFileSync(new URL("../deployments/arbitrumSepolia.json", import.meta.url), "utf8"));
  const c = manifest.contracts;
  if (!c.StakerLottery) throw new Error("StakerLottery not deployed — run npm run deploy:lottery first");

  const provider = await getProvider();
  const owner    = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);

  const lottery = new ethers.Contract(c.StakerLottery, [
    "function currentEpoch() view returns (uint256 id, uint256 endsAt, uint256 prize, uint256 entrants, uint256 totalTickets)",
    "function fundPrize(uint256) external",
    "function draw() external",
    "function epochWinner(uint256) view returns (address winner, uint256 prize)",
  ], owner);
  const token = new ethers.Contract(c.ChipsToken, [
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ], owner);
  const promotions = new ethers.Contract(c.PromotionsPool, [
    "function withdraw(address to, uint256 amount, string note) external",
  ], owner);

  const target = ethers.parseUnits(process.env.LOTTERY_PRIZE || "100000", 18);
  let [id, endsAt, prize] = await lottery.currentEpoch();
  console.log(`Epoch #${id} — prize ${ethers.formatUnits(prize, 18)} CHIPS, ends ${new Date(Number(endsAt) * 1000).toISOString()}`);

  // 1. Top the prize up to target from the PromotionsPool
  if (prize < target) {
    const need = target - prize;
    console.log(`Funding prize: pulling ${ethers.formatUnits(need, 18)} CHIPS from PromotionsPool...`);
    await (await promotions.withdraw(owner.address, need, `staker lottery epoch ${id}`)).wait();
    await (await token.approve(c.StakerLottery, need)).wait();
    await (await lottery.fundPrize(need)).wait();
    console.log("✅ Prize funded");
  }

  // 2. Settle if the epoch is over
  if (BigInt(Math.floor(Date.now() / 1000)) >= endsAt) {
    console.log("Epoch ended — drawing...");
    await (await lottery.draw()).wait();
    const [winner, wonPrize] = await lottery.epochWinner(id);
    if (winner === ethers.ZeroAddress) {
      console.log("Nobody entered — prize rolled into the new epoch.");
    } else {
      console.log(`🎉 Winner of epoch #${id}: ${winner} — ${ethers.formatUnits(wonPrize, 18)} CHIPS`);
    }
    const [newId, newEnds, newPrize] = await lottery.currentEpoch();
    console.log(`Epoch #${newId} started — prize ${ethers.formatUnits(newPrize, 18)} CHIPS, ends ${new Date(Number(newEnds) * 1000).toISOString()}`);
  } else {
    console.log("Epoch still running — nothing to draw yet.");
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
