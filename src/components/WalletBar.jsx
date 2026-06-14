'use client';
import { useState, useEffect } from 'react';
import { useWallet, useHandle } from '../hooks/usePokerWallet';
import { useAccount, useSwitchChain } from 'wagmi';
import Link from 'next/link';
import { useIsMobile } from '../hooks/useIsMobile';

const CHAIN_NAMES = { 421614: 'Arbitrum Sepolia', 42161: 'Arbitrum One' };
const EXPECTED = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 421614);
const HAS_WC = !!process.env.NEXT_PUBLIC_WC_PROJECT_ID;

const NAV_LINKS = [
  { href:'/',            label:'Lobby',        icon:'♠' },
  { href:'/tournament',  label:'Tournaments',  icon:'🏆' },
  { href:'/leaderboard', label:'Leaderboard',  icon:'◉' },
  { href:'/stake',       label:'Stake',        icon:'◈' },
  { href:'/buy',         label:'Buy CHIPS',    icon:'$' },
  { href:'/handle',      label:'Handle',       icon:'@' },
];
const MENU_ICON = { fontSize:18, width:24, textAlign:'center' };

export default function WalletBar() {
  const { address, isConnected, chipsBalance, isHuman,
          connectMetaMask, connectWalletConnect, connectCoinbase, connectFarcaster, disconnect } = useWallet();
  const { myHandle } = useHandle();
  const { chainId, status: wagmiStatus } = useAccount();
  const { switchChain } = useSwitchChain();
  const isMobile = useIsMobile();
  const [mounted, setMounted]         = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  const [siteUrl, setSiteUrl]         = useState('');
  const [showPicker, setShowPicker]   = useState(false);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [isInMiniApp, setIsInMiniApp] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHasInjected(!!window.ethereum);
    setSiteUrl(window.location.host);

    // Auto-connect when running inside a Farcaster / Base mini app
    import('@farcaster/miniapp-sdk').then(async ({ sdk }) => {
      const inFrame = await sdk.isInMiniApp();
      if (inFrame) {
        setIsInMiniApp(true);
        if (!isConnected) connectFarcaster();
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(fn) { fn(); setShowPicker(false); }

  const short = a => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '';
  const wrongNet = mounted && isConnected && chainId && chainId !== EXPECTED;
  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
  const displayName = myHandle || short(address);

  return (
    <header style={{
      background: 'linear-gradient(180deg,#0b160b 0%,rgba(6,14,6,.97) 100%)',
      borderBottom: '1px solid #1a3a1a',
      boxShadow: '0 1px 24px rgba(0,0,0,.5)',
      padding: '0 20px',
      height: 58,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(16px)',
      gap: 12,
    }}>

      {/* Logo */}
      <Link href="/" style={{ textDecoration:'none', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
          border: '1px solid #d4af3733',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, lineHeight: 1,
        }}>♠</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#d4af37', letterSpacing: .5, lineHeight: 1.1,
            fontFamily:"'Playfair Display',serif" }}>
            PokerVsPals
          </div>
          <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 2, fontFamily:'Inter,sans-serif' }}>
            ONCHAIN PVP
          </div>
        </div>
      </Link>

      {/* Desktop nav — hidden on mobile */}
      <nav className="hide-mobile" style={{ display:'flex', gap:2, flex:1, justifyContent:'center' }}>
        {NAV_LINKS.map(({ href, label }) => (
          <Link key={href} href={href} style={{
            color:'#6a9a6a', fontSize:12, fontWeight:600, letterSpacing:.2,
            padding:'5px 10px', borderRadius:6,
            border:'1px solid transparent', textDecoration:'none',
            transition:'all .15s', whiteSpace:'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.color='#d4af37'; e.currentTarget.style.borderColor='#d4af3722'; }}
          onMouseLeave={e => { e.currentTarget.style.color='#6a9a6a'; e.currentTarget.style.borderColor='transparent'; }}>
            {label}
          </Link>
        ))}
      </nav>

      {/* Mobile hamburger — shown only on mobile */}
      {isMobile && (
        <>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)}
                style={{ position:'fixed', inset:0, zIndex:98, background:'rgba(0,0,0,.5)' }} />
              <div style={{
                position:'fixed', top:58, left:0, right:0, zIndex:99,
                background:'linear-gradient(180deg,#0a140a,#060e06)',
                borderBottom:'1px solid #1a3a1a',
                boxShadow:'0 8px 32px rgba(0,0,0,.6)',
                display:'flex', flexDirection:'column',
              }}>
                {NAV_LINKS.map(({ href, label, icon }) => (
                  <Link key={href} href={href}
                    onClick={() => setMenuOpen(false)}
                    style={{
                      display:'flex', alignItems:'center', gap:14,
                      padding:'16px 24px',
                      borderBottom:'1px solid #1a3a1a',
                      textDecoration:'none', color:'#e8e0cc',
                      fontSize:15, fontWeight:600,
                    }}>
                    <span style={MENU_ICON}>{icon}</span>
                    {label}
                  </Link>
                ))}
                {mounted && isConnected && (
                  <button onClick={() => { disconnect(); setMenuOpen(false); }} style={{
                    display:'flex', alignItems:'center', gap:14,
                    padding:'16px 24px',
                    background:'transparent', border:'none', cursor:'pointer',
                    color:'#c0392b', fontSize:15, fontWeight:600, fontFamily:'inherit',
                    textAlign:'left',
                  }}>
                    <span style={MENU_ICON}>⏻</span>
                    Disconnect
                  </button>
                )}
              </div>
            </>
          )}

          {/* Hamburger button */}
          <button onClick={() => setMenuOpen(p => !p)} style={{
            background: menuOpen ? '#1a3a1a' : 'transparent',
            border:'1px solid #1a3a1a', borderRadius:8,
            padding:'7px 10px', cursor:'pointer',
            color:'#d4af37', fontSize:18, lineHeight:1,
            flexShrink:0, transition:'all .15s',
          }}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </>
      )}

      {/* Wallet section */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>

        {/* Wrong network warning + one-click switch */}
        {wrongNet && (
          <button onClick={() => switchChain?.({ chainId: EXPECTED })} style={{
            fontSize:10, color:'#e67e22', border:'1px solid #e67e2244',
            background:'#1a0e0422', borderRadius:6, padding:'3px 8px',
            fontWeight:600, cursor:'pointer',
          }}>
            ⚠ Switch to {CHAIN_NAMES[EXPECTED] || `Chain ${EXPECTED}`}
          </button>
        )}

        {mounted && isConnected && (
          <>
            {/* Network badge */}
            <div style={{
              fontSize:9, color:'#3a6a3a', border:'1px solid #1a3a1a',
              borderRadius:6, padding:'3px 8px', letterSpacing:.5,
              fontWeight:600,
            }} className="hide-mobile">
              {CHAIN_NAMES[chainId] || chainName}
            </div>

            {/* Human verified */}
            {isHuman && (
              <div style={{
                fontSize:8, color:'#27ae60', border:'1px solid #27ae6033',
                background:'#27ae6011', padding:'3px 8px', borderRadius:6, letterSpacing:.5,
                fontWeight:700,
              }}>
                ✓ VERIFIED
              </div>
            )}

            {/* CHIPS balance — hidden on mobile to save space */}
            <div className="hide-mobile" style={{
              background:'#0c1e0c', border:'1px solid #1a3a1a',
              borderRadius:8, padding:'5px 12px',
              display:'flex', alignItems:'center', gap:6,
            }}>
              <span style={{ fontSize:12, color:'#d4af37' }}>◈</span>
              <span style={{ fontSize:12, color:'#d4af37', fontWeight:700,
                fontFamily:"'JetBrains Mono',monospace" }}>
                {chipsBalance != null
                  ? chipsBalance.toLocaleString(undefined, { maximumFractionDigits:0 })
                  : '—'}
              </span>
            </div>

            {/* Mobile: compact chip balance next to hamburger */}
            {isMobile && chipsBalance != null && (
              <div style={{
                fontSize:12, color:'#d4af37', fontWeight:700,
                fontFamily:"'JetBrains Mono',monospace",
              }}>
                ◈{chipsBalance >= 1000
                  ? `${(chipsBalance/1000).toFixed(1)}K`
                  : chipsBalance}
              </div>
            )}

            {/* Handle/Address + disconnect — desktop only; mobile uses hamburger menu */}
            {!isMobile && (
              <button onClick={disconnect} style={{
                background:'#0c1e0c', border:'1px solid #1a3a1a',
                borderRadius:8, padding:'5px 12px', cursor:'pointer',
                color:'#8aaa8a', fontSize:11, fontFamily:'inherit', fontWeight:600,
                display:'flex', alignItems:'center', gap:6,
                transition:'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#c0392b55'; e.currentTarget.style.color='#e74c3c'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='#1a3a1a'; e.currentTarget.style.color='#8aaa8a'; }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:'#27ae60', flexShrink:0 }} />
                {displayName}
              </button>
            )}
          </>
        )}

        {mounted && !isConnected && wagmiStatus === 'reconnecting' && (
          <div style={{
            background:'#0c1e0c', border:'1px solid #1a3a1a',
            borderRadius:8, padding:'8px 20px',
            color:'#3a6a3a', fontSize:12, fontWeight:600,
          }}>…</div>
        )}

        {mounted && !isConnected && wagmiStatus !== 'reconnecting' && (
          <div style={{ position:'relative' }}>
            <button onClick={() => setShowPicker(p => !p)} style={{
              background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
              border:'1px solid #d4af3755', borderRadius:8,
              padding:'8px 20px', cursor:'pointer',
              color:'#d4af37', fontSize:13, fontWeight:700,
              fontFamily:'inherit', letterSpacing:.3,
              transition:'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='#d4af37aa'; e.currentTarget.style.boxShadow='0 0 16px #d4af3722'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='#d4af3755'; e.currentTarget.style.boxShadow='none'; }}>
              Connect Wallet ▾
            </button>

            {showPicker && (
              <>
                {/* backdrop to close */}
                <div onClick={() => setShowPicker(false)} style={{
                  position:'fixed', inset:0, zIndex:199,
                }} />
                <div style={{
                  position:'absolute', top:'calc(100% + 8px)', right:0,
                  background:'#0a140a', border:'1px solid #1a3a1a',
                  borderRadius:12, padding:8, zIndex:200,
                  minWidth:220, boxShadow:'0 8px 32px #000a',
                  display:'flex', flexDirection:'column', gap:4,
                }}>
                  <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2,
                    padding:'4px 10px', fontWeight:700 }}>CHOOSE WALLET</div>

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
                        : () => { window.open(`https://metamask.app.link/dapp/${siteUrl}`,'_blank'); setShowPicker(false); }
                      }
                    />
                  )}

                  {/* WalletConnect — only shown when project ID is configured */}
                  {HAS_WC && !isInMiniApp && (
                    <WalletOption
                      icon="🔗"
                      label="WalletConnect"
                      sub="Scan QR code"
                      onClick={() => pick(connectWalletConnect)}
                    />
                  )}

                  {/* Coinbase Wallet */}
                  {!isInMiniApp && (
                    <WalletOption
                      icon="🔵"
                      label="Coinbase Wallet"
                      sub="Mobile or extension"
                      onClick={() => pick(connectCoinbase)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function WalletOption({ icon, label, sub, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? '#0c2e0c' : 'transparent',
        border: `1px solid ${hover ? '#d4af3733' : 'transparent'}`,
        borderRadius:8, padding:'8px 12px', cursor:'pointer',
        display:'flex', alignItems:'center', gap:10, width:'100%',
        transition:'all .12s',
      }}>
      <span style={{ fontSize:20 }}>{icon}</span>
      <div style={{ textAlign:'left' }}>
        <div style={{ color:'#d4af37', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>{label}</div>
        <div style={{ color:'#3a6a3a', fontSize:10 }}>{sub}</div>
      </div>
    </button>
  );
}
