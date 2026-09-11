#!/usr/bin/env node
// scripts/transferOwnership.js — hand every deployed contract's ownership to a
// multisig (Gnosis Safe), and report the privileged roles that ownership does
// NOT cover.
//
//   npm run transfer:ownership -- 0xSAFE            # dry run: print the plan
//   npm run transfer:ownership -- 0xSAFE --confirm  # execute
//   DEPLOY_NETWORK=robinhood npm run transfer:ownership -- 0xSAFE --confirm
//
// OpenZeppelin Ownable v5 transferOwnership is a ONE-STEP, irreversible handover:
// a wrong address loses every contract permanently, with no way back. So the
// target is validated hard before anything is sent — it must be a contract, not
// an EOA, which a mistyped or personal address cannot fake — and nothing is sent
// at all without --confirm.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const OWNABLE_ABI = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner) external",
];

// Roles that are NOT ownership. transferOwnership does not touch these, and a
// key left here keeps its power after the multisig handover.
const ROLE_READS = {
  PokerEscrow:       ["operatorSigner", "rakeRecipient", "antiBotOracle"],
  TournamentManager: ["operatorSigner", "rakeRecipient"],
  TableRegistry:     ["rakeRecipient"],
  ChipsToken:        ["devWallet"],
};

const NETWORK  = process.env.DEPLOY_NETWORK || "arbitrumSepolia";
const RPC_ENV  = { robinhood: "ROBINHOOD_RPC", robinhoodTestnet: "ROBINHOOD_TESTNET_RPC",
                   arbitrum: "ARB_RPC", arbitrumSepolia: "ARB_SEPOLIA_RPC" };

async function main() {
  const args    = process.argv.slice(2);
  const safe    = args.find(a => /^0x[0-9a-fA-F]{40}$/.test(a));
  const confirm = args.includes("--confirm");

  if (!safe) {
    console.error("Usage: npm run transfer:ownership -- 0xSAFE_ADDRESS [--confirm]");
    process.exit(1);
  }
  if (!process.env.DEPLOYER_KEY) throw new Error("DEPLOYER_KEY not set");

  const rpcVar = RPC_ENV[NETWORK];
  if (!rpcVar && !process.env.RPC_URL) {
    throw new Error(
      `Unknown network "${NETWORK}". Set DEPLOY_NETWORK to one of ` +
      `${Object.keys(RPC_ENV).join(", ")}, or set RPC_URL directly.`
    );
  }
  const rpc = process.env.RPC_URL || process.env[rpcVar];
  if (!rpc) throw new Error(`${rpcVar} (or RPC_URL) not set for network ${NETWORK}`);

  const provider = new ethers.JsonRpcProvider(rpc);
  const signer   = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
  const manifest = JSON.parse(readFileSync(new URL(`../deployments/${NETWORK}.json`, import.meta.url), "utf8"));

  // ── Validate the target before anything is irreversible ────────────────────
  const target = ethers.getAddress(safe); // throws on a bad checksum
  if (target === ethers.ZeroAddress) throw new Error("Refusing to transfer to the zero address");
  if (target === signer.address)     throw new Error("Target is the current deployer — nothing to do");
  const code = await provider.getCode(target);
  if (code === "0x") {
    throw new Error(
      `${target} has no contract code on ${NETWORK}. A Gnosis Safe is a contract; ` +
      `an EOA here means a typo, and Ownable's handover cannot be undone.`
    );
  }
  console.log(`Network:  ${NETWORK} (chainId ${manifest.chainId})`);
  console.log(`From:     ${signer.address}`);
  console.log(`To:       ${target}  (${(code.length - 2) / 2} bytes of code ✓)\n`);

  // ── Plan ───────────────────────────────────────────────────────────────────
  const plan = [];
  for (const [name, address] of Object.entries(manifest.contracts)) {
    const c = new ethers.Contract(address, OWNABLE_ABI, signer);
    let currentOwner;
    try { currentOwner = await c.owner(); }
    catch { plan.push({ name, address, skip: "not Ownable" }); continue; }

    if (currentOwner === target)         plan.push({ name, address, skip: "already owned by the safe" });
    else if (currentOwner !== signer.address)
      plan.push({ name, address, skip: `owned by ${currentOwner}, not this signer` });
    else plan.push({ name, address, currentOwner });
  }

  const todo = plan.filter(p => !p.skip);
  for (const p of plan) {
    console.log(p.skip ? `  ⏭  ${p.name.padEnd(20)} ${p.address}  — ${p.skip}`
                       : `  →  ${p.name.padEnd(20)} ${p.address}`);
  }
  console.log(`\n${todo.length} contract(s) to transfer.`);

  // ── Roles ownership does not cover ─────────────────────────────────────────
  console.log("\nPrivileged roles NOT covered by transferOwnership:");
  for (const [name, roles] of Object.entries(ROLE_READS)) {
    const address = manifest.contracts[name];
    if (!address) continue;
    const abi = roles.map(r => `function ${r}() view returns (address)`);
    const c   = new ethers.Contract(address, abi, provider);
    for (const role of roles) {
      try {
        const holder = await c[role]();
        const flag   = holder === signer.address ? "  ⚠️  still the deployer key" : "";
        console.log(`  ${name}.${role}: ${holder}${flag}`);
      } catch { /* role absent on this deployment */ }
    }
  }
  console.log("  (rotate these separately — setOperatorSigner / setRakeRecipient /\n" +
              "   setAntiBotOracle / setDevWallet, each callable by the new owner)");

  if (!confirm) {
    console.log("\nDry run — nothing sent. Re-run with --confirm to execute.");
    return;
  }
  if (!todo.length) { console.log("\nNothing to do."); return; }

  // ── Execute, one at a time so a mid-run failure is unambiguous ─────────────
  //
  // The nonce is tracked here rather than left to the provider. ethers caches
  // getTransactionCount per block, and on a fast chain the next transfer is
  // built before the cache refreshes — the second send then reuses a spent
  // nonce and is rejected, leaving ownership half-moved. (Re-running is safe:
  // contracts already on the safe are skipped.)
  console.log("\nTransferring…");
  let nonce = await provider.getTransactionCount(signer.address, "pending");
  for (const { name, address } of todo) {
    const c  = new ethers.Contract(address, OWNABLE_ABI, signer);
    const tx = await c.transferOwnership(target, { nonce: nonce++ });
    await tx.wait();
    const now = await c.owner();
    if (now !== target) throw new Error(`${name}: owner is ${now} after transfer — STOP and investigate`);
    console.log(`  ✅ ${name.padEnd(20)} → ${target}  (${tx.hash})`);
  }

  console.log("\n✅ Ownership transferred. Verify from a second source before " +
              "discarding the deployer key, and rotate the roles listed above.");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
