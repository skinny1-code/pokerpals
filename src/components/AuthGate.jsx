'use client';
import { useWallet, useSiteAuth, useMiniAppAutoConnect, useHandle, useUsername, EXPECTED_CHAIN } from '../hooks/usePokerWallet';
import { useEffect, useRef, useState } from 'react';
import { useSwitchChain } from 'wagmi';
import WalletPicker from './WalletPicker';

const NETWORK_INFO = {
  421614: ['Arbitrum Sepolia', 'https://sepolia-rollup.arbitrum.io/rpc'],
  42161: ['Arbitrum One', 'https://arb1.arbitrum.io/rpc'],
  46630: ['Robinhood Chain Testnet', 'https://rpc.testnet.chain.robinhood.com'],
  4663: ['Robinhood Chain', 'https://rpc.mainnet.chain.robinhood.com'],
};
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Blocks the whole app behind connect + sign-in + a display name. Rendered inside
// <Providers> (needs wagmi context) around {children} in the root layout, so every
// page — including WalletBar, which lives inside individual pages — is gated.
export default function AuthGate({ children }) {
  const {
    address, isConnected, chainId,
    connectMetaMask, connectWalletConnect, connectFarcaster,
    connectStatus, connectError,
  } = useWallet();
  const { isSignedIn, isChecking, status, signIn } = useSiteAuth();
  const { hasHandle } = useHandle();
  const { hasUsername, loading: usernameLoading, claim, status: claimStatus, error: claimError } = useUsername();
  const { switchChain, isPending: isSwitchingChain, error: switchChainError } = useSwitchChain();
  const isInMiniApp = useMiniAppAutoConnect(connectFarcaster, isConnected);

  const [mounted, setMounted] = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [nameInput, setNameInput] = useState('');
  useEffect(() => {
    setMounted(true);
    setHasInjected(!!window.ethereum);
    setSiteUrl(window.location.host);
  }, []);

  // Auto-switch to the expected chain as soon as a wrong-network wallet connects,
  // instead of making the player hunt for a manual "switch network" button. Only
  // attempted once per mismatch — if the wallet can't switch programmatically (or
  // the player dismisses it), we don't keep re-prompting on every render.
  const wrongNet = mounted && isConnected && chainId && chainId !== EXPECTED_CHAIN;
  const switchAttempted = useRef(false);
  useEffect(() => {
    if (!wrongNet) { switchAttempted.current = false; return; }
    if (switchAttempted.current) return;
    switchAttempted.current = true;
    switchChain?.({ chainId: EXPECTED_CHAIN });
  }, [wrongNet, switchChain]);

  // Server and the very first client render must agree, or React throws a
  // hydration mismatch — wagmi's connection state is only known post-mount.
  if (!mounted || isChecking) return null;

  const hasDisplayName = hasHandle || hasUsername;

  if (isSignedIn && hasDisplayName) return children;

  // Signed in but still checking whether a name is already on file — avoid a
  // flash of the "choose a name" screen for players who already have one.
  if (isSignedIn && usernameLoading) return null;

  const short = address ? `${address.slice(0,6)}…${address.slice(-4)}` : '';
  const nameValid = USERNAME_RE.test(nameInput.trim());

  if (isSignedIn && !hasDisplayName) {
    return (
      <div style={{
        position:'fixed', inset:0, zIndex:500,
        background:'radial-gradient(circle at 50% 20%, #131316, #09090a00 60%), #09090a',
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        padding:20, gap:22,
      }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:28, fontWeight:900, color:'var(--gold)', letterSpacing:1,
            fontFamily:"'JetBrains Mono',monospace" }}>♠ PokerVsPlayer</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>
            Choose a display name — free, no CHIPS required
          </div>
        </div>
        <div style={{
          background:'linear-gradient(180deg,#111114,#0b0b0d)', border:'1px solid var(--border-mid)',
          borderRadius:14, padding:20, minWidth:280,
          display:'flex', flexDirection:'column', alignItems:'center', gap:12,
        }}>
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            placeholder="e.g. SilverShark482"
            maxLength={20}
            style={{
              width:'100%', boxSizing:'border-box', padding:'10px 12px', fontSize:14,
              background:'rgba(0,0,0,.3)', border:'1px solid var(--border-mid)', borderRadius:8,
              color:'var(--gold-pale)', fontFamily:"'JetBrains Mono',monospace",
            }}
          />
          <div style={{ fontSize:10, color:'var(--text-muted)', alignSelf:'flex-start' }}>
            3–20 characters: letters, numbers, underscore
          </div>
          <button
            onClick={() => claim(nameInput.trim())}
            className="btn btn-gold"
            disabled={!nameValid || claimStatus === 'claiming'}
            style={{ padding:'9px 24px', fontSize:13, letterSpacing:.3, width:'100%' }}>
            {claimStatus === 'claiming' ? 'Check your wallet…' : 'Claim Display Name'}
          </button>
          {claimStatus === 'error' && claimError && (
            <div style={{ fontSize:11, color:'#e0473b', textAlign:'center' }}>{claimError}</div>
          )}
          <div style={{ fontSize:10, color:'var(--text-muted)', textAlign:'center' }}>
            Already have a minted Poker Handle NFT? It'll be picked up automatically.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:500,
      background:'radial-gradient(circle at 50% 20%, #131316, #09090a00 60%), #09090a',
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
          background:'linear-gradient(180deg,#111114,#0b0b0d)', border:'1px solid var(--border-mid)',
          borderRadius:14, padding:20, minWidth:260,
          display:'flex', flexDirection:'column', alignItems:'center', gap:14,
        }}>
          <div style={{ fontSize:11, color:'var(--text-muted)' }}>Connected as</div>
          <div style={{ fontSize:14, color:'var(--gold-pale)', fontWeight:700,
            fontFamily:"'JetBrains Mono',monospace" }}>{short}</div>
          {wrongNet && (
            <div style={{ fontSize:11, color:'#e07030', textAlign:'center' }}>
              {isSwitchingChain ? 'Switching network — check your wallet…' : 'Wrong network detected'}
              {!isSwitchingChain && (
                <button onClick={() => switchChain?.({ chainId: EXPECTED_CHAIN })}
                  style={{ display:'block', margin:'8px auto 0', background:'transparent',
                    border:'1px solid #e0703088', borderRadius:6, padding:'5px 14px',
                    color:'#e07030', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                  Switch Network
                </button>
              )}
              {switchChainError && !isSwitchingChain && (
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:8, textAlign:'left' }}>
                  Your wallet didn't switch automatically — some wallets (especially over
                  WalletConnect) need the network added manually first:
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", marginTop:4, fontSize:9.5 }}>
                    Network: {NETWORK_INFO[EXPECTED_CHAIN]?.[0] || `Chain ${EXPECTED_CHAIN}`}<br/>
                    Chain ID: {EXPECTED_CHAIN}<br/>
                    RPC: {NETWORK_INFO[EXPECTED_CHAIN]?.[1] || "Contact operator"}
                  </div>
                </div>
              )}
            </div>
          )}
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
