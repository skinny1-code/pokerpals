// scripts/deploy.js — deploys all PokerVsPals contracts in order
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

  // 1. ChipsToken
  //    Mints: 10% dev (vested in-contract), 20% community, 50% liquidity,
  //    20% staking pool to deployer (transferred to staking contract in step 6).
  const Token = await ethers.getContractFactory("ChipsToken");
  const token = await Token.deploy(DEV, COMMUNITY, LIQUIDITY);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("✅ ChipsToken:", tokenAddr);

  // 2. ChipsStaking
  const Staking = await ethers.getContractFactory("ChipsStaking");
  const staking = await Staking.deploy(tokenAddr);
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();
  console.log("✅ ChipsStaking:", stakingAddr);

  // 3. ReferralRegistry
  const Referral = await ethers.getContractFactory("ReferralRegistry");
  const referral = await Referral.deploy(tokenAddr);
  await referral.waitForDeployment();
  const referralAddr = await referral.getAddress();
  console.log("✅ ReferralRegistry:", referralAddr);

  // 4. PokerEscrow
  const Escrow = await ethers.getContractFactory("PokerEscrow");
  const escrow = await Escrow.deploy(
    tokenAddr, OPERATOR, RAKE_ADDR, ORACLE, stakingAddr, referralAddr
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✅ PokerEscrow:", escrowAddr);

  // 5. TournamentManager (now includes staking address for auto yield)
  const Tourn = await ethers.getContractFactory("TournamentManager");
  const tourn = await Tourn.deploy(tokenAddr, OPERATOR, RAKE_ADDR, ORACLE, stakingAddr);
  await tourn.waitForDeployment();
  const tournAddr = await tourn.getAddress();
  console.log("✅ TournamentManager:", tournAddr);

  // 6. Seed staking yield pool: transfer 200M CHIPS (deployer received at mint) → staking
  const STAKING_POOL = ethers.parseUnits("200000000", 18);
  await token.transfer(stakingAddr, STAKING_POOL);
  await staking.initYieldPool();
  console.log("✅ Staking yield pool seeded with 200M CHIPS");

  // 7. Authorize escrow + tournament as yield sources (so they can push rake yield)
  await staking.setYieldSource(escrowAddr, true);
  await staking.setYieldSource(tournAddr, true);
  console.log("✅ Yield sources authorized (escrow + tournament)");

  // 8. Authorize escrow + tournament to call ReferralRegistry.creditRake
  await referral.setAuthorized(escrowAddr, true);
  await referral.setAuthorized(tournAddr, true);
  console.log("✅ Referral registry authorized");

  // 9. Wire token → escrow factory
  await token.setEscrowFactory(escrowAddr);
  console.log("✅ Token wired to escrow");

  console.log("\n── Role wallets used in this deploy ──────────────────");
  console.log(`Deployer:          ${deployer.address}`);
  console.log(`Operator signer:   ${OPERATOR}`);
  console.log(`Rake recipient:    ${RAKE_ADDR}`);
  console.log(`Anti-bot oracle:   ${ORACLE}`);
  console.log(`Dev wallet:        ${DEV}`);
  console.log(`Community wallet:  ${COMMUNITY}`);
  console.log(`Liquidity wallet:  ${LIQUIDITY}`);
  console.log("\n── Token economy ─────────────────────────────────────");
  console.log("  10% Dev       — 100M CHIPS, vested linearly over 24 months");
  console.log("  20% Staking   — 200M CHIPS, seeded into yield pool");
  console.log("  20% Community — 200M CHIPS → community wallet");
  console.log("  50% Liquidity — 500M CHIPS → liquidity wallet");
  console.log("\n── Rake split per hand ───────────────────────────────");
  console.log("  35% burned | 35% staking yield | 20% treasury | 10% referral");
  console.log("\n── Paste into .env ───────────────────────────────────");
  console.log(`NEXT_PUBLIC_CHIPS_TOKEN=${tokenAddr}`);
  console.log(`NEXT_PUBLIC_ESCROW=${escrowAddr}`);
  console.log(`NEXT_PUBLIC_STAKING=${stakingAddr}`);
  console.log(`NEXT_PUBLIC_REFERRAL=${referralAddr}`);
  console.log(`NEXT_PUBLIC_TOURNAMENT=${tournAddr}`);
  console.log(`NEXT_PUBLIC_CHAIN_ID=42161`);
  console.log("──────────────────────────────────────────────────────");
}

main().catch(e => { console.error(e); process.exit(1); });
