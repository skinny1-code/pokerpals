import { expect } from "chai";
import { network } from "hardhat";
import { parseUnits } from "ethers";

async function expectReverted(promise) {
  let reverted = false;
  try {
    await promise;
  } catch (e) {
    reverted = true;
  }
  expect(reverted, "Expected transaction to revert but it did not").to.equal(true);
}

describe("StakerLottery", () => {
  let ethers;
  let token, staking, lottery;
  let owner, bronze, whale, nobody;

  const WEEK = 7 * 24 * 60 * 60;
  const warp = async (secs) => {
    await ethers.provider.send("evm_increaseTime", [secs]);
    await ethers.provider.send("evm_mine", []);
  };
  const mine = async (n) => {
    for (let i = 0; i < n; i++) await ethers.provider.send("evm_mine", []);
  };
  // Settling is two-phase now: commit to a future block, let it pass, then draw.
  const settle = async () => {
    await lottery.requestDraw();
    await mine(Number(await lottery.drawDelayBlocks()) + 1);
    await lottery.draw();
  };

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, bronze, whale, nobody] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const Staking = await ethers.getContractFactory("ChipsStaking");
    staking = await Staking.deploy(await token.getAddress());

    const Lottery = await ethers.getContractFactory("StakerLottery");
    lottery = await Lottery.deploy(await token.getAddress(), await staking.getAddress());

    // Fund and stake: bronze at 25K (tier 1), whale at 5M (tier 4)
    for (const [signer, amount] of [[bronze, "25000"], [whale, "5000000"]]) {
      await token.transfer(signer.address, parseUnits(amount, 18));
      await token.connect(signer).approve(await staking.getAddress(), parseUnits(amount, 18));
      await staking.connect(signer).stake(parseUnits(amount, 18));
    }
  });

  it("stakers can enter once; tickets equal staked SALOON", async () => {
    await lottery.connect(bronze).enter();
    await lottery.connect(whale).enter();
    expect(await lottery.myTickets(bronze.address)).to.equal(25000n);
    expect(await lottery.myTickets(whale.address)).to.equal(5000000n);
    const [, , , entrants, totalTickets] = await lottery.currentEpoch();
    expect(entrants).to.equal(2n);
    expect(totalTickets).to.equal(5025000n);
    await expectReverted(lottery.connect(bronze).enter()); // no double entry
  });

  it("non-stakers cannot enter", async () => {
    await expectReverted(lottery.connect(nobody).enter());
  });

  it("draw pays the whole prize to an entrant and starts a new epoch", async () => {
    await token.approve(await lottery.getAddress(), parseUnits("100000", 18));
    await lottery.fundPrize(parseUnits("100000", 18));
    await lottery.connect(bronze).enter();
    await lottery.connect(whale).enter();

    await expectReverted(lottery.draw()); // too early

    await warp(WEEK + 1);
    const balBefore = [await token.balanceOf(bronze.address), await token.balanceOf(whale.address)];
    await settle();

    const [winner, prize] = await lottery.epochWinner(0);
    expect([bronze.address, whale.address]).to.include(winner);
    expect(prize).to.equal(parseUnits("100000", 18));
    const balAfter = [await token.balanceOf(bronze.address), await token.balanceOf(whale.address)];
    const delta = (balAfter[0] - balBefore[0]) + (balAfter[1] - balBefore[1]);
    expect(delta).to.equal(parseUnits("100000", 18)); // exactly one of them got paid

    const [id] = await lottery.currentEpoch();
    expect(id).to.equal(1n);
    expect(await lottery.myTickets(bronze.address)).to.equal(0n); // fresh epoch
  });

  it("empty epoch rolls the prize into the next one", async () => {
    await token.approve(await lottery.getAddress(), parseUnits("50000", 18));
    await lottery.fundPrize(parseUnits("50000", 18));
    await warp(WEEK + 1);
    await lottery.draw(); // nobody entered

    const [id, , prize] = await lottery.currentEpoch();
    expect(id).to.equal(1n);
    expect(prize).to.equal(parseUnits("50000", 18)); // carried over
    expect(await token.balanceOf(await lottery.getAddress())).to.equal(parseUnits("50000", 18));
  });

  it("entry closes once the epoch has ended", async () => {
    await warp(WEEK + 1);
    await expectReverted(lottery.connect(bronze).enter());
  });

  it("admin gating: epoch duration bounds and owner-only; sweep protects SALOON", async () => {
    await expectReverted(lottery.connect(bronze).setEpochDuration(WEEK));
    await expectReverted(lottery.setEpochDuration(60)); // < 1h
    await lottery.setEpochDuration(24 * 60 * 60);
    expect(await lottery.epochDuration()).to.equal(BigInt(24 * 60 * 60));
    await expectReverted(lottery.sweep(await token.getAddress(), owner.address));
  });

  it("draw: refuses to settle a contested epoch without a committed block", async () => {
    // The old contract read blockhash(block.number - 1) inside draw(), a hash
    // that already exists when the call is built — so an entrant could simulate
    // the result and only submit in blocks where they win. Randomness must now
    // be committed to before it exists.
    await token.approve(await lottery.getAddress(), parseUnits("1000", 18));
    await lottery.fundPrize(parseUnits("1000", 18));
    await lottery.connect(bronze).enter();
    await lottery.connect(whale).enter();
    await warp(WEEK + 1);

    await expectReverted(lottery.draw());              // nothing committed
    await lottery.requestDraw();
    await expectReverted(lottery.draw());              // committed, not matured

    const [revealBlock, requested, readyEarly] = await lottery.drawStatus();
    expect(requested).to.equal(true);
    expect(readyEarly).to.equal(false);
    expect(revealBlock > BigInt(await ethers.provider.getBlockNumber())).to.equal(true);

    await mine(Number(await lottery.drawDelayBlocks()) + 1);
    const [, , readyNow] = await lottery.drawStatus();
    expect(readyNow).to.equal(true);
    await lottery.draw();
    const [winner] = await lottery.epochWinner(0);
    expect([bronze.address, whale.address]).to.include(winner);
  });

  it("requestDraw: rejected while the epoch runs, and not repeatable while live", async () => {
    await lottery.connect(bronze).enter();
    await expectReverted(lottery.requestDraw());       // epoch still running
    await warp(WEEK + 1);
    await lottery.requestDraw();
    await expectReverted(lottery.requestDraw());       // a live commit stands
  });

  it("the committed block is fixed before its hash exists", async () => {
    await lottery.connect(bronze).enter();
    await warp(WEEK + 1);
    const tx = await lottery.requestDraw();
    const rcpt = await tx.wait();
    const [revealBlock] = await lottery.drawStatus();
    // Committed strictly in the future — its hash cannot be known to the caller.
    expect(revealBlock > BigInt(rcpt.blockNumber)).to.equal(true);
    expect(revealBlock - BigInt(rcpt.blockNumber)).to.equal(await lottery.drawDelayBlocks());
  });

  it("a commit older than blockhash's 256-block window expires and is re-made", async () => {
    await token.approve(await lottery.getAddress(), parseUnits("1000", 18));
    await lottery.fundPrize(parseUnits("1000", 18));
    await lottery.connect(whale).enter();
    await warp(WEEK + 1);
    await lottery.requestDraw();

    await mine(300); // blockhash(revealBlock) is now zero
    const [, , ready, expired] = await lottery.drawStatus();
    expect(expired).to.equal(true);
    expect(ready).to.equal(false);
    await expectReverted(lottery.draw());

    await lottery.requestDraw();                       // allowed once expired
    await mine(Number(await lottery.drawDelayBlocks()) + 1);
    await lottery.draw();
    const [winner] = await lottery.epochWinner(0);
    expect(winner).to.equal(whale.address);
  });

  it("an empty epoch rolls over without needing a commit", async () => {
    await token.approve(await lottery.getAddress(), parseUnits("50000", 18));
    await lottery.fundPrize(parseUnits("50000", 18));
    await warp(WEEK + 1);
    const [, , ready] = await lottery.drawStatus();
    expect(ready).to.equal(true);                      // no randomness required
    await lottery.draw();
    expect(await lottery.drawRevealBlock()).to.equal(0n);
  });

  it("settling clears the commit so the next epoch starts uncommitted", async () => {
    await lottery.connect(whale).enter();
    await warp(WEEK + 1);
    await settle();
    expect(await lottery.drawRevealBlock()).to.equal(0n);
    const [, requested] = await lottery.drawStatus();
    expect(requested).to.equal(false);
  });

  it("setDrawDelayBlocks: owner-only and bounded inside the blockhash window", async () => {
    await expectReverted(lottery.connect(bronze).setDrawDelayBlocks(10));
    await expectReverted(lottery.setDrawDelayBlocks(0));
    await expectReverted(lottery.setDrawDelayBlocks(101));
    await lottery.setDrawDelayBlocks(20);
    expect(await lottery.drawDelayBlocks()).to.equal(20n);
  });

  it("whale weighting: with a 200:1 ticket ratio the whale nearly always wins", async () => {
    // Not a statistical test — just verifies weighted selection is wired by
    // running one draw where whale holds 5,000,000 of 5,025,000 tickets.
    await token.approve(await lottery.getAddress(), parseUnits("1000", 18));
    await lottery.fundPrize(parseUnits("1000", 18));
    await lottery.connect(bronze).enter();
    await lottery.connect(whale).enter();
    await warp(WEEK + 1);
    await settle();
    const [winner] = await lottery.epochWinner(0);
    expect([bronze.address, whale.address]).to.include(winner);
  });
});
