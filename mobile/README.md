# PokerPals mobile prototype (Android + iOS)

This directory adds **mobile development targets** without changing the Next.js website, WebSocket server, or Arbitrum contracts. It is a **remote Capacitor webview prototype**, **not** a release-ready app or proof that wallet signing, transactions, policy controls, or on-chain settlement work on physical devices.

## Prerequisites

Node 22, Java 17 and Android SDK for Android. For iOS, macOS with Xcode, CocoaPods as required, and Apple code signing. A current WalletConnect project ID and reachable production/staging WebSocket backend are needed for end-to-end tests.

## Android debug APK

```bash
cd mobile
npm install
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```

Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. For Google Play, create a **signed release AAB** after compliance and device testing; debug APKs are not Play Store artifacts.

## iOS simulator/dev build

On a Mac:

```bash
cd mobile
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

Use Xcode to choose an Apple development team, then build to a device or simulator. App Store/TestFlight distribution requires release signing and review.

## Environment and restrictions

- The prototype uses a fixed `https://pokervsplayer.xyz` HTTPS origin in `capacitor.config.json`. To use controlled staging, change the origin in a separate development build and verify its identity; do not introduce production secrets. Staging must **not** permit redeemable real-value wagering without appropriate controls.
- This approach uses Capacitor's remote server URL solely to accelerate **device testing**. It may not meet Apple's minimum-functionality requirement, and injected WalletConnect flows, external-wallet return routes, Android app links and iOS universal links still need implementation and real-device testing.
- Do **not** embed RPC secrets, operator/deployer keys, or signing keys in the mobile app.
- Do **not** enable cash-equivalent buy-ins for public app store users without verified operator licensing, geography/age controls, responsible-gaming compliance, and platform approval. A client-side hide button is not a security control: enforce eligibility server-side before action and contract use where feasible.
- There is **no** production deployment, mainnet contract change, app store upload, or new wallet/key in this branch.

## Release acceptance checklist

1. Android APK installs, launches, and correctly handles WebSocket reconnection on a physical device.
2. WalletConnect opens an external wallet and reliably returns to PokerPals; chain ID and contract address match the configured network.
3. Testnet-only play: create/join table, buy in with **valueless test tokens**, finish hand, verify signature and receipt on Arbitrum Sepolia explorer, cash out.
4. No injection vulnerabilities, unexpected URL navigation, privileged keys in app, or cleartext RPC/WS traffic.
5. Native functionality beyond a site wrapper: deep links, reconnection, offline status, background recovery and accessibility.
6. Signed Android AAB and iOS archive pass device tests, store metadata and legal review before submission.

**Important:** A testnet asset is not automatically valueless if it can be redeemed or traded for value. Restrict the test environment accordingly.
