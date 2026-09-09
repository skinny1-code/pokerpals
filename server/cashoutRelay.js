// server/cashoutRelay.js
// Sponsored (gasless) cashout relay — extracted from the game server so the
// branching (sponsor / low-gas fallback / submit failure / on-chain revert /
// nonce serialization) is unit-testable without booting the whole server.
//
// PokerEscrow.cashOut() pays the `player` named in the operator signature no
// matter who submits the tx, so the operator wallet can submit it: the player
// receives their winnings without ever paying gas or signing a withdrawal. The
// signed payload always rides along (CASHOUT_RELAYED carries `sig`/`nonce`) so
// the client can self-submit if sponsorship is off or a sponsored tx reverts.

export function createCashoutRelay({
  escrow,         // ethers Contract wired to the operator signer
  health,         // shared health object; health.operator.lowGas gates sponsorship
  send,           // (ws, msg) => void
  isSocketOpen,   // (ws) => boolean
  shortAddr,      // (addr) => string, for logs
  log = console,  // { info?, log, error }
  sponsorEnabled = () => true,
}) {
  const info = (log.info || log.log || (() => {})).bind(log);
  const error = (log.error || (() => {})).bind(log);

  // Serialize operator tx *submission* so concurrent relays (a whole table
  // leaving at once) don't collide on the wallet nonce. ethers assigns the
  // nonce when the tx is broadcast, so we only serialize up to that point —
  // confirmations still happen concurrently in the background.
  let opTxChain = Promise.resolve();
  function queueOperatorTx(fn) {
    const run = opTxChain.then(fn, fn);
    opTxChain = run.then(() => {}, () => {});
    return run;
  }

  // Deliver a cashout-related message to the player, or stash it for reconnect.
  function deliverCashout(t, addr, ws, msg) {
    if (ws && isSocketOpen(ws)) send(ws, msg);
    else t.pendingCashouts.set(addr, msg);
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

    try {
      const tx = await queueOperatorTx(() =>
        escrow.cashOut(BigInt(t.id), addr, BigInt(amount), BigInt(nonce), sig));
      info(`[Server] sponsored cashout ${tx.hash} — ${shortAddr(addr)} ← ${amount} SALOON (table ${t.id})`);
      deliverCashout(t, addr, ws, {
        type: 'CASHOUT_RELAYED', amount, txHash: tx.hash, tableId: String(t.id), sig, nonce,
      });
      // Confirm in the background; on revert fall back to the self-submit path.
      tx.wait()
        .then(rcpt => {
          if (rcpt && rcpt.status === 1) {
            deliverCashout(t, addr, ws, {
              type: 'CASHOUT_CONFIRMED', amount, txHash: tx.hash, tableId: String(t.id),
            });
          } else {
            error(`[Server] sponsored cashout reverted ${tx.hash}; sending self-submit fallback`);
            deliverCashout(t, addr, ws, sigMsg);
          }
        })
        .catch(e => {
          error(`[Server] cashout tx.wait failed ${tx && tx.hash}: ${e.message}`);
          deliverCashout(t, addr, ws, sigMsg);
        });
    } catch (e) {
      error(`[Server] sponsored cashout submit failed for ${addr}, self-submit fallback: ${e.message}`);
      deliverCashout(t, addr, ws, sigMsg);
    }
  }

  return { relayOrSignCashOut, deliverCashout, queueOperatorTx };
}
