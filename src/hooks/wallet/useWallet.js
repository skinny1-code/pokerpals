// src/hooks/wallet/useWallet.js
// Core wallet connection state, Farcaster mini-app auto-connect, and the
// site-wide sign-in gate. See src/hooks/wallet/core.js for shared config/ABIs.

import { useEffect, useState, useCallback } from "react";
import { useAccount, useConnect, useDisconnect, useReadContract, useBalance, useSignMessage } from "wagmi";
import { formatUnits } from "viem";
import { CHIPS_ABI, ESCROW_ABI, CHIPS, ESCROW, EXPECTED_CHAIN } from "./core";

// ─── HOOK: WALLET STATE ───────────────────────────────────────────────────────
export function useWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, status: connectStatus, error: connectError } = useConnect();
  const { disconnect }                    = useDisconnect();

  // CHIPS balance
  const { data: chipsRaw } = useReadContract({
    address: CHIPS, abi: CHIPS_ABI, functionName: "balanceOf",
    args: [address], query: { enabled: !!address, refetchInterval: 8000 },
  });
  const chipsBalance = chipsRaw ? Number(formatUnits(chipsRaw, 18)) : 0;

  // ETH/native balance for gas
  const { data: nativeBal } = useBalance({ address, query: { enabled: !!address } });

  // Is human verified on-chain?
  const { data: isHuman, refetch: refetchIsHuman } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "humanVerified",
    args: [address], query: { enabled: !!address, refetchInterval: 30000 },
  });

  const connectMetaMask      = () => {
    // Prefer the EIP-6963-discovered MetaMask connector (e.g. inside MetaMask's
    // in-app browser it announces as 'io.metamask'); fall back to generic injected.
    const mm = connectors.find(c => c.id === 'io.metamask')
            || connectors.find(c => c.type === 'injected' && /meta\s*mask/i.test(c.name || ''))
            || connectors.find(c => c.id === 'injected');
    if (!mm) { alert('No injected wallet found. Open this page inside MetaMask, or use WalletConnect.'); return; }
    // Pass chainId so a chain mismatch can't silently stall the connect.
    connect({ connector: mm, chainId: EXPECTED_CHAIN });
  };
  const connectWalletConnect = () => {
    const wc = connectors.find(c => c.id === 'walletConnect');
    if (wc) connect({ connector: wc, chainId: EXPECTED_CHAIN });
    else alert('WalletConnect is not configured. Set NEXT_PUBLIC_WC_PROJECT_ID.');
  };
  const connectFarcaster     = () => connect({ connector: connectors.find(c => c.id === 'farcasterMiniApp') });

  return {
    address,
    isConnected,
    chainId,
    chipsBalance,
    pppBalance: chipsBalance,  // backwards-compat alias
    nativeBalance: nativeBal ? Number(formatUnits(nativeBal.value, 18)) : 0,
    isHuman: !!isHuman,
    refetchIsHuman,
    connectMetaMask,
    connectWalletConnect,
    connectFarcaster,
    connectStatus,            // 'idle' | 'pending' | 'success' | 'error'
    connectError,             // wagmi connect error (null when none)
    disconnect,
  };
}

// ─── HOOK: FARCASTER MINI APP DETECTION + AUTO-CONNECT ───────────────────────
// Shared by WalletBar and AuthGate so both agree on mini-app state and neither
// duplicates the sdk import / auto-connect side effect.
export function useMiniAppAutoConnect(connectFarcaster, isConnected) {
  const [isInMiniApp, setIsInMiniApp] = useState(false);
  useEffect(() => {
    import('@farcaster/miniapp-sdk').then(async ({ sdk }) => {
      const inFrame = await sdk.isInMiniApp();
      if (inFrame) {
        setIsInMiniApp(true);
        if (!isConnected) connectFarcaster();
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return isInMiniApp;
}

// ─── HOOK: SITE-WIDE SIGN-IN GATE ─────────────────────────────────────────────
// Distinct from the per-table "PVP-AUTH:<nonce>" signature (verified server-side
// in server/index.js when joining a game) — this is a client-only UX gate that
// blocks the whole site until the connected wallet has signed a site-level
// message. Persists indefinitely per browser (localStorage) until the wallet
// disconnects or a different address connects.
const SITE_AUTH_KEY = 'pvp-site-auth';

function getSiteAuthCache() {
  try { return JSON.parse(localStorage.getItem(SITE_AUTH_KEY) || 'null'); }
  catch { return null; }
}

export function useSiteAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [cached, setCached] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const [status, setStatus] = useState('idle'); // idle | signing | error

  useEffect(() => {
    setCached(getSiteAuthCache());
    setIsChecking(false);
  }, []);

  const isSignedIn = !isChecking && isConnected && !!address &&
    cached?.address === address.toLowerCase();

  const signIn = useCallback(async () => {
    if (!address) return;
    setStatus('signing');
    try {
      const message = `Sign in to PokerVsPlayer\n\nAddress: ${address}\nTimestamp: ${new Date().toISOString()}`;
      const signature = await signMessageAsync({ message });
      const entry = { address: address.toLowerCase(), signature, signedAt: Date.now() };
      localStorage.setItem(SITE_AUTH_KEY, JSON.stringify(entry));
      setCached(entry);
      setStatus('idle');
    } catch (e) {
      console.error('site sign-in error:', e);
      setStatus('error');
    }
  }, [address, signMessageAsync]);

  const signOut = useCallback(() => {
    localStorage.removeItem(SITE_AUTH_KEY);
    setCached(null);
  }, []);

  return { isSignedIn, isChecking, status, signIn, signOut };
}
