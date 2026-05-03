// scripts/generateWallets.js
// Run: npm run setup:wallets
// Generates 7 fresh wallets for every role and writes them to .env.
// Run it again any time you need to replace all wallets with new ones.

const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

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
    note:       "Receives all rake revenue",
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
    note:       "Receives 10% of token supply (100M PPP)",
    keyVar:     "DEV_WALLET_KEY",
    addrVar:    "DEV_WALLET",
  },
  {
    label:      "COMMUNITY WALLET",
    note:       "Receives 40% of token supply (400M PPP)",
    keyVar:     "COMMUNITY_WALLET_KEY",
    addrVar:    "COMMUNITY_WALLET",
  },
  {
    label:      "LIQUIDITY WALLET",
    note:       "Receives 50% of token supply (500M PPP)",
    keyVar:     "LIQUIDITY_WALLET_KEY",
    addrVar:    "LIQUIDITY_WALLET",
  },
];

function line(char = "═", len = 62) { return char.repeat(len); }

const generated = ROLES.map(role => {
  const wallet = ethers.Wallet.createRandom();
  return { ...role, key: wallet.privateKey, address: wallet.address };
});

// Build .env content — start with any non-wallet lines from existing .env
const WALLET_KEYS = new Set([
  ...ROLES.map(r => r.keyVar),
  ...ROLES.filter(r => r.addrVar).map(r => r.addrVar),
]);

let existingLines = [];
if (fs.existsSync(ENV_PATH)) {
  existingLines = fs.readFileSync(ENV_PATH, "utf8")
    .split("\n")
    .filter(l => {
      const key = l.split("=")[0].trim();
      return !WALLET_KEYS.has(key);
    });
}

const walletLines = [];
generated.forEach(({ keyVar, addrVar, key, address }) => {
  walletLines.push(`${keyVar}=${key}`);
  if (addrVar) walletLines.push(`${addrVar}=${address}`);
});

const envContent = [
  ...existingLines.filter(l => l.trim() !== ""),
  "",
  "# ── GENERATED WALLETS ───────────────────────────────────────────",
  ...walletLines,
  "",
].join("\n");

fs.writeFileSync(ENV_PATH, envContent);

// Build printable text file
const now = new Date().toLocaleString();
const PRINT_PATH = path.resolve(__dirname, "../WALLETS-PRINT-ME.txt");

const printLines = [
  "================================================================",
  "  PokerPartyPals — WALLET KEYS",
  `  Generated: ${now}`,
  "  KEEP THIS SAFE — DO NOT SHARE — DO NOT LOSE",
  "================================================================",
  "",
];

generated.forEach(({ label, note, key, address, addrVar, keyVar }) => {
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
console.log("  PokerPartyPals — NEW WALLETS GENERATED");
console.log("  Write these down and store them safely!");
console.log(line());

generated.forEach(({ label, note, key, address }) => {
  console.log(`\n  ${label}`);
  console.log(`  ${note}`);
  console.log(`  Address : ${address}`);
  console.log(`  Key     : ${key}`);
});

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
