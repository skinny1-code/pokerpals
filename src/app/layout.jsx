import './globals.css';
import { Providers } from './providers';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

export const metadata = {
  title: 'PokerVsPals — Onchain Crypto Poker',
  description: 'Real PvP poker, instant onchain settlement, no bots',
  openGraph: {
    title: 'PokerVsPals — Onchain Crypto Poker',
    description: 'Real PvP poker, instant onchain settlement, no bots',
    images: APP_URL ? [`${APP_URL}/og.png`] : [],
  },
  other: {
    // Farcaster / Base Mini App embed — shows when someone shares the link on Farcaster
    'fc:frame': JSON.stringify({
      version: 'next',
      imageUrl: APP_URL ? `${APP_URL}/og.png` : '',
      button: {
        title: '♠ Play Poker',
        action: {
          type: 'launch_frame',
          name: 'PokerVsPals',
          url: APP_URL || '',
          splashImageUrl: APP_URL ? `${APP_URL}/splash.png` : '',
          splashBackgroundColor: '#0c1a0c',
        },
      },
    }),
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.png" />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
