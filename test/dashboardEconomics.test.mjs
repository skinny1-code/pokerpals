/**
 * The RevenueDashboard's fallback economics must match the contracts' deploy
 * defaults. Run: node test/dashboardEconomics.test.mjs
 *
 * The panel reads every one of these live (they are all owner-settable), but it
 * renders the fallbacks until the reads resolve — and before this test existed
 * the hardcoded copy had silently drifted to four wrong tier thresholds and four
 * wrong APRs. Parsing the Solidity keeps the two in step.
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const escrow    = read('contracts/PokerEscrow.sol');
const staking   = read('contracts/ChipsStaking.sol');
const dashboard = read('src/components/RevenueDashboard.jsx');

const nums = str => str.replace(/_/g, '').match(/\d+/g).map(BigInt);

// Pull "name = [a, b, c, d, e]" / "name = value" out of a Solidity source.
function solArray(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`no array ${name} in contract`);
  return nums(m[1]);
}
function solScalar(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
  if (!m) throw new Error(`no scalar ${name} in contract`);
  return nums(m[1])[0];
}
// Pull "const NAME = [ ... ]" / "rp(i, <value>)" out of the dashboard.
function jsArray(name) {
  const m = dashboard.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`no array ${name} in dashboard`);
  return nums(m[1]);
}
function jsFallback(index) {
  const m = dashboard.match(new RegExp(`rp\\(${index},\\s*([^)]+)\\)`));
  if (!m) throw new Error(`no rp(${index}, …) fallback in dashboard`);
  const parts = nums(m[1]);
  // "50n * 10n ** 18n" → 50 * 10^18; a bare "1000n" → 1000
  return parts.length === 3 ? parts[0] * parts[1] ** parts[2] : parts[0];
}

console.log('tier rake numerators');
{
  const sol = solArray(escrow, 'tierRakeNum');
  const js  = jsArray('TIER_RAKE_DEFAULT');
  check('match', JSON.stringify(sol.map(String)) === JSON.stringify(js.map(String)),
    `contract=${sol} dashboard=${js}`);
}

console.log('staking tier thresholds');
{
  // tierThresholds is written as "25_000 * 10**18" per entry.
  const m = staking.match(/tierThresholds\s*=\s*\[([^\]]+)\]/);
  const sol = m[1].split(',').map(e => {
    const n = nums(e);
    return n.length === 3 ? n[0] * n[1] ** n[2] : n[0]; // "0" has no multiplier
  });
  const js = jsArray('TIER_THRESH_DEFAULT').map(v => v); // [0, 25_000, …] × 10^18
  const jsScaled = js.map(v => v * 10n ** 18n);
  check('match', JSON.stringify(sol.map(String)) === JSON.stringify(jsScaled.map(String)),
    `contract=${sol} dashboard=${jsScaled}`);
}

console.log('staking tier APRs');
{
  const sol = solArray(staking, 'tierAPR');
  const js  = jsArray('TIER_APR_DEFAULT');
  check('match', JSON.stringify(sol.map(String)) === JSON.stringify(js.map(String)),
    `contract=${sol} dashboard=${js}`);
}

console.log('rake split + cap fallbacks');
{
  const cases = [
    [5,  'rakeCapCHIPS'],
    [6,  'referralBps'],
    [7,  'rakeBurnBps'],
    [8,  'rakeStakingBps'],
    [9,  'rakeTreasuryBps'],
    [10, 'rakeKingsBps'],
    [11, 'rakebackBps'],
  ];
  for (const [i, name] of cases) {
    const sol = name === 'rakeCapCHIPS'
      ? (() => { const n = nums(escrow.match(/rakeCapCHIPS\s*=\s*([^;]+);/)[1]); return n[0] * n[1] ** n[2]; })()
      : solScalar(escrow, name);
    check(name, sol === jsFallback(i), `contract=${sol} dashboard=${jsFallback(i)}`);
  }
}

console.log('rake split still sums to 100%');
{
  const total = ['rakeBurnBps','rakeStakingBps','rakeTreasuryBps','referralBps','rakeKingsBps']
    .reduce((a, n) => a + solScalar(escrow, n), 0n);
  check('sums to 10000 bps', total === 10000n, `total=${total}`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
