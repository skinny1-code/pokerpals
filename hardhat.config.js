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
  },
  etherscan: {
    apiKey: { arbitrumOne: process.env.ARBISCAN_API_KEY || "" },
  },
});
