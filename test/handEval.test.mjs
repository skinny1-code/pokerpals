/**
 * The hand evaluator, checked against an independent implementation.
 * Run: node test/handEval.test.mjs
 *
 * Who wins a hand decides who gets the money, so this does not spot-check
 * examples — it compares the real evaluator against a reference written with a
 * different algorithm (straights by bitmask rather than unique-count-plus-span,
 * categories by count signature rather than a chain of ifs) so a bug would have
 * to be arrived at twice, independently.
 *
 * Also guards the duplication that made this necessary: test/holdem.test.mjs
 * used to carry its own copy of the evaluator "mirrored from server/index.js".
 * Those two had already drifted. 94 green tests can prove a copy correct while
 * the server runs something else.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { evalFive, compareHands, best7, makeDeck, shuffle } from '../server/handEval.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const RVAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };

/** Reference evaluator — deliberately a different algorithm. */
function ref5(cards) {
  const ranks = cards.map(c => RVAL[c[0]]);
  const suits = cards.map(c => c[c.length - 1]);
  const flush = suits.every(s => s === suits[0]);
  const count = new Map();
  for (const r of ranks) count.set(r, (count.get(r) || 0) + 1);
  const sig = [...count.values()].sort((a, b) => b - a);

  let mask = 0;
  for (const r of ranks) mask |= 1 << r;
  if (count.has(14)) mask |= 1 << 1;          // ace plays low for the wheel
  let hi = 0;
  for (let h = 14; h >= 5; h--) {
    const need = (1<<h) | (1<<(h-1)) | (1<<(h-2)) | (1<<(h-3)) | (1<<(h-4));
    if ((mask & need) === need) { hi = h; break; }
  }
  const byCount = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(e => e[0]);
  const desc = [...ranks].sort((a, b) => b - a);

  if (hi && flush)                       return { cat: 8, tie: [hi] };
  if (sig[0] === 4)                      return { cat: 7, tie: byCount };
  if (sig[0] === 3 && sig[1] === 2)      return { cat: 6, tie: byCount };
  if (flush)                             return { cat: 5, tie: desc };
  if (hi)                                return { cat: 4, tie: [hi] };
  if (sig[0] === 3)                      return { cat: 3, tie: byCount };
  if (sig[0] === 2 && sig[1] === 2)      return { cat: 2, tie: byCount };
  if (sig[0] === 2)                      return { cat: 1, tie: byCount };
  return { cat: 0, tie: desc };
}
const refCompare = (a, b) => {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.tie.length, b.tie.length); i++) {
    const x = a.tie[i] ?? 0, y = b.tie[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
};
// The real evaluator ranks a royal flush 9 and every other straight flush 8;
// the reference calls both 8 and separates them by high card. Same ordering.
const realCat = h => (h.r === 9 ? 8 : h.r);
const sign = n => (n > 0 ? 1 : n < 0 ? -1 : 0);

const deck = makeDeck();
const FULL = process.env.EVAL_EXHAUSTIVE === 'true';

console.log(FULL ? 'every five-card hand (C(52,5))' : 'five-card hands (sampled; EVAL_EXHAUSTIVE=true for all 2.6M)');
{
  let n = 0, bad = 0, first = null;
  const consider = hand => {
    const got = evalFive(hand), want = ref5(hand);
    n++;
    if (realCat(got) !== want.cat && !first) { first = { hand, got: got.n, wantCat: want.cat }; }
    if (realCat(got) !== want.cat) bad++;
  };
  if (FULL) {
    for (let a=0;a<48;a++) for (let b=a+1;b<49;b++) for (let c=b+1;c<50;c++)
    for (let d=c+1;d<51;d++) for (let e=d+1;e<52;e++)
      consider([deck[a],deck[b],deck[c],deck[d],deck[e]]);
  } else {
    // A fixed stride across the same enumeration — deterministic, and it still
    // reaches every hand category many times over.
    let i = 0;
    for (let a=0;a<48;a++) for (let b=a+1;b<49;b++) for (let c=b+1;c<50;c++)
    for (let d=c+1;d<51;d++) for (let e=d+1;e<52;e++)
      if ((i++ % 37) === 0) consider([deck[a],deck[b],deck[c],deck[d],deck[e]]);
  }
  check(`${n.toLocaleString()} hands agree on category`, bad === 0, JSON.stringify(first));
}

console.log('ordering — the part that decides who gets paid');
{
  const rnd = n => Math.floor(Math.random() * n);
  const hand = k => { const d=[...deck]; for (let i=0;i<k;i++){const j=i+rnd(d.length-i);[d[i],d[j]]=[d[j],d[i]];} return d.slice(0,k); };
  let bad5 = 0, bad7 = 0, badCat7 = 0, first = null;
  for (let i = 0; i < 40000; i++) {
    const h1 = hand(5), h2 = hand(5);
    if (sign(compareHands(evalFive(h1), evalFive(h2))) !== sign(refCompare(ref5(h1), ref5(h2)))) {
      bad5++; if (!first) first = { h1, h2 };
    }
  }
  check('40,000 five-card comparisons agree on the winner', bad5 === 0, JSON.stringify(first));

  const refBest7 = cards => {
    let best = null;
    for (let i=0;i<7;i++) for (let j=i+1;j<7;j++) {
      const e = ref5(cards.filter((_,k) => k!==i && k!==j));
      if (!best || refCompare(e, best) > 0) best = e;
    }
    return best;
  };
  for (let i = 0; i < 12000; i++) {
    const c1 = hand(7), c2 = hand(7);
    const r1 = best7(c1), r2 = best7(c2), w1 = refBest7(c1), w2 = refBest7(c2);
    if (realCat(r1) !== w1.cat) badCat7++;
    if (sign(compareHands(r1, r2)) !== sign(refCompare(w1, w2))) bad7++;
  }
  check('12,000 seven-card hands agree on category', badCat7 === 0);
  check('12,000 seven-card comparisons agree on the winner', bad7 === 0);
}

console.log('the deck and the shuffle');
{
  const d = makeDeck();
  check('52 cards', d.length === 52);
  check('all distinct', new Set(d).size === 52);
  const s = shuffle(d);
  check('shuffling preserves the multiset', new Set(s).size === 52 && s.length === 52);
  check('shuffling does not mutate the input', d.join() === makeDeck().join());
  // A shuffle that returned the deck unchanged every time would pass the checks
  // above, so confirm it actually moves cards.
  let moved = 0;
  for (let i = 0; i < 20; i++) if (shuffle(d).join() !== d.join()) moved++;
  check('shuffle actually permutes', moved === 20, `${moved}/20`);
}

console.log('kickers must be compared numerically, not as text');
{
  // server/botBrain.js chose its best five of seven with
  //   h.kick.join(',') > top.kick.join(',')
  // which compares "14,10,9,8" against "14,9,8,3" as strings: '1' < '9', so the
  // worse hand won. Any two-digit rank (T–A) lost to a single-digit one. The
  // real comparison must be numeric.
  const better = evalFive(['AS','AH','TD','9C','8S']);   // aces, T-9-8 kickers
  const worse  = evalFive(['AS','AH','9C','8S','3H']);   // aces, 9-8-3 kickers
  check('the T-9-8 kicker hand is correctly ranked higher', compareHands(better, worse) > 0,
    `${JSON.stringify(better.kickers)} vs ${JSON.stringify(worse.kickers)}`);
  check('a string comparison would have got it backwards',
    !(better.kickers.join(',') > worse.kickers.join(',')));

  // The same trap, one category up.
  const b2 = evalFive(['KS','KH','TD','4C','3S']);
  const w2 = evalFive(['KS','KH','9D','4C','3S']);
  check('kings with a ten beat kings with a nine', compareHands(b2, w2) > 0);
  check('and text ordering would have reversed that too',
    !(b2.kickers.join(',') > w2.kickers.join(',')));
}

console.log('the evaluator exists in exactly one place');
{
  // The regression this file was written for: a second copy of evalFive whose
  // tests pass while the server runs the first copy.
  const walk = dir => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '.next' || f === '.git' || f === 'artifacts') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  // src/games/omaha.js is exempt: it is an unwired variant-game sketch using a
  // different card representation ({s, r} objects rather than "AH" strings), so
  // it is not a copy of this evaluator and cannot be merged with it. Nothing
  // imports it today. If it is ever wired up it needs its own differential
  // tests, not a line in this exemption.
  const EXEMPT = ['src/games/omaha.js'];
  const defs = walk('.')
    .filter(p => /\.(js|mjs|jsx)$/.test(p))
    .filter(p => /function\s+evalFive\s*\(/.test(readFileSync(p, 'utf8')))
    .map(p => p.replace(/^\.\//, ''))
    .filter(p => !EXEMPT.includes(p));
  check('only server/handEval.js defines evalFive', defs.length === 1 && defs[0].endsWith('handEval.js'),
    JSON.stringify(defs));
  check('holdem tests import it rather than copying it',
    /from '\.\.\/server\/handEval\.js'/.test(readFileSync('test/holdem.test.mjs', 'utf8')));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
