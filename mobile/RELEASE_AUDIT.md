# Mobile release audit — development branch

## Confirmed evidence
- GitHub Actions mobile debug APK compilation and artifact upload succeeded at commit `ef35831e665c7de6acd58b67e53ce0dc30ee22d5`, run `43801256628`. This proves only that an Android **debug WebView shell** compiles.
- The mobile layer contains no operator private keys and does not modify Arbitrum smart contracts.
- Remote origin in Capacitor config is HTTPS; no broad `allowNavigation` entry is configured.

## Gaps / release blockers (NOT passed)
1. **Real-device wallet interoperability**: wagmi WalletConnect is implemented for the web, but Android intent handling, WalletConnect redirect return, iOS universal links, account persistence, and reconnection are unverified.
2. **On-chain E2E**: no verified mobile run proving connect → table → escrow buy-in → complete hand → on-chain settlement → cash-out on testnet.
3. **Remote WebView store approval**: loading an existing website remotely does not alone demonstrate minimum native functionality or qualify for either store.
4. **Regulated gambling**: real-value wagers, rake and redeemable CHIPS must not be released on app stores absent applicable operator licensing, age/location enforcement, responsible gaming, and explicit platform authorization. Client-side restrictions alone are insufficient.
5. **iOS**: Xcode signing, simulator and device build tests, deep-link handling, TestFlight review are unverified.
6. **Android store packaging**: CI now attempts unsigned `bundleRelease`; signing, Play Console submission, policy approval and production release remain disabled/unverified.
7. **Supply chain**: mobile dependencies are not committed with a lockfile, and CI currently resolves semver ranges. Pin + commit a generated lockfile before release.
8. **Sensitive data**: independently test remote navigation, injected web views, wallet redirects and log exposure. No secret material may be packaged into mobile assets.

## Safe test path
- Install Android debug APK from the CI artifact on a dedicated test device.
- Use a strictly isolated environment with valueless test assets and no live wagering enabled.
- Capture device logs, WalletConnect redirection and restore behavior, game WebSocket reconnection, and Arbitrum Sepolia transaction hashes.
- Test signed production AAB and iOS archive only after the preceding blockers are resolved.

The debug APK is **not** an approved public gambling product.
