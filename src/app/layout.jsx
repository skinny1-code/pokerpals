import './globals.css';
import { Providers } from './providers';
import AppErrorBoundary from '../components/AppErrorBoundary';
import ErrorMonitorMount from '../components/ErrorMonitorMount';
import AuthGate from '../components/AuthGate';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

// Mobile-first viewport: render at device width and cover the notch so the
// safe-area-inset padding in globals.css takes effect.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#060e06',
};

export const metadata = {
  title: 'PokerVsPlayer — Onchain Crypto Poker',
  description: 'Real PvP poker, instant onchain settlement, no bots',
  openGraph: {
    title: 'PokerVsPlayer — Onchain Crypto Poker',
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
          name: 'PokerVsPlayer',
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
        <AppErrorBoundary>
          <Providers>
            <ErrorMonitorMount />
            <AuthGate><main>{children}</main></AuthGate>
          </Providers>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
