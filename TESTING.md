# Testing PokerVsPlayer on Testnet

This guide gets external testers playing on **Arbitrum Sepolia**, and gives the
operator a pre-flight checklist so a test session doesn't start half-broken.

---

## The three live layers

A tester touches all three. If any one is down, things fail in confusing ways:

| Layer | Where it runs | If it's down… |
|---|---|---|
| **Frontend** | Vercel → `https://pokervsplayer.xyz` (auto-deploys from `main`) | nothing loads |
| **Game server** | Fly.io → `wss://pokerpals-server.fly.dev` (WebSocket) | site loads but **no tables / no gameplay** |
| **Contracts** | Arbitrum Sepolia (addresses in `deployments/arbitrumSepolia.json`) | buy-in / settle / stake revert |

> The frontend reaches the game server via the Vercel env var
> **`NEXT_PUBLIC_WS_URL`**. If that var is missing or wrong, the game socket
> silently never connects — the lobby looks fine but no table ever works.

---

## Operator pre-flight (do this before each test session)

Run the automated check:

```bash
bash scripts/healthcheck.sh
# optional: also verify the contract is deployed
ARB_SEPOLIA_RPC=https://your-rpc bash scripts/healthcheck.sh
```

It checks the site, the game server, and (with an RPC) the escrow contract, then
prints the manual gates below. All green + manual gates done = ready.

### Manual gates the script can't see

1. **Game server is deployed and running.**
   `curl https://pokerpals-server.fly.dev/tables` should return JSON. If not,
   redeploy it (`fly deploy`).

2. **Game server secrets** (Fly.io secrets):
   - `OPERATOR_PRIVATE_KEY` — must be the key for the address stored as
     `PokerEscrow.operatorSigner` on-chain, or every settlement is rejected.
   - `ARB_SEPOLIA_RPC` — an Arbitrum Sepolia RPC endpoint.
   - `TESTNET_SKIP_HUMAN_CHECK=true` — lets the server auto-mark connecting
     wallets as human so testers can buy in without a Gitcoin Passport.

3. **Vercel env vars** (production):
   - `NEXT_PUBLIC_WS_URL=wss://pokerpals-server.fly.dev` — **must be `wss://`**,
     not `ws://` (mixed-content is blocked on HTTPS).
   - `NEXT_PUBLIC_WC_PROJECT_ID` — your WalletConnect project id.
   - `NEXT_PUBLIC_CHAIN_ID=421614` — Arbitrum Sepolia.
   - Contract addresses load from `deployments/arbitrumSepolia.json` at build
     time, so they're usually automatic.

4. **WalletConnect origins.** On [cloud.reown.com](https://cloud.reown.com), add
   `https://pokervsplayer.xyz` (and any Vercel preview domains) to the project's
   allowed origins. Otherwise wallet connect fails with *"origin not allowed"*
   (WebSocket close code **3000**).

5. **Fund testers** (see below).

---

## Tester onboarding (share this part with testers)

1. **Install MetaMask** (mobile app or browser extension).
2. **Add the Arbitrum Sepolia network** (chain id `421614`). MetaMask can add it
   automatically when the site requests it, or add it manually from
   [chainlist.org](https://chainlist.org).
3. **Get test ETH** for gas from an Arbitrum Sepolia faucet (Alchemy, QuickNode,
   or the Chainlink faucet). A small amount is plenty.
4. **Get CHIPS** to play — ask the operator to send you some (see below), or use
   the in-app **Buy CHIPS** page.
5. Open **https://pokervsplayer.xyz**, connect your wallet, approve the
   signature prompt to sign in.
6. **Claim a handle** at `/handle` (optional but recommended — it's your name at
   the table).
7. **Sit at a table** from the lobby, buy in, and play.

> ⚠️ Use an incognito/private tab if you tested an earlier version — browsers
> cache the old build aggressively.

### Sending testers CHIPS (operator)

```bash
FAUCET_TO=0xTESTER_ADDRESS npm run faucet                       # default 10,000 CHIPS
FAUCET_TO=0xTESTER_ADDRESS FAUCET_AMOUNT=50000 npm run faucet   # custom amount
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Lobby loads, no tables ever appear | Game server down, or `NEXT_PUBLIC_WS_URL` wrong/missing | confirm `curl …/tables`; set the Vercel var to the `wss://` URL |
| Wallet won't connect; toast "origin not allowed" / code 3000 | site origin not in WalletConnect allowed list | add `https://pokervsplayer.xyz` on cloud.reown.com |
| Huge / nonsensical "network fee" in MetaMask | wallet can't estimate gas for a call that would revert (e.g. unstaking during the lock, or buying into a table you can't sit at) | expected — the tx would fail; don't submit it |
| Buy-in reverts with a "not human" error | `TESTNET_SKIP_HUMAN_CHECK` not set on the server | set it to `true` and redeploy the server |
| Tx fails: "insufficient funds" | no Sepolia ETH for gas | get test ETH from a faucet |
| "no handle" on `/handle` after a redeploy | contracts were redeployed; old handle was on the prior contract | re-mint — old NFTs don't carry over a full redeploy |

---

## Note on redeploys

Testnet deploys are **manual only** (`.github/workflows/deploy-testnet.yml` is
`workflow_dispatch`-triggered). A full redeploy (`npm run deploy:testnet`)
deploys fresh contracts and **wipes all prior on-chain state** — balances,
stakes, and minted handles. During an active test cycle, prefer the narrow
targeted paths (`escrow_only`, `tournament_only`, `handle_only`) and only do a
full redeploy when you intend to reset everything. After any redeploy, run
`npm run setup:env` so addresses re-sync.
