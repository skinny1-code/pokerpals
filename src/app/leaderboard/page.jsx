'use client';
import { useState, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useAccount } from 'wagmi';
import { useLeaderboard, useHandle, generatedNameForAddress } from '../../hooks/usePokerWallet';

const TIER_NAMES  = ['Standard','Bronze','Silver','Gold','Whale'];
const TIER_COLORS = ['#6a9a6a','#cd7f32','#c0c0c0','#d4af37','#9b59b6'];

// Gold / Silver / Bronze medal palette for the top 3
const MEDAL_COLORS = ['#e8c25a','#cfd4dc','#d68a4a'];

// Podium columns render in 2nd/1st/3rd order
const PODIUM_HEIGHTS = [88, 116, 74];
const PODIUM_LABELS = ['2nd','1st','3rd'];
const PODIUM_TROPHIES = ['🥈','🏆','🥉'];
const PODIUM_MEDAL_COLORS = [MEDAL_COLORS[1], MEDAL_COLORS[0], MEDAL_COLORS[2]];

function fmt(v) {
  return v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
       : v >= 1_000     ? `${(v/1_000).toFixed(1)}K`
       : v.toLocaleString(undefined, { maximumFractionDigits:2 });
}

function RankMedal({ rank }) {
  if (rank === 1) return <span style={{ fontSize:18 }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize:18 }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize:18 }}>🥉</span>;
  return <span style={{ fontSize:12, color:'#5a8a5a', fontWeight:800,
    fontFamily:"'JetBrains Mono',monospace",
    width:26, display:'inline-block', textAlign:'center' }}>#{rank}</span>;
}

function LeaderRow({ entry, isHero }) {
  const [hov, setHov] = useState(false);
  const tierColor = TIER_COLORS[entry.tier] || TIER_COLORS[0];
  const isTop3 = entry.rank <= 3;
  const medalColor = isTop3 ? MEDAL_COLORS[entry.rank - 1] : null;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:'grid', gridTemplateColumns:'46px 2fr 1fr 88px',
        alignItems:'center', padding:'13px 16px', borderRadius:'var(--r-md)', gap:8,
        position:'relative', overflow:'hidden',
        background: isHero
          ? 'linear-gradient(135deg, rgba(232,194,90,.10), rgba(232,194,90,.03))'
          : isTop3
            ? `linear-gradient(135deg, ${medalColor}14, rgba(8,16,9,.5))`
            : hov ? 'rgba(255,255,255,.025)' : 'rgba(8,16,9,.35)',
        border:`1px solid ${
          isHero ? 'var(--border-gold)'
          : isTop3 ? `${medalColor}3a`
          : hov ? 'var(--border-mid)' : 'var(--border)'}`,
        boxShadow: isHero
          ? '0 0 22px rgba(232,194,90,.14)'
          : isTop3 ? `0 4px 18px ${medalColor}1a`
          : hov ? 'var(--shadow-sm)' : 'none',
        transform: hov ? 'translateY(-1px)' : 'none',
        transition:'transform .18s ease, box-shadow .2s ease, border-color .2s ease, background .2s ease',
      }}
    >
      {/* Left medal accent stripe for top 3 */}
      {isTop3 && (
        <div aria-hidden style={{
          position:'absolute', left:0, top:0, bottom:0, width:3,
          background:`linear-gradient(180deg, ${medalColor}, ${medalColor}55)`,
          boxShadow:`0 0 12px ${medalColor}88`,
        }} />
      )}

      <div style={{ display:'flex', justifyContent:'center', position:'relative' }}>
        <RankMedal rank={entry.rank} />
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:3, minWidth:0, position:'relative' }}>
        <span className={entry.rank === 1 ? 'gold-text' : undefined} style={{
          fontSize:14, color: entry.rank === 1 ? undefined : (isHero ? 'var(--gold-pale)' : '#d6cdb0'),
          fontWeight:800,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {entry.handle || generatedNameForAddress(entry.addr)}
          {isHero && <span style={{ fontSize:8, color:'var(--gold)', marginLeft:8, fontWeight:800,
            letterSpacing:1, border:'1px solid var(--border-gold)', borderRadius:5,
            padding:'2px 6px', verticalAlign:'middle',
            background:'rgba(232,194,90,.08)' }}>YOU</span>}
        </span>
      </div>

      <div className={entry.rank === 1 ? 'gold-text' : undefined} style={{
        fontSize:15, fontWeight:800, position:'relative',
        color: entry.rank === 1 ? undefined : 'var(--gold)',
        fontFamily:"'JetBrains Mono',monospace" }}>
        ◈ {fmt(entry.staked)}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', position:'relative' }}>
        <div style={{ fontSize:8, color:tierColor, border:`1px solid ${tierColor}55`,
          borderRadius:999, padding:'3px 10px', letterSpacing:1.4, fontWeight:800,
          background:`${tierColor}14` }}>
          {(TIER_NAMES[entry.tier] || 'Standard').toUpperCase()}
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'46px 2fr 1fr 88px',
      alignItems:'center', padding:'13px 16px', borderRadius:'var(--r-md)', gap:8,
      background:'rgba(8,16,9,.35)', border:'1px solid var(--border)',
    }}>
      {[40, 160, 80, 70].map((w, i) => (
        <div key={i} className="skeleton" style={{
          height:12, width: w,
        }} />
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const { address } = useAccount();
  const { myHandle } = useHandle();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { entries, loading } = useLeaderboard();

  const top3    = entries.slice(0, 3);
  const heroEntry = mounted ? entries.find(e => e.addr === address?.toLowerCase()) : null;

  return (
    <div className="has-bottom-nav" style={{ minHeight:'100vh', background:'var(--bg-abyss)' }}>
      <WalletBar />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="page-hero felt-texture" style={{ textAlign:'center' }}>
        {/* Animated aurora backdrop */}
        <div className="aurora" aria-hidden />

        {/* Watermark crown */}
        <div aria-hidden style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          fontSize:260, color:'rgba(255,255,255,.008)',
          pointerEvents:'none', userSelect:'none', lineHeight:1, zIndex:0,
        }}>♛</div>

        <div style={{ maxWidth:900, margin:'0 auto', position:'relative', zIndex:1 }}>
          <div className="pill animate-up s1" style={{ marginBottom:18, opacity:0 }}>
            <span className="dot-live" />
            HALL OF FAME
          </div>
          <h1 className="gold-text serif animate-up s2" style={{
            fontSize:44, fontWeight:900, lineHeight:1.05,
            marginBottom:12, opacity:0,
            textShadow:'0 0 50px rgba(232,194,90,.18)',
          }}>
            Leaderboard
          </h1>
          <div className="animate-up s3" style={{
            fontSize:13, color:'var(--text-secondary)', letterSpacing:.2, opacity:0,
          }}>
            Ranked by CHIPS staked · VIP tier determines your rake discount
          </div>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:'0 auto', padding:'30px 16px' }}>

        {/* Top 3 podium — only shown when data loaded */}
        {!loading && top3.length >= 3 && (
          <div className="glass-strong felt-texture" style={{
            display:'flex', gap:14, marginBottom:30, justifyContent:'center',
            alignItems:'flex-end', padding:'26px 18px 22px', position:'relative', overflow:'hidden',
          }}>
            {/* Soft top glow accent */}
            <div aria-hidden style={{
              position:'absolute', top:0, left:'50%', transform:'translateX(-50%)',
              width:360, height:120,
              background:'radial-gradient(ellipse at 50% 0%, rgba(232,194,90,.10), transparent 70%)',
              pointerEvents:'none',
            }} />
            {[top3[1], top3[0], top3[2]].map((e, i) => {
              const medalColor = PODIUM_MEDAL_COLORS[i];
              const isFirst   = i === 1;
              return (
                <div key={e.addr} style={{
                  display:'flex', flexDirection:'column', alignItems:'center', gap:7,
                  width:'min(160px, 31%)', position:'relative', zIndex:1,
                }}>
                  <div style={{ fontSize:9, color:`${medalColor}cc`, letterSpacing:2, fontWeight:800 }}>
                    {PODIUM_LABELS[i]}
                  </div>
                  <div className={isFirst ? 'gold-text' : undefined} style={{
                    fontSize: isFirst ? 15 : 13, fontWeight:800, maxWidth:'100%',
                    color: isFirst ? undefined : medalColor,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'center' }}>
                    {e.handle || generatedNameForAddress(e.addr)}
                  </div>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--gold)',
                    fontFamily:"'JetBrains Mono',monospace" }}>
                    ◈ {fmt(e.staked)}
                  </div>
                  <div style={{
                    width:'100%', height:PODIUM_HEIGHTS[i],
                    background: `linear-gradient(180deg, ${medalColor}30, ${medalColor}0a)`,
                    border:`1px solid ${medalColor}55`,
                    borderBottom:'none',
                    borderRadius:'12px 12px 0 0',
                    boxShadow: isFirst
                      ? `0 0 28px ${medalColor}44, inset 0 1px 0 rgba(255,255,255,.06)`
                      : `inset 0 1px 0 rgba(255,255,255,.04)`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize: isFirst ? 34 : 28,
                  }}>
                    {PODIUM_TROPHIES[i]}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Column headers */}
        <div style={{ display:'grid', gridTemplateColumns:'46px 2fr 1fr 88px',
          padding:'6px 16px', gap:8, borderBottom:'1px solid var(--border)', marginBottom:8 }}>
          {['#','Player','Staked','Tier'].map(h => (
            <div key={h} style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:1.5, fontWeight:800 }}>
              {h.toUpperCase()}
            </div>
          ))}
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {Array.from({length:8}).map((_,i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Rows */}
        {!loading && entries.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
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
          <div className="glass" style={{
            textAlign:'center', padding:'64px 24px',
          }}>
            <div style={{ fontSize:48, marginBottom:14, opacity:.25 }}>♠</div>
            <div style={{ fontSize:14, color:'var(--text-secondary)', fontWeight:700, marginBottom:6 }}>
              No handle holders yet
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>
              Mint a handle at <a href="/handle" style={{ color:'var(--gold)', fontWeight:700 }}>/handle</a> to appear here
            </div>
          </div>
        )}

        {/* Hero row if not in list */}
        {mounted && address && !heroEntry && !loading && entries.length > 0 && (
          <div className="glass-strong" style={{
            marginTop:14, padding:'14px 16px',
            border:'1px solid var(--border-gold)',
            boxShadow:'0 0 22px rgba(232,194,90,.10)',
          }}>
            <div style={{ display:'grid', gridTemplateColumns:'46px 2fr 1fr 88px',
              alignItems:'center', gap:8 }}>
              <div style={{ textAlign:'center', fontSize:12, color:'#5a8a5a', fontWeight:800 }}>—</div>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, color:'var(--gold-pale)', fontWeight:800 }}>
                  {myHandle || generatedNameForAddress(address)}
                  <span style={{ fontSize:8, marginLeft:8, fontWeight:800, letterSpacing:1,
                    border:'1px solid var(--border-gold)', borderRadius:5, padding:'2px 6px',
                    color:'var(--gold)', background:'rgba(232,194,90,.08)' }}>YOU</span>
                </div>
                <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:3 }}>
                  Mint a handle to join the leaderboard
                </div>
              </div>
              <div style={{ fontSize:13, color:'#6a9a6a', fontWeight:700,
                fontFamily:"'JetBrains Mono',monospace" }}>◈ —</div>
              <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <div style={{ fontSize:8, color:TIER_COLORS[0], border:`1px solid ${TIER_COLORS[0]}55`,
                  borderRadius:999, padding:'3px 10px', letterSpacing:1.4, fontWeight:800,
                  background:`${TIER_COLORS[0]}14` }}>STANDARD</div>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop:18, textAlign:'center', fontSize:10, color:'var(--text-muted)',
          letterSpacing:.4 }}>
          Live on-chain data from PokerHandle + ChipsStaking contracts
        </div>
      </div>
    </div>
  );
}
