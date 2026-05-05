// scripts/faucet.js — dispense testnet CHIPS to any address
// Usage: npm run faucet                        → 10,000 CHIPS to deployer
//        npm run faucet -- 0xADDR             → 10,000 CHIPS to 0xADDR
//        npm run faucet -- 0xADDR 50000       → 50,000 CHIPS to 0xADDR
// Requires: DEPLOYER_KEY + NEXT_PUBLIC_CHIPS_TOKEN in .env
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const args     = process.argv.slice(2);
  const addr     = args[0] || signer.address;
  const amount   = args[1] || "10000";

  if (!process.env.NEXT_PUBLIC_CHIPS_TOKEN) {
    throw new Error("NEXT_PUBLIC_CHIPS_TOKEN not set — run npm run setup:env first");
  }

  const token = await ethers.getContractAt("ChipsToken", process.env.NEXT_PUBLIC_CHIPS_TOKEN);
  const tx = await token.faucet(addr, ethers.parseUnits(amount, 18));
  await tx.wait();
  console.log(`✅ Sent ${amount} CHIPS to ${addr}`);
  console.log(`   tx: ${tx.hash}`);
}

main().catch(e => { console.error(e); process.exit(1); });
