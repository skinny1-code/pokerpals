import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const contentType = 'image/png';

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#111114',
        }}
      >
        <div style={{ fontSize: 120 }}>♠</div>
        <div style={{
          fontSize: 28, fontWeight: 'bold',
          color: '#c9b075', marginTop: 8, fontFamily: 'serif',
        }}>
          Saloon
        </div>
      </div>
    ),
    { width: 200, height: 200 }
  );
}
