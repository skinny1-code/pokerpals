/**
 * errorMonitor.js
 * Pure-JS (no React) error monitoring module.
 * Catches window errors, unhandled promise rejections, and console.error calls,
 * then forwards them to a caller-supplied onError callback.
 * Also exports reportError() to POST errors to /api/client-error.
 */

let _installed = false;
let _originalConsoleError = null;

/**
 * POST an error payload to /api/client-error.
 * Fire-and-forget: never throws, never awaits.
 *
 * @param {Object} errorObj - The error payload to send.
 */
export function reportError(errorObj) {
  try {
    const payload = {
      message: errorObj?.message ?? String(errorObj),
      stack: errorObj?.stack ?? '',
      type: errorObj?.type ?? 'unknown',
      url: errorObj?.url ?? (typeof window !== 'undefined' ? window.location.href : ''),
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      timestamp: errorObj?.timestamp ?? new Date().toISOString(),
    };

    // Use sendBeacon when available for reliability during page unload,
    // fall back to fetch.
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/api/client-error', blob);
    } else if (typeof fetch !== 'undefined') {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // intentionally ignored
      });
    }
  } catch {
    // never throw from error reporter
  }
}

/**
 * Install global error listeners on window.
 * Safe to call multiple times — installs only once.
 *
 * @param {{ onError: (errorObj: Object) => void }} options
 */
export function installErrorMonitor({ onError }) {
  if (typeof window === 'undefined') return;
  if (_installed) return;
  _installed = true;

  // ── window.onerror ────────────────────────────────────────────────────────
  const prevOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    const payload = {
      message: String(message),
      stack: error?.stack ?? '',
      type: 'onerror',
      url: source ?? window.location.href,
      line: lineno,
      col: colno,
      ua: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };
    try { onError(payload); } catch { /* never throw */ }
    if (typeof prevOnError === 'function') {
      return prevOnError.call(this, message, source, lineno, colno, error);
    }
    return false; // don't suppress default browser behaviour
  };

  // ── unhandledrejection ────────────────────────────────────────────────────
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const payload = {
      message: reason?.message ?? String(reason),
      stack: reason?.stack ?? '',
      type: 'unhandledrejection',
      url: window.location.href,
      line: null,
      col: null,
      ua: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };
    try { onError(payload); } catch { /* never throw */ }
  });

  // ── console.error patch ───────────────────────────────────────────────────
  _originalConsoleError = console.error;
  console.error = function (...args) {
    // Call original first so devtools still show it
    if (_originalConsoleError) {
      _originalConsoleError.apply(console, args);
    }

    // Build a human-readable message from the arguments
    const message = args
      .map((a) => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      })
      .join(' ');

    const stack = args.find((a) => a instanceof Error)?.stack ?? '';

    const payload = {
      message,
      stack,
      type: 'console.error',
      url: window.location.href,
      line: null,
      col: null,
      ua: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };
    try { onError(payload); } catch { /* never throw */ }
  };
}
