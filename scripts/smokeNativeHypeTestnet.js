// Isolated two-wallet HYPE escrow smoke test; no CHIPS issuance or mainnet ops.
// Tests escrow transactions only, NOT a real poker hand or legal wagering.
// Requires explicit TESTNET-only approval, a funded deployer and two funded player
// wallets. Do NOT commit or paste private keys into repo or chat.
import "dotenv/config";
import { network } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.DEPLOY_NETWORK !== "elysiumTestnet" ||
    process.env.HYPE_TESTNET_SMOKE_ACK !== "ISOLATED_TEST_ONLY")
  throw new Error("Isolated testnet smoke only. Set DEPLOY_NETWORK=elysiumTestnet and HYPE_TESTNET_SMOKE_ACK=ISOLATED_TEST_ONLY.");

const { ethers } = await network.connect({ network: "elysiumTestnet" });
const net = await ethers.provider.getNetwork();
if (net.chainId !== 99801n) throw new Error("Wrong chain: require Kinetiq Elysium testnet 99801.");
const manifest = JSON.parse(readFileSync(resolve("deployments/elysiumTestnet.json"), "utf8"));
if (manifest.chainId !== 99801 || manifest.assetMode !== "NATIVE_HYPE_TEST_ONLY")
  throw new Error("Wrong manifest chain or asset mode.");
const addr = manifest.contracts?.NativeHypePokerEscrow;
if (!ethers.isAddress(addr) || await ethers.provider.getCode(addr) === "0x")
  throw new Error("Missing verified deployed native-HYPE escrow bytecode.");
const [owner] = await ethers.getSigners();
if (await ethers.provider.getCode(owner.address) !== "0x")
  throw new Error("Deployer cannot be a contract wallet in this simple smoke flow.");
const requirePrivate = name => {
  const key = process.env[name];
  if (!/^0x[0-9a-fA-F]{64}$/.test(key || "")) throw new Error(`Missing ${name}; store in local testnet secrets only.`);
  return new ethers.Wallet(key, ethers.provider);
};
const p1 = requirePrivate("HYPE_TEST_PLAYER1_KEY");
const p2 = requirePrivate("HYPE_TEST_PLAYER2_KEY");
const operator = requirePrivate("OPERATOR_PRIVATE_KEY");
if (p1.address === p2.address || p1.address === operator.address || p2.address === operator.address)
  throw new Error("Test players must have distinct addresses.");
const escrow = await ethers.getContractAt("NativeHypePokerEscrow", addr);
if ((await escrow.owner()).toLowerCase() !== owner.address.toLowerCase())
  throw new Error("Deployer key is not escrow owner; cannot mark test players.");
if ((await escrow.operatorSigner()).toLowerCase() !== operator.address.toLowerCase())
  throw new Error("Operator key does not match on-chain escrow signer.");

const deposit = ethers.parseEther("0.01");  // each player deposits valueless TEST HYPE
const bigBlind = ethers.parseEther("0.0001"); // 100 micro-HYPE units, divisible by 2
const needed = deposit + ethers.parseEther("0.0005");
for (const p of [p1,p2]) {
  if (await ethers.provider.getBalance(p.address) < needed)
    throw new Error(`Player ${p.address} needs at least 0.0105 TEST HYPE for stake and gas; no automatic funding.`);
}
const receipts = [];
async function send(txPromise, label) {
  const tx = await txPromise;
  const r = await tx.wait();
  if (!r || r.status !== 1) throw new Error(`${label} transaction failed: ${tx.hash}`);
  receipts.push({ label, hash: tx.hash, block: r.blockNumber });
  return r;
}
const startingTableCount = await escrow.tableCount();
await send(escrow.markHuman(p1.address,true),"owner-verified-p1-test");
await send(escrow.markHuman(p2.address,true),"owner-verified-p2-test");
await send(escrow.connect(p1).createTable(deposit,bigBlind,2,0,0),"create-table");
const id = startingTableCount + 1n;
await send(escrow.connect(p1).buyIn(id,{value:deposit}),"p1-buy-in");
await send(escrow.connect(p2).buyIn(id,{value:deposit}),"p2-buy-in");
let info = await escrow.getTableInfo(id);
if (info.potTotal !== deposit * 2n || Number(info.status) !== 1)
  throw new Error("Initial HYPE bankroll not conserved.");

const seats = await escrow.getSeats(id);
const balances = seats.map(a => a.toLowerCase() === p1.address.toLowerCase()
  ? deposit + deposit / 2n : deposit / 2n);
const { chainId } = await ethers.provider.getNetwork();
const digest = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
  ["string","uint256","address","uint256","uint256","address[]","uint256[]"],
  ["HYPE_SETTLE_V1",chainId,addr,id,0n,seats,balances]
));
const sig = await operator.signMessage(ethers.getBytes(digest));
await send(escrow.connect(p2).settleBalances(id,0n,seats,balances,sig),"signed-balance-settlement");
info = await escrow.getTableInfo(id);
if (info.potTotal !== deposit * 2n || info.handNonce !== 1n)
  throw new Error("Signed settlement did not conserve HYPE or advance nonce.");

for (const player of [p1,p2]) {
  const amount = await escrow.getPlayerDeposit(id, player.address);
  const nonce = await escrow.cashOutNonce(id, player.address);
  const cd = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["string","uint256","address","uint256","address","uint256","uint256"],
    ["HYPE_CASHOUT_V1",chainId,addr,id,player.address,amount,nonce]
  ));
  const csig = await operator.signMessage(ethers.getBytes(cd));
  await send(escrow.connect(owner).cashOut(id,player.address,amount,nonce,csig),
    player === p1 ? "p1-signed-cashout-credit" : "p2-signed-cashout-credit");
  if (await escrow.claimable(player.address) !== amount)
    throw new Error("Player credit missing after cashout.");
  await send(escrow.connect(player).claim(),player===p1 ? "p1-pull-claim" : "p2-pull-claim");
}
if (await escrow.getTableInfo(id).then(x => x.potTotal) !== 0n)
  throw new Error("Escrow still holds bankroll for completed test table.");

const output = {
  network:"elysiumTestnet", chainId:99801, asset:"valueless native test HYPE",
  escrow:addr, tableId:id.toString(), accounts:[p1.address,p2.address],
  verified:"contract deposit -> signed bankroll conservation -> operator-signed credit -> player pull claim",
  evidence:receipts, confirmed:true,
  regulatoryStatus:"TESTNET ONLY, NOT LICENSED FOR REAL MONEY",
  capturedAt:new Date().toISOString(),
};
writeFileSync(resolve("deployments/elysiumTestnet.smoke.json"),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify(output,null,2));
