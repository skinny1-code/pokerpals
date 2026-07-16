'use client';
import { useState, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useAccount } from 'wagmi';
import { useTournaments, useRegisterTournament } from '../../hooks/usePokerWallet';

const STATUS_LABEL = ['Registration','Running','Settled','Cancelled'];
const STATUS_COLOR = ['#27ae60','#e67e22','#8a8478','#e74c3c'];
const GAME_LABEL   = { 0:"NLH", 1:'PLO' };

function fmt(v) {
  return v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
       : v >= 1_000     ? `${(v/1_000).toFixed(1)}K`
       : v.toLocaleString(undefined, { maximumFractionDigits:2 });
}

function countdown(ts) {
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return 'Starting now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h/24)}d ${h%24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function TournamentCard({ tourn, address, onRegister, regStatus, isVerified, regErrorMsg }) {
  const [hov, setHov] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (tourn.status !== 0) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [tourn.status]);

  const statusColor = STATUS_COLOR[tourn.status] || '#8a8478';
  const isOpen      = tourn.status === 0;
  const isFull      = tourn.entrantCount >= tourn.maxPlayers;
  const canRegister = isOpen && !tourn.isRegistered && !isFull && !!address;

  const prize = tourn.guaranteed && tourn.guaranteedPrize > tourn.prizePool
    ? tourn.guaranteedPrize
    : tourn.prizePool;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? '#141417' : '#111114',
        border:`1px solid ${hov ? '#303036' : '#232327'}`,
        borderRadius:12, padding:'20px 20px',
        display:'flex', flexDirection:'column', gap:12,
        transition:'all .15s',
      }}
    >
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#e8e0cc', marginBottom:4 }}>
            {tourn.name}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{
              fontSize:8, fontWeight:700, letterSpacing:.5,
              color:statusColor, background:`${statusColor}15`,
              border:`1px solid ${statusColor}40`,
              borderRadius:4, padding:'2px 7px',
            }}>
              {STATUS_LABEL[tourn.status] || 'Unknown'}
            </span>
            <span style={{ fontSize:10, color:'#7d786c' }}>
              {GAME_LABEL[tourn.gameType] || 'NLH'}
            </span>
            {tourn.guaranteed && (
              <span style={{ fontSize:8, color:'#9b59b6', border:'1px solid #9b59b644',
                borderRadius:4, padding:'2px 6px', letterSpacing:.5 }}>
                GUARANTEED
              </span>
            )}
          </div>
        </div>

        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontSize:18, color:'#c9b075', fontWeight:700,
            fontFamily:"'JetBrains Mono',monospace" }}>
            ◈ {fmt(prize)}
          </div>
          <div style={{ fontSize:9, color:'#57544b', marginTop:2 }}>PRIZE POOL</div>
        </div>
      </div>

      {/* Details grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
        <div style={{ background:'#0b0b0d', border:'1px solid #232327', borderRadius:8, padding:'8px 10px' }}>
          <div style={{ fontSize:9, color:'#57544b', letterSpacing:1, marginBottom:3 }}>ENTRY</div>
          <div style={{ fontSize:13, color:'#c9b075', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            ◈ {fmt(tourn.entryFee)}
          </div>
        </div>
        <div style={{ background:'#0b0b0d', border:'1px solid #232327', borderRadius:8, padding:'8px 10px' }}>
          <div style={{ fontSize:9, color:'#57544b', letterSpacing:1, marginBottom:3 }}>PLAYERS</div>
          <div style={{ fontSize:13, color:'#9d9789', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            {tourn.entrantCount} / {tourn.maxPlayers}
          </div>
        </div>
        <div style={{ background:'#0b0b0d', border:'1px solid #232327', borderRadius:8, padding:'8px 10px' }}>
          <div style={{ fontSize:9, color:'#57544b', letterSpacing:1, marginBottom:3 }}>
            {isOpen ? 'STARTS IN' : 'STARTED'}
          </div>
          <div style={{ fontSize:13, color:'#9d9789', fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>
            {isOpen ? countdown(tourn.startTime) : new Date(tourn.startTime*1000).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Seat bar */}
      {isOpen && (
        <div>
          <div style={{ height:4, background:'#232327', borderRadius:2, overflow:'hidden' }}>
            <div style={{
              height:'100%', borderRadius:2, transition:'width .4s',
              background:'linear-gradient(90deg,#27ae60,#2ecc71)',
              width:`${Math.min(100, (tourn.entrantCount / tourn.maxPlayers) * 100)}%`,
            }} />
          </div>
          <div style={{ fontSize:9, color:'#57544b', marginTop:3 }}>
            {tourn.maxPlayers - tourn.entrantCount} seat{tourn.maxPlayers - tourn.entrantCount !== 1 ? 's' : ''} remaining
          </div>
        </div>
      )}

      {/* Action */}
      {isOpen && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          {tourn.isRegistered ? (
            <div style={{ fontSize:11, color:'#27ae60', fontWeight:700 }}>
              ✓ Registered
            </div>
          ) : isFull ? (
            <div style={{ fontSize:11, color:'#57544b' }}>Tournament full</div>
          ) : !address ? (
            <div style={{ fontSize:11, color:'#57544b' }}>Connect wallet to register</div>
          ) : !isVerified ? (
            <div style={{ fontSize:11, color:'#7d7050' }}>
              Mint a <a href="/handle" style={{ color:'#c9b075', fontWeight:700 }}>Poker Handle</a> to register — verified players only
            </div>
          ) : (
            <div>
              <button
                onClick={() => onRegister(tourn.id, tourn.entryFee)}
                disabled={regStatus !== 'idle' && regStatus !== 'error'}
                style={{
                  background: (regStatus !== 'idle' && regStatus !== 'error') ? '#0f0f11' : 'linear-gradient(135deg,#2b2b31,#242428)',
                  border:`1px solid ${(regStatus !== 'idle' && regStatus !== 'error') ? '#232327' : '#c9b075'}`,
                  borderRadius:8, padding:'9px 24px', cursor: (regStatus !== 'idle' && regStatus !== 'error') ? 'not-allowed' : 'pointer',
                  color: (regStatus !== 'idle' && regStatus !== 'error') ? '#57544b' : '#c9b075',
                  fontSize:12, fontWeight:700, fontFamily:'inherit',
                  transition:'all .15s',
                }}
              >
                {regStatus === 'approving'   ? 'Approving…'
                 : regStatus === 'registering' ? 'Registering…'
                 : regStatus === 'error' ? 'Retry Registration'
                 : `Register — ◈ ${fmt(tourn.entryFee)}`}
              </button>
              {regStatus === 'error' && regErrorMsg && (
                <div style={{ fontSize:10, color:'#e74c3c', marginTop:6 }}>{regErrorMsg}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TournamentPage() {
  const { address } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { tournaments, count } = useTournaments();
  const { register, status: regStatus, confirmed, isVerified, errorMsg: regErrorMsg } = useRegisterTournament();

  const [filter, setFilter] = useState('all');

  const filtered = tournaments.filter(t => {
    if (filter === 'open')   return t.status === 0;
    if (filter === 'live')   return t.status === 1;
    if (filter === 'past')   return t.status === 2 || t.status === 3;
    return true;
  });

  const openCount = tournaments.filter(t => t.status === 0).length;

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      <div style={{ maxWidth:900, margin:'0 auto', padding:'32px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom:24, display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ fontSize:11, color:'#57544b', letterSpacing:3, marginBottom:8 }}>
              SCHEDULED EVENTS
            </div>
            <h1 style={{ fontSize:28, color:'#c9b075', fontWeight:700,
              fontFamily:"'Playfair Display',serif", marginBottom:4 }}>
              Tournaments
            </h1>
            <div style={{ fontSize:11, color:'#7d786c' }}>
              {count === 0 ? 'No tournaments yet' : `${count} tournament${count !== 1 ? 's' : ''} · ${openCount} open`}
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:20 }}>
          {[
            { id:'all',  label:'All' },
            { id:'open', label:'Open' },
            { id:'live', label:'Live' },
            { id:'past', label:'Past' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              background: filter===f.id ? '#121215' : 'transparent',
              border:`1px solid ${filter===f.id ? '#c9b07544' : '#232327'}`,
              borderRadius:6, padding:'5px 14px', cursor:'pointer',
              color: filter===f.id ? '#c9b075' : '#8a8478',
              fontSize:11, fontWeight:700, fontFamily:'inherit',
              transition:'all .15s',
            }}>{f.label}</button>
          ))}
        </div>

        {/* Cards */}
        {filtered.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {filtered.map(t => (
              <TournamentCard
                key={t.id}
                tourn={t}
                address={mounted ? address : undefined}
                onRegister={register}
                regStatus={regStatus}
                isVerified={isVerified}
                regErrorMsg={regErrorMsg}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {count === 0 && (
          <div style={{
            textAlign:'center', padding:'56px 24px',
            background:'#111114', border:'1px solid #232327',
            borderRadius:12,
          }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>🏆</div>
            <div style={{ fontSize:13, color:'#57544b', fontWeight:500, marginBottom:4 }}>
              No tournaments scheduled yet
            </div>
            <div style={{ fontSize:10, color:'#232327' }}>
              Check back soon — events are posted by the operator
            </div>
          </div>
        )}

        {count > 0 && filtered.length === 0 && (
          <div style={{
            textAlign:'center', padding:'40px 24px',
            background:'#111114', border:'1px solid #232327', borderRadius:12,
          }}>
            <div style={{ fontSize:11, color:'#57544b' }}>No tournaments in this category</div>
          </div>
        )}

        {/* Confirmed feedback */}
        {confirmed && (
          <div style={{
            position:'fixed', bottom:24, right:24,
            background:'linear-gradient(135deg,#121215,#0b0b0d)',
            border:'1px solid #27ae6066', borderRadius:10,
            padding:'12px 20px', color:'#27ae60', fontSize:12, fontWeight:700,
            boxShadow:'0 0 20px rgba(39,174,96,.2)',
            zIndex:200,
          }}>
            ✓ Registered successfully!
          </div>
        )}
      </div>
    </div>
  );
}
