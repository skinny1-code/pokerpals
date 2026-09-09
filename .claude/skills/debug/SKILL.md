---
description: Diagnose a bug in Saloon across contracts, WS server, and frontend
---

# Debug — Saloon

Use when something's broken and the cause isn't obvious. Pick the layer the
symptom points at, then use the matching technique below. If unsure which
layer, start at Step 1 (logs) and work up.

## The three independent layers

- **Contracts** (`contracts/`) — on-chain truth. Bugs show up as reverts,
  wrong balances, a table stuck in the wrong `TableStatus`, signature
  mismatches.
- **WS game server** (`server/index.js`) — in-memory only, `Map<id,
  PokerTable>`. **Restarting wipes all table state** — if a bug only shows up
  mid-hand, capture logs/state *before* restarting anything.
- **Frontend** (`src/`) — React/wagmi rendering + gating logic (handle
  ownership, human-verified status, tab state). Bugs show up as wrong UI
  state, stuck spinners, silent no-ops.

## Step 1 — get logs first, before touching anything

If the WS server / Next.js are already running from an earlier session,
don't restart them blind — check state first:

```bash
curl -s http://localhost:4000/tables   # WS alive? what tables/phases exist right now?
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/
tail -100 /tmp/pokerpals_ws.log /tmp/pokerpals_next.log 2>/dev/null
```

Need a fresh repro instead? Use `.claude/skills/run/SKILL.md` (`smoke.sh`) —
it has the throwaway-operator-key pattern and `TESTNET_SKIP_CHAIN_VERIFY`
already worked out.

## Step 2 — reproduce at the right surface

- **UI bug** — drive it with Playwright like a real user; don't
  import-and-call a component to "test" it. No real MetaMask is available
  headlessly, so simulate a connected wallet by injecting an EIP-1193 +
  EIP-6963 fake provider via `ctx.addInitScript()` before navigation (see
  `.claude/skills/run/SKILL.md` for the Playwright module path: this sandbox
  only has `/opt/node22/lib/node_modules/playwright`, CJS `require`, no ESM).
  Attach `page.on('console')` and `page.on('pageerror')` listeners *before*
  navigating — most root causes surface there before they're visible.
  Note: a mock provider whose `eth_accounts` always returns an address will
  cause wagmi to **auto-reconnect on every page load** in that browser
  context, even on pages you intended to test "disconnected." Use a
  separate context with no injected provider at all for genuine
  disconnected-state checks.
- **Game-logic bug** (betting order, payouts, hand evaluation) — `npm run
  test` runs the pure hand-evaluator suite (`test/holdem.test.mjs`), no
  chain/server needed. Fastest way to isolate logic from I/O. For
  state-machine bugs (stuck phase, wrong `actionIdx`), add temporary
  `console.log` around the relevant `PokerTable` method in
  `server/index.js`, retrigger via a real WS client (`scripts/bot.mjs` or a
  `SPAWN_BOT` message), then remove the logging before committing.
- **Settlement / on-chain mismatch** — compare the operator's signed
  payload (`keccak256(tableId, handNonce, winners[], shares[])`, computed on
  `HAND_OVER`) against what actually landed on-chain (Step 3).

## Step 3 — on-chain state, without RPC egress

This sandbox has **no outbound network access to Arbitrum RPC** — plain
`curl` to `*.arbitrum.io` is blocked at the egress allowlist. Don't fight
that; use the Blockscout MCP tools instead, which reach the explorer's
indexed API over an allowed path and need no local RPC at all:

- `get_address_info` / `get_tokens_by_address` — balances, verified status,
  first-tx timestamp for any contract or wallet
- `read_contract` — call a view function directly (`humanVerified(addr)`,
  `getTableInfo(tableId)`, …) without a local RPC
- `get_transaction_info` — inspect a specific `buyIn`/`rebuy`/`settle` tx,
  including revert reason
- `get_token_transfers_by_address` — CHIPS/USDC movement for an address
- `inspect_contract_code` / `get_contract_abi` — check deployed bytecode
  against `contracts/*.sol` when behavior doesn't match source

Chain ID for this repo's testnet is `421614` (Arbitrum Sepolia). Cross-check
addresses against `deployments/arbitrumSepolia.json` if anything looks
stale — `npm run setup:env` resyncs `.env` from that file.

## Step 4 — common root causes specific to this repo (check these first)

- **Stale contract address** — `next.config.js` auto-loads addresses from
  `deployments/arbitrumSepolia.json` at build time; `.env`'s `NEXT_PUBLIC_*`
  values win if set. Confirm which source actually won before chasing logic
  bugs.
- **On-chain "Active" vs off-chain "running" disagreement** — `PokerEscrow`
  and the WS server's `maybeAutoStart` can disagree on the player-count
  threshold for "table is active." This class of bug surfaces as
  `rebuy()`/`cashOut()`/`settle()` reverting with a nonsensical gas
  estimate (wallet can't estimate gas for a call guaranteed to revert).
  Check `t.players.length` against the contract's actual `TableStatus`
  transition condition before assuming the bug is elsewhere.
- **`handNonce` drift** — tracked independently in `PokerTable` (memory) and
  the contract. If `settle()` reverts on something nonce-shaped, diff the
  two values directly.
- **`TESTNET_SKIP_HUMAN_CHECK` / `TESTNET_SKIP_CHAIN_VERIFY`** — if either
  is unexpectedly on/off in `.env`, an entire verification or chain-check
  path is silently bypassed or blocked. Confirm these first; they're cheap
  to check and easy to forget about.
- **Busted players stop receiving `GAME_STATE`** — `broadcastTable()` only
  iterates `t.players`; a player moved to `t.bustedSeats` on bust won't get
  further updates unless that's explicitly handled. Relevant for any "screen
  froze after I busted" report.

## Step 5 — stop and ask before going further if…

- The bug only reproduces with a real funded wallet or mainnet — this
  sandbox can't do that; say so rather than faking a result.
- Root cause implicates a security-sensitive contract path
  (`buyIn`/`settle`/`markHuman`) — root-cause it here, then hand off to
  `/security-review` or `/audit` rather than patching blind.
