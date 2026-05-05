// scripts/faucet.js — dispense testnet CHIPS to any address
// Usage: npm run faucet                                        → 10,000 CHIPS to deployer
//        FAUCET_TO=0xADDR npm run faucet                      → 10,000 CHIPS to 0xADDR
//        FAUCET_TO=0xADDR FAUCET_AMOUNT=50000 npm run faucet  → 50,000 CHIPS to 0xADDR
// Requires: COMMUNITY_WALLET_KEY + NEXT_PUBLIC_CHIPS_TOKEN in .env
require("dotenv").config();
const { ethers } = require("ethers");

// Public RPCs as fallback so this works even if Alchemy has IP restrictions
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
  if (!process.env.NEXT_PUBLIC_CHIPS_TOKEN) {
    throw new Error("NEXT_PUBLIC_CHIPS_TOKEN not set — run npm run setup:env first");
  }
  if (!process.env.COMMUNITY_WALLET_KEY) {
    throw new Error("COMMUNITY_WALLET_KEY not set in .env");
  }

  const provider = await getProvider();
  // Use community wallet (holds 100M CHIPS) as faucet source
  const signer   = new ethers.Wallet(process.env.COMMUNITY_WALLET_KEY, provider);
  const addr     = process.env.FAUCET_TO     || signer.address;
  const amount   = process.env.FAUCET_AMOUNT || "10000";

  console.log(`Sending ${amount} CHIPS to ${addr}...`);

  const token = new ethers.Contract(
    process.env.NEXT_PUBLIC_CHIPS_TOKEN,
    ["function transfer(address to, uint256 amount) external returns (bool)",
     "function balanceOf(address) external view returns (uint256)"],
    signer
  );

  const bal = await token.balanceOf(signer.address);
  const needed = ethers.parseUnits(amount, 18);
  if (bal < needed) {
    throw new Error(`Community wallet only has ${ethers.formatUnits(bal, 18)} CHIPS — not enough for ${amount}`);
  }

  const tx = await token.transfer(addr, needed);
  console.log(`tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ Sent ${amount} CHIPS to ${addr}`);
  console.log(`   block: ${receipt.blockNumber}  tx: ${tx.hash}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
