/**
 * Side-pot tests — pure Node.js. Run: node test/sidePots.test.mjs
 *
 * These are money-conservation tests first and poker-rules tests second: every
 * chip put into a hand must come back out to somebody, and nobody may collect
 * chips they were never called for.
 */
import { buildSidePots, awardPots, payoutsToShares } from '../server/sidePots.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const total = (players) => players.reduce((a, p) => a + p.committed, 0);

/** Every hand: chips in must equal chips out, exactly. */
function conserves(players, rankedGroups) {
  const pots = buildSidePots(players);
  const { won, refunds } = awardPots(pots, rankedGroups);
  // Winnings and returned uncalled bets together must account for every chip.
  const payouts = new Map(won);
  for (const [a, n] of refunds) payouts.set(a, (payouts.get(a) || 0) + n);
  return { pots, payouts, won, refunds, ok: sum(payouts) === total(players) };
}

console.log('the bug: a short all-in cannot win chips it never covered');
{
  // A is all-in for 100. B and C each put in 2,000. Pot = 4,100.
  // A can win 100 from each opponent — 300 — and no more, whatever they hold.
  const players = [
    { addr: 'A', committed: 100,  folded: false },
    { addr: 'B', committed: 2000, folded: false },
    { addr: 'C', committed: 2000, folded: false },
  ];
  const { pots, payouts, ok } = conserves(players, [['A'], ['B'], ['C']]); // A has the nuts
  check('chips conserved', ok, `in=${total(players)} out=${sum(payouts)}`);
  check('A wins exactly the main pot', payouts.get('A') === 300, `${payouts.get('A')}`);
  check('B takes the side pot A could not contest', payouts.get('B') === 3800, `${payouts.get('B')}`);
  check('C wins nothing', !payouts.get('C'));
  check('two pots built', pots.length === 2, JSON.stringify(pots));
  // The old single-pot code paid A all 4,100 — 1,900 out of each opponent.
  check('A is not paid the whole pot', payouts.get('A') !== 4100);
}

console.log('the bug: an uncalled bet comes back');
{
  // A shoves 1,000; B calls 200 and is all-in. A's extra 800 was never called.
  const players = [
    { addr: 'A', committed: 1000, folded: false },
    { addr: 'B', committed: 200,  folded: false },
  ];
  const { payouts, ok } = conserves(players, [['B'], ['A']]); // B wins the showdown
  check('chips conserved', ok, `in=${total(players)} out=${sum(payouts)}`);
  const r1 = conserves(players, [['B'], ['A']]);
  check('B wins only the contested 400', r1.won.get('B') === 400, `${r1.won.get('B')}`);
  check('A gets the uncalled 800 back', r1.refunds.get('A') === 800, `${r1.refunds.get('A')}`);
  check('the returned bet is not counted as winnings', !r1.won.get('A'));
}

console.log('folded players fund the pot but cannot win it');
{
  const players = [
    { addr: 'A', committed: 500, folded: false },
    { addr: 'B', committed: 500, folded: false },
    { addr: 'C', committed: 300, folded: true  },  // called 300, then folded
  ];
  const { pots, payouts, ok } = conserves(players, [['A'], ['B']]);
  check('chips conserved', ok, `in=${total(players)} out=${sum(payouts)}`);
  check('A wins everything including the dead money', payouts.get('A') === 1300, `${payouts.get('A')}`);
  check('C wins nothing', !payouts.get('C'));
  check("C is in no pot's eligible list", pots.every(p => !p.eligible.includes('C')));
  check('C still funds the first pot', pots[0].contributors.includes('C'));
}

console.log('a folded over-bet is returned, not given to the survivor');
{
  // A bets 500 then folds to a re-raise; B is all-in at 200; C folded at 200.
  const players = [
    { addr: 'A', committed: 500, folded: true  },
    { addr: 'B', committed: 200, folded: false },
    { addr: 'C', committed: 200, folded: true  },
  ];
  const { payouts, ok } = conserves(players, [['B']]);
  check('chips conserved', ok, `in=${total(players)} out=${sum(payouts)}`);
  const r2 = conserves(players, [['B']]);
  check('B wins the 600 that was contested', r2.won.get('B') === 600, `${r2.won.get('B')}`);
  check("A's uncalled 300 returns to A", r2.refunds.get('A') === 300, `${r2.refunds.get('A')}`);
  check('a folded bettor wins nothing', !r2.won.get('A'));
}

console.log('three all-ins at three different levels');
{
  const players = [
    { addr: 'A', committed: 50,   folded: false },
    { addr: 'B', committed: 300,  folded: false },
    { addr: 'C', committed: 1000, folded: false },
    { addr: 'D', committed: 1000, folded: false },
  ];
  const pots = buildSidePots(players);
  check('three pots', pots.length === 3, JSON.stringify(pots.map(p => p.amount)));
  check('main pot is 50×4', pots[0].amount === 200, `${pots[0].amount}`);
  check('second is 250×3', pots[1].amount === 750, `${pots[1].amount}`);
  check('third is 700×2', pots[2].amount === 1400, `${pots[2].amount}`);
  check('pots sum to the hand', pots.reduce((a, p) => a + p.amount, 0) === total(players));

  // A wins the main, B the second, C and D chop the third.
  const { payouts, won, refunds, ok } = conserves(players, [['A'], ['B'], ['C', 'D']]);
  check('chips conserved', ok, `${sum(payouts)}`);
  check('A gets 200', payouts.get('A') === 200, `${payouts.get('A')}`);
  check('B gets 750', payouts.get('B') === 750, `${payouts.get('B')}`);
  check('C and D split 1400', payouts.get('C') === 700 && payouts.get('D') === 700);
  // C and D tied at the same all-in level, so the top pot is only their own two
  // bets handed straight back — nobody won anything there, and it is not raked.
  check('the top pot is returned, not won', refunds.get('C') === 700 && refunds.get('D') === 700,
    JSON.stringify([...refunds]));
  check('only the contested pots count as winnings', sum(won) === 950, `${sum(won)}`);
}

console.log('odd chips are kept, not dropped');
{
  const players = [
    { addr: 'A', committed: 335, folded: false },
    { addr: 'B', committed: 335, folded: false },
    { addr: 'C', committed: 335, folded: false },
  ];
  const { payouts, ok } = conserves(players, [['A', 'B', 'C']]); // three-way chop of 1005
  check('chips conserved — the odd chip survives', ok, `in=1005 out=${sum(payouts)}`);
  check('one player gets the extra', Math.max(...payouts.values()) === 335);
}

console.log('everyday hands still behave');
{
  const heads = [
    { addr: 'A', committed: 400, folded: false },
    { addr: 'B', committed: 400, folded: false },
  ];
  const r1 = conserves(heads, [['A'], ['B']]);
  check('winner takes the pot heads-up', r1.payouts.get('A') === 800 && r1.ok);

  const chop = conserves(heads, [['A', 'B']]);
  check('a chop splits it evenly', chop.payouts.get('A') === 400 && chop.payouts.get('B') === 400);

  const walk = [
    { addr: 'A', committed: 60, folded: false },
    { addr: 'B', committed: 20, folded: true  },
  ];
  const r2 = conserves(walk, [['A']]);
  check('uncontested pot goes to the last player standing', r2.payouts.get('A') === 80 && r2.ok);
}

console.log('degenerate inputs do not throw or invent chips');
{
  check('no players', buildSidePots([]).length === 0);
  check('nobody committed anything', buildSidePots([{ addr: 'A', committed: 0, folded: false }]).length === 0);
  check('awarding no pots pays nobody', awardPots([], [['A']]).won.size === 0);
  const solo = conserves([{ addr: 'A', committed: 100, folded: false }], [['A']]);
  check('a lone contributor gets it back', solo.payouts.get('A') === 100 && solo.ok);
}

console.log('payouts convert to basis points that sum to exactly 1000');
{
  const cases = [
    [new Map([['A', 300], ['B', 3800]]), 4100],
    [new Map([['A', 200], ['B', 750], ['C', 700], ['D', 700]]), 2350],
    [new Map([['A', 335], ['B', 335], ['C', 335]]), 1005],
    [new Map([['A', 800]]), 800],
    [new Map([['A', 1], ['B', 999999]]), 1000000],   // a payout worth < 1 bps
    [new Map([['A', 1], ['B', 1], ['C', 1], ['D', 999997]]), 1000000],
  ];
  for (const [payouts, pot] of cases) {
    const { winners, shares } = payoutsToShares(payouts, pot);
    const s = shares.reduce((a, b) => a + b, 0);
    check(`sum is 1000 for ${JSON.stringify([...payouts.values()])}`, s === 1000, `got ${s}`);
    check('  every payee is represented', winners.length === payouts.size);
    check('  nobody owed chips is rounded to zero', shares.every(x => x > 0), JSON.stringify(shares));
    check('  ordered by payout, largest first',
      winners.every((w, i) => i === 0 || payouts.get(winners[i - 1]) >= payouts.get(w)));
  }

  const { winners, shares } = payoutsToShares(new Map([['A', 300], ['B', 3800]]), 4100);
  check('shares track the split (A≈73, B≈927)',
    shares[0] === 927 && shares[1] === 73 && winners[0] === 'B', JSON.stringify({ winners, shares }));

  check('empty payouts produce no winners', payoutsToShares(new Map(), 100).winners.length === 0);
  check('a zero pot produces no winners', payoutsToShares(new Map([['A', 5]]), 0).winners.length === 0);
}

console.log('randomised hands always conserve chips');
{
  let worst = null;
  for (let iter = 0; iter < 4000; iter++) {
    const n = 2 + Math.floor(Math.random() * 7);
    const players = Array.from({ length: n }, (_, i) => ({
      addr: `P${i}`,
      committed: Math.floor(Math.random() * 2000),
      folded: Math.random() < 0.35,
    }));
    const liveAddrs = players.filter(p => !p.folded && p.committed > 0).map(p => p.addr);
    // A random ranking, with random ties.
    const shuffled = [...liveAddrs].sort(() => Math.random() - 0.5);
    const groups = [];
    for (let i = 0; i < shuffled.length;) {
      const take = 1 + (Math.random() < 0.2 ? 1 : 0);
      groups.push(shuffled.slice(i, i + take));
      i += take;
    }
    const pots = buildSidePots(players);
    const { won, refunds } = awardPots(pots, groups);
    const payouts = new Map(won);
    for (const [a, n] of refunds) payouts.set(a, (payouts.get(a) || 0) + n);
    if (sum(payouts) !== total(players)) { worst = { players, groups, in: total(players), out: sum(payouts) }; break; }
    // Nobody may win more than they could be called for: their own commitment
    // plus, from each opponent, at most what they themselves put in.
    for (const [addr, won] of payouts) {
      const me = players.find(p => p.addr === addr);
      const cap = players.reduce((a, p) => a + Math.min(p.committed, me.committed), 0);
      if (won > cap) { worst = { addr, won, cap, players }; break; }
    }
    if (worst) break;
  }
  check('4000 random hands conserve chips and respect coverage caps', worst === null,
    JSON.stringify(worst));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
