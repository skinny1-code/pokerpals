# All In
### Onchain PvP Crypto Poker Network

> Real players. No bots. Instant onchain settlement. Your edge, your winnings.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Network: Arbitrum](https://img.shields.io/badge/Network-Arbitrum-blue.svg)](https://arbitrum.io)
[![Token: ALLIN](https://img.shields.io/badge/Token-ALLIN-green.svg)](#)

---

## What It Is

All In is a trustless PvP card game platform where:

- **All funds** are locked in a smart contract — not held by the house
- **Every hand** is settled onchain via operator-signed payouts
- **Every player** is verified human before they can sit at a table
- **All rake** flows directly to the owner wallet — no middlemen

Supported games: **Texas Hold'em** · Omaha Hi · Short Deck · Pineapple OFC *(last 3 coming soon)*

---

## Architecture

```
Player Wallet           WebSocket Server          Arbitrum Chain
─────────────          ─────────────────          ──────────────
Connect (wagmi)  ──▶  AUTH via wallet sig
Verify Human     ──▶  Gitcoin Passport   ──▶  escrow.markHuman()
Approve PPP      ──────────────────────  ──▶  PPPToken.approve()
Buy In           ──────────────────────  ──▶  PokerEscrow.buyIn()
Play Hand        ──▶  Game state machine
                       Sign result        ──▶  operator.signMessage()
Settle           ──────────────────────  ──▶  PokerEscrow.settle()
                                               Winners paid instantly
```

---

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `CHIPSToken.sol` | ERC-20 native token (1B supply) |
| `PokerEscrow.sol` | Buy-in lock + signed settlement + seat fees + VIP rake tiers |
| `CHIPSStaking.sol` | Stake ALLIN for lower rake + APR yield |
| `TournamentManager.sol` | Scheduled tournaments with entry fee rake |
| `ReferralRegistry.sol` | Onchain referral codes + 20% rake split |

---

## Revenue Streams

| Stream | Rate |
|--------|------|
| Cash game rake | 1.5% per pot (0.6% for Whale tier) |
| Seat fee | 1 ALLIN per buy-in |
| Tournament rake | 10% of entry pool |
| Staking yield | Funded from rake → APR 2–12% |
| Referral split | 20% of rake to referrer |
| LP fees | 0.3% of ALLIN/ETH swaps on Camelot |

---

## Stack

| Layer | Tech |
|-------|------|
| Contracts | Solidity 0.8.20 + Hardhat |
| Chain | Arbitrum One (EVM) |
| Game Server | Node.js + WebSocket (`ws`) |
| Anti-Bot | Gitcoin Passport + Alchemy + BehaviorMonitor |
| Frontend | Next.js 14 + wagmi v2 + viem |
| Deploy | Vercel (frontend) + Railway (game server) |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/skinny1-code/pokerpals
cd pokerpals

# 2. Install
npm install

# 3. Environment
cp .env.example .env
# Fill all values in .env

# 4. Compile contracts
npm run compile

# 5. Deploy to testnet
npm run deploy:testnet
# Copy output addresses into .env

# 6. Run game server
npm run server

# 7. Run frontend
npm run dev
```

---

## Deploy Scripts

```bash
npm run compile          # Compile all Solidity contracts
npm run deploy:testnet   # Deploy to Arbitrum Sepolia
npm run deploy:mainnet   # Deploy to Arbitrum One
npm run server           # Start WebSocket game server
npm run oracle           # Start anti-bot oracle (separate process)
npm run dev              # Next.js dev server
npm run build            # Production build
```

---

## Anti-Bot System

Every player must pass 3 checks before `buyIn()` is allowed:

1. **On-chain activity** — ≥50 transactions, wallet age ≥30 days (Alchemy)
2. **Gitcoin Passport** — score ≥15 (human credentials aggregator)
3. **Behavioral monitor** — live action timing analysis during play

On pass → oracle calls `escrow.markHuman(address, true)` onchain.

---

## Settlement (Trustless)

The house holds **zero funds**. Flow:

1. Players lock ALLIN in `PokerEscrow.sol` via `buyIn()`
2. Hand plays out on the game server
3. Server signs: `keccak256(tableId, handNonce, winners[], shares[])`
4. Any player submits signature to `settle()` onchain
5. Contract verifies sig, pays winners, takes rake — all in one tx
6. `handNonce` increments — prevents replay attacks

---

## Environment Variables

See `.env.example` for the full list. Key groups:

- **Wallet keys** — deployer, operator, rake recipient, oracle
- **RPC** — Alchemy endpoints for Arbitrum Sepolia + Mainnet
- **APIs** — Gitcoin Passport, Arbiscan, WalletConnect
- **Contract addresses** — filled after `npm run deploy:testnet`

---

## Known Issues

- **`next build` aborts on `/_global-error` prerender (local only).** In some
  local environments the production Turbopack prerender of Next's internal
  `/_global-error` shell crashes with
  `Cannot read properties of null (reading 'useContext')`. It reproduces with
  Next's *default* error page (not app code), across react 19.2.0/19.2.7, and on
  both Next 16.2.9 and the 16.3.0 canary — so it's a framework/environment bug,
  not ours. It does **not** affect compilation or production: Vercel builds and
  deploys the same commits successfully, and the error page renders fine
  on-demand at runtime. For a local sanity check that exercises the real
  prerender, use **`npm run build:check`** (`next build --debug-prerender`),
  which completes cleanly. Leave `npm run build` (plain `next build`) as the
  production/Vercel build.

## Security

- Run `slither contracts/` before mainnet (install: `pip install slither-analyzer`)
- Run `myth analyze contracts/PokerEscrow.sol` (install: `pip install mythril`)
- Replace deployer as contract owner with a Gnosis Safe multisig before mainnet
- Get a formal audit (Code4rena, Sherlock, or Cantina) before real funds

---

## License

MIT — see [LICENSE](LICENSE)

---

*All In — All edge belongs to the players*
