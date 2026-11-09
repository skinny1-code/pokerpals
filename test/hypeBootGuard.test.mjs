import assert from "node:assert/strict";
import { assertNativeHypeBootReady } from "../server/hypeBootGuard.js";

const operatorAddress = "0x" + "a".repeat(40);
const escrowAddress = "0x" + "b".repeat(40);
const oracleAddress = "0x" + "c".repeat(40);
const manifest = {
  chainId:99801, assetMode:"NATIVE_HYPE_TEST_ONLY",
  operatorSigner:operatorAddress, verificationOracle:oracleAddress,
  contracts:{NativeHypePokerEscrow:escrowAddress},
};
const provider = { async getNetwork(){return {chainId:99801n}},async getCode(){return "0x60006000"} };
const escrow = { async operatorSigner(){return operatorAddress},async verificationOracle(){return oracleAddress} };
const input = {provider,escrow,operatorAddress,escrowAddress,manifest};
assert.equal((await assertNativeHypeBootReady(input)).chainId,99801n);
await assert.rejects(assertNativeHypeBootReady({...input,provider:{...provider,getNetwork:async()=>({chainId:99901n})}}),/RPC_CHAIN/);
await assert.rejects(assertNativeHypeBootReady({...input,provider:{...provider,getCode:async()=> "0x"}}),/MISSING_CODE/);
await assert.rejects(assertNativeHypeBootReady({...input,escrow:{...escrow,operatorSigner:async()=>oracleAddress}}),/OPERATOR_MISMATCH/);
await assert.rejects(assertNativeHypeBootReady({...input,escrow:{...escrow,verificationOracle:async()=>operatorAddress}}),/ORACLE_MISMATCH/);
await assert.rejects(assertNativeHypeBootReady({...input,manifest:{...manifest,chainId:99901}}),/MANIFEST_MISMATCH/);
await assert.rejects(assertNativeHypeBootReady({...input,manifest:{...manifest,operatorSigner:oracleAddress}}),/MANIFEST_MISMATCH/);
console.log("HYPE fail-closed startup guard tests passed (7 assertions)");
