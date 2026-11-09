// Testnet-only on-chain settlement adapter for the legacy poker game state engine.
// Never infer on-chain bankroll from the client's supplied amounts.
import { gameUnitsToWei, weiToGameUnits, assertConservedBankroll } from "./nativeHypeCodec.js";

export async function settleHypeHand({ table, escrow, operator, ethers, chainId, escrowAddress }) {
  const id = BigInt(table.id);
  const [seats, info] = await Promise.all([escrow.getSeats(id), escrow.getTableInfo(id)]);
  const nonce = BigInt(table.handNonce);
  if (BigInt(info.handNonce) !== nonce) throw new Error("HYPE_NONCE_MISMATCH");
  if (Number(info.status) !== 1) throw new Error("HYPE_TABLE_NOT_ACTIVE");
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 9)
    throw new Error("HYPE_UNEXPECTED_SEATS");
  const indexed = new Map(table.players.map(p => [p.addr.toLowerCase(), p]));
  const allSeats = new Set(seats.map(addr => addr.toLowerCase()));
  for (const key of indexed.keys()) if (!allSeats.has(key)) throw new Error("HYPE_UNBACKED_PLAYER");

  const balances = [];
  for (const addr of seats) {
    const player = indexed.get(addr.toLowerCase());
    if (player) {
      balances.push(player.chips);
    } else {
      // Zero-stack busted players remain seated on-chain until they rebuy
      // or withdraw; never silently wipe a disconnected player's funds.
      const prior = await escrow.getPlayerDeposit(id, addr);
      if (prior !== 0n) throw new Error("HYPE_MISSING_FUNDED_PLAYER");
      balances.push(0);
    }
  }
  assertConservedBankroll(seats, balances, BigInt(info.potTotal));
  const nextWei = balances.map(gameUnitsToWei);

  // Hash must match NativeHypePokerEscrow's abi.encode("HYPE_SETTLE_V1", ...).
  const digest = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["string","uint256","address","uint256","uint256","address[]","uint256[]"],
    ["HYPE_SETTLE_V1", chainId, escrowAddress, id, nonce, seats, nextWei]
  ));
  const sig = await operator.signMessage(ethers.getBytes(digest));
  const tx = await escrow.settleBalances(id, nonce, seats, nextWei, sig);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("HYPE_SETTLEMENT_REVERTED");
  const after = await escrow.getTableInfo(id);
  if (BigInt(after.handNonce) !== nonce + 1n ||
      BigInt(after.potTotal) !== BigInt(info.potTotal))
    throw new Error("HYPE_POST_SETTLEMENT_INVARIANT");

  return { txHash: tx.hash, nonce: nonce + 1n, bankroll: BigInt(after.potTotal) };
}

export async function cashOutHypePlayer({ table, escrow, operator, ethers, chainId, escrowAddress, addr }) {
  const id = BigInt(table.id);
  const player = table.players.find(p => p.addr.toLowerCase() === addr.toLowerCase());
  if (!player) throw new Error("HYPE_PLAYER_NOT_IN_GAME");
  const expected = gameUnitsToWei(player.chips);
  const onChain = await escrow.getPlayerDeposit(id, addr);
  if (expected !== onChain) throw new Error("HYPE_CASHOUT_BALANCE_MISMATCH");
  const nonce = await escrow.cashOutNonce(id, addr);
  const digest = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["string","uint256","address","uint256","address","uint256","uint256"],
    ["HYPE_CASHOUT_V1", chainId, escrowAddress, id, addr, expected, nonce]
  ));
  const sig = await operator.signMessage(ethers.getBytes(digest));
  const tx = await escrow.cashOut(id, addr, expected, nonce, sig);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("HYPE_CASHOUT_REVERTED");
  const remaining = await escrow.getPlayerDeposit(id, addr);
  if (remaining !== 0n) throw new Error("HYPE_CASHOUT_NOT_CLEARED");
  return { txHash: tx.hash, amount: expected, gameUnits: weiToGameUnits(expected) };
}
