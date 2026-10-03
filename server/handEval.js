// server/handEval.js
// The card engine and hand evaluator — the single source of truth for who wins.
//
// This lived inside server/index.js, and test/holdem.test.mjs carried its own
// copy "mirrored from server/index.js". Those two had already drifted (only
// cosmetically, as it happened), and nothing would have stopped the next
// divergence from being semantic — 94 passing tests proving a copy correct
// while the server ran something else. Exactly how the pinned deploy artifacts
// went stale. One copy, imported by both.

import crypto from 'node:crypto';

// ─── CARD ENGINE ─────────────────────────────────────────────────────────────
export const SUITS = ["S","H","D","C"];
export const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
export const RV    = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));

export function makeDeck() {
  return SUITS.flatMap(s => RANKS.map(r => `${r}${s}`));
}
export function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─── HAND EVALUATOR ──────────────────────────────────────────────────────────
export function evalFive(cs) {
  const v = cs.map(c => RV[c[0] === 'T' ? 'T' : c[0]]).sort((a,b)=>b-a);
  const ss = cs.map(c => c.slice(-1));
  const flush = ss.every(x => x === ss[0]);
  const uniq = [...new Set(v)];
  const cnts = uniq.map(x=>({x,n:v.filter(y=>y===x).length})).sort((a,b)=>b.n-a.n||b.x-a.x);
  const str   = uniq.length===5 && v[0]-v[4]===4;
  const wheel = uniq.length===5 && v[0]===14 && v[1]===5;
  // kickers: tiebreak values ordered by group size desc, then rank desc
  const kickers = cnts.map(c => c.x);
  if (flush && str && v[0]===14) return {r:9,n:"Royal Flush",        kickers:[14]};
  if (flush && (str||wheel))    return {r:8,n:"Straight Flush",      kickers:wheel?[5]:[v[0]]};
  if (cnts[0].n===4)            return {r:7,n:"Four of a Kind",      kickers};
  if (cnts[0].n===3&&cnts[1]?.n===2) return {r:6,n:"Full House",    kickers};
  if (flush)                    return {r:5,n:"Flush",               kickers:v};
  if (str||wheel)               return {r:4,n:"Straight",            kickers:wheel?[5]:[v[0]]};
  if (cnts[0].n===3)            return {r:3,n:"Three of a Kind",     kickers};
  if (cnts[0].n===2&&cnts[1]?.n===2) return {r:2,n:"Two Pair",      kickers};
  if (cnts[0].n===2)            return {r:1,n:"One Pair",            kickers};
  return {r:0,n:"High Card",kickers:v};
}
// Compare two evaluated hands: >0 means a wins, 0 means tie, <0 means b wins
export function compareHands(a, b) {
  if (a.r !== b.r) return a.r - b.r;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const ak = a.kickers[i] ?? 0, bk = b.kickers[i] ?? 0;
    if (ak !== bk) return ak - bk;
  }
  return 0;
}
export function best7(cs) {
  let b = null;
  for (let i=0;i<cs.length-1;i++)
    for (let j=i+1;j<cs.length;j++) {
      const e = evalFive(cs.filter((_,k)=>k!==i&&k!==j));
      if (!b || compareHands(e,b) > 0) b = e;
    }
  return b || evalFive(cs);
}
export function bestOmaha(hole, comm) {
  let best = null;
  const holePairs = [];
  for (let i=0;i<hole.length-1;i++)
    for (let j=i+1;j<hole.length;j++) holePairs.push([hole[i],hole[j]]);
  const commTrips = [];
  for (let i=0;i<comm.length-2;i++)
    for (let j=i+1;j<comm.length-1;j++)
      for (let k=j+1;k<comm.length;k++) commTrips.push([comm[i],comm[j],comm[k]]);
  for (const hp of holePairs)
    for (const ct of commTrips) {
      const e = evalFive([...hp,...ct]);
      if (!best || compareHands(e,best) > 0) best = e;
    }
  return best;
}
