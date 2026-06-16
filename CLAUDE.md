# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # install all dependencies

npm run compile              # compile Solidity contracts via Hardhat
npm run test                 # run JS hand-evaluator unit tests (test/holdem.test.mjs) — no chain needed
npm run test:contracts       # run Hardhat Solidity contract tests (test/contracts/)
npm run deploy:testnet       # deploy to Arbitrum Sepolia → saves deployments/arbitrumSepolia.json + writes .env
npm run deploy:mainnet       # deploy to Arbitrum One

npm run setup:wallets        # generate fresh wallets for all roles → writes .env + WALLETS-PRINT-ME.txt
npm run setup:env            # re-sync .env from deployments/arbitrumSepolia.json (run after any redeploy)

npm run server               # start WebSocket game server (server/index.js) — reads .env via --env-file
npm run oracle               # start anti-bot oracle as a separate process (server/antiBotOracle.js)
npm run dev                  # Next.js dev server
npm run dev:clean            # clears .next cache then starts dev server
npm run build                # production Next.js build
npm run launch               # shortcut: npm run server & npm run dev in parallel

npm run faucet               # send 10,000 CHIPS to deployer (testnet only)
FAUCET_TO=0xADDR npm run faucet                      # send 10,000 CHIPS to 0xADDR
FAUCET_TO=0xADDR FAUCET_AMOUNT=50000 npm run faucet  # send 50,000 CHIPS to 0xADDR
```

### First-time testnet setup

```bash
npm run setup:wallets        # 1. generate role wallets → .env
# fund DEPLOYER_KEY address with Arbitrum Sepolia ETH (chainlink faucet or bridge)
npm run deploy:testnet       # 2. deploy all contracts → deployments/arbitrumSepolia.json + .env
npm run setup:env            # 3. (re-)sync NEXT_PUBLIC_* addresses into .env (safe to re-run)
npm run server               # 4. start game server (terminal 1)
npm run dev                  # 5. start frontend (terminal 2)
```

Run `server` and `oracle` as two independent Node processes.

## Architecture

The system has three independent runtime layers:

**1. Smart contracts** (`contracts/`) — Solidity 0.8.26, deployed on Arbitrum One. Deployment order matters and is handled by `scripts/deploy.js`:
- `ChipsToken` — ERC-20 token named "Chips" (ticker: CHIPS), 1B supply. Allocation: 10% dev (vested 24 months in-contract), 20% staking rewards pool (seeded to ChipsStaking at deploy), 10% ops reserve, 10% community, 50% liquidity
- `ChipsStaking` — players lock CHIPS to earn a VIP tier (0–4); tier determines rake rate. Also receives 35% of every rake payment as yield for stakers
- `ReferralRegistry` — tracks referrer per player; must be `setAuthorized(escrowAddr, true)` before it will record rake credits
- `PokerEscrow` — core cash-game contract: buy-in locking, per-hand signed settlement, VIP rake tiers, referral splits, seat fees. Optionally links tables to a `TableRegistry` room for access control.
- `TournamentManager` — scheduled tournaments; mirrors the signed-settlement pattern of `PokerEscrow`
- `TableRegistry` — on-chain private room leasing. Anyone pays a weekly CHIPS fee to lease a room. Rooms can be NFT-gated (ERC-721 ownership required to sit). Lease fee split: 35% burn / 35% staking / 30% treasury. `canSit(roomId, player)` is checked by PokerEscrow on buy-in.
- `PokerHandle` — ERC-721 NFT for on-chain usernames. Players burn CHIPS to mint a unique 3–20 char handle (alphanumeric + underscore, case-insensitive uniqueness). Fully on-chain SVG tokenURI. One handle per wallet, but handles are transferable. Contract address stored in `NEXT_PUBLIC_POKER_HANDLE`.

Post-deploy wiring (done in `scripts/deploy.js`):
- `token.transfer(stakingAddr, 200M_CHIPS)` then `staking.initYieldPool()`
- `staking.setYieldSource(escrowAddr, true)`, `setYieldSource(tournAddr, true)`, `setYieldSource(registryAddr, true)`
- `referral.setAuthorized(escrowAddr, true)` and `setAuthorized(tournAddr, true)`
- `escrow.setTableRegistry(registryAddr)`
- `token.setEscrowFactory(escrowAddr)`

**2. WebSocket game server** (`server/index.js`) — Node.js using ES module syntax (`import`). Manages game state in memory (`Map<id, PokerTable>`). Key responsibilities:
- Authenticates players via wallet signature (`PVP-AUTH:<nonce>`)
- Runs the card game state machine (`PokerTable` class): dealing, betting rounds, showdown
- Signs settlement payouts with the operator key: `operator.signMessage(keccak256(tableId, handNonce, winners, shares))`
- Broadcasts per-player `GAME_STATE` (hole cards hidden for opponents) after every action
- On `HAND_OVER`, emits the operator signature so any player can submit it to `PokerEscrow.settle()` on-chain

The server uses `crypto.randomInt` for shuffling (cryptographically random). Hand evaluation in `server/index.js` uses string card notation (`"AH"`, `"TS"`). The separate module `src/games/omaha.js` uses object notation (`{s, r}`) — these are two independent implementations and the notations must not be mixed.

**3. Anti-bot oracle** (`server/antiBotOracle.js`) — runs as a standalone process. Runs three parallel checks before calling `escrow.markHuman(address, true)` on-chain:
1. On-chain activity: ≥50 asset transfers, wallet age ≥30 days (Alchemy API)
2. Gitcoin Passport score ≥15
3. Token diversity: ≥3 ERC-20 token interactions

Also exports `BehaviorMonitor`, which can be integrated into the game server to flag bots by detecting suspiciously fast/consistent action timing (<250ms avg, <100 variance).

**4. Frontend** (`src/`) — Next.js 15 (App Router). Pages: `/` (lobby), `/table`, `/buy`, `/stake`, `/tournament`, `/handle`, `/leaderboard`. Key files:
- `src/hooks/usePokerWallet.js` — exports `wagmiConfig` (wrap app in `<WagmiProvider>`), plus hooks `useWallet`, `useEscrow`, `useGameSocket`. `useEscrow.buyIn()` does a two-step flow: approve CHIPS → call `buyIn()` on the escrow contract.
- `src/components/RevenueDashboard.jsx` — owner-facing dashboard; reads live on-chain data from all contracts via `useReadContract` with polling.
- `next.config.js` — auto-loads deployed contract addresses from `deployments/arbitrumSepolia.json` (or `deployments/arbitrum.json`) at build time, so `NEXT_PUBLIC_*` contract address env vars are optional if the deployment JSON exists. `.env` values take precedence when set.

Frontend pages (`src/app/`):
- `/` — landing page, wallet connect entry point
- `/buy` — buy CHIPS token UI
- `/handle` — claim a PokerHandle username on-chain
- `/stake` — ChipsStaking UI (stake for VIP tier + APR yield)
- `/table/[id]` — live game table; consumes `useGameSocket` for real-time play
- `/tournament/[id]` — tournament lobby and play
- `/leaderboard` — player leaderboard

**5. Claude Code config** (`.claude/`) — project-specific Claude Code settings. Custom slash commands are in `.claude/commands/`, event hooks in `.claude/hooks/`, and permissions/settings in `.claude/settings.json`.

## Token Economy (CHIPS)

**Supply: 1,000,000,000 CHIPS**
| Allocation | Amount | Destination |
|---|---|---|
| 10% Dev | 100M | Vested linearly in-contract over 24 months; dev calls `claimDevVest()` — personal equity |
| 20% Staking | 200M | Seeded to ChipsStaking yield pool at deploy |
| 10% Ops Reserve | 100M | Ops wallet — devops budget: servers, staff, marketing |
| 10% Community | 100M | Community wallet (tournaments, airdrops, grants) |
| 50% Liquidity | 500M | Liquidity wallet (DEX pools) |

**Owner income streams:**
- `RAKE_WALLET`: 20% of all rake per hand + 100% of seat fees + 30% of tournament rake — ongoing personal income
- `DEV_WALLET`: 100M CHIPS vested linearly over 24 months — personal equity stake
- `OPS_WALLET`: 100M CHIPS one-time — operational budget (separate from personal earnings)

**Rake split per hand (of total rake):**
- 35% burned → deflationary supply reduction
- 35% → ChipsStaking yield pool → stakers earn passively
- 20% → treasury (rake wallet)
- 10% → referrer (if player has one)

**VIP staking tiers:**
| Tier | Stake | Rake | APR |
|---|---|---|---|
| 0 Standard | 0 | 1.5% | 0% |
| 1 Bronze | 25,000 CHIPS | 1.3% | 5% |
| 2 Silver | 250,000 CHIPS | 1.1% | 8% |
| 3 Gold | 1,000,000 CHIPS | 0.9% | 12% |
| 4 Whale | 5,000,000 CHIPS | 0.6% | 18% |

## Settlement flow (trustless)

1. Players call `PokerEscrow.buyIn(tableId)` on-chain — requires `humanVerified[player] == true`
2. Game plays out on the WebSocket server
3. Server signs: `keccak256(tableId, handNonce, winners[], shares[])` where `shares` sum to 1000 (basis points)
4. Server broadcasts the sig via `HAND_OVER`; any player submits to `PokerEscrow.settle()`
5. Contract verifies the sig against `operatorSigner`, pays winners minus rake, increments `handNonce`

`handNonce` is tracked both in the `PokerTable` in-memory state and in the contract — they must stay in sync. The server increments its local `handNonce` only after broadcasting `HAND_OVER`.

## Environment

See `.env.example` for all required variables. Key groups:
- **Wallet keys**: `DEPLOYER_KEY`, `OPERATOR_PRIVATE_KEY`, `OPERATOR_SIGNER`, `RAKE_WALLET`, `ANTIBOT_ORACLE`
- **RPC**: `ARB_SEPOLIA_RPC`, `ARB_RPC` (Alchemy endpoints)
- **APIs**: `ALCHEMY_API_KEY`, `GITCOIN_PASSPORT_API`, `GITCOIN_SCORER_ID`, `ARBISCAN_API_KEY`
- **Frontend** (`NEXT_PUBLIC_*`): `WC_PROJECT_ID`, `CHAIN_ID`, `WS_URL`, and all seven contract addresses (`NEXT_PUBLIC_CHIPS_TOKEN`, `NEXT_PUBLIC_ESCROW`, `NEXT_PUBLIC_STAKING`, `NEXT_PUBLIC_REFERRAL`, `NEXT_PUBLIC_TOURNAMENT`, `NEXT_PUBLIC_TABLE_REGISTRY`, `NEXT_PUBLIC_POKER_HANDLE`) — auto-written by `deploy:testnet` and re-synced by `setup:env`
- **Testnet**: set `TESTNET_SKIP_HUMAN_CHECK=true` to bypass Gitcoin Passport; server calls `markHuman()` directly for any connecting wallet

## Security notes

- Run `slither contracts/` and `myth analyze contracts/PokerEscrow.sol` before mainnet
- Replace deployer/owner with a Gnosis Safe multisig before mainnet
- `ChipsToken.faucet()` must be removed before mainnet deployment
- Dev vest: `claimDevVest()` is callable by `devWallet` only; owner can update `devWallet` via `setDevWallet()`
