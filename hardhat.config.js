import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { defineConfig } from "hardhat/config";
import "dotenv/config";

// When HARDHAT_LOCAL_SOLC is set, skip the compiler download step entirely.
// Used in network-restricted environments where binaries.soliditylang.org is unreachable.
const localSolcPlugin = process.env.HARDHAT_LOCAL_SOLC
  ? {
      id: "local-solc",
      hookHandlers: {
        solidity: async () => ({
          default: async () => ({
            downloadCompilers: async (_ctx, _configs, _quiet) => {
              // Skip download — local compiler path is configured via hardhat.config.js
            },
          }),
        }),
      },
    }
  : null;

export default defineConfig({
  plugins: [
    hardhatEthers,
    hardhatMocha,
    ...(localSolcPlugin ? [localSolcPlugin] : []),
  ],
  paths: {
    tests: { mocha: "test/contracts" },
  },
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: true },
    ...(process.env.HARDHAT_LOCAL_SOLC
      ? { path: process.env.HARDHAT_LOCAL_SOLC }
      : {}),
  },
  networks: {
    hardhat: { type: "edr-simulated" },
    arbitrumSepolia: {
      type:     "http",
      url:      process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      chainId:  421614,
    },
    arbitrum: {
      type:     "http",
      url:      process.env.ARB_RPC || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      chainId:  42161,
    },
    // Robinhood Chain — Arbitrum Orbit L2 (EVM-identical, deploy as-is).
    robinhoodTestnet: {
      type:     "http",
      url:      process.env.ROBINHOOD_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      chainId:  46630,
    },
    robinhood: {
      type:     "http",
      url:      process.env.ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      chainId:  4663,
    },
    // Dress rehearsal: a local node that takes the MAINNET deploy path, so a
    // broken mainnet deploy is found here instead of on a chain where each
    // attempt costs real gas and leaves dead contracts behind. Start
    // `npx hardhat node` first; see `npm run rehearse:deploy`.
    rehearsal: {
      type:     "http",
      url:      process.env.REHEARSAL_RPC || "http://127.0.0.1:8545",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      chainId:  Number(process.env.REHEARSAL_CHAIN_ID) || 31337,
    },
  },
  etherscan: {
    apiKey: { arbitrumOne: process.env.ARBISCAN_API_KEY || "" },
  },
});
