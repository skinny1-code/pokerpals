// scripts/generateWallets.js
// Run: npm run setup:wallets
// Generates wallets for any roles NOT already in .env.
// Existing keys and addresses are NEVER overwritten — safe to re-run.

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../.env");

const ROLES = [
  {
    label:      "DEPLOYER",
    note:       "Contract owner — fund with ETH on Arbitrum before deploying",
    keyVar:     "DEPLOYER_KEY",
    addrVar:    null,
  },
  {
    label:      "OPERATOR SIGNER",
    note:       "Signs every hand settlement — keep this key on the game server",
    keyVar:     "OPERATOR_PRIVATE_KEY",
    addrVar:    "OPERATOR_SIGNER",
  },
  {
    label:      "RAKE WALLET",
    note:       "Receives ongoing rake revenue (20% of rake + all seat fees) — your personal income stream",
    keyVar:     "RAKE_WALLET_KEY",
    addrVar:    "RAKE_WALLET",
  },
  {
    label:      "ANTIBOT ORACLE",
    note:       "Calls markHuman() on-chain",
    keyVar:     "ANTIBOT_ORACLE_KEY",
    addrVar:    "ANTIBOT_ORACLE",
  },
  {
    label:      "DEV WALLET",
    note:       "Receives 10% of token supply (100M CHIPS) vested linearly over 24 months — your equity stake",
    keyVar:     "DEV_WALLET_KEY",
    addrVar:    "DEV_WALLET",
  },
  {
    label:      "OPS WALLET",
    note:       "Receives 10% of token supply (100M CHIPS) — devops budget: servers, staff, marketing",
    keyVar:     "OPS_WALLET_KEY",
    addrVar:    "OPS_WALLET",
  },
  {
    label:      "COMMUNITY WALLET",
    note:       "Receives 10% of token supply (100M CHIPS) — tournaments, airdrops, grants",
    keyVar:     "COMMUNITY_WALLET_KEY",
    addrVar:    "COMMUNITY_WALLET",
  },
  {
    label:      "LIQUIDITY WALLET",
    note:       "Receives 50% of token supply (500M CHIPS) — DEX liquidity pools",
    keyVar:     "LIQUIDITY_WALLET_KEY",
    addrVar:    "LIQUIDITY_WALLET",
  },
];

function line(char = "═", len = 62) { return char.repeat(len); }

// Read existing .env so we can check which roles already have keys
const existingEnv = fs.existsSync(ENV_PATH)
  ? Object.fromEntries(
      fs.readFileSync(ENV_PATH, "utf8")
        .split("\n")
        .filter(l => l.includes("=") && !l.startsWith("#"))
        .map(l => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })
    )
  : {};

// Only generate wallets for roles that are missing from .env
const generated = ROLES.map(role => {
  const alreadyHasKey  = existingEnv[role.keyVar]  && existingEnv[role.keyVar]  !== "";
  const alreadyHasAddr = !role.addrVar || (existingEnv[role.addrVar] && existingEnv[role.addrVar] !== "");
  if (alreadyHasKey && alreadyHasAddr) {
    return { ...role, key: existingEnv[role.keyVar], address: existingEnv[role.addrVar] || null, isNew: false };
  }
  const wallet = ethers.Wallet.createRandom();
  return { ...role, key: wallet.privateKey, address: wallet.address, isNew: true };
});

const newEntries = generated.filter(r => r.isNew);
if (newEntries.length === 0) {
  console.log("\n✅ All wallet roles already configured in .env — nothing to generate.\n");
  process.exit(0);
}

// Build updated .env: keep all existing lines, append only new wallet entries
const existingLines = fs.existsSync(ENV_PATH)
  ? fs.readFileSync(ENV_PATH, "utf8").split("\n")
      .filter(l => {
        const key = l.split("=")[0].trim();
        // Remove lines whose key we are about to write as new
        const isNewKey = newEntries.some(e => e.keyVar === key || e.addrVar === key);
        return !isNewKey;
      })
  : [];

const newWalletLines = [];
newEntries.forEach(({ keyVar, addrVar, key, address }) => {
  newWalletLines.push(`${keyVar}=${key}`);
  if (addrVar) newWalletLines.push(`${addrVar}=${address}`);
});

const envContent = [
  ...existingLines.filter((l, i, arr) => !(l.trim() === "" && arr[i-1]?.trim() === "")),
  "",
  "# ── GENERATED WALLETS ───────────────────────────────────────────",
  ...newWalletLines,
  "",
].join("\n");

fs.writeFileSync(ENV_PATH, envContent);

// Build printable text file
const now = new Date().toLocaleString();
const PRINT_PATH = path.resolve(__dirname, "../WALLETS-PRINT-ME.txt");

const printLines = [
  "================================================================",
  "  All In — WALLET KEYS",
  `  Generated: ${now}`,
  "  KEEP THIS SAFE — DO NOT SHARE — DO NOT LOSE",
  "================================================================",
  "",
];

newEntries.forEach(({ label, note, key, address, addrVar, keyVar }) => {
  printLines.push(`[ ${label} ]`);
  printLines.push(`  Role    : ${note}`);
  printLines.push(`  Address : ${address}`);
  printLines.push(`  Key     : ${key}`);
  if (addrVar)  printLines.push(`  .env    : ${addrVar}  /  ${keyVar}`);
  else          printLines.push(`  .env    : ${keyVar}`);
  printLines.push("");
});

printLines.push("================================================================");
printLines.push("  NEXT STEPS AFTER PRINTING:");
printLines.push("  1. Import each Key into MetaMask (Account > Import Account)");
printLines.push("  2. Label each account with the Role name above");
printLines.push("  3. Send ETH to DEPLOYER address on Arbitrum for gas");
printLines.push("  4. Run: npm run deploy:mainnet");
printLines.push("================================================================");

fs.writeFileSync(PRINT_PATH, printLines.join("\n") + "\n");

// Terminal summary
console.log("\n" + line());
console.log("  All In — NEW WALLETS GENERATED");
console.log("  Write these down and store them safely!");
console.log(line());

newEntries.forEach(({ label, note, key, address }) => {
  console.log(`\n  ${label}  ★ NEW`);
  console.log(`  ${note}`);
  console.log(`  Address : ${address}`);
  console.log(`  Key     : ${key}`);
});

const kept = generated.filter(r => !r.isNew);
if (kept.length > 0) {
  console.log(`\n  (${kept.length} existing wallet${kept.length > 1 ? 's' : ''} preserved unchanged: ${kept.map(r => r.label).join(", ")})`);
}

console.log("\n" + line());
console.log("  All keys saved to .env");
console.log(`  Printable file saved to: WALLETS-PRINT-ME.txt`);
console.log("  Open that file and print it — then store it somewhere safe.");
console.log("\n  Next steps:");
console.log("    1. Print WALLETS-PRINT-ME.txt and store it safely");
console.log("    2. Import each address into MetaMask using the Key");
console.log("    3. Send ETH to DEPLOYER address on Arbitrum for gas");
console.log("    4. Run: npm run deploy:mainnet");
console.log(line() + "\n");
