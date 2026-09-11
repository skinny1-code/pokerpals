// server/operatorQueue.js
// Serializes every tx submitted from the operator wallet.
//
// ethers assigns the wallet nonce at broadcast time, so two sends that overlap
// between "build" and "broadcast" claim the same nonce and one of them is
// dropped by the node ("replacement transaction underpriced" / silently lost).
// Every operator-signed send in the server — sponsored cashouts, markHuman,
// closeTable, HandHistory batches — must go through the same queue, or the ones
// that skip it collide with the ones that don't.
//
// Only *submission* is serialized. Confirmations (tx.wait) still run
// concurrently in the background, so a slow receipt never blocks the next send.

export function createOperatorQueue() {
  let chain = Promise.resolve();

  function queueOperatorTx(fn) {
    const run = chain.then(fn, fn);
    // Keep the chain alive regardless of how `run` settles.
    chain = run.then(() => {}, () => {});
    return run;
  }

  return queueOperatorTx;
}
