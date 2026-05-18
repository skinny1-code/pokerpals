// scripts/faucet.js — dispense testnet CHIPS to any address
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
  if (!process.env.NEXT_PUBLIC_CHIPS_TOKEN) throw new Error("NEXT_PUBLIC_CHIPS_TOKEN not set");
  if (!process.env.COMMUNITY_WALLET_KEY)    throw new Error("COMMUNITY_WALLET_KEY not set in .env");
  if (!process.env.DEPLOYER_KEY)            throw new Error("DEPLOYER_KEY not set in .env");

  const provider   = await getProvider();
  const deployer   = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
  const community  = new ethers.Wallet(process.env.COMMUNITY_WALLET_KEY, provider);
  const addr       = process.env.FAUCET_TO     || deployer.address;
  const amount     = process.env.FAUCET_AMOUNT || "10000";

  // If community wallet has no ETH for gas, fund it from deployer
  const GAS_BUFFER = ethers.parseEther("0.001");
  const communityEth = await provider.getBalance(community.address);
  if (communityEth < GAS_BUFFER) {
    console.log("Community wallet has no gas ETH — funding from deployer...");
    const fundTx = await deployer.sendTransaction({
      to:    community.address,
      value: GAS_BUFFER,
    });
    await fundTx.wait();
    console.log(`Funded community wallet with 0.001 ETH (tx: ${fundTx.hash})`);
  }

  const token = new ethers.Contract(
    process.env.NEXT_PUBLIC_CHIPS_TOKEN,
    [
      "function transfer(address to, uint256 amount) external returns (bool)",
      "function balanceOf(address) external view returns (uint256)",
    ],
    community
  );

  const bal    = await token.balanceOf(community.address);
  const needed = ethers.parseUnits(amount, 18);
  if (bal < needed) {
    throw new Error(`Community wallet only has ${ethers.formatUnits(bal, 18)} CHIPS — not enough for ${amount}`);
  }

  console.log(`Sending ${amount} CHIPS to ${addr}...`);
  const tx      = await token.transfer(addr, needed);
  console.log(`tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ Sent ${amount} CHIPS to ${addr}`);
  console.log(`   block: ${receipt.blockNumber}  tx: ${tx.hash}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
