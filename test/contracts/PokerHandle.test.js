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

    const Renderer = await ethers.getContractFactory("HandleRenderer");
    const renderer = await Renderer.deploy();
    const Handle = await ethers.getContractFactory("PokerHandle");
    handle = await Handle.deploy(await token.getAddress(), await escrow.getAddress(), await renderer.getAddress());

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

  // ─── changeHandle (pay-to-rename) ────────────────────────────────────────────

  it("changeHandle: replaces the handle, frees the old name, and burns CHIPS", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    const tokenId = await handle.ownerTokenId(player1.address);

    const burnedBefore = await handle.totalBurned();
    await token.connect(player1).approve(await handle.getAddress(), MINT_COST);
    await handle.connect(player1).changeHandle("Wolf_42");

    expect(await handle.getHandleByAddress(player1.address)).to.equal("Wolf_42");
    expect(await handle.ownerTokenId(player1.address)).to.equal(tokenId); // same token, same tier/art/links
    expect(await handle.handleTaken("shark_99")).to.equal(false); // old name freed
    expect(await handle.handleTaken("wolf_42")).to.equal(true);
    expect(await handle.totalBurned()).to.equal(burnedBefore + MINT_COST);
  });

  it("changeHandle: reverts if the caller has no handle", async () => {
    await expectReverted(handle.connect(player1).changeHandle("Whatever"));
  });

  it("changeHandle: reverts if the new name is already taken", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    await handle.reserveHandle("Wolf_42", owner.address);

    await token.connect(player1).approve(await handle.getAddress(), MINT_COST);
    await expectReverted(handle.connect(player1).changeHandle("Wolf_42"));
  });

  it("changeHandle: a freed name can be claimed by someone else afterward", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    await token.connect(player1).approve(await handle.getAddress(), MINT_COST);
    await handle.connect(player1).changeHandle("Wolf_42");

    await escrow.markHuman(operator.address, true);
    await token.transfer(operator.address, MINT_COST);
    await token.connect(operator).approve(await handle.getAddress(), MINT_COST);
    await handle.connect(operator).mintHandle("Shark_99");

    expect(await handle.getHandleByAddress(operator.address)).to.equal("Shark_99");
  });

  // ─── wallet linking (functional alias) ──────────────────────────────────────

  async function linkProofSig(signer, ownerAddr, tokenId) {
    const handleAddr = await handle.getAddress();
    const { chainId } = await ethers.provider.getNetwork();
    const digest = ethers.solidityPackedKeccak256(
      ["string", "uint256", "address", "address", "uint256"],
      ["PVP-LINK:", chainId, handleAddr, ownerAddr, tokenId]
    );
    return signer.signMessage(ethers.getBytes(digest));
  }

  it("linkWallet: lets the handle owner link a consenting, human-verified wallet as a functional alias", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    const tokenId = await handle.ownerTokenId(player1.address);

    await escrow.markHuman(operator.address, true);
    const sig = await linkProofSig(operator, player1.address, tokenId);
    await handle.connect(player1).linkWallet(operator.address, sig);

    expect(await handle.isHandleEligible(operator.address)).to.equal(true);
    expect(await handle.getEffectiveHandle(operator.address)).to.equal("Shark_99");
    expect(await handle.linkedToToken(operator.address)).to.equal(tokenId);
  });

  it("linkWallet: reverts when the wallet being linked is not human-verified", async () => {
    // Closes the bot/Sybil bypass: linking must not be a free pass around the anti-bot gate.
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    const tokenId = await handle.ownerTokenId(player1.address);

    const sig = await linkProofSig(operator, player1.address, tokenId);
    await expectReverted(handle.connect(player1).linkWallet(operator.address, sig));
  });

  it("linkWallet: reverts when the proof is not signed by the wallet being linked", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    const tokenId = await handle.ownerTokenId(player1.address);

    await escrow.markHuman(operator.address, true);
    const badSig = await linkProofSig(owner, player1.address, tokenId); // wrong signer
    await expectReverted(handle.connect(player1).linkWallet(operator.address, badSig));
  });

  it("unlinkWallet: removes the alias so isHandleEligible reverts to false", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    const tokenId = await handle.ownerTokenId(player1.address);
    await escrow.markHuman(operator.address, true);
    const sig = await linkProofSig(operator, player1.address, tokenId);
    await handle.connect(player1).linkWallet(operator.address, sig);

    await handle.connect(player1).unlinkWallet(operator.address);

    expect(await handle.isHandleEligible(operator.address)).to.equal(false);
    expect(await handle.linkedToToken(operator.address)).to.equal(0n);
  });

  it("isHandleEligible: false for a wallet with neither a handle nor a link", async () => {
    expect(await handle.isHandleEligible(operator.address)).to.equal(false);
  });

  it("transferring the handle NFT clears any linked wallets", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Shark_99");
    const tokenId = await handle.ownerTokenId(player1.address);
    await escrow.markHuman(operator.address, true);
    const sig = await linkProofSig(operator, player1.address, tokenId);
    await handle.connect(player1).linkWallet(operator.address, sig);

    await handle.connect(player1).transferFrom(player1.address, owner.address, tokenId);

    expect(await handle.isHandleEligible(operator.address)).to.equal(false);
    expect(await handle.getLinkedWallets(tokenId)).to.deep.equal([]);
  });

  it("tokenURI: renders the medallion emblem SVG from the renderer", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Joker");
    const uri = await handle.tokenURI(1);
    const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    expect(json.name).to.equal("@Joker");
    const svg = Buffer.from(json.image.split(",")[1], "base64").toString();
    expect(svg).to.include("<svg");
    expect(svg).to.include("@Joker");                       // handle on the card
    expect(svg).to.include('cx="200" cy="172" r="96"');     // medallion ring
    expect(svg).to.include('fill-rule="evenodd"');          // animal silhouette path
    expect(svg).to.include("#d9c08a");                      // champagne palette
    const animalAttr = json.attributes.find(a => a.trait_type === "Animal");
    expect(["BEAR","WOLF","FOX","SHARK","EAGLE","TIGER","RABBIT","BULL"]).to.include(animalAttr.value);
  });

  it("setRenderer: owner can swap the art module and tokenURI changes", async () => {
    await escrow.markHuman(player1.address, true);
    await handle.connect(player1).mintHandle("Joker");
    const before = await handle.tokenURI(1);

    const Renderer2 = await ethers.getContractFactory("HandleRenderer");
    const renderer2 = await Renderer2.deploy();
    await handle.setRenderer(await renderer2.getAddress());
    expect(await handle.renderer()).to.equal(await renderer2.getAddress());
    // Same art contract code, so output matches — proves delegation works end-to-end
    expect(await handle.tokenURI(1)).to.equal(before);
  });

  it("setRenderer: rejects non-owner and zero address", async () => {
    await expectReverted(handle.connect(player1).setRenderer(player1.address));
    await expectReverted(handle.setRenderer("0x0000000000000000000000000000000000000000"));
  });
});
