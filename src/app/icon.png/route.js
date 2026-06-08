import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const contentType = 'image/png';

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0c1a0c', borderRadius: '20%',
        }}
      >
        <div style={{ fontSize: 80 }}>♠</div>
      </div>
    ),
    { width: 200, height: 200 }
  );
}
