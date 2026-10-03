// server/frame.js
// Parse and validate an inbound WebSocket frame before it reaches a handler.
//
// Every case in the message switch destructures `payload`, so a frame that
// omitted it threw — and because the message handler is async, the throw became
// an unhandled promise rejection. The only thing that noticed was a
// process-level `unhandledRejection` listener, which is the wrong place for
// this twice over: the case had already aborted halfway through, and a listener
// whose job is to decide whether the process is still coherent should not be
// fielding routine bad input. One malformed frame, from any client, was enough.
//
// So frames are validated here instead: anything that is not a well-formed
// message is dropped exactly like unparseable JSON, and a missing payload
// becomes `{}` so the destructuring in each case yields undefined fields —
// which the cases already handle, since an unknown tableId looks up to nothing.

/**
 * @param raw the bytes/string from the socket
 * @returns { type, payload } for a usable frame, or null to drop it
 */
export function parseFrame(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return null; }

  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const { type } = msg;
  if (typeof type !== 'string' || type.length === 0) return null;

  const payload = isPlainObject(msg.payload) ? msg.payload : {};
  return { type, payload };
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Attacker-controlled text that is about to be logged. Control characters are
 * stripped so a frame cannot forge log lines or move the terminal cursor, and
 * the result is bounded so it cannot choose how much log volume we pay for.
 */
export function logSafe(s, max = 42) {
  return String(s).replace(/[^\x20-\x7E]/g, '?').slice(0, max);
}
