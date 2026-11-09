import assert from "node:assert/strict";
import { gameUnitsToWei, weiToGameUnits, assertConservedBankroll } from "../server/nativeHypeCodec.js";

const players = ["0x"+"a".repeat(40),"0x"+"b".repeat(40)];
assert.equal(gameUnitsToWei(100), 100_000_000_000_000n);
assert.equal(weiToGameUnits(100_000_000_000_000n), 100);
assert.equal(weiToGameUnits(gameUnitsToWei(9007199254740991)), 9007199254740991);
assert.equal(assertConservedBankroll(players, [500, 1500], gameUnitsToWei(2000)), gameUnitsToWei(2000));
assert.throws(() => gameUnitsToWei(0.1), /Unsafe/);
assert.throws(() => gameUnitsToWei(Number.MAX_SAFE_INTEGER + 1), /Unsafe/);
assert.throws(() => weiToGameUnits(1n), /precision loss/);
assert.throws(() => assertConservedBankroll(players, [500, 1501], gameUnitsToWei(2000)), /conserve/);
assert.throws(() => assertConservedBankroll([players[0],players[0]], [1000,1000], gameUnitsToWei(2000)), /duplicate/);
console.log("Native HYPE fixed-point and conservation tests passed (9 assertions).");
