'use client';
import { useWallet, useSiteAuth, useMiniAppAutoConnect } from '../hooks/usePokerWallet';
import { useEffect, useState } from 'react';
import WalletPicker from './WalletPicker';

// Blocks the whole app behind connect + sign-in. Rendered inside <Providers>
// (needs wagmi context) around {children} in the root layout, so every page —
// including WalletBar, which lives inside individual pages — is gated.
export default function AuthGate({ children }) {
  const {
    address, isConnected,
    connectMetaMask, connectWalletConnect, connectFarcaster,
    connectStatus, connectError,
  } = useWallet();
  const { isSignedIn, isChecking, status, signIn } = useSiteAuth();
  const isInMiniApp = useMiniAppAutoConnect(connectFarcaster, isConnected);

  const [mounted, setMounted] = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  useEffect(() => {
    setMounted(true);
    setHasInjected(!!window.ethereum);
    setSiteUrl(window.location.host);
  }, []);

  // Server and the very first client render must agree, or React throws a
  // hydration mismatch — wagmi's connection state is only known post-mount.
  if (!mounted || isChecking) return null;

  if (isSignedIn) return children;

  const short = address ? `${address.slice(0,6)}…${address.slice(-4)}` : '';

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:500,
      background:'radial-gradient(circle at 50% 20%, #0e1f10, #05090500 60%), #050a05',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      padding:20, gap:22,
    }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:28, fontWeight:900, color:'var(--gold)', letterSpacing:1,
          fontFamily:"'JetBrains Mono',monospace" }}>♠ PokerVsPlayer</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>
          Connect your wallet and sign in to play
        </div>
      </div>

      {!isConnected ? (
        <WalletPicker
          isInMiniApp={isInMiniApp} hasInjected={hasInjected} siteUrl={siteUrl}
          connectMetaMask={connectMetaMask} connectWalletConnect={connectWalletConnect}
          connectFarcaster={connectFarcaster}
          connectStatus={connectStatus} connectError={connectError}
        />
      ) : (
        <div style={{
          background:'linear-gradient(180deg,#0c1a0d,#060e07)', border:'1px solid var(--border-mid)',
          borderRadius:14, padding:20, minWidth:260,
          display:'flex', flexDirection:'column', alignItems:'center', gap:14,
        }}>
          <div style={{ fontSize:11, color:'var(--text-muted)' }}>Connected as</div>
          <div style={{ fontSize:14, color:'var(--gold-pale)', fontWeight:700,
            fontFamily:"'JetBrains Mono',monospace" }}>{short}</div>
          <button onClick={signIn} className="btn btn-gold" disabled={status === 'signing'}
            style={{ padding:'9px 24px', fontSize:13, letterSpacing:.3, width:'100%' }}>
            {status === 'signing' ? 'Check your wallet…' : 'Sign Message to Continue'}
          </button>
          {status === 'error' && (
            <div style={{ fontSize:11, color:'#e0473b', textAlign:'center' }}>
              Signature failed or was rejected — try again.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
