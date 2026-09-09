'use client';
import { useState, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useAccount } from 'wagmi';
import { isAddress } from 'viem';
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
      className="glass-strong"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position:'relative', overflow:'hidden',
        padding:'22px 22px',
        display:'flex', flexDirection:'column', gap:13,
        transition:'transform .22s ease, box-shadow .22s ease, border-color .22s ease',
        transform: hov ? 'translateY(-3px)' : 'none',
        borderColor: hov ? 'var(--border-gold)' : (isMine ? 'rgba(217,192,138,.28)' : 'var(--border)'),
        boxShadow: hov
          ? '0 18px 44px rgba(0,0,0,.6), 0 0 0 1px rgba(217,192,138,.16)'
          : (isMine ? 'var(--shadow-md), 0 0 0 1px rgba(217,192,138,.1)' : 'var(--shadow-md)'),
      }}
    >
      {/* Gold top hairline */}
      <div aria-hidden style={{
        position:'absolute', top:0, left:0, right:0, height:1,
        background:'linear-gradient(90deg, transparent, rgba(217,192,138,.5), transparent)',
      }} />
      {/* Corner glow */}
      <div aria-hidden style={{
        position:'absolute', right:-50, top:-50, width:180, height:180,
        background:'radial-gradient(circle, rgba(217,192,138,.08) 0%, transparent 70%)',
        pointerEvents:'none', opacity: hov ? 1 : .6, transition:'opacity .2s',
      }} />

      <div style={{ position:'relative', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12, minWidth:0 }}>
          {/* Crown emblem */}
          <div style={{
            width:42, height:42, borderRadius:11, flexShrink:0,
            background:'linear-gradient(145deg, rgba(217,192,138,.16), rgba(217,192,138,.04))',
            border:'1px solid rgba(217,192,138,.28)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:20, color:'var(--gold)',
            boxShadow: hov ? '0 0 14px rgba(217,192,138,.3)' : 'none', transition:'box-shadow .2s',
          }}>♛</div>
          <div style={{ minWidth:0 }}>
            <div className="serif" style={{ fontSize:16, fontWeight:700, color:'var(--gold-pale)', marginBottom:5 }}>
              {room.name || `Room #${room.id}`}
            </div>
            <div style={{ display:'flex', gap:7, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontSize:10.5, color:'var(--text-secondary)', fontWeight:600 }}>{GAME_LABEL[room.gameType] || 'NLH'}</span>
              {isGated && (
                <span style={{ fontSize:8, fontWeight:800, letterSpacing:.8, color:'#c79bef',
                  background:'rgba(160,108,212,.12)', border:'1px solid rgba(160,108,212,.36)',
                  borderRadius:20, padding:'2px 8px' }}>
                  ⬡ NFT-GATED
                </span>
              )}
              {isMine && (
                <span style={{ fontSize:8, fontWeight:800, letterSpacing:.8, color:'var(--gold-pale)',
                  background:'rgba(217,192,138,.1)', border:'1px solid rgba(217,192,138,.36)',
                  borderRadius:20, padding:'2px 8px',
                  boxShadow:'0 0 10px rgba(217,192,138,.18)' }}>
                  ♛ YOURS
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div className="gold-text" style={{ fontSize:14, fontFamily:"'JetBrains Mono',monospace", fontWeight:800 }}>
            {expiresIn(room.leaseExpiry)}
          </div>
          <div style={{ fontSize:8.5, color:'var(--text-muted)', letterSpacing:1.5, marginTop:3, fontWeight:800 }}>LEASE LEFT</div>
        </div>
      </div>

      <div style={{ position:'relative', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
        <div style={{ background:'rgba(7,7,8,.6)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px' }}>
          <div style={{ fontSize:8.5, color:'var(--text-muted)', letterSpacing:1.5, marginBottom:4, fontWeight:800 }}>SEATS</div>
          <div style={{ fontSize:14, color:'var(--text-secondary)', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            {room.maxPlayers}
          </div>
        </div>
        <div style={{ background:'rgba(7,7,8,.6)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px' }}>
          <div style={{ fontSize:8.5, color:'var(--text-muted)', letterSpacing:1.5, marginBottom:4, fontWeight:800 }}>MIN BUY-IN</div>
          <div className="gold-text" style={{ fontSize:14, fontFamily:"'JetBrains Mono',monospace", fontWeight:800 }}>
            {room.minBuyIn > 0 ? `◈ ${fmt(room.minBuyIn)}` : '—'}
          </div>
        </div>
        <div style={{ background:'rgba(7,7,8,.6)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px' }}>
          <div style={{ fontSize:8.5, color:'var(--text-muted)', letterSpacing:1.5, marginBottom:4, fontWeight:800 }}>MAX BUY-IN</div>
          <div className="gold-text" style={{ fontSize:14, fontFamily:"'JetBrains Mono',monospace", fontWeight:800 }}>
            {room.maxBuyIn > 0 ? `◈ ${fmt(room.maxBuyIn)}` : '—'}
          </div>
        </div>
      </div>

      <div style={{ position:'relative', fontSize:10.5, color:'var(--text-muted)', fontWeight:600 }}>
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

  const effectiveCount = Math.max(0, customCount ? Number(customCount) || 0 : count);
  const presets = periodMode === 'weeks' ? WEEK_PRESETS : MONTH_PRESETS;
  const rate     = periodMode === 'weeks' ? weeklyFee : monthlyFee;
  const totalFee = (effectiveCount || 0) * rate;
  const nftGateInvalid = nftGate.trim().length > 0 && !isAddress(nftGate.trim());

  const busy = status === 'approving' || status === 'leasing';
  const countValid = effectiveCount > 0 && Number.isInteger(effectiveCount);
  const canSubmit = !busy && !!name.trim() && countValid && !nftGateInvalid;

  const handleSubmit = () => {
    if (!canSubmit) return;
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
      background:'rgba(0,0,0,.82)', backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:300, padding:16, overflowY:'auto',
    }} onClick={onClose}>
      <div className="glass-strong" style={{
        padding:'28px 24px',
        width:'100%', maxWidth:440,
        boxShadow:'0 28px 70px rgba(0,0,0,.75)',
        animation:'pop-in .26s ease forwards',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize:9, color:'#87816f', letterSpacing:3, marginBottom:5, fontWeight:800 }}>♛ LEASE A ROOM</div>
        <div className="gold-text serif" style={{ fontSize:24, fontWeight:800, marginBottom:22 }}>
          New Private Room
        </div>

        {/* Name */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>ROOM NAME</div>
          <input
            type="text" value={name} maxLength={40}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Friday Night Game"
            className="input"
            style={{ width:'100%', padding:'11px 14px', boxSizing:'border-box', fontFamily:'inherit', fontSize:14 }}
          />
        </div>

        {/* Duration mode */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>DURATION</div>
          <div style={{ display:'flex', gap:8, marginBottom:10 }}>
            {[{v:'weeks',label:'Weekly'},{v:'months',label:'Monthly'}].map(o => (
              <button key={o.v} onClick={() => { setPeriodMode(o.v); setCount(1); setCustomCount(''); }} style={{
                flex:1, padding:'11px 0', borderRadius:10, cursor:'pointer',
                fontFamily:'inherit', fontSize:12, fontWeight:700,
                background: periodMode===o.v ? 'linear-gradient(135deg,#26262c,#242428)' : 'transparent',
                border:`1px solid ${periodMode===o.v ? 'var(--gold)' : 'var(--border)'}`,
                color: periodMode===o.v ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {presets.map(n => (
              <button key={n} onClick={() => { setCount(n); setCustomCount(''); }} style={{
                padding:'8px 15px', borderRadius:8, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
                background: count===n && !customCount ? '#18181c' : 'transparent',
                border:`1px solid ${count===n && !customCount ? 'var(--gold)' : 'var(--border)'}`,
                color: count===n && !customCount ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{n}</button>
            ))}
            <input
              type="number" placeholder="Custom" min={1} step={1}
              value={customCount}
              onChange={e => setCustomCount(e.target.value)}
              style={{
                width:84, padding:'8px 11px', borderRadius:8,
                background:'transparent', border:`1px solid ${customCount ? 'var(--gold)' : 'var(--border)'}`,
                color: customCount ? 'var(--gold-pale)' : '#7d786c',
                fontFamily:"'JetBrains Mono',monospace", fontSize:12,
                outline:'none',
              }}
            />
          </div>
          <div className="gold-text" style={{ fontSize:13, fontWeight:800, marginTop:10, fontFamily:"'JetBrains Mono',monospace" }}>
            Total: ◈ {fmt(totalFee)} ALLIN
          </div>
          {effectiveCount > 0 && !Number.isInteger(effectiveCount) && (
            <div style={{ fontSize:11, color:'#f0675a', marginTop:8,
              background:'rgba(224,71,59,.1)', border:'1px solid rgba(224,71,59,.32)',
              borderRadius:10, padding:'8px 12px', lineHeight:1.4 }}>
              Duration must be a whole number of {periodMode === 'weeks' ? 'weeks' : 'months'}.
            </div>
          )}
        </div>

        {/* Game type */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>GAME TYPE</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {GAME_OPTIONS.map(o => (
              <button key={o.v} onClick={() => setGameType(o.v)} style={{
                flex:'1 1 auto', padding:'10px 10px', borderRadius:9, cursor:'pointer',
                fontFamily:'inherit', fontSize:11, fontWeight:700,
                background: gameType===o.v ? 'linear-gradient(135deg,#26262c,#242428)' : 'transparent',
                border:`1px solid ${gameType===o.v ? 'var(--gold)' : 'var(--border)'}`,
                color: gameType===o.v ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Max seats */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>MAX SEATS</div>
          <div style={{ display:'flex', gap:6 }}>
            {[2,4,6,9].map(n => (
              <button key={n} onClick={() => setMaxPlayers(n)} style={{
                flex:1, padding:'9px 0', borderRadius:8, cursor:'pointer',
                fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700,
                background: maxPlayers===n ? '#18181c' : 'transparent',
                border:`1px solid ${maxPlayers===n ? 'var(--gold)' : 'var(--border)'}`,
                color: maxPlayers===n ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{n}</button>
            ))}
          </div>
        </div>

        {/* Visibility */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>VISIBILITY</div>
          <div style={{ display:'flex', gap:8 }}>
            {[{v:true,label:'Public'},{v:false,label:'Private / Invite'}].map(o => (
              <button key={String(o.v)} onClick={() => setIsPublic(o.v)} style={{
                flex:1, padding:'10px 0', borderRadius:9, cursor:'pointer',
                fontFamily:'inherit', fontSize:12, fontWeight:700,
                background: isPublic===o.v ? 'linear-gradient(135deg,#26262c,#242428)' : 'transparent',
                border:`1px solid ${isPublic===o.v ? 'var(--gold)' : 'var(--border)'}`,
                color: isPublic===o.v ? 'var(--gold-pale)' : '#7d786c',
                transition:'all .15s',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        {/* Buy-in range */}
        <div style={{ marginBottom:18, display:'flex', gap:10 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>MIN BUY-IN</div>
            <input
              type="number" placeholder="0 = none" value={minBuyIn}
              onChange={e => setMinBuyIn(e.target.value)}
              className="input"
              style={{ width:'100%', padding:'11px 14px', boxSizing:'border-box', fontFamily:"'JetBrains Mono',monospace", fontSize:13 }}
            />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>MAX BUY-IN</div>
            <input
              type="number" placeholder="0 = none" value={maxBuyIn}
              onChange={e => setMaxBuyIn(e.target.value)}
              className="input"
              style={{ width:'100%', padding:'11px 14px', boxSizing:'border-box', fontFamily:"'JetBrains Mono',monospace", fontSize:13 }}
            />
          </div>
        </div>

        {/* NFT gate */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:9, color:'#645f54', letterSpacing:2, marginBottom:9, fontWeight:800 }}>
            NFT GATE (OPTIONAL)
          </div>
          <input
            type="text" placeholder="0x… ERC-721 contract, leave blank for open"
            value={nftGate}
            onChange={e => setNftGate(e.target.value)}
            className="input"
            style={{ width:'100%', padding:'11px 14px', boxSizing:'border-box', fontFamily:"'JetBrains Mono',monospace", fontSize:12 }}
          />
          {nftGateInvalid && (
            <div style={{ fontSize:11, color:'#f0675a', marginTop:8,
              background:'rgba(224,71,59,.1)', border:'1px solid rgba(224,71,59,.32)',
              borderRadius:10, padding:'8px 12px', lineHeight:1.4 }}>
              Not a valid address — leave blank for an open room, or enter a valid 0x… contract address.
            </div>
          )}
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
          <button onClick={handleSubmit} disabled={!canSubmit} className="btn btn-gold"
            style={{ flex:2, padding:'13px', fontSize:13.5,
              opacity: canSubmit ? 1 : .5,
              cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
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
    <div className="has-bottom-nav" style={{ minHeight:'100vh', background:'var(--bg-abyss)' }}>
      <WalletBar />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="page-hero felt-texture" style={{ padding:'52px 24px 42px', textAlign:'center' }}>
        <div className="aurora" aria-hidden />

        {/* Watermark crown */}
        <div aria-hidden style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          fontSize:300, color:'rgba(217,192,138,.012)',
          pointerEvents:'none', userSelect:'none', lineHeight:1, zIndex:0,
        }}>♛</div>

        <div style={{ position:'relative', zIndex:1 }}>
          <div className="pill animate-up s1" style={{ marginBottom:18, opacity:0 }}>
            <span className="dot-live" />
            MEMBERS CLUB · PRIVATE TABLES
          </div>

          <h1 className="gold-text serif animate-up s2" style={{
            fontSize:'min(48px,11vw)', fontWeight:900, lineHeight:1.05,
            margin:'0 auto 14px', opacity:0,
            filter:'drop-shadow(0 0 40px rgba(217,192,138,.28))',
          }}>
            Private Rooms
          </h1>

          <p className="animate-up s3" style={{
            fontSize:14.5, color:'#8d877a', letterSpacing:.2,
            maxWidth:440, margin:'0 auto 30px', lineHeight:1.7, opacity:0,
          }}>
            Lease your own poker room with ALLIN.<br/>
            <span style={{ color:'#a59f90' }}>NFT-gate it for your community.</span>
          </p>

          {/* Lease rate stat cards */}
          <div className="animate-up s4" style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:28, opacity:0 }}>
            {[
              { label:'Per Week',     value:`◈ ${fmt(weeklyFee)}`  },
              { label:'Per Month',    value:`◈ ${fmt(monthlyFee)}` },
              { label:'Active Rooms', value: String(publicRooms.length) },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="gold-text" style={{
                  fontSize:24, fontWeight:900,
                  fontFamily:"'JetBrains Mono',monospace", lineHeight:1.1,
                }}>
                  {s.value}
                </div>
                <div style={{ fontSize:9, color:'#5c5950', letterSpacing:2, marginTop:6, fontWeight:800 }}>
                  {s.label.toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          <div className="animate-up s5" style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', opacity:0 }}>
            <button
              onClick={() => setShowLease(true)}
              disabled={!address}
              className="btn btn-gold"
              style={{ padding:'13px 28px', fontSize:14,
                opacity: !address ? .5 : 1,
                cursor: !address ? 'not-allowed' : 'pointer' }}
            >
              ♛ Lease a Room
            </button>
          </div>

          {!address && (
            <p className="animate-up s6" style={{ fontSize:12, color:'#5c5950', letterSpacing:.5, marginTop:20, opacity:0 }}>
              Connect your wallet above to lease a room
            </p>
          )}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div style={{ maxWidth:900, margin:'0 auto', padding:'30px 16px' }}>

        {/* Section header + controls */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          marginBottom:18, gap:10, flexWrap:'wrap',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <span style={{ fontSize:10, color:'#5c5950', letterSpacing:3, fontWeight:800 }}>
              ROOMS
            </span>
            {/* Filter tabs */}
            <div style={{
              display:'flex', gap:2,
              background:'rgba(11,11,13,.8)', border:'1px solid var(--border)',
              borderRadius:10, padding:3,
            }}>
              {[
                { id:'all',   label:'All' },
                { id:'gated', label:'NFT-Gated' },
                { id:'mine',  label:'Mine' },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`tab ${filter===f.id ? 'tab-active' : ''}`}
                  style={{
                    padding:'6px 13px', fontSize:11.5,
                    color: filter===f.id ? undefined : '#7d786c',
                  }}>{f.label}</button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setShowLease(true)}
            disabled={!address}
            className="btn btn-gold"
            style={{ padding:'8px 16px', fontSize:12,
              opacity: !address ? .5 : 1,
              cursor: !address ? 'not-allowed' : 'pointer' }}
          >
            ♛ Lease a Room
          </button>
        </div>

        {filtered.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {filtered.map(r => (
              <RoomCard key={r.id} room={r} address={address} />
            ))}
          </div>
        )}

        {publicRooms.length === 0 && (
          <div className="glass" style={{
            textAlign:'center', padding:'64px 24px',
          }}>
            <div style={{ fontSize:52, marginBottom:14, opacity:.22, color:'var(--gold)' }}>♛</div>
            <div style={{ fontSize:14, color:'var(--text-secondary)', fontWeight:700, marginBottom:6 }}>
              No private rooms leased yet
            </div>
            <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>
              Be the first to lease a room for your community
            </div>
          </div>
        )}

        {publicRooms.length > 0 && filtered.length === 0 && (
          <div className="glass" style={{
            textAlign:'center', padding:'48px 24px',
          }}>
            <div style={{ fontSize:12, color:'var(--text-muted)', fontWeight:600 }}>No rooms in this category</div>
          </div>
        )}

        {confirmed && (
          <div className="glass-strong" style={{
            position:'fixed', bottom:24, right:24,
            border:'1px solid rgba(52,211,153,.4)', borderRadius:12,
            padding:'13px 22px', color:'var(--emerald-bright)', fontSize:12.5, fontWeight:800,
            boxShadow:'0 0 24px rgba(16,185,129,.3)',
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
