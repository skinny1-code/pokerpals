# Slither triage

Static analysis of `contracts/` with [Slither](https://github.com/crytic/slither).

```bash
pip install slither-analyzer
npm run compile          # slither reads the Hardhat build, it does not invoke solc
npm run slither          # report + fail on anything not in the baseline
npm run slither -- --update-baseline
```

`npm run slither` reports every **High** and **Medium** finding in `contracts/`
(OpenZeppelin and other dependencies are filtered out) and exits non-zero on any
finding not already in `security/slither-baseline.json`. Findings are keyed by
detector + file + element, not line number, so they survive code moving around.

Detectors are deliberately **not** disabled wholesale and there are no
`slither-disable` comments in the contracts: switching a detector off to silence
a false positive also hides the next true positive from the same detector. The
baseline is the filter, and everything in it is accounted for below.

As of the last run: **24 findings — 3 High, 21 Medium. None exploitable.**

---

## High

### `encode-packed-collision` — `PokerEscrow.settle`, `TournamentManager.payout`

Both build their signed digest with `abi.encodePacked(…, address[] winners,
uint256[] shares)`. `encodePacked` writes no length prefixes, so in general two
different array splits can produce identical bytes — and for a digest that
authorizes payouts, that would be signature forgery.

**Not reachable here.** Both functions require `winners.length == shares.length`
before hashing. The packed tail is therefore exactly `20n + 32n = 52n` bytes,
which fixes `n`, which fixes the `20n`/`32n` boundary — so exactly one
`(winners, shares)` pair maps to any given digest.

This holds *only* because of that length check. Both call sites carry a comment
saying so. If the length requirement is ever relaxed, this becomes a live
forgery bug and the digest must move to `abi.encode`.

### `weak-prng` — `StakerLottery.draw`

The winner is derived from a block hash. Slither flags every such use, and for a
single-phase draw it would be right: `blockhash(block.number - 1)` already exists
when the transaction is built, so any entrant could simulate the outcome and
submit only when they win.

**Addressed by design, not by the detector's standard.** Settling is two-phase:
`requestDraw()` commits to a block `drawDelayBlocks` in the future, and `draw()`
reads *that* block's hash. Entries close when the epoch ends, so the entrant set
is frozen before a not-yet-existing hash is committed to.

The residual weakness is documented in the contract: `blockhash` only reaches
back 256 blocks, so a commit nobody settles in time expires and must be re-made,
and a griefer who dislikes a pending outcome can let it lapse for a fresh roll —
but only while no one else settles, at 1-in-N per attempt. `npm run lottery:draw`
does request → wait → draw in one run, which closes that window in practice. A
VRF would remove it entirely, if one is ever deployed on the target chain.

---

## Medium

### `reentrancy-no-eth` (6) — settle, payout, mintHandle, changeHandle, terminateLease, _extendLease

Every one is either directly `nonReentrant` or only reachable through a
`nonReentrant` entry point:

| Finding | Why it is safe |
|---|---|
| `PokerEscrow.settle` | `nonReentrant` |
| `TournamentManager.startTournament` | `nonReentrant` |
| `TableRegistry.terminateLease` | `nonReentrant`; `heldFunds` zeroed before the transfer |
| `TableRegistry._extendLease` | internal; both callers (`renewLease`, `renewLeaseMonths`) are `nonReentrant` |
| `PokerHandle.mintHandle` | `handleTaken[lower]` is set *before* the token transfer, and a re-entrant call reverts on `AlreadyHasHandle`. `_safeMint` completes all state writes before `onERC721Received` |
| `PokerHandle.changeHandle` | same ordering |

### `divide-before-multiply` (4) — claimDevVest, devClaimable, settle, startTournament

- `ChipsToken.claimDevVest` / `devClaimable`: `monthsElapsed = elapsed / 30 days`
  then `× DEV_MONTHLY_RATE`. The truncation *is* the vesting schedule — a monthly
  cliff, not a rounding error.
- `PokerEscrow.settle` / `TournamentManager.startTournament`: rake is computed,
  then split into burn / staking / kings shares, with treasury taking the
  remainder (`rake - burn - staking - kings`). Nothing is lost to rounding; the
  remainder absorbs it.

### `uninitialized-local` (7)

`tot`, `referralPaid`, `winner`, `cumulative`, `count`, `idx`, `refund`. Solidity
zero-initializes every local; each is assigned before use. False positives.

### `incorrect-equality` — `StakerLottery._requestExpired`

`blockhash(drawRevealBlock) == bytes32(0)`. The exact-zero comparison is the
mechanism: `blockhash` returns exactly zero for a block outside its 256-block
window, which is precisely how an expired commit is detected.

### `unused-return` (2)

- `ProfitSplitter.harvestYield` ignores `staking.claimYield()`'s return. The
  tokens arrive regardless; `distribute()` works off the contract's balance.
- `StakerLottery.enter` destructures `staking.stakes()` and skips two fields.
  Normal tuple destructuring.

---

## Not covered by static analysis

Slither does not model trust, so these stay on the launch checklist:

- **Owner key compromise is still catastrophic.** The owner can re-point rake
  recipients, authorize itself on `StablecoinPool`, and drain what those roles
  reach. `ChipsLiquidityPool.setRate` is capped at ±10%/day to bound one specific
  path, but the real mitigation is a multisig — see `npm run transfer:ownership`.
- **Operator key compromise forges settlements.** The signer decides every hand's
  winner; the contracts only verify the signature.
- **`mythril` has not been run here** — it needs a solc binary, and
  `solc-select` cannot fetch one through this sandbox's proxy. Run
  `myth analyze contracts/PokerEscrow.sol` on a machine with network access.
