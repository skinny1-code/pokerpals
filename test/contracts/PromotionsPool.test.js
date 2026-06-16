import { expect } from "chai";
import { network } from "hardhat";
import { parseUnits } from "ethers";

describe("PromotionsPool", () => {
  let ethers;
  let token, promoPool;
  let owner, rando;

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, rando] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const PromoPool = await ethers.getContractFactory("PromotionsPool");
    promoPool = await PromoPool.deploy(await token.getAddress());

    await token.transfer(await promoPool.getAddress(), parseUnits("100000000", 18));
  });

  it("reports correct balance", async () => {
    expect(await promoPool.balance()).to.equal(parseUnits("100000000", 18));
  });

  it("owner can withdraw with note", async () => {
    const before = await token.balanceOf(rando.address);
    await promoPool.withdraw(rando.address, parseUnits("10000", 18), "tournament prize");
    expect(await token.balanceOf(rando.address) - before).to.equal(parseUnits("10000", 18));
  });

  it("non-owner cannot withdraw", async () => {
    let reverted = false;
    try { await promoPool.connect(rando).withdraw(rando.address, 1n, "hack"); } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });

  it("owner can topUp pool", async () => {
    const before = await promoPool.balance();
    const top = parseUnits("1000", 18);
    await token.approve(await promoPool.getAddress(), top);
    await promoPool.topUp(top);
    expect(await promoPool.balance() - before).to.equal(top);
  });
});
