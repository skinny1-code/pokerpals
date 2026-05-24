import "@nomicfoundation/hardhat-ethers";
import "dotenv/config";

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: true },
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
};
