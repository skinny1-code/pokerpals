// scripts/faucet.js — send testnet CHIPS to any address
// All 1B CHIPS are minted at deploy, so we transfer from OPS_WALLET_KEY (100M budget)
// rather than calling ChipsToken.faucet() which would exceed MAX_SUPPLY.
// Usage: npm run faucet                                        → 10,000 CHIPS to deployer
//        FAUCET_TO=0xADDR npm run faucet                      → 10,000 CHIPS to 0xADDR
//        FAUCET_TO=0xADDR FAUCET_AMOUNT=50000 npm run faucet  → 50,000 CHIPS to 0xADDR
import "dotenv/config";
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
    } catch {
      // try next
    }
  }
  throw new Error("All RPC endpoints failed. Check your internet connection.");
}

async function main() {
  if (!process.env.NEXT_PUBLIC_CHIPS_TOKEN) throw new Error("NEXT_PUBLIC_CHIPS_TOKEN not set — run npm run setup:env first");

  const senderKey = process.env.OPS_WALLET_KEY || process.env.DEPLOYER_KEY;
  if (!senderKey) throw new Error("OPS_WALLET_KEY (or DEPLOYER_KEY) not set in .env");

  const provider = await getProvider();
  const sender   = new ethers.Wallet(senderKey, provider);
  const addr     = process.env.FAUCET_TO     || sender.address;
  const amount   = process.env.FAUCET_AMOUNT || "10000";

  const token = new ethers.Contract(
    process.env.NEXT_PUBLIC_CHIPS_TOKEN,
    ["function transfer(address to, uint256 amount) returns (bool)",
     "function balanceOf(address) view returns (uint256)"],
    sender
  );

  const needed = ethers.parseUnits(amount, 18);
  const bal    = await token.balanceOf(sender.address);
  if (bal < needed) throw new Error(`Sender only has ${ethers.formatUnits(bal, 18)} CHIPS — not enough to send ${amount}`);

  console.log(`Sending ${amount} CHIPS to ${addr}...`);
  const tx      = await token.transfer(addr, needed);
  console.log(`tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ Sent ${amount} CHIPS to ${addr}`);
  console.log(`   block: ${receipt.blockNumber}  tx: ${tx.hash}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
