// Source-level staging invariants. This does NOT certify gameplay, contracts or production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const hardhat = read("hardhat.config.js");
const wallet = read("src/hooks/wallet/core.js");
const deploy = read("scripts/deploy.js");
const server = read("server/index.js");
const env = read(".env.example");
const probe = read("scripts/verifyElysiumReadOnly.mjs");
assert.match(hardhat, /elysiumTestnet:[\s\S]*?chainId:\s*99801/);
assert.match(hardhat, /elysium:[\s\S]*?chainId:\s*99901/);
assert.match(wallet, /id:\s*99801/);
assert.match(wallet, /id:\s*99901/);
assert.match(wallet, /symbol:\s*"HYPE"/);
assert.match(wallet, /NEXT_PUBLIC_ENABLE_ELYSIUM_NETWORKS === "true"/);
assert.match(env, /NEXT_PUBLIC_ENABLE_ELYSIUM_NETWORKS=false/);
assert.match(deploy, /ELYSIUM_HYPE_NOT_SUPPORTED/);
assert.match(deploy, /\["elysium", "elysiumTestnet"\]\.includes\(networkName\)/);
assert.match(server, /ELYSIUM_HYPE_NOT_SUPPORTED/);
assert.match(probe, /eth_chainId/);
assert.match(probe, /CHAIN_ID_MISMATCH/);
assert.doesNotMatch(wallet, /id:\s*1338[,\s]/);
assert.doesNotMatch(wallet, /id:\s*1339[,\s]/);
console.log("Elysium/HYPE staging network and no-CHIPS-deploy invariants passed.");
