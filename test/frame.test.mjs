/**
 * Inbound frame validation. Run: node test/frame.test.mjs
 *
 * This exists because a break-test found that one malformed frame — `{"type":
 * "ACTION"}`, no payload — threw inside the message switch, and in an async
 * handler that surfaced as an unhandled promise rejection. Any client could
 * trigger it. The tests below are the shapes a hostile client actually sends.
 */
import { parseFrame, logSafe } from '../server/frame.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const drops = (name, raw) => check(name, parseFrame(raw) === null, `got ${JSON.stringify(parseFrame(raw))}`);

console.log('the frame that caused the bug');
{
  const f = parseFrame('{"type":"ACTION"}');
  check('a payload-less frame is accepted, not dropped', f !== null);
  check('payload is an object, so destructuring cannot throw',
    f && typeof f.payload === 'object' && f.payload !== null);
  // This is the line that used to throw.
  let threw = false;
  try { const { tableId, action } = f.payload; void tableId; void action; } catch { threw = true; }
  check('destructuring it yields undefined fields instead of throwing', !threw);
  check('type survives', f.type === 'ACTION');
}

console.log('payloads that are not objects become {}');
{
  for (const [label, raw] of [
    ['null',    '{"type":"ACTION","payload":null}'],
    ['a string','{"type":"ACTION","payload":"hello"}'],
    ['a number','{"type":"ACTION","payload":7}'],
    ['an array','{"type":"ACTION","payload":[1,2,3]}'],
    ['false',   '{"type":"ACTION","payload":false}'],
  ]) {
    const f = parseFrame(raw);
    check(`${label} → {}`, f !== null && typeof f.payload === 'object'
      && !Array.isArray(f.payload) && Object.keys(f.payload).length === 0);
  }
}

console.log('malformed frames are dropped');
{
  drops('not JSON',            'not json at all');
  drops('empty string',        '');
  drops('JSON null',           'null');
  drops('a bare number',       '42');
  drops('a bare string',       '"ACTION"');
  drops('a top-level array',   '[{"type":"ACTION"}]');
  drops('no type',             '{"payload":{}}');
  drops('a numeric type',      '{"type":7}');
  drops('a null type',         '{"type":null}');
  drops('an object type',      '{"type":{"a":1}}');
  drops('an empty type',       '{"type":""}');
  drops('truncated JSON',      '{"type":"ACTION",');
}

console.log('well-formed frames pass through untouched');
{
  const f = parseFrame('{"type":"ACTION","payload":{"tableId":"9001","action":"call","amount":50}}');
  check('type and payload both present', f?.type === 'ACTION' && f.payload.tableId === '9001');
  check('values are not coerced', f.payload.amount === 50 && f.payload.action === 'call');
  const noPayload = parseFrame('{"type":"LIST_TABLES"}');
  check('a message type that carries no payload still works', noPayload?.type === 'LIST_TABLES');
}

console.log('a frame cannot smuggle a prototype');
{
  const f = parseFrame('{"type":"ACTION","payload":{"__proto__":{"polluted":true}}}');
  check('frame still parses', f !== null);
  check('Object.prototype is untouched', ({}).polluted === undefined);
  const g = parseFrame('{"type":"__proto__","payload":{}}');
  check('a __proto__ type is just a string that matches no case', g?.type === '__proto__');
  const h = parseFrame('{"type":"constructor","payload":{}}');
  check('so is constructor', h?.type === 'constructor');
}

console.log('text headed for the log is stripped and bounded');
{
  const ESC = String.fromCharCode(27);
  check('escape sequences are replaced',
    !logSafe(`a${ESC}[31mred`).includes(ESC));
  check('newlines cannot forge a log line', !logSafe('a\nb\n[Server] fake').includes('\n'));
  check('carriage returns go too', !logSafe('a\rb').includes('\r'));
  check('length is bounded', logSafe('x'.repeat(5000)).length === 42);
  check('the bound is adjustable', logSafe('x'.repeat(5000), 10).length === 10);
  check('ordinary text is left alone', logSafe('ACTION') === 'ACTION');
  check('non-strings do not throw', logSafe(undefined) === 'undefined' && logSafe(null) === 'null');
  check('an object does not throw', typeof logSafe({ a: 1 }) === 'string');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
