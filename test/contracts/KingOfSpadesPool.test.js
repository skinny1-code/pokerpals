import { expect } from "chai";
import { network } from "hardhat";
import { parseUnits } from "ethers";

describe("KingOfSpadesPool", () => {
  let ethers;
  let token, kingsPool;
  let owner, escrow, rando;

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, escrow, rando] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const KingsPool = await ethers.getContractFactory("KingOfSpadesPool");
    kingsPool = await KingsPool.deploy(await token.getAddress());

    // Seed pool with some SALOON to simulate OPS_RESERVE deposit
    await token.transfer(await kingsPool.getAddress(), parseUnits("100000000", 18));
  });

  it("returns correct balance via view", async () => {
    const bal = await kingsPool.balance();
    expect(bal).to.equal(parseUnits("100000000", 18));
  });

  it("authorized source can call receiveOps without reverting", async () => {
    await kingsPool.setAuthorized(escrow.address, true);
    let reverted = false;
    try { await kingsPool.connect(escrow).receiveOps(parseUnits("100", 18)); } catch { reverted = true; }
    expect(reverted).to.equal(false);
  });

  it("unauthorized caller reverts on receiveOps", async () => {
    let reverted = false;
    try { await kingsPool.connect(rando).receiveOps(parseUnits("1", 18)); } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });

  it("owner can withdraw with a note", async () => {
    const before = await token.balanceOf(rando.address);
    await kingsPool.withdraw(rando.address, parseUnits("500", 18), "server costs Q1");
    const after = await token.balanceOf(rando.address);
    expect(after - before).to.equal(parseUnits("500", 18));
  });

  it("non-owner cannot withdraw", async () => {
    let reverted = false;
    try { await kingsPool.connect(rando).withdraw(rando.address, 1n, "hack"); } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });

  it("setAuthorized toggles authorization", async () => {
    await kingsPool.setAuthorized(escrow.address, true);
    expect(await kingsPool.authorized(escrow.address)).to.equal(true);
    await kingsPool.setAuthorized(escrow.address, false);
    expect(await kingsPool.authorized(escrow.address)).to.equal(false);
  });
});
