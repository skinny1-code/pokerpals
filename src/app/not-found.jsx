import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', background: '#0b0b0d',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ fontSize: 64, opacity: .3 }}>♠</div>
      <div style={{ fontSize: 48, fontWeight: 900, color: '#c9b075',
        fontFamily: "'Playfair Display', serif" }}>404</div>
      <div style={{ fontSize: 14, color: '#7d786c' }}>Page not found</div>
      <Link href="/" style={{
        marginTop: 8, padding: '10px 24px', borderRadius: 8,
        background: 'linear-gradient(135deg,#2b2b31,#242428)',
        border: '1px solid #c9b07544', color: '#c9b075',
        fontSize: 13, fontWeight: 700, textDecoration: 'none',
      }}>
        Back to Lobby
      </Link>
    </div>
  );
}
