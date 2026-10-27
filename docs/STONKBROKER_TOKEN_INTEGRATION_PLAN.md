# PokerVsPlayer — use existing $STONKBROKER instead of CHIPS

Status: **proposed integration, not implemented, no production deployment**. Prepared 2026-10-27.
Existing staging branch: `feat/robinhood-chain-existing-chips` / PR #109 (draft).

## Verified token identity

- Asset: StonkBroker / `STONKBROKER` (18 decimals)
- Robinhood Chain mainnet chain ID: **4663**
- Canonical token: `0xe934e36a439c94017b64a3fece66af12099abf50`
- Token standard according to official whitepaper: ERC-20, Burnable, EIP-2612 Permit; immutable fixed supply, **no new mint**.
- Source: https://stonkbrokers.io/docs/stonkbroker-token
- Source: https://stonkbrokers.io/buy-stonkbroker
- The official StonkBrokers documentation describes a BVI company, **SB (BVI) Ltd**, and reserves brand/trademark rights; token's permissionless ERC-20 transferability is distinct from endorsement or a commercial agreement. Source: https://stonkbrokers.io/docs (Protocol license section).

## Architecture recommendation

**Token:** Reference the existing, verified, canonical mainnet token rather than issuing PokerChips/CHIPS on Robinhood Chain.

**Buy-in:** Player wallet approves `STONKBROKER` for PokerVsPlayer `PokerEscrow` and transfers a quoted token amount; escrow holds the real token.

**Outcome:** Operator-signed hand settlements return `STONKBROKER` to winning players. The authorized operator and regulators must approve fee and rake economics.

**Token conversion:** Do not promise a fixed 0.001 USDC per token or redeem from PokerVsPlayer's CHIPS-specific treasury. Use a reviewed, externally priced DEX route only where lawful, with explicit min output, slippage protection, price-freshness limits, liquidity and payment-risk handling; separate the game's escrow from trading activity. For testnet, no money-redeemable tokens.

**Legal:** Permissionless ERC-20 integration is not a gaming license. Written permission is needed before announcing a *formal* StonkBrokers partnership, implying token issuer support, or using protected marks. A Robinhood Chain mainnet deployment is not authorization to accept real-money poker wagers. Counsel/operator must approve coin/token-as-wager, jurisdiction, KYC/AML, sanctions, age and geolocation checks, financial services, dispute and responsible-gaming controls.

## Contract compatibility findings (existing PokerVsPlayer source)

| Component | Current CHIPS coupling | Required change |
|---|---|---|
| `contracts/PokerEscrow.sol` | `IChipsToken` = IERC20 + `burn(uint256)`; immutable constructor token address. Buy-ins, rebuy, settlement and cash-outs transfer selected token. 15% rake burn, max rake = 50 CHIPS, leased-seat fee = 2 CHIPS. | Reuse ERC20Burnable interface with verified mainnet address. Replace token-specific naming; review and calibrate cap, fee, initial buy-in and burn percentages for a floating-value token. New escrow deployment; immutables cannot be switched on existing instance. |
| `contracts/TournamentManager.sol` | ERC20Burnable entry fees, payouts, rake, burn | Reuse with external token after review; update amounts and prize economics. |
| `contracts/PokerHandle.sol` | ERC20Burnable handle-mint/change cost, CHIPS copy | Reuse with external token; review prices and burn authorization. |
| `contracts/ChipsStaking.sol` | Token address is constructor param, but VIP tier thresholds (25k-5m CHIPS) and 200M CHIPS prefunded rewards are bespoke | Do **not** assert automatic 200M STONKBROKER funding or free APR. Disable/rework the initial rewards model, introduce explicitly funded source accounting and reprice VIP thresholds. |
| `contracts/ChipsLiquidityPool.sol` + `StablecoinPool.sol` | CHIPS-specific owner-set USDC peg and redemption mechanism, seeded with 500M CHIPS | **Exclude from STONKBROKER mode.** Must not create a false fixed-price promise or transfer nonexistent reserves. |
| `contracts/KingOfSpadesPool.sol`, `PromotionsPool.sol` | CHIPS prefund allocations of 100M each | No issuer token mint or automatic allocation; any funds must be voluntarily and transparently deposited from an authorized funded wallet. |
| `contracts/ReferralRegistry.sol`, `TableRegistry.sol`, `ProfitSplitter.sol` | Token-address constructor, token-denominated lease and payout amounts | Reprice all token-denominated fees and assess side effects. |
| `scripts/deploy.js` | Deploys `ChipsToken.sol` and mints 1B CHIPS; seeds staking with 200M, pools with 500M + 100M + 100M; calls `token.setEscrowFactory` | Introduce **explicit** external-token mode, using verified canonical external token; *never deploy CHIPS or mint STONKBROKER*; remove CHIPS allocations, owner-only token methods and peg pool; require separate human-reviewed role addresses, guarded chainId+address+bytecode verification; reject mainnet until contractual/regulatory clearance. Make backwards-compatible default unchanged. |
| Frontend + WebSocket server | Hardcoded CHIPS strings, buy/redeem flow, 0.001 USD peg, chain manifests and token-based thresholds | Use an explicit `TOKEN_SYMBOL/ADDRESS/DECIMALS` and chain-aware manifest; update wallet balances, purchase actions, copy and UX; disable false CHIPS-to-USDC redeem promise; test all game/settlement paths. |
| Robinhood testnet | 46630; canonical STONKBROKER **mainnet** address is not interchangeable | Deploy a **clearly labeled, valueless mock ERC20Burnable** for isolated staging, with a distinct test-only address and no use of StonkBrokers' official name/branding absent consent. Do not call it actual STONKBROKER. |

## Exact rollout order

1. **Partnership/legal gate:** Verify StonkBrokers counterparty authority, token use rights/branding, fee and rake agreement, and whether authorized online poker operator permits staking with this asset. StonkBrokers' corporate BVI domicile does not create a gambling license.
2. **Freeze values:** Set token address+chain ID+symbol/decimals constants for mainnet only. Reject external-token config pointing to the wrong chain, token with no bytecode, or mismatched ERC-20 metadata.
3. **Refactor deployment:** Add external token path that never deploys `ChipsToken.sol`, never mints tokens, never requires `setEscrowFactory`, never auto-seeds reserves, and never deploys the old fixed-peg CHIPS liquidity facility.
4. **Revise economics:** Define fee unit, rake cap, burns vs treasury split, VIP requirements, staking funding, tournament cost, table rentals, referral and promo reserves in a signed-off economics spec. **Do not infer commercial terms from the existing CHIPS tokenomics or StonkBrokers' other protocols.**
5. **Testnet:** Deploy isolated mock token and adapted contracts only; run two-wallet buy-in/rebuy/settle/cash-out/refund, tournament, special fees, pause/downstream failures, retry, wrong-chain and attack tests. Verify token conservation, escrow solvency and no external token supply inflation.
6. **Security + regulatory clearance:** Independent contract audit, anti-collusion, operator trust model, customer protection, age/geofence/KYC/AML/sanctions and payment processing approvals.
7. **Production:** Only after licensing, commercial agreement, and explicit release authorization. No wallet keys, funds movement, pre-existing token transfers, or mainnet issuance through this proposed integration.

## No-change rule

This document does **not** authorize mint, burn, lock, staking, allocation, price peg, swapping, deployment, marketing as an official partnership, merge, or production promotion. Existing CHIPS deployments and balances remain untouched; legal access to real-money games remains unavailable without the relevant gaming authority.
