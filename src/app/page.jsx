'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WalletBar from '../components/WalletBar';
import { useAccount } from 'wagmi';
import { useCreateTable } from '../hooks/usePokerWallet';

const GAME_LABEL = { 0:"No Limit Hold'em", 1:'Pot Limit Omaha' };

function fmt(v) {
  return v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M`
       : v >= 1_000     ? `${(v/1_000).toFixed(0)}K`
       : String(v || 0);
}

function StatusBadge({ phase }) {
  const active = phase && phase !== 'waiting';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: .5,
      color: active ? '#27ae60' : '#d4af37',
      background: active ? '#27ae6015' : '#d4af3715',
      border: `1px solid ${active ? '#27ae6040' : '#d4af3740'}`,
      borderRadius: 4, padding: '2px 7px',
    }}>
      {active ? 'LIVE' : 'OPEN'}
    </span>
  );
}

function TableCard({ table }) {
  const [hov, setHov] = useState(false);
  const phase = table.phase || 'waiting';
  const seated = table.seated || 0;
  const max = table.config?.maxPlayers || 9;
  const buyIn = table.config?.buyIn || 0;
  const bigBlind = table.config?.bigBlind || 0;
  const gameType = table.config?.gameType || 0;

  const q = `?buyIn=${buyIn}&bigBlind=${bigBlind}&maxPlayers=${max}&gameType=${gameType}`;
  return (
    <Link href={`/table/${table.id}${q}`} style={{ textDecoration:'none' }}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          background: hov ? '#111f11' : '#0c1a0c',
          border: `1px solid ${hov ? '#2a4a2a' : '#1a3a1a'}`,
          borderRadius: 10, padding: '14px 16px',
          cursor: 'pointer', transition: 'all .15s',
          display: 'flex', alignItems: 'center', gap: 12,
        }}
      >
        {/* Left: game type icon */}
        <div style={{
          width: 38, height: 38, borderRadius: 8, flexShrink: 0,
          background: gameType === 1 ? '#1a0a2a' : '#0a1a0a',
          border: `1px solid ${gameType === 1 ? '#8e44ad44' : '#1a3a1a'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, color: gameType === 1 ? '#9b59b6' : '#27ae60',
        }}>
          ♠
        </div>

        {/* Middle: name + blinds */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: hov ? '#d4af37' : '#e8e0cc',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {table.name || `Table #${String(table.id).slice(0,8)}`}
            </span>
            <StatusBadge phase={phase} />
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#6a9a6a', fontFamily:"'JetBrains Mono',monospace" }}>
              {fmt(bigBlind/2)}/{fmt(bigBlind)}
            </span>
            <span style={{ fontSize: 10, color: '#3a6a3a' }} className="hide-mobile">
              {GAME_LABEL[gameType]}
            </span>
          </div>
        </div>

        {/* Right: buy-in + seats */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#d4af37', fontWeight: 700,
            fontFamily:"'JetBrains Mono',monospace" }}>
            ◈ {fmt(buyIn)}
          </span>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {Array.from({ length: max }).map((_,i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i < seated ? '#27ae60' : '#1a3a1a',
              }} />
            ))}
            <span style={{ fontSize: 9, color: '#4a7a4a', marginLeft: 3 }}>
              {seated}/{max}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

const BLINDS_PRESETS = [10, 20, 50, 100, 200];
const GAME_OPTIONS   = [{ v:0, label:"No Limit Hold'em" }, { v:1, label:'Pot Limit Omaha' }];

function CreateTableModal({ onClose }) {
  const router = useRouter();
  const { createTable, status, newTableId, errorMsg } = useCreateTable();

  const [gameType,    setGameType]    = useState(0);
  const [bigBlind,    setBigBlind]    = useState(20);
  const [customBB,    setCustomBB]    = useState('');
  const [buyIn,       setBuyIn]       = useState(2000);
  const [maxPlayers,  setMaxPlayers]  = useState(6);

  const effectiveBB = customBB ? Number(customBB) : bigBlind;

  // Auto-set buy-in to 100× BB when preset changes
  useEffect(() => { if (!customBB) setBuyIn(effectiveBB * 100); }, [effectiveBB]);

  // Navigate to new table when confirmed
  useEffect(() => {
    if (newTableId) {
      const q = `?buyIn=${buyIn}&bigBlind=${effectiveBB}&maxPlayers=${maxPlayers}&gameType=${gameType}`;
      router.push(`/table/${newTableId}${q}`);
    }
  }, [newTableId]);

  const handleSubmit = () => {
    if (!effectiveBB || !buyIn || buyIn < effectiveBB * 2) return;
    createTable({ buyIn, bigBlind: effectiveBB, maxPlayers, gameType });
  };

  const busy = status === 'pending';

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.75)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:300, padding:16,
    }} onClick={onClose}>
      <div style={{
        background:'linear-gradient(160deg,#0d1f0d,#060e06)',
        border:'1px solid #2a5a2a', borderRadius:16, padding:'28px 24px',
        width:'100%', maxWidth:420,
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:3, marginBottom:16 }}>CREATE TABLE</div>

        {/* Game type */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:'#5a8a5a', marginBottom:6, letterSpacing:.5 }}>GAME TYPE</div>
          <div style={{ display:'flex', gap:8 }}>
            {GAME_OPTIONS.map(o => (
              <button key={o.v} onClick={() => setGameType(o.v)} style={{
                flex:1, padding:'9px 0', borderRadius:8, cursor:'pointer',
                fontFamily:'inherit', fontSize:11, fontWeight:700,
                background: gameType===o.v ? 'linear-gradient(135deg,#1a4a1a,#0c2e0c)' : 'transparent',
                border:`1px solid ${gameType===o.v ? '#d4af37' : '#1a3a1a'}`,
                color: gameType===o.v ? '#d4af37' : '#5a8a5a',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Big Blind */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:'#5a8a5a', marginBottom:6, letterSpacing:.5 }}>BIG BLIND</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {BLINDS_PRESETS.map(b => (
              <button key={b} onClick={() => { setBigBlind(b); setCustomBB(''); }} style={{
                padding:'7px 14px', borderRadius:6, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                background: bigBlind===b && !customBB ? '#0c2e0c' : 'transparent',
                border:`1px solid ${bigBlind===b && !customBB ? '#d4af37' : '#1a3a1a'}`,
                color: bigBlind===b && !customBB ? '#d4af37' : '#5a8a5a',
                transition:'all .15s',
              }}>{b}</button>
            ))}
            <input
              type="number" placeholder="Custom"
              value={customBB}
              onChange={e => setCustomBB(e.target.value)}
              style={{
                width:80, padding:'7px 10px', borderRadius:6,
                background:'transparent', border:`1px solid ${customBB ? '#d4af37' : '#1a3a1a'}`,
                color: customBB ? '#d4af37' : '#5a8a5a',
                fontFamily:"'JetBrains Mono',monospace", fontSize:11,
                outline:'none',
              }}
            />
          </div>
        </div>

        {/* Buy-in */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:'#5a8a5a', marginBottom:6, letterSpacing:.5 }}>
            BUY-IN (CHIPS)
          </div>
          <input
            type="number" value={buyIn}
            onChange={e => setBuyIn(Number(e.target.value))}
            style={{
              width:'100%', padding:'9px 12px', borderRadius:8, boxSizing:'border-box',
              background:'#0a1a0a', border:'1px solid #1a3a1a',
              color:'#d4af37', fontFamily:"'JetBrains Mono',monospace", fontSize:13,
              outline:'none',
            }}
          />
          <div style={{ fontSize:9, color:'#3a6a3a', marginTop:4 }}>
            = {effectiveBB ? Math.round(buyIn / effectiveBB) : 0}× big blind
          </div>
        </div>

        {/* Max players */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, color:'#5a8a5a', marginBottom:6, letterSpacing:.5 }}>MAX SEATS</div>
          <div style={{ display:'flex', gap:6 }}>
            {[2,4,6,9].map(n => (
              <button key={n} onClick={() => setMaxPlayers(n)} style={{
                flex:1, padding:'7px 0', borderRadius:6, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
                background: maxPlayers===n ? '#0c2e0c' : 'transparent',
                border:`1px solid ${maxPlayers===n ? '#d4af37' : '#1a3a1a'}`,
                color: maxPlayers===n ? '#d4af37' : '#5a8a5a',
                transition:'all .15s',
              }}>{n}</button>
            ))}
          </div>
        </div>

        {errorMsg && (
          <div style={{ fontSize:11, color:'#e74c3c', marginBottom:12,
            background:'#1a0707', border:'1px solid #c0392b44',
            borderRadius:6, padding:'8px 12px', lineHeight:1.5 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{
            flex:1, padding:'12px', borderRadius:8, cursor:'pointer',
            background:'transparent', border:'1px solid #1a3a1a',
            color:'#5a7a5a', fontSize:12, fontFamily:'inherit',
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={busy} style={{
            flex:2, padding:'12px', borderRadius:8, cursor: busy ? 'not-allowed' : 'pointer',
            background: busy ? '#0a160a' : 'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
            border:`1px solid ${busy ? '#1a3a1a' : '#d4af37'}`,
            color: busy ? '#3a6a3a' : '#d4af37',
            fontSize:12, fontWeight:700, fontFamily:'inherit',
            transition:'all .15s',
          }}>
            {busy ? 'Confirming…' : '＋ Create Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  const { address } = useAccount();
  const [tableList, setTableList] = useState([]);
  const [serverOnline, setServerOnline] = useState(false);
  const [filter, setFilter]     = useState('all');
  const [mounted, setMounted]   = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Poll server for table list via plain HTTP — no WS auth required
  const serverBase = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000').replace(/^ws/, 'http');
  useEffect(() => {
    const poll = () =>
      fetch(`${serverBase}/tables`)
        .then(r => r.json())
        .then(d => { setTableList(d.tables || []); setServerOnline(true); })
        .catch(() => setServerOnline(false));
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [serverBase]);

  const filters = [
    { id:'all',  label:"All Tables" },
    { id:'nlh',  label:"Hold'em" },
    { id:'plo',  label:'Omaha' },
    { id:'open', label:'Open' },
  ];

  const filtered = tableList.filter(t => {
    if (filter === 'nlh')  return (t.config?.gameType||0) === 0;
    if (filter === 'plo')  return (t.config?.gameType||0) === 1;
    if (filter === 'open') return !t.phase || t.phase === 'waiting';
    return true;
  }).sort((a,b) => {
    const aLive = a.phase && a.phase !== 'waiting' ? 1 : 0;
    const bLive = b.phase && b.phase !== 'waiting' ? 1 : 0;
    return bLive - aLive || (b.seated||0) - (a.seated||0);
  });

  const liveCount  = tableList.filter(t => t.phase && t.phase !== 'waiting').length;
  const totalSeated = tableList.reduce((s,t) => s + (t.seated||0), 0);

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      {/* Hero */}
      <div style={{
        background:'linear-gradient(180deg,#0a1f0a 0%,#060e06 100%)',
        borderBottom:'1px solid #1a3a1a',
        padding:'36px 24px 28px',
        textAlign:'center',
        position:'relative',
        overflow:'hidden',
      }}>
        {/* Background spade watermark */}
        <div style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          fontSize:200, color:'rgba(255,255,255,.012)',
          pointerEvents:'none', userSelect:'none', lineHeight:1,
        }}>♠</div>

        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{ fontSize:10, color:'#3a6a3a', letterSpacing:4, marginBottom:10, fontWeight:600 }}>
            ONCHAIN  ·  PVP  ·  POKER
          </div>
          <h1 style={{ fontSize:clamp(28, 42), fontWeight:900, color:'#d4af37',
            fontFamily:"'Playfair Display',serif", letterSpacing:1, marginBottom:8, lineHeight:1.1 }}>
            PokerVsPals
          </h1>
          <p style={{ fontSize:13, color:'#5a8a5a', letterSpacing:.3, marginBottom:24,
            maxWidth:460, margin:'0 auto 24px' }}>
            Real PvP poker. Instant onchain settlement. No house edge.
          </p>

          {/* Stats row */}
          <div style={{ display:'flex', gap:16, justifyContent:'center', flexWrap:'wrap', marginBottom:28 }}>
            {[
              { label:'Players Online', value: String(totalSeated), icon:'◉' },
              { label:'Live Tables',    value: String(liveCount),   icon:'♠' },
              { label:'Open Tables',    value: String(tableList.length - liveCount), icon:'◈' },
            ].map(s => (
              <div key={s.label} style={{
                background:'rgba(12,30,12,.8)', border:'1px solid #1a3a1a',
                borderRadius:10, padding:'12px 20px', minWidth:110, textAlign:'center',
              }}>
                <div style={{ fontSize:20, color:'#d4af37', fontWeight:700,
                  fontFamily:"'JetBrains Mono',monospace", lineHeight:1.2 }}>
                  {serverOnline ? s.value : '—'}
                </div>
                <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1, marginTop:2, fontWeight:600 }}>
                  {s.label.toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          {mounted && !address && (
            <div style={{ fontSize:12, color:'#3a6a3a' }}>
              Connect your wallet to join a table
            </div>
          )}
        </div>
      </div>

      {/* Create Table Modal */}
      {showCreate && <CreateTableModal onClose={() => setShowCreate(false)} />}

      {/* Main content */}
      <div style={{ maxWidth:800, margin:'0 auto', padding:'24px 16px' }}>

        {/* Filter tabs */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          marginBottom:16, gap:8, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:4 }}>
            {filters.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                background: filter===f.id ? '#0c1e0c' : 'transparent',
                border:`1px solid ${filter===f.id ? '#d4af3744' : '#1a3a1a'}`,
                borderRadius:6, padding:'6px 14px', cursor:'pointer',
                color: filter===f.id ? '#d4af37' : '#6a9a6a',
                fontSize:12, fontWeight:600, fontFamily:'inherit',
                transition:'all .15s',
              }}>{f.label}</button>
            ))}
          </div>

          {mounted && address && (
            <button onClick={() => setShowCreate(true)} style={{
              background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
              border:'1px solid #d4af3744', borderRadius:6,
              padding:'6px 14px', cursor:'pointer',
              color:'#d4af37', fontSize:12, fontWeight:700, fontFamily:'inherit',
              letterSpacing:.3, transition:'all .15s', flexShrink:0,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='#d4af37aa'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='#d4af3744'; }}>
              ＋ Create Table
            </button>
          )}

          {/* Connection status */}
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:'#3a6a3a' }}>
            <div style={{
              width:6, height:6, borderRadius:'50%',
              background: serverOnline ? '#27ae60' : '#3a6a3a',
              boxShadow: serverOnline ? '0 0 6px #27ae60' : 'none',
              animation: serverOnline ? 'live-dot 2s infinite' : 'none',
            }} />
            <span style={{ fontWeight:600 }}>
              {serverOnline ? 'Live' : mounted && address ? 'Connecting…' : 'Not connected'}
            </span>
          </div>
        </div>

        {/* Table list */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {filtered.map(t => <TableCard key={t.id} table={t} />)}

          {filtered.length === 0 && (
            <div style={{
              textAlign:'center', padding:'56px 24px',
              background:'#0c1a0c', border:'1px solid #1a3a1a',
              borderRadius:12,
            }}>
              <div style={{ fontSize:40, marginBottom:12, opacity:.4 }}>♠</div>
              {!serverOnline ? (
                <div>
                  <div style={{ color:'#3a6a3a', fontSize:13, fontWeight:500, marginBottom:4 }}>
                    Connecting to game server…
                  </div>
                  <div style={{ fontSize:10, color:'#1a3a1a' }}>
                    Make sure <code>npm run server</code> is running
                  </div>
                </div>
              ) : (
                <div style={{ color:'#3a6a3a', fontSize:13, fontWeight:500 }}>
                  No tables right now — check back soon.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Private rooms CTA */}
        <div style={{
          marginTop:32, padding:'20px 24px',
          background:'linear-gradient(135deg,#0c1a0c,#0a180a)',
          border:'1px solid #1a3a1a', borderRadius:12,
          display:'flex', alignItems:'center', justifyContent:'space-between',
          flexWrap:'wrap', gap:16,
        }}>
          <div>
            <div style={{ fontSize:13, color:'#d4af37', fontWeight:700, marginBottom:4 }}>
              🏠 Host a Private Room
            </div>
            <div style={{ fontSize:11, color:'#5a8a5a', maxWidth:380, lineHeight:1.6 }}>
              100 CHIPS/week — set custom buy-ins, NFT-gate for your community.
            </div>
          </div>
          <Link href="/stake" style={{
            background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
            border:'1px solid #d4af3744', borderRadius:8,
            padding:'9px 20px', textDecoration:'none',
            color:'#d4af37', fontSize:12, fontWeight:700, letterSpacing:.3,
            whiteSpace:'nowrap',
          }}>
            Lease a Room →
          </Link>
        </div>
      </div>

    </div>
  );
}

// Helper for responsive font size (avoids clamp SSR issues)
function clamp(min, max) { return max; }
