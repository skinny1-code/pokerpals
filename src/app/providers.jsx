'use client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '../hooks/usePokerWallet';
import { useState, useEffect } from 'react';

export function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    // Signal to the Farcaster / Base client that the app has finished loading.
    // No-ops gracefully when running outside a mini app context.
    import('@farcaster/miniapp-sdk')
      .then(({ sdk }) => sdk.actions.ready())
      .catch(() => {});
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
