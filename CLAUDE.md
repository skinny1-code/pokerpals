# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # install all dependencies

npm run compile              # compile Solidity contracts via Hardhat
npm run test                 # run JS hand-evaluator unit tests (test/holdem.test.mjs) — no chain needed
npm run test:contracts       # run Hardhat Solidity contract tests (test/contracts/)
npm run deploy:testnet       # deploy to Arbitrum Sepolia → saves deployments/arbitrumSepolia.json + writes .env
npm run deploy:mainnet       # deploy to Robinhood Chain (mainnet target, chainId 4663) — requires USDC_ADDRESS
npm run deploy:robinhood-testnet  # deploy to Robinhood Chain testnet (chainId 46630)
npm run deploy:arbitrum-one  # legacy: deploy to Arbitrum One (42161)
npm run rehearse:deploy      # dress rehearsal: run the MAINNET deploy path against a local `npx hardhat node`, prove the stablecoin guard rejects bad tokens, then verify every post-deploy wiring (needs DEPLOYER_KEY = a funded local key)

npm run setup:wallets        # generate fresh wallets for all roles → writes .env + WALLETS-PRINT-ME.txt
npm run setup:env            # re-sync .env from deployments/arbitrumSepolia.json (run after any redeploy)

npm run server               # start WebSocket game server (server/index.js) — reads .env via --env-file
npm run oracle               # start anti-bot oracle as a separate process (server/antiBotOracle.js)
npm run dev                  # Next.js dev server
npm run dev:clean            # clears .next cache then starts dev server
npm run build                # production Next.js build (used by Vercel)
npm run build:check          # local verify build (next build --debug-prerender) — see "Known Issues" in README; plain `next build` aborts locally on the /_global-error prerender, a framework/env bug that does NOT affect Vercel/production
npm run launch               # shortcut: npm run server & npm run dev in parallel

npm run faucet               # send 10,000 SALOON to deployer (testnet only)
npm run faucet -- 0xADDR             # send 10,000 SALOON to 0xADDR (+ gas ETH top-up if broke)
npm run faucet -- 0xADDR 50000       # send 50,000 SALOON to 0xADDR
FAUCET_ETH=0 npm run faucet -- 0xADDR   # skip the automatic gas-ETH top-up
FAUCET_TO=0xADDR FAUCET_AMOUNT=50000 npm run faucet  # legacy env-var form still works

npm run setup:profit-split -- 0xADDR   # deploy ProfitSplitter + route ALL owner income to it (owner key required)
npm run distribute-profits             # harvest yield/vest then split splitter balance (default 50% payout / 50% staked)

npm run deploy:lottery                 # deploy StakerLottery (weekly no-loss staker draw) → manifest
npm run lottery:draw                   # weekly: top prize up from PromotionsPool (LOTTERY_PRIZE, default 100k) + settle epoch
npm run fund:rakeback -- 100000        # top up PokerEscrow's rakeback pool from PromotionsPool (5% accrual needs pool > 0)

npm run sync:artifacts                 # refresh scripts/artifacts/*.json from the Hardhat build (run after `npm run compile` when a contract with a standalone deploy script changes — PinnedArtifacts.test.js fails until you do)
npm run encrypt:env                    # ENV_PASSPHRASE=… → re-seal .env.enc; refuses if .env holds a populated secret
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

Server-run **staker freeroll**: permanent table `9100` ("Staker Freeroll — Bronze+") seats only wallets with ChipsStaking tier >= 1 (on-chain `getTier` read, 5-min cache). Freeroll chips are play money: the server never signs cashouts or refund hints for table 9100; prizes are paid manually from the PromotionsPool.

## Architecture

The system has three independent runtime layers:

**1. Smart contracts** (`contracts/`) — Solidity 0.8.26. **Mainnet target is Robinhood Chain** (an Arbitrum Orbit L2, chainId 4663); Arbitrum Sepolia (421614) is the testnet. The contracts are EVM-identical across all of these, and settlement/cashout signatures are bound to `chainId` so nothing replays across chains. Deployment order matters and is handled by `scripts/deploy.js`:
- `ChipsToken` — ERC-20 token named "Saloon" (ticker: SALOON), 1B supply. Allocation: 10% dev (vested 24 months in-contract), 20% staking rewards pool (seeded to ChipsStaking at deploy), 10% ops reserve (→ KingOfSpadesPool), 10% community (→ PromotionsPool), 50% liquidity (→ ChipsLiquidityPool)
- `ChipsStaking` — players lock SALOON to earn a VIP tier (0–4); tier determines rake rate. Also receives 45% of every rake payment as yield for stakers
- `ReferralRegistry` — tracks referrer per player; must be `setAuthorized(escrowAddr, true)` before it will record rake credits
- `PokerEscrow` — core cash-game contract: buy-in locking, per-hand signed settlement, VIP rake tiers, referral splits, seat fees. Optionally links tables to a `TableRegistry` room for access control.
- `TournamentManager` — scheduled tournaments; mirrors the signed-settlement pattern of `PokerEscrow`
- `TableRegistry` — on-chain private room leasing. Anyone pays a weekly SALOON fee to lease a room. Rooms can be NFT-gated (ERC-721 ownership required to sit). Lease fee split: 15% burn / 45% staking / 10% King of Spades Pool / 30% treasury. `canSit(roomId, player)` is checked by PokerEscrow on buy-in.
- `PokerHandle` — ERC-721 NFT for on-chain usernames. Players burn SALOON to mint a unique 3–20 char handle (alphanumeric + underscore, case-insensitive uniqueness). Fully on-chain SVG tokenURI. One handle per wallet, but handles are transferable. Contract address stored in `NEXT_PUBLIC_POKER_HANDLE`.
- `KingOfSpadesPool` — on-chain operating-expense fund. Seeded with 100M SALOON at deploy + receives 10% of all rake continuously. Owner withdraws with annotated reason for auditability.
- `PromotionsPool` — 100M SALOON community allocation for contests, airdrops, rake-free promos. Owner withdraws with note.
- `StablecoinPool` — on-network USDC reserve. Funded by USDC proceeds from chip purchases. ChipsLiquidityPool is authorized to call `notifyDeposit()` and `authorizedPayout()`.
- `ChipsLiquidityPool` — 500M SALOON — SALOON↔USDC swap pool at a fixed owner-set peg. Player USDC flows directly to StablecoinPool; player receives SALOON from this pool. `rateUsdcPerChip` = USDC-wei per 1e18 SALOON (default 1000 = $0.001/CHIP). `setRate` is capped at **±10% per day** (`MAX_RATE_CHANGE_BPS` / `RATE_UPDATE_COOLDOWN`): `StablecoinPool.authorizedPayout` is exempt from that pool's redemption floor, so an unbounded peg let the owner mint one huge redemption and walk the whole USDC reserve out. A larger repeg is a sequence of daily steps.
- `MockUSDC` — testnet stablecoin stand-in (6 decimals). **On mainnet the stablecoin differs by chain and is verified on-chain at deploy time** (`assertStablecoin` in `scripts/deploy.js`): the address must hold a contract, report 6 decimals, and report the expected symbol. Arbitrum One uses Circle USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`. **Robinhood Chain has no Circle USDC** — its native stablecoin is USDG (Global Dollar, Paxos) at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, verified, 6 decimals, so the peg math is unchanged. Every token on Robinhood Chain calling itself "USDC" is an impostor: unverified, 18 decimals, 1e27 supply ("Universal Stable Digital Coin", "United States Central Dollar", "UpSideDownCat on robinhood", …). Pasting Arbitrum One's USDC address there is equally wrong — nothing is deployed at it. Both mistakes are permanent: `StablecoinPool` and `ChipsLiquidityPool` take the token in their constructors.
- `StakerLottery` — weekly no-loss draw for stakers (deployed by `npm run deploy:lottery`, not part of `deploy.js`). Tier >= 1 stakers `enter()` free each epoch; tickets = staked SALOON; settling is two-phase: `requestDraw()` commits the finished epoch to a future block, then `draw()` derives the weighted-random winner from **that** block's hash and pays the whole prize (funded from PromotionsPool by `lottery:draw`). The commit matters — reading `blockhash(block.number - 1)` inside `draw()` decides nothing, since that hash already exists when the call is built, so any entrant could simulate the result and submit only in blocks where they win. A commit that nobody settles within blockhash's 256-block window expires and must be re-made; `npm run lottery:draw` does request→wait→draw in one run so that window stays closed. Address in manifest → `NEXT_PUBLIC_LOTTERY`.
- `ProfitSplitter` — optional owner-income router (deployed by `npm run setup:profit-split -- 0xADDR`, not part of `deploy.js`). Set as `rakeRecipient` on PokerEscrow/TournamentManager/TableRegistry and `devWallet` on ChipsToken. Public `distribute()` splits its SALOON balance `payoutBps` (default 50%) → payout wallet, remainder → staked in ChipsStaking under the splitter (yield harvestable via `harvestYield()`, principal unstakeable to the payout wallet by owner via `unstakeToPayout()`).

Post-deploy wiring (done in `scripts/deploy.js`):
- `token.transfer(stakingAddr, 200M_CHIPS)` then `staking.initYieldPool()`
- `staking.setYieldSource(escrowAddr, true)`, `setYieldSource(tournAddr, true)`, `setYieldSource(registryAddr, true)`
- `referral.setAuthorized(escrowAddr, true)` and `setAuthorized(tournAddr, true)`
- `escrow.setTableRegistry(registryAddr)`
- `token.setEscrowFactory(escrowAddr)`
- `token.transfer(kingsPoolAddr, 100M_CHIPS)` — seed ops reserve
- `token.transfer(promotionsPoolAddr, 100M_CHIPS)` — seed community allocation
- `token.transfer(liqPoolAddr, 500M_CHIPS)` — seed liquidity float
- `kingsPool.setAuthorized(escrowAddr/tournAddr/registryAddr, true)` — allow rake contracts to call `receiveOps()`
- `stablecoinPool.setAuthorized(liqPoolAddr, true)` — allow swap pool to call `notifyDeposit()`/`authorizedPayout()`
- `escrow/tourn/registry.setKingsPool(kingsPoolAddr)` — wire rake distribution

**2. WebSocket game server** (`server/index.js`) — Node.js using ES module syntax (`import`). Manages game state in memory (`Map<id, PokerTable>`). Key responsibilities:
- Authenticates players via wallet signature (`PVP-AUTH:<nonce>`)
- Runs the card game state machine (`PokerTable` class): dealing, betting rounds, showdown
- Signs settlement payouts with the operator key: `operator.signMessage(keccak256(chainId, escrowAddress, tableId, handNonce, winners, shares))` — chain- and contract-bound (see Settlement flow)
- Broadcasts per-player `GAME_STATE` (hole cards hidden for opponents) after every action
- On `HAND_OVER`, emits the operator signature so any player can submit it to `PokerEscrow.settle()` on-chain

Inbound frames are validated in `server/frame.js` before dispatch: anything that is not `{type: string, …}` is dropped like unparseable JSON, and a missing `payload` arrives as `{}`. Every case in the message switch destructures `payload`, so a frame without one used to throw — and in an async handler that became an unhandled promise rejection caught only by a process-level listener, which is the wrong place for routine bad input: the case had already aborted halfway. The switch is additionally wrapped so a throw inside any case costs that frame and nothing else.

Abuse limits live in `server/connectionGuard.js`: a per-IP connection cap (`WS_MAX_CONNS_PER_IP`, default 25), a per-socket token bucket (`WS_MSGS_PER_SEC` 25 / `WS_MSG_BURST` 60), an AUTH attempt budget (`WS_MAX_AUTH_TRIES`, default 12 — each attempt costs two ECDSA recoveries and possibly an ERC-1271 RPC call), and an unauthenticated-socket timeout (`WS_AUTH_GRACE_MS`, default 60s). The client IP comes from `fly-client-ip` (Fly sets it and strips client copies); `x-forwarded-for` is honoured only when `TRUST_PROXY=true`, since it is otherwise a client-supplied header. None of this protects money — it keeps the process, which holds every table's state in memory, alive.

**Card visibility** (`server/reveal.js`): a hand only goes face up if the pot was contested to the end. Folding everyone out wins without showing anything — the winner may elect to (`SHOW_CARDS`, broadcast as `CARDS_SHOWN`), and nobody else can force it. A fold is never shown. Cards were previously revealed on `phase === 'showdown'` alone, which exposed both the winner of an uncalled pot and every folded player's hand.

**Seating** (`server/seating.js`): a player who names a seat gets that seat or is told it was taken — never silently moved, since seat choice is positional. `JOIN_TABLE` without a `seatIndex` returns `SEAT_PICKER` (with `needsBuyIn: false` on play-money tables, where no escrow deposit is required); a contested seat re-sends it with an `error`. The picker used to be gated on a missing on-chain deposit, so on play-money tables — the only ones most players see — nobody ever got to choose. Bots carry `isBot` through `pubState`, `SEAT_PICKER.takenSeats` and the UI, which labels them "House Bot" with a BOT badge.

**Pot splitting** (`server/sidePots.js`): the table tracks each player's total commitment for the hand (`p.committed`), and the showdown splits the pot by all-in level rather than handing it all to the best hand. A short all-in can only win what each opponent also put in; a bet nobody could call comes back to whoever made it. Uncalled money is returned to the stack **before** settlement and subtracted from `potAmount`, so it is never raked — a card room returns an uncalled bet before raking, and the escrow still backs those chips either way. `doShowdown` asserts `sum(committed) === pot` and refuses to settle against a pot it cannot account for. `HAND_OVER` carries the settlement pair (`winners`/`shares`, which must stay paired with `sig`), plus `showdownWinners` and a per-player `payouts` map for display.

**Hand evaluation** lives in `server/handEval.js` and nowhere else — `evalFive`, `compareHands`, `best7`, `bestOmaha`, plus the deck and `crypto.randomInt` shuffle. It is imported by `server/index.js`, `server/botBrain.js` and the tests. It used to be inlined in `server/index.js` with copies in the test file and in botBrain; the copies had already drifted, and a copy means green tests can prove the copy correct while the server runs something else. `test/handEval.test.mjs` fails if a second `evalFive` reappears, and checks the evaluator against an independently written reference (bitmask straights, signature categories): **all 2,598,960 five-card hands agree on category** via `npm run test:eval-full`, plus 40k five-card and 12k seven-card ordering comparisons on every run.

`src/games/omaha.js` is an unwired variant-game sketch (Omaha / short-deck / OFC) using object card notation (`{s, r}`) rather than the `"AH"` strings everything else uses. **Nothing imports it.** The live Omaha path is `bestOmaha` in `handEval.js`. If it is ever wired up it needs its own differential tests.

**3. Anti-bot oracle** (`server/antiBotOracle.js`) — runs as a standalone process. Runs three parallel checks before calling `escrow.markHuman(address, true)` on-chain:
1. On-chain activity: ≥50 asset transfers, wallet age ≥30 days (Alchemy API)
2. Gitcoin Passport score ≥15
3. Token diversity: ≥3 ERC-20 token interactions

Also exports `BehaviorMonitor`, which can be integrated into the game server to flag bots by detecting suspiciously fast/consistent action timing (<250ms avg, <100 variance).

**4. Frontend** (`src/`) — Next.js 15 (App Router). Pages: `/` (lobby), `/table`, `/buy`, `/stake`, `/tournament`, `/handle`, `/leaderboard`. Key files:
- `src/hooks/usePokerWallet.js` — exports `wagmiConfig` (wrap app in `<WagmiProvider>`), plus hooks `useWallet`, `useEscrow`, `useGameSocket`. `useEscrow.buyIn()` does a two-step flow: approve SALOON → call `buyIn()` on the escrow contract.
- `src/components/RevenueDashboard.jsx` — owner-facing dashboard; reads live on-chain data from all contracts via `useReadContract` with polling.
- `next.config.js` — auto-loads deployed contract addresses from `deployments/arbitrumSepolia.json` (or `deployments/arbitrum.json`) at build time, so `NEXT_PUBLIC_*` contract address env vars are optional if the deployment JSON exists. `.env` values take precedence when set.

Frontend pages (`src/app/`):
- `/` — landing page, wallet connect entry point
- `/buy` — buy SALOON token UI
- `/handle` — claim a PokerHandle username on-chain
- `/stake` — ChipsStaking UI (stake for VIP tier + APR yield)
- `/table/[id]` — live game table; consumes `useGameSocket` for real-time play
- `/tournament/[id]` — tournament lobby and play
- `/leaderboard` — player leaderboard

**5. Claude Code config** (`.claude/`) — project-specific Claude Code settings. Custom slash commands are in `.claude/commands/`, event hooks in `.claude/hooks/`, and permissions/settings in `.claude/settings.json`.

## Token Economy (SALOON)

**Supply: 1,000,000,000 SALOON**
| Allocation | Amount | Destination |
|---|---|---|
| 10% Dev | 100M | 25M released at deploy + 2M/month (2%/mo) vested thereafter; dev calls `claimDevVest()` |
| 20% Staking | 200M | Seeded to ChipsStaking yield pool at deploy |
| 10% Ops Reserve | 100M | `KingOfSpadesPool` contract — devops budget: servers, staff, equipment |
| 10% Community | 100M | `PromotionsPool` contract — tournaments, airdrops, grants, rake-free promos |
| 50% Liquidity | 500M | `ChipsLiquidityPool` contract — players buy/sell SALOON at fixed peg |

**On-chain pool architecture:**
| Pool | Contract | Seeded | Purpose |
|---|---|---|---|
| King of Spades Pool | `KingOfSpadesPool` | 100M SALOON + 10% rake | Business operating expenses |
| Promotions Pool | `PromotionsPool` | 100M SALOON | Contests, tournaments, airdrops |
| Stablecoin Pool | `StablecoinPool` | USDC from chip purchases | On-network USDC reserve |
| Chips Liquidity Pool | `ChipsLiquidityPool` | 500M SALOON | Player SALOON↔USDC swaps |

**Owner income streams:**
- `RAKE_WALLET` (EOA): 20% of cash-game rake + 30% of tournament/lease rake + 100% of seat fees — ongoing personal income
- `DEV_WALLET`: 25M SALOON at deploy + 2M/month from remaining 75M vest — personal equity stake

**Rake split per hand — PokerEscrow (of total rake):**
- 15% burned → deflationary supply reduction
- 45% → ChipsStaking yield pool → stakers earn passively
- 10% → King of Spades Pool → operating expenses
- 20% → treasury (owner's personal rake wallet EOA)
- 10% → referrer (if player has one)

**Rake split — TournamentManager + TableRegistry (of total rake):**
- 15% burned
- 45% → ChipsStaking yield pool
- 10% → King of Spades Pool
- 30% → treasury (owner's personal rake wallet EOA)

**SALOON↔USDC swap flow:**
- Buy: player USDC → StablecoinPool (direct transfer) + `notifyDeposit()` → player receives SALOON from ChipsLiquidityPool
- Redeem: player SALOON → ChipsLiquidityPool (held) + StablecoinPool `authorizedPayout()` → player receives USDC

**VIP staking tiers:**
| Tier | Stake | Rake | APR |
|---|---|---|---|
| 0 Standard | 0 | 1.5% | 0% |
| 1 Bronze | 25,000 SALOON | 1.3% | 5% |
| 2 Silver | 250,000 SALOON | 1.1% | 8% |
| 3 Gold | 1,000,000 SALOON | 0.9% | 12% |
| 4 Whale | 5,000,000 SALOON | 0.6% | 18% |

## Settlement flow (trustless)

1. Players call `PokerEscrow.buyIn(tableId)` on-chain — requires `humanVerified[player] == true`
2. Game plays out on the WebSocket server
3. Server signs: `keccak256(chainId, escrowAddress, tableId, handNonce, winners[], shares[])` where `shares` sum to 1000 (basis points). `chainId` + `escrowAddress` bind the signature to this chain and contract so it can't be replayed on another chain or a redeployed escrow — the server (`signAndSettle`/`signCashOut`) and the contract (`settle`/`cashOut`) must keep this digest format identical. Cashout digest: `keccak256("CASHOUT", chainId, escrowAddress, tableId, player, amount, nonce)`.
4. Server broadcasts the sig via `HAND_OVER`; any player submits to `PokerEscrow.settle()`
5. Contract verifies the sig against `operatorSigner`, pays winners minus rake, increments `handNonce`

`handNonce` is tracked both in the `PokerTable` in-memory state and in the contract — they must stay in sync. The server increments its local `handNonce` only after broadcasting `HAND_OVER`.

**Sponsored (gasless) cashout** (`server/cashoutRelay.js`): when a player leaves with chips, `PokerEscrow.cashOut(tableId, player, amount, nonce, sig)` pays the `player` named in the operator signature regardless of who submits the tx — so the server submits it from the operator wallet and the player pays **zero gas** and signs nothing. Flow: server signs → submits → sends `CASHOUT_RELAYED` (carries the sig as a fallback) → `CASHOUT_CONFIRMED` on receipt. If sponsorship is off (`SPONSOR_CASHOUT=false`), the operator is low on gas, or a sponsored tx reverts, it falls back to `CASHOUT_SIG` for the player to self-submit (the original path). Every operator-signed send in the server — sponsored cashouts, `markHuman`, `closeTable`, `HandHistory.recordBatch` — goes through the single submission queue in `server/operatorQueue.js`, because ethers assigns the wallet nonce at broadcast time and overlapping sends collide on it. Only one sponsored cashout is in flight per `(tableId, player)`: a second request while the first is unconfirmed would reuse the same `cashOutNonce` and is guaranteed to revert, so it falls back to `CASHOUT_SIG` instead of burning operator gas (rapid leave/rejoin was a free gas drain). If no receipt arrives within `waitTimeoutMs` (2 min) the player gets the self-submit sig rather than waiting on a stuck tx. Undelivered messages are parked in a server-level store keyed by `tableId:address` — not on the table, which the last player leaving destroys — and flushed on their next AUTH or JOIN_TABLE. On by default; freeroll (table 9100) chips are never cashed out on-chain.

## Environment

See `.env.example` for all required variables. Key groups:
- **Wallet keys**: `DEPLOYER_KEY`, `OPERATOR_PRIVATE_KEY`, `OPERATOR_SIGNER`, `RAKE_WALLET`, `ANTIBOT_ORACLE`
- **RPC**: `ARB_SEPOLIA_RPC`, `ARB_RPC` (Alchemy endpoints)
- **APIs**: `ALCHEMY_API_KEY`, `GITCOIN_PASSPORT_API`, `GITCOIN_SCORER_ID`, `ARBISCAN_API_KEY`
- **Frontend** (`NEXT_PUBLIC_*`): `WC_PROJECT_ID`, `CHAIN_ID`, `WS_URL`, and all contract addresses (`NEXT_PUBLIC_CHIPS_TOKEN`, `NEXT_PUBLIC_ESCROW`, `NEXT_PUBLIC_STAKING`, `NEXT_PUBLIC_REFERRAL`, `NEXT_PUBLIC_TOURNAMENT`, `NEXT_PUBLIC_TABLE_REGISTRY`, `NEXT_PUBLIC_POKER_HANDLE`, `NEXT_PUBLIC_KINGS_POOL`, `NEXT_PUBLIC_PROMOTIONS_POOL`, `NEXT_PUBLIC_STABLECOIN_POOL`, `NEXT_PUBLIC_LIQUIDITY_POOL`, `NEXT_PUBLIC_MOCK_USDC`) — auto-written by `deploy:testnet` and re-synced by `setup:env`
- **Testnet**: set `TESTNET_SKIP_HUMAN_CHECK=true` to bypass Gitcoin Passport; server calls `markHuman()` directly for any connecting wallet

## Security notes

Mainnet launch runbook: `docs/LAUNCH-CHECKLIST.md` (key rotation → deploy → verify → multisig handover, in that order — the handover is irreversible and must come last). Slither triage: `docs/SLITHER.md`.

- `npm run slither` runs Slither against the Hardhat build and fails on any High/Medium finding not in `security/slither-baseline.json`. All 24 current findings are triaged in `docs/SLITHER.md` — none are exploitable, and no detector is disabled. Needs `pip install slither-analyzer`; run `npm run compile` first. `myth analyze contracts/PokerEscrow.sol` still needs a machine that can download a solc binary.
- Replace deployer/owner with a Gnosis Safe multisig before mainnet: `npm run transfer:ownership -- 0xSAFE` (dry run) then `-- 0xSAFE --confirm`. Ownable's handover is one-step and irreversible, so the script refuses a target with no contract code. It also reports the privileged roles ownership does *not* cover (`operatorSigner`, `rakeRecipient`, `antiBotOracle`, `devWallet`) — rotate those separately.
- `ChipsToken.faucet()` (owner-mint) has been removed — supply is fixed at the 1B minted in the constructor. (`npm run faucet` still works on testnet: it transfers from the deployer's balance, it never minted.)
- Dev vest: `claimDevVest()` is callable by `devWallet` only; owner can update `devWallet` via `setDevWallet()`
