// Deploy ONLY the isolated NativeHypePokerEscrow on Kinetiq Elysium TESTNET.
// No CHIPS, ERC-20 mint, pool funding, bridge, or mainnet deployment.
import "dotenv/config";
import { network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.DEPLOY_NETWORK !== "elysiumTestnet" ||
    process.env.HYPE_TESTNET_DEPLOY_ACK !== "ISOLATED_TEST_ONLY") {
  throw new Error("Set DEPLOY_NETWORK=elysiumTestnet and HYPE_TESTNET_DEPLOY_ACK=ISOLATED_TEST_ONLY; mainnet is not supported.");
}

const conn = await network.connect({ network: "elysiumTestnet" });
const { ethers } = conn;
const net = await ethers.provider.getNetwork();
if (net.chainId !== 99801n) throw new Error(`Expected Kinetiq Elysium TESTNET 99801, got ${net.chainId}`);

function explicitRole(name) {
  const raw = process.env[name];
  if (!raw || !ethers.isAddress(raw) || raw === ethers.ZeroAddress)
    throw new Error(`Explicit nonzero ${name} is required; never default the operator or oracle to deployer.`);
  return ethers.getAddress(raw);
}

const signer = explicitRole("OPERATOR_SIGNER");
const oracle = explicitRole("ANTIBOT_ORACLE");
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No testnet deployer key configured");
const F = await ethers.getContractFactory("NativeHypePokerEscrow");
const escrow = await F.deploy(signer, oracle);
await escrow.waitForDeployment();
const address = await escrow.getAddress();
const code = await ethers.provider.getCode(address);
if (!code || code === "0x") throw new Error("Deployment returned no EVM bytecode");

const chainId = Number(net.chainId);
const manifest = {
  network: "elysiumTestnet",
  chainId,
  currency: "test HYPE (native, non-redeemable)",
  assetMode: "NATIVE_HYPE_TEST_ONLY",
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  operatorSigner: signer,
  verificationOracle: oracle,
  contracts: { NativeHypePokerEscrow: address },
  readiness: "NOT_LICENSED_NOT_A_PUBLIC_GAMBLING_LAUNCH",
};
mkdirSync(resolve("deployments"), { recursive: true });
writeFileSync(resolve("deployments/elysiumTestnet.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
console.log("Set NEXT_PUBLIC_ELYSIUM_HYPE_ESCROW to the deployed address ONLY on an isolated testnet build.");
