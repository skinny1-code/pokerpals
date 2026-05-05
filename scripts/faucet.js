// scripts/faucet.js — dispense testnet CHIPS to any address
// Usage: npm run faucet                                        → 10,000 CHIPS to deployer
//        FAUCET_TO=0xADDR npm run faucet                      → 10,000 CHIPS to 0xADDR
//        FAUCET_TO=0xADDR FAUCET_AMOUNT=50000 npm run faucet  → 50,000 CHIPS to 0xADDR
// Requires: DEPLOYER_KEY + NEXT_PUBLIC_CHIPS_TOKEN in .env
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const addr     = process.env.FAUCET_TO     || signer.address;
  const amount   = process.env.FAUCET_AMOUNT || "10000";

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
