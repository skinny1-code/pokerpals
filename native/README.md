# PokerPals Native — Android + iOS

**This is a React Native application, NOT a website wrapper.** Its lobby, navigation, table details, and status are built from native React Native views. It talks directly to the existing PokerPals game server's public `GET /tables` endpoint. The earlier Capacitor remote-webview prototype is not used by this implementation.

Current scope: authentic live lobby display, refresh/error handling, table details, native menu, and explicit unsupported-action labeling. The existing server authenticates table play with a wallet signature (`PVP-AUTH:<nonce>`); this native app deliberately does not claim to support deposits, signed game actions, escrow transactions, or cash-out yet. Those will be enabled only after mobile wallet integration and testnet end-to-end verification. No simulated user funds or game outcomes.

## Build

```bash
cd native
npm install
npm test
npx expo prebuild --platform android --non-interactive
cd android && ./gradlew assembleDebug
```

The CI job uploads `pokerpals-native-android-debug-apk`. It is **not the old WebView APK**. iOS builds require macOS/Xcode and release signing. Set `EXPO_PUBLIC_GAME_API_URL` to the verified backend HTTPS origin; the default is inferred from the Fly app name `pokerpals-server`, not independently proven reachable.

## Boundaries

- One backend, one on-chain contract generation, multiple native/web clients.
- No operator/deployer keys, server secrets or private RPC keys in the app.
- No mainnet transactions, payment or wagering enablement.
- Unlicensed real-money gaming must not be distributed on the App Store or Google Play.
- Mobile auth and WalletConnect/Reown deep links and session re-entry must be implemented with wallet-provider consent, and proven on Android/iOS devices before game actions become active.
