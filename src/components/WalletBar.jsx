'use client';
import { useWallet } from '../hooks/usePokerWallet';
import Link from 'next/link';

const SUITS = ['♠', '♥', '♦', '♣'];

export default function WalletBar() {
  const { address, isConnected, chipsBalance, nativeBalance, isHuman,
          connectMetaMask, disconnect } = useWallet();

  const short = addr => addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : '';

  return (
    <header style={{
      background: 'linear-gradient(180deg, #0a140a 0%, #060e06 100%)',
      borderBottom: '1px solid #1a3a1a',
      padding: '0 24px',
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(8px)',
    }}>
      {/* Logo */}
      <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 28, lineHeight: 1 }}>♠</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#d4af37', letterSpacing: 1, lineHeight: 1.1 }}>
            PokerVsPals
          </div>
          <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 3 }}>ONCHAIN PVP POKER</div>
        </div>
      </Link>

      {/* Center nav */}
      <nav style={{ display: 'flex', gap: 4 }}>
        {[
          { href: '/',          label: 'Lobby' },
          { href: '/leaderboard', label: 'Leaderboard' },
          { href: '/stake',     label: 'Stake' },
        ].map(({ href, label }) => (
          <Link key={href} href={href} style={{
            color: '#6a9a6a', fontSize: 12, fontWeight: 700, letterSpacing: 1,
            padding: '6px 14px', borderRadius: 6,
            border: '1px solid transparent',
            textDecoration: 'none',
            transition: 'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#d4af37'; e.currentTarget.style.borderColor = '#d4af3733'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6a9a6a'; e.currentTarget.style.borderColor = 'transparent'; }}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Wallet */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isConnected && (
          <>
            {/* Human verified badge */}
            {isHuman && (
              <div style={{
                fontSize: 9, color: '#27ae60', border: '1px solid #27ae6044',
                padding: '3px 8px', borderRadius: 10, letterSpacing: 1,
              }}>
                ✓ VERIFIED
              </div>
            )}
            {/* CHIPS balance */}
            <div style={{
              background: '#0c1e0c', border: '1px solid #1a3a1a',
              borderRadius: 8, padding: '6px 14px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 14, color: '#d4af37' }}>◈</span>
              <span className="mono" style={{ fontSize: 13, color: '#d4af37', fontWeight: 700 }}>
                {chipsBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}
              </span>
              <span style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1 }}>CHIPS</span>
            </div>
            {/* Address + disconnect */}
            <button onClick={disconnect} style={{
              background: '#0c1e0c', border: '1px solid #1a3a1a',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
              color: '#6a9a6a', fontSize: 12, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#27ae60', boxShadow: '0 0 6px #27ae60',
              }} />
              {short(address)}
            </button>
          </>
        )}

        {!isConnected && (
          <button onClick={connectMetaMask} style={{
            background: 'linear-gradient(135deg, #1a4a1a, #0c2e0c)',
            border: '1px solid #d4af3744', borderRadius: 8,
            padding: '8px 20px', cursor: 'pointer',
            color: '#d4af37', fontSize: 13, fontWeight: 700,
            fontFamily: 'inherit', letterSpacing: .5,
            transition: 'all .2s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#d4af37'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#d4af3744'}
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
