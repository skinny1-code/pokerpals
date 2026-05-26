import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', background: '#060e06',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ fontSize: 64, opacity: .3 }}>♠</div>
      <div style={{ fontSize: 48, fontWeight: 900, color: '#d4af37',
        fontFamily: "'Playfair Display', serif" }}>404</div>
      <div style={{ fontSize: 14, color: '#5a8a5a' }}>Page not found</div>
      <Link href="/" style={{
        marginTop: 8, padding: '10px 24px', borderRadius: 8,
        background: 'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
        border: '1px solid #d4af3744', color: '#d4af37',
        fontSize: 13, fontWeight: 700, textDecoration: 'none',
      }}>
        Back to Lobby
      </Link>
    </div>
  );
}
