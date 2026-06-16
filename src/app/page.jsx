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
      fontSize: 8, fontWeight: 700, letterSpacing: 1,
      color: active ? '#2ecc71' : '#d4af37',
      background: active ? 'rgba(46,204,113,.12)' : 'rgba(212,175,55,.1)',
      border: `1px solid ${active ? 'rgba(46,204,113,.35)' : 'rgba(212,175,55,.3)'}`,
      borderRadius: 20, padding: '2px 8px',
      flexShrink: 0,
    }}>
      {active ? '● LIVE' : 'OPEN'}
    </span>
  );
}

function TableCard({ table }) {
  const [hov, setHov] = useState(false);
  const phase    = table.phase || 'waiting';
  const seated   = table.seated || 0;
  const max      = table.config?.maxPlayers || 9;
  const buyIn    = table.config?.buyIn || 0;
  const bigBlind = table.config?.bigBlind || 0;
  const gameType = table.config?.gameType || 0;
  const isLive   = phase && phase !== 'waiting';

  const q = `?buyIn=${buyIn}&bigBlind=${bigBlind}&maxPlayers=${max}&gameType=${gameType}`;
  const accentColor = isLive ? '#27ae60' : gameType === 1 ? '#9b59b6' : '#2e6b3a';

  return (
    <Link href={`/table/${table.id}${q}`} style={{ textDecoration:'none', display:'block' }}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          background: hov ? '#0f1f0f' : '#090f09',
          border: `1px solid ${hov ? '#2e4e2e' : '#162816'}`,
          borderRadius: 12,
          overflow: 'hidden',
          cursor: 'pointer',
          transition: 'transform .2s ease, box-shadow .2s ease, border-color .2s ease, background .2s ease',
          transform: hov ? 'translateY(-2px)' : 'none',
          boxShadow: hov
            ? '0 10px 28px rgba(0,0,0,.55), 0 0 0 1px rgba(212,175,55,.1)'
            : '0 2px 8px rgba(0,0,0,.35)',
          display: 'flex',
        }}
      >
        {/* Left accent stripe */}
        <div style={{
          width: 4, flexShrink: 0,
          background: `linear-gradient(180deg, ${accentColor}, ${accentColor}88)`,
        }} />

        <div style={{ flex:1, padding:'16px 20px', display:'flex', alignItems:'center', gap:16 }}>
          {/* Game icon */}
          <div style={{
            width: 46, height: 46, borderRadius: 10, flexShrink: 0,
            background: gameType === 1
              ? 'rgba(155,89,182,.12)' : 'rgba(39,174,96,.1)',
            border: `1px solid ${gameType === 1 ? 'rgba(155,89,182,.25)' : 'rgba(39,174,96,.2)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>
            {gameType === 1 ? '♦' : '♠'}
          </div>

          {/* Name + meta */}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
              <span style={{
                fontSize: 14, fontWeight: 700,
                color: hov ? '#d4af37' : '#ddd5bb',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'color .15s',
              }}>
                {table.name || `Table #${String(table.id).slice(0,8)}`}
              </span>
              <StatusBadge phase={phase} />
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:11, color:'#4a7a4a' }}>
              <span className="hide-mobile">{GAME_LABEL[gameType]}</span>
              <span className="hide-mobile" style={{ color:'#1e3a1e' }}>·</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace" }}>
                {fmt(bigBlind/2)}/{fmt(bigBlind)}
              </span>
            </div>
          </div>

          {/* Buy-in + seats */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
            <span style={{
              fontSize: 15, color:'#d4af37', fontWeight:700,
              fontFamily:"'JetBrains Mono',monospace",
            }}>
              ◈{fmt(buyIn)}
            </span>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ display:'flex', gap:3 }}>
                {Array.from({ length: max }).map((_,i) => (
                  <div key={i} style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: i < seated ? '#27ae60' : 'rgba(255,255,255,.08)',
                    boxShadow: i < seated ? '0 0 4px rgba(39,174,96,.6)' : 'none',
                    transition: 'background .2s',
                  }} />
                ))}
              </div>
              <span style={{ fontSize:10, color:'#3a5a3a', marginLeft:2 }}>
                {seated}/{max}
              </span>
            </div>
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

  const [gameType,   setGameType]   = useState(0);
  const [bigBlind,   setBigBlind]   = useState(20);
  const [customBB,   setCustomBB]   = useState('');
  const [buyIn,      setBuyIn]      = useState(2000);
  const [maxPlayers, setMaxPlayers] = useState(6);

  const effectiveBB = customBB ? Number(customBB) : bigBlind;

  useEffect(() => { if (!customBB) setBuyIn(effectiveBB * 100); }, [effectiveBB]);
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
      position:'fixed', inset:0,
      background:'rgba(0,0,0,.8)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:300, padding:16,
    }} onClick={onClose}>
      <div style={{
        background:'linear-gradient(160deg,#0d200d,#060e06)',
        border:'1px solid #2a5a2a',
        borderRadius:16, padding:'28px 24px',
        width:'100%', maxWidth:420,
        boxShadow:'0 24px 60px rgba(0,0,0,.7)',
        animation:'fade-in .2s ease forwards',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize:9, color:'#4a7a4a', letterSpacing:3, marginBottom:4 }}>CREATE TABLE</div>
        <div style={{ fontSize:22, color:'#d4af37', fontWeight:700,
          fontFamily:"'Playfair Display',serif", marginBottom:20 }}>
          New Cash Game
        </div>

        {/* Game type */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>GAME TYPE</div>
          <div style={{ display:'flex', gap:8 }}>
            {GAME_OPTIONS.map(o => (
              <button key={o.v} onClick={() => setGameType(o.v)} style={{
                flex:1, padding:'10px 0', borderRadius:8, cursor:'pointer',
                fontFamily:'inherit', fontSize:12, fontWeight:700,
                background: gameType===o.v ? 'linear-gradient(135deg,#1a4a1a,#0c2e0c)' : 'transparent',
                border:`1px solid ${gameType===o.v ? '#d4af37' : '#1e3a1e'}`,
                color: gameType===o.v ? '#d4af37' : '#4a7a4a',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Big Blind */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>BIG BLIND</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {BLINDS_PRESETS.map(b => (
              <button key={b} onClick={() => { setBigBlind(b); setCustomBB(''); }} style={{
                padding:'7px 14px', borderRadius:6, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
                background: bigBlind===b && !customBB ? '#0c2e0c' : 'transparent',
                border:`1px solid ${bigBlind===b && !customBB ? '#d4af37' : '#1e3a1e'}`,
                color: bigBlind===b && !customBB ? '#d4af37' : '#4a7a4a',
                transition:'all .15s',
              }}>{b}</button>
            ))}
            <input
              type="number" placeholder="Custom"
              value={customBB}
              onChange={e => setCustomBB(e.target.value)}
              style={{
                width:80, padding:'7px 10px', borderRadius:6,
                background:'transparent', border:`1px solid ${customBB ? '#d4af37' : '#1e3a1e'}`,
                color: customBB ? '#d4af37' : '#4a7a4a',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12,
                outline:'none',
              }}
            />
          </div>
        </div>

        {/* Buy-in */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>
            BUY-IN (CHIPS)
          </div>
          <input
            type="number" value={buyIn}
            onChange={e => setBuyIn(Number(e.target.value))}
            style={{
              width:'100%', padding:'10px 14px', borderRadius:8, boxSizing:'border-box',
              background:'#0a180a', border:'1px solid #1e3a1e',
              color:'#d4af37', fontFamily:"'JetBrains Mono',monospace", fontSize:14,
              outline:'none', transition:'border-color .15s',
            }}
            onFocus={e => e.target.style.borderColor = '#d4af3766'}
            onBlur={e => e.target.style.borderColor = '#1e3a1e'}
          />
          <div style={{ fontSize:9, color:'#3a6a3a', marginTop:5, fontFamily:"'JetBrains Mono',monospace" }}>
            = {effectiveBB ? Math.round(buyIn / effectiveBB) : 0}× big blind
          </div>
        </div>

        {/* Max players */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>MAX SEATS</div>
          <div style={{ display:'flex', gap:6 }}>
            {[2,4,6,9].map(n => (
              <button key={n} onClick={() => setMaxPlayers(n)} style={{
                flex:1, padding:'8px 0', borderRadius:6, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700,
                background: maxPlayers===n ? '#0c2e0c' : 'transparent',
                border:`1px solid ${maxPlayers===n ? '#d4af37' : '#1e3a1e'}`,
                color: maxPlayers===n ? '#d4af37' : '#4a7a4a',
                transition:'all .15s',
              }}>{n}</button>
            ))}
          </div>
        </div>

        {errorMsg && (
          <div style={{ fontSize:11, color:'#e74c3c', marginBottom:14,
            background:'rgba(192,57,43,.08)', border:'1px solid rgba(192,57,43,.3)',
            borderRadius:8, padding:'10px 14px', lineHeight:1.5 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{
            flex:1, padding:'12px', borderRadius:8, cursor:'pointer',
            background:'transparent', border:'1px solid #1e3a1e',
            color:'#4a7a4a', fontSize:12, fontFamily:'inherit',
            transition:'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='#2e5a2e'; e.currentTarget.style.color='#6a9a6a'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='#1e3a1e'; e.currentTarget.style.color='#4a7a4a'; }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={busy} style={{
            flex:2, padding:'12px', borderRadius:8, cursor: busy ? 'not-allowed' : 'pointer',
            background: busy ? '#0a160a' : 'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
            border:`1px solid ${busy ? '#1e3a1e' : '#d4af37'}`,
            color: busy ? '#3a5a3a' : '#d4af37',
            fontSize:13, fontWeight:700, fontFamily:'inherit',
            transition:'all .15s',
            boxShadow: busy ? 'none' : '0 0 16px rgba(212,175,55,.12)',
          }}>
            {busy ? 'Confirming…' : '＋ Create Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

const SEED_TABLES = [
  { id:9001, name:'Micro Stakes — NLH', config:{ gameType:0, maxPlayers:6, buyIn:1000,  bigBlind:20  }, phase:'waiting', seated:0 },
  { id:9002, name:'High Stakes — NLH',  config:{ gameType:0, maxPlayers:6, buyIn:10000, bigBlind:200 }, phase:'waiting', seated:0 },
];

export default function LobbyPage() {
  const { address } = useAccount();
  const [tableList,   setTableList]   = useState([]);
  const [serverOnline, setServerOnline] = useState(false);
  const [filter,      setFilter]      = useState('all');
  const [mounted,     setMounted]     = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
    { id:'all',  label:'All' },
    { id:'nlh',  label:"Hold'em" },
    { id:'plo',  label:'Omaha' },
    { id:'open', label:'Open' },
  ];

  // Show live tables when server is reachable; fall back to seed tables so the lobby is never empty
  const displayTables = serverOnline ? tableList : SEED_TABLES;

  const filtered = displayTables.filter(t => {
    if (filter === 'nlh')  return (t.config?.gameType||0) === 0;
    if (filter === 'plo')  return (t.config?.gameType||0) === 1;
    if (filter === 'open') return !t.phase || t.phase === 'waiting';
    return true;
  }).sort((a,b) => {
    const aLive = a.phase && a.phase !== 'waiting' ? 1 : 0;
    const bLive = b.phase && b.phase !== 'waiting' ? 1 : 0;
    return bLive - aLive || (b.seated||0) - (a.seated||0);
  });

  const liveCount   = displayTables.filter(t => t.phase && t.phase !== 'waiting').length;
  const totalSeated = displayTables.reduce((s,t) => s + (t.seated||0), 0);

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div style={{
        background:'radial-gradient(ellipse 120% 100% at 50% -20%, #0f2a0f 0%, #060e06 65%)',
        borderBottom:'1px solid #162816',
        padding:'56px 24px 44px',
        textAlign:'center',
        position:'relative',
        overflow:'hidden',
      }}>
        {/* Watermark spade */}
        <div aria-hidden style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          fontSize:320, color:'rgba(255,255,255,.006)',
          pointerEvents:'none', userSelect:'none', lineHeight:1,
        }}>♠</div>

        {/* Green glow beam */}
        <div aria-hidden style={{
          position:'absolute', top:0, left:'50%', transform:'translateX(-50%)',
          width:700, height:260,
          background:'radial-gradient(ellipse at 50% 0%, rgba(39,174,96,.07) 0%, transparent 65%)',
          pointerEvents:'none',
        }} />

        <div style={{ position:'relative', zIndex:1 }}>
          {/* Live pill */}
          <div style={{
            display:'inline-flex', alignItems:'center', gap:7,
            fontSize:9, color:'#4a7a4a', letterSpacing:3, marginBottom:18,
            fontWeight:700,
            border:'1px solid #1e3a1e', borderRadius:20, padding:'5px 16px',
            background:'rgba(6,14,6,.7)', backdropFilter:'blur(8px)',
          }}>
            <div style={{
              width:5, height:5, borderRadius:'50%', background:'#27ae60',
              boxShadow:'0 0 6px #27ae60',
              animation:'live-dot 2s infinite',
            }} />
            ONCHAIN · PVP · POKER
          </div>

          <h1 style={{
            fontSize:52, fontWeight:900, color:'#d4af37',
            fontFamily:"'Playfair Display',serif",
            letterSpacing:-.5, marginBottom:14, lineHeight:1,
            textShadow:'0 0 60px rgba(212,175,55,.25)',
          }}>
            PokerVsPals
          </h1>

          <p style={{
            fontSize:14, color:'#5a8a5a', letterSpacing:.2,
            maxWidth:400, margin:'0 auto 34px', lineHeight:1.7,
          }}>
            Real players. Instant onchain settlement.<br/>No house edge, no bots.
          </p>

          {/* Stats */}
          <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap', marginBottom:28 }}>
            {[
              { label:'Players Online', value: String(totalSeated) },
              { label:'Live Tables',    value: String(liveCount)   },
              { label:'Open Seats',     value: String(tableList.length - liveCount) },
            ].map(s => (
              <div key={s.label} style={{
                background:'rgba(6,14,6,.75)',
                border:'1px solid #1a3218',
                borderRadius:12, padding:'14px 24px',
                minWidth:100, textAlign:'center',
                backdropFilter:'blur(8px)',
              }}>
                <div style={{
                  fontSize:28, color:'#d4af37', fontWeight:900,
                  fontFamily:"'JetBrains Mono',monospace", lineHeight:1.1,
                }}>
                  {serverOnline ? s.value : '—'}
                </div>
                <div style={{ fontSize:9, color:'#3a5a3a', letterSpacing:2, marginTop:5, fontWeight:700 }}>
                  {s.label.toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          {(!mounted || !address) && (
            <p style={{ fontSize:12, color:'#3a5a3a', letterSpacing:.5 }}>
              Connect your wallet above to join a table
            </p>
          )}
        </div>
      </div>

      {showCreate && <CreateTableModal onClose={() => setShowCreate(false)} />}

      {/* ── Main content ─────────────────────────────────────────── */}
      <div style={{ maxWidth:800, margin:'0 auto', padding:'28px 16px' }}>

        {/* Section header + controls */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          marginBottom:16, gap:10, flexWrap:'wrap',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:10, color:'#3a5a3a', letterSpacing:3, fontWeight:700 }}>
              TABLES
            </span>
            {/* Filter tabs */}
            <div style={{
              display:'flex', gap:2,
              background:'rgba(6,14,6,.8)', border:'1px solid #162816',
              borderRadius:8, padding:3,
            }}>
              {filters.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} style={{
                  background: filter===f.id ? '#162816' : 'transparent',
                  border: 'none',
                  borderRadius:6, padding:'5px 12px', cursor:'pointer',
                  color: filter===f.id ? '#d4af37' : '#4a7a4a',
                  fontSize:11, fontWeight:700, fontFamily:'inherit',
                  transition:'all .15s',
                  boxShadow: filter===f.id ? '0 1px 4px rgba(0,0,0,.3)' : 'none',
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {/* Server status */}
            <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:10, color:'#3a5a3a' }}>
              <div style={{
                width:6, height:6, borderRadius:'50%',
                background: serverOnline ? '#27ae60' : '#3a5a3a',
                boxShadow: serverOnline ? '0 0 6px #27ae60' : 'none',
                animation: serverOnline ? 'live-dot 2s infinite' : 'none',
              }} />
              <span style={{ fontWeight:600 }}>
                {serverOnline ? 'Live' : mounted && address ? 'Connecting…' : 'Offline'}
              </span>
            </div>

            {mounted && address ? (
              <button onClick={() => setShowCreate(true)} style={{
                background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
                border:'1px solid rgba(212,175,55,.4)', borderRadius:8,
                padding:'7px 16px', cursor:'pointer',
                color:'#d4af37', fontSize:12, fontWeight:700, fontFamily:'inherit',
                letterSpacing:.3, transition:'all .15s', flexShrink:0,
                boxShadow:'0 0 12px rgba(212,175,55,.08)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(212,175,55,.7)'; e.currentTarget.style.boxShadow='0 0 16px rgba(212,175,55,.18)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(212,175,55,.4)'; e.currentTarget.style.boxShadow='0 0 12px rgba(212,175,55,.08)'; }}>
                ＋ New Table
              </button>
            ) : (
              /* Skeleton placeholder — keeps layout stable pre-mount and for guests */
              <div style={{
                borderRadius:8, padding:'7px 16px',
                background:'rgba(26,74,26,.15)',
                border:'1px solid rgba(212,175,55,.12)',
                color:'rgba(212,175,55,.3)', fontSize:12, fontWeight:700,
                letterSpacing:.3, flexShrink:0, cursor:'default',
                opacity: mounted ? 0 : 1,
                transition:'opacity .2s',
              }}>
                ＋ New Table
              </div>
            )}
          </div>
        </div>

        {/* Table list */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(t => <TableCard key={t.id} table={t} />)}

          {filtered.length === 0 && (
            <div style={{
              textAlign:'center', padding:'64px 24px',
              background:'rgba(9,15,9,.6)',
              border:'1px solid #162816', borderRadius:14,
            }}>
              <div style={{ fontSize:48, marginBottom:14, opacity:.25 }}>♠</div>
              {!serverOnline ? (
                <>
                  <div style={{ color:'#3a5a3a', fontSize:13, fontWeight:600, marginBottom:6 }}>
                    No filter matches — try All
                  </div>
                </>
              ) : (
                <div style={{ color:'#3a5a3a', fontSize:13, fontWeight:500 }}>
                  No tables match this filter.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Private rooms CTA */}
        <div style={{
          marginTop:36,
          background:'linear-gradient(135deg,#090f09,#060e06)',
          border:'1px solid #1a3218',
          borderRadius:14, padding:'22px 28px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          flexWrap:'wrap', gap:16,
          position:'relative', overflow:'hidden',
        }}>
          {/* Subtle glow accent */}
          <div aria-hidden style={{
            position:'absolute', right:-40, top:-40,
            width:180, height:180,
            background:'radial-gradient(circle, rgba(212,175,55,.04) 0%, transparent 70%)',
            pointerEvents:'none',
          }} />
          <div style={{ position:'relative' }}>
            <div style={{ fontSize:10, color:'#5a7a4a', letterSpacing:2, fontWeight:700, marginBottom:4 }}>
              PRIVATE ROOMS
            </div>
            <div style={{ fontSize:14, color:'#c8bf9a', fontWeight:700, marginBottom:5 }}>
              Host your own poker room
            </div>
            <div style={{ fontSize:11, color:'#4a6a4a', maxWidth:360, lineHeight:1.6 }}>
              33,500 CHIPS/week · 100,000 CHIPS/month · NFT-gate for your community
            </div>
          </div>
          <Link href="/stake" style={{
            background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
            border:'1px solid rgba(212,175,55,.35)', borderRadius:8,
            padding:'10px 22px', textDecoration:'none',
            color:'#d4af37', fontSize:12, fontWeight:700, letterSpacing:.3,
            whiteSpace:'nowrap', position:'relative',
            boxShadow:'0 0 16px rgba(212,175,55,.1)',
            transition:'all .2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(212,175,55,.6)'; e.currentTarget.style.boxShadow='0 0 24px rgba(212,175,55,.2)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(212,175,55,.35)'; e.currentTarget.style.boxShadow='0 0 16px rgba(212,175,55,.1)'; }}>
            Lease a Room →
          </Link>
        </div>

      </div>
    </div>
  );
}
