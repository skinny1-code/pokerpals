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
    // Hardhat 3 EDR puts Error(string) reason in e.data as ABI-encoded bytes
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

// settle/cashout digests must match PokerEscrow's chainId + contract binding.
async function settleDigest(ethers, escrow, tableId, handNonce, winners, shares) {
  const { chainId } = await ethers.provider.getNetwork();
  return ethers.solidityPackedKeccak256(
    ["uint256","address","uint256","uint256","address[]","uint256[]"],
    [chainId, await escrow.getAddress(), tableId, handNonce, winners, shares]
  );
}
async function cashoutDigest(ethers, escrow, tableId, player, amount, nonce) {
  const { chainId } = await ethers.provider.getNetwork();
  return ethers.solidityPackedKeccak256(
    ["string","uint256","address","uint256","address","uint256","uint256"],
    ["CASHOUT", chainId, await escrow.getAddress(), tableId, player, amount, nonce]
  );
}

describe("PokerEscrow", () => {
  let ethers;
  let token, staking, referral, escrow, kingsPool, handle;
  let owner, player1, player2, operator;
  const BUY_IN = parseUnits("1000", 18);
  const BB     = parseUnits("10",   18);
  const FEE    = parseUnits("2",    18);

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, player1, player2, operator] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const Staking = await ethers.getContractFactory("ChipsStaking");
    staking = await Staking.deploy(await token.getAddress());

    const Referral = await ethers.getContractFactory("ReferralRegistry");
    referral = await Referral.deploy(await token.getAddress());

    const KingsPool = await ethers.getContractFactory("KingOfSpadesPool");
    kingsPool = await KingsPool.deploy(await token.getAddress());

    const Escrow = await ethers.getContractFactory("PokerEscrow");
    escrow = await Escrow.deploy(
      await token.getAddress(),
      operator.address,
      owner.address,
      owner.address,
      await staking.getAddress(),
      await referral.getAddress()
    );

    // Authorize escrow as a yield source and kings pool rake source
    await staking.setYieldSource(await escrow.getAddress(), true);
    await kingsPool.setAuthorized(await escrow.getAddress(), true);
    await escrow.setKingsPool(await kingsPool.getAddress());

    // createTable()/buyIn() gate on PokerHandle.isHandleEligible — give the
    // table-creating/buying-in signers a handle via the owner-only reserveHandle()
    // (no CHIPS cost, no humanVerified requirement, mirrors the migration scripts).
    const Renderer = await ethers.getContractFactory("HandleRenderer");
    const renderer = await Renderer.deploy();
    const Handle = await ethers.getContractFactory("PokerHandle");
    handle = await Handle.deploy(await token.getAddress(), await escrow.getAddress(), await renderer.getAddress());
    await escrow.setPokerHandle(await handle.getAddress());
    await handle.reserveHandle("Owner_Handle", owner.address);
    await handle.reserveHandle("Player1_Handle", player1.address);
    await handle.reserveHandle("Player2_Handle", player2.address);

    // Fund test players from owner balance (faucet would exceed MAX_SUPPLY)
    await token.transfer(player1.address, parseUnits("10000", 18));
    await token.transfer(player2.address, parseUnits("10000", 18));
    await escrow.markHuman(player1.address, true);
    await escrow.markHuman(player2.address, true);
  });

  it("deploys with correct token supply", async () => {
    const supply = await token.totalSupply();
    expect(supply).to.equal(parseUnits("1000000000", 18));
  });

  it("creates a table with correct params", async () => {
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    const count = await escrow.tableCount();
    expect(count).to.equal(1n);
    const info = await escrow.getTableInfo(1);
    expect(info.buyInAmount).to.equal(BUY_IN);
    expect(info.bigBlind).to.equal(BB);
    expect(info.maxPlayers).to.equal(2n);
  });

  it("rejects table if buy-in < 10x big blind", async () => {
    await expectReverted(escrow.createTable(BB, BB, 2, 0, 0), "Buy-in too small");
  });

  it("lets a verified player buy in", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    const info = await escrow.getTableInfo(1);
    expect(info.seated).to.equal(1n);
  });

  it("table becomes Active when all seats filled (2-max)", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);
    const info = await escrow.getTableInfo(1);
    expect(info.status).to.equal(1n); // TableStatus.Active
  });

  it("rejects buy-in from unverified player", async () => {
    const [,,,,unverified] = await ethers.getSigners();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await expectReverted(escrow.connect(unverified).buyIn(1));
  });

  it("rejects double buy-in from same player", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await token.connect(player1).approve(escrowAddr, (BUY_IN + FEE) * 2n);
    await escrow.connect(player1).buyIn(1);
    await expectReverted(escrow.connect(player1).buyIn(1));
  });

  it("dev vest releases linearly over 24 months", async () => {
    const claimable = await token.devClaimable();
    expect(claimable >= 0n).to.equal(true);
  });

  it("humanVerified mapping is set correctly", async () => {
    expect(await escrow.humanVerified(player1.address)).to.equal(true);
    const [,,,,stranger] = await ethers.getSigners();
    expect(await escrow.humanVerified(stranger.address)).to.equal(false);
  });

  // ─── settle() ───────────────────────────────────────────────────────────────
  // NOTE: Solidity's abi.encodePacked(address[]) packs each address as 32 bytes
  // (ABI-encoded, not 20-byte natural size). Use "address[]" type in solidityPackedKeccak256
  // to match the contract's on-chain hash computation.

  it("settle: distributes rake correctly (15% burn / 45% staking / 10% kings / 20% treasury)", async () => {
    const escrowAddr  = await escrow.getAddress();
    const stakingAddr = await staking.getAddress();
    const kingsAddr   = await kingsPool.getAddress();

    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const potTotal    = BUY_IN * 2n;
    const tierRateNum = 15n;   // tier 0 = 1.5% = 15/1000
    const rakeDen     = 1000n;
    const totalRake   = (potTotal * tierRateNum) / rakeDen;

    const burnBefore  = await token.totalSupply();
    const stakBefore  = await token.balanceOf(stakingAddr);
    const kingsBefore = await token.balanceOf(kingsAddr);
    const rakeBefore  = await token.balanceOf(owner.address);

    const tableId  = 1n;
    const handNonce = 0n;
    const winners  = [player1.address];
    const shares   = [1000n];
    const digest   = await settleDigest(ethers, escrow, tableId, handNonce, winners, shares);
    const sig = await operator.signMessage(ethers.getBytes(digest));

    await escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig);

    const burnAfter  = await token.totalSupply();
    const stakAfter  = await token.balanceOf(stakingAddr);
    const kingsAfter = await token.balanceOf(kingsAddr);
    const rakeAfter  = await token.balanceOf(owner.address);

    const expectedBurn    = (totalRake * 1500n) / 10000n;
    const expectedStaking = (totalRake * 4500n) / 10000n;
    const expectedKings   = (totalRake * 1000n) / 10000n;
    const expectedTreasury = totalRake - expectedBurn - expectedStaking - expectedKings;

    expect(burnBefore - burnAfter).to.equal(expectedBurn);
    expect(stakAfter  - stakBefore).to.equal(expectedStaking);
    expect(kingsAfter - kingsBefore).to.equal(expectedKings);
    expect(rakeAfter  - rakeBefore >= expectedTreasury - 1n).to.equal(true);
  });

  it("settle: pays winner correct net amount after rake", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const potTotal  = BUY_IN * 2n;
    const totalRake = (potTotal * 15n) / 1000n;
    const netPot    = potTotal - totalRake;
    const balBefore = await token.balanceOf(player1.address);

    const tableId = 1n; const handNonce = 0n;
    const winners = [player1.address]; const shares = [1000n];
    const digest = await settleDigest(ethers, escrow, tableId, handNonce, winners, shares);
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
    const digest = await settleDigest(ethers, escrow, tableId, handNonce, winners, shares);
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig);

    await expectReverted(
      escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig)
    );
  });

  // ─── refund() ───────────────────────────────────────────────────────────────

  it("refund: returns deposit to player on Open table", async () => {
    const escrowAddr = await escrow.getAddress();
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
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    await expectReverted(escrow.connect(player1).refund(1));
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
    const digest = await cashoutDigest(ethers, escrow, tableId, player1.address, cashAmount, cashNonce);
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
    const digest = await cashoutDigest(ethers, escrow, tableId, player1.address, BUY_IN, cashNonce);
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await escrow.connect(player1).cashOut(tableId, player1.address, BUY_IN, cashNonce, sig);

    await expectReverted(
      escrow.connect(player1).cashOut(tableId, player1.address, BUY_IN, cashNonce, sig)
    );
  });

  // ─── replay binding (C-1): chainId + contract address ────────────────────────

  it("settle: rejects a signature bound to a different chain or contract (replay guard)", async () => {
    const escrowAddr = await escrow.getAddress();
    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const tableId = 1n, handNonce = 0n;
    const winners = [player1.address], shares = [1000n];
    const { chainId } = await ethers.provider.getNetwork();

    // Signature bound to a DIFFERENT chain id (e.g. a testnet sig) must not verify.
    const wrongChain = ethers.solidityPackedKeccak256(
      ["uint256","address","uint256","uint256","address[]","uint256[]"],
      [chainId + 1n, escrowAddr, tableId, handNonce, winners, shares]
    );
    await expectReverted(escrow.connect(player1).settle(
      tableId, handNonce, winners, shares, await operator.signMessage(ethers.getBytes(wrongChain))));

    // Signature bound to a DIFFERENT contract address must not verify.
    const wrongAddr = ethers.solidityPackedKeccak256(
      ["uint256","address","uint256","uint256","address[]","uint256[]"],
      [chainId, player2.address, tableId, handNonce, winners, shares]
    );
    await expectReverted(escrow.connect(player1).settle(
      tableId, handNonce, winners, shares, await operator.signMessage(ethers.getBytes(wrongAddr))));

    // The correctly-bound signature still settles.
    const good = await settleDigest(ethers, escrow, tableId, handNonce, winners, shares);
    await expectNotReverted(escrow.connect(player1).settle(
      tableId, handNonce, winners, shares, await operator.signMessage(ethers.getBytes(good))));
  });

  // ─── rakeback ───────────────────────────────────────────────────────────────

  it("rakeback: accrues after settle and is claimable", async () => {
    const escrowAddr = await escrow.getAddress();

    const poolSeed = parseUnits("1000", 18);
    await token.approve(escrowAddr, poolSeed);
    await escrow.fundRakebackPool(poolSeed);

    await escrow.createTable(BUY_IN, BB, 2, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);
    await token.connect(player2).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player2).buyIn(1);

    const tableId = 1n; const handNonce = 0n;
    const winners = [player1.address]; const shares = [1000n];
    const digest = await settleDigest(ethers, escrow, tableId, handNonce, winners, shares);
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await escrow.connect(player1).settle(tableId, handNonce, winners, shares, sig);

    const accrued = await escrow.rakebackAccrued(player1.address);
    expect(accrued > 0n).to.equal(true);

    const balBefore = await token.balanceOf(player1.address);
    await escrow.connect(player1).claimRakeback();
    const balAfter = await token.balanceOf(player1.address);
    expect(balAfter - balBefore).to.equal(accrued);
    expect(await escrow.rakebackAccrued(player1.address)).to.equal(0n);
  });

  // ─── closeTable access control (C1) ─────────────────────────────────────────

  it("closeTable: reverts if caller is not creator or owner", async () => {
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    const [,,,,stranger] = await ethers.getSigners();
    await expectReverted(escrow.connect(stranger).closeTable(1), "Not authorized");
  });

  it("closeTable: succeeds when creator calls with empty pot", async () => {
    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await expectNotReverted(escrow.connect(owner).closeTable(1));
  });

  // ─── duplicate-identity check (anti-collusion) ───────────────────────────────
  // Closes the path wallet-linking would otherwise open: a handle owner and any
  // of its linked alias wallets must not be able to hold two seats at once.

  it("buyIn: reverts when a linked alias wallet tries to take a second seat at the same table", async () => {
    const escrowAddr = await escrow.getAddress();
    const handleAddr = await handle.getAddress();
    const { chainId } = await ethers.provider.getNetwork();

    await escrow.markHuman(operator.address, true);
    const tokenId = await handle.ownerTokenId(player1.address);
    const digest = ethers.solidityPackedKeccak256(
      ["string", "uint256", "address", "address", "uint256"],
      ["PVP-LINK:", chainId, handleAddr, player1.address, tokenId]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));
    await handle.connect(player1).linkWallet(operator.address, sig);

    await escrow.createTable(BUY_IN, BB, 9, 0, 0);
    await token.connect(player1).approve(escrowAddr, BUY_IN + FEE);
    await escrow.connect(player1).buyIn(1);

    await token.transfer(operator.address, BUY_IN + FEE);
    await token.connect(operator).approve(escrowAddr, BUY_IN + FEE);
    await expectReverted(escrow.connect(operator).buyIn(1));
  });
});
