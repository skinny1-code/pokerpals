'use client';
import { useState, useEffect } from 'react';
import { useWallet } from '../hooks/usePokerWallet';
import { useAccount } from 'wagmi';
import Link from 'next/link';

const CHAIN_NAMES = { 421614: 'Arbitrum Sepolia', 42161: 'Arbitrum One' };
const EXPECTED = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 421614);

export default function WalletBar() {
  const { address, isConnected, chipsBalance, isHuman,
          connectMetaMask, connectWalletConnect, connectCoinbase, disconnect } = useWallet();
  const { chainId } = useAccount();
  const [mounted, setMounted]         = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  const [siteUrl, setSiteUrl]         = useState('');
  const [showPicker, setShowPicker]   = useState(false);

  useEffect(() => {
    setMounted(true);
    setHasInjected(!!window.ethereum);
    setSiteUrl(window.location.host);
  }, []);

  function pick(fn) { fn(); setShowPicker(false); }

  const short = a => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '';
  const wrongNet = mounted && isConnected && chainId && chainId !== EXPECTED;
  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`;

  return (
    <header style={{
      background: 'linear-gradient(180deg,#0a140a 0%,rgba(6,14,6,.96) 100%)',
      borderBottom: '1px solid #1a3a1a',
      padding: '0 20px',
      height: 58,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(12px)',
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

      {/* Nav */}
      <nav style={{ display:'flex', gap:2, flex:1, justifyContent:'center' }}>
        {[
          { href:'/',            label:'Lobby' },
          { href:'/leaderboard', label:'Leaderboard' },
          { href:'/stake',       label:'Stake' },
          { href:'/buy',         label:'Buy CHIPS' },
          { href:'/handle',      label:'Handle' },
        ].map(({ href, label }) => (
          <Link key={href} href={href} style={{
            color:'#6a9a6a', fontSize:12, fontWeight:600, letterSpacing:.2,
            padding:'5px 10px', borderRadius:6,
            border:'1px solid transparent', textDecoration:'none',
            transition:'all .15s',
            whiteSpace:'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.color='#d4af37'; e.currentTarget.style.borderColor='#d4af3722'; }}
          onMouseLeave={e => { e.currentTarget.style.color='#6a9a6a'; e.currentTarget.style.borderColor='transparent'; }}>
            <span className="hide-mobile">{label}</span>
            <span className="show-mobile">{label.split(' ')[0]}</span>
          </Link>
        ))}
      </nav>

      {/* Wallet section */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>

        {/* Wrong network warning */}
        {wrongNet && (
          <div style={{
            fontSize:10, color:'#e67e22', border:'1px solid #e67e2244',
            background:'#1a0e0422', borderRadius:6, padding:'3px 8px',
            fontWeight:600,
          }}>
            ⚠ Wrong Network
          </div>
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

            {/* CHIPS balance */}
            <div style={{
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

            {/* Address / disconnect */}
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
              {short(address)}
            </button>
          </>
        )}

        {mounted && !isConnected && (
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

                  {/* MetaMask / injected */}
                  <WalletOption
                    icon="🦊"
                    label="MetaMask"
                    sub={hasInjected ? 'Detected' : 'Install →'}
                    onClick={hasInjected
                      ? () => pick(connectMetaMask)
                      : () => { window.open(`https://metamask.app.link/dapp/${siteUrl}`,'_blank'); setShowPicker(false); }
                    }
                  />

                  {/* WalletConnect */}
                  <WalletOption
                    icon="🔗"
                    label="WalletConnect"
                    sub="Scan QR code"
                    onClick={() => pick(connectWalletConnect)}
                  />

                  {/* Coinbase Wallet */}
                  <WalletOption
                    icon="🔵"
                    label="Coinbase Wallet"
                    sub="Mobile or extension"
                    onClick={() => pick(connectCoinbase)}
                  />
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
