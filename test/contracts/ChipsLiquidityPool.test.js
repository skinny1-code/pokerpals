import { expect } from "chai";
import { network } from "hardhat";
import { parseUnits } from "ethers";

describe("ChipsLiquidityPool", () => {
  let ethers;
  let token, mockUsdc, stablePool, liqPool;
  let owner, player;

  // Rate: 1000 USDC-wei per 1e18 SALOON = $0.001/CHIP
  const RATE = 1000n;
  const CHIPS_FLOAT = parseUnits("500000000", 18); // 500M SALOON

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, player] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();

    const StablePool = await ethers.getContractFactory("StablecoinPool");
    stablePool = await StablePool.deploy(await mockUsdc.getAddress());

    const LiqPool = await ethers.getContractFactory("ChipsLiquidityPool");
    liqPool = await LiqPool.deploy(
      await token.getAddress(),
      await mockUsdc.getAddress(),
      await stablePool.getAddress(),
      RATE
    );

    // Authorize liqPool in stablePool
    await stablePool.setAuthorized(await liqPool.getAddress(), true);

    // Seed liqPool with SALOON float
    await token.transfer(await liqPool.getAddress(), CHIPS_FLOAT);

    // Seed stablePool with USDC (so redemptions can pay out)
    await mockUsdc.mint(owner.address, 1_000_000n * 1_000_000n);
    await mockUsdc.approve(await stablePool.getAddress(), 1_000_000n * 1_000_000n);
    await stablePool.deposit(1_000_000n * 1_000_000n);

    // Give player USDC to buy SALOON
    await mockUsdc.mint(player.address, 1_000n * 1_000_000n); // 1,000 USDC
  });

  it("buyChips: player receives correct SALOON for USDC", async () => {
    // Buy 100 USDC worth: 100 USDC = 100 * 1e6 USDC-wei → 100 * 1e6 * 1e18 / 1000 = 1e23 = 100,000 SALOON
    const usdcIn   = 100n * 1_000_000n; // 100 USDC
    const liqAddr  = await liqPool.getAddress();
    await mockUsdc.connect(player).approve(liqAddr, usdcIn);

    const chipsBefore = await token.balanceOf(player.address);
    await liqPool.connect(player).buyChips(usdcIn);
    const chipsAfter  = await token.balanceOf(player.address);

    const expectedChips = (usdcIn * parseUnits("1", 18)) / RATE;
    expect(chipsAfter - chipsBefore).to.equal(expectedChips);
  });

  it("buyChips: USDC lands in StablecoinPool, not LiquidityPool", async () => {
    const usdcIn = 100n * 1_000_000n;
    const liqAddr = await liqPool.getAddress();
    const stableAddr = await stablePool.getAddress();
    await mockUsdc.connect(player).approve(liqAddr, usdcIn);

    const liqUsdcBefore    = await mockUsdc.balanceOf(liqAddr);
    const stableUsdcBefore = await mockUsdc.balanceOf(stableAddr);
    await liqPool.connect(player).buyChips(usdcIn);

    expect(await mockUsdc.balanceOf(liqAddr)).to.equal(liqUsdcBefore);         // unchanged
    expect(await mockUsdc.balanceOf(stableAddr) - stableUsdcBefore).to.equal(usdcIn);
  });

  it("redeemChips: player receives correct USDC for SALOON", async () => {
    // Give player some SALOON first via buyChips
    const usdcIn = 100n * 1_000_000n;
    const liqAddr = await liqPool.getAddress();
    await mockUsdc.connect(player).approve(liqAddr, usdcIn);
    await liqPool.connect(player).buyChips(usdcIn);

    // Now redeem 1000 SALOON
    const chipsToRedeem = parseUnits("1000", 18);
    await token.connect(player).approve(liqAddr, chipsToRedeem);

    const usdcBefore = await mockUsdc.balanceOf(player.address);
    await liqPool.connect(player).redeemChips(chipsToRedeem);
    const usdcAfter  = await mockUsdc.balanceOf(player.address);

    const expectedUsdc = (chipsToRedeem * RATE) / parseUnits("1", 18);
    expect(usdcAfter - usdcBefore).to.equal(expectedUsdc);
  });

  it("reverts when pool is paused", async () => {
    await liqPool.setPaused(true);
    await mockUsdc.connect(player).approve(await liqPool.getAddress(), 1_000_000n);
    let reverted = false;
    try { await liqPool.connect(player).buyChips(1_000_000n); } catch { reverted = true; }
    expect(reverted).to.equal(true);
  });

  it("owner can change rate within the per-update cap", async () => {
    await liqPool.setRate(1100n); // +10% — exactly the cap
    expect(await liqPool.rateUsdcPerChip()).to.equal(1100n);
  });

  it("setRate: rejects a move larger than 10%", async () => {
    let up = false, down = false;
    try { await liqPool.setRate(2000n); } catch { up = true; }      // +100%
    try { await liqPool.setRate(500n);  } catch { down = true; }    // -50%
    expect(up).to.equal(true);
    expect(down).to.equal(true);
    expect(await liqPool.rateUsdcPerChip()).to.equal(RATE);
  });

  it("setRate: rejects a second move inside the cooldown", async () => {
    await liqPool.setRate(1100n);
    let reverted = false;
    try { await liqPool.setRate(1200n); } catch { reverted = true; }
    expect(reverted).to.equal(true);
    expect(await liqPool.rateUsdcPerChip()).to.equal(1100n);
  });

  it("setRate: allows the next step once the cooldown elapses", async () => {
    await liqPool.setRate(1100n);
    await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await liqPool.setRate(1210n); // +10% again
    expect(await liqPool.rateUsdcPerChip()).to.equal(1210n);
  });

  it("setRate: an owner cannot inflate the peg to drain the USDC reserve", async () => {
    // The drain the bound exists to stop: buy in at the real peg, raise the peg
    // to something absurd, then redeem a sliver of SALOON for the whole reserve.
    // authorizedPayout is exempt from StablecoinPool's redemption floor, so this
    // was a one-transaction rug before the cap.
    const usdcIn = 1000n * 1_000_000n; // $1,000
    await mockUsdc.mint(player.address, usdcIn);
    await mockUsdc.connect(player).approve(await liqPool.getAddress(), usdcIn);
    const reserveBefore = await mockUsdc.balanceOf(await stablePool.getAddress());
    await liqPool.connect(player).buyChips(usdcIn);

    let reverted = false;
    try { await liqPool.setRate(RATE * 1_000_000n); } catch { reverted = true; }
    expect(reverted).to.equal(true);

    // Reserve still holds everything the player paid in, and the peg stands.
    expect(await mockUsdc.balanceOf(await stablePool.getAddress()))
      .to.equal(reserveBefore + usdcIn);
    expect(await liqPool.rateUsdcPerChip()).to.equal(RATE);
  });

  it("quote helpers return consistent values", async () => {
    const usdcIn = 500n * 1_000_000n;
    const chipsOut = await liqPool.quoteChipsOut(usdcIn);
    const usdcBack = await liqPool.quoteUsdcOut(chipsOut);
    // Allow 1 wei rounding
    expect(usdcBack >= usdcIn - 1n).to.equal(true);
  });
});
