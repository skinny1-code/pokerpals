/**
 * connectionGuard tests — pure Node.js. Run: node test/connectionGuard.test.mjs
 *
 * The limits exist to keep the game server up, not to stop theft, so the tests
 * care about two things equally: that abuse is actually stopped, and that
 * ordinary play never trips a limit.
 */
import { createConnectionGuard, clientIp } from '../server/connectionGuard.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// A controllable clock, so no test sleeps.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

console.log('per-IP connection cap');
{
  const g = createConnectionGuard({ maxConnectionsPerIp: 3 });
  const a = g.open('1.2.3.4'), b = g.open('1.2.3.4'), c = g.open('1.2.3.4');
  check('first three admitted', a.ok && b.ok && c.ok);
  const d = g.open('1.2.3.4');
  check('fourth refused', !d.ok && d.reason === 'too-many-connections');
  check('count tracked', g.connectionsFor('1.2.3.4') === 3, `${g.connectionsFor('1.2.3.4')}`);

  check('a different IP is unaffected', g.open('5.6.7.8').ok);

  b.release();
  check('a slot frees on release', g.open('1.2.3.4').ok);
}

console.log('release is idempotent and cannot free other sockets\' slots');
{
  const g = createConnectionGuard({ maxConnectionsPerIp: 2 });
  const a = g.open('9.9.9.9'); g.open('9.9.9.9');
  a.release(); a.release(); a.release();   // ws 'close' can fire more than once
  check('count went down by exactly one', g.connectionsFor('9.9.9.9') === 1,
    `${g.connectionsFor('9.9.9.9')}`);
  check('one slot open, not two', g.open('9.9.9.9').ok && !g.open('9.9.9.9').ok);
}

console.log('the IP table does not grow without bound');
{
  const g = createConnectionGuard();
  const handles = [];
  for (let i = 0; i < 50; i++) handles.push(g.open(`10.0.0.${i}`));
  check('50 IPs tracked', g.trackedIps === 50, `${g.trackedIps}`);
  handles.forEach(h => h.release());
  check('all entries removed once closed', g.trackedIps === 0, `${g.trackedIps}`);
}

console.log('message budget');
{
  const c = clock();
  const g = createConnectionGuard({ burst: 10, messagesPerSecond: 5, now: c.now });
  const conn = g.open('1.1.1.1');

  let allowed = 0;
  for (let i = 0; i < 10; i++) if (conn.allowMessage()) allowed++;
  check('burst is spendable in one go', allowed === 10, `${allowed}`);
  check('the next frame is refused', !conn.allowMessage());

  c.advance(1000);
  let after = 0;
  for (let i = 0; i < 10; i++) if (conn.allowMessage()) after++;
  check('one second refills messagesPerSecond', after === 5, `${after}`);

  c.advance(60_000);
  let refilled = 0;
  for (let i = 0; i < 20; i++) if (conn.allowMessage()) refilled++;
  check('refill is capped at the burst size', refilled === 10, `${refilled}`);
}

console.log('ordinary play never trips the message budget');
{
  // A busy player acting every 2s, plus the frames the client sends around each
  // action, for ten minutes.
  const c = clock();
  const g = createConnectionGuard({ now: c.now });   // production defaults
  const conn = g.open('2.2.2.2');
  let refusals = 0;
  for (let action = 0; action < 300; action++) {
    for (let frame = 0; frame < 4; frame++) if (!conn.allowMessage()) refusals++;
    c.advance(2000);
  }
  check('no frame refused across 1200 messages', refusals === 0, `${refusals} refused`);
}

console.log('a flood is stopped quickly');
{
  const c = clock();
  const g = createConnectionGuard({ now: c.now });
  const conn = g.open('3.3.3.3');
  let sent = 0;
  while (conn.allowMessage() && sent < 10_000) { sent++; c.advance(1); } // 1000 msg/s
  check('cut off well under 10k frames', sent < 200, `${sent} allowed`);
}

console.log('AUTH attempt budget');
{
  const g = createConnectionGuard({ maxAuthAttempts: 3 });
  const conn = g.open('4.4.4.4');
  check('attempt 1', conn.allowAuthAttempt());
  check('attempt 2', conn.allowAuthAttempt());
  check('attempt 3', conn.allowAuthAttempt());
  check('attempt 4 refused', !conn.allowAuthAttempt());

  const ok = g.open('4.4.4.5');
  ok.allowAuthAttempt(); ok.allowAuthAttempt();
  ok.authSucceeded();
  check('a success resets the budget', ok.allowAuthAttempt() && ok.allowAuthAttempt()
    && ok.allowAuthAttempt() && !ok.allowAuthAttempt());
}

console.log('client IP resolution');
{
  const sock = { remoteAddress: '203.0.113.9' };
  check('fly-client-ip wins', clientIp({ headers: { 'fly-client-ip': '198.51.100.7' }, socket: sock })
    === '198.51.100.7');
  check('x-forwarded-for ignored by default',
    clientIp({ headers: { 'x-forwarded-for': '198.51.100.7' }, socket: sock }) === '203.0.113.9');
  check('x-forwarded-for honoured when trusted',
    clientIp({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, socket: sock },
      { trustProxy: true }) === '198.51.100.7');
  check('falls back to the socket', clientIp({ headers: {}, socket: sock }) === '203.0.113.9');
  check('never throws without a socket', clientIp({ headers: {} }) === 'unknown');
  check('fly header beats a spoofed x-forwarded-for',
    clientIp({ headers: { 'fly-client-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' }, socket: sock },
      { trustProxy: true }) === '198.51.100.7');
}

console.log('a spoofed x-forwarded-for cannot escape the per-IP cap');
{
  // Without trustProxy, every one of these resolves to the same real peer.
  const g = createConnectionGuard({ maxConnectionsPerIp: 2 });
  const sock = { remoteAddress: '203.0.113.9' };
  const ips = [0,1,2,3].map(i =>
    clientIp({ headers: { 'x-forwarded-for': `5.5.5.${i}` }, socket: sock }));
  const results = ips.map(ip => g.open(ip).ok);
  check('only the cap is admitted', results.filter(Boolean).length === 2, JSON.stringify(results));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
