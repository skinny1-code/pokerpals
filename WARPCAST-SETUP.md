# Warpcast Mini-App Setup

This guide explains exactly what to configure in Vercel so PokerVsPals appears and
opens correctly inside Warpcast as a Farcaster mini-app.

---

## What you need to set in Vercel

Go to your Vercel project → **Settings** → **Environment Variables** and add:

| Variable | Example value | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://pokerpals.vercel.app` | Your production Vercel URL — **no trailing slash** |
| `NEXT_PUBLIC_WS_URL` | `wss://pokerpals-server.fly.dev` | After Fly.io deploy — must be `wss://`, not `ws://` |
| `FARCASTER_MANIFEST_HEADER` | *(from step below)* | Base64url string from Warpcast |
| `FARCASTER_MANIFEST_PAYLOAD` | *(from step below)* | Base64url string from Warpcast |
| `FARCASTER_MANIFEST_SIGNATURE` | *(from step below)* | Base64url string from Warpcast |

After saving, trigger a **Redeploy** in Vercel (Deployments tab → three-dot menu → Redeploy).

---

## How to generate the accountAssociation (one-time)

The `accountAssociation` block proves that the Farcaster account you control has
authorized this domain. You only need to do this once per domain.

1. Open <https://warpcast.com/~/developers> in Warpcast (mobile) or the web app.
2. Click **"Add Mini App"** (or **"New Mini App"** / **"Add domain"** — wording varies by version).
3. When prompted for your domain, enter **`pokerpals.vercel.app`** (no `https://`, no trailing slash).
4. Sign the prompt with your Farcaster custody wallet — Warpcast will display three values:
   - **header**
   - **payload**
   - **signature**
5. Copy each value into the matching Vercel env var (`FARCASTER_MANIFEST_HEADER`, etc.).
6. Redeploy Vercel.

> If you later change your production domain, you must repeat this step for the new domain.

---

## How to test in Warpcast

1. After the Vercel redeploy finishes, open the manifest URL in your browser and
   confirm it returns valid JSON with your values filled in:
   ```
   https://pokerpals.vercel.app/.well-known/farcaster.json
   ```
2. To test the embed card, paste your app URL into a Warpcast cast draft — it should
   render a card with the splash image and a **"Play Poker"** / **"Open"** button.
3. Tap the embed to launch the mini-app. Warpcast injects an `sdk` object so the app
   can call `sdk.actions.ready()` and request a wallet connection automatically.
4. To force a cache refresh, append a unique query string to the cast URL
   (e.g. `?v=2`) or use a fresh cast.

---

## File locations

| Purpose | File |
|---|---|
| Farcaster manifest | `src/app/.well-known/farcaster.json/route.js` |
| Mini-app webhook receiver | `src/app/api/miniapp-webhook/route.js` |

The manifest is served at `/.well-known/farcaster.json` via Next.js App Router.
The webhook receives events (`miniapp_added`, `notifications_enabled`, etc.) that
Warpcast POSTs when users interact with the mini-app — extend it to send push
notifications via Neynar or a custom relay.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Manifest returns empty strings for `accountAssociation` | `FARCASTER_MANIFEST_*` env vars not set in Vercel | Add the three vars and redeploy |
| `imageUrl` / `homeUrl` are empty or `undefined` | `NEXT_PUBLIC_APP_URL` not set | Add the var and redeploy |
| Frame embed doesn't show in Warpcast | Warpcast CDN cache | Post the URL in a brand-new cast, or append `?v=2` |
| Mini-app opens but wallet doesn't connect | `NEXT_PUBLIC_WS_URL` wrong protocol | Must be `wss://` (not `ws://`) on production |
| Warpcast says "domain not associated" | `accountAssociation` signed for a different domain | Re-run the Warpcast developer flow for the exact production domain |

---

## Quick reference — manifest structure

```json
{
  "accountAssociation": {
    "header": "<FARCASTER_MANIFEST_HEADER>",
    "payload": "<FARCASTER_MANIFEST_PAYLOAD>",
    "signature": "<FARCASTER_MANIFEST_SIGNATURE>"
  },
  "frame": {
    "version": "1",
    "name": "PokerVsPals",
    "iconUrl": "https://pokerpals.vercel.app/icon.png",
    "homeUrl": "https://pokerpals.vercel.app",
    "imageUrl": "https://pokerpals.vercel.app/og.png",
    "splashImageUrl": "https://pokerpals.vercel.app/splash.png",
    "splashBackgroundColor": "#0c1a0c",
    "webhookUrl": "https://pokerpals.vercel.app/api/miniapp-webhook"
  }
}
```

All URLs are derived automatically from `NEXT_PUBLIC_APP_URL` at runtime — you do
not need to hardcode them.
