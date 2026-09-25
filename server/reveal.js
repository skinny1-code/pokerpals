// server/reveal.js
// Who can see whose hole cards.
//
// This used to be one condition inside pubState: `p.addr === forAddr ||
// this.phase === 'showdown'`. Two things wrong with it, both of which leak
// information a player is entitled to keep:
//
//   1. It exposed the winner of a hand nobody called. Folding everyone out wins
//      the pot without showing anything — that is the whole reason bluffing
//      works. Showing those cards for free tells the table how the winner plays.
//   2. It exposed folded players. A fold is never shown, ever.
//
// So visibility is a rule about what happened in the hand, not about which
// phase the table is in.

/**
 * @param player          the seat being looked at: { addr, folded, revealed }
 * @param forAddr         who is looking (null = the broadcast view)
 * @param phase           the table's current phase
 * @param wentToShowdown  two or more players were still in at the end
 * @param showdownSeats   Set of addresses that reached that showdown
 */
export function canRevealHand({ player, forAddr, phase, wentToShowdown, showdownSeats }) {
  if (!player) return false;
  if (forAddr && player.addr === forAddr) return true;   // your own cards, always
  if (player.revealed) return true;                       // they chose to show
  if (phase !== 'showdown') return false;                 // never mid-hand
  if (player.folded) return false;                        // a fold is never shown
  if (!wentToShowdown) return false;                      // nobody called
  return !!showdownSeats && showdownSeats.has(player.addr);
}

/**
 * Whether `addr` may still elect to show. Only meaningful for a hand that was
 * not contested — showing is the winner's choice, and only while the finished
 * hand is still on screen.
 */
export function canElectToShow({ player, phase }) {
  if (!player) return { ok: false, error: 'Not seated' };
  if (phase !== 'showdown') return { ok: false, error: 'Nothing to show right now' };
  if (!player.hand?.length) return { ok: false, error: 'No cards to show' };
  return { ok: true };
}
