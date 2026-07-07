// scripts/fixAntiBotOracle.js — repoint the already-deployed PokerEscrow's
// antiBotOracle to the wallet the running server actually signs markHuman() with.
//
// Root cause: server/index.js and server/antiBotOracle.js both call
// escrow.markHuman(address, true) signed by OPERATOR_PRIVATE_KEY (the same wallet
// used for hand-settlement signatures). But PokerEscrow.markHuman() only accepts
// calls from `antiBotOracle` or `owner()` — and at deploy time, `antiBotOracle` is
// set from the separate ANTIBOT_ORACLE env var (scripts/deploy.js), which can end
// up being a different address than OPERATOR_SIGNER. When that happens, every
// markHuman() call (including the TESTNET_SKIP_HUMAN_CHECK bypass and the real
// oracle) reverts with "Unauthorized" — exactly the error shown in the
// "Request Verification" banner.
//
// This script re-points antiBotOracle to OPERATOR_SIGNER's address on the
// existing deployed contract — no redeploy needed. Must be run with the
// contract OWNER's key (DEPLOYER_KEY, unless ownership was transferred since).
//
// Usage: node scripts/fixAntiBotOracle.js
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

const ESCROW_ABI = [
  "function owner() external view returns (address)",
  "function antiBotOracle() external view returns (address)",
  "function setAntiBotOracle(address) external",
];

async function main() {
  const escrowAddr = process.env.NEXT_PUBLIC_ESCROW;
  if (!escrowAddr) throw new Error("NEXT_PUBLIC_ESCROW not set — run npm run setup:env first");

  const ownerKey = process.env.DEPLOYER_KEY;
  if (!ownerKey) throw new Error("DEPLOYER_KEY not set in .env — needed to call the owner-only setAntiBotOracle()");

  // The address that should be authorized: prefer the explicit OPERATOR_SIGNER
  // address, falling back to deriving it from OPERATOR_PRIVATE_KEY.
  let targetOracle = process.env.OPERATOR_SIGNER;
  if (!targetOracle) {
    if (!process.env.OPERATOR_PRIVATE_KEY) {
      throw new Error("Neither OPERATOR_SIGNER nor OPERATOR_PRIVATE_KEY set in .env");
    }
    targetOracle = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY).address;
  }

  const provider = await getProvider();
  const owner    = new ethers.Wallet(ownerKey, provider);
  const escrow   = new ethers.Contract(escrowAddr, ESCROW_ABI, owner);

  const [onChainOwner, currentOracle] = await Promise.all([
    escrow.owner(),
    escrow.antiBotOracle(),
  ]);

  console.log(`Contract owner():      ${onChainOwner}`);
  console.log(`Signer running this:   ${owner.address}`);
  console.log(`Current antiBotOracle: ${currentOracle}`);
  console.log(`Target antiBotOracle:  ${targetOracle}`);

  if (onChainOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(
      `DEPLOYER_KEY's address (${owner.address}) is not the contract owner (${onChainOwner}). ` +
      `Run this with whichever key currently owns PokerEscrow.`
    );
  }

  if (currentOracle.toLowerCase() === targetOracle.toLowerCase()) {
    console.log("✅ antiBotOracle already matches — nothing to do.");
    return;
  }

  console.log(`\nSending setAntiBotOracle(${targetOracle})...`);
  const tx = await escrow.setAntiBotOracle(targetOracle);
  console.log(`tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ antiBotOracle updated at block ${receipt.blockNumber}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
