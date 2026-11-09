import { expect } from "chai";
import { network } from "hardhat";

// Elysium-native HYPE escrow tests run entirely on a simulated chain.
// No bridge, faucet, wallet credentials or real HYPE involved.
async function revert(promise) {
  let didRevert = false;
  try { await promise; } catch { didRevert = true; }
  expect(didRevert, "Expected revert").to.equal(true);
}

describe("NativeHypePokerEscrow (local simulated HYPE)", () => {
  let ethers, escrow, owner, alice, bob, operator, oracle, outsider;
  let BUY, BLIND;
  const delay = 24 * 60 * 60 + 1;

  async function createAndSeat() {
    await escrow.connect(alice).createTable(BUY, BLIND, 2, 0, 0);
    await escrow.connect(alice).buyIn(1, { value: BUY });
    await escrow.connect(bob).buyIn(1, { value: BUY });
  }

  async function signSettlement(tableId, nonce, players, nextBalances, signer = operator) {
    const { chainId } = await ethers.provider.getNetwork();
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint256", "address", "uint256", "uint256", "address[]", "uint256[]"],
        ["HYPE_SETTLE_V1", chainId, await escrow.getAddress(), tableId, nonce, players, nextBalances]
      )
    );
    return signer.signMessage(ethers.getBytes(digest));
  }

  async function signCashOut(tableId, player, amount, nonce, signer = operator) {
    const { chainId } = await ethers.provider.getNetwork();
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint256", "address", "uint256", "address", "uint256", "uint256"],
        ["HYPE_CASHOUT_V1", chainId, await escrow.getAddress(), tableId, player, amount, nonce]
      )
    );
    return signer.signMessage(ethers.getBytes(digest));
  }

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, alice, bob, operator, oracle, outsider] = await ethers.getSigners();
    BUY = ethers.parseEther("0.1");
    BLIND = ethers.parseEther("0.005");
    const F = await ethers.getContractFactory("NativeHypePokerEscrow");
    escrow = await F.deploy(operator.address, oracle.address);
    await escrow.markHuman(alice.address, true);
    await escrow.markHuman(bob.address, true);
  });

  it("accepts native HYPE, creates a table and retains the exact bankroll", async () => {
    await createAndSeat();
    const table = await escrow.getTableInfo(1);
    expect(table.status).to.equal(1n);
    expect(table.potTotal).to.equal(2n * BUY);
    expect(await escrow.totalLiabilities()).to.equal(2n * BUY);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(2n * BUY);
    expect(await escrow.getSeats(1)).to.deep.equal([alice.address, bob.address]);
  });

  it("blocks unverified players, incorrect msg.value and unsupported lease fees", async () => {
    await revert(escrow.connect(outsider).createTable(BUY, BLIND, 2, 0, 0));
    await revert(escrow.connect(alice).createTable(BUY, BLIND, 2, 0, 1));
    await escrow.connect(alice).createTable(BUY, BLIND, 2, 0, 0);
    await revert(escrow.connect(alice).buyIn(1, { value: BUY - 1n }));
    await escrow.connect(alice).buyIn(1, { value: BUY });
    await revert(escrow.connect(alice).buyIn(1, { value: BUY }));
    await revert(escrow.connect(outsider).buyIn(1, { value: BUY }));
  });

  it("rebuys native HYPE only when active, with exact declared amount", async () => {
    await createAndSeat();
    const extra = BUY / 2n;
    await revert(escrow.connect(alice).rebuy(1, extra, { value: 1n }));
    await escrow.connect(alice).rebuy(1, extra, { value: extra });
    expect(await escrow.getPlayerDeposit(1, alice.address)).to.equal(BUY + extra);
    expect(await escrow.totalLiabilities()).to.equal(BUY * 2n + extra);
  });

  it("updates signed bankrolls without paying during hands; blocks replay", async () => {
    await createAndSeat();
    const seats = Array.from(await escrow.getSeats(1));
    const next = [BUY + BUY / 2n, BUY / 2n];
    const sig = await signSettlement(1n, 0n, seats, next);
    await escrow.connect(outsider).settleBalances(1, 0, seats, next, sig);
    expect(await escrow.getPlayerDeposit(1, alice.address)).to.equal(next[0]);
    expect(await escrow.getPlayerDeposit(1, bob.address)).to.equal(next[1]);
    expect(await escrow.totalLiabilities()).to.equal(2n * BUY);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(2n * BUY);
    await revert(escrow.connect(alice).settleBalances(1, 0, seats, next, sig));
  });

  it("rejects forged signatures and any table-bankroll inflation or loss", async () => {
    await createAndSeat();
    const seats = Array.from(await escrow.getSeats(1));
    const inflated = [BUY * 2n, BUY];
    const forged = await signSettlement(1n, 0n, seats, inflated);
    await revert(escrow.settleBalances(1, 0, seats, inflated, forged));
    const right = [BUY, BUY];
    const badSig = await signSettlement(1n, 0n, seats, right, outsider);
    await revert(escrow.settleBalances(1, 0, seats, right, badSig));
    const valid = await signSettlement(1n, 0n, seats, right);
    await revert(escrow.settleBalances(1, 0, [...seats].reverse(), right, valid));
    await escrow.settleBalances(1, 0, seats, right, valid);
    expect((await escrow.getTableInfo(1)).handNonce).to.equal(1n);
  });

  it("credits cashouts, permits sponsored relay, and pays native HYPE with pull claim", async () => {
    await createAndSeat();
    const seats = Array.from(await escrow.getSeats(1));
    const next = [BUY + BUY / 2n, BUY / 2n];
    await escrow.settleBalances(1, 0, seats, next, await signSettlement(1n, 0n, seats, next));
    const sig = await signCashOut(1n, alice.address, next[0], 0n);
    await escrow.connect(outsider).cashOut(1, alice.address, next[0], 0, sig);
    expect(await escrow.claimable(alice.address)).to.equal(next[0]);
    expect(await escrow.totalLiabilities()).to.equal(2n * BUY);
    await revert(escrow.cashOut(1, alice.address, next[0], 0, sig));
    const before = await ethers.provider.getBalance(await escrow.getAddress());
    await escrow.connect(alice).claim();
    expect(before - await ethers.provider.getBalance(await escrow.getAddress())).to.equal(next[0]);
    expect(await escrow.totalLiabilities()).to.equal(next[1]);
    await revert(escrow.connect(alice).claim());
  });

  it("refunds open tables and preserves liabilities until claimed", async () => {
    await escrow.connect(alice).createTable(BUY, BLIND, 3, 0, 0);
    await escrow.connect(alice).buyIn(1, { value: BUY });
    await escrow.connect(alice).refund(1);
    expect(await escrow.claimable(alice.address)).to.equal(BUY);
    expect(await escrow.getPlayerDeposit(1, alice.address)).to.equal(0n);
    expect(await escrow.getSeats(1)).to.deep.equal([]);
    await escrow.connect(alice).claim();
    expect(await escrow.totalLiabilities()).to.equal(0n);
  });

  it("enforces active-table refund prohibition and a 24h emergency timelock", async () => {
    await createAndSeat();
    await revert(escrow.connect(alice).refund(1));
    await revert(escrow.connect(alice).activateEmergency(1));
    await ethers.provider.send("evm_increaseTime", [delay]);
    await ethers.provider.send("evm_mine", []);
    await escrow.connect(alice).activateEmergency(1);
    await escrow.connect(alice).emergencyCashOut(1);
    await escrow.connect(bob).emergencyCashOut(1);
    expect(await escrow.claimable(alice.address)).to.equal(BUY);
    expect(await escrow.claimable(bob.address)).to.equal(BUY);
    await escrow.connect(alice).claim();
    await escrow.connect(bob).claim();
    expect(await escrow.totalLiabilities()).to.equal(0n);
  });

  it("reopens when one active-table player exits; remaining player can refund", async () => {
    await createAndSeat();
    const sig = await signCashOut(1n, alice.address, BUY, 0n);
    await escrow.connect(owner).cashOut(1, alice.address, BUY, 0n, sig);
    expect((await escrow.getTableInfo(1)).status).to.equal(0n);
    expect(await escrow.getPlayerDeposit(1, bob.address)).to.equal(BUY);
    await escrow.connect(bob).refund(1);
    expect(await escrow.claimable(bob.address)).to.equal(BUY);
    await escrow.connect(alice).claim();
    await escrow.connect(bob).claim();
    expect(await escrow.totalLiabilities()).to.equal(0n);
  });

  it("requires a real operator signature to authorize player exit", async () => {
    await createAndSeat();
    const invalid = await signCashOut(1n, alice.address, BUY, 0n, outsider);
    await revert(escrow.cashOut(1, alice.address, BUY, 0, invalid));
    await revert(escrow.cashOut(1, alice.address, BUY - 1n, 0, invalid));
    const valid = await signCashOut(1n, alice.address, BUY, 0n);
    await escrow.cashOut(1, alice.address, BUY, 0, valid);
    expect(await escrow.cashOutNonce(1, alice.address)).to.equal(1n);
    await revert(escrow.cashOut(1, alice.address, BUY, 0, valid));
  });
});
