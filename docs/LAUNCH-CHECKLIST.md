# Mainnet launch checklist

Target: **Robinhood Chain**, chainId 4663. Everything below is an operator
action — it needs the real keys, which deliberately do not exist in any repo or
cloud session.

**Order matters more than anything else here.** Several steps need the owner key,
and the multisig handover is one-step and irreversible. Rotating after the
handover means every rotation becomes a Safe proposal; rotating before means a
key you are trying to retire is still doing the work. The sequence below resolves
that: rotate first, verify, hand over last.

---

## 1. Fresh keys — before anything is deployed

`npm run setup:wallets` generates a new set. Nothing from testnet carries over:
every testnet key has been in CI, in `.env` files, and in cloud sessions, and
must be treated as public.

| Key | Lives in | Powers |
|---|---|---|
| `DEPLOYER_KEY` | your machine only, never CI | deploys, then becomes the owner until step 6 |
| `OPERATOR_PRIVATE_KEY` | Fly secrets (game server) | **signs every settlement and cashout** |
| `OPERATOR_SIGNER` | contract config | the address the contracts verify against |
| `RAKE_WALLET` | address only | receives treasury rake + seat fees |
| `ANTIBOT_ORACLE` | oracle process env | calls `markHuman` |
| `DEV_WALLET` | address only | claims the monthly vest |

The operator key is the one that matters most: it decides who won every hand.
The contracts verify its signature and nothing else. Keep it on the game server
and nowhere else — not in `.env.enc`, not in CI, not in a session.

`npm run encrypt:env` refuses to seal any of these into the committed `.env.enc`.
Leave those slots blank in the `.env` you encrypt.

## 2. The stablecoin — read this before setting anything

**Robinhood Chain has no Circle USDC.** Its native stablecoin is **USDG** (Global
Dollar, Paxos) at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` — verified on
Blockscout, ~$3.2B circulating, and **6 decimals**, the same as USDC, so the peg
math (`rateUsdcPerChip` = stablecoin-wei per 1e18 SALOON) is unchanged.

Two ways to get this permanently wrong, because `StablecoinPool` and
`ChipsLiquidityPool` take the token in their constructors and never let go:

- **Pasting Arbitrum One's USDC address** (`0xaf88d0…`). Nothing is deployed at
  it on Robinhood Chain. Both pools would point at a dead address forever.
- **Grabbing a lookalike.** Every token on that chain calling itself "USDC" is
  an impostor — unverified, 18 decimals, 1e27 supply minted to nobody:
  "Universal Stable Digital Coin", "United States Central Dollar", "UpSideDownCat
  on robinhood", and one with 400 characters of tickers in its name. An
  18-decimal token would misprice every swap by 1e12.

The deploy now verifies the token on-chain before using it — contract code
present, 6 decimals, expected symbol — and refuses otherwise. USDG is the
built-in default for `robinhood`, so the correct setting is **nothing**:

```
NEXT_PUBLIC_CHAIN_ID=4663
# stablecoin defaults to verified USDG; override only with a reason:
# STABLECOIN_ADDRESS=0x…   STABLECOIN_SYMBOL=…
```

Decide deliberately whether USDG is the stablecoin you want this product settled
in. It is the right technical choice on this chain; whether the liquidity suits
your players is a business call, and it cannot be changed after deploy without
redeploying both pools.

### Rehearse first

```bash
npx hardhat node &
DEPLOYER_KEY=<a funded local key> npm run rehearse:deploy
```

This runs the **mainnet** path — no MockUSDC shortcut — against a throwaway
chain, proves the stablecoin guard rejects a no-code address, a malformed
address, a symbol mismatch and an 18-decimal token, then deploys all 14 contracts
and verifies every post-deploy wiring. A broken mainnet deploy costs real gas and
leaves dead contracts behind; this costs nothing.

## 3. Deploy

```bash
npm run compile
npm run sync:artifacts      # pinned deploy artifacts must match the compiled contracts
npm run deploy:mainnet
```

`sync:artifacts` is not optional. `scripts/artifacts/*.json` are committed
bytecode used by the standalone deploy scripts, and they have gone stale before —
PokerHandle and HandleRenderer sat at pre-rebrand bytecode through the Saloon
rename, which would have minted ERC-721s permanently named "PokerVsPlayer
Handle". `npm run test:contracts` fails if they drift.

## 4. Verify the deployment before any money moves

- Contract addresses in the manifest match what the explorer shows
- `ChipsToken.name()` / `symbol()` read "Saloon" / "SALOON" — **immutable**
- `PokerHandle.name()` reads "Saloon Handle" — **immutable**
- `operatorSigner` on PokerEscrow and TournamentManager is the new operator address
- `rakeRecipient` is the new rake wallet, `devWallet` the new dev wallet
- Allocations landed: 200M staking, 100M kings, 100M promotions, 500M liquidity
- `ChipsLiquidityPool.rateUsdcPerChip` is the intended peg — it only moves 10%/day
  afterwards (`MAX_RATE_CHANGE_BPS`), so getting it right here matters

## 5. Deploy the servers with the new secrets

- Fly: `OPERATOR_PRIVATE_KEY`, RPC, `CHAIN_ID=4663`, `FRONTEND_ORIGIN`
- Vercel: `NEXT_PUBLIC_*` only. No private key belongs in the frontend
  environment — `/api/verify` was deleted so `DEPLOYER_KEY` is no longer needed
  there at all
- Oracle process: `ANTIBOT_ORACLE` key, Alchemy and Gitcoin credentials
- `TESTNET_SKIP_HUMAN_CHECK` must be **false** or unset

Play one real hand end to end, and cash out, before opening it to anyone.

## 6. Hand ownership to the multisig — last

```bash
npm run transfer:ownership -- 0xSAFE            # dry run first, always
npm run transfer:ownership -- 0xSAFE --confirm
```

The dry run prints every contract and every privileged role. Read it. The script
refuses a target with no contract code, because a Safe is a contract and an EOA
there means a typo you cannot undo.

Ownership does **not** cover `operatorSigner`, `rakeRecipient`, `antiBotOracle`
or `devWallet` — those are separate roles, and the dry run flags any still held
by the deployer key. Fix them before this step, while the deployer is still owner
and a plain transaction does it.

After the handover, `setRate`, `setRakeSplit`, withdrawals from the pools, and
every other owner action become Safe proposals. That is the point.

## 7. Only then discard the deployer key

Confirm from a second source (explorer, a different RPC) that `owner()` on every
contract is the Safe. There is no way back from getting this wrong.

---

## Known residual risks

Carried from `docs/SLITHER.md` and the audit — accept these knowingly or address
them first:

- **Operator key compromise forges settlements.** It signs every hand's outcome
  and the contracts verify nothing else. This is the single highest-value secret
  in the system.
- **StakerLottery randomness is commit-reveal on a future block hash**, not a
  VRF. A griefer can let an unsettled commit expire and re-request for a fresh
  roll, if nobody settles during the whole 256-block window. Running
  `lottery:draw` as one request→wait→draw pass closes it in practice.
- **`mythril` has not been run.** It needs a machine that can download a solc
  binary: `myth analyze contracts/PokerEscrow.sol`.
- **No third-party audit.** Slither is a linter with good detectors, not an
  audit, and this system holds player funds.
