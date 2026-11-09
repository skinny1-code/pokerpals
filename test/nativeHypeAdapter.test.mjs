import assert from "node:assert/strict";
import { settleHypeHand, cashOutHypePlayer } from "../server/nativeHypeAdapter.js";
import { gameUnitsToWei } from "../server/nativeHypeCodec.js";

// All chain, cryptographic and signer operations are mocked for deterministic
// server-adapter control-flow QA. Solidity integration is covered separately
// in test/contracts/NativeHypePokerEscrow.test.js.
const a = "0x" + "a".repeat(40), b = "0x" + "b".repeat(40), c = "0x" + "c".repeat(40);
const contract = "0x" + "d".repeat(40);
const ethers = {
  AbiCoder: { defaultAbiCoder: () => ({ encode: (_types, vals) => JSON.stringify(vals, (_k,v) => typeof v === "bigint" ? String(v) : v) }) },
  keccak256: v => "0x" + "1".repeat(64),
  getBytes: v => v,
};
const operator = { signMessage: async _digest => "operator-signature" };
const expectThrow = async (action, match) => {
  let caught = null;
  try { await action(); } catch(e) { caught = e; }
  assert(caught, "Expected rejection");
  assert.match(String(caught.message), match);
};
function rig(opts={}) {
  const seats = opts.seats || [a,b];
  let balance = new Map([[a,gameUnitsToWei(1000)],[b,gameUnitsToWei(1000)]]);
  let nonce = 0n;
  let status = opts.status ?? 1n;
  const calls = [];
  const escrow = {
    async getSeats() { return seats; },
    async getTableInfo() { return {handNonce:nonce,status,potTotal:[...balance.values()].reduce((x,y)=>x+y,0n)}; },
    async getPlayerDeposit(_id,addr) { return balance.get(addr) ?? 0n; },
    async cashOutNonce() { return 0n; },
    async settleBalances(_tableId, sentNonce, players, amounts, sig) {
      assert.equal(sig,"operator-signature");
      assert.equal(sentNonce, nonce);
      assert.equal(Object.isFrozen(players), false, 'ABI array must be mutable');
      calls.push({kind:"settle",players,amounts});
      if (opts.revert) return {hash:"0xbad",wait:async()=>({status:0})};
      players.forEach((p,i)=>balance.set(p,amounts[i]));
      nonce++;
      return {hash:"0xsettle",wait:async()=>({status:1})};
    },
    async cashOut(_id,addr,amount,nonce,sig) {
      assert.equal(sig,"operator-signature");
      calls.push({kind:"cashOut",addr,amount,nonce});
      if (opts.revert) return {hash:"0xbad",wait:async()=>({status:0})};
      balance.set(addr,0n);
      return {hash:"0xcashout",wait:async()=>({status:1})};
    },
  };
  return {escrow,calls,balance};
}
function args(table,escrow) { return {table,escrow,operator,ethers,chainId:99801n,escrowAddress:contract}; }
const table = {id:1n,handNonce:0,players:[{addr:a,chips:1500},{addr:b,chips:500}]};

{
  const r=rig({seats:Object.freeze([a,b])}); // ethers.Result is read-only
  const out=await settleHypeHand(args(table,r.escrow));
  assert.equal(out.txHash,"0xsettle");
  assert.equal(out.nonce,1n);
  assert.equal(r.balance.get(a),gameUnitsToWei(1500));
  assert.equal(r.balance.get(b),gameUnitsToWei(500));
  assert.equal(r.calls.length,1);
}
{
  const r=rig();
  await expectThrow(()=>settleHypeHand(args({...table,players:[{addr:a,chips:1500},{addr:b,chips:501}]},r.escrow)),/conserve/);
  assert.equal(r.calls.length,0);
}
{
  const r=rig();
  await expectThrow(()=>settleHypeHand(args({...table,players:[{addr:a,chips:2000},{addr:c,chips:0}]},r.escrow)),/HYPE_UNBACKED_PLAYER/);
  assert.equal(r.calls.length,0);
}
{
  const r=rig({revert:true});
  await expectThrow(()=>settleHypeHand(args(table,r.escrow)),/HYPE_SETTLEMENT_REVERTED/);
}
{
  const r=rig();
  const amount=await cashOutHypePlayer({...args({id:1n,players:[{addr:a,chips:1000}]},r.escrow),addr:a});
  assert.equal(amount.amount,gameUnitsToWei(1000));
  assert.equal(amount.gameUnits,1000);
  assert.equal(r.balance.get(a),0n);
}
{
  const r=rig();
  await expectThrow(()=>cashOutHypePlayer({...args({id:1n,players:[{addr:a,chips:1001}]},r.escrow),addr:a}),/HYPE_CASHOUT_BALANCE_MISMATCH/);
}
console.log("Native HYPE game-server adapter tests passed (settle, conservation, zero unbacked, revert, cashout).");
