'use client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MiniAppProvider } from '@neynar/react';
import { wagmiConfig } from '../hooks/usePokerWallet';
import { useState, useEffect } from 'react';

export function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    // Signal to the Farcaster / Base client that the app has finished loading.
    // Only fires inside a mini app — isInMiniApp() is async, must be awaited.
    import('@farcaster/miniapp-sdk').then(async ({ sdk }) => {
      if (await sdk.isInMiniApp()) {
        await sdk.actions.ready();
      }
    }).catch(() => {});
  }, []);

  return (
    <MiniAppProvider analyticsEnabled={true}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </WagmiProvider>
    </MiniAppProvider>
  );
}
