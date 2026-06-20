'use client';
import { useEffect, useRef } from 'react';

// Shared banner for the real human-verification flow (antiBotOracle via the
// VERIFY_HUMAN websocket round-trip). Purely presentational — driven by
// useTableSocket()'s verifyStatus/verifyFailures/sendVerifyHuman.
export default function VerifyHumanBanner({ status, failures, onVerify, onVerified }) {
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (status === 'done' && !notifiedRef.current) {
      notifiedRef.current = true;
      onVerified?.();
    }
    if (status !== 'done') notifiedRef.current = false;
  }, [status, onVerified]);

  const isPending = status === 'pending';
  const isDone    = status === 'done';
  const isError   = status === 'error';

  return (
    <div style={{
      background: isDone ? '#0a1f0a' : '#1a0c04',
      borderBottom: `1px solid ${isDone ? '#27ae6055' : '#c8793055'}`,
      padding: '8px 16px',
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, flexWrap: 'wrap',
    }}>
      <span style={{ color: isDone ? '#27ae60' : '#e07030' }}>
        {isDone
          ? '✓ Verified — you can now buy in!'
          : '⚠ Your wallet needs human verification before you can play.'}
      </span>
      {!isDone && (
        <button
          onClick={onVerify}
          disabled={isPending}
          style={{
            background: 'transparent', border: '1px solid #c8793088',
            borderRadius: 6, padding: '3px 12px', cursor: isPending ? 'not-allowed' : 'pointer',
            color: '#e07030', fontSize: 10, fontWeight: 700,
          }}
        >
          {isPending ? 'Verifying…' : 'Request Verification'}
        </button>
      )}
      {isError && failures?.length > 0 && (
        <span style={{ color: '#e74c3c', fontSize: 10 }}>
          {failures.join(' · ')}
        </span>
      )}
    </div>
  );
}
