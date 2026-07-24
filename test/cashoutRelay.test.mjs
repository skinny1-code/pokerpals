/**
 * cashoutRelay unit tests — pure Node.js. Run: node test/cashoutRelay.test.mjs
 * Exercises every branch of the sponsored-cashout relay with mocked chain + socket.
 */
import { createCashoutRelay } from '../server/cashoutRelay.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const tick = () => new Promise(r => setTimeout(r, 5)); // let background tx.wait().then fire
const silent = { log: () => {}, error: () => {} };
const j = v => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() + 'n' : x);

// Build a fresh test rig. `cashOut` returns a tx whose wait() resolves per `waitStatus`
// (1 = success, 0 = revert) or rejects if `waitReject`. `submitThrow` makes cashOut reject.
function rig({ lowGas = false, sponsor = true, waitStatus = 1, waitReject = false,
               submitThrow = false, socketOpen = true } = {}) {
  const sent = [];
  const calls = { cashOut: [], nonce: 0 };
  const health = { operator: { lowGas } };
  const escrow = {
    async cashOutNonce() { return BigInt(calls.nonce); },
    async cashOut(tableId, player, amount, nonce, sig) {
      calls.cashOut.push({ tableId, player, amount, nonce, sig });
      if (submitThrow) throw new Error('insufficient funds for gas');
      return {
        hash: `0xtx${calls.cashOut.length}`,
        wait: () => waitReject
          ? Promise.reject(new Error('rpc timeout'))
          : Promise.resolve({ status: waitStatus }),
      };
    },
  };
  const t = {
    id: 42,
    pendingCashouts: new Map(),
    async signCashOut(addr, amount, nonce) { return `sig:${addr}:${amount}:${nonce}`; },
  };
  const ws = { readyState: socketOpen ? 1 : 3 };
  const relay = createCashoutRelay({
    escrow, health,
    send: (_ws, msg) => sent.push(msg),
    isSocketOpen: w => w?.readyState === 1,
    shortAddr: a => a.slice(0, 6),
    log: silent,
    sponsorEnabled: () => sponsor,
  });
  return { relay, t, ws, sent, calls, health };
}

console.log('sponsored happy path');
{
  const { relay, t, ws, sent, calls } = rig({ waitStatus: 1 });
  await relay.relayOrSignCashOut(t, '0xPlayerAAA', 5000, ws);
  await tick();
  check('submitted cashOut on-chain', calls.cashOut.length === 1, j(calls.cashOut));
  check('first msg is CASHOUT_RELAYED', sent[0]?.type === 'CASHOUT_RELAYED', j(sent[0]));
  check('RELAYED carries sig fallback', typeof sent[0]?.sig === 'string' && sent[0]?.nonce === 0);
  check('RELAYED has txHash + amount', sent[0]?.txHash === '0xtx1' && sent[0]?.amount === 5000);
  check('then CASHOUT_CONFIRMED', sent[1]?.type === 'CASHOUT_CONFIRMED', j(sent[1]));
  check('no self-submit sig sent on success', !sent.some(m => m.type === 'CASHOUT_SIG'));
  check('cashOut got the operator nonce', calls.cashOut[0].nonce === 0n);
}

console.log('low-gas fallback');
{
  const { relay, t, ws, sent, calls } = rig({ lowGas: true });
  await relay.relayOrSignCashOut(t, '0xPlayerBBB', 3000, ws);
  await tick();
  check('did NOT submit on-chain', calls.cashOut.length === 0);
  check('delivered CASHOUT_SIG for self-submit', sent.length === 1 && sent[0].type === 'CASHOUT_SIG', j(sent));
}

console.log('sponsorship disabled');
{
  const { relay, t, ws, sent, calls } = rig({ sponsor: false });
  await relay.relayOrSignCashOut(t, '0xPlayerCCC', 1000, ws);
  await tick();
  check('did NOT submit on-chain', calls.cashOut.length === 0);
  check('delivered CASHOUT_SIG', sent[0]?.type === 'CASHOUT_SIG');
}

console.log('submit throws → self-submit fallback');
{
  const { relay, t, ws, sent } = rig({ submitThrow: true });
  await relay.relayOrSignCashOut(t, '0xPlayerDDD', 2000, ws);
  await tick();
  check('fell back to CASHOUT_SIG', sent.some(m => m.type === 'CASHOUT_SIG'), j(sent));
  check('no RELAYED emitted when submit fails', !sent.some(m => m.type === 'CASHOUT_RELAYED'));
}

console.log('on-chain revert (status 0) → fallback after RELAYED');
{
  const { relay, t, ws, sent } = rig({ waitStatus: 0 });
  await relay.relayOrSignCashOut(t, '0xPlayerEEE', 2500, ws);
  await tick();
  check('optimistic CASHOUT_RELAYED first', sent[0]?.type === 'CASHOUT_RELAYED');
  check('then CASHOUT_SIG fallback on revert', sent[1]?.type === 'CASHOUT_SIG', j(sent));
  check('never falsely CONFIRMED', !sent.some(m => m.type === 'CASHOUT_CONFIRMED'));
}

console.log('tx.wait rejects → fallback');
{
  const { relay, t, ws, sent } = rig({ waitReject: true });
  await relay.relayOrSignCashOut(t, '0xPlayerFFF', 900, ws);
  await tick();
  check('RELAYED then SIG fallback', sent[0]?.type === 'CASHOUT_RELAYED' && sent[1]?.type === 'CASHOUT_SIG');
}

console.log('closed socket → stashed for reconnect');
{
  const { relay, t, ws, sent } = rig({ socketOpen: false, waitStatus: 1 });
  await relay.relayOrSignCashOut(t, '0xPlayerGGG', 4000, ws);
  await tick();
  check('nothing sent to a closed socket', sent.length === 0);
  check('latest state stashed in pendingCashouts', t.pendingCashouts.get('0xPlayerGGG')?.type === 'CASHOUT_CONFIRMED', j([...t.pendingCashouts]));
}

console.log('signCashOut error → no delivery');
{
  const { relay, t, ws, sent } = rig();
  t.signCashOut = async () => { throw new Error('operator key missing'); };
  await relay.relayOrSignCashOut(t, '0xPlayerHHH', 100, ws);
  await tick();
  check('no message delivered on signing failure', sent.length === 0 && t.pendingCashouts.size === 0);
}

console.log('concurrent relays serialize submissions (wallet-nonce safety)');
{
  // Two different players leave at once. The queue must serialize the *submission*
  // so the operator wallet nonce (assigned internally by ethers, not modeled here)
  // can't collide. Each player's escrow replay-nonce is independent — both 0.
  const sent = [];
  const submitOrder = [];
  let live = 0, maxLive = 0;
  const health = { operator: { lowGas: false } };
  const nonces = { A: 0, B: 0 }; // per-player escrow cashOutNonce
  const escrow = {
    async cashOutNonce(_tableId, player) { return BigInt(nonces[player]); },
    async cashOut(tableId, player, amount, nonce) {
      live++; maxLive = Math.max(maxLive, live);
      submitOrder.push({ player, nonce });
      await new Promise(r => setTimeout(r, 10)); // simulate broadcast latency
      live--;
      return { hash: `0x${player}`, wait: () => Promise.resolve({ status: 1 }) };
    },
  };
  const t = { id: 7, pendingCashouts: new Map(),
    async signCashOut(a, amt, n) { return `sig:${a}:${n}`; } };
  const ws = { readyState: 1 };
  const relay = createCashoutRelay({
    escrow, health, send: (_w, m) => sent.push(m),
    isSocketOpen: () => true, shortAddr: a => a, log: silent,
  });
  await Promise.all([
    relay.relayOrSignCashOut(t, 'A', 100, ws),
    relay.relayOrSignCashOut(t, 'B', 200, ws),
  ]);
  await tick();
  check('submissions serialized (never 2 in-flight at once)', maxLive === 1, `maxLive=${maxLive}`);
  check('both players submitted', submitOrder.length === 2, j(submitOrder));
  check('each used its own independent escrow nonce (0)',
    submitOrder.every(o => o.nonce === 0n), j(submitOrder));
  check('both got CASHOUT_RELAYED', sent.filter(m => m.type === 'CASHOUT_RELAYED').length === 2);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
