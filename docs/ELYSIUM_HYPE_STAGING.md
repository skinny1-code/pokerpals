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
