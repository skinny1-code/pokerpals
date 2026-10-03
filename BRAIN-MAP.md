# Saloon — Brain Map & Reference

> Keep this file private. Contains wallet addresses and role descriptions.
> Private keys are stored only in `.env` (encrypted as `.env.enc`).

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Saloon                              │
│                                                                 │
│  Players ──WS──► Game Server ──signs──► Settlement Sig         │
│                      │                       │                  │
│                   (operator key)      Players submit            │
│                                       to PokerEscrow            │
│                                           on-chain              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Wallets & Keys

### Operational Keys (sign transactions / run the system)

| Role | Env Var | Address | Purpose |
|---|---|---|---|
| **Deployer** | `DEPLOYER_KEY` | `0x0B58C02408E095F8f7527FF42184E3FC54e6Df86` | Deploys all 7 contracts. Becomes contract owner. Replace with Gnosis Safe multisig before mainnet goes live with real users. |
| **Operator** | `OPERATOR_PRIVATE_KEY` | signs as → | The game server's signing key. Signs keccak256(tableId, handNonce, winners, shares) for every hand. This is the trust anchor — if leaked, attacker can fake payouts. |
| **Operator Signer** | `OPERATOR_SIGNER` | `0x7591548d072C72F00eD9171555cF4B99642B617c` | The *address* (public) registered in PokerEscrow. Contract verifies settlement sigs against this address. |
| **Anti-Bot Oracle** | `ANTIBOT_ORACLE` | `0x6E46deF34f262aF3F09bD830fA7e18EaA0bd0a1D` | Only address allowed to call `escrow.markHuman(player, true)`. Runs the standalone oracle that gates buy-ins. |
| **Ops Wallet** | `OPS_WALLET_KEY` / `OPS_WALLET` | `0xaB08Be0a779fc0001b35A77923cb5d87F87719dB` | Bot player wallet + ops budget wallet. Used by SPAWN_BOT feature. Holds 100M SALOON one-time budget. |

### Allocation Wallets (hold the 1B SALOON supply)

| Role | Env Var | Address | Allocation | Income |
|---|---|---|---|---|
| **Rake** | `RAKE_WALLET` | `0x567cD273e67eA3D25bE6406B15606128BAb10044` | — | **Your ongoing income.** 20% of every rake + 100% seat fees + 30% tournament rake. Paid per hand. |
| **Dev** | `DEV_WALLET` | `0xf48e4dAD590C2Af34AED733c3f0a517dbe99d844` | 100M SALOON | Personal equity. Vests linearly over 24 months in-contract. Call `claimDevVest()` to withdraw. |
| **Ops** | `OPS_WALLET` | `0xaB08Be0a779fc0001b35A77923cb5d87F87719dB` | 100M SALOON | One-time devops budget. Servers, staff, marketing. |
| **Community** | `COMMUNITY_WALLET` | `0x772ae34FA62F445b4689396Ec986114Ab95fF666` | 100M SALOON | Tournaments, airdrops, community grants. |
| **Liquidity** | `LIQUIDITY_WALLET` | `0xE5E064260898AC39Fe4413Ac3a05a89293761ce6` | 500M SALOON | DEX liquidity pools (Camelot, Uniswap on Arbitrum). |
| *(Staking pool)* | — | `0x125b7F7649276e801D5843f0158D94939e7dA295` (contract) | 200M SALOON | Seeded directly into ChipsStaking at deploy. Not a wallet. |

---

## Token Economy

### 1B SALOON Supply Breakdown
```
500M (50%) ──► Liquidity Wallet    → DEX pools
200M (20%) ──► ChipsStaking        → yield pool (seeded at deploy)
100M (10%) ──► Dev Wallet          → 24-month vest (personal equity)
100M (10%) ──► Ops Wallet          → devops budget
100M (10%) ──► Community Wallet    → tournaments / airdrops
```

### Rake Split per Hand
```
Total Rake collected from the pot
  ├─ 35% ──► Burned               → deflationary supply reduction
  ├─ 35% ──► ChipsStaking pool    → stakers earn passively
  ├─ 20% ──► Rake Wallet          → YOUR income
  └─ 10% ──► Referrer             → (if player has a referrer)
```

### VIP Staking Tiers
| Tier | Stake | Rake % | APR |
|---|---|---|---|
| 0 Standard | 0 | 1.5% | 0% |
| 1 Bronze | 1,000 SALOON | 1.3% | 2% |
| 2 Silver | 10,000 SALOON | 1.1% | 4% |
| 3 Gold | 50,000 SALOON | 0.9% | 7% |
| 4 Whale | 200,000 SALOON | 0.6% | 12% |

---

## Smart Contracts (Arbitrum Sepolia — testnet)

| Contract | Address |
|---|---|
| ChipsToken | `0xCE88943bFB408376af8A7B5788497F57a6913d3A` |
| PokerEscrow | `0x555eD8617Bba49Ce04EB7EB3c975C81D3e8859D3` |
| ChipsStaking | `0x125b7F7649276e801D5843f0158D94939e7dA295` |
| ReferralRegistry | `0x4dF0291E1C9F95D2F6B0765a99A977D4B2E69673` |
| TournamentManager | `0x59017c38D4Fa13143F95aC9e48f674dc7367Fb41` |
| TableRegistry | `0x0a231417bfD9D7BD7516780F6F77b06A1443Dd2a` |
| PokerHandle | `0x1eba55244B49f760a4b9dB1B070f494B9D84733A` |

Deployed: 2026-06-10 | Deployer: `0x0B58C02408E095F8f7527FF42184E3FC54e6Df86`

---

## Runtime Stack

```
npm run server   → WebSocket game server (server/index.js)
                   - Auth via wallet sig (PVP-AUTH:<nonce>)
                   - Runs card state machine in memory
                   - Signs settlements with OPERATOR_PRIVATE_KEY

npm run oracle   → Anti-bot oracle (server/antiBotOracle.js)
                   - Gitcoin Passport score ≥15
                   - Alchemy: ≥50 transfers, wallet age ≥30 days
                   - Calls escrow.markHuman() with ANTIBOT_ORACLE key

npm run dev      → Next.js frontend (src/)
                   - Farcaster Mini App (MiniAppProvider + fc:frame meta)
                   - Wagmi + WalletConnect
                   - Pages: / /buy /stake /table /tournament /handle /leaderboard
```

---

## Settlement Flow (trustless)

```
1. Player calls PokerEscrow.buyIn(tableId) on-chain
   └─ requires humanVerified[player] == true

2. Hand plays out on the WebSocket server

3. Server signs:
   keccak256(tableId, handNonce, winners[], shares[])
   where shares[] sum to 1000 basis points

4. Server broadcasts HAND_OVER with the sig
   Any player submits to PokerEscrow.settle()

5. Contract verifies sig against OPERATOR_SIGNER
   Pays winners minus rake, increments handNonce
```

---

## Mainnet Deploy Checklist

- [ ] Fund deployer `0x0B58C024…Df86` with ETH on Arbitrum One (need ~0.1 ETH for 7 contracts)
- [ ] Add `arb-mainnet.g.alchemy.com` to network egress allowlist (if deploying from cloud)
- [ ] Run `npm run deploy:mainnet` → saves `deployments/arbitrum.json`
- [ ] Run `npm run setup:env` to sync NEXT_PUBLIC_* vars
- [ ] Remove `ChipsToken.faucet()` — or confirm it's already removed
- [ ] Replace deployer with Gnosis Safe multisig
- [ ] Point frontend `NEXT_PUBLIC_APP_URL` to production domain
- [ ] Update Alchemy app to allowlist production domain

---

## Secrets Reference

Private keys are in `.env` (encrypted as `.env.enc` in the repo).
To decrypt: the startup hook runs `scripts/decrypt-env.js` automatically.
To re-encrypt after changes: `node scripts/encrypt-env.js` (or equivalent).

**Never commit `.env` unencrypted.**
