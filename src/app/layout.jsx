import './globals.css';
import { Providers } from './providers';
import AppErrorBoundary from '../components/AppErrorBoundary';
import ErrorMonitorMount from '../components/ErrorMonitorMount';
import AuthGate from '../components/AuthGate';
import AmbientMusic from '../components/AmbientMusic';
import { resolveAppUrl } from '../lib/appUrl';

// Canonical site URL for link previews. resolveAppUrl() always returns a valid
// absolute URL — even when NEXT_PUBLIC_APP_URL is missing OR set scheme-less
// (e.g. "pokervsplayer.xyz"), which otherwise makes `new URL()` below throw and
// takes the whole site down at build/render time.
const APP_URL = resolveAppUrl();

// Mobile-first viewport: render at device width and cover the notch so the
// safe-area-inset padding in globals.css takes effect.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0b0d',
};

const OG_TITLE = 'PokerVsPlayer — Onchain Crypto Poker';
const OG_DESC  = 'Real PvP poker, instant onchain settlement, no bots';
const OG_IMAGE = {
  url: '/og.png',           // resolved to an absolute URL via metadataBase
  width: 1200,
  height: 630,
  alt: 'PokerVsPlayer — onchain crypto poker',
};

export const metadata = {
  // metadataBase lets Next.js turn the relative '/og.png' into an absolute URL
  // in every preview tag — the piece that was missing, so cards rendered blank.
  metadataBase: new URL(APP_URL),
  title: OG_TITLE,
  description: OG_DESC,
  openGraph: {
    type: 'website',
    siteName: 'PokerVsPlayer',
    url: APP_URL,
    title: OG_TITLE,
    description: OG_DESC,
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESC,
    images: ['/og.png'],
  },
  other: {
    // Farcaster / Base Mini App embed — shows when someone shares the link on Farcaster
    'fc:frame': JSON.stringify({
      version: 'next',
      imageUrl: `${APP_URL}/og.png`,
      button: {
        title: '♠ Play Poker',
        action: {
          type: 'launch_frame',
          name: 'PokerVsPlayer',
          url: APP_URL,
          splashImageUrl: `${APP_URL}/splash.png`,
          splashBackgroundColor: '#111114',
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
            <AmbientMusic />
          </Providers>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
