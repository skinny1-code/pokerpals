import { expect } from "chai";
import { network } from "hardhat";
import { parseUnits, AbiCoder } from "ethers";

// Helper: assert a promise rejects (optionally with a message substring)
async function expectReverted(promise, msgSubstring = null) {
  let reverted = false;
  let e;
  try {
    await promise;
  } catch (err) {
    reverted = true;
    e = err;
  }
  expect(reverted, "Expected transaction to revert but it did not").to.equal(true);
  if (msgSubstring && e) {
    let searchable = [e.message, e.reason, e.shortMessage]
      .filter(s => typeof s === "string")
      .join(" ");
    if (e.data && typeof e.data === "string" && e.data.startsWith("0x08c379a0")) {
      try {
        const [reason] = new AbiCoder().decode(["string"], "0x" + e.data.slice(10));
        searchable += " " + reason;
      } catch (_) {}
    }
    expect(searchable, `Expected revert message to include "${msgSubstring}"`).to.include(msgSubstring);
  }
}

async function expectNotReverted(promise) {
  try {
    await promise;
  } catch (e) {
    throw new Error(`Expected no revert but got: ${e.message}`);
  }
}

describe("TableRegistry", () => {
  let ethers;
  let token, staking, kingsPool, registry;
  let owner, rake, lessee;
  const WEEKLY_FEE = parseUnits("33500", 18);

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, rake, lessee] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const Staking = await ethers.getContractFactory("ChipsStaking");
    staking = await Staking.deploy(await token.getAddress());
    await token.transfer(await staking.getAddress(), parseUnits("1000000", 18));
    await staking.initYieldPool();

    const KingsPool = await ethers.getContractFactory("KingOfSpadesPool");
    kingsPool = await KingsPool.deploy(await token.getAddress());

    const Registry = await ethers.getContractFactory("TableRegistry");
    registry = await Registry.deploy(await token.getAddress(), rake.address, await staking.getAddress());

    await staking.setYieldSource(await registry.getAddress(), true);
    await kingsPool.setAuthorized(await registry.getAddress(), true);
    await registry.setKingsPool(await kingsPool.getAddress());

    await token.transfer(lessee.address, parseUnits("1000000", 18));
    await token.connect(lessee).approve(await registry.getAddress(), parseUnits("1000000", 18));
  });

  async function leaseOneWeek() {
    const tx = await registry.connect(lessee).leaseRoom(
      1, ethers.ZeroAddress, 0, 0, 6, 0, true, "Test Room"
    );
    await tx.wait();
    return 1n; // first room id
  }

  // ── NFT-gated rooms ────────────────────────────────────────────────────────
  // canSit() is what PokerEscrow.buyIn calls to decide whether a wallet may sit
  // down with real money, and the NFT gate is the whole mechanism behind
  // "holders of collection X only" rooms. It had no tests at all.
  describe("NFT gate", () => {
    let gateNft;

    beforeEach(async () => {
      // Any ERC-721 works as a gate — canSit only reads balanceOf — so this is
      // a plain collection rather than PokerHandle, which would drag in a live
      // escrow and a SALOON burn just to mint one.
      const MockNFT = await ethers.getContractFactory("MockNFT");
      gateNft = await MockNFT.deploy("CannaCats", "CCATS");
    });

    async function leaseGated(gate) {
      await registry.connect(lessee).leaseRoom(1, gate, 0, 0, 6, 0, true, "Gated Room");
      return 1n;
    }

    it("an open room (gate = 0) lets any wallet sit", async () => {
      const roomId = await leaseOneWeek();
      expect(await registry.canSit(roomId, owner.address)).to.equal(true);
      expect(await registry.canSit(roomId, lessee.address)).to.equal(true);
      expect(await registry.canSit(roomId, rake.address)).to.equal(true);
    });

    it("a gated room refuses a wallet holding none of the collection", async () => {
      const roomId = await leaseGated(await gateNft.getAddress());
      expect(await registry.canSit(roomId, owner.address)).to.equal(false);
      expect(await registry.canSit(roomId, rake.address)).to.equal(false);
      // Even the lessee who set the gate is subject to it — the gate is about
      // holding the NFT, not about who pays the lease.
      expect(await registry.canSit(roomId, lessee.address)).to.equal(false);
    });

    it("a gated room admits a holder, and keeps admitting while they hold", async () => {
      const roomId = await leaseGated(await gateNft.getAddress());
      // Mint one to `owner` so they hold a token from the gated collection.
      await gateNft.mint(owner.address);
      expect(await gateNft.balanceOf(owner.address)).to.equal(1n);
      expect(await registry.canSit(roomId, owner.address)).to.equal(true);
      expect(await registry.canSit(roomId, rake.address)).to.equal(false);
    });

    it("selling the NFT revokes the seat — the gate is checked live, not at lease time", async () => {
      const roomId = await leaseGated(await gateNft.getAddress());
      await gateNft.mint(owner.address);
      expect(await registry.canSit(roomId, owner.address)).to.equal(true);

      await gateNft.connect(owner).transferFrom(owner.address, rake.address, 1n);
      expect(await registry.canSit(roomId, owner.address)).to.equal(false);
      expect(await registry.canSit(roomId, rake.address)).to.equal(true);
    });

    it("an expired lease closes the room to everyone, holder or not", async () => {
      const roomId = await leaseGated(await gateNft.getAddress());
      await gateNft.mint(owner.address);
      expect(await registry.canSit(roomId, owner.address)).to.equal(true);

      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      expect(await registry.canSit(roomId, owner.address)).to.equal(false);
    });

    it("a room that was never leased refuses everyone", async () => {
      expect(await registry.canSit(999n, owner.address)).to.equal(false);
    });

    it("the lessee can add or remove the gate mid-lease", async () => {
      const roomId = await leaseOneWeek();              // open
      expect(await registry.canSit(roomId, owner.address)).to.equal(true);

      await registry.connect(lessee).updateRoom(
        roomId, await gateNft.getAddress(), 0, 0, true, "Gated Room");
      expect(await registry.canSit(roomId, owner.address)).to.equal(false);

      await registry.connect(lessee).updateRoom(roomId, ethers.ZeroAddress, 0, 0, true, "Open Again");
      expect(await registry.canSit(roomId, owner.address)).to.equal(true);
    });

    it("only the lessee can change the gate", async () => {
      const roomId = await leaseOneWeek();
      await expectReverted(registry.connect(owner).updateRoom(
        roomId, await gateNft.getAddress(), 0, 0, true, "Hijacked"));
      await expectReverted(registry.connect(rake).updateRoom(
        roomId, ethers.ZeroAddress, 0, 0, true, "Hijacked"));
      expect((await registry.getRoom(roomId)).nftGate).to.equal(ethers.ZeroAddress);
    });

    it("a gate pointed at a non-ERC721 bricks only that room", async () => {
      // canSit is a view call from buyIn, so a gate address that cannot answer
      // balanceOf makes the call revert and nobody can sit. A lessee can only
      // do this to the room they pay for — worth knowing, not worth guarding.
      const roomId = await leaseGated(await staking.getAddress());  // not an ERC-721
      let reverted = false;
      try { await registry.canSit(roomId, owner.address); } catch { reverted = true; }
      expect(reverted).to.equal(true);

      // A second, open room is unaffected.
      await registry.connect(lessee).leaseRoom(1, ethers.ZeroAddress, 0, 0, 6, 0, true, "Open");
      expect(await registry.canSit(2n, owner.address)).to.equal(true);
    });
  });

  it("leaseRoom holds the full fee in escrow instead of distributing it immediately", async () => {
    await leaseOneWeek();
    expect(await token.balanceOf(await registry.getAddress())).to.equal(WEEKLY_FEE);
    const room = await registry.getRoom(1);
    expect(room.heldFunds).to.equal(WEEKLY_FEE);
  });

  it("terminateLease refunds pro-rata without reverting, then distributes the rest", async () => {
    const roomId = await leaseOneWeek();

    // Fast-forward to the halfway point of the 1-week lease.
    await ethers.provider.send("evm_increaseTime", [3.5 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const lesseeBalBefore = await token.balanceOf(lessee.address);
    const rakeBalBefore   = await token.balanceOf(rake.address);

    await expectNotReverted(registry.terminateLease(roomId));

    const refund = (await token.balanceOf(lessee.address)) - lesseeBalBefore;
    expect(refund).to.be.greaterThan(0n);
    expect(refund).to.be.lessThan(WEEKLY_FEE);

    // Remainder must have been distributed (treasury got its 30% cut of whatever wasn't refunded).
    const treasuryGain = (await token.balanceOf(rake.address)) - rakeBalBefore;
    expect(treasuryGain).to.be.greaterThan(0n);

    // Contract should hold nothing for this room anymore.
    const room = await registry.getRoom(roomId);
    expect(room.heldFunds).to.equal(0n);
    expect(await token.balanceOf(await registry.getAddress())).to.equal(0n);
  });

  it("terminateLease on an already-expired, unsettled lease distributes 100% with no refund", async () => {
    const roomId = await leaseOneWeek();

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]); // past the 7-day lease
    await ethers.provider.send("evm_mine");

    const lesseeBalBefore = await token.balanceOf(lessee.address);
    await expectNotReverted(registry.terminateLease(roomId));
    expect(await token.balanceOf(lessee.address)).to.equal(lesseeBalBefore); // no refund earned
    expect(await token.balanceOf(await registry.getAddress())).to.equal(0n);
  });

  it("terminateLease reverts if called again on an already-terminated room", async () => {
    const roomId = await leaseOneWeek();

    await ethers.provider.send("evm_increaseTime", [3.5 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expectNotReverted(registry.terminateLease(roomId));
    await expectReverted(registry.terminateLease(roomId), "Already terminated");
  });

  it("settleLease lets anyone release funds once a lease has run its course", async () => {
    const roomId = await leaseOneWeek();

    await expectReverted(registry.connect(lessee).settleLease(roomId), "Lease still active");

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const rakeBalBefore = await token.balanceOf(rake.address);
    await expectNotReverted(registry.connect(lessee).settleLease(roomId)); // permissionless
    expect(await token.balanceOf(rake.address)).to.be.greaterThan(rakeBalBefore);
    expect(await token.balanceOf(await registry.getAddress())).to.equal(0n);

    await expectReverted(registry.settleLease(roomId), "Nothing to settle");
  });

  it("renewLease before expiry accumulates heldFunds without distributing", async () => {
    const roomId = await leaseOneWeek();
    await registry.connect(lessee).renewLease(roomId, 1);
    const room = await registry.getRoom(roomId);
    expect(room.heldFunds).to.equal(WEEKLY_FEE * 2n);
    expect(await token.balanceOf(await registry.getAddress())).to.equal(WEEKLY_FEE * 2n);
  });
});
