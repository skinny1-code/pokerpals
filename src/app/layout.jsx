import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'PokerVsPals — Onchain Crypto Poker',
  description: 'Real PvP poker, instant onchain settlement, no bots',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>♠</text></svg>" />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
