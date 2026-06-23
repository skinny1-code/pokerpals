'use client';
import { useState, useEffect } from 'react';
import { useWallet, useHandle } from '../hooks/usePokerWallet';
import { useAccount, useSwitchChain } from 'wagmi';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useIsMobile } from '../hooks/useIsMobile';

const CHAIN_NAMES = { 421614: 'Arbitrum Sepolia', 42161: 'Arbitrum One' };
const EXPECTED = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 421614);
const HAS_WC = !!process.env.NEXT_PUBLIC_WC_PROJECT_ID;

const NAV_LINKS = [
  { href:'/',            label:'Lobby',        icon:'♠' },
  { href:'/tournament',  label:'Tournaments',  icon:'🏆' },
  { href:'/leaderboard', label:'Leaderboard',  icon:'◉' },
  { href:'/stake',       label:'Stake',        icon:'◈' },
  { href:'/rooms',       label:'Rooms',        icon:'♛' },
  { href:'/buy',         label:'Buy CHIPS',    icon:'$' },
  { href:'/handle',      label:'Handle',       icon:'@' },
];
// Primary destinations surfaced in the mobile bottom tab bar (5th slot = More)
const BOTTOM_LINKS = [
  { href:'/',           label:'Lobby',  icon:'♠' },
  { href:'/tournament', label:'Play',   icon:'🏆' },
  { href:'/stake',      label:'Stake',  icon:'◈' },
  { href:'/buy',        label:'Buy',    icon:'＄' },
];
const MENU_ICON = { fontSize:18, width:24, textAlign:'center' };

export default function WalletBar() {
  const { address, isConnected, chipsBalance, isHuman,
          connectMetaMask, connectWalletConnect, connectFarcaster, disconnect,
          connectStatus, connectError } = useWallet();
  const { myHandle } = useHandle();
  const { chainId, status: wagmiStatus } = useAccount();
  const { switchChain } = useSwitchChain();
  const isMobile = useIsMobile();
  const pathname = usePathname();
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

  // Don't close the picker on click — keep it open so the "Connecting…"/error
  // state is visible. On a successful connect the whole block unmounts (isConnected).
  function pick(fn) { fn(); }

  const short = a => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '';
  const wrongNet = mounted && isConnected && chainId && chainId !== EXPECTED;
  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`;
  const displayName = myHandle || short(address);
  const isActive = href => href === '/' ? pathname === '/' : pathname?.startsWith(href);

  return (
    <>
    <header style={{
      background: 'linear-gradient(180deg,#0a160b 0%,rgba(5,10,6,.94) 100%)',
      borderBottom: '1px solid var(--border)',
      boxShadow: '0 1px 28px rgba(0,0,0,.55)',
      padding: '0 18px',
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      gap: 12,
    }}>
      {/* gold hairline under the bar */}
      <div aria-hidden style={{
        position:'absolute', left:0, right:0, bottom:-1, height:1,
        background:'linear-gradient(90deg, transparent, rgba(232,194,90,.35), transparent)',
      }} />

      {/* Logo */}
      <Link href="/" style={{ textDecoration:'none', display:'flex', alignItems:'center', flexShrink:0, color:'var(--cream)' }}>
        <img src="/logo.png" alt="Poker Vs Player" style={{
          height:30, width:'auto', display:'block',
          filter:'drop-shadow(0 0 14px rgba(232,194,90,.25))',
        }} />
      </Link>

      {/* Desktop nav — hidden on mobile */}
      <nav className="hide-mobile" style={{ display:'flex', gap:2, flex:1, justifyContent:'center' }}>
        {NAV_LINKS.map(({ href, label }) => {
          const on = isActive(href);
          return (
            <Link key={href} href={href} style={{
              color: on ? 'var(--gold)' : '#6fa074', fontSize:12.5, fontWeight:600, letterSpacing:.2,
              padding:'6px 12px', borderRadius:8, position:'relative',
              border:`1px solid ${on ? 'rgba(232,194,90,.25)' : 'transparent'}`,
              background: on ? 'rgba(232,194,90,.07)' : 'transparent',
              textDecoration:'none', transition:'all .15s', whiteSpace:'nowrap',
            }}
            onMouseEnter={e => { if(!on){ e.currentTarget.style.color='var(--gold)'; e.currentTarget.style.borderColor='rgba(232,194,90,.18)'; } }}
            onMouseLeave={e => { if(!on){ e.currentTarget.style.color='#6fa074'; e.currentTarget.style.borderColor='transparent'; } }}>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile dropdown menu (full list + disconnect), driven by bottom-nav "More" */}
      {isMobile && menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)}
            style={{ position:'fixed', inset:0, zIndex:98, background:'rgba(0,0,0,.55)', backdropFilter:'blur(2px)' }} />
          <div style={{
            position:'fixed', left:10, right:10, bottom:'calc(74px + env(safe-area-inset-bottom))', zIndex:99,
            background:'linear-gradient(180deg,#0c1a0d,#060e07)',
            border:'1px solid var(--border-mid)', borderRadius:18,
            boxShadow:'0 20px 50px rgba(0,0,0,.7)',
            overflow:'hidden', animation:'pop-in .28s ease both',
          }}>
            {NAV_LINKS.map(({ href, label, icon }) => {
              const on = isActive(href);
              return (
                <Link key={href} href={href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display:'flex', alignItems:'center', gap:14,
                    padding:'15px 22px',
                    borderBottom:'1px solid rgba(28,58,34,.6)',
                    textDecoration:'none',
                    color: on ? 'var(--gold)' : '#e8e0cc',
                    background: on ? 'rgba(232,194,90,.06)' : 'transparent',
                    fontSize:15, fontWeight:600,
                  }}>
                  <span style={MENU_ICON}>{icon}</span>
                  {label}
                </Link>
              );
            })}
            {mounted && isConnected && (
              <button onClick={() => { disconnect(); setMenuOpen(false); }} style={{
                display:'flex', alignItems:'center', gap:14, width:'100%',
                padding:'15px 22px',
                background:'transparent', border:'none', cursor:'pointer',
                color:'#e0473b', fontSize:15, fontWeight:600, fontFamily:'inherit',
                textAlign:'left',
              }}>
                <span style={MENU_ICON}>⏻</span>
                Disconnect
              </button>
            )}
          </div>
        </>
      )}

      {/* Wallet section */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>

        {/* Wrong network warning + one-click switch */}
        {wrongNet && (
          <button onClick={() => switchChain?.({ chainId: EXPECTED })} style={{
            fontSize:10, color:'var(--orange)', border:'1px solid rgba(240,144,42,.35)',
            background:'rgba(240,144,42,.08)', borderRadius:7, padding:'4px 9px',
            fontWeight:700, cursor:'pointer',
          }}>
            ⚠ Switch to {CHAIN_NAMES[EXPECTED] || `Chain ${EXPECTED}`}
          </button>
        )}

        {mounted && isConnected && (
          <>
            {/* Network badge */}
            <div style={{
              fontSize:9, color:'var(--text-muted)', border:'1px solid var(--border)',
              borderRadius:6, padding:'4px 9px', letterSpacing:.5,
              fontWeight:700,
            }} className="hide-mobile">
              {CHAIN_NAMES[chainId] || chainName}
            </div>

            {/* Human verified */}
            {isHuman && (
              <div style={{
                fontSize:8, color:'var(--emerald-bright)', border:'1px solid rgba(16,185,129,.35)',
                background:'rgba(16,185,129,.1)', padding:'4px 9px', borderRadius:6, letterSpacing:.5,
                fontWeight:800,
              }}>
                ✓ VERIFIED
              </div>
            )}

            {/* CHIPS balance — hidden on mobile to save space */}
            <div className="hide-mobile" style={{
              background:'linear-gradient(135deg,#0e220f,#0a180b)', border:'1px solid var(--border-gold)',
              borderRadius:9, padding:'6px 13px',
              display:'flex', alignItems:'center', gap:6,
              boxShadow:'inset 0 1px 0 rgba(255,255,255,.04)',
            }}>
              <span style={{ fontSize:12, color:'var(--gold)' }}>◈</span>
              <span style={{ fontSize:12.5, color:'var(--gold-pale)', fontWeight:800,
                fontFamily:"'JetBrains Mono',monospace" }}>
                {chipsBalance != null
                  ? chipsBalance.toLocaleString(undefined, { maximumFractionDigits:0 })
                  : '—'}
              </span>
            </div>

            {/* Mobile: compact chip balance */}
            {isMobile && chipsBalance != null && (
              <div style={{
                fontSize:12.5, color:'var(--gold-pale)', fontWeight:800,
                fontFamily:"'JetBrains Mono',monospace",
                display:'flex', alignItems:'center', gap:3,
              }}>
                <span style={{ color:'var(--gold)' }}>◈</span>
                {chipsBalance >= 1000
                  ? `${(chipsBalance/1000).toFixed(1)}K`
                  : chipsBalance}
              </div>
            )}

            {/* Handle/Address + disconnect — desktop only; mobile uses bottom-nav menu */}
            {!isMobile && (
              <button onClick={disconnect} style={{
                background:'linear-gradient(135deg,#0e220f,#0a180b)', border:'1px solid var(--border)',
                borderRadius:9, padding:'6px 13px', cursor:'pointer',
                color:'var(--text-secondary)', fontSize:11.5, fontFamily:'inherit', fontWeight:700,
                display:'flex', alignItems:'center', gap:7,
                transition:'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(224,71,59,.45)'; e.currentTarget.style.color='#e0473b'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-secondary)'; }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--emerald)', flexShrink:0, boxShadow:'0 0 6px var(--emerald)' }} />
                {displayName}
              </button>
            )}
          </>
        )}

        {mounted && !isConnected && wagmiStatus === 'reconnecting' && (
          <div style={{
            background:'#0c1e0c', border:'1px solid var(--border)',
            borderRadius:9, padding:'8px 20px',
            color:'var(--text-muted)', fontSize:12, fontWeight:600,
          }}>…</div>
        )}

        {mounted && !isConnected && wagmiStatus !== 'reconnecting' && (
          <div style={{ position:'relative' }}>
            <button onClick={() => setShowPicker(p => !p)} className="btn btn-gold" style={{
              padding:'9px 20px', fontSize:13, letterSpacing:.3,
            }}>
              Connect Wallet ▾
            </button>

            {showPicker && (
              <>
                {/* backdrop to close */}
                <div onClick={() => setShowPicker(false)} style={{
                  position:'fixed', inset:0, zIndex:199,
                }} />
                <div style={{
                  position:'absolute', top:'calc(100% + 10px)', right:0,
                  background:'linear-gradient(180deg,#0c1a0d,#060e07)', border:'1px solid var(--border-mid)',
                  borderRadius:14, padding:8, zIndex:200,
                  minWidth:230, boxShadow:'0 18px 44px rgba(0,0,0,.7)',
                  display:'flex', flexDirection:'column', gap:4,
                  animation:'pop-in .22s ease both',
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
                        : () => { window.open(`https://metamask.app.link/dapp/${siteUrl}`,'_blank'); setShowPicker(false); }
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
              </>
            )}
          </div>
        )}
      </div>
    </header>

    {/* ── Mobile bottom tab bar ─────────────────────────────── */}
    {isMobile && (
      <nav className="bottom-nav">
        {BOTTOM_LINKS.map(({ href, label, icon }) => (
          <Link key={href} href={href} className={isActive(href) ? 'active' : ''}>
            <span className="bn-icon">{icon}</span>
            {label}
          </Link>
        ))}
        <button onClick={() => setMenuOpen(p => !p)} style={{
          display:'flex', flexDirection:'column', alignItems:'center', gap:3,
          padding:'7px 0 5px', background:'transparent', border:'none', cursor:'pointer',
          color: menuOpen ? 'var(--gold)' : 'var(--text-muted)',
          fontSize:9.5, fontWeight:700, fontFamily:'inherit',
        }}>
          <span style={{ fontSize:18, lineHeight:1 }}>{menuOpen ? '✕' : '☰'}</span>
          More
        </button>
      </nav>
    )}
    </>
  );
}

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
