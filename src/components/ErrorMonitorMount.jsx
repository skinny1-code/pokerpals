'use client';

import { useEffect, useRef, useState } from 'react';
import { installErrorMonitor, reportError } from '../lib/errorMonitor';

/**
 * ErrorMonitorMount
 * Client-only component that installs global error listeners on mount.
 * When an error is captured it:
 *  1. POSTs it to /api/client-error via reportError()
 *  2. Shows a dismissible fixed banner at the bottom of the screen
 *
 * At most one banner is shown at a time; subsequent errors update the message.
 */
export default function ErrorMonitorMount() {
  const [banner, setBanner] = useState(null); // { message: string } | null
  const bannerRef = useRef(null);

  useEffect(() => {
    installErrorMonitor({
      onError(errorObj) {
        // Report to server (fire-and-forget)
        reportError(errorObj);

        // Truncate to 120 chars for display
        const short = (errorObj.message ?? 'Unknown error').slice(0, 120);
        setBanner({ message: short });
      },
    });
  }, []);

  if (!banner) return null;

  return (
    <div
      ref={bannerRef}
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        backgroundColor: '#7f1d1d', // dark red
        color: '#fecaca',
        fontSize: '13px',
        lineHeight: '1.4',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.5)',
        // Safe area for iPhone notch/home indicator
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* Message — takes all remaining space */}
      <span style={{ flex: 1 }}>
        <span
          role="button"
          tabIndex={0}
          onClick={() => window.location.reload()}
          onKeyDown={(e) => e.key === 'Enter' && window.location.reload()}
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          aria-label="Tap to reload page"
        >
          ⚠️ App error — {banner.message}. Tap to retry.
        </span>
      </span>

      {/* Dismiss button */}
      <button
        onClick={() => setBanner(null)}
        aria-label="Dismiss error banner"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fecaca',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: '1',
          padding: '0 2px',
          flexShrink: 0,
          marginTop: '-1px',
        }}
      >
        ✕
      </button>
    </div>
  );
}
