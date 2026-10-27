// scripts/faucet.js — send testnet CHIPS (and gas ETH) to any address
// All 1B CHIPS are minted at deploy, so we transfer from OPS_WALLET_KEY (100M budget)
// rather than calling ChipsToken.faucet() which would exceed MAX_SUPPLY.
// If the recipient has no testnet ETH for gas, a small top-up is sent
// automatically from the same sender wallet, so players never need a public
// testnet-ETH faucet (most of which demand a mainnet ETH balance).
// Usage: npm run faucet                            → 10,000 CHIPS to deployer
//        npm run faucet -- 0xADDR                  → 10,000 CHIPS to 0xADDR
//        npm run faucet -- 0xADDR 50000            → 50,000 CHIPS to 0xADDR
//        FAUCET_TO=0xADDR npm run faucet           → env-var form still works
//        FAUCET_ETH=0.01 npm run faucet -- 0xADDR  → force a 0.01 ETH gas top-up
//        FAUCET_ETH=0 npm run faucet -- 0xADDR     → never send gas ETH
import "dotenv/config";
import { ethers } from "ethers";

const TARGET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "421614");
if (![421614, 46630].includes(TARGET_CHAIN_ID)) {
  throw new Error("Faucet is testnet-only (Arbitrum Sepolia 421614 or Robinhood Testnet 46630).");
}
const RPCS = TARGET_CHAIN_ID === 46630
  ? [process.env.ROBINHOOD_TESTNET_RPC, process.env.RPC_URL, "https://rpc.testnet.chain.robinhood.com"].filter(Boolean)
  : [process.env.ARB_SEPOLIA_RPC, process.env.RPC_URL, "https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia.drpc.org"].filter(Boolean);

async function getProvider() {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const network = await p.getNetwork();
      if (Number(network.chainId) !== TARGET_CHAIN_ID) continue;
      await p.getBlockNumber();
      return p;
    } catch {
      // try next
    }
  }
  throw new Error(`No RPC endpoint matched target testnet chain ${TARGET_CHAIN_ID}.`);
}

async function main() {
  if (!process.env.NEXT_PUBLIC_CHIPS_TOKEN) throw new Error("NEXT_PUBLIC_CHIPS_TOKEN not set — run npm run setup:env first");

  const senderKey = process.env.OPS_WALLET_KEY || process.env.DEPLOYER_KEY;
  if (!senderKey) throw new Error("OPS_WALLET_KEY (or DEPLOYER_KEY) not set in .env");

  const provider = await getProvider();
  const sender   = new ethers.Wallet(senderKey, provider);

  // Positional args (npm run faucet -- 0xADDR [amount]) win over env vars.
  const [argAddr, argAmount] = process.argv.slice(2);
  if (argAddr && !ethers.isAddress(argAddr)) throw new Error(`"${argAddr}" is not a valid address`);
  const addr   = argAddr || process.env.FAUCET_TO || sender.address;
  const amount = argAmount || process.env.FAUCET_AMOUNT || "10000";

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

  // Gas top-up: players need a little Sepolia ETH to buy in / approve. Default:
  // send 0.005 ETH when the recipient holds less than 0.001. FAUCET_ETH=<amt>
  // forces the amount; FAUCET_ETH=0 disables.
  const ethOverride = process.env.FAUCET_ETH;
  if (addr.toLowerCase() !== sender.address.toLowerCase() && ethOverride !== '0') {
    const recipientEth = await provider.getBalance(addr);
    const topUp = ethOverride ? ethers.parseEther(ethOverride)
      : (recipientEth < ethers.parseEther('0.001') ? ethers.parseEther('0.005') : 0n);
    if (topUp > 0n) {
      const senderEth = await provider.getBalance(sender.address);
      if (senderEth < topUp + ethers.parseEther('0.002')) {
        console.warn(`⚠️  Skipping gas top-up — sender only has ${ethers.formatEther(senderEth)} ETH`);
      } else {
        console.log(`Sending ${ethers.formatEther(topUp)} gas ETH to ${addr}...`);
        const ethTx = await sender.sendTransaction({ to: addr, value: topUp });
        await ethTx.wait();
        console.log(`✅ Sent ${ethers.formatEther(topUp)} ETH for gas  tx: ${ethTx.hash}`);
      }
    } else {
      console.log(`Recipient already has ${ethers.formatEther(recipientEth)} ETH — no gas top-up needed.`);
    }
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
