'use client';
import { useState } from 'react';

const HAS_WC = !!process.env.NEXT_PUBLIC_WC_PROJECT_ID;

function WalletOption({ icon, label, sub, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'rgba(16,185,129,.08)' : 'transparent',
        border: `1px solid ${hover ? 'var(--border-gold)' : 'transparent'}`,
        borderRadius:10, padding:'9px 12px', cursor:'pointer',
        display:'flex', alignItems:'center', gap:11, width:'100%',
        transition:'all .12s',
      }}>
      <span style={{ fontSize:21 }}>{icon}</span>
      <div style={{ textAlign:'left' }}>
        <div style={{ color:'var(--gold)', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>{label}</div>
        <div style={{ color:'var(--text-muted)', fontSize:10 }}>{sub}</div>
      </div>
    </button>
  );
}

// Extracted from WalletBar so AuthGate can render the exact same wallet
// selection UI/logic without duplicating MetaMask/WalletConnect/Farcaster
// detection.
export default function WalletPicker({
  isInMiniApp, hasInjected, siteUrl,
  connectMetaMask, connectWalletConnect, connectFarcaster,
  connectStatus, connectError, onPicked,
}) {
  function pick(fn) { fn(); onPicked?.(); }

  return (
    <div style={{
      background:'linear-gradient(180deg,#0c1a0d,#060e07)', border:'1px solid var(--border-mid)',
      borderRadius:14, padding:8,
      minWidth:230, boxShadow:'0 18px 44px rgba(0,0,0,.7)',
      display:'flex', flexDirection:'column', gap:4,
    }}>
      <div style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:2.5,
        padding:'5px 10px', fontWeight:800 }}>CHOOSE WALLET</div>

      {/* Farcaster / Base Mini App — shown when inside the mini app */}
      {isInMiniApp && (
        <WalletOption
          icon="🟣"
          label="Farcaster Wallet"
          sub="Connected via Mini App"
          onClick={() => pick(connectFarcaster)}
        />
      )}

      {/* MetaMask / injected */}
      {!isInMiniApp && (
        <WalletOption
          icon="🦊"
          label="MetaMask"
          sub={hasInjected ? 'Detected' : 'Install →'}
          onClick={hasInjected
            ? () => pick(connectMetaMask)
            : () => { window.open(`https://metamask.app.link/dapp/${siteUrl}`,'_blank'); onPicked?.(); }
          }
        />
      )}

      {/* WalletConnect — only shown when project ID is configured */}
      {HAS_WC && !isInMiniApp && (
        <WalletOption
          icon="🔗"
          label="WalletConnect"
          sub="Other wallets / mobile"
          onClick={() => pick(connectWalletConnect)}
        />
      )}

      {/* Connecting / error feedback — turns a silent failure into something visible */}
      {connectStatus === 'pending' && (
        <div style={{ display:'flex', alignItems:'center', gap:8,
          padding:'8px 12px', color:'var(--gold)', fontSize:11, fontWeight:600 }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--gold)',
            animation:'live-dot 1s infinite' }} />
          Connecting… approve in your wallet
        </div>
      )}
      {connectStatus === 'error' && connectError && (
        <div style={{ padding:'8px 12px', color:'#e0473b', fontSize:11,
          lineHeight:1.4, wordBreak:'break-word' }}>
          {connectError.shortMessage || connectError.message || 'Connection failed'}
        </div>
      )}

      {/* Explain the missing option instead of silently omitting it */}
      {!HAS_WC && !isInMiniApp && (
        <div style={{ padding:'6px 12px', color:'var(--text-muted)', fontSize:9,
          letterSpacing:.3, lineHeight:1.4 }}>
          WalletConnect not configured — set NEXT_PUBLIC_WC_PROJECT_ID to enable
          mobile wallets.
        </div>
      )}
    </div>
  );
}
