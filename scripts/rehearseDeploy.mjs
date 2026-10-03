#!/usr/bin/env node
// scripts/rehearseDeploy.mjs — run the MAINNET deploy path against a local node.
//
// The Robinhood deploy cannot be practised on Robinhood: every attempt costs
// real gas, leaves dead contracts behind, and bakes an immutable stablecoin
// address into two pools. So it gets practised here, on a throwaway chain,
// using the same scripts/deploy.js and the same non-testnet branch.
//
//   npx hardhat node &          # or any local JSON-RPC
//   npm run rehearse:deploy
//
// Deploys two stand-in tokens first — one correct (6 decimals) and one shaped
// like the fakes on Robinhood Chain (18 decimals) — proves the deploy refuses
// the bad ones, then runs the real deploy and verifies every post-deploy wiring.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { ethers } from 'ethers';

const RPC = process.env.REHEARSAL_RPC || 'http://127.0.0.1:8545';
const KEY = process.env.DEPLOYER_KEY;
if (!KEY) {
  console.error('Set DEPLOYER_KEY to a funded key on the local node (hardhat prints them at startup).');
  process.exit(1);
}

let failures = 0;
const pass = m => console.log(`  ✅ ${m}`);
const fail = m => { failures++; console.log(`  ❌ ${m}`); };

const provider = new ethers.JsonRpcProvider(RPC);
const wallet   = new ethers.Wallet(KEY, provider);
const chainId  = Number((await provider.getNetwork()).chainId);
console.log(`Local node: ${RPC} (chainId ${chainId})`);

const artifact = n => {
  for (const dir of ['contracts']) {
    const p = `artifacts/${dir}/${n}.sol/${n}.json`;
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  throw new Error(`no artifact for ${n} — run npm run compile`);
};

let nonce = await provider.getTransactionCount(wallet.address);
async function deploy(name, ...args) {
  const a = artifact(name);
  const f = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
  const c = await f.deploy(...args, { nonce: nonce++ });
  await c.waitForDeployment();
  return await c.getAddress();
}

// ── Stand-in tokens ──────────────────────────────────────────────────────────
console.log('\nDeploying stand-in stablecoins…');
const goodToken = await deploy('MockUSDC');                    // 6 decimals, symbol USDC
console.log(`  6-decimal stand-in: ${goodToken}`);

// An 18-decimal stand-in for the impostors on Robinhood Chain. ChipsToken is a
// plain 18-decimal ERC-20, so it plays the part without a fixture contract.
const eighteenDecimals = await deploy('ChipsToken', wallet.address, wallet.address, wallet.address, wallet.address);
console.log(`  18-decimal stand-in: ${eighteenDecimals}`);

function runDeploy(env, label) {
  console.log(`\n── ${label}`);
  const r = spawnSync('npx', ['hardhat', 'run', 'scripts/deploy.js'], {
    encoding: 'utf8',
    env: { ...process.env, DEPLOY_NETWORK: 'rehearsal', REHEARSAL_RPC: RPC,
           REHEARSAL_CHAIN_ID: String(chainId), ...env },
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

// ── The guard must refuse a bad stablecoin ───────────────────────────────────
const noCode = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';   // Arbitrum One USDC, absent here
const a = runDeploy({ STABLECOIN_ADDRESS: noCode }, 'refuses an address with no contract');
a.code !== 0 && /No contract at/i.test(a.out)
  ? pass('rejected: an address from another chain has no code here')
  : fail(`expected rejection, got code ${a.code}\n${a.out.slice(-600)}`);

const b = runDeploy({ STABLECOIN_ADDRESS: '0xnot-an-address' }, 'refuses a malformed address');
b.code !== 0 && /not a valid address/i.test(b.out)
  ? pass('rejected: malformed address')
  : fail(`expected rejection, got code ${b.code}\n${b.out.slice(-400)}`);

const c = runDeploy({ STABLECOIN_ADDRESS: goodToken, STABLECOIN_SYMBOL: 'USDG' },
  'refuses a token whose symbol is not the expected one');
c.code !== 0 && /reports symbol/i.test(c.out)
  ? pass('rejected: symbol mismatch (a memecoin named USDC would be caught the same way)')
  : fail(`expected rejection, got code ${c.code}\n${c.out.slice(-600)}`);

// The decimals check is the one that catches Robinhood Chain's fake "USDC"
// tokens: they are all 18 decimals, which would misprice every swap by 1e12.
// STABLECOIN_SYMBOL is set so the symbol check passes and decimals is what fails.
const e = runDeploy({ STABLECOIN_ADDRESS: eighteenDecimals, STABLECOIN_SYMBOL: 'SALOON' },
  'refuses an 18-decimal token');
e.code !== 0 && /has 18 decimals/i.test(e.out)
  ? pass('rejected: 18 decimals, the shape of every fake USDC on Robinhood Chain')
  : fail(`expected rejection, got code ${e.code}\n${e.out.slice(-600)}`);

// ── The real thing ───────────────────────────────────────────────────────────
const d = runDeploy({ STABLECOIN_ADDRESS: goodToken, STABLECOIN_SYMBOL: 'USDC' },
  'full mainnet-path deploy');
if (d.code !== 0) {
  fail(`deploy failed (code ${d.code})`);
  console.log(d.out.slice(-3000));
} else {
  pass('deploy completed on the mainnet path');
  const manifest = JSON.parse(readFileSync('deployments/rehearsal.json', 'utf8'));
  const C = manifest.contracts;
  console.log(`  deployed ${Object.keys(C).length} contracts`);

  // ── Verify the post-deploy wiring actually took ─────────────────────────────
  console.log('\n── Post-deploy wiring');
  const at = (name, addr, abi) => new ethers.Contract(addr, abi, provider);
  const CH = 10n ** 18n;

  const token = at('ChipsToken', C.ChipsToken, [
    'function balanceOf(address) view returns (uint256)',
    'function escrowFactory() view returns (address)',
    'function name() view returns (string)',
    'function symbol() view returns (string)',
  ]);
  const staking = at('ChipsStaking', C.ChipsStaking, [
    'function yieldSources(address) view returns (bool)',
    'function yieldPool() view returns (uint256)',
  ]);
  const referral = at('ReferralRegistry', C.ReferralRegistry, ['function authorized(address) view returns (bool)']);
  const escrow  = at('PokerEscrow', C.PokerEscrow, [
    'function tableRegistry() view returns (address)',
    'function kingsPool() view returns (address)',
    'function operatorSigner() view returns (address)',
    'function rakeRecipient() view returns (address)',
    'function pokerHandle() view returns (address)',
  ]);
  const kings   = at('KingOfSpadesPool', C.KingOfSpadesPool, ['function authorized(address) view returns (bool)']);
  const stable  = at('StablecoinPool', C.StablecoinPool, [
    'function authorized(address) view returns (bool)', 'function usdc() view returns (address)']);
  const liq     = at('ChipsLiquidityPool', C.ChipsLiquidityPool, [
    'function usdc() view returns (address)', 'function rateUsdcPerChip() view returns (uint256)',
    'function stablecoinPool() view returns (address)']);

  const check = async (label, got, want) => {
    const g = typeof got === 'function' ? await got() : await got;
    const ok = typeof want === 'function' ? want(g) : String(g).toLowerCase() === String(want).toLowerCase();
    ok ? pass(`${label} (${g})`) : fail(`${label}: got ${g}, expected ${want}`);
  };

  await check('token name', token.name(), 'Saloon');
  await check('token symbol', token.symbol(), 'SALOON');
  await check('escrowFactory → PokerEscrow', token.escrowFactory(), C.PokerEscrow);
  await check('staking seeded 200M', token.balanceOf(C.ChipsStaking), v => v >= 200_000_000n * CH);
  await check('staking yieldPool initialised', staking.yieldPool(), v => v > 0n);
  await check('escrow is a yield source', staking.yieldSources(C.PokerEscrow), v => v === true);
  await check('tournament is a yield source', staking.yieldSources(C.TournamentManager), v => v === true);
  await check('registry is a yield source', staking.yieldSources(C.TableRegistry), v => v === true);
  await check('escrow authorized on referral', referral.authorized(C.PokerEscrow), v => v === true);
  await check('escrow.tableRegistry wired', escrow.tableRegistry(), C.TableRegistry);
  await check('escrow.kingsPool wired', escrow.kingsPool(), C.KingOfSpadesPool);
  await check('escrow.pokerHandle wired', escrow.pokerHandle(), C.PokerHandle);
  await check('escrow authorized on kings pool', kings.authorized(C.PokerEscrow), v => v === true);
  await check('kings pool seeded 100M', token.balanceOf(C.KingOfSpadesPool), v => v >= 100_000_000n * CH);
  await check('promotions pool seeded 100M', token.balanceOf(C.PromotionsPool), v => v >= 100_000_000n * CH);
  await check('liquidity pool seeded 500M', token.balanceOf(C.ChipsLiquidityPool), v => v >= 500_000_000n * CH);
  await check('liq pool authorized on stablecoin pool', stable.authorized(C.ChipsLiquidityPool), v => v === true);
  await check('stablecoin pool points at the verified token', stable.usdc(), goodToken);
  await check('liquidity pool points at the same token', liq.usdc(), goodToken);
  await check('liquidity pool → stablecoin pool', liq.stablecoinPool(), C.StablecoinPool);
  await check('peg rate set', liq.rateUsdcPerChip(), v => v > 0n);

  // The manifest must carry the chain id the frontend will be pinned to.
  await check('manifest chainId matches the node', Promise.resolve(manifest.chainId), String(chainId));
}

console.log(failures ? `\n❌ ${failures} rehearsal failure(s)` : '\n✅ rehearsal clean — the mainnet path works end to end');
process.exit(failures ? 1 : 0);
