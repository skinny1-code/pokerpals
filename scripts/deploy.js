// scripts/deploy.js — deploys all Saloon contracts in order
// npx hardhat run scripts/deploy.js
// Set DEPLOY_NETWORK=arbitrum for mainnet; defaults to arbitrumSepolia
import "dotenv/config";
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_NETWORKS = ["arbitrumSepolia", "arbitrum", "robinhoodTestnet", "robinhood", "rehearsal"];
const CHAIN_IDS      = { arbitrumSepolia: "421614", arbitrum: "42161", robinhoodTestnet: "46630", robinhood: "4663",
                         rehearsal: String(Number(process.env.REHEARSAL_CHAIN_ID) || 31337) };
// `rehearsal` is deliberately NOT a testnet: the whole point is to run the
// mainnet path (no MockUSDC shortcut, stablecoin validated) against a local node.
const TESTNETS       = new Set(["arbitrumSepolia", "robinhoodTestnet"]);

// Known-good stablecoins per chain, with the symbol and decimals we expect to
// find at that address. Verified on-chain before use — see assertStablecoin().
//
// Robinhood Chain has NO Circle USDC. Its native stablecoin is USDG (Global
// Dollar, Paxos), and every token on that chain calling itself "USDC" is an
// impostor: unverified, 18 decimals, and a 1e27 supply minted to nobody
// ("Universal Stable Digital Coin", "United States Central Dollar",
// "UpSideDownCat on robinhood", …). Pasting Arbitrum One's USDC address there
// is just as bad — no contract lives at it. Both mistakes are permanent,
// because StablecoinPool and ChipsLiquidityPool take the token in their
// constructors and never let go of it.
//
// USDG is 6 decimals, same as USDC, so the peg math is unchanged:
// rateUsdcPerChip stays "stablecoin-wei per 1e18 SALOON".
const KNOWN_STABLECOINS = {
  arbitrum:  { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6 },
  robinhood: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG", decimals: 6 },
};

/**
 * Refuse to deploy against a stablecoin that is not what the operator thinks it
 * is. Checks the address actually holds a token, that its decimals match what
 * the peg math assumes, and that its symbol is the one expected.
 */
async function assertStablecoin(ethers, address, expected) {
  let checksummed;
  try { checksummed = ethers.getAddress(address); }
  catch { throw new Error(`Stablecoin address "${address}" is not a valid address.`); }

  const code = await ethers.provider.getCode(checksummed);
  if (code === "0x") {
    throw new Error(
      `No contract at ${checksummed} on this chain. A stablecoin address from ` +
      `another chain does not carry over — Arbitrum One's USDC, for instance, ` +
      `does not exist on Robinhood Chain.`
    );
  }

  const token = new ethers.Contract(checksummed, [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
  ], ethers.provider);

  let symbol, decimals, supply;
  try {
    [symbol, decimals, supply] = await Promise.all([
      token.symbol(), token.decimals(), token.totalSupply(),
    ]);
  } catch (e) {
    throw new Error(`${checksummed} does not answer as an ERC-20 (${e.shortMessage || e.message}).`);
  }
  decimals = Number(decimals);

  console.log(`   stablecoin at ${checksummed}: ${symbol}, ${decimals} decimals, supply ${supply}`);

  // Decimals are load-bearing: rateUsdcPerChip is denominated in the token's
  // smallest unit, so 18 decimals silently misprices every swap by 1e12.
  const wantDecimals = expected?.decimals ?? 6;
  if (decimals !== wantDecimals) {
    throw new Error(
      `${symbol} at ${checksummed} has ${decimals} decimals, expected ${wantDecimals}. ` +
      `The swap peg is denominated in the token's smallest unit, so this would ` +
      `misprice every trade by 1e${Math.abs(decimals - wantDecimals)}. Every fake ` +
      `"USDC" on Robinhood Chain has 18 decimals — check you have the right token.`
    );
  }

  const wantSymbol = process.env.STABLECOIN_SYMBOL || expected?.symbol;
  if (wantSymbol && symbol !== wantSymbol) {
    throw new Error(
      `Token at ${checksummed} reports symbol "${symbol}", expected "${wantSymbol}". ` +
      `Set STABLECOIN_SYMBOL to override if this is deliberate.`
    );
  }

  return checksummed;
}

const networkName = process.env.DEPLOY_NETWORK || "arbitrumSepolia";
if (!VALID_NETWORKS.includes(networkName)) {
  throw new Error(`Unknown DEPLOY_NETWORK="${networkName}". Valid: ${VALID_NETWORKS.join(", ")}`);
}

async function main() {
  const conn = await network.connect({ network: networkName });
  const ethers = conn.ethers;
  const [deployer] = await ethers.getSigners();
  const isTestnet = TESTNETS.has(networkName);
  console.log("Deployer:", deployer.address);
  console.log("Network: ", networkName);

  const OPERATOR  = process.env.OPERATOR_SIGNER  || deployer.address;
  const RAKE_ADDR = process.env.RAKE_WALLET       || deployer.address;
  const ORACLE    = process.env.ANTIBOT_ORACLE    || deployer.address;
  const DEV       = process.env.DEV_WALLET        || deployer.address;

  // Community, ops, and liquidity allocations now go to pool contracts.
  // Deployer holds them temporarily and transfers post-deploy.

  // 1. ChipsToken
  //    Deployer receives: STAKING_POOL (200M) + COMMUNITY_ALLOC (100M) + OPS_RESERVE (100M) + LIQUIDITY_ALLOC (500M)
  //    Dev wallet receives: DEV_INITIAL_GRANT (25M) + vested remainder stays in contract
  const Token = await ethers.getContractFactory("ChipsToken");
  const token = await Token.deploy(
    DEV,                // devWallet — receives 25M upfront, rest vested in-contract
    deployer.address,   // communityWallet → deployer (transferred to PromotionsPool below)
    deployer.address,   // liquidityWallet → deployer (transferred to ChipsLiquidityPool below)
    deployer.address    // opsWallet → deployer (transferred to KingOfSpadesPool below)
  );
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("✅ ChipsToken:", tokenAddr);

  // 2. ChipsStaking
  const Staking = await ethers.getContractFactory("ChipsStaking");
  const staking = await Staking.deploy(tokenAddr);
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();
  console.log("✅ ChipsStaking:", stakingAddr);

  // 3. ReferralRegistry
  const Referral = await ethers.getContractFactory("ReferralRegistry");
  const referral = await Referral.deploy(tokenAddr);
  await referral.waitForDeployment();
  const referralAddr = await referral.getAddress();
  console.log("✅ ReferralRegistry:", referralAddr);

  // 4. PokerEscrow
  const Escrow = await ethers.getContractFactory("PokerEscrow");
  const escrow = await Escrow.deploy(
    tokenAddr, OPERATOR, RAKE_ADDR, ORACLE, stakingAddr, referralAddr
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✅ PokerEscrow:", escrowAddr);

  // 5. TournamentManager
  const Tourn = await ethers.getContractFactory("TournamentManager");
  const tourn = await Tourn.deploy(tokenAddr, OPERATOR, RAKE_ADDR, stakingAddr);
  await tourn.waitForDeployment();
  const tournAddr = await tourn.getAddress();
  console.log("✅ TournamentManager:", tournAddr);

  // 6. TableRegistry
  const Registry = await ethers.getContractFactory("TableRegistry");
  const registry = await Registry.deploy(tokenAddr, RAKE_ADDR, stakingAddr);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("✅ TableRegistry:", registryAddr);

  // 7. HandleRenderer + PokerHandle — username NFT with swappable on-chain art
  const Renderer = await ethers.getContractFactory("HandleRenderer");
  const rendererC = await Renderer.deploy();
  await rendererC.waitForDeployment();
  const rendererAddr = await rendererC.getAddress();
  console.log("✅ HandleRenderer:", rendererAddr);

  const Handle = await ethers.getContractFactory("PokerHandle");
  const handle = await Handle.deploy(tokenAddr, escrowAddr, rendererAddr);
  await handle.waitForDeployment();
  const handleAddr = await handle.getAddress();
  console.log("✅ PokerHandle:", handleAddr);

  // ── NEW POOL CONTRACTS ────────────────────────────────────────────────────

  // 8. KingOfSpadesPool — operating expenses (seeded with 100M OPS_RESERVE)
  const KingsPool = await ethers.getContractFactory("KingOfSpadesPool");
  const kingsPool = await KingsPool.deploy(tokenAddr);
  await kingsPool.waitForDeployment();
  const kingsPoolAddr = await kingsPool.getAddress();
  console.log("✅ KingOfSpadesPool:", kingsPoolAddr);

  // 9. PromotionsPool — community budget (seeded with 100M COMMUNITY_ALLOC)
  const PromoPool = await ethers.getContractFactory("PromotionsPool");
  const promoPool = await PromoPool.deploy(tokenAddr);
  await promoPool.waitForDeployment();
  const promoPoolAddr = await promoPool.getAddress();
  console.log("✅ PromotionsPool:", promoPoolAddr);

  // 10. USDC: explicit env override wins; else MockUSDC on testnets; else the
  //     known native USDC for the chain. Unknown mainnets (e.g. Robinhood Chain)
  //     must pass USDC_ADDRESS — we never guess a real-money token address.
  let usdcAddr;
  if (isTestnet) {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddr = await mockUsdc.getAddress();
    console.log("✅ MockUSDC:", usdcAddr);
  } else {
    // Whatever the source, the token is checked on-chain before it goes into
    // two constructors that can never be changed.
    const known = KNOWN_STABLECOINS[networkName];
    const requested = process.env.STABLECOIN_ADDRESS || process.env.USDC_ADDRESS || known?.address;
    if (!requested) {
      throw new Error(
        `No stablecoin address known for "${networkName}". Set STABLECOIN_ADDRESS ` +
        `to the chain's stablecoin — and verify it on a block explorer first.`
      );
    }
    const fromEnv = !!(process.env.STABLECOIN_ADDRESS || process.env.USDC_ADDRESS);
    console.log(`ℹ️  Stablecoin ${fromEnv ? "from env" : `default for ${networkName}`}: ${requested}`);
    // An env override of a chain we have a default for is expected to be that
    // same token unless STABLECOIN_SYMBOL says otherwise.
    usdcAddr = await assertStablecoin(ethers, requested, known);
  }

  // 11. StablecoinPool — USDC reserve for on-network use (prizes, payouts, promos)
  const StablePool = await ethers.getContractFactory("StablecoinPool");
  const stablePool = await StablePool.deploy(usdcAddr);
  await stablePool.waitForDeployment();
  const stablePoolAddr = await stablePool.getAddress();
  console.log("✅ StablecoinPool:", stablePoolAddr);

  // 12. ChipsLiquidityPool — 500M SALOON trading pool at $0.001/CHIP peg
  //     rateUsdcPerChip = 1000 → 1000 USDC-wei per 1e18 SALOON = $0.001/CHIP
  const LiqPool = await ethers.getContractFactory("ChipsLiquidityPool");
  const liqPool = await LiqPool.deploy(tokenAddr, usdcAddr, stablePoolAddr, 1000n);
  await liqPool.waitForDeployment();
  const liqPoolAddr = await liqPool.getAddress();
  console.log("✅ ChipsLiquidityPool:", liqPoolAddr);

  // 13. HandHistory — batched on-chain gameplay stats (server flushes periodically)
  const HandHistory = await ethers.getContractFactory("HandHistory");
  const handHistory = await HandHistory.deploy(OPERATOR);
  await handHistory.waitForDeployment();
  const handHistoryAddr = await handHistory.getAddress();
  console.log("✅ HandHistory:", handHistoryAddr);

  // ── STAKING POOL SEED ────────────────────────────────────────────────────

  const STAKING_POOL    = ethers.parseUnits("200000000", 18);  // 200M
  const OPS_RESERVE     = ethers.parseUnits("100000000", 18);  // 100M
  const COMMUNITY_ALLOC = ethers.parseUnits("100000000", 18);  // 100M
  const LIQUIDITY_ALLOC = ethers.parseUnits("500000000", 18);  // 500M

  // 13. Seed staking yield pool: 200M deployer → staking
  await token.transfer(stakingAddr, STAKING_POOL);
  await staking.initYieldPool();
  console.log("✅ Staking yield pool seeded with 200M SALOON");

  // 14. Transfer allocations to pool contracts
  await token.transfer(kingsPoolAddr, OPS_RESERVE);
  console.log("✅ KingOfSpadesPool seeded with 100M OPS_RESERVE");

  await token.transfer(promoPoolAddr, COMMUNITY_ALLOC);
  console.log("✅ PromotionsPool seeded with 100M COMMUNITY_ALLOC");

  await token.transfer(liqPoolAddr, LIQUIDITY_ALLOC);
  console.log("✅ ChipsLiquidityPool seeded with 500M LIQUIDITY_ALLOC");

  // ── AUTHORIZATIONS ───────────────────────────────────────────────────────

  // 15. Authorize yield sources and referral registry (parallel nonce submit)
  {
    const n = await deployer.getNonce('pending');
    const a = await staking.setYieldSource(escrowAddr,    true, { nonce: n });
    const b = await staking.setYieldSource(tournAddr,     true, { nonce: n + 1 });
    const c = await staking.setYieldSource(registryAddr,  true, { nonce: n + 2 });
    const d = await referral.setAuthorized(escrowAddr,    true, { nonce: n + 3 });
    const e = await referral.setAuthorized(tournAddr,     true, { nonce: n + 4 });
    await Promise.all([a.wait(), b.wait(), c.wait(), d.wait(), e.wait()]);
  }
  console.log("✅ Yield sources authorized (escrow + tournament + registry)");
  console.log("✅ Referral registry authorized");

  // 16. Authorize King of Spades Pool rake sources
  {
    const n = await deployer.getNonce('pending');
    const a = await kingsPool.setAuthorized(escrowAddr,    true, { nonce: n });
    const b = await kingsPool.setAuthorized(tournAddr,     true, { nonce: n + 1 });
    const c = await kingsPool.setAuthorized(registryAddr,  true, { nonce: n + 2 });
    await Promise.all([a.wait(), b.wait(), c.wait()]);
  }
  console.log("✅ KingOfSpadesPool authorized for escrow + tournament + registry");

  // 17. Authorize ChipsLiquidityPool as StablecoinPool caller
  await stablePool.setAuthorized(liqPoolAddr, true);
  console.log("✅ StablecoinPool authorized ChipsLiquidityPool");

  // 18. Wire pool addresses into rake contracts and other wiring
  {
    const n = await deployer.getNonce('pending');
    const a = await escrow.setKingsPool(kingsPoolAddr,    { nonce: n });
    const b = await tourn.setKingsPool(kingsPoolAddr,     { nonce: n + 1 });
    const c = await registry.setKingsPool(kingsPoolAddr,  { nonce: n + 2 });
    const d = await escrow.setTableRegistry(registryAddr, { nonce: n + 3 });
    const e = await token.setEscrowFactory(escrowAddr,    { nonce: n + 4 });
    const f = await escrow.setPokerHandle(handleAddr,     { nonce: n + 5 });
    const g = await tourn.setPokerHandle(handleAddr,      { nonce: n + 6 });
    await Promise.all([a.wait(), b.wait(), c.wait(), d.wait(), e.wait(), f.wait(), g.wait()]);
  }
  console.log("✅ KingsPool wired into escrow + tournament + registry");
  console.log("✅ PokerEscrow wired to TableRegistry");
  console.log("✅ Token wired to escrow");
  console.log("✅ PokerHandle wired into escrow + tournament (isHandleEligible gate)");

  console.log("\n── Role wallets ───────────────────────────────────────");
  console.log(`Deployer:          ${deployer.address}`);
  console.log(`Operator signer:   ${OPERATOR}`);
  console.log(`Rake recipient:    ${RAKE_ADDR}   ← personal income (20% treasury rake)`);
  console.log(`Dev wallet:        ${DEV}   ← 25M SALOON + 2M/month vest`);
  console.log("\n── On-chain pools ─────────────────────────────────────");
  console.log(`KingOfSpadesPool:  ${kingsPoolAddr}   ← 100M ops + 10% rake`);
  console.log(`PromotionsPool:    ${promoPoolAddr}   ← 100M community`);
  console.log(`ChipsLiquidityPool:${liqPoolAddr}   ← 500M SALOON ($0.001/CHIP)`);
  console.log(`StablecoinPool:    ${stablePoolAddr}   ← USDC reserve`);
  console.log(`ChipsStaking:      ${stakingAddr}   ← 200M + 45% rake`);
  console.log("\n── Rake split per hand ───────────────────────────────");
  console.log("  15% burned | 45% staking | 20% treasury | 10% KingsPool | 10% referral");
  console.log("\n── Room lease fee split ──────────────────────────────");
  console.log("  15% burned | 45% staking | 30% treasury | 10% KingsPool");

  // Save deployment manifest
  const deployBlock = await ethers.provider.getBlockNumber();
  const deplDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(deplDir)) fs.mkdirSync(deplDir, { recursive: true });
  fs.writeFileSync(
    path.join(deplDir, `${networkName}.json`),
    JSON.stringify({
      network: networkName,
      chainId: CHAIN_IDS[networkName],
      deployedAt: new Date().toISOString(),
      deployer: deployer.address,
      deployBlock,
      contracts: {
        ChipsToken:          tokenAddr,
        ChipsStaking:        stakingAddr,
        ReferralRegistry:    referralAddr,
        PokerEscrow:         escrowAddr,
        TournamentManager:   tournAddr,
        TableRegistry:       registryAddr,
        PokerHandle:         handleAddr,
        HandleRenderer:      rendererAddr,
        KingOfSpadesPool:    kingsPoolAddr,
        PromotionsPool:      promoPoolAddr,
        StablecoinPool:      stablePoolAddr,
        ChipsLiquidityPool:  liqPoolAddr,
        HandHistory:         handHistoryAddr,
        ...(isTestnet ? { MockUSDC: usdcAddr } : { USDC: usdcAddr }),
      },
    }, null, 2)
  );
  console.log(`\n✅ deployments/${networkName}.json saved`);

  // Auto-write contract addresses into .env.
  // NEXT_PUBLIC_CHAIN_ID must be written too: EXPECTED_CHAIN defaults to the
  // Arbitrum Sepolia id, so without it a mainnet deploy leaves the frontend
  // loading mainnet ADDRESSES while forcing wallets onto the testnet chain.
  const envArgs = [
    `NEXT_PUBLIC_CHAIN_ID=${CHAIN_IDS[networkName]}`,
    `NEXT_PUBLIC_CHIPS_TOKEN=${tokenAddr}`,
    `NEXT_PUBLIC_ESCROW=${escrowAddr}`,
    `NEXT_PUBLIC_STAKING=${stakingAddr}`,
    `NEXT_PUBLIC_REFERRAL=${referralAddr}`,
    `NEXT_PUBLIC_TOURNAMENT=${tournAddr}`,
    `NEXT_PUBLIC_TABLE_REGISTRY=${registryAddr}`,
    `NEXT_PUBLIC_POKER_HANDLE=${handleAddr}`,
    `NEXT_PUBLIC_KINGS_POOL=${kingsPoolAddr}`,
    `NEXT_PUBLIC_PROMOTIONS_POOL=${promoPoolAddr}`,
    `NEXT_PUBLIC_STABLECOIN_POOL=${stablePoolAddr}`,
    `NEXT_PUBLIC_LIQUIDITY_POOL=${liqPoolAddr}`,
    `NEXT_PUBLIC_HAND_HISTORY=${handHistoryAddr}`,
    ...(isTestnet ? [`NEXT_PUBLIC_MOCK_USDC=${usdcAddr}`] : [`NEXT_PUBLIC_USDC=${usdcAddr}`]),
  ].join(" ");
  try {
    execSync(`node ${__dirname}/updateEnv.js ${envArgs}`, { stdio: "inherit" });
    console.log("\n✅ Contract addresses written to .env automatically");
  } catch {
    console.log("\n── Paste into .env manually if auto-write failed ─────");
    console.log(`NEXT_PUBLIC_CHIPS_TOKEN=${tokenAddr}`);
    console.log(`NEXT_PUBLIC_ESCROW=${escrowAddr}`);
    console.log(`NEXT_PUBLIC_STAKING=${stakingAddr}`);
    console.log(`NEXT_PUBLIC_REFERRAL=${referralAddr}`);
    console.log(`NEXT_PUBLIC_TOURNAMENT=${tournAddr}`);
    console.log(`NEXT_PUBLIC_TABLE_REGISTRY=${registryAddr}`);
    console.log(`NEXT_PUBLIC_POKER_HANDLE=${handleAddr}`);
    console.log(`NEXT_PUBLIC_KINGS_POOL=${kingsPoolAddr}`);
    console.log(`NEXT_PUBLIC_PROMOTIONS_POOL=${promoPoolAddr}`);
    console.log(`NEXT_PUBLIC_STABLECOIN_POOL=${stablePoolAddr}`);
    console.log(`NEXT_PUBLIC_LIQUIDITY_POOL=${liqPoolAddr}`);
    console.log(`NEXT_PUBLIC_HAND_HISTORY=${handHistoryAddr}`);
    if (isTestnet) console.log(`NEXT_PUBLIC_MOCK_USDC=${usdcAddr}`);
    else console.log(`NEXT_PUBLIC_USDC=${usdcAddr}`);
  }
  console.log("──────────────────────────────────────────────────────");
}

main().catch(e => { console.error(e); process.exit(1); });
