import { expect } from "chai";
import { network } from "hardhat";

describe("StablecoinPool", () => {
  let ethers;
  let mockUsdc, stablePool;
  let owner, liqPool, rando;

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, liqPool, rando] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();

    const StablePool = await ethers.getContractFactory("StablecoinPool");
    stablePool = await StablePool.deploy(await mockUsdc.getAddress());

    // Mint USDC to owner and seed pool
    await mockUsdc.mint(owner.address, 1_000_000n * 1_000_000n); // 1M USDC (6 decimals)
    await mockUsdc.approve(await stablePool.getAddress(), 500_000n * 1_000_000n);
    await stablePool.deposit(500_000n * 1_000_000n);

    // Authorize liqPool
    await stablePool.setAuthorized(liqPool.address, true);
  });

  it("reports correct USDC balance", async () => {
    expect(await stablePool.balance()).to.equal(500_000n * 1_000_000n);
  });

  it("authorized caller can trigger notifyDeposit without reverting", async () => {
    await mockUsdc.mint(liqPool.address, 1_000n * 1_000_000n);
    await mockUsdc.connect(liqPool).transfer(await stablePool.getAddress(), 1_000n * 1_000_000n);
    let reverted = false;
    try { await stablePool.connect(liqPool).notifyDeposit(1_000n * 1_000_000n); } catch { reverted = true; }
    expect(reverted).to.equal(false);
  });

  it("unauthorized caller reverts on notifyDeposit", async () => {
    let reverted = false;
    try { await stablePool.connect(rando).notifyDeposit(1n); } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });

  it("authorized caller can trigger authorizedPayout", async () => {
    const before = await mockUsdc.balanceOf(rando.address);
    await stablePool.connect(liqPool).authorizedPayout(rando.address, 100n * 1_000_000n);
    expect(await mockUsdc.balanceOf(rando.address) - before).to.equal(100n * 1_000_000n);
  });

  it("payout reverts if insufficient USDC", async () => {
    let reverted = false;
    try {
      await stablePool.connect(liqPool).authorizedPayout(rando.address, 1_000_000n * 1_000_000n);
    } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });

  it("owner can withdraw USDC with note", async () => {
    const before = await mockUsdc.balanceOf(rando.address);
    await stablePool.withdraw(rando.address, 1_000n * 1_000_000n, "prize pool");
    expect(await mockUsdc.balanceOf(rando.address) - before).to.equal(1_000n * 1_000_000n);
  });

  it("non-owner cannot withdraw", async () => {
    let reverted = false;
    try { await stablePool.connect(rando).withdraw(rando.address, 1n, "hack"); } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });

  it("owner cannot withdraw below the redemption reserve (backing outstanding SALOON)", async () => {
    // Simulate SALOON sales: liqPool transfers player USDC in + notifyDeposit reserves it.
    await mockUsdc.mint(liqPool.address, 400_000n * 1_000_000n);
    await mockUsdc.connect(liqPool).transfer(await stablePool.getAddress(), 400_000n * 1_000_000n);
    await stablePool.connect(liqPool).notifyDeposit(400_000n * 1_000_000n);
    expect(await stablePool.reservedUsdc()).to.equal(400_000n * 1_000_000n);

    // Balance is 900k (500k owner seed + 400k reserved). Owner may take the 500k
    // surplus but not a cent of the 400k reserve.
    await stablePool.withdraw(owner.address, 500_000n * 1_000_000n, "surplus ok");
    let reverted = false;
    try { await stablePool.withdraw(owner.address, 1n, "would breach reserve"); } catch { reverted = true; }
    expect(reverted, "withdraw breaching the reserve must revert").to.equal(true);

    // A redemption releases reserve; then the owner can withdraw that much.
    await stablePool.connect(liqPool).authorizedPayout(rando.address, 100_000n * 1_000_000n);
    expect(await stablePool.reservedUsdc()).to.equal(300_000n * 1_000_000n);
  });
});
