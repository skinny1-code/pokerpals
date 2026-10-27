# Robinhood Chain migration — preserve existing PokerChips (CHIPS)

This is an **integration/staging branch**, not proof of a public or mainnet launch. It reuses `contracts/ChipsToken.sol` and the existing PokerVsPlayer game/escrow/tournament contracts. **It does not create a separate `$POKERCHIP` token.** The existing contract's name/symbol are `PokerChips` / `CHIPS`, with a fixed 1,000,000,000 CHIPS initial issuance per deployment.

## Network values (official Robinhood documentation)

| Property | Testnet | Mainnet |
|---|---|---|
| Chain ID | `46630` | `4663` |
| RPC (public, rate-limited) | `https://rpc.testnet.chain.robinhood.com` | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` | `https://robinhoodchain.blockscout.com` |
| Gas | testnet ETH | ETH |

Refs: https://docs.robinhood.com/chain/connecting/ and https://docs.robinhood.com/chain/deploy-smart-contracts/

## Testnet deployment checklist (manual; no deployment has been performed)

1. Confirm a **dedicated** testnet deployer and testnet operator wallet; never expose keys in GitHub or chat. Back up the previous Arbitrum Sepolia manifest and environment. Test the entire process in an isolated staging app/server, not the existing production deployment.
2. Set `DEPLOYER_KEY`, `ROBINHOOD_TESTNET_RPC`, and test-only signer/rake/oracle/dev wallet roles. Obtain testnet ETH from https://faucet.testnet.chain.robinhood.com/. Keep `ROBINHOOD_MAINNET_DEPLOY_ACK` unset.
3. Run `npm ci && npm run compile && npm run test:contracts && npm test`.
4. To manually execute the testnet deployment: `npm run deploy:robinhood:testnet`. This issues **testnet-only** CHIPS plus the existing contract suite. Capture `deployments/robinhoodTestnet.json` and the transaction receipts.
5. Configure a **separate frontend/server deployment** with `NEXT_PUBLIC_CHAIN_ID=46630`, `NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC`, contract addresses from the new manifest, `RPC_URL=https://rpc.testnet.chain.robinhood.com`, and a supported WebSocket URL. Verify the server RPC chain ID, oracle signer, escrow token, pools, and deployed bytecode all match this network. Never combine Robinhood contract addresses with Arbitrum RPC.
6. Test with at least two wallets: connect/switch network, human verification, create table, approve CHIPS, buy in, sign and settle, rake accounting, redeem/refund, disconnect/reconnect, wrong-chain rejection, dropped server, replay protection, operator gas, and tournament flows. Archive transaction links, logs, screenshot evidence, and contract-source verification.
7. Confirm `TESTNET_SKIP_CHAIN_VERIFY=false` and `TESTNET_SKIP_HUMAN_CHECK=false` in any environment intended to validate deposits/security. Where temporary bypasses are necessary for isolated developer simulations, never treat them as evidence of payment verification.
8. Do not publish a real-money game or coin sale until legal counsel has addressed US/Florida/other state gaming, financial promotion, age verification, AML/KYC/sanctions/geofencing, and consumer protection requirements, and independent reviews have validated settlement and custody.

## Mainnet blockers — do not skip

- **Supply decision:** Deploying `ChipsToken.sol` on Robinhood mainnet issues another 1B units. Confirm there is no outstanding mainnet CHIPS supply or implement an audited canonical bridge / burn-and-mint migration. A testnet CHIPS balance is not a redeemable mainnet balance.
- **Safety gate:** `scripts/deploy.js` refuses Robinhood mainnet issuance unless an explicit release acknowledgment plus verified `ROBINHOOD_USDC_ADDRESS` and configured role addresses are provided. This must not be bypassed before a release review.
- **Liquidity:** The old Camelot/Uniswap Arbitrum URLs and Arbitrum-targeted Transak route are disabled for Robinhood Chain in the staging UI. A token contract alone is not DEX liquidity. Existing liquidity and USDC pool assumptions (`$0.001/CHIP`) are **not guarantees**, and need chain-specific review.
- **Off-chain services:** The oracle's activity check currently queries **Arbitrum mainnet Alchemy**; review and adapt the verification policy for Robinhood rather than assuming it is chain-native. The server, wallet, anti-bot, faucets and other scripts must be checked end to end.
- **Other protocol checks:** signer replay isolation, poker room state synchronization, multisig ownership, smart contract audit, anti-collusion controls, geofencing, dispute resolution, and mainnet fee estimation.
- **Distribution:** Robinhood Chain deployment does **not** imply any token listing in the Robinhood brokerage/crypto app or an endorsement from Robinhood.

## Explicitly not changed

The existing Arbitrum Sepolia default (`421614`), `ChipsToken.sol` ticker `CHIPS`, allocation, rake split, games, and production deployment remain intact. No live keys, liquidity, funds, tokens, or gas were moved during this preparation.
