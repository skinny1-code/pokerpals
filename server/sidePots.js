// server/sidePots.js
// Side-pot construction and award, kept pure so the money math is testable
// without booting a table.
//
// The table used to hold one scalar `pot` and hand all of it to the best hand.
// That is only correct when everyone can cover everyone else. Two ways it paid
// out chips that were never contested:
//
//   1. A short all-in wins more than they covered. A has 100 and is all-in; B
//      and C put in 2,000 each. The pot is 4,100, but A can only win 100 from
//      each opponent — 300. The other 3,800 is B-vs-C. Paying A all 4,100 takes
//      1,900 from each of them, and the operator signs that settlement.
//   2. An uncalled bet is never returned. A shoves 1,000, B calls 200 all-in.
//      A's extra 800 was never called; if B wins, B collects it.
//
// Both are the same omission — the pot has to be split by how much each player
// could actually be called for.

/**
 * Split a hand's contributions into pots by all-in level.
 *
 * @param players [{ addr, committed, folded }] — `committed` is total chips put
 *   in across every street of this hand, folded players included: their chips
 *   stay in the pot, they are just not eligible to win it.
 * @returns [{ amount, eligible: [addr], contributors: [addr] }] in ascending
 *   cap order. `eligible` are the unfolded players who can win that pot;
 *   `contributors` are everyone who paid into it.
 */
export function buildSidePots(players) {
  const live = players.filter(p => Number(p.committed) > 0);
  if (!live.length) return [];

  const levels = [...new Set(live.map(p => Number(p.committed)))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;

  for (const level of levels) {
    let amount = 0;
    const contributors = [];
    for (const p of live) {
      const c = Number(p.committed);
      const slice = Math.min(c, level) - Math.min(c, prev);
      if (slice > 0) { amount += slice; contributors.push(p.addr); }
    }
    if (amount > 0) {
      const eligible = live.filter(p => !p.folded && Number(p.committed) >= level).map(p => p.addr);
      pots.push({ amount, eligible, contributors });
    }
    prev = level;
  }
  return pots;
}

/**
 * Award pots to the best eligible hand in each.
 *
 * @param pots from buildSidePots
 * @param rankedGroups [[addr, …], …] best hand first, tied addresses grouped.
 *   Only unfolded players appear.
 * @returns { won, refunds } — two Maps of addr -> chips, kept apart because
 *   they are not the same kind of money. `won` is pot a player took at
 *   showdown. `refunds` is their own uncalled bet coming back, which is not
 *   winnings: it never reached a contest, so it must not be raked, and the
 *   caller returns it to the stack instead of settling it.
 *
 *   Between them every chip in every pot is assigned — the totals are asserted
 *   equal in the tests, because chips silently vanishing from a table whose
 *   escrow still holds them is its own bug.
 */
export function awardPots(pots, rankedGroups) {
  const payouts = new Map();
  const refunds = new Map();
  const add = (addr, n) => { if (n > 0) payouts.set(addr, (payouts.get(addr) || 0) + n); };
  const refund = (addr, n) => { if (n > 0) refunds.set(addr, (refunds.get(addr) || 0) + n); };

  for (const pot of pots) {
    const eligible = new Set(pot.eligible);
    const winners = (rankedGroups.find(g => g.some(a => eligible.has(a))) || [])
      .filter(a => eligible.has(a));

    if (winners.length) {
      // A pot that contains nobody else's money was never contested: its
      // winners are its only contributors, so this is their own bet coming
      // back. The common case is a shove larger than anyone could call. Real
      // rooms return it before raking, and so must we — every contributor is
      // made exactly whole, so raking it would take money out of a pot that
      // nobody won.
      const uncontested = winners.length === pot.contributors.length;
      const give = uncontested ? refund : add;

      // Split, then hand the odd chips to the first winner. Real rooms award
      // them by seat order from the dealer; any fixed rule is fine as long as
      // nothing is lost, and this one is deterministic.
      const each = Math.floor(pot.amount / winners.length);
      winners.forEach(a => give(a, each));
      give(winners[0], pot.amount - each * winners.length);
      continue;
    }

    // No eligible winner: everyone who reached this level folded, so this is an
    // uncalled bet. Return it to whoever put it in, pro rata.
    const share = Math.floor(pot.amount / pot.contributors.length);
    pot.contributors.forEach(a => refund(a, share));
    refund(pot.contributors[0], pot.amount - share * pot.contributors.length);
  }
  return { won: payouts, refunds };
}

/**
 * Express per-player payouts as basis points of the total pot, for
 * PokerEscrow.settle(winners, shares) where shares must sum to exactly 1000.
 *
 * Largest-remainder allocation, then a floor of 1 bps for anyone owed chips, so
 * a small side pot does not round away to nothing on-chain. Both corrections
 * preserve the sum.
 *
 * @returns { winners: [addr], shares: [number] } ordered by payout, largest first.
 */
export function payoutsToShares(payouts, totalPot) {
  const entries = [...payouts.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length || totalPot <= 0) return { winners: [], shares: [] };

  const exact = entries.map(([addr, amount]) => ({ addr, raw: (amount * 1000) / totalPot }));
  const shares = exact.map(e => Math.floor(e.raw));
  let remaining = 1000 - shares.reduce((a, b) => a + b, 0);

  // Hand the leftover bps to the largest fractional parts first.
  const byRemainder = exact
    .map((e, i) => ({ i, frac: e.raw - Math.floor(e.raw) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0; k = (k + 1) % byRemainder.length) {
    shares[byRemainder[k].i] += 1;
    remaining -= 1;
  }

  // Nobody owed chips should end at zero. Take from the largest holder.
  for (let i = 0; i < shares.length; i++) {
    if (shares[i] !== 0) continue;
    const donor = shares.indexOf(Math.max(...shares));
    if (shares[donor] > 1) { shares[donor] -= 1; shares[i] += 1; }
  }

  return { winners: entries.map(e => e[0]), shares };
}
