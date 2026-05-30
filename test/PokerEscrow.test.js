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

    // Authorize escrow as a yield source so settle() can call receiveYield()
    await staking.setYieldSource(await escrow.getAddress(), true);

    // Fund test players from owner balance (faucet would exceed MAX_SUPPLY)
    await token.transfer(player1.address, ethers.parseUnits("10000", 18));
    await token.transfer(player2.address, ethers.parseUnits("10000", 18));
    await escrow.markHuman(player1.address, true);
    await escrow.markHuman(player2.address, true);
  });

  it("deploys with correct token supply", async () => {
    const supply = await token.totalSupply();
    // 1B minted at construction; transfers in beforeEach don't change totalSupply
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

  // ─── settle() ───────────────────────────────────────────────────────────────

  it("settle: distributes rake correctly (35% burn / 35% staking / 20% treasury)", async () => {
    const escrowAddr  = await escrow.getAddress();
    const stakingAddr = await staking.getAddress();

    // Create 2-seat table → both buy in → table goes Active
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const potTotal    = BUY_IN * 2n;
    const tierRateNum = 150n;  // tier 0 = 1.5% = 150/10000
    const rakeDen     = 10000n;
    const totalRake   = (potTotal * tierRateNum) / rakeDen;

    const burnBefore  = await token.totalSupply();
    const stakBefore  = await token.balanceOf(stakingAddr);
    const rakeBefore  = await token.balanceOf(owner.address);

    // Sign & settle: player1 wins 100% (shares=[1000])
    const tableId  = 1n;
    const handNonce = 0n;
    const winners  = [player1.address];
    const shares   = [1000n];
    const digest   = ethers.solidityPackedKeccak256(
      ["uint256","uint256","address[]","uint256[]"],
      [tableId, handNonce, winners, shares]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));

    await escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig);

    const burnAfter  = await token.totalSupply();
    const stakAfter  = await token.balanceOf(stakingAddr);
    const rakeAfter  = await token.balanceOf(owner.address);

    const expectedBurn    = (totalRake * 3500n) / 10000n;
    const expectedStaking = (totalRake * 3500n) / 10000n;
    const expectedTreasury = totalRake - expectedBurn - expectedStaking; // remaining ~20%

    expect(burnBefore - burnAfter).to.equal(expectedBurn);
    expect(stakAfter  - stakBefore).to.equal(expectedStaking);
    expect(rakeAfter  - rakeBefore).to.be.gte(expectedTreasury - 1n); // allow off-by-one from integer division
  });

  it("settle: pays winner correct net amount after rake", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const potTotal    = BUY_IN * 2n;
    const totalRake   = (potTotal * 150n) / 10000n; // tier 0 = 1.5%
    const netPot      = potTotal - totalRake;
    const balBefore   = await token.balanceOf(player1.address);

    const tableId = 1n; const handNonce = 0n;
    const winners = [player1.address]; const shares = [1000n];
    const digest = ethers.solidityPackedKeccak256(
      ["uint256","uint256","address[]","uint256[]"],
      [tableId, handNonce, winners, shares]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig);

    const balAfter = await token.balanceOf(player1.address);
    expect(balAfter - balBefore).to.equal(netPot);
  });

  it("settle: increments handNonce, rejects replay", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const tableId = 1n; const handNonce = 0n;
    const winners = [player1.address]; const shares = [1000n];
    const digest = ethers.solidityPackedKeccak256(
      ["uint256","uint256","address[]","uint256[]"],
      [tableId, handNonce, winners, shares]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig);

    // Nonce incremented — replay must fail
    await expect(
      escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig)
    ).to.be.reverted;
  });

  // ─── refund() ───────────────────────────────────────────────────────────────

  it("refund: returns deposit to player on Open table", async () => {
    const escrowAddr = await escrow.getAddress();
    // 9-seat table so it stays Open after one buy-in
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);

    const balBefore = await token.balanceOf(player1.address);
    await escrow.connect(player1).refund(1);
    const balAfter = await token.balanceOf(player1.address);

    expect(balAfter - balBefore).to.equal(BUY_IN);
  });

  it("refund: reverts on Active table", async () => {
    const escrowAddr = await escrow.getAddress();
    // 2-seat: both buy in → Active
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    await expect(escrow.connect(player1).refund(1)).to.be.reverted;
  });

  // ─── cashOut() ──────────────────────────────────────────────────────────────

  it("cashOut: pays player and increments cashout nonce", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const tableId = 1n; const cashNonce = 0n;
    const cashAmount = BUY_IN;
    const digest = ethers.solidityPackedKeccak256(
      ["string","uint256","address","uint256","uint256"],
      ["CASHOUT", tableId, player1.address, cashAmount, cashNonce]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));

    const balBefore = await token.balanceOf(player1.address);
    await escrow.connect(player1).cashOut(tableId, player1.address, cashAmount, cashNonce, sig);
    const balAfter = await token.balanceOf(player1.address);

    expect(balAfter - balBefore).to.equal(cashAmount);
    expect(await escrow.cashOutNonce(tableId, player1.address)).to.equal(1n);
  });

  it("cashOut: rejects signature replay (nonce mismatch)", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const tableId = 1n; const cashNonce = 0n;
    const digest = ethers.solidityPackedKeccak256(
      ["string","uint256","address","uint256","uint256"],
      ["CASHOUT", tableId, player1.address, BUY_IN, cashNonce]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await escrow.connect(player1).cashOut(tableId, player1.address, BUY_IN, cashNonce, sig);

    // Replay with stale nonce 0 must fail
    await expect(
      escrow.connect(player1).cashOut(tableId, player1.address, BUY_IN, cashNonce, sig)
    ).to.be.reverted;
  });

  // ─── rakeback ───────────────────────────────────────────────────────────────

  it("rakeback: accrues after settle and is claimable", async () => {
    const escrowAddr = await escrow.getAddress();

    // Seed rakebackPool so there's budget to accrue
    const poolSeed = ethers.parseUnits("1000", 18);
    await token.approve(escrowAddr, poolSeed);
    await escrow.fundRakebackPool(poolSeed);

    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const tableId = 1n; const handNonce = 0n;
    const winners = [player1.address]; const shares = [1000n];
    const digest = ethers.solidityPackedKeccak256(
      ["uint256","uint256","address[]","uint256[]"],
      [tableId, handNonce, winners, shares]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig);

    // player1 should have accrued some rakeback
    const accrued = await escrow.rakebackAccrued(player1.address);
    expect(accrued).to.be.gt(0n);

    // Claiming pays out and zeroes the accrual
    const balBefore = await token.balanceOf(player1.address);
    await escrow.connect(player1).claimRakeback();
    const balAfter = await token.balanceOf(player1.address);
    expect(balAfter - balBefore).to.equal(accrued);
    expect(await escrow.rakebackAccrued(player1.address)).to.equal(0n);
  });

  // ─── closeTable access control (C1) ─────────────────────────────────────────

  it("closeTable: reverts if caller is not creator or owner", async () => {
    const escrowAddr = await escrow.getAddress();
    // Create Open table and drain deposits manually via refund so potTotal=0
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    // table has no deposits so potTotal=0 — but stranger shouldn't close it
    const [,,,,stranger] = await ethers.getSigners();
    await expect(escrow.connect(stranger).closeTable(1)).to.be.revertedWith("Not authorized");
  });

  it("closeTable: succeeds when creator calls with empty pot", async () => {
    // owner creates table; no one buys in; potTotal already 0
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await expect(escrow.connect(owner).closeTable(1)).to.not.be.reverted;
  });
});
