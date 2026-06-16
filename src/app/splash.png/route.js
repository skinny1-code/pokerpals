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
          background: '#0c1a0c',
        }}
      >
        <div style={{ fontSize: 120 }}>♠</div>
        <div style={{
          fontSize: 28, fontWeight: 'bold',
          color: '#d4af37', marginTop: 8, fontFamily: 'serif',
        }}>
          PokerVsPlayer
        </div>
      </div>
    ),
    { width: 200, height: 200 }
  );
}
