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

describe("TournamentManager", () => {
  let ethers;
  let token, staking, tourn, handle, escrow;
  let owner, player1, player2, operator;
  const ENTRY_FEE = parseUnits("100", 18);

  beforeEach(async () => {
    ({ ethers } = await network.create());
    [owner, player1, player2, operator] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ChipsToken");
    token = await Token.deploy(owner.address, owner.address, owner.address, owner.address);

    const Staking = await ethers.getContractFactory("ChipsStaking");
    staking = await Staking.deploy(await token.getAddress());

    const Tourn = await ethers.getContractFactory("TournamentManager");
    tourn = await Tourn.deploy(
      await token.getAddress(),
      operator.address,
      owner.address,
      await staking.getAddress()
    );
    await staking.setYieldSource(await tourn.getAddress(), true);

    // register() gates on PokerHandle.isHandleEligible — give entrants a handle
    // via the owner-only reserveHandle() (mirrors PokerEscrow.test.js fixture).
    const Escrow = await ethers.getContractFactory("PokerEscrow");
    const Referral = await ethers.getContractFactory("ReferralRegistry");
    const referral = await Referral.deploy(await token.getAddress());
    escrow = await Escrow.deploy(
      await token.getAddress(),
      operator.address,
      owner.address,
      owner.address,
      await staking.getAddress(),
      await referral.getAddress()
    );

    const Renderer = await ethers.getContractFactory("HandleRenderer");
    const renderer = await Renderer.deploy();
    const Handle = await ethers.getContractFactory("PokerHandle");
    handle = await Handle.deploy(await token.getAddress(), await escrow.getAddress(), await renderer.getAddress());
    await tourn.setPokerHandle(await handle.getAddress());
    await handle.reserveHandle("Player1_Handle", player1.address);
    await handle.reserveHandle("Player2_Handle", player2.address);

    await token.transfer(player1.address, parseUnits("10000", 18));
    await token.transfer(player2.address, parseUnits("10000", 18));
  });

  it("rejects register from a wallet with no handle", async () => {
    const [,,,,stranger] = await ethers.getSigners();
    await tourn.createTournament("Sit&Go", ENTRY_FEE, (await ethers.provider.getBlock("latest")).timestamp + 3600, 9, 0, false, 0);
    await expectReverted(tourn.connect(stranger).register(1));
  });

  it("lets a handle-eligible player register", async () => {
    const escrowAddr = await tourn.getAddress();
    await tourn.createTournament("Sit&Go", ENTRY_FEE, (await ethers.provider.getBlock("latest")).timestamp + 3600, 9, 0, false, 0);
    await token.connect(player1).approve(escrowAddr, ENTRY_FEE);
    await tourn.connect(player1).register(1);
    const entrants = await tourn.getEntrants(1);
    expect(entrants).to.deep.equal([player1.address]);
  });

  // ─── duplicate-identity check (anti-collusion) ───────────────────────────────

  it("register: reverts when a linked alias wallet tries to take a second entry in the same tournament", async () => {
    const tournAddr = await tourn.getAddress();
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

    await tourn.createTournament("Sit&Go", ENTRY_FEE, (await ethers.provider.getBlock("latest")).timestamp + 3600, 9, 0, false, 0);
    await token.connect(player1).approve(tournAddr, ENTRY_FEE);
    await tourn.connect(player1).register(1);

    await token.transfer(operator.address, ENTRY_FEE);
    await token.connect(operator).approve(tournAddr, ENTRY_FEE);
    await expectReverted(tourn.connect(operator).register(1));
  });
});
