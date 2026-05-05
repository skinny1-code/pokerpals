'use client';
import { useState, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useAccount } from 'wagmi';

// Mock leaderboard data — replace with on-chain reads from PokerEscrow events
const MOCK_DATA = [
  { rank:1,  addr:'0xDEADBEEF11223344',  handle:'shark99',     chips:2_450_000, hands:1842, winRate:58.3, tier:4 },
  { rank:2,  addr:'0xAAAABBBBCCCCDDDD',  handle:'alice.eth',   chips:1_820_000, hands:1234, winRate:54.1, tier:3 },
  { rank:3,  addr:'0x1111222233334444',  handle:'CryptoKing',  chips:1_340_000, hands:982,  winRate:52.7, tier:3 },
  { rank:4,  addr:'0x5555666677778888',  handle:'0xPoker',     chips:880_000,   hands:744,  winRate:51.2, tier:2 },
  { rank:5,  addr:'0x9999AAAABBBBCCCC',  handle:'degenville',  chips:640_000,   hands:621,  winRate:49.8, tier:2 },
  { rank:6,  addr:'0xDDDDEEEEFFFF0000',  handle:null,          chips:520_000,   hands:504,  winRate:48.5, tier:1 },
  { rank:7,  addr:'0x0000111122223333',  handle:'VegasBaby',   chips:390_000,   hands:412,  winRate:47.2, tier:1 },
  { rank:8,  addr:'0x4444555566667777',  handle:null,          chips:280_000,   hands:334,  winRate:46.1, tier:0 },
  { rank:9,  addr:'0x8888999900001111',  handle:'chipmaster',  chips:210_000,   hands:287,  winRate:45.0, tier:0 },
  { rank:10, addr:'0xCCCCDDDDEEEEFFFF',  handle:null,          chips:180_000,   hands:241,  winRate:44.2, tier:0 },
];

const TIER_NAMES  = ['Standard','Bronze','Silver','Gold','Whale'];
const TIER_COLORS = ['#6a9a6a','#cd7f32','#c0c0c0','#d4af37','#9b59b6'];

function RankMedal({ rank }) {
  if (rank === 1) return <span style={{ fontSize:16 }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize:16 }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize:16 }}>🥉</span>;
  return <span style={{ fontSize:12, color:'#3a6a3a', fontFamily:"'JetBrains Mono',monospace",
    width:24, display:'inline-block', textAlign:'center' }}>#{rank}</span>;
}

function LeaderRow({ entry, isHero }) {
  const [hov, setHov] = useState(false);
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(1)}K` : String(v);
  const tierColor = TIER_COLORS[entry.tier] || TIER_COLORS[0];

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:'grid', gridTemplateColumns:'40px 2fr 1fr 1fr 1fr 80px',
        alignItems:'center', padding:'12px 16px', borderRadius:8, gap:8,
        background: isHero ? 'rgba(212,175,55,.06)' : hov ? 'rgba(255,255,255,.02)' : 'transparent',
        border:`1px solid ${isHero ? '#d4af3744' : hov ? '#1a3a1a55' : 'transparent'}`,
        transition:'all .15s',
      }}
    >
      <div style={{ display:'flex', justifyContent:'center' }}>
        <RankMedal rank={entry.rank} />
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        <span style={{ fontSize:13, color: isHero ? '#d4af37' : '#d0c8b0', fontWeight:600 }}>
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
        ◈ {fmt(entry.chips)}
      </div>

      <div style={{ fontSize:12, color:'#6a9a6a', fontFamily:"'JetBrains Mono',monospace" }}>
        {entry.hands.toLocaleString()}
      </div>

      <div style={{ fontSize:12, color: entry.winRate >= 50 ? '#27ae60' : '#e74c3c',
        fontFamily:"'JetBrains Mono',monospace" }}>
        {entry.winRate.toFixed(1)}%
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <div style={{ fontSize:8, color:tierColor, border:`1px solid ${tierColor}44`,
          borderRadius:8, padding:'2px 8px', letterSpacing:1, background:`${tierColor}11` }}>
          {TIER_NAMES[entry.tier]}
        </div>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { address } = useAccount();
  const [period, setPeriod] = useState('all');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const periods = [
    { id:'all',   label:'All Time' },
    { id:'month', label:'This Month' },
    { id:'week',  label:'This Week' },
  ];

  const heroEntry = mounted ? MOCK_DATA.find(e =>
    e.addr.toLowerCase() === address?.toLowerCase()
  ) : null;

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      <div style={{ maxWidth:900, margin:'0 auto', padding:'32px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:11, color:'#3a6a3a', letterSpacing:3, marginBottom:8 }}>
            HALL OF FAME
          </div>
          <h1 style={{ fontSize:28, color:'#d4af37', fontWeight:700,
            fontFamily:"'Playfair Display',serif" }}>
            Leaderboard
          </h1>
        </div>

        {/* Top 3 podium */}
        <div style={{ display:'flex', gap:12, marginBottom:32, justifyContent:'center',
          alignItems:'flex-end' }}>
          {[MOCK_DATA[1], MOCK_DATA[0], MOCK_DATA[2]].map((e, i) => {
            const heights = [80, 100, 70];
            const medals  = ['2nd','1st','3rd'];
            const tierColor = TIER_COLORS[e.tier];
            return (
              <div key={e.rank} style={{
                display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                width:160,
              }}>
                <div style={{ fontSize:9, color:'#d4af37aa', letterSpacing:2 }}>{medals[i]}</div>
                <div style={{ fontSize:14, color:tierColor, fontWeight:700, maxWidth:140,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'center' }}>
                  {e.handle || e.addr.slice(0,10)+'…'}
                </div>
                <div style={{ fontSize:11, color:'#d4af37', fontFamily:"'JetBrains Mono',monospace" }}>
                  ◈ {e.chips >= 1_000_000 ? `${(e.chips/1_000_000).toFixed(2)}M` : `${(e.chips/1000).toFixed(0)}K`}
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

        {/* Period filter */}
        <div style={{ display:'flex', gap:4, marginBottom:16 }}>
          {periods.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)} style={{
              background: period===p.id ? '#0c1e0c' : 'transparent',
              border:`1px solid ${period===p.id ? '#d4af3744' : '#1a3a1a'}`,
              borderRadius:6, padding:'5px 14px', cursor:'pointer',
              color: period===p.id ? '#d4af37' : '#6a9a6a',
              fontSize:11, fontWeight:700, fontFamily:'inherit',
            }}>{p.label}</button>
          ))}
        </div>

        {/* Column headers */}
        <div style={{ display:'grid', gridTemplateColumns:'40px 2fr 1fr 1fr 1fr 80px',
          padding:'6px 16px', gap:8, borderBottom:'1px solid #1a3a1a', marginBottom:4 }}>
          {['#','Player','Chips Won','Hands','Win Rate','Tier'].map(h => (
            <div key={h} style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1 }}>{h.toUpperCase()}</div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          {MOCK_DATA.map(e => (
            <LeaderRow
              key={e.rank}
              entry={e}
              isHero={mounted && e.addr.toLowerCase() === address?.toLowerCase()}
            />
          ))}
        </div>

        {/* Your position (if not in top 10) */}
        {mounted && address && !heroEntry && (
          <div style={{
            marginTop:12, padding:'12px 16px',
            background:'rgba(212,175,55,.04)', border:'1px solid #d4af3722',
            borderRadius:8,
          }}>
            <div style={{ display:'grid', gridTemplateColumns:'40px 2fr 1fr 1fr 1fr 80px',
              alignItems:'center', gap:8 }}>
              <div style={{ textAlign:'center', fontSize:11, color:'#3a6a3a' }}>—</div>
              <div style={{ fontSize:12, color:'#d4af37' }}>
                You ({address.slice(0,10)}…)
                <span style={{ fontSize:9, color:'#d4af37', marginLeft:8,
                  border:'1px solid #d4af3744', borderRadius:4, padding:'1px 5px' }}>YOU</span>
              </div>
              <div style={{ fontSize:11, color:'#6a9a6a', fontFamily:"'JetBrains Mono',monospace" }}>◈ 0</div>
              <div style={{ fontSize:11, color:'#6a9a6a', fontFamily:"'JetBrains Mono',monospace" }}>0</div>
              <div style={{ fontSize:11, color:'#6a9a6a', fontFamily:"'JetBrains Mono',monospace" }}>—</div>
              <div style={{ fontSize:8, color:TIER_COLORS[0], border:'1px solid #6a9a6a44',
                borderRadius:8, padding:'2px 8px', textAlign:'center' }}>Standard</div>
            </div>
          </div>
        )}

        <div style={{ marginTop:16, textAlign:'center', fontSize:10, color:'#1a3a1a' }}>
          Updated from on-chain data · Refreshes every block
        </div>
      </div>
    </div>
  );
}
