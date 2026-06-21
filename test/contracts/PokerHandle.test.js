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

describe("PokerHandle", () => {
  let ethers;
  let token, escrow, handle;
  let owner, player1, operator;
  const MINT_COST = parseUnits("5000", 18); // tier 0 cost

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, player1, operator] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const Staking = await ethers.getContractFactory("ChipsStaking");
    const staking = await Staking.deploy(await token.getAddress());

    const Referral = await ethers.getContractFactory("ReferralRegistry");
    const referral = await Referral.deploy(await token.getAddress());

    const Escrow = await ethers.getContractFactory("PokerEscrow");
    escrow = await Escrow.deploy(
      await token.getAddress(),
      operator.address,
      owner.address,
      owner.address,
      await staking.getAddress(),
      await referral.getAddress()
    );

    const Handle = await ethers.getContractFactory("PokerHandle");
    handle = await Handle.deploy(await token.getAddress(), await escrow.getAddress());

    await token.transfer(player1.address, parseUnits("10000", 18));
    await token.connect(player1).approve(await handle.getAddress(), MINT_COST);
  });

  it("rejects mintHandle from an unverified wallet", async () => {
    await expectReverted(handle.connect(player1).mintHandle("Shark_99"));
  });

  it("allows mintHandle once the escrow marks the wallet human-verified", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    expect(await handle.getHandleByAddress(player1.address)).to.equal("Shark_99");
  });

  it("lets the owner reserveHandle for a wallet regardless of verification status", async () => {
    // Used by the migration replay in scripts/deployHandle.js — must not require humanVerified.
    await handle.reserveHandle("Genesis_Player", player1.address);
    expect(await handle.getHandleByAddress(player1.address)).to.equal("Genesis_Player");
  });
});
