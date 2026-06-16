import { NextResponse } from 'next/server';

export function GET() {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

  return NextResponse.json({
    accountAssociation: {
      // Generate at: https://warpcast.com/~/developers/new
      // Enter your deployment domain → copy the three values below.
      header:    process.env.FARCASTER_MANIFEST_HEADER    || '',
      payload:   process.env.FARCASTER_MANIFEST_PAYLOAD   || '',
      signature: process.env.FARCASTER_MANIFEST_SIGNATURE || '',
    },
    frame: {
      version:              '1',
      name:                 'PokerVsPlayer',
      iconUrl:              `${base}/icon.png`,
      homeUrl:              base || 'https://pokerpals.app',
      imageUrl:             `${base}/og.png`,
      splashImageUrl:       `${base}/splash.png`,
      splashBackgroundColor:'#0c1a0c',
      webhookUrl:           `${base}/api/miniapp-webhook`,
    },
  });
}
