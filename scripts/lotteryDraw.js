// scripts/lotteryDraw.js — weekly lottery routine (owner):
//   1. If the current epoch's prize is below LOTTERY_PRIZE (default 100,000
//      SALOON), pull the difference from the PromotionsPool and fund it.
//   2. If the epoch has ended, settle it and report the winner. Settling is two
//      phases — requestDraw() commits to a future block, then draw() reads that
//      block's hash — so this script does both in one run, and waits between
//      them. Doing it in one run also closes the only window in which someone
//      could let a commit expire and re-request for a fresh roll.
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
    "function requestDraw() external",
    "function draw() external",
    "function drawStatus() view returns (uint256 revealBlock, bool requested, bool ready, bool expired)",
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
  console.log(`Epoch #${id} — prize ${ethers.formatUnits(prize, 18)} SALOON, ends ${new Date(Number(endsAt) * 1000).toISOString()}`);

  // 1. Top the prize up to target from the PromotionsPool
  if (prize < target) {
    const need = target - prize;
    console.log(`Funding prize: pulling ${ethers.formatUnits(need, 18)} SALOON from PromotionsPool...`);
    await (await promotions.withdraw(owner.address, need, `staker lottery epoch ${id}`)).wait();
    await (await token.approve(c.StakerLottery, need)).wait();
    await (await lottery.fundPrize(need)).wait();
    console.log("✅ Prize funded");
  }

  // 2. Settle if the epoch is over
  if (BigInt(Math.floor(Date.now() / 1000)) >= endsAt) {
    console.log("Epoch ended — settling...");
    await settleEpoch(lottery, provider);
    const [winner, wonPrize] = await lottery.epochWinner(id);
    if (winner === ethers.ZeroAddress) {
      console.log("Nobody entered — prize rolled into the new epoch.");
    } else {
      console.log(`🎉 Winner of epoch #${id}: ${winner} — ${ethers.formatUnits(wonPrize, 18)} SALOON`);
    }
    const [newId, newEnds, newPrize] = await lottery.currentEpoch();
    console.log(`Epoch #${newId} started — prize ${ethers.formatUnits(newPrize, 18)} SALOON, ends ${new Date(Number(newEnds) * 1000).toISOString()}`);
  } else {
    console.log("Epoch still running — nothing to draw yet.");
  }
}

/**
 * Commit to a future block, wait for it, then draw. Re-commits if the previous
 * request aged past blockhash()'s 256-block window before we got there.
 */
async function settleEpoch(lottery, provider) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let [revealBlock, requested, ready, expired] = await lottery.drawStatus();

    if (ready) { // empty epoch, or a matured commit is already waiting
      await (await lottery.draw()).wait();
      return;
    }
    if (!requested || expired) {
      console.log(expired ? "Previous commit expired — re-requesting..." : "Committing to a future block...");
      await (await lottery.requestDraw()).wait();
      [revealBlock] = await lottery.drawStatus();
    }

    console.log(`Waiting for block ${revealBlock} (randomness reveal)...`);
    while ((await provider.getBlockNumber()) <= Number(revealBlock)) {
      await new Promise(r => setTimeout(r, 3000));
    }

    try {
      await (await lottery.draw()).wait();
      return;
    } catch (e) {
      console.log(`Draw attempt ${attempt} failed (${e.shortMessage || e.message}) — retrying`);
    }
  }
  throw new Error("Could not settle the epoch after 3 attempts");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
