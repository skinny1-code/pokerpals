// server/seating.js
// Which seat a joining player gets.
//
// A player who names a seat gets that seat or nothing. Quietly seating them
// somewhere else is worse than telling them it was taken: seat choice is
// positional — you pick a seat to sit behind particular opponents, or to act
// after them — so "any free chair" is not a substitute for the one asked for.
//
// Only a join with no preference falls back to the first open seat.

/**
 * @param taken         iterable of occupied seat indices
 * @param maxPlayers    seats at the table
 * @param preferredSeat the seat asked for, or null/undefined for "anywhere"
 * @returns { ok: true, seatIndex } | { ok: false, reason }
 */
export function chooseSeat({ taken, maxPlayers, preferredSeat }) {
  const occupied = taken instanceof Set ? taken : new Set(taken || []);

  if (preferredSeat != null) {
    if (!Number.isInteger(preferredSeat) || preferredSeat < 0 || preferredSeat >= maxPlayers) {
      return { ok: false, reason: 'no-such-seat' };
    }
    if (occupied.has(preferredSeat)) return { ok: false, reason: 'seat-taken' };
    return { ok: true, seatIndex: preferredSeat };
  }

  for (let i = 0; i < maxPlayers; i++) if (!occupied.has(i)) return { ok: true, seatIndex: i };
  return { ok: false, reason: 'table-full' };
}
