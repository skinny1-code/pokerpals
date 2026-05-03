# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # install all dependencies

npm run compile              # compile Solidity contracts via Hardhat
npm run test                 # run Hardhat contract tests
npm run deploy:testnet       # deploy to Arbitrum Sepolia
npm run deploy:mainnet       # deploy to Arbitrum One

npm run server               # start WebSocket game server (server/index.js)
npm run oracle               # start anti-bot oracle as a separate process (server/antiBotOracle.js)
npm run dev                  # Next.js dev server
npm run build                # production Next.js build
```

After deploying, copy the printed contract addresses into `.env` as `NEXT_PUBLIC_*` variables. Run `server` and `oracle` as two independent Node processes.

## Architecture

The system has three independent runtime layers:

**1. Smart contracts** (`contracts/`) — Solidity 0.8.20, deployed on Arbitrum One. Deployment order matters and is handled by `scripts/deploy.js`:
- `PPPToken` — ERC-20 (1B supply split: 10% dev, 40% community, 50% liquidity)
- `PPPStaking` — players lock PPP to earn a VIP tier (0–4); tier index is read by `PokerEscrow` to determine rake rate
- `ReferralRegistry` — tracks referrer per player; must be `setAuthorized(escrowAddr, true)` before it will record rake credits
- `PokerEscrow` — core cash-game contract: buy-in locking, per-hand signed settlement, VIP rake tiers, referral splits, seat fees
- `TournamentManager` — scheduled tournaments; mirrors the signed-settlement pattern of `PokerEscrow`

Post-deploy wiring (done in `scripts/deploy.js`):
- `referral.setAuthorized(escrowAddr, true)` and `setAuthorized(tournAddr, true)`
- `token.setEscrowFactory(escrowAddr)`

**2. WebSocket game server** (`server/index.js`) — Node.js using ES module syntax (`import`). Manages game state in memory (`Map<id, PokerTable>`). Key responsibilities:
- Authenticates players via wallet signature (`PPP-AUTH:<nonce>`)
- Runs the card game state machine (`PokerTable` class): dealing, betting rounds, showdown
- Signs settlement payouts with the operator key: `operator.signMessage(keccak256(tableId, handNonce, winners, shares))`
- Broadcasts per-player `GAME_STATE` (hole cards hidden for opponents) after every action
- On `HAND_OVER`, emits the operator signature so any player can submit it to `PokerEscrow.settle()` on-chain

The server uses `crypto.randomInt` for shuffling (cryptographically random). Hand evaluation in `server/index.js` uses string card notation (`"AH"`, `"TS"`). The separate module `src/games/omaha.js` uses object notation (`{s, r}`) — these are two independent implementations.

**3. Anti-bot oracle** (`server/antiBotOracle.js`) — runs as a standalone process. Runs three parallel checks before calling `escrow.markHuman(address, true)` on-chain:
1. On-chain activity: ≥50 asset transfers, wallet age ≥30 days (Alchemy API)
2. Gitcoin Passport score ≥15
3. Token diversity: ≥3 ERC-20 token interactions

Also exports `BehaviorMonitor`, which can be integrated into the game server to flag bots by detecting suspiciously fast/consistent action timing (<250ms avg, <100 variance).

**4. Frontend** (`src/`) — Next.js 14. Key files:
- `src/hooks/usePokerWallet.js` — exports `wagmiConfig` (wrap app in `<WagmiProvider>`), plus hooks `useWallet`, `useEscrow`, `useGameSocket`. `useEscrow.buyIn()` does a two-step flow: approve PPP → call `buyIn()` on the escrow contract.
- `src/components/RevenueDashboard.jsx` — owner-facing dashboard; reads live on-chain data from all four contracts via `useReadContract` with polling.

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
- **Frontend** (`NEXT_PUBLIC_*`): `WC_PROJECT_ID`, `CHAIN_ID`, `WS_URL`, and the five contract addresses

## Security notes (from README)

- Run `slither contracts/` and `myth analyze contracts/PokerEscrow.sol` before mainnet
- Replace deployer/owner with a Gnosis Safe multisig before mainnet
- `PPPToken.faucet()` must be removed before mainnet deployment
