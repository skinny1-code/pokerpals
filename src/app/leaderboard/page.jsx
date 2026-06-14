'use client';
import { useState, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useAccount } from 'wagmi';
import { useLeaderboard } from '../../hooks/usePokerWallet';

const TIER_NAMES  = ['Standard','Bronze','Silver','Gold','Whale'];
const TIER_COLORS = ['#6a9a6a','#cd7f32','#c0c0c0','#d4af37','#9b59b6'];

function fmt(v) {
  return v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
       : v >= 1_000     ? `${(v/1_000).toFixed(1)}K`
       : v.toLocaleString(undefined, { maximumFractionDigits:2 });
}

function RankMedal({ rank }) {
  if (rank === 1) return <span style={{ fontSize:16 }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize:16 }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize:16 }}>🥉</span>;
  return <span style={{ fontSize:12, color:'#3a6a3a', fontFamily:"'JetBrains Mono',monospace",
    width:24, display:'inline-block', textAlign:'center' }}>#{rank}</span>;
}

function LeaderRow({ entry, isHero }) {
  const [hov, setHov] = useState(false);
  const tierColor = TIER_COLORS[entry.tier] || TIER_COLORS[0];

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:'grid', gridTemplateColumns:'40px 2fr 1fr 80px',
        alignItems:'center', padding:'12px 16px', borderRadius:8, gap:8,
        background: isHero ? 'rgba(212,175,55,.06)' : hov ? 'rgba(255,255,255,.02)' : 'transparent',
        border:`1px solid ${isHero ? '#d4af3744' : hov ? '#1a3a1a55' : 'transparent'}`,
        transition:'all .15s',
      }}
    >
      <div style={{ display:'flex', justifyContent:'center' }}>
        <RankMedal rank={entry.rank} />
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
        <span style={{ fontSize:13, color: isHero ? '#d4af37' : '#d0c8b0', fontWeight:600,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {entry.handle || `${entry.addr.slice(0,10)}…`}
          {isHero && <span style={{ fontSize:9, color:'#d4af37', marginLeft:8,
            border:'1px solid #d4af3744', borderRadius:4, padding:'1px 5px' }}>YOU</span>}
        </span>
        <span style={{ fontSize:9, color:'#3a6a3a', fontFamily:"'JetBrains Mono',monospace" }}>
          {entry.addr.slice(0,8)}…{entry.addr.slice(-4)}
        </span>
      </div>

      <div style={{ fontSize:14, color:'#d4af37', fontWeight:700,
        fontFamily:"'JetBrains Mono',monospace" }}>
        ◈ {fmt(entry.staked)}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <div style={{ fontSize:8, color:tierColor, border:`1px solid ${tierColor}44`,
          borderRadius:8, padding:'2px 8px', letterSpacing:1, background:`${tierColor}11` }}>
          {TIER_NAMES[entry.tier] || 'Standard'}
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'40px 2fr 1fr 80px',
      alignItems:'center', padding:'12px 16px', borderRadius:8, gap:8,
    }}>
      {[40, 160, 80, 70].map((w, i) => (
        <div key={i} style={{
          height:12, borderRadius:4, background:'#1a3a1a',
          width: w, animation:'pulse 1.5s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const { address } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { entries, loading } = useLeaderboard();

  const top3    = entries.slice(0, 3);
  const heroEntry = mounted ? entries.find(e => e.addr === address?.toLowerCase()) : null;

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      {/* Hero */}
      <div className="page-hero">
        <div style={{ maxWidth:900, margin:'0 auto', position:'relative', zIndex:1 }}>
          <div style={{ fontSize:10, color:'#3a6a3a', letterSpacing:3, marginBottom:10, fontWeight:700 }}>
            HALL OF FAME
          </div>
          <h1 style={{
            fontSize:36, color:'#d4af37', fontWeight:700,
            fontFamily:"'Playfair Display',serif",
            textShadow:'0 0 40px rgba(212,175,55,.2)', marginBottom:8,
          }}>
            Leaderboard
          </h1>
          <div style={{ fontSize:12, color:'#4a7a4a' }}>
            Ranked by CHIPS staked · VIP tier determines rake discount
          </div>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:'0 auto', padding:'28px 16px' }}>

        {/* Top 3 podium — only shown when data loaded */}
        {!loading && top3.length >= 3 && (
          <div style={{ display:'flex', gap:12, marginBottom:32, justifyContent:'center',
            alignItems:'flex-end' }}>
            {[top3[1], top3[0], top3[2]].map((e, i) => {
              const heights = [80, 100, 70];
              const medals  = ['2nd','1st','3rd'];
              const tierColor = TIER_COLORS[e.tier] || TIER_COLORS[0];
              return (
                <div key={e.addr} style={{
                  display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                  width:160,
                }}>
                  <div style={{ fontSize:9, color:'#d4af37aa', letterSpacing:2 }}>{medals[i]}</div>
                  <div style={{ fontSize:14, color:tierColor, fontWeight:700, maxWidth:140,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'center' }}>
                    {e.handle || e.addr.slice(0,10)+'…'}
                  </div>
                  <div style={{ fontSize:11, color:'#d4af37', fontFamily:"'JetBrains Mono',monospace" }}>
                    ◈ {fmt(e.staked)}
                  </div>
                  <div style={{
                    width:'100%', height:heights[i],
                    background: `linear-gradient(180deg,${tierColor}33,${tierColor}11)`,
                    border:`1px solid ${tierColor}44`, borderRadius:'8px 8px 0 0',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:28,
                  }}>
                    {i===1 ? '🏆' : i===0 ? '🥈' : '🥉'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Column headers */}
        <div style={{ display:'grid', gridTemplateColumns:'40px 2fr 1fr 80px',
          padding:'6px 16px', gap:8, borderBottom:'1px solid #1a3a1a', marginBottom:4 }}>
          {['#','Player','Staked','Tier'].map(h => (
            <div key={h} style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1 }}>{h.toUpperCase()}</div>
          ))}
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {Array.from({length:8}).map((_,i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Rows */}
        {!loading && entries.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {entries.map(e => (
              <LeaderRow
                key={e.addr}
                entry={e}
                isHero={mounted && e.addr === address?.toLowerCase()}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && entries.length === 0 && (
          <div style={{
            textAlign:'center', padding:'56px 24px',
            background:'#0c1a0c', border:'1px solid #1a3a1a', borderRadius:12,
          }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>♠</div>
            <div style={{ fontSize:13, color:'#3a6a3a', fontWeight:500, marginBottom:4 }}>
              No handle holders yet
            </div>
            <div style={{ fontSize:10, color:'#1a3a1a' }}>
              Mint a handle at <a href="/handle" style={{ color:'#3a6a3a' }}>/handle</a> to appear here
            </div>
          </div>
        )}

        {/* Hero row if not in list */}
        {mounted && address && !heroEntry && !loading && entries.length > 0 && (
          <div style={{
            marginTop:12, padding:'12px 16px',
            background:'rgba(212,175,55,.04)', border:'1px solid #d4af3722',
            borderRadius:8,
          }}>
            <div style={{ display:'grid', gridTemplateColumns:'40px 2fr 1fr 80px',
              alignItems:'center', gap:8 }}>
              <div style={{ textAlign:'center', fontSize:11, color:'#3a6a3a' }}>—</div>
              <div>
                <div style={{ fontSize:12, color:'#d4af37' }}>
                  {address.slice(0,10)}…
                  <span style={{ fontSize:9, marginLeft:8,
                    border:'1px solid #d4af3744', borderRadius:4, padding:'1px 5px' }}>YOU</span>
                </div>
                <div style={{ fontSize:9, color:'#3a6a3a', marginTop:2 }}>
                  Mint a handle to join the leaderboard
                </div>
              </div>
              <div style={{ fontSize:11, color:'#6a9a6a', fontFamily:"'JetBrains Mono',monospace" }}>◈ —</div>
              <div style={{ fontSize:8, color:TIER_COLORS[0], border:'1px solid #6a9a6a44',
                borderRadius:8, padding:'2px 8px', textAlign:'center' }}>Standard</div>
            </div>
          </div>
        )}

        <div style={{ marginTop:16, textAlign:'center', fontSize:10, color:'#1a3a1a' }}>
          Live on-chain data from PokerHandle + ChipsStaking contracts
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { opacity:.4; } 50% { opacity:.8; }
        }
      `}</style>
    </div>
  );
}
