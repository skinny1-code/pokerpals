# PokerVsPlayer — Kinetiq Elysium + HYPE staging decision

Date: 2026-11-09  
Status: **network support staged; native HYPE wagering NOT implemented or deployed; real-money poker NOT licensed**.  
Branch: `feat/elysium-hype-staging` (isolated from PR #109 Robinhood Chain integration).  
**No keys, transactions, wallet transfers, token issuance, bridge actions, or funding performed.**

## Network identity: important name collision

This proposal means **Kinetiq's Elysium**, the Hyperliquid ecosystem Arbitrum Orbit L2 (public mainnet announced November 9, 2026). It is **not** Vulcan Forged's unrelated Elysium (chain IDs 1338 / 1339).

| | Testnet | Mainnet |
|---|---|---|
| Kinetiq Elysium chain ID | `99801` | `99901` |
| HyperEVM parent chain ID | `998` | `999` |
| RPC (verify live before using) | `https://testnet-rpc.elysium.kinetiq.xyz` | `https://rpc.elysium.kinetiq.xyz` |
| Explorer | https://elysium.kinetiq.xyz/testnet-explorer | https://elysium.kinetiq.xyz/explorer |
| Native currency | test HYPE, 18 decimals | HYPE, 18 decimals |

Official: https://elysium.kinetiq.xyz/docs  
Launch announcement: https://www.globenewswire.com/news-release/2026/11/09/3398435/0/en/kinetiq-launches-elysium-public-mainnet-a-high-performance-layer-2-built-for-hyperliquid.html  
Alchemy technical guide: https://www.alchemy.com/docs/reference/elysium-api-faq  
Hyperliquid native token: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm

## Major protocol incompatibility: HYPE is native, CHIPS is ERC-20

Elysium gas HYPE is **not an ERC-20 contract**; native HYPE is passed with `msg.value`, received by payable functions, and transferred via a guarded native-coin call. An ERC-20 `approve` / `transferFrom` of the native asset is impossible. Existing `PokerEscrow.sol`, `TournamentManager.sol`, `PokerHandle.sol`, `TableRegistry.sol`, `ChipsStaking.sol`, `ChipsLiquidityPool.sol` and the frontend assume a burnable ERC-20 and CHIPS allocations.

Two engineering possibilities:

1. **Preferred: native HYPE escrow.** Implement a purpose-built `NativeHypePokerEscrow` using `buyIn(tableId) payable`, `rebuy(tableId) payable`, separate gas budget, reentrancy protection, operator signatures bound to `block.chainid` and `address(this)`, all-internal ledger, recipient payout/refund with failure-safe withdrawal, contract solvency invariant, and no invented supply or fixed redemption peg. Rework tournament entry, fee units, handles, and staking rather than assuming 1B token emissions. Game-server ABI and wallet hooks must be adapted together. Retain off-chain shuffle/gameplay only if independently audited and all anti-collusion controls pass.
2. **Alternative: reviewed wrapped HYPE.** Wrapped native HYPE is an ERC-20 backed 1:1 by native HYPE; third-party PerpMe references WHYPE on Elysium at `0xbA876237B0F021A6c6D852d6c26E107997cC5E81`, **not yet independently authenticated from the protocol issuer in this project**. Verify code, chain, escrow semantics, canonical integration and allowances before trusting it. Even then, standard WETH9 `withdraw` is not the `burn` used in PokerVsPlayer contracts, so replacing an address is insufficient. Never burn WHYPE receipts while leaving their backing HYPE stranded.

## Implementation status (updated November 9, 2026)

**Source implemented on draft PR #120, unmerged and isolated:**

- `contracts/NativeHypePokerEscrow.sol`: payable native test HYPE buy-ins/rebuys, constant-sum signed bankroll updates, replay-protected operator-authorized cashout credits, pull-claim withdrawals, refunds, 24h emergency exits. No minted CHIPS, no invented HYPE token, no guaranteed payout price, and **no rake** in the isolated test implementation.
- `test/contracts/NativeHypePokerEscrow.test.js`: simulated-EVM tests for table creation, human verification, exact payable amounts, rebuy, signed bankroll conservation, signature invalidation and replay rejection, pull claims, refund, time-locked escape, and reopening an active table when it falls below two players.
- `server/nativeHypeCodec.js`, `server/nativeHypeAdapter.js` and guarded `server/index.js`: 1 integer game unit = 10^12 native wei (1 micro-HYPE); reject unbacked bankrolls; confirm signed on-chain settlement before advancing hands; reject HYPE mainnet 99901; reject verification/bot bypasses; freeze tables after settlement failures.
- `src/hooks/wallet/core.js`, `useWallet.js`, `useEscrow.js`: native HYPE payable wallet and chain-99801 flow; no CHIPS allowance; escrow-balance and bytecode checks.
- `src/app/hype-staging/page.jsx`: explicit staging-only user QA controls and separately claimable on-chain credit; lobby and table UI now show micro-HYPE test units in the correct mode.
- `scripts/deployNativeHypeTestnet.js`: explicit, guarded testnet-only contract deployment; will not deploy if network or role addresses do not match.
- `scripts/smokeNativeHypeTestnet.js`: two-wallet, testnet-only escrow smoke with saved transaction receipts; **available but NOT yet executed**.
- Existing PokerVsPlayer CHIPS/RH plans, Arbitrum chain config and production application remain untouched on `main`.

### Validation performed / missing

| Check | Status | Meaning |
|---|---|---|
| Micro-HYPE codec 9 isolated assertions | **PASS** (source executed in JS isolate) | Exact scaling and no unsafe fractional amounts |
| Game-server adapter mock-chain assertions | **PASS** (source executed in JS isolate) | Signed balance conservation, abort on invalid balances/reverted settlements, cashout reconciliation |
| JS syntax of server/wallet modules | **PASS** (source-parsed) | Syntax only, not live server runtime |
| Next.js Vercel automatic preview | **READY** for several earlier PR commits (latest head still requires refresh) | Build passes; no backend/onchain certification |
| GitHub Actions `npm test` / `test:contracts` | **NOT CONFIRMED** | CI jobs have repeatedly failed prior to executing steps, even for unrelated Renovate branches; account/runner status must be investigated |
| Hardhat Solidity compilation and simulated-EVM escrow suite | **NOT RUN / NOT VERIFIED** | Test source exists, no compiled results |
| Elysium RPC TLS/chain ID live probe | **NOT RUN / NOT VERIFIED** | Probe script exists, live RPC chain ID not confirmed in this project |
| Funded two-wallet Elysium testnet smoke with receipts | **NOT RUN** | Requires dedicated valueless test HYPE accounts and operator roles |
| E2E real poker hand, independent fairness audit, legal authorization | **NOT COMPLETE** | No real-money launch is authorized |

### Exact authorized test sequence

1. On branch `feat/elysium-hype-staging`, run `npm ci && npm test && npm run test:contracts`; archive results. The `test:hype` script can isolate the escrow contract suite.
2. Run read-only `npm run verify:elysium:testnet`, confirm chain 99801, TLS validity and block progression. Do not disable TLS validation.
3. Configure separate **test-only** deployer/operator/oracle/player keys privately in CI secrets or local `.env`, not in source/chat; fund with valueless test HYPE only.
4. After contract tests and review, run `HYPE_TESTNET_DEPLOY_ACK=ISOLATED_TEST_ONLY npm run deploy:hype:testnet` (uses `DEPLOY_NETWORK=elysiumTestnet`), verify manifest and deployed runtime code.
5. Run `HYPE_TESTNET_SMOKE_ACK=ISOLATED_TEST_ONLY npm run smoke:hype:testnet`, retaining `deployments/elysiumTestnet.smoke.json` transaction receipts. This tests escrow transfers, NOT the full multiplayer poker application.
6. Only after the escrow smoke passes, set `NEXT_PUBLIC_CHAIN_ID=99801`, `NEXT_PUBLIC_ENABLE_ELYSIUM_NETWORKS=true`, `NEXT_PUBLIC_ELYSIUM_HYPE_ESCROW=<verified testnet address>`, `CHAIN_ID=99801`, `ENABLE_HYPE_TESTNET_GAME=ISOLATED_ONLY` in a **separate** staging app/server. Never enable `TESTNET_SKIP_CHAIN_VERIFY`, `TESTNET_SKIP_HUMAN_CHECK` or `ENABLE_WS_BOTS` in this test.
7. Run 2-player, multi-hand end-to-end game/settlement/withdraw tests, crash-and-recovery, timeouts, bot/collusion and client attack simulations, then independent smart-contract and game-fairness audit. Confirm bankroll reconciliation after each completed hand.

**Commercial/production scope:** HYPE mainnet wagering remains prohibited until actual jurisdictional gaming approval, KYC/AML, geofencing, game integrity certification and an independent security review. Deploying a contract on Elysium is not a gaming license.

## Explicitly completed in this branch

- Elysium/Atlantis independent from Arbitrum and Robinhood with the *correct* Kinetiq chain IDs in Hardhat and wagmi.
- Opt-in `NEXT_PUBLIC_ENABLE_ELYSIUM_NETWORKS` defaults to `false`; existing public CHIPS frontend and deployments unchanged.
- Legacy `scripts/deploy.js` explicitly refuses `DEPLOY_NETWORK=elysium` and `elysiumTestnet` to prevent accidental 1B CHIPS mint on a HYPE chain.
- Existing CHIPS game server explicitly refuses Elysium chain IDs rather than accepting an incorrect manifest or RPC.
- A **read-only** JSON-RPC probe checks live chain ID and block height; no wallet or private keys involved:
  - `npm run verify:elysium:testnet`
  - `npm run verify:elysium:mainnet`
- Static invariant tests: `npm test` contains `test/elysiumConfig.test.mjs`.

## Still required before an actual testnet game

1. Build native HYPE smart contracts and frontend/server integration, including bankroll accounting, blinds, multiparty betting, settlement, refunds, tournament logic, side pots, split-pot rounding and signature replay protection.
2. Verify oracle/signer semantics, wallet verification, withdrawal failure handling, gas sponsorship, geofencing, banned jurisdictions, player eligibility and rate-limits on HYPE.
3. Add independent testnet-only build/deployment, which does **not** deploy CHIPS or create a fabricated HYPE ERC-20. Capture testnet receipts and a two-wallet game transcript, including payouts, rake, refunds, RPC outages and malicious settlement cases.
4. Validate economics with HYPE's variable market price; retire the CHIPS fixed USD redemption promise, 50/20/10/10 CHIPS allocations, unbacked APR, and 15% CHIPS burn. Decide rake allocation with governing business.
5. Audit contracts and verify requirements under applicable gambling law. Blockchain deployment or an offshore corporate structure is **not** a wagering license; **real-money gaming must remain disabled** absent proper authorization.

## Network-specific risks

- HYPE on HyperEVM vs HYPE on Elysium are distinct balances and require a verified bridge route.
- L2 `block.number` semantics differ from Ethereum; do not rely on it for shuffle entropy or duration without verification.
- Elysium has a single sequencer at launch; account for RPC outages, reorg/finality, paused sequencer, gas accounting and delayed withdrawals.
- Public/testnet RPC endpoints are not audited production infrastructure. The testnet URL was reported with an expired TLS certificate on 2026-11-09 by an independent observer: probe instead of suppressing TLS errors.
- Do not hardcode third-party/unverified bridge contracts or impersonate an official partner.

**Release decision:** NO mainnet poker contract deployment and NO real-money wagering until the implementation and legal requirements are independently proven.
