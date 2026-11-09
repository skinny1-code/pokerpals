// Lossless adapter between the legacy game's integer chip accounting and
// Kinetiq Elysium native HYPE (18 decimals). One integer game unit = 0.000001 HYPE.
// The legacy game server remains disabled for HYPE until end-to-end integration
// proves ledger reconciliation and confirms each hand on-chain.
export const WEI_PER_GAME_UNIT = 1_000_000_000_000n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

export function gameUnitsToWei(units) {
  if (!Number.isSafeInteger(units) || units < 0) throw new RangeError("Unsafe HYPE game-unit amount");
  return BigInt(units) * WEI_PER_GAME_UNIT;
}

export function weiToGameUnits(wei) {
  if (typeof wei !== "bigint" || wei < 0n ||
      wei % WEI_PER_GAME_UNIT !== 0n || wei / WEI_PER_GAME_UNIT > MAX) {
    throw new RangeError("HYPE precision loss or unsafe bankroll");
  }
  return Number(wei / WEI_PER_GAME_UNIT);
}

export function assertConservedBankroll(players, next, expectedWei) {
  if (!Array.isArray(players) || !Array.isArray(next) ||
      players.length < 2 || players.length > 9 ||
      players.length !== next.length || typeof expectedWei !== "bigint" || expectedWei < 0n) {
    throw new TypeError("Invalid native-HYPE settlement");
  }
  const seen = new Set();
  for (const player of players) {
    if (typeof player !== "string" || !/^0x[a-f\d]{40}$/i.test(player) ||
        seen.has(player.toLowerCase())) throw new TypeError("Invalid or duplicate player");
    seen.add(player.toLowerCase());
  }
  const total = next.reduce((sum, amount) => sum + gameUnitsToWei(amount), 0n);
  if (total !== expectedWei) throw new RangeError("Settlement does not conserve escrowed HYPE");
  return total;
}
