/**
 * botBrain unit tests — pure Node.js. Run: node test/botBrain.test.mjs
 * Deterministic: every decide() call gets a fixed-value rng.
 */
import { decide, chenScore } from '../server/botBrain.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const rngLow  = () => 0.01; // always take the probabilistic branch
const rngHigh = () => 0.99; // never take it

const base = {
  community: [], phase: 'preflop', pot: 30, toCall: 0, myBet: 0,
  chips: 1000, bigBlind: 20, minRaise: 20, numActive: 3,
  lastToAct: false, wasRaisedPre: false,
};

console.log('chenScore');
check('AA scores 20', chenScore(['AH', 'AS']) === 20);
check('AKs scores 12', chenScore(['AH', 'KH']) === 12);
check('72o scores poorly (< 6)', chenScore(['7H', '2S']) < 6);
check('T9s is playable (>= 6)', chenScore(['TH', '9H']) >= 6);

console.log('preflop');
{
  const d = decide({ ...base, hand: ['AH', 'AS'] }, rngHigh);
  check('AA raises', d.action === 'raise' && d.amount >= 40, JSON.stringify(d));
}
{
  const d = decide({ ...base, hand: ['AH', 'AS'], toCall: 200, pot: 260 }, rngHigh);
  check('AA 3-bets a big raise', d.action === 'raise' || d.action === 'allin', JSON.stringify(d));
}
{
  const d = decide({ ...base, hand: ['7H', '2S'], toCall: 40, pot: 90 }, rngHigh);
  check('72o folds to a raise', d.action === 'fold');
}
{
  const d = decide({ ...base, hand: ['7H', '2S'] }, rngHigh);
  check('72o checks when free', d.action === 'check');
}
{
  const d = decide({ ...base, hand: ['AH', 'KH'], toCall: 60, pot: 150 }, rngHigh);
  check('AKs calls a normal raise', d.action === 'call' || d.action === 'raise', JSON.stringify(d));
}
{
  const d = decide({ ...base, hand: ['9H', '4C'], toCall: 300, pot: 340 }, rngHigh);
  check('junk folds to heavy pressure', d.action === 'fold');
}

console.log('postflop');
{
  // Flopped set of aces — monster must bet when checked to
  const d = decide({ ...base, phase: 'flop', hand: ['AH', 'AS'],
    community: ['AD', '7C', '2S'], pot: 120 }, rngLow);
  check('set bets for value', d.action === 'raise' && d.amount > 0, JSON.stringify(d));
}
{
  // Air on a dry board facing a pot-size bet — fold
  const d = decide({ ...base, phase: 'flop', hand: ['6H', '2C'],
    community: ['AD', 'KC', '9S'], pot: 200, toCall: 200 }, rngHigh);
  check('air folds to a pot bet', d.action === 'fold');
}
{
  // Flush draw getting great odds — call
  const d = decide({ ...base, phase: 'flop', hand: ['AH', '7H'],
    community: ['KH', '9H', '2S'], pot: 400, toCall: 40 }, rngHigh);
  check('flush draw calls with good pot odds', d.action === 'call', JSON.stringify(d));
}
{
  // Flush draw facing a massive overbet — fold
  const d = decide({ ...base, phase: 'flop', hand: ['AH', '7H'],
    community: ['KH', '9H', '2S'], pot: 100, toCall: 700 }, rngHigh);
  check('flush draw folds to a huge overbet', d.action === 'fold');
}
{
  // Semi-bluff branch: flush draw checked to, low rng takes the bet
  const d = decide({ ...base, phase: 'flop', hand: ['AH', '7H'],
    community: ['KH', '9H', '2S'], pot: 200, toCall: 0 }, rngLow);
  check('flush draw semi-bluffs sometimes', d.action === 'raise', JSON.stringify(d));
}
{
  // Top pair on the river facing a small bet — call
  const d = decide({ ...base, phase: 'river', hand: ['AH', 'KS'],
    community: ['AD', '7C', '2S', '9H', '4D'], pot: 300, toCall: 80 }, rngHigh);
  check('top pair calls a reasonable river bet', d.action === 'call', JSON.stringify(d));
}
{
  // River air — never bluff-raises into a bet, folds
  const d = decide({ ...base, phase: 'river', hand: ['6H', '2C'],
    community: ['AD', 'KC', '9S', 'QH', 'JD'], pot: 400, toCall: 250 }, rngLow);
  check('river air folds to a bet', d.action === 'fold');
}
{
  // Raise amounts respect the minimum raise
  const d = decide({ ...base, hand: ['KH', 'KS'], minRaise: 100 }, rngHigh);
  check('raise respects minRaise', d.action !== 'raise' || d.amount >= 100, JSON.stringify(d));
}
{
  // Deep-stack monster never accidentally shoves tiny pots
  const d = decide({ ...base, phase: 'turn', hand: ['AH', 'AS'],
    community: ['AD', '7C', '2S', 'AC'], pot: 60, chips: 10000 }, rngLow);
  check('quads bets proportional to pot, not stack',
    d.action === 'raise' && d.amount <= 10000 * 0.5, JSON.stringify(d));
}

console.log('\n══════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
