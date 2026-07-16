'use client';

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0b0b0d', minHeight: '100vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 16, fontFamily: 'Inter, sans-serif' }}>
        <div style={{ fontSize: 64, opacity: .3 }}>♠</div>
        <div style={{ fontSize: 32, fontWeight: 900, color: '#c9b075',
          fontFamily: "'Playfair Display', serif" }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: '#7d786c', maxWidth: 360, textAlign: 'center' }}>
          {error?.message || 'An unexpected error occurred.'}
        </div>
        <button onClick={reset} style={{
          marginTop: 8, padding: '10px 24px', borderRadius: 8,
          background: 'linear-gradient(135deg,#2b2b31,#242428)',
          border: '1px solid #c9b07544', color: '#c9b075',
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>
          Try again
        </button>
      </body>
    </html>
  );
}
