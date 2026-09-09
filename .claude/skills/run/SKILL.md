---
description: Launch All In (WS game server + Next.js) and drive it with Playwright
---

# Run — All In

Two processes must be running before the browser can reach anything:

| Process | Command | Port | Log |
|---|---|---|---|
| WS game server | `node --env-file=.env server/index.js` | 4000 | `/tmp/pokerpals_ws.log` |
| Next.js (prod) | `NODE_ENV=production npx next start -p 3000` | 3000 | `/tmp/pokerpals_next.log` |

**Operator key (web / CI sessions):** the WS server exits with
`FATAL: OPERATOR_PRIVATE_KEY not set` unless that env var is present. The
SessionStart hook's `setup:env` rewrites `.env` to contract addresses only, so
the real key is usually absent here — and you do **not** want the production
settlement signing key inside an ephemeral sandbox anyway. Mint a throwaway key
in-memory and pass it inline (never write it to `.env`, never commit it):

```bash
OPERATOR_PRIVATE_KEY="$(node -e "console.log(require('ethers').Wallet.createRandom().privateKey)")" \
OPS_WALLET_KEY="$OPERATOR_PRIVATE_KEY" \
TESTNET_SKIP_CHAIN_VERIFY=true \
node --env-file=.env server/index.js
```

`node --env-file` does not override vars already set in the shell, so the inline
key wins over the secret-less `.env`. The throwaway key boots the server, WS, and
game loop fully; it signs nothing the deployed escrow would accept, so its blast
radius if leaked is zero. `TESTNET_SKIP_CHAIN_VERIFY=true` lets table ops run
without a reachable RPC (the sandbox has no outbound to Arbitrum).
`smoke.sh` does all of this automatically.

**Always use the production build** (`npm run build` first, then `next start`).
The dev server (`next dev`) triggers `/_error` prerendering failures because the
cloud container defaults to `NODE_ENV=development`.

## Quick launch (use the smoke script)

```bash
# Build first (skip if already built)
npm run build

# Start both servers, wait for readiness, run default Playwright screenshots
bash .claude/skills/run/smoke.sh
```

The smoke script:
1. Kills any previous instances (`pkill -f "node.*server/index.js"` / `pkill -f "next start"`)
2. Starts both servers in the background
3. Polls `:4000/tables` and `:3000/` until they respond
4. Runs the Playwright script passed as `$1` (or `/tmp/run_pokerpals.cjs` by default)
5. Kills both servers on exit

## Readiness checks

```bash
# WS server up?
curl -s http://localhost:4000/tables
# → {"tables":[{"id":"9001",...},{"id":"9002",...}]}

# Next.js up?
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# → 200
```

## Playwright — important: non-standard module path

**`chromium-cli` is not available** in this environment. Use Playwright via CJS
require from the system-global path:

```js
// /tmp/my_script.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx    = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page   = await ctx.newPage();

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.screenshot({ path: '/tmp/ss_lobby.png' });
  console.log('title:', await page.title());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

Then run: `node /tmp/my_script.cjs`

Do **not** use ESM (`import { chromium } from 'playwright'`) — the project's
`node_modules/playwright` is not installed and the ESM resolver won't find the
system-global path.

## Representative interaction sequence

```js
// Navigate pages and screenshot each
for (const [name, path] of [['lobby','/'],[' leaderboard','/leaderboard'],['stake','/stake']]) {
  await page.goto(`http://localhost:3000${path}`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.screenshot({ path: `/tmp/ss_${name}.png` });
}

// Verify WS tables endpoint
const { chromium: _c } = require('/opt/node22/lib/node_modules/playwright');
// ... or just curl in the smoke script
```

## Wallet-connected flows

The table page at `/table/9001` requires a wallet connection — MetaMask is not
available headlessly. To test game UI state:
- Use `TESTNET_SKIP_CHAIN_VERIFY=true` in `.env` and connect the ops wallet via
  the in-server `SPAWN_BOT` WS message, or run `node scripts/bot.mjs` as a
  second player.
- Screenshot `/table/9001` right after load to capture the pre-auth lobby state.

## Stop

```bash
pkill -f "node.*server/index.js"
pkill -f "next start"
```

## Gotchas

- **`EADDRINUSE`**: Always kill previous instances before relaunching.
- **WS server needs `.env`**: Use `node --env-file=.env server/index.js`, not
  plain `node server/index.js` — the server reads `OPERATOR_PRIVATE_KEY` etc.
- **`networkidle` on wallet pages**: Pages that open a WS connection never go
  fully idle. Use `waitUntil: 'load'` or a `wait-for` on a specific element
  instead.
- **`next start` requires a build**: Will error with "could not find a production
  build" if `npm run build` has not been run since the last source change.
