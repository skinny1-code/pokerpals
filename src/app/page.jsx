'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WalletBar from '../components/WalletBar';
import { useTableSocket, useCreateTable } from '../hooks/usePokerWallet';
import { useAccount } from 'wagmi';

const GAME_TYPE_LABEL = { 0: "No Limit Hold'em", 1: 'Pot Limit Omaha' };
const PHASE_STATUS = { waiting:'Waiting', preflop:'Active', flop:'Active', turn:'Active', river:'Active', showdown:'Showdown' };
const PHASE_COLOR  = { waiting:'#d4af37', preflop:'#27ae60', flop:'#27ae60', turn:'#27ae60', river:'#27ae60', showdown:'#e67e22' };

const STATS = [
  { label: 'Players Online', value: '—', icon: '◉', key: 'players' },
  { label: 'Active Tables',  value: '—', icon: '♠', key: 'tables'  },
  { label: 'Total Pot',      value: '—', icon: '◈', unit: 'CHIPS', key: 'pot' },
];

function StatBubble({ stat }) {
  return (
    <div style={{
      background:'#0c1e0c', border:'1px solid #1a3a1a', borderRadius:10,
      padding:'12px 20px', display:'flex', flexDirection:'column',
      alignItems:'center', gap:4, minWidth:110,
    }}>
      <div style={{ fontSize:18, color:'#d4af37' }}>{stat.icon}</div>
      <div style={{ fontSize:18, color:'#d4af37', fontWeight:700,
        fontFamily:"'JetBrains Mono',monospace" }}>{stat.value}</div>
      <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1, textAlign:'center' }}>
        {stat.label}{stat.unit ? ` (${stat.unit})` : ''}
      </div>
    </div>
  );
}

function TableRow({ table }) {
  const [hov, setHov] = useState(false);
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(0)}K` : String(v || 0);

  const phase = table.phase || 'waiting';
  const statusColor = PHASE_COLOR[phase] || '#d4af37';
  const statusLabel = PHASE_STATUS[phase] || 'Waiting';
  const gameType = table.config?.gameType || 0;
  const bigBlind = table.config?.bigBlind || 0;
  const buyIn    = table.config?.buyIn || 0;
  const maxPlayers = table.config?.maxPlayers || 9;
  const seated   = table.seated || 0;

  return (
    <Link href={`/table/${table.id}`} style={{ textDecoration:'none' }}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display:'grid',
          gridTemplateColumns:'2fr 1.2fr 1fr 1fr 80px 80px',
          alignItems:'center', padding:'12px 16px', borderRadius:8, gap:8,
          background: hov ? 'rgba(212,175,55,.04)' : 'transparent',
          border:`1px solid ${hov ? '#d4af3733' : '#1a3a1a22'}`,
          cursor:'pointer', transition:'all .15s',
        }}
      >
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          <span style={{ fontSize:13, color: hov ? '#d4af37' : '#d0c8b0', fontWeight:600 }}>
            {table.name || `Table ${table.id?.slice(0,8)}…`}
          </span>
          <span style={{ fontSize:9, color:'#3a6a3a',
            fontFamily:"'JetBrains Mono',monospace" }}>
            #{String(table.id).slice(0,12)}
          </span>
        </div>
        <div style={{ fontSize:10, color:'#6a9a6a' }}>{GAME_TYPE_LABEL[gameType]}</div>
        <div style={{ fontSize:11, color:'#a8c8a8', fontFamily:"'JetBrains Mono',monospace" }}>
          {fmt(bigBlind/2)}/{fmt(bigBlind)}
        </div>
        <div style={{ fontSize:11, color:'#d4af37', fontFamily:"'JetBrains Mono',monospace" }}>
          ◈ {fmt(buyIn)}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          {Array.from({ length: maxPlayers }).map((_,i) => (
            <div key={i} style={{ width:7, height:7, borderRadius:'50%',
              background: i < seated ? '#27ae60' : '#1a3a1a',
              border:'1px solid rgba(255,255,255,.1)' }} />
          ))}
          <span style={{ fontSize:9, color:'#6a9a6a', marginLeft:2 }}>{seated}/{maxPlayers}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <div style={{
            fontSize:8, color:statusColor,
            border:`1px solid ${statusColor}44`, borderRadius:10,
            padding:'2px 8px', letterSpacing:1, background:`${statusColor}11`,
          }}>{statusLabel.toUpperCase()}</div>
        </div>
      </div>
    </Link>
  );
}

// ── Create Table Modal ────────────────────────────────────────────────────────
function CreateTableModal({ onClose }) {
  const router = useRouter();
  const { createTable, status, newTableId } = useCreateTable();
  const [form, setForm] = useState({ buyIn: 1000, bigBlind: 20, maxPlayers: 6, gameType: 0 });
  const loading = status === 'pending';

  useEffect(() => {
    if (newTableId) { onClose(); router.push(`/table/${newTableId}`); }
  }, [newTableId, onClose, router]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.8)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:300 }}
      onClick={onClose}>
      <div style={{
        background:'linear-gradient(135deg,#0a1f0a,#060e06)',
        border:'1px solid #d4af37', borderRadius:16, padding:'32px',
        width:380, animation:'fade-in .3s ease forwards',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:9, color:'#d4af3799', letterSpacing:3, marginBottom:8 }}>NEW TABLE</div>
        <div style={{ fontSize:20, color:'#d4af37', fontWeight:700, marginBottom:20,
          fontFamily:"'Playfair Display',serif" }}>Create Table</div>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {[
            { label:'GAME TYPE', key:'gameType', type:'select',
              options:[[0,"No Limit Hold'em"],[1,'Pot Limit Omaha']] },
            { label:'BUY-IN (CHIPS)', key:'buyIn', type:'number', min:100 },
            { label:'BIG BLIND (CHIPS)', key:'bigBlind', type:'number', min:1 },
            { label:'MAX PLAYERS', key:'maxPlayers', type:'select',
              options:[[2,'2'],[4,'4'],[6,'6 (6-max)'],[9,'9 (Full Ring)']] },
          ].map(({ label, key, type, options, min }) => (
            <div key={key}>
              <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1, marginBottom:5 }}>{label}</div>
              {type === 'select' ? (
                <select value={form[key]} onChange={e => set(key, Number(e.target.value))} style={{
                  width:'100%', background:'#0c1e0c', border:'1px solid #1a3a1a', borderRadius:6,
                  padding:'8px 12px', color:'#d4af37', fontSize:12, fontFamily:'inherit', outline:'none',
                }}>
                  {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <input type="number" value={form[key]} min={min}
                  onChange={e => set(key, Number(e.target.value))}
                  style={{ width:'100%', background:'#0c1e0c', border:'1px solid #1a3a1a',
                    borderRadius:6, padding:'8px 12px', color:'#d4af37', fontSize:12,
                    fontFamily:"'JetBrains Mono',monospace", outline:'none', boxSizing:'border-box' }} />
              )}
            </div>
          ))}
        </div>
        {form.buyIn < form.bigBlind * 10 && (
          <div style={{ marginTop:10, fontSize:10, color:'#e67e22' }}>
            Buy-in must be ≥ 10× big blind (◈ {form.bigBlind * 10})
          </div>
        )}
        <div style={{ display:'flex', gap:8, marginTop:20 }}>
          <button onClick={onClose} disabled={loading} style={{
            flex:1, background:'transparent', border:'1px solid #1a3a1a', borderRadius:8,
            padding:'10px', cursor:'pointer', color:'#6a9a6a', fontSize:12, fontFamily:'inherit',
          }}>Cancel</button>
          <button onClick={() => createTable(form)}
            disabled={loading || form.buyIn < form.bigBlind * 10}
            style={{
              flex:2, background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
              border:'1px solid #d4af3744', borderRadius:8, padding:'10px',
              cursor: (loading || form.buyIn < form.bigBlind * 10) ? 'not-allowed' : 'pointer',
              color: loading ? '#6a9a6a' : '#d4af37',
              fontSize:12, fontWeight:700, fontFamily:'inherit', opacity: loading ? 0.7 : 1,
            }}>
            {loading ? 'Waiting for wallet…' : 'Create Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  const { address } = useAccount();
  const { tableList, wsStatus, refreshTables } = useTableSocket(null);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('status');
  const [showCreate, setShowCreate] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Refresh table list periodically when connected
  useEffect(() => {
    if (wsStatus !== 'authed') return;
    const t = setInterval(refreshTables, 8000);
    return () => clearInterval(t);
  }, [wsStatus, refreshTables]);

  const filters = [
    { id:'all',  label:'All Tables' },
    { id:'nlh',  label:"Hold'em" },
    { id:'plo',  label:'Omaha' },
    { id:'high', label:'High Stakes' },
  ];

  const filtered = tableList.filter(t => {
    if (filter === 'nlh')  return (t.config?.gameType || 0) === 0;
    if (filter === 'plo')  return (t.config?.gameType || 0) === 1;
    if (filter === 'high') return (t.config?.buyIn || 0) >= 10000;
    return true;
  }).sort((a, b) => {
    const aActive = a.phase && a.phase !== 'waiting' ? 1 : 0;
    const bActive = b.phase && b.phase !== 'waiting' ? 1 : 0;
    if (sortBy === 'status')  return bActive - aActive || (b.seated||0) - (a.seated||0);
    if (sortBy === 'buyin')   return (b.config?.buyIn||0) - (a.config?.buyIn||0);
    if (sortBy === 'players') return (b.seated||0) - (a.seated||0);
    return 0;
  });

  const liveStats = {
    players: tableList.reduce((s, t) => s + (t.seated||0), 0),
    tables:  tableList.filter(t => t.phase && t.phase !== 'waiting').length,
  };

  const stats = STATS.map(s => ({
    ...s,
    value: s.key === 'players' ? String(liveStats.players)
         : s.key === 'tables'  ? String(liveStats.tables)
         : '—',
  }));

  const wsConnected = wsStatus === 'authed';

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      {/* Hero */}
      <div style={{
        background:'linear-gradient(180deg,#0a1f0a 0%,#060e06 100%)',
        borderBottom:'1px solid #1a3a1a', padding:'32px 24px', textAlign:'center',
      }}>
        <div style={{ fontSize:11, color:'#3a6a3a', letterSpacing:4, marginBottom:8 }}>
          ONCHAIN  •  PVP  •  POKER
        </div>
        <h1 style={{ fontSize:36, fontWeight:900, color:'#d4af37',
          fontFamily:"'Playfair Display',serif", letterSpacing:2, marginBottom:4 }}>
          PokerVsPals
        </h1>
        <p style={{ fontSize:12, color:'#5a8a5a', letterSpacing:1 }}>
          Real PvP poker. Instant onchain settlement. No house edge. No bots.
        </p>
        <div style={{ display:'flex', gap:12, justifyContent:'center', marginTop:24, flexWrap:'wrap' }}>
          {stats.map(s => <StatBubble key={s.label} stat={s} />)}
        </div>
      </div>

      {/* Main */}
      <div style={{ maxWidth:960, margin:'0 auto', padding:'24px 16px' }}>

        {/* Filter + sort */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          marginBottom:16, flexWrap:'wrap', gap:8 }}>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {filters.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                background: filter===f.id ? '#0c1e0c' : 'transparent',
                border:`1px solid ${filter===f.id ? '#d4af3744' : '#1a3a1a'}`,
                borderRadius:6, padding:'5px 12px', cursor:'pointer',
                color: filter===f.id ? '#d4af37' : '#6a9a6a',
                fontSize:11, fontWeight:700, letterSpacing:.5,
                fontFamily:'inherit', transition:'all .15s',
              }}>{f.label}</button>
            ))}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {mounted && address && (
              <button onClick={() => setShowCreate(true)} style={{
                background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
                border:'1px solid #d4af3744', borderRadius:6, padding:'5px 14px',
                cursor:'pointer', color:'#d4af37', fontSize:11, fontWeight:700,
                fontFamily:'inherit', letterSpacing:.5,
              }}>+ Create Table</button>
            )}
            <span style={{ fontSize:10, color:'#3a6a3a', letterSpacing:1 }}>SORT</span>
            {[['status','Live First'],['buyin','Buy-in'],['players','Players']].map(([v,l]) => (
              <button key={v} onClick={() => setSortBy(v)} style={{
                background:'transparent',
                border:`1px solid ${sortBy===v ? '#d4af3744' : '#1a3a1a'}`,
                borderRadius:4, padding:'3px 8px', cursor:'pointer',
                color: sortBy===v ? '#d4af37' : '#4a7a4a',
                fontSize:9, letterSpacing:.5, fontFamily:'inherit',
              }}>{l}</button>
            ))}
          </div>
        </div>

        {/* Table header */}
        <div style={{
          display:'grid', gridTemplateColumns:'2fr 1.2fr 1fr 1fr 80px 80px',
          padding:'6px 16px', gap:8, borderBottom:'1px solid #1a3a1a', marginBottom:4,
        }}>
          {['Table','Game','Blinds','Buy-in','Seats','Status'].map(h => (
            <div key={h} style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1 }}>{h.toUpperCase()}</div>
          ))}
        </div>

        {/* Table rows */}
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          {filtered.map(t => <TableRow key={t.id} table={t} />)}

          {filtered.length === 0 && (
            <div style={{ textAlign:'center', padding:'48px 0' }}>
              {!mounted || !address ? (
                <div style={{ color:'#3a6a3a', fontSize:12 }}>
                  Connect your wallet to see live tables
                </div>
              ) : !wsConnected ? (
                <div style={{ color:'#3a6a3a', fontSize:12 }}>
                  <div style={{ fontSize:24, marginBottom:8 }}>♠</div>
                  Connecting to game server…
                </div>
              ) : (
                <div style={{ color:'#3a6a3a', fontSize:12 }}>No tables yet — be the first!</div>
              )}
            </div>
          )}
        </div>

        {/* Lease a room CTA */}
        <div style={{
          marginTop:32, padding:'24px',
          background:'#0c1e0c', border:'1px solid #1a3a1a', borderRadius:12,
          display:'flex', alignItems:'center', justifyContent:'space-between',
          flexWrap:'wrap', gap:16,
        }}>
          <div>
            <div style={{ fontSize:14, color:'#d4af37', fontWeight:700, marginBottom:4 }}>
              Host a Private Room
            </div>
            <div style={{ fontSize:11, color:'#5a8a5a', maxWidth:400 }}>
              Lease a private room for 100 CHIPS/week. Set custom buy-ins, NFT-gate for your community, and earn a share of the rake.
            </div>
          </div>
          <Link href="/stake" style={{
            background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
            border:'1px solid #d4af3744', borderRadius:8,
            padding:'10px 24px', textDecoration:'none',
            color:'#d4af37', fontSize:12, fontWeight:700, letterSpacing:.5,
          }}>
            Lease a Room →
          </Link>
        </div>
      </div>

      {showCreate && <CreateTableModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
