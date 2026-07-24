import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const contentType = 'image/png';

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #111114 0%, #222225 50%, #151517 100%)',
          fontFamily: 'serif',
        }}
      >
        <div style={{ fontSize: 120, lineHeight: 1 }}>♠</div>
        <div style={{
          fontSize: 64, fontWeight: 'bold', color: '#c9b075',
          marginTop: 16, letterSpacing: '-1px',
        }}>
          PokerVsPlayer
        </div>
        <div style={{ fontSize: 28, color: '#9b9585', marginTop: 12 }}>
          Real PvP poker · Onchain settlement
        </div>
        <div style={{
          display: 'flex', gap: 24, marginTop: 28,
          fontSize: 48,
        }}>
          <span>♠</span><span>♥</span><span>♦</span><span>♣</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
