'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WalletBar from '../components/WalletBar';
import { useAccount } from 'wagmi';
import { useCreateTable, wsHttpUrl } from '../hooks/usePokerWallet';

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
      fontSize: 8, fontWeight: 800, letterSpacing: 1,
      color: active ? '#34d399' : '#d9c08a',
      background: active ? 'rgba(16,185,129,.14)' : 'rgba(217,192,138,.1)',
      border: `1px solid ${active ? 'rgba(16,185,129,.4)' : 'rgba(217,192,138,.32)'}`,
      borderRadius: 20, padding: '2px 9px',
      flexShrink: 0,
      boxShadow: active ? '0 0 10px rgba(16,185,129,.25)' : 'none',
    }}>
      {active ? '● LIVE' : 'OPEN'}
    </span>
  );
}

function TableCard({ table, preview }) {
  const [hov, setHov] = useState(false);
  const phase    = table.phase || 'waiting';
  const seated   = table.seated || 0;
  const max      = table.config?.maxPlayers || 9;
  const buyIn    = table.config?.buyIn || 0;
  const bigBlind = table.config?.bigBlind || 0;
  const gameType = table.config?.gameType || 0;
  const isLive   = phase && phase !== 'waiting';

  const q = `?buyIn=${buyIn}&bigBlind=${bigBlind}&maxPlayers=${max}&gameType=${gameType}`;
  const accentColor = isLive ? '#10b981' : gameType === 1 ? '#a06cd4' : '#73737f';

  const cardDiv = (
    <div
      onMouseEnter={() => !preview && setHov(true)}
      onMouseLeave={() => !preview && setHov(false)}
      style={{
        background: hov
          ? 'linear-gradient(160deg,#1d1d20,#0f0f11)'
          : 'linear-gradient(160deg,#121214,#0b0b0c)',
        border: `1px solid ${hov ? 'var(--border-mid)' : 'var(--border)'}`,
        borderRadius: 14,
        overflow: 'hidden',
        cursor: preview ? 'default' : 'pointer',
        transition: 'transform .2s ease, box-shadow .2s ease, border-color .2s ease, background .2s ease',
        transform: hov ? 'translateY(-3px)' : 'none',
        boxShadow: hov
          ? '0 14px 34px rgba(0,0,0,.6), 0 0 0 1px rgba(217,192,138,.12)'
          : '0 2px 10px rgba(0,0,0,.4)',
        display: 'flex',
        opacity: preview ? 0.55 : 1,
        position: 'relative',
      }}
    >
      {/* Left accent stripe */}
      <div style={{
        width: 4, flexShrink: 0,
        background: `linear-gradient(180deg, ${accentColor}, ${accentColor}66)`,
        boxShadow: hov ? `0 0 14px ${accentColor}88` : 'none',
        transition:'box-shadow .2s',
      }} />

      <div style={{ flex:1, padding:'16px 20px', display:'flex', alignItems:'center', gap:16 }}>
        {/* Game icon */}
        <div style={{
          width: 48, height: 48, borderRadius: 12, flexShrink: 0,
          background: gameType === 1
            ? 'linear-gradient(145deg,rgba(160,108,212,.18),rgba(160,108,212,.05))'
            : 'linear-gradient(145deg,rgba(217,192,138,.14),rgba(217,192,138,.04))',
          border: `1px solid ${gameType === 1 ? 'rgba(160,108,212,.3)' : 'rgba(217,192,138,.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 23, color: gameType === 1 ? '#c79bef' : '#d9c08a',
        }}>
          {gameType === 1 ? '♦' : '♠'}
        </div>

        {/* Name + meta */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
            <span style={{
              fontSize: 14.5, fontWeight: 700,
              color: hov ? 'var(--gold-pale)' : '#e2dabf',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              transition: 'color .15s',
            }}>
              {table.name || `Table #${String(table.id).slice(0,8)}`}
            </span>
            <StatusBadge phase={phase} />
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:11, color:'#7d786c' }}>
            <span className="hide-mobile">{GAME_LABEL[gameType]}</span>
            <span className="hide-mobile" style={{ color:'#39393f' }}>·</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace" }}>
              {fmt(bigBlind/2)}/{fmt(bigBlind)}
            </span>
          </div>
        </div>

        {/* Buy-in + seats */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
          <span className="gold-text" style={{
            fontSize: 16, fontWeight:800,
            fontFamily:"'JetBrains Mono',monospace",
          }}>
            ◈{fmt(buyIn)}
          </span>
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ display:'flex', gap:3 }}>
              {Array.from({ length: max }).map((_,i) => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: i < seated ? '#10b981' : 'rgba(255,255,255,.08)',
                  boxShadow: i < seated ? '0 0 5px rgba(16,185,129,.7)' : 'none',
                  transition: 'background .2s',
                }} />
              ))}
            </div>
            <span style={{ fontSize:10, color:'#5c5950', marginLeft:2, fontWeight:600 }}>
              {seated}/{max}
            </span>
          </div>
          {preview && (
            <span style={{ fontSize:9, color:'#726d61', letterSpacing:1 }}>SERVER OFFLINE — PREVIEW</span>
          )}
        </div>
      </div>
    </div>
  );

  if (preview) return <div style={{ display:'block' }}>{cardDiv}</div>;
  return (
    <Link href={`/table/${table.id}${q}`} style={{ textDecoration:'none', display:'block' }}>
      {cardDiv}
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
    if (!Number.isSafeInteger(effectiveBB) || effectiveBB <= 0 || !Number.isSafeInteger(buyIn) || buyIn < effectiveBB * 2) return;
    createTable({ buyIn, bigBlind: effectiveBB, maxPlayers, gameType });
  };

  const busy = status === 'pending';
  const segActive = '#18181c';

  return (
    <div style={{
      position:'fixed', inset:0,
      background:'rgba(0,0,0,.82)', backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:300, padding:16,
    }} onClick={onClose}>
      <div className="glass-strong" role="dialog" aria-modal="true" aria-labelledby="create-table-title" style={{
        padding:'28px 24px',
        width:'100%', maxWidth:430,
        boxShadow:'0 28px 70px rgba(0,0,0,.75)',
        animation:'pop-in .26s ease forwards',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize:9, color:'#7d786c', letterSpacing:3, marginBottom:5, fontWeight:800 }}>CREATE TABLE</div>
        <div id="create-table-title" className="gold-text serif" style={{ fontSize:24, fontWeight:800, marginBottom:22 }}>
          New Cash Game
        </div>

        {/* Game type */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>GAME TYPE</div>
          <div style={{ display:'flex', gap:8 }}>
            {GAME_OPTIONS.map(o => (
              <button key={o.v} onClick={() => setGameType(o.v)} style={{
                flex:1, padding:'11px 0', borderRadius:10, cursor:'pointer',
                fontFamily:'inherit', fontSize:12, fontWeight:700,
                background: gameType===o.v ? 'linear-gradient(135deg,#26262c,#242428)' : 'transparent',
                border:`1px solid ${gameType===o.v ? 'var(--gold)' : 'var(--border)'}`,
                color: gameType===o.v ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Big Blind */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>BIG BLIND</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {BLINDS_PRESETS.map(b => (
              <button key={b} onClick={() => { setBigBlind(b); setCustomBB(''); }} style={{
                padding:'8px 15px', borderRadius:8, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
                background: bigBlind===b && !customBB ? segActive : 'transparent',
                border:`1px solid ${bigBlind===b && !customBB ? 'var(--gold)' : 'var(--border)'}`,
                color: bigBlind===b && !customBB ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{b}</button>
            ))}
            <input
              type="number" min="1" step="1" aria-label="Custom big blind" placeholder="Custom"
              value={customBB}
              onChange={e => setCustomBB(e.target.value)}
              style={{
                width:84, padding:'8px 11px', borderRadius:8,
                background:'transparent', border:`1px solid ${customBB ? 'var(--gold)' : 'var(--border)'}`,
                color: customBB ? 'var(--gold-pale)' : '#7d786c',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12,
                outline:'none',
              }}
            />
          </div>
        </div>

        {/* Buy-in */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>
            BUY-IN (CHIPS)
          </div>
          <input
            type="number" min="1" step="1" aria-label="Buy-in amount in CHIPS" value={buyIn}
            onChange={e => setBuyIn(Number(e.target.value))}
            className="input"
            style={{ width:'100%', padding:'11px 14px', boxSizing:'border-box', fontFamily:"'JetBrains Mono',monospace", fontSize:14 }}
          />
          <div style={{ fontSize:9, color:'#645f54', marginTop:6, fontFamily:"'JetBrains Mono',monospace" }}>
            = {effectiveBB ? Math.round(buyIn / effectiveBB) : 0}× big blind
          </div>
        </div>

        {/* Max players */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>MAX SEATS</div>
          <div style={{ display:'flex', gap:6 }}>
            {[2,4,6,9].map(n => (
              <button key={n} onClick={() => setMaxPlayers(n)} style={{
                flex:1, padding:'9px 0', borderRadius:8, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700,
                background: maxPlayers===n ? segActive : 'transparent',
                border:`1px solid ${maxPlayers===n ? 'var(--gold)' : 'var(--border)'}`,
                color: maxPlayers===n ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{n}</button>
            ))}
          </div>
        </div>

        {errorMsg && (
          <div style={{ fontSize:11, color:'#f0675a', marginBottom:14,
            background:'rgba(224,71,59,.1)', border:'1px solid rgba(224,71,59,.32)',
            borderRadius:10, padding:'10px 14px', lineHeight:1.5 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} className="btn btn-ghost" style={{ flex:1, padding:'13px', fontSize:12.5 }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={busy || !Number.isSafeInteger(effectiveBB) || effectiveBB <= 0 || !Number.isSafeInteger(buyIn) || buyIn < effectiveBB * 2} className="btn btn-gold"
            style={{ flex:2, padding:'13px', fontSize:13.5, opacity: busy ? .6 : 1,
              cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Confirming…' : '＋ Create Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

const SEED_TABLES = [
  { id:9001, name:'Micro Stakes — NLH', config:{ gameType:0, maxPlayers:9, buyIn:1000,  bigBlind:20  }, phase:'waiting', seated:0 },
  { id:9002, name:'High Stakes — NLH',  config:{ gameType:0, maxPlayers:9, buyIn:10000, bigBlind:200 }, phase:'waiting', seated:0 },
];

export default function LobbyPage() {
  const { address } = useAccount();
  const [tableList,   setTableList]   = useState([]);
  const [serverOnline, setServerOnline] = useState(false);
  const [filter,      setFilter]      = useState('all');
  const [mounted,     setMounted]     = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const serverBase = wsHttpUrl();
  useEffect(() => {
    const poll = () =>
      fetch(`${serverBase}/tables`, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`Lobby request failed: ${r.status}`);
          return r.json();
        })
        .then(d => {
          if (!d || !Array.isArray(d.tables)) throw new Error('Invalid lobby response');
          setTableList(d.tables);
          setServerOnline(true);
        })
        .catch(() => {
          setServerOnline(false);
          setTableList([]);
        });
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
  const openSeats = serverOnline ? tableList.reduce((sum, table) => sum + Math.max(0, (table.config?.maxPlayers || 9) - (table.seated || 0)), 0) : 0;

  return (
    <div className="has-bottom-nav" style={{ minHeight:'100vh', background:'var(--bg-abyss)' }}>
      <WalletBar />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="page-hero felt-texture" style={{ padding:'58px 24px 46px', textAlign:'center' }}>
        {/* Animated aurora backdrop */}
        <div className="aurora" aria-hidden />

        {/* Watermark spade */}
        <div aria-hidden style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          fontSize:340, color:'rgba(255,255,255,.008)',
          pointerEvents:'none', userSelect:'none', lineHeight:1, zIndex:0,
        }}>♠</div>

        <div style={{ position:'relative', zIndex:1 }}>
          {/* Live pill */}
          <div className="pill animate-up s1" style={{ marginBottom:20, opacity:0 }}>
            <span className={serverOnline ? 'dot-live' : 'dot-offline'} />
            {serverOnline ? 'LOBBY ONLINE · ONCHAIN POKER' : 'LOBBY OFFLINE · PREVIEW MODE'}
          </div>

          <img src="/logo.png" alt="Poker Vs Player" className="animate-up s2" style={{
            width:'min(460px,84vw)', height:'auto',
            margin:'0 auto 16px', display:'block', opacity:0,
            filter:'drop-shadow(0 0 70px rgba(217,192,138,.3))',
          }} />

          <p className="animate-up s3" style={{
            fontSize:15, color:'#8d877a', letterSpacing:.2,
            maxWidth:420, margin:'0 auto 36px', lineHeight:1.7, opacity:0,
          }}>
            Player-versus-player poker with onchain settlement.<br/>
            <span style={{ color:'#a59f90' }}>{serverOnline ? 'Explore available tables and connect your wallet to play.' : 'Live tables are temporarily unavailable. Preview tables are not joinable.'}</span>
          </p>

          {/* Stats */}
          <div className="animate-up s4" style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:30, opacity:0 }}>
            {[
              { label:'Players Online', value: String(totalSeated) },
              { label:'Live Tables',    value: String(liveCount)   },
              { label:'Open Seats',     value: String(openSeats) },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="gold-text" style={{
                  fontSize:30, fontWeight:900,
                  fontFamily:"'JetBrains Mono',monospace", lineHeight:1.1,
                }}>
                  {serverOnline ? s.value : '—'}
                </div>
                <div style={{ fontSize:9, color:'#5c5950', letterSpacing:2, marginTop:6, fontWeight:800 }}>
                  {s.label.toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          {/* Primary CTAs */}
          <div className="animate-up s5" style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', opacity:0 }}>
            {mounted && address && serverOnline ? (
              <button onClick={() => setShowCreate(true)} className="btn btn-gold" style={{ padding:'13px 28px', fontSize:14 }}>
                ＋ Create a Table
              </button>
            ) : (
              <a href="#tables" className="btn btn-gold" style={{ padding:'13px 28px', fontSize:14, textDecoration:'none' }}>
                Browse Tables ↓
              </a>
            )}
            <Link href="/buy" className="btn btn-emerald" style={{ padding:'13px 28px', fontSize:14, textDecoration:'none' }}>
              Get CHIPS
            </Link>
          </div>

          {(!mounted || !address) && (
            <p className="animate-up s6" style={{ fontSize:12, color:'#5c5950', letterSpacing:.5, marginTop:22, opacity:0 }}>
              Connect your wallet above to join a table
            </p>
          )}
        </div>
      </div>

      {showCreate && <CreateTableModal onClose={() => setShowCreate(false)} />}

      {/* ── Main content ─────────────────────────────────────────── */}
      <div id="tables" style={{ maxWidth:820, margin:'0 auto', padding:'30px 16px' }}>

        {/* Section header + controls */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          marginBottom:18, gap:10, flexWrap:'wrap',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:10, color:'#5c5950', letterSpacing:3, fontWeight:800 }}>
              TABLES
            </span>
            {/* Filter tabs */}
            <div style={{
              display:'flex', gap:2,
              background:'rgba(11,11,13,.8)', border:'1px solid var(--border)',
              borderRadius:10, padding:3,
            }}>
              {filters.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} style={{
                  background: filter===f.id ? 'linear-gradient(135deg,#1d1d21,#151518)' : 'transparent',
                  border: filter===f.id ? '1px solid rgba(217,192,138,.2)' : '1px solid transparent',
                  borderRadius:8, padding:'6px 13px', cursor:'pointer',
                  color: filter===f.id ? 'var(--gold-pale)' : '#7d786c',
                  fontSize:11.5, fontWeight:700, fontFamily:'inherit',
                  transition:'all .15s',
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {/* Server status */}
            <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:10, color:'#5c5950' }}>
              <div style={{
                width:6, height:6, borderRadius:'50%',
                background: serverOnline ? '#10b981' : '#42424a',
                boxShadow: serverOnline ? '0 0 7px #10b981' : 'none',
                animation: serverOnline ? 'live-dot 2s infinite' : 'none',
              }} />
              <span style={{ fontWeight:700 }}>
                {serverOnline ? 'Live' : mounted && address ? 'Connecting…' : 'Offline'}
              </span>
            </div>

            {mounted && address ? (
              <button onClick={() => setShowCreate(true)} className="btn btn-gold" style={{ padding:'8px 16px', fontSize:12 }}>
                ＋ New Table
              </button>
            ) : (
              <div style={{
                borderRadius:8, padding:'8px 16px',
                background:'rgba(43,43,49,.15)',
                border:'1px solid rgba(217,192,138,.12)',
                color:'rgba(217,192,138,.3)', fontSize:12, fontWeight:700,
                letterSpacing:.3, flexShrink:0, cursor:'default',
                opacity: mounted ? 0 : 1, transition:'opacity .2s',
              }}>
                ＋ New Table
              </div>
            )}
          </div>
        </div>

        {/* Table list */}
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {filtered.map(t => <TableCard key={t.id} table={t} preview={!serverOnline} />)}

          {filtered.length === 0 && (
            <div className="glass" style={{
              textAlign:'center', padding:'64px 24px',
            }}>
              <div style={{ fontSize:52, marginBottom:14, opacity:.22 }}>♠</div>
              <div style={{ color:'#5c5950', fontSize:13, fontWeight:600 }}>
                {!serverOnline ? 'No filter matches — try All' : 'No tables match this filter.'}
              </div>
            </div>
          )}
        </div>

        {/* Private rooms CTA */}
        <div className="glass-strong felt-texture" style={{
          marginTop:38, padding:'24px 28px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          flexWrap:'wrap', gap:16,
          position:'relative', overflow:'hidden',
        }}>
          {/* Subtle glow accent */}
          <div aria-hidden style={{
            position:'absolute', right:-40, top:-40,
            width:200, height:200,
            background:'radial-gradient(circle, rgba(217,192,138,.07) 0%, transparent 70%)',
            pointerEvents:'none',
          }} />
          <div style={{ position:'relative' }}>
            <div style={{ fontSize:10, color:'#87816f', letterSpacing:2.5, fontWeight:800, marginBottom:5 }}>
              ♛ PRIVATE ROOMS
            </div>
            <div className="serif" style={{ fontSize:17, color:'var(--gold-pale)', fontWeight:700, marginBottom:6 }}>
              Host your own poker room
            </div>
            <div style={{ fontSize:11.5, color:'#726d61', maxWidth:380, lineHeight:1.6 }}>
              33,500 CHIPS/week · 100,000 CHIPS/month · NFT-gate for your community
            </div>
          </div>
          <Link href="/rooms" className="btn btn-gold" style={{
            padding:'12px 24px', textDecoration:'none', fontSize:12.5,
            whiteSpace:'nowrap', position:'relative',
          }}>
            Lease a Room →
          </Link>
        </div>

      </div>
    </div>
  );
}
