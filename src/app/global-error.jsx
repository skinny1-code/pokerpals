'use client';

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#060e06', minHeight: '100vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 16, fontFamily: 'Inter, sans-serif' }}>
        <div style={{ fontSize: 64, opacity: .3 }}>♠</div>
        <div style={{ fontSize: 32, fontWeight: 900, color: '#d4af37',
          fontFamily: "'Playfair Display', serif" }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: '#5a8a5a', maxWidth: 360, textAlign: 'center' }}>
          {error?.message || 'An unexpected error occurred.'}
        </div>
        <button onClick={reset} style={{
          marginTop: 8, padding: '10px 24px', borderRadius: 8,
          background: 'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
          border: '1px solid #d4af3744', color: '#d4af37',
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>
          Try again
        </button>
      </body>
    </html>
  );
}
