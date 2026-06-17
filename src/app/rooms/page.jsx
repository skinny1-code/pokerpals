'use client';
import { useState, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useAccount } from 'wagmi';
import { useTableRegistry } from '../../hooks/usePokerWallet';

const ZERO_ADDR    = '0x0000000000000000000000000000000000000000';
const GAME_LABEL    = { 0:"Hold'em", 1:'Omaha', 2:'Short Deck', 3:'Pineapple' };
const GAME_OPTIONS  = [
  { v:0, label:"Hold'em" }, { v:1, label:'Omaha' },
  { v:2, label:'Short Deck' }, { v:3, label:'Pineapple' },
];
const WEEK_PRESETS  = [1, 2, 4, 8, 12];
const MONTH_PRESETS = [1, 3, 6, 12];

function fmt(v) {
  return v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
       : v >= 1_000     ? `${(v/1_000).toFixed(1)}K`
       : v.toLocaleString(undefined, { maximumFractionDigits:2 });
}

function shortAddr(a) {
  return a ? `${a.slice(0,6)}…${a.slice(-4)}` : '';
}

function expiresIn(ts) {
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return 'Expired';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function RoomCard({ room, address }) {
  const [hov, setHov] = useState(false);
  const isMine   = address && room.lessee?.toLowerCase() === address.toLowerCase();
  const isGated  = room.nftGate && room.nftGate !== ZERO_ADDR;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? '#0d1f0d' : '#0c1a0c',
        border:`1px solid ${hov ? '#2a4a2a' : '#1a3a1a'}`,
        borderRadius:12, padding:'20px 20px',
        display:'flex', flexDirection:'column', gap:12,
        transition:'all .15s',
      }}
    >
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#e8e0cc', marginBottom:4 }}>
            {room.name || `Room #${room.id}`}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontSize:10, color:'#5a8a5a' }}>{GAME_LABEL[room.gameType] || 'NLH'}</span>
            {isGated && (
              <span style={{ fontSize:8, color:'#9b59b6', border:'1px solid #9b59b644',
                borderRadius:4, padding:'2px 6px', letterSpacing:.5 }}>
                NFT-GATED
              </span>
            )}
            {isMine && (
              <span style={{ fontSize:8, color:'#d4af37', border:'1px solid #d4af3744',
                borderRadius:4, padding:'2px 6px', letterSpacing:.5 }}>
                LEASED BY YOU
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontSize:13, color:'#8aaa8a', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            {expiresIn(room.leaseExpiry)}
          </div>
          <div style={{ fontSize:9, color:'#3a6a3a', marginTop:2 }}>LEASE LEFT</div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
        <div style={{ background:'#060e06', border:'1px solid #1a3a1a', borderRadius:8, padding:'8px 10px' }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1, marginBottom:3 }}>SEATS</div>
          <div style={{ fontSize:13, color:'#8aaa8a', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            {room.maxPlayers}
          </div>
        </div>
        <div style={{ background:'#060e06', border:'1px solid #1a3a1a', borderRadius:8, padding:'8px 10px' }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1, marginBottom:3 }}>MIN BUY-IN</div>
          <div style={{ fontSize:13, color:'#d4af37', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            {room.minBuyIn > 0 ? `◈ ${fmt(room.minBuyIn)}` : '—'}
          </div>
        </div>
        <div style={{ background:'#060e06', border:'1px solid #1a3a1a', borderRadius:8, padding:'8px 10px' }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1, marginBottom:3 }}>MAX BUY-IN</div>
          <div style={{ fontSize:13, color:'#d4af37', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            {room.maxBuyIn > 0 ? `◈ ${fmt(room.maxBuyIn)}` : '—'}
          </div>
        </div>
      </div>

      <div style={{ fontSize:10, color:'#3a6a3a' }}>
        Leased by {isMine ? 'you' : shortAddr(room.lessee)}
      </div>
    </div>
  );
}

function LeaseRoomModal({ onClose, weeklyFee, monthlyFee, leaseRoom, status, errorMsg }) {
  const [name,       setName]       = useState('');
  const [periodMode, setPeriodMode] = useState('weeks'); // 'weeks' | 'months'
  const [count,      setCount]      = useState(1);
  const [customCount, setCustomCount] = useState('');
  const [gameType,   setGameType]   = useState(0);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [isPublic,   setIsPublic]   = useState(true);
  const [minBuyIn,   setMinBuyIn]   = useState('');
  const [maxBuyIn,   setMaxBuyIn]   = useState('');
  const [nftGate,    setNftGate]    = useState('');

  const effectiveCount = customCount ? Number(customCount) : count;
  const presets = periodMode === 'weeks' ? WEEK_PRESETS : MONTH_PRESETS;
  const rate     = periodMode === 'weeks' ? weeklyFee : monthlyFee;
  const totalFee = (effectiveCount || 0) * rate;

  const busy = status === 'approving' || status === 'leasing';

  const handleSubmit = () => {
    if (!name.trim() || !effectiveCount || effectiveCount <= 0) return;
    leaseRoom({
      name: name.trim(),
      weeks:  periodMode === 'weeks'  ? effectiveCount : undefined,
      months: periodMode === 'months' ? effectiveCount : undefined,
      nftGate: nftGate.trim() || null,
      minBuyIn: minBuyIn || 0,
      maxBuyIn: maxBuyIn || 0,
      maxPlayers,
      gameType,
      isPublic,
    });
  };

  return (
    <div style={{
      position:'fixed', inset:0,
      background:'rgba(0,0,0,.8)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:300, padding:16, overflowY:'auto',
    }} onClick={onClose}>
      <div style={{
        background:'linear-gradient(160deg,#0d200d,#060e06)',
        border:'1px solid #2a5a2a',
        borderRadius:16, padding:'28px 24px',
        width:'100%', maxWidth:440,
        boxShadow:'0 24px 60px rgba(0,0,0,.7)',
        animation:'fade-in .2s ease forwards',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize:9, color:'#4a7a4a', letterSpacing:3, marginBottom:4 }}>LEASE A ROOM</div>
        <div style={{ fontSize:22, color:'#d4af37', fontWeight:700,
          fontFamily:"'Playfair Display',serif", marginBottom:20 }}>
          New Private Room
        </div>

        {/* Name */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>ROOM NAME</div>
          <input
            type="text" value={name} maxLength={40}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Friday Night Game"
            style={{
              width:'100%', padding:'10px 14px', borderRadius:8, boxSizing:'border-box',
              background:'#0a180a', border:'1px solid #1e3a1e',
              color:'#d4af37', fontFamily:'inherit', fontSize:14,
              outline:'none',
            }}
          />
        </div>

        {/* Duration mode */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>DURATION</div>
          <div style={{ display:'flex', gap:8, marginBottom:10 }}>
            {[{v:'weeks',label:'Weekly'},{v:'months',label:'Monthly'}].map(o => (
              <button key={o.v} onClick={() => { setPeriodMode(o.v); setCount(1); setCustomCount(''); }} style={{
                flex:1, padding:'10px 0', borderRadius:8, cursor:'pointer',
                fontFamily:'inherit', fontSize:12, fontWeight:700,
                background: periodMode===o.v ? 'linear-gradient(135deg,#1a4a1a,#0c2e0c)' : 'transparent',
                border:`1px solid ${periodMode===o.v ? '#d4af37' : '#1e3a1e'}`,
                color: periodMode===o.v ? '#d4af37' : '#4a7a4a',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {presets.map(n => (
              <button key={n} onClick={() => { setCount(n); setCustomCount(''); }} style={{
                padding:'7px 14px', borderRadius:6, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
                background: count===n && !customCount ? '#0c2e0c' : 'transparent',
                border:`1px solid ${count===n && !customCount ? '#d4af37' : '#1e3a1e'}`,
                color: count===n && !customCount ? '#d4af37' : '#4a7a4a',
                transition:'all .15s',
              }}>{n}</button>
            ))}
            <input
              type="number" placeholder="Custom" min={1}
              value={customCount}
              onChange={e => setCustomCount(e.target.value)}
              style={{
                width:80, padding:'7px 10px', borderRadius:6,
                background:'transparent', border:`1px solid ${customCount ? '#d4af37' : '#1e3a1e'}`,
                color: customCount ? '#d4af37' : '#4a7a4a',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12,
                outline:'none',
              }}
            />
          </div>
          <div style={{ fontSize:11, color:'#5a8a5a', marginTop:8, fontFamily:"'JetBrains Mono',monospace" }}>
            Total: ◈ {fmt(totalFee)} CHIPS
          </div>
        </div>

        {/* Game type */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>GAME TYPE</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {GAME_OPTIONS.map(o => (
              <button key={o.v} onClick={() => setGameType(o.v)} style={{
                flex:'1 1 auto', padding:'9px 10px', borderRadius:8, cursor:'pointer',
                fontFamily:'inherit', fontSize:11, fontWeight:700,
                background: gameType===o.v ? 'linear-gradient(135deg,#1a4a1a,#0c2e0c)' : 'transparent',
                border:`1px solid ${gameType===o.v ? '#d4af37' : '#1e3a1e'}`,
                color: gameType===o.v ? '#d4af37' : '#4a7a4a',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Max seats */}
        <div style={{ marginBottom:18 }}>
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

        {/* Visibility */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>VISIBILITY</div>
          <div style={{ display:'flex', gap:8 }}>
            {[{v:true,label:'Public'},{v:false,label:'Private / Invite'}].map(o => (
              <button key={String(o.v)} onClick={() => setIsPublic(o.v)} style={{
                flex:1, padding:'9px 0', borderRadius:8, cursor:'pointer',
                fontFamily:'inherit', fontSize:12, fontWeight:700,
                background: isPublic===o.v ? 'linear-gradient(135deg,#1a4a1a,#0c2e0c)' : 'transparent',
                border:`1px solid ${isPublic===o.v ? '#d4af37' : '#1e3a1e'}`,
                color: isPublic===o.v ? '#d4af37' : '#4a7a4a',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Buy-in range */}
        <div style={{ marginBottom:18, display:'flex', gap:10 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>MIN BUY-IN</div>
            <input
              type="number" placeholder="0 = none" value={minBuyIn}
              onChange={e => setMinBuyIn(e.target.value)}
              style={{
                width:'100%', padding:'10px 14px', borderRadius:8, boxSizing:'border-box',
                background:'#0a180a', border:'1px solid #1e3a1e',
                color:'#d4af37', fontFamily:"'JetBrains Mono',monospace", fontSize:13,
                outline:'none',
              }}
            />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>MAX BUY-IN</div>
            <input
              type="number" placeholder="0 = none" value={maxBuyIn}
              onChange={e => setMaxBuyIn(e.target.value)}
              style={{
                width:'100%', padding:'10px 14px', borderRadius:8, boxSizing:'border-box',
                background:'#0a180a', border:'1px solid #1e3a1e',
                color:'#d4af37', fontFamily:"'JetBrains Mono',monospace", fontSize:13,
                outline:'none',
              }}
            />
          </div>
        </div>

        {/* NFT gate */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:2, marginBottom:8, fontWeight:700 }}>
            NFT GATE (OPTIONAL)
          </div>
          <input
            type="text" placeholder="0x… ERC-721 contract, leave blank for open"
            value={nftGate}
            onChange={e => setNftGate(e.target.value)}
            style={{
              width:'100%', padding:'10px 14px', borderRadius:8, boxSizing:'border-box',
              background:'#0a180a', border:'1px solid #1e3a1e',
              color:'#d4af37', fontFamily:"'JetBrains Mono',monospace", fontSize:12,
              outline:'none',
            }}
          />
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
          }}>
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
            {status === 'approving' ? 'Approving…' : status === 'leasing' ? 'Leasing…' : '＋ Lease Room'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoomsPage() {
  const { address } = useAccount();
  const {
    weeklyFee, monthlyFee, publicRooms,
    leaseRoom, status, confirmed, errorMsg,
  } = useTableRegistry();

  const [showLease, setShowLease] = useState(false);
  const [filter, setFilter] = useState('all');

  const filtered = publicRooms.filter(r => {
    if (filter === 'gated') return r.nftGate && r.nftGate !== ZERO_ADDR;
    if (filter === 'mine')  return address && r.lessee?.toLowerCase() === address.toLowerCase();
    return true;
  });

  useEffect(() => {
    if (confirmed) setShowLease(false);
  }, [confirmed]);

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      <div style={{ maxWidth:900, margin:'0 auto', padding:'32px 16px' }}>

        <div style={{ marginBottom:24, display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ fontSize:11, color:'#3a6a3a', letterSpacing:3, marginBottom:8 }}>
              PRIVATE TABLES
            </div>
            <h1 style={{ fontSize:28, color:'#d4af37', fontWeight:700,
              fontFamily:"'Playfair Display',serif", marginBottom:4 }}>
              Rooms
            </h1>
            <div style={{ fontSize:11, color:'#5a8a5a' }}>
              {publicRooms.length === 0 ? 'No public rooms leased yet' : `${publicRooms.length} active room${publicRooms.length !== 1 ? 's' : ''}`}
              {' · '}◈ {fmt(weeklyFee)}/week · ◈ {fmt(monthlyFee)}/month
            </div>
          </div>
          <button
            onClick={() => setShowLease(true)}
            disabled={!address}
            style={{
              background: !address ? '#0a160a' : 'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
              border:`1px solid ${!address ? '#1a3a1a' : '#d4af37'}`,
              borderRadius:8, padding:'10px 22px', cursor: !address ? 'not-allowed' : 'pointer',
              color: !address ? '#3a6a3a' : '#d4af37',
              fontSize:12, fontWeight:700, fontFamily:'inherit',
              transition:'all .15s',
            }}
          >
            ＋ Lease a Room
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:20 }}>
          {[
            { id:'all',   label:'All' },
            { id:'gated', label:'NFT-Gated' },
            { id:'mine',  label:'Mine' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              background: filter===f.id ? '#0c1e0c' : 'transparent',
              border:`1px solid ${filter===f.id ? '#d4af3744' : '#1a3a1a'}`,
              borderRadius:6, padding:'5px 14px', cursor:'pointer',
              color: filter===f.id ? '#d4af37' : '#6a9a6a',
              fontSize:11, fontWeight:700, fontFamily:'inherit',
              transition:'all .15s',
            }}>{f.label}</button>
          ))}
        </div>

        {filtered.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {filtered.map(r => (
              <RoomCard key={r.id} room={r} address={address} />
            ))}
          </div>
        )}

        {publicRooms.length === 0 && (
          <div style={{
            textAlign:'center', padding:'56px 24px',
            background:'#0c1a0c', border:'1px solid #1a3a1a',
            borderRadius:12,
          }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>♠</div>
            <div style={{ fontSize:13, color:'#3a6a3a', fontWeight:500, marginBottom:4 }}>
              No private rooms leased yet
            </div>
            <div style={{ fontSize:10, color:'#1a3a1a' }}>
              Be the first to lease a room for your community
            </div>
          </div>
        )}

        {publicRooms.length > 0 && filtered.length === 0 && (
          <div style={{
            textAlign:'center', padding:'40px 24px',
            background:'#0c1a0c', border:'1px solid #1a3a1a', borderRadius:12,
          }}>
            <div style={{ fontSize:11, color:'#3a6a3a' }}>No rooms in this category</div>
          </div>
        )}

        {confirmed && (
          <div style={{
            position:'fixed', bottom:24, right:24,
            background:'linear-gradient(135deg,#0a1f0a,#060e06)',
            border:'1px solid #27ae6066', borderRadius:10,
            padding:'12px 20px', color:'#27ae60', fontSize:12, fontWeight:700,
            boxShadow:'0 0 20px rgba(39,174,96,.2)',
            zIndex:200,
          }}>
            ✓ Room leased successfully!
          </div>
        )}
      </div>

      {showLease && (
        <LeaseRoomModal
          onClose={() => setShowLease(false)}
          weeklyFee={weeklyFee}
          monthlyFee={monthlyFee}
          leaseRoom={leaseRoom}
          status={status}
          errorMsg={errorMsg}
        />
      )}
    </div>
  );
}
