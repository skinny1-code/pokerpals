// server/cashoutRelay.js
// Sponsored (gasless) cashout relay — extracted from the game server so the
// branching (sponsor / low-gas fallback / submit failure / on-chain revert /
// duplicate suppression / receipt timeout) is unit-testable without booting the
// whole server.
//
// PokerEscrow.cashOut() pays the `player` named in the operator signature no
// matter who submits the tx, so the operator wallet can submit it: the player
// receives their winnings without ever paying gas or signing a withdrawal. The
// signed payload always rides along (CASHOUT_RELAYED carries `sig`/`nonce`) so
// the client can self-submit if sponsorship is off or a sponsored tx reverts.

import { createOperatorQueue } from './operatorQueue.js';

// How long to wait for a receipt before handing the player a self-submit sig.
// The tx may still land afterwards; a self-submit that arrives second simply
// reverts on the consumed nonce, costing the player gas but never double-paying.
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
// Hard cap on how long one (table, player) pair stays blocked from a second
// sponsored submission, in case a provider promise never settles at all.
const DEFAULT_INFLIGHT_MAX_MS = 600_000;

export function createCashoutRelay({
  escrow,         // ethers Contract wired to the operator signer
  health,         // shared health object; health.operator.lowGas gates sponsorship
  send,           // (ws, msg) => void
  isSocketOpen,   // (ws) => boolean
  shortAddr,      // (addr) => string, for logs
  log = console,  // { info?, log, error }
  sponsorEnabled = () => true,
  queueOperatorTx = createOperatorQueue(),
  // Where to park a message for a player whose socket is closed. The default
  // parks it on the table, which is fine for a table that outlives the player;
  // the server injects a store that survives table deletion (the last player to
  // leave destroys the table they were owed a cashout on).
  stashCashout = (t, addr, msg) => t.pendingCashouts.set(addr, msg),
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  inFlightMaxMs = DEFAULT_INFLIGHT_MAX_MS,
}) {
  const info = (log.info || log.log || (() => {})).bind(log);
  const error = (log.error || (() => {})).bind(log);

  // One sponsored cashout at a time per (table, player). A second submission
  // while the first is unconfirmed reuses the same cashOutNonce, so it is
  // guaranteed to revert on-chain — pure operator gas burned. Rapid
  // leave/rejoin is the cheapest way for a player to trigger that, so the
  // second request falls back to the self-submit path instead.
  const inFlight = new Set();
  const keyFor = (tableId, addr) => `${tableId}:${String(addr).toLowerCase()}`;

  const timer = (ms, fn) => {
    const h = setTimeout(fn, ms);
    h.unref?.(); // never hold the process open on a pending receipt
    return h;
  };

  // Deliver a cashout-related message to the player, or stash it for reconnect.
  function deliverCashout(t, addr, ws, msg) {
    if (ws && isSocketOpen(ws)) send(ws, msg);
    else stashCashout(t, addr, msg);
  }

  async function relayOrSignCashOut(t, addr, amount, ws) {
    let nonce, sig;
    try {
      nonce = Number(await escrow.cashOutNonce(BigInt(t.id), addr));
      sig   = await t.signCashOut(addr, amount, nonce);
    } catch (e) {
      error(`[Server] signCashOut error for ${addr}: ${e.message}`);
      return;
    }
    const sigMsg = { type: 'CASHOUT_SIG', amount, sig, nonce, tableId: String(t.id) };

    // Skip sponsorship if disabled or the operator is low on gas — we must never
    // drain the wallet that also pays for markHuman/verification.
    if (!sponsorEnabled() || health.operator.lowGas) {
      deliverCashout(t, addr, ws, sigMsg);
      return;
    }

    const key = keyFor(t.id, addr);
    if (inFlight.has(key)) {
      info(`[Server] sponsored cashout already in flight for ${shortAddr(addr)} (table ${t.id}); self-submit fallback`);
      deliverCashout(t, addr, ws, sigMsg);
      return;
    }

    inFlight.add(key);
    let released = false;
    const hardTimer = timer(inFlightMaxMs, () => release());
    function release() {
      if (released) return;
      released = true;
      clearTimeout(hardTimer);
      inFlight.delete(key);
    }

    let tx;
    try {
      tx = await queueOperatorTx(() =>
        escrow.cashOut(BigInt(t.id), addr, BigInt(amount), BigInt(nonce), sig));
    } catch (e) {
      release();
      error(`[Server] sponsored cashout submit failed for ${addr}, self-submit fallback: ${e.message}`);
      deliverCashout(t, addr, ws, sigMsg);
      return;
    }

    info(`[Server] sponsored cashout ${tx.hash} — ${shortAddr(addr)} ← ${amount} SALOON (table ${t.id})`);
    deliverCashout(t, addr, ws, {
      type: 'CASHOUT_RELAYED', amount, txHash: tx.hash, tableId: String(t.id), sig, nonce,
    });

    // Confirm in the background; on revert, error, or a receipt that never
    // arrives, fall back to the self-submit path so the player is never
    // stranded waiting on a stuck tx. Only the first of those outcomes speaks.
    let answered = false;
    const answer = (fn) => { if (!answered) { answered = true; fn(); } };
    const waitTimer = timer(waitTimeoutMs, () => answer(() => {
      error(`[Server] sponsored cashout ${tx.hash} unconfirmed after ${waitTimeoutMs}ms; sending self-submit fallback`);
      deliverCashout(t, addr, ws, sigMsg);
    }));

    tx.wait()
      .then(rcpt => answer(() => {
        if (rcpt && rcpt.status === 1) {
          deliverCashout(t, addr, ws, {
            type: 'CASHOUT_CONFIRMED', amount, txHash: tx.hash, tableId: String(t.id),
          });
        } else {
          error(`[Server] sponsored cashout reverted ${tx.hash}; sending self-submit fallback`);
          deliverCashout(t, addr, ws, sigMsg);
        }
      }))
      .catch(e => answer(() => {
        error(`[Server] cashout tx.wait failed ${tx.hash}: ${e.message}`);
        deliverCashout(t, addr, ws, sigMsg);
      }))
      .finally(() => { clearTimeout(waitTimer); release(); });
  }

  return { relayOrSignCashOut, deliverCashout, queueOperatorTx };
}
