// scripts/deploy.js — deploys all PokerPartyPals contracts in order
// npx hardhat run scripts/deploy.js --network arbitrumSepolia
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const OPERATOR  = process.env.OPERATOR_SIGNER  || deployer.address;
  const RAKE_ADDR = process.env.RAKE_WALLET       || deployer.address;
  const ORACLE    = process.env.ANTIBOT_ORACLE    || deployer.address;
  const DEV       = process.env.DEV_WALLET        || deployer.address;
  const COMMUNITY = process.env.COMMUNITY_WALLET  || deployer.address;
  const LIQUIDITY = process.env.LIQUIDITY_WALLET  || deployer.address;

  // 1. PPPToken
  const Token = await ethers.getContractFactory("PPPToken");
  const token = await Token.deploy(DEV, COMMUNITY, LIQUIDITY);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("✅ PPPToken:", tokenAddr);

  // 2. PPPStaking
  const Staking = await ethers.getContractFactory("PPPStaking");
  const staking = await Staking.deploy(tokenAddr);
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();
  console.log("✅ PPPStaking:", stakingAddr);

  // 3. ReferralRegistry
  const Referral = await ethers.getContractFactory("ReferralRegistry");
  const referral = await Referral.deploy(tokenAddr);
  await referral.waitForDeployment();
  const referralAddr = await referral.getAddress();
  console.log("✅ ReferralRegistry:", referralAddr);

  // 4. PokerEscrow (v2 — with staking + referral wired in)
  const Escrow = await ethers.getContractFactory("PokerEscrow");
  const escrow = await Escrow.deploy(
    tokenAddr, OPERATOR, RAKE_ADDR, ORACLE, stakingAddr, referralAddr
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✅ PokerEscrow:", escrowAddr);

  // 5. TournamentManager
  const Tourn = await ethers.getContractFactory("TournamentManager");
  const tourn = await Tourn.deploy(tokenAddr, OPERATOR, RAKE_ADDR, ORACLE);
  await tourn.waitForDeployment();
  const tournAddr = await tourn.getAddress();
  console.log("✅ TournamentManager:", tournAddr);

  // 6. Wire: authorize Escrow + Tournament to call ReferralRegistry.creditRake
  await referral.setAuthorized(escrowAddr, true);
  await referral.setAuthorized(tournAddr, true);
  console.log("✅ Referral registry authorized");

  // 7. Wire: token → escrow factory
  await token.setEscrowFactory(escrowAddr);
  console.log("✅ Token wired to escrow");

  // 8. Seed staking yield pool from liquidity allocation (optional on testnet)
  // const seedAmount = ethers.parseUnits("100000", 18);
  // await token.connect(liquiditySigner).approve(stakingAddr, seedAmount);
  // await staking.connect(liquiditySigner).fundYieldPool(seedAmount);

  console.log("\n── Paste into .env ───────────────────────────────────");
  console.log(`NEXT_PUBLIC_PPP_TOKEN=${tokenAddr}`);
  console.log(`NEXT_PUBLIC_ESCROW=${escrowAddr}`);
  console.log(`NEXT_PUBLIC_STAKING=${stakingAddr}`);
  console.log(`NEXT_PUBLIC_REFERRAL=${referralAddr}`);
  console.log(`NEXT_PUBLIC_TOURNAMENT=${tournAddr}`);
  console.log(`NEXT_PUBLIC_CHAIN_ID=42161`);
  console.log("──────────────────────────────────────────────────────");
}

main().catch(e => { console.error(e); process.exit(1); });
