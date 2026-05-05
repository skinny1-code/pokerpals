'use client';
import { useState, useEffect } from 'react';
import { useWallet } from '../hooks/usePokerWallet';
import Link from 'next/link';

export default function WalletBar() {
  const { address, isConnected, chipsBalance, isHuman,
          connectMetaMask, disconnect } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');

  useEffect(() => {
    setMounted(true);
    setHasInjected(!!window.ethereum);
    setSiteUrl(window.location.host);
  }, []);

  const short = addr => addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : '';

  const headerStyle = {
    background: 'linear-gradient(180deg, #0a140a 0%, #060e06 100%)',
    borderBottom: '1px solid #1a3a1a',
    padding: '0 16px',
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    backdropFilter: 'blur(8px)',
  };

  return (
    <header style={headerStyle}>
      {/* Logo */}
      <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 26, lineHeight: 1 }}>♠</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#d4af37', letterSpacing: 1, lineHeight: 1.1 }}>
            PokerVsPals
          </div>
          <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 3 }}>ONCHAIN PVP POKER</div>
        </div>
      </Link>

      {/* Center nav */}
      <nav style={{ display: 'flex', gap: 2 }}>
        {[
          { href: '/',            label: 'Lobby' },
          { href: '/leaderboard', label: 'Board' },
          { href: '/stake',       label: 'Stake' },
          { href: '/buy',         label: 'Buy CHIPS' },
        ].map(({ href, label }) => (
          <Link key={href} href={href} style={{
            color: '#6a9a6a', fontSize: 11, fontWeight: 700, letterSpacing: 1,
            padding: '5px 10px', borderRadius: 6,
            border: '1px solid transparent', textDecoration: 'none',
          }}>
            {label}
          </Link>
        ))}
      </nav>

      {/* Wallet — only rendered client-side to avoid hydration mismatch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
        {mounted && isConnected && (
          <>
            {isHuman && (
              <div style={{
                fontSize: 8, color: '#27ae60', border: '1px solid #27ae6044',
                padding: '3px 7px', borderRadius: 10, letterSpacing: 1,
              }}>
                ✓ VERIFIED
              </div>
            )}
            <div style={{
              background: '#0c1e0c', border: '1px solid #1a3a1a',
              borderRadius: 8, padding: '5px 10px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 13, color: '#d4af37' }}>◈</span>
              <span style={{ fontSize: 12, color: '#d4af37', fontWeight: 700,
                fontFamily: "'JetBrains Mono',monospace" }}>
                {chipsBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}
              </span>
            </div>
            <button onClick={disconnect} style={{
              background: '#0c1e0c', border: '1px solid #1a3a1a',
              borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
              color: '#6a9a6a', fontSize: 11, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#27ae60' }} />
              {short(address)}
            </button>
          </>
        )}

        {mounted && !isConnected && hasInjected && (
          <button onClick={connectMetaMask} style={{
            background: 'linear-gradient(135deg, #1a4a1a, #0c2e0c)',
            border: '1px solid #d4af3744', borderRadius: 8,
            padding: '8px 18px', cursor: 'pointer',
            color: '#d4af37', fontSize: 13, fontWeight: 700,
            fontFamily: 'inherit', letterSpacing: .5,
          }}>
            Connect Wallet
          </button>
        )}

        {mounted && !isConnected && !hasInjected && (
          <a
            href={`https://metamask.app.link/dapp/${siteUrl}`}
            style={{
              background: 'linear-gradient(135deg, #f6851b22, #f6851b11)',
              border: '1px solid #f6851b66', borderRadius: 8,
              padding: '8px 14px',
              color: '#f6851b', fontSize: 12, fontWeight: 700,
              fontFamily: 'inherit', letterSpacing: .3,
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            🦊 Open in MetaMask
          </a>
        )}
      </div>
    </header>
  );
}
