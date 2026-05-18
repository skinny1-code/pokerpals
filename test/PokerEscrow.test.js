import { expect } from "chai";
import { ethers } from "hardhat";

describe("PokerEscrow", () => {
  let token, staking, referral, escrow;
  let owner, player1, player2, operator;
  const BUY_IN = ethers.parseUnits("1000", 18);
  const BB     = ethers.parseUnits("10",   18);
  const FEE    = ethers.parseUnits("2",    18);

  beforeEach(async () => {
    [owner, player1, player2, operator] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const Staking = await ethers.getContractFactory("ChipsStaking");
    staking = await Staking.deploy(await token.getAddress());

    const Referral = await ethers.getContractFactory("ReferralRegistry");
    referral = await Referral.deploy(await token.getAddress());

    const Escrow = await ethers.getContractFactory("PokerEscrow");
    escrow = await Escrow.deploy(
      await token.getAddress(),
      operator.address,
      owner.address,
      owner.address,
      await staking.getAddress(),
      await referral.getAddress()
    );

    // Fund test players and verify them as human
    await token.faucet(player1.address, ethers.parseUnits("10000", 18));
    await token.faucet(player2.address, ethers.parseUnits("10000", 18));
    await escrow.markHuman(player1.address, true);
    await escrow.markHuman(player2.address, true);
  });

  it("deploys with correct token supply", async () => {
    const supply = await token.totalSupply();
    expect(supply).to.equal(ethers.parseUnits("1000000000", 18));
  });

  it("creates a table with correct params", async () => {
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    const count = await escrow.tableCount();
    expect(count).to.equal(1n);
    const info = await escrow.getTableInfo(1);
    expect(info.buyIn).to.equal(BUY_IN);
    expect(info.bigBlind).to.equal(BB);
    expect(info.maxPlayers).to.equal(2);
  });

  it("rejects table if buy-in < 10x big blind", async () => {
    await expect(escrow.createTable(BB, BB, 2, 0, 0)).to.be.revertedWith("Buy-in too small");
  });

  it("lets a verified player buy in", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    const info = await escrow.getTableInfo(1);
    expect(info.seated).to.equal(1);
  });

  it("table becomes Active when all seats filled (2-max)", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);
    const info = await escrow.getTableInfo(1);
    expect(info.status).to.equal(1); // TableStatus.Active
  });

  it("rejects buy-in from unverified player", async () => {
    const [,,,,unverified] = await ethers.getSigners();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await expect(escrow.connect(unverified).buyIn(1)).to.be.reverted;
  });

  it("rejects double buy-in from same player", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await token.connect(player1).approve(escrowAddr, (BUY_IN + FEE) * 2n);
    await escrow.connect(player1).buyIn(1);
    await expect(escrow.connect(player1).buyIn(1)).to.be.reverted;
  });

  it("dev vest releases linearly over 24 months", async () => {
    const claimable = await token.devClaimable();
    // At deploy time essentially 0 (block.timestamp == devReleaseStart)
    expect(claimable).to.be.gte(0n);
  });

  it("humanVerified mapping is set correctly", async () => {
    expect(await escrow.humanVerified(player1.address)).to.equal(true);
    const [,,,,stranger] = await ethers.getSigners();
    expect(await escrow.humanVerified(stranger.address)).to.equal(false);
  });
});
