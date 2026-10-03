// server/botBrain.js — medium-skill poker decision engine for in-process bots.
//
// Self-contained (own 5/7-card evaluator over the server's string card
// notation, e.g. "AH", "TS") so it can be unit-tested without loading the
// server. Strategy targets a solid-but-beatable "medium" opponent:
//   - Preflop: Chen-formula hand scoring with position and raise awareness
//   - Postflop: made-hand buckets + draw detection, pot-odds calls,
//     value bets ~2/3 pot, continuation bets, occasional semi-bluffs
//   - Mixed (randomized) decisions so it can't be exploited by rote
//
// decide(ctx, rng) is pure given its rng — pass a seeded rng in tests.

import { evalFive, best7, compareHands, RV, RANKS } from './handEval.js';


// ─── Evaluator ───────────────────────────────────────────────────────────────
// Imported, not reimplemented. This file used to carry its own third copy of
// evalFive, and its best-of-7 selection compared hands with
// `h.kickers.join(',') > top.kickers.join(',')` — a STRING comparison of numbers, so
// "10,9" sorted below "9,8" and any two-digit rank (T through A) lost to a
// single-digit one. The bot therefore picked the wrong best five from seven
// cards whenever its real best hand contained a ten or higher, and then bet on
// that misreading. House bots play with house chips, so that was the house
// paying for it.

function best(cards) {
  return cards.length === 5 ? evalFive(cards) : best7(cards);
}

// ─── Preflop: Chen formula ───────────────────────────────────────────────────
export function chenScore(hand) {
  const [c1, c2] = hand;
  const hi = Math.max(RV[c1[0]], RV[c2[0]]);
  const lo = Math.min(RV[c1[0]], RV[c2[0]]);
  const suited = c1.slice(-1) === c2.slice(-1);
  const gap = hi - lo;

  // Standard Chen formula: high-card base, doubled pairs (min 5), +2 suited,
  // true-gap penalties, +1 for connected low cards.
  let score = hi === 14 ? 10 : hi === 13 ? 8 : hi === 12 ? 7 : hi === 11 ? 6 : hi / 2;
  if (hi === lo) return Math.max(5, score * 2);
  if (suited) score += 2;
  const trueGap = gap - 1;
  if (trueGap === 1) score -= 1;
  else if (trueGap === 2) score -= 2;
  else if (trueGap === 3) score -= 4;
  else if (trueGap >= 4) score -= 5;
  if (trueGap <= 1 && hi < 12) score += 1;
  return Math.round(score * 2) / 2;
}

// ─── Draw detection ──────────────────────────────────────────────────────────
function draws(hand, community) {
  const cards = [...hand, ...community];
  const suits = {};
  for (const c of cards) suits[c.slice(-1)] = (suits[c.slice(-1)] || 0) + 1;
  const flushDraw = Object.entries(suits).some(([s, n]) =>
    n === 4 && hand.some(h => h.slice(-1) === s));

  const vals = [...new Set(cards.map(c => RV[c[0]]))].sort((a, b) => a - b);
  if (vals.includes(14)) vals.unshift(1); // wheel ace
  let oesd = false;
  for (let i = 0; i + 3 < vals.length; i++) {
    if (vals[i + 3] - vals[i] === 3) { // 4 in a row
      const usesHole = hand.some(h => {
        const v = RV[h[0]];
        return v >= vals[i] && v <= vals[i + 3];
      });
      if (usesHole && vals[i] > 1 && vals[i + 3] < 14) oesd = true;
    }
  }
  return { flushDraw, oesd };
}

// ─── Postflop hand-strength bucket ───────────────────────────────────────────
// 3 = monster (two pair+), 2 = strong (top pair / overpair),
// 1 = medium (any other pair / good ace-high), 0 = air
function bucket(hand, community) {
  const h = best([...hand, ...community]);
  if (h.r >= 2) return 3;
  if (h.r === 1) {
    const boardTop = Math.max(...community.map(c => RV[c[0]]));
    const pairRank = h.kickers[0];
    const holeVals = hand.map(c => RV[c[0]]);
    const usesHole = holeVals.includes(pairRank);
    if (usesHole && pairRank >= boardTop) return 2;  // top pair or overpair
    return 1;
  }
  return Math.max(...hand.map(c => RV[c[0]])) === 14 ? 1 : 0;
}

// ─── Decision engine ─────────────────────────────────────────────────────────
// ctx: { hand, community, phase, pot, toCall, chips, bigBlind, minRaise,
//        numActive, lastToAct (bool: late position), wasRaisedPre }
export function decide(ctx, rng = Math.random) {
  const { hand, community, phase, pot, toCall, chips, bigBlind, minRaise } = ctx;
  const bb = Math.max(1, bigBlind);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const clampRaise = (want) => {
    const amt = Math.max(minRaise, Math.round(want / bb) * bb);
    // If the raise would put us (nearly) all-in, shove instead.
    return (ctx.myBet ?? 0) + toCall + amt >= chips * 0.9
      ? { action: 'allin', amount: 0 }
      : { action: 'raise', amount: amt };
  };
  const callOrFold = (maxOdds) => {
    if (toCall === 0) return { action: 'check', amount: 0 };
    if (toCall >= chips) return null; // caller decides all-in cases explicitly
    return potOdds <= maxOdds ? { action: 'call', amount: 0 } : { action: 'fold', amount: 0 };
  };

  if (phase === 'preflop') {
    const score = chenScore(hand);
    const bigRaiseFacing = toCall > bb * 2;
    if (score >= 12) {
      // Premium: raise/3-bet, call shoves
      if (toCall >= chips) return { action: 'call', amount: 0 };
      return clampRaise(bigRaiseFacing ? toCall * 2 : bb * 3);
    }
    if (score >= 9) {
      // Strong: open-raise unraised pots, call reasonable raises
      if (toCall <= bb && rng() < 0.8) return clampRaise(bb * 2.5);
      if (toCall >= chips) return potOdds <= 0.45 && score >= 10.5 ? { action: 'call', amount: 0 } : { action: 'fold', amount: 0 };
      return callOrFold(0.35) ?? { action: 'fold', amount: 0 };
    }
    if (score >= 6) {
      // Playable: limp/call small, fold to big aggression
      if (toCall === 0) return { action: 'check', amount: 0 };
      if (toCall >= chips) return { action: 'fold', amount: 0 };
      return callOrFold(bigRaiseFacing ? 0.15 : 0.25) ?? { action: 'fold', amount: 0 };
    }
    // Trash: check when free, occasionally steal from late position
    if (toCall === 0) {
      if (ctx.lastToAct && ctx.numActive <= 3 && rng() < 0.15) return clampRaise(bb * 2.5);
      return { action: 'check', amount: 0 };
    }
    return { action: 'fold', amount: 0 };
  }

  // ── Postflop ──
  const b = bucket(hand, community);
  const d = phase !== 'river' ? draws(hand, community) : { flushDraw: false, oesd: false };
  const streetsLeft = phase === 'flop' ? 2 : phase === 'turn' ? 1 : 0;
  const drawEquity = (d.flushDraw ? 0.09 : 0) + (d.oesd ? 0.08 : 0);
  const equityGuess = Math.min(0.9,
    (b === 3 ? 0.75 : b === 2 ? 0.55 : b === 1 ? 0.3 : 0.1) + drawEquity * streetsLeft);

  if (b === 3) {
    // Monster: bet/raise for value, occasionally trap by calling
    if (toCall === 0) return rng() < 0.8 ? clampRaise(pot * 0.65) : { action: 'check', amount: 0 };
    if (toCall >= chips) return { action: 'call', amount: 0 };
    return rng() < 0.5 ? clampRaise(Math.max(toCall * 2, pot * 0.5)) : { action: 'call', amount: 0 };
  }

  if (b === 2) {
    // Strong: value bet when checked to; call medium pressure
    if (toCall === 0) return rng() < 0.7 ? clampRaise(pot * 0.6) : { action: 'check', amount: 0 };
    if (toCall >= chips) return potOdds <= 0.4 ? { action: 'call', amount: 0 } : { action: 'fold', amount: 0 };
    return callOrFold(0.38) ?? { action: 'fold', amount: 0 };
  }

  // Draws: semi-bluff sometimes, otherwise strictly pot-odds
  if (d.flushDraw || d.oesd) {
    if (toCall === 0) {
      return rng() < 0.35 ? clampRaise(pot * 0.55) : { action: 'check', amount: 0 };
    }
    if (toCall >= chips) return { action: 'fold', amount: 0 };
    return potOdds <= equityGuess ? { action: 'call', amount: 0 } : { action: 'fold', amount: 0 };
  }

  if (b === 1) {
    // Medium: check/call one small bet, fold to real pressure
    if (toCall === 0) return { action: 'check', amount: 0 };
    if (toCall >= chips) return { action: 'fold', amount: 0 };
    return callOrFold(0.22) ?? { action: 'fold', amount: 0 };
  }

  // Air: c-bet the flop as the preflop aggressor sometimes, otherwise give up
  if (toCall === 0) {
    if (phase === 'flop' && ctx.wasRaisedPre && rng() < 0.5) return clampRaise(pot * 0.5);
    return { action: 'check', amount: 0 };
  }
  return { action: 'fold', amount: 0 };
}
