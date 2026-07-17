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

describe("ProfitSplitter", () => {
  let ethers;
  let token, staking, splitter;
  let owner, payout, rando;

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, payout, rando] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const Staking = await ethers.getContractFactory("ChipsStaking");
    staking = await Staking.deploy(await token.getAddress());

    const Splitter = await ethers.getContractFactory("ProfitSplitter");
    splitter = await Splitter.deploy(
      await token.getAddress(),
      await staking.getAddress(),
      payout.address
    );
  });

  it("distribute() splits 50/50: half to payout wallet, half staked", async () => {
    await token.transfer(await splitter.getAddress(), parseUnits("10000", 18));
    await splitter.connect(rando).distribute(); // anyone can trigger

    expect(await token.balanceOf(payout.address)).to.equal(parseUnits("5000", 18));
    const [stakedAmount] = await staking.getStakeInfo(await splitter.getAddress());
    expect(stakedAmount).to.equal(parseUnits("5000", 18));
    expect(await token.balanceOf(await splitter.getAddress())).to.equal(0n);
  });

  it("distribute() reverts when there is nothing to split", async () => {
    await expectReverted(splitter.distribute());
  });

  it("successive distributions accumulate the stake", async () => {
    await token.transfer(await splitter.getAddress(), parseUnits("1000", 18));
    await splitter.distribute();
    await token.transfer(await splitter.getAddress(), parseUnits("3000", 18));
    await splitter.distribute();

    expect(await token.balanceOf(payout.address)).to.equal(parseUnits("2000", 18));
    const [stakedAmount] = await staking.getStakeInfo(await splitter.getAddress());
    expect(stakedAmount).to.equal(parseUnits("2000", 18));
  });

  it("payoutBps is owner-tunable and respected", async () => {
    await splitter.setPayoutBps(8000);
    await token.transfer(await splitter.getAddress(), parseUnits("10000", 18));
    await splitter.distribute();

    expect(await token.balanceOf(payout.address)).to.equal(parseUnits("8000", 18));
    const [stakedAmount] = await staking.getStakeInfo(await splitter.getAddress());
    expect(stakedAmount).to.equal(parseUnits("2000", 18));
  });

  it("only owner can change payout wallet, bps, or unstake", async () => {
    await expectReverted(splitter.connect(rando).setPayoutWallet(rando.address));
    await expectReverted(splitter.connect(rando).setPayoutBps(1));
    await expectReverted(splitter.connect(rando).unstakeToPayout(1));
    await expectReverted(splitter.setPayoutBps(10001));
  });

  it("claimDevVest() pulls vested CHIPS into the splitter for distribution", async () => {
    await token.setDevWallet(await splitter.getAddress());

    // advance one vesting month (30 days)
    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    await splitter.connect(rando).claimDevVest();
    const bal = await token.balanceOf(await splitter.getAddress());
    expect(bal).to.equal(parseUnits("2000000", 18)); // 2M/month

    await splitter.distribute();
    expect(await token.balanceOf(payout.address)).to.equal(parseUnits("1000000", 18));
  });

  it("unstakeToPayout() returns principal to the payout wallet after the lock", async () => {
    await token.transfer(await splitter.getAddress(), parseUnits("10000", 18));
    await splitter.distribute();

    // still locked → reverts
    await expectReverted(splitter.unstakeToPayout(parseUnits("5000", 18)));

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await splitter.unstakeToPayout(parseUnits("5000", 18));
    // 5000 direct from the first distribute + 5000 unstaked principal
    expect(await token.balanceOf(payout.address)).to.equal(parseUnits("10000", 18));
    const [stakedAmount] = await staking.getStakeInfo(await splitter.getAddress());
    expect(stakedAmount).to.equal(0n);
  });

  it("works end-to-end as PokerEscrow rakeRecipient", async () => {
    // Point a real escrow's treasury rake at the splitter and confirm CHIPS
    // arriving there can be distributed.
    const Referral = await ethers.getContractFactory("ReferralRegistry");
    const referral = await Referral.deploy(await token.getAddress());
    const Escrow = await ethers.getContractFactory("PokerEscrow");
    const escrow = await Escrow.deploy(
      await token.getAddress(), owner.address, owner.address, owner.address,
      await staking.getAddress(), await referral.getAddress()
    );
    await escrow.setRakeRecipient(await splitter.getAddress());
    expect(await escrow.rakeRecipient()).to.equal(await splitter.getAddress());

    // Simulate rake arriving (escrow pays rakeRecipient by ERC-20 transfer)
    await token.transfer(await splitter.getAddress(), parseUnits("500", 18));
    await splitter.distribute();
    expect(await token.balanceOf(payout.address)).to.equal(parseUnits("250", 18));
  });

  it("sweep() rejects CHIPS but rescues other tokens", async () => {
    const Usdc = await ethers.getContractFactory("MockUSDC");
    const usdc = await Usdc.deploy();
    await usdc.mint(await splitter.getAddress(), 1_000_000n);

    await expectReverted(splitter.sweep(await token.getAddress(), payout.address));
    await splitter.sweep(await usdc.getAddress(), payout.address);
    expect(await usdc.balanceOf(payout.address)).to.equal(1_000_000n);
  });
});
