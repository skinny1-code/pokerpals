/**
 * appUrl resolver tests — pure Node.js. Run: node test/appUrl.test.mjs
 * The resolver feeds `new URL()` for metadataBase in layout.jsx, so it must
 * NEVER throw and must ALWAYS return a valid absolute URL — a bad value there
 * crashes the entire Next build/render (this is what took the site down).
 */
import { resolveAppUrl, DEFAULT_APP_URL } from '../src/lib/appUrl.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const isAbsolute = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };

// Every plausible NEXT_PUBLIC_APP_URL value, including the ones that crashed prod.
const cases = [
  ['https://allin.gg',   'https://allin.gg'],
  ['https://allin.gg/',  'https://allin.gg'],   // trailing slash trimmed
  ['allin.gg',           'https://allin.gg'],   // scheme prepended (was THROW)
  ['www.allin.gg',       'https://www.allin.gg'],// (was THROW)
  ['  allin.gg  ',       'https://allin.gg'],   // whitespace
  ['http://localhost:3000',       'http://localhost:3000'],       // http + port preserved
  ['',                            DEFAULT_APP_URL],               // empty -> fallback
  [undefined,                     DEFAULT_APP_URL],               // unset -> fallback
  [null,                          DEFAULT_APP_URL],               // null -> fallback
  ['   ',                         DEFAULT_APP_URL],               // blank -> fallback
  ['::::not a url::::',           DEFAULT_APP_URL],               // garbage -> fallback
];

console.log('resolveAppUrl');
for (const [input, expected] of cases) {
  let result, threw = false;
  try { result = resolveAppUrl(input); } catch (e) { threw = true; result = `THREW ${e.message}`; }
  check(`${JSON.stringify(input)} -> ${expected}`, !threw && result === expected, `got ${JSON.stringify(result)}`);
}

console.log('invariants');
for (const [input] of cases) {
  const r = resolveAppUrl(input);
  check(`absolute URL for ${JSON.stringify(input)}`, isAbsolute(r), `got ${JSON.stringify(r)}`);
}
// The whole point: new URL(resolveAppUrl(x)) must never throw (metadataBase).
let anyThrew = false;
for (const [input] of [...cases, ['ftp://x'], ['//protocol-relative'], ['a b c']]) {
  try { new URL(resolveAppUrl(input)); } catch { anyThrew = true; }
}
check('new URL(resolveAppUrl(x)) never throws (metadataBase safe)', !anyThrew);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
