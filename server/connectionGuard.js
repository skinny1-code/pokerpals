// server/connectionGuard.js
// Per-connection and per-IP limits for the WebSocket game server.
//
// The socket is the front door to a service holding real money in memory, and
// it had no limits at all: any number of connections from one host, unlimited
// messages per socket, and sockets that never authenticated living forever.
// Three things that costs:
//
//   1. Connection flood — every socket holds a `clients` entry and a challenge,
//      and nothing ever reclaims an idle unauthenticated one. Enough of them
//      exhaust memory and file descriptors, and the table state is in memory,
//      so the process dying mid-hand is not a clean failure.
//   2. AUTH spam — verifyWalletSignature does two ECDSA recoveries and, for a
//      contract account, an RPC call. Each bogus attempt is cheap to send and
//      expensive to serve: it blocks the event loop and bills the RPC provider.
//   3. Message flood — JSON.parse plus a switch on every frame, on the same
//      single thread that runs every table.
//
// None of this is exploitable for money; all of it takes the game down, which
// for a service holding player funds mid-hand is its own kind of loss.
//
// Kept separate from index.js so the accounting is unit-testable without
// opening a socket.

export function createConnectionGuard({
  maxConnectionsPerIp = Number(process.env.WS_MAX_CONNS_PER_IP) || 25,
  messagesPerSecond   = Number(process.env.WS_MSGS_PER_SEC)     || 25,
  burst               = Number(process.env.WS_MSG_BURST)        || 60,
  maxAuthAttempts     = Number(process.env.WS_MAX_AUTH_TRIES)   || 12,
  authGraceMs         = Number(process.env.WS_AUTH_GRACE_MS)    || 60_000,
  now = () => Date.now(),
} = {}) {
  const perIp = new Map(); // ip -> open connection count

  /**
   * Register a new connection. Returns a handle whose methods the socket's own
   * handlers call; `release()` must run exactly once, on close.
   */
  function open(ip) {
    const key = ip || 'unknown';
    const count = perIp.get(key) || 0;
    if (count >= maxConnectionsPerIp) {
      return { ok: false, reason: 'too-many-connections', release() {} };
    }
    perIp.set(key, count + 1);

    // Token bucket: `burst` frames available immediately, refilling at
    // `messagesPerSecond`. Normal play is a handful of frames per action, so
    // the burst is generous and only sustained flooding runs it dry.
    let tokens   = burst;
    let lastFill = now();
    let authTries = 0;
    let released  = false;

    return {
      ok: true,
      allowMessage() {
        const t = now();
        tokens = Math.min(burst, tokens + ((t - lastFill) / 1000) * messagesPerSecond);
        lastFill = t;
        if (tokens < 1) return false;
        tokens -= 1;
        return true;
      },
      /** False once a socket has burned through its AUTH budget. */
      allowAuthAttempt() {
        return ++authTries <= maxAuthAttempts;
      },
      /** Called on a successful AUTH — the budget is no longer relevant. */
      authSucceeded() {
        authTries = 0;
      },
      release() {
        if (released) return;      // close can fire more than once
        released = true;
        const n = perIp.get(key) || 0;
        if (n <= 1) perIp.delete(key);
        else perIp.set(key, n - 1);
      },
    };
  }

  return {
    open,
    authGraceMs,
    /** Open connections from one address — for tests and the health endpoint. */
    connectionsFor: ip => perIp.get(ip || 'unknown') || 0,
    get trackedIps() { return perIp.size; },
  };
}

/**
 * The client's address, as far as it can be trusted.
 *
 * Fly sets `fly-client-ip` itself and strips any client-supplied copy, so it is
 * authoritative behind Fly. `x-forwarded-for` is just a request header — anyone
 * can send one — so it is honoured only when TRUST_PROXY says a proxy in front
 * of us is rewriting it. Otherwise the socket's own peer address is the only
 * thing a client cannot forge.
 */
export function clientIp(req, { trustProxy = process.env.TRUST_PROXY === 'true' } = {}) {
  const fly = req.headers?.['fly-client-ip'];
  if (fly) return String(fly).trim();
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}
