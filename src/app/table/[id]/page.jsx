'use client';
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import WalletBar from '../../../components/WalletBar';
import PokerTable from '../../../components/PokerTable';
import BettingControls from '../../../components/BettingControls';
import Card from '../../../components/Card';
import { useTableSocket, useEscrow, useHandleMap, useHandleAvatars } from '../../../hooks/usePokerWallet';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';

// ── action label from server → badge key ─────────────────────────────────────
function parseActionLabel(label) {
  if (!label) return null;
  const l = label.toUpperCase();
  if (l.startsWith('FOLD'))  return 'fold';
  if (l.startsWith('CHECK')) return 'check';
  if (l.startsWith('CALL'))  return 'call';
  if (l.startsWith('RAISE')) return 'raise';
  if (l.includes('ALL IN'))  return 'all-in';
  if (l.startsWith('BET'))   return 'bet';
  if (l.includes('BLIND'))   return 'blind';
  return null;
}

// ── map server pubState → PokerTable seats array (uses seatIndex for position) ──
function mapToSeats(state, heroAddr, handleMap = {}, avatarMap = {}) {
  if (!state) return Array(9).fill(null);

  const seats = Array(9).fill(null);
  const players = state.players || [];

  players.forEach(p => {
    const idx = p.seatIndex ?? null;
    if (idx == null || idx < 0 || idx > 8) return;
    seats[idx] = {
      player: {
        address:   p.addr,
        handle:    handleMap[p.addr?.toLowerCase()] || null,
        avatarUrl: avatarMap[p.addr?.toLowerCase()] || null,
        chips:     p.chips,
        isHero:    p.addr?.toLowerCase() === heroAddr?.toLowerCase(),
        isFolded:  p.folded,
        isAllIn:   p.allIn,
      },
      cards:      (p.hand || []).map(c => c === '??' ? { faceDown: true } : c),
      isActive:   p.addr?.toLowerCase() === state.activeAddr?.toLowerCase(),
      lastAction: parseActionLabel(p.actionLabel),
      betAmount:  p.bet || 0,
      isDealer:   p.addr?.toLowerCase() === state.dealerAddr?.toLowerCase(),
    };
  });

  return seats;
}

// ── status badge ──────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const color = {
    disconnected: '#555',
    connecting:   '#e67e22',
    connected:    '#e67e22',
    authed:       '#27ae60',
  }[status] || '#555';
  const label = { disconnected:'Disconnected', connecting:'Connecting…', connected:'Authenticating…', authed:'Connected' }[status] || status;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <div style={{ width:6, height:6, borderRadius:'50%', background:color,
        boxShadow: status==='authed' ? `0 0 6px ${color}` : 'none' }} />
      <span style={{ fontSize:9, color, letterSpacing:1 }}>{label.toUpperCase()}</span>
    </div>
  );
}

// ── chat + hand history ────────────────────────────────────────────────────────
function ChatPanel({ messages }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%',
      background:'#060e06', border:'1px solid #1a3a1a', borderRadius:8, overflow:'hidden' }}>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid #1a3a1a',
        fontSize:9, color:'#3a6a3a', letterSpacing:2 }}>TABLE LOG</div>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 12px',
        display:'flex', flexDirection:'column', gap:2 }}>
        {messages.map((m,i) => (
          <div key={i} style={{
            fontSize:10, padding:'2px 0',
            borderBottom:'1px solid rgba(255,255,255,.03)',
            color: m.type==='system' ? '#3a6a3a'
                 : m.type==='action' ? '#d4af37'
                 : m.type==='winner' ? '#27ae60'
                 : '#7a9a7a',
            fontFamily: m.type!=='chat' ? "'JetBrains Mono',monospace" : 'inherit',
          }}>
            {m.handle && <span style={{ color:'#5a9a5a', marginRight:5 }}>{m.handle}:</span>}
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── hand-over overlay ─────────────────────────────────────────────────────────
function HandOverOverlay({ handOver, handleMap = {}, onDismiss }) {
  const [secs, setSecs] = useState(7);
  const identity = handOver?.handNonce ?? 0;

  useEffect(() => {
    if (!handOver) return;
    setSecs(7);
    const iv = setInterval(() => setSecs(s => s - 1), 1000);
    const t  = setTimeout(() => { clearInterval(iv); onDismiss(); }, 7000);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [identity]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!handOver) return null;
  const winners  = handOver.winners || [];
  const results  = handOver.results || [];
  // Non-winners who showed their cards (losers at showdown)
  const losers   = results.filter(r => !winners.includes(r.addr) && r.cards?.length);

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.8)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:200,
    }} onClick={onDismiss}>
      <div style={{
        background:'linear-gradient(135deg,#0a1f0a,#060e06)',
        border:'1px solid #d4af37', borderRadius:16,
        padding:'28px 36px', textAlign:'center',
        boxShadow:'0 0 40px rgba(212,175,55,.3)',
        animation:'fade-in .4s ease forwards',
        maxWidth: 480, width: '90vw',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:9, color:'#d4af3799', letterSpacing:4, marginBottom:12 }}>HAND COMPLETE</div>

        {/* Winners */}
        {winners.map((w, i) => {
          const res = results.find(r => r.addr === w);
          const displayName = handleMap[w?.toLowerCase()] || `${w.slice(0,8)}…`;
          return (
            <div key={i} style={{ marginBottom: losers.length ? 16 : 0 }}>
              <div style={{ fontSize:20, color:'#d4af37', fontWeight:700,
                fontFamily:"'Playfair Display',serif" }}>
                {displayName} wins
              </div>
              {res?.hand && (
                <div style={{ fontSize:11, color:'#d4af3799', letterSpacing:1, marginTop:2 }}>
                  {res.hand}
                </div>
              )}
              {res?.cards?.length > 0 && (
                <div style={{ display:'flex', gap:4, justifyContent:'center', marginTop:8 }}>
                  {res.cards.map((c, ci) => (
                    <div key={ci} className="card-deal" style={{ animationDelay:`${ci*0.06}s` }}>
                      <Card card={c} width={44} height={62} />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize:15, color:'#27ae60', fontWeight:700, marginTop:8,
                fontFamily:"'JetBrains Mono',monospace" }}>
                ◈ {handOver.pot?.toLocaleString()}
              </div>
            </div>
          );
        })}

        {/* Losers */}
        {losers.length > 0 && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #1a3a1a' }}>
            {losers.map((r, i) => {
              const displayName = handleMap[r.addr?.toLowerCase()] || `${r.addr?.slice(0,8)}…`;
              return (
                <div key={i} style={{ marginBottom: i < losers.length-1 ? 10 : 0 }}>
                  <div style={{ fontSize:10, color:'#5a7a5a', marginBottom:4 }}>
                    {displayName} · {r.hand}
                  </div>
                  <div style={{ display:'flex', gap:4, justifyContent:'center' }}>
                    {r.cards.map((c, ci) => (
                      <div key={ci} style={{ opacity:0.7 }}>
                        <Card card={c} width={36} height={50} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize:9, color:'#3a6a3a', marginTop:14, letterSpacing:1 }}>
          Next hand in {Math.max(0, secs)}s · tap to skip
        </div>
      </div>
    </div>
  );
}

// ── Seat positions on a 9-seat oval (normalised 0-1 coords, origin top-left) ──
const SEAT_POS = [
  { x: 0.50, y: 0.88 }, // 0 bottom-center
  { x: 0.74, y: 0.80 }, // 1 bottom-right
  { x: 0.90, y: 0.57 }, // 2 right
  { x: 0.82, y: 0.28 }, // 3 top-right
  { x: 0.62, y: 0.10 }, // 4 top-center-right
  { x: 0.38, y: 0.10 }, // 5 top-center-left
  { x: 0.18, y: 0.28 }, // 6 top-left
  { x: 0.10, y: 0.57 }, // 7 left
  { x: 0.26, y: 0.80 }, // 8 bottom-left
];

function SeatPicker({ maxPlayers, takenSeats, pendingSeat, onSelect, onBuyIn, buyInAmount, onBuyInChange, minBuyIn, maxBuyIn, escrowStatus }) {
  const seats = SEAT_POS.slice(0, maxPlayers);
  const takenMap = Object.fromEntries((takenSeats || []).map(s => [s.seatIndex, s.addr]));
  const fmt = n => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n/1000).toFixed(0)}K` : String(n||0);

  return (
    <div style={{ position:'relative', width:'100%', maxWidth:480, margin:'0 auto' }}>
      {/* Oval table background */}
      <div style={{
        position:'relative', width:'100%', paddingBottom:'70%',
        background:'radial-gradient(ellipse at center, #0d2b0d 60%, #071507)',
        border:'2px solid #1a4a1a', borderRadius:'50%',
        boxShadow:'0 0 40px rgba(39,174,96,.1)',
      }}>
        {/* Centre label */}
        <div style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)', textAlign:'center',
        }}>
          <div style={{ fontSize:10, color:'#3a6a3a', letterSpacing:2 }}>SELECT A SEAT</div>
          {minBuyIn != null && maxBuyIn != null && minBuyIn !== maxBuyIn ? (
            <div style={{ fontSize:10, color:'#5a8a5a', marginTop:4 }}>
              {fmt(minBuyIn)}–{fmt(maxBuyIn)} CHIPS
            </div>
          ) : (
            <div style={{ fontSize:13, color:'#d4af37', fontWeight:700,
              fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>
              {fmt(buyInAmount)} CHIPS
            </div>
          )}
        </div>

        {/* Seat circles */}
        {seats.map((pos, i) => {
          const isTaken = i in takenMap;
          const isSelected = pendingSeat === i;
          const addr = takenMap[i];
          return (
            <div
              key={i}
              onClick={() => !isTaken && onSelect(i)}
              title={isTaken ? addr : `Seat ${i+1}`}
              style={{
                position:'absolute',
                left:`${pos.x * 100}%`, top:`${pos.y * 100}%`,
                transform:'translate(-50%,-50%)',
                width:44, height:44, borderRadius:'50%',
                background: isTaken ? '#1a3a1a'
                  : isSelected ? 'linear-gradient(135deg,#1a4a1a,#0c2e0c)'
                  : '#0c1e0c',
                border: `2px solid ${isTaken ? '#2a5a2a' : isSelected ? '#d4af37' : '#3a6a3a'}`,
                cursor: isTaken ? 'default' : 'pointer',
                display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'center',
                transition:'all .15s',
                boxShadow: isSelected ? '0 0 12px rgba(212,175,55,.4)' : 'none',
              }}
            >
              {isTaken ? (
                <>
                  <div style={{ fontSize:9, color:'#5a8a5a' }}>●</div>
                  <div style={{ fontSize:7, color:'#3a6a3a', marginTop:1 }}>
                    {addr?.slice(2,6)}
                  </div>
                </>
              ) : (
                <div style={{ fontSize:11, color: isSelected ? '#d4af37' : '#3a6a3a', fontWeight:700 }}>
                  {i+1}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Buy-in panel */}
      {pendingSeat !== null && (
        <div style={{
          marginTop:16, background:'#060e06', border:'1px solid #d4af3744',
          borderRadius:10, padding:'16px 20px', display:'flex', flexDirection:'column', gap:12,
        }}>
          <div style={{ fontSize:10, color:'#3a6a3a', letterSpacing:1 }}>SEAT {pendingSeat + 1} — BUY IN</div>
          {minBuyIn != null && maxBuyIn != null && minBuyIn !== maxBuyIn && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <input
                type="range"
                min={minBuyIn} max={maxBuyIn} step={minBuyIn}
                value={buyInAmount}
                onChange={e => onBuyInChange(Number(e.target.value))}
                style={{ accentColor:'#d4af37', width:'100%' }}
              />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#3a6a3a' }}>
                <span>{fmt(minBuyIn)}</span>
                <span style={{ color:'#d4af37', fontWeight:700, fontFamily:"'JetBrains Mono',monospace", fontSize:13 }}>
                  {fmt(buyInAmount)} CHIPS
                </span>
                <span>{fmt(maxBuyIn)}</span>
              </div>
            </div>
          )}
          {(minBuyIn == null || minBuyIn === maxBuyIn) && (
            <div style={{ fontSize:13, color:'#d4af37', fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>
              {fmt(buyInAmount)} CHIPS
            </div>
          )}
          <button
            onClick={() => onBuyIn(pendingSeat)}
            disabled={escrowStatus !== 'idle'}
            style={{
              background: escrowStatus !== 'idle' ? '#0a160a' : 'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
              border:`1px solid ${escrowStatus !== 'idle' ? '#1a3a1a' : '#d4af37'}`,
              borderRadius:8, padding:'10px 20px', cursor: escrowStatus !== 'idle' ? 'not-allowed' : 'pointer',
              color: escrowStatus !== 'idle' ? '#3a6a3a' : '#d4af37',
              fontSize:12, fontWeight:700, fontFamily:'inherit', alignSelf:'flex-end',
            }}
          >
            {escrowStatus === 'approving' ? 'Approving…'
             : escrowStatus === 'buying'  ? 'Buying In…'
             : 'Buy In →'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── confirm modal (replaces window.confirm which is broken in mobile WebViews) ─
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.75)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:400,
      padding:16,
    }}>
      <div style={{
        background:'linear-gradient(160deg,#0d1f0d,#060e06)',
        border:'1px solid #3a6a3a', borderRadius:14, padding:'24px 20px',
        width:'100%', maxWidth:340, textAlign:'center',
      }}>
        <div style={{ fontSize:12, color:'#8aaa8a', lineHeight:1.6, marginBottom:20 }}>
          {message}
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel} style={{
            flex:1, background:'transparent', border:'1px solid #1a3a1a',
            borderRadius:8, padding:'12px', cursor:'pointer',
            color:'#5a7a5a', fontSize:12, fontFamily:'inherit',
          }}>Stay</button>
          <button onClick={onConfirm} style={{
            flex:1, background:'linear-gradient(135deg,#3a0f0f,#1f0707)',
            border:'1px solid #7a2a2a', borderRadius:8, padding:'12px',
            cursor:'pointer', color:'#e74c3c', fontSize:12,
            fontFamily:'inherit', fontWeight:700,
          }}>Leave</button>
        </div>
      </div>
    </div>
  );
}

// ── main table page ───────────────────────────────────────────────────────────
function TablePageInner() {
  const { id }   = useParams();
  const router   = useRouter();
  const searchParams = useSearchParams();
  const { address: rawAddress } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const address = mounted ? rawAddress : undefined;

  const { buyIn, rebuy, cashOut, refund, status: escrowStatus, tableInfo } = useEscrow(id);

  // URL params carry config immediately (before RPC loads) — prevents wrong-default-config bug
  const tableConfigFromUrl = useMemo(() => {
    const buyIn = searchParams.get('buyIn');
    if (!buyIn) return null;
    return {
      buyIn:      Number(buyIn),
      bigBlind:   Number(searchParams.get('bigBlind') || 20),
      maxPlayers: Number(searchParams.get('maxPlayers') || 6),
      gameType:   Number(searchParams.get('gameType') || 0),
    };
  }, [searchParams]);

  // Use URL config first (available immediately), fall back to on-chain data once loaded
  const tableConfig = tableConfigFromUrl || (tableInfo ? {
    buyIn:      Number(tableInfo.buyIn) / 1e18,
    bigBlind:   Number(tableInfo.bigBlind) / 1e18,
    maxPlayers: Number(tableInfo.maxPlayers),
    gameType:   Number(tableInfo.gameType),
  } : null);

  const {
    gameState, handOver, wsStatus, wsError,
    cashoutSig, setCashoutSig,
    cashoutLocked, tableLocked, refundAvailable,
    seatPickerData,
    sendAction, leaveTable, sendRebuyConfirmed, joinWithSeat, spawnBot,
  } = useTableSocket(id, tableConfig);

  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [showRebuy,       setShowRebuy]       = useState(false);
  const [rebuyAmt,        setRebuyAmt]        = useState('');
  const [pendingSeat,     setPendingSeat]     = useState(null);
  const [selectedBuyIn,   setSelectedBuyIn]   = useState(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Initialise selectedBuyIn when seat picker appears
  useEffect(() => {
    if (seatPickerData && selectedBuyIn === null)
      setSelectedBuyIn(seatPickerData.minBuyIn ?? tableConfig?.buyIn ?? 1000);
  }, [seatPickerData, selectedBuyIn, tableConfig]);

  const [log, setLog] = useState([
    { type:'system', text:`Joined table ${id}` },
  ]);
  const [showHandOver, setShowHandOver] = useState(false);

  const playerAddrs = useMemo(() => gameState?.players?.map(p => p.addr).filter(Boolean) || [], [gameState]);
  const handleMap   = useHandleMap(playerAddrs);
  const avatarMap   = useHandleAvatars(playerAddrs);

  // Append server events to the log
  useEffect(() => {
    if (!gameState) return;
    const acted = gameState.players?.find(p => p.actionLabel && !p.folded);
    if (acted) {
      setLog(prev => {
        const last = prev[prev.length - 1];
        const name = handleMap[acted.addr?.toLowerCase()] || `${acted.addr.slice(0,8)}…`;
        const entry = { type:'action', text:`${name} ${acted.actionLabel}` };
        if (last?.text === entry.text) return prev;
        return [...prev.slice(-60), entry];
      });
    }
  }, [gameState, handleMap]);

  useEffect(() => {
    if (!handOver) return;
    setShowHandOver(true);
    const names = handOver.winners?.map(w =>
      handleMap[w?.toLowerCase()] || w.slice(0,8)+'…'
    ).join(', ') || '?';
    setLog(prev => [...prev.slice(-60), {
      type: 'winner',
      text: `Winner: ${names}  ◈${handOver.pot?.toLocaleString()}  (${handOver.results?.[0]?.hand || ''})`,
    }]);
  }, [handOver, handleMap]);

  useEffect(() => {
    if (wsError) setLog(prev => [...prev, { type:'system', text:`⚠ ${wsError}` }]);
  }, [wsError]);

  // Derive hero state
  const heroPlayer = useMemo(() =>
    gameState?.players?.find(p => p.addr?.toLowerCase() === address?.toLowerCase()),
    [gameState, address]
  );
  const isHeroTurn = heroPlayer && !heroPlayer.folded &&
    gameState?.activeAddr?.toLowerCase() === address?.toLowerCase();

  const callAmount = isHeroTurn
    ? Math.max(0, (gameState?.maxBet || 0) - (heroPlayer?.bet || 0))
    : 0;
  const canCheck   = isHeroTurn && callAmount === 0;
  const bigBlind   = gameState?.config?.bigBlind || 100;
  const minRaise   = Math.max(bigBlind, gameState?.lastRaiseAmount || bigBlind);

  const seats = useMemo(() => mapToSeats(gameState, address, handleMap, avatarMap), [gameState, address, handleMap, avatarMap]);

  const handleLeave = useCallback(() => {
    const isWaiting = gameState?.phase === 'waiting' || !gameState;
    if (isWaiting) {
      setShowLeaveConfirm(true); // show React modal instead of window.confirm
      return;
    }
    leaveTable();
  }, [leaveTable, gameState]);

  const handleCashOut = useCallback(async () => {
    if (!cashoutSig || !address) return;
    await cashOut(address, cashoutSig.amount, cashoutSig.nonce, cashoutSig.sig);
    setCashoutSig(null);
    router.push('/');
  }, [cashoutSig, address, cashOut, setCashoutSig, router]);

  const handleRebuy = useCallback(async () => {
    const amt = Number(rebuyAmt);
    if (!amt || amt <= 0) return;
    setShowRebuy(false);
    await rebuy(amt, sendRebuyConfirmed);
    setRebuyAmt('');
  }, [rebuyAmt, rebuy, sendRebuyConfirmed]);

  const handleRefund = useCallback(async () => {
    // On testnet (no real on-chain deposit exists in SKIP_CHAIN_VERIFY mode), skip the refund call.
    const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === '421614';
    if (!isTestnet) {
      await refund();
    }
    router.push('/');
  }, [refund, router]);

  const handleBuyIn = useCallback(async (seatIndex) => {
    const amount = selectedBuyIn
      || tableConfig?.buyIn
      || (tableInfo?.buyInAmount ? Number(tableInfo.buyInAmount) / 1e18 : 0);
    if (!amount) return;
    await buyIn(amount);
    joinWithSeat(seatIndex, amount);
  }, [buyIn, joinWithSeat, selectedBuyIn, tableConfig, tableInfo]);

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)', display:'flex', flexDirection:'column' }}>
      <WalletBar />

      {/* Breadcrumb + status */}
      <div style={{
        padding:'8px 16px', borderBottom:'1px solid #1a3a1a',
        display:'flex', alignItems:'center', gap:8, fontSize:10, color:'#3a6a3a',
      }}>
        <Link href="/" onClick={e => {
          // Block navigation while connecting/authing (heroPlayer may not be set yet)
          if (wsStatus !== 'disconnected') {
            e.preventDefault();
            if (heroPlayer) setShowLeaveConfirm(true);
          }
        }} style={{ color:'#3a6a3a', textDecoration:'none' }}>Lobby</Link>
        <span>›</span>
        <span style={{ color:'#6a9a6a' }}>
          Table #{id}
          {gameState?.config && ` · ${(gameState.config.bigBlind/2).toLocaleString()}/${gameState.config.bigBlind.toLocaleString()} CHIPS`}
        </span>
        <div style={{ marginLeft:'auto' }}><StatusDot status={wsStatus} /></div>
      </div>

      {/* Layout */}
      <div className="table-layout" style={{
        flex:1, display:'grid', gridTemplateColumns:'minmax(0,1fr) min(260px,35vw)',
        overflow:'hidden',
      }}>

        {/* Table area */}
        <div style={{
          display:'flex', flexDirection:'column',
          padding:'24px 16px 100px',
          overflowY:'auto', position:'relative',
        }}>
          {/* Connecting placeholder */}
          {wsStatus === 'disconnected' && !gameState && !seatPickerData && (
            <div style={{
              position:'absolute', top:'50%', left:'50%',
              transform:'translate(-50%,-50%)',
              textAlign:'center', color:'#3a6a3a', fontSize:12,
            }}>
              <div style={{ fontSize:32, marginBottom:12 }}>♠</div>
              <div>Connecting to game server…</div>
              {wsError && <div style={{ color:'#c0392b', marginTop:8, fontSize:11 }}>{wsError}</div>}
            </div>
          )}

          {/* Waiting for players — prominent banner in main area */}
          {gameState?.phase === 'waiting' && heroPlayer && (
            <div style={{
              background:'linear-gradient(135deg,#0a1f0a,#060e06)',
              border:'1px solid #1a4a1a', borderRadius:12,
              padding:'20px 24px', marginBottom:16, textAlign:'center',
              boxShadow:'0 0 20px rgba(39,174,96,.08)',
            }}>
              <div style={{ fontSize:24, marginBottom:8 }}>♠</div>
              <div style={{ fontSize:14, color:'#27ae60', fontWeight:700,
                fontFamily:"'Playfair Display',serif", marginBottom:6 }}>
                You're at the table!
              </div>
              <div style={{ fontSize:11, color:'#6a9a6a', marginBottom:12 }}>
                {gameState.players.length < 2
                  ? `Waiting for ${2 - gameState.players.length} more player to start (${gameState.players.length}/${gameState.config?.maxPlayers || 2} seated)`
                  : `${gameState.players.length}/${gameState.config?.maxPlayers || 2} seated — starting soon…`}
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.href).catch(() => {});
                    alert('Table link copied!\n\n' + window.location.href + '\n\nShare this with your opponent.');
                  }}
                  style={{
                    background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
                    border:'1px solid #27ae6066', borderRadius:8,
                    padding:'10px 20px', cursor:'pointer',
                    color:'#27ae60', fontSize:11, fontFamily:'inherit', fontWeight:700,
                    letterSpacing:1,
                  }}
                >
                  COPY & SHARE TABLE LINK
                </button>
                <button
                  onClick={() => spawnBot()}
                  style={{
                    background:'linear-gradient(135deg,#1a2a3a,#0c1e2e)',
                    border:'1px solid #4a7aaa66', borderRadius:8,
                    padding:'10px 20px', cursor:'pointer',
                    color:'#7ab4e0', fontSize:11, fontFamily:'inherit', fontWeight:700,
                    letterSpacing:1,
                  }}
                >
                  + SPAWN BOT
                </button>
              </div>
              <div style={{ fontSize:9, color:'#3a6a3a', marginTop:10, letterSpacing:1 }}>
                The game starts automatically when 2+ players are seated
              </div>
            </div>
          )}

          {/* Seat picker — shown when authenticated but not yet bought in */}
          {seatPickerData && !gameState && (
            <SeatPicker
              maxPlayers={seatPickerData.maxPlayers}
              takenSeats={seatPickerData.takenSeats}
              pendingSeat={pendingSeat}
              onSelect={setPendingSeat}
              onBuyIn={handleBuyIn}
              buyInAmount={selectedBuyIn ?? seatPickerData.minBuyIn ?? tableConfig?.buyIn ?? 1000}
              onBuyInChange={setSelectedBuyIn}
              minBuyIn={seatPickerData.minBuyIn}
              maxBuyIn={seatPickerData.maxBuyIn}
              escrowStatus={escrowStatus}
            />
          )}

          <PokerTable
            seats={seats}
            communityCards={gameState?.community || []}
            pot={gameState?.pot || 0}
            street={gameState?.phase || 'preflop'}
            winners={showHandOver && handOver ? handOver.winners?.map(w => ({
              address: w,
              amount: handOver.pot,
              hand: handOver.results?.find(r => r.addr === w)?.hand,
            })) : []}
            tableInfo={gameState?.config ? {
              bigBlind: gameState.config.bigBlind,
              gameType: gameState.config.gameType,
            } : null}
          />

          <BettingControls
            isActive={!!isHeroTurn}
            inGame={!!gameState && gameState.phase !== 'waiting' && !!heroPlayer && !heroPlayer.folded}
            canCheck={canCheck}
            callAmount={callAmount}
            minRaise={minRaise}
            maxRaise={heroPlayer?.chips || 0}
            pot={gameState?.pot || 0}
            bigBlind={bigBlind}
            playerChips={heroPlayer?.chips || 0}
            onFold={() => sendAction('fold')}
            onCheck={() => sendAction('check')}
            onCall={() => sendAction('call')}
            onRaise={amt => sendAction('raise', amt)}
            onAllIn={() => sendAction('allin')}
          />
        </div>

        {/* Side panel — desktop: right column; mobile: slide-up bottom drawer */}
        <div className="table-side-panel" style={{
          display:'flex', flexDirection:'column', gap:8,
          padding:'16px 12px 16px 0',
          borderLeft:'1px solid #1a3a1a',
          background:'rgba(0,0,0,.2)',
          overflowY:'auto',
          ...(isMobile ? {
            position:'fixed', left:0, right:0, bottom:0,
            maxHeight:'72vh',
            padding:'8px 12px calc(16px + env(safe-area-inset-bottom))',
            borderLeft:'none', borderTop:'1px solid var(--gold-dim)',
            borderRadius:'16px 16px 0 0',
            background:'linear-gradient(180deg,#0a160a,#060e06)',
            boxShadow:'0 -8px 30px rgba(0,0,0,.6)',
            transform: drawerOpen ? 'translateY(0)' : 'translateY(100%)',
            transition:'transform .28s ease',
            zIndex:150,
          } : {}),
        }}>
          {/* Mobile grab handle — tap to close the drawer */}
          {isMobile && (
            <div onClick={() => setDrawerOpen(false)}
              style={{ flexShrink:0, padding:'2px 0 8px', cursor:'pointer' }}>
              <div style={{ width:40, height:4, borderRadius:2,
                background:'#3a6a3a', margin:'0 auto' }} />
            </div>
          )}

          {/* Player stacks */}
          <div style={{ background:'#060e06', border:'1px solid #1a3a1a',
            borderRadius:8, overflow:'hidden', flexShrink:0 }}>
            <div style={{ padding:'8px 12px', borderBottom:'1px solid #1a3a1a',
              fontSize:9, color:'#3a6a3a', letterSpacing:2 }}>STACKS</div>
            <div style={{ padding:'6px' }}>
              {(gameState?.players || []).map((p, i) => (
                <div key={i} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'5px 8px', borderRadius:4,
                  background: p.addr === gameState?.activeAddr ? 'rgba(212,175,55,.05)' : 'transparent',
                  opacity: p.folded ? 0.4 : 1,
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:8, height:8, borderRadius:'50%',
                      background: p.addr === gameState?.activeAddr ? '#d4af37' : '#1a3a1a' }} />
                    <span style={{
                      fontSize:10, maxWidth:100,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      color: p.addr?.toLowerCase() === address?.toLowerCase() ? '#d4af37' : '#8aaa8a',
                    }}>
                      {p.addr?.toLowerCase() === address?.toLowerCase()
                        ? 'You'
                        : `${p.addr?.slice(0,8)}…`}
                    </span>
                    {p.allIn && <span style={{ fontSize:7, color:'#e67e22',
                      border:'1px solid #e67e2244', borderRadius:2, padding:'0 3px' }}>AI</span>}
                  </div>
                  <span style={{ fontSize:10, color:'#d4af37',
                    fontFamily:"'JetBrains Mono',monospace" }}>
                    ◈{((p.chips||0)/1000).toFixed(1)}K
                  </span>
                </div>
              ))}
              {(!gameState || !gameState.players?.length) && (
                <div style={{ padding:'12px 8px', fontSize:10, color:'#1a3a1a', textAlign:'center' }}>
                  Waiting for players…
                </div>
              )}
            </div>
          </div>

          {/* Waiting status compact badge */}
          {gameState?.phase === 'waiting' && heroPlayer && (
            <div style={{
              background:'rgba(39,174,96,.06)', border:'1px solid #27ae6033',
              borderRadius:6, padding:'6px 10px',
              fontSize:9, color:'#27ae60', letterSpacing:1, textAlign:'center',
            }}>
              WAITING — {gameState.players.length}/{gameState.config?.maxPlayers} seated
            </div>
          )}

          {/* Table log */}
          <div style={{ flex:1, minHeight:180 }}>
            <ChatPanel messages={log} />
          </div>

          {/* Phase indicator */}
          {gameState?.phase && gameState.phase !== 'waiting' && (
            <div style={{
              background:'#060e06', border:'1px solid #1a3a1a', borderRadius:8,
              padding:'8px 12px', display:'flex', justifyContent:'space-between',
              alignItems:'center',
            }}>
              <span style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1 }}>STREET</span>
              <span style={{ fontSize:11, color:'#d4af37', fontWeight:700, letterSpacing:2,
                fontFamily:"'JetBrains Mono',monospace" }}>
                {gameState.phase.toUpperCase()}
              </span>
            </div>
          )}

          {/* Cashout banner — shown after server sends CASHOUT_SIG */}
          {cashoutSig && (
            <div style={{ background:'rgba(212,175,55,.08)', border:'1px solid #d4af3766',
              borderRadius:8, padding:'12px' }}>
              <div style={{ fontSize:9, color:'#d4af37', letterSpacing:1, marginBottom:6 }}>READY TO WITHDRAW</div>
              <div style={{ fontSize:16, color:'#d4af37', fontWeight:700,
                fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>
                ◈ {Number(cashoutSig.amount).toLocaleString()}
              </div>
              <button onClick={handleCashOut} disabled={escrowStatus !== 'idle'}
                style={{ width:'100%', background:'linear-gradient(135deg,#1a4a1a,#0c2e0c)',
                  border:'1px solid #d4af37', borderRadius:6, padding:'8px',
                  color:'#d4af37', fontSize:11, fontWeight:700, fontFamily:'inherit',
                  cursor: escrowStatus !== 'idle' ? 'not-allowed' : 'pointer' }}>
                {escrowStatus === 'cashout' ? 'Withdrawing…' : 'Claim Chips + Leave'}
              </button>
            </div>
          )}

          {/* Rebuy section */}
          {mounted && gameState && heroPlayer && heroPlayer.chips < gameState.config?.buyIn && (
            <div>
              {!showRebuy ? (
                <button onClick={() => setShowRebuy(true)} style={{
                  width:'100%', background:'transparent', border:'1px solid #1a5a1a',
                  borderRadius:6, padding:'7px', cursor:'pointer',
                  color:'#27ae60', fontSize:11, fontFamily:'inherit', transition:'all .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor='#27ae60'}
                onMouseLeave={e => e.currentTarget.style.borderColor='#1a5a1a'}>
                  + Rebuy
                </button>
              ) : (
                <div style={{ display:'flex', gap:4 }}>
                  <input type="number" value={rebuyAmt} onChange={e => setRebuyAmt(e.target.value)}
                    placeholder="Amount"
                    style={{ flex:1, background:'#060e06', border:'1px solid #1a3a1a',
                      borderRadius:6, padding:'6px 8px', color:'#d4af37', fontSize:11,
                      fontFamily:"'JetBrains Mono',monospace", outline:'none' }} />
                  <button onClick={handleRebuy} disabled={escrowStatus !== 'idle'}
                    style={{ background:'#0c2e0c', border:'1px solid #27ae60',
                      borderRadius:6, padding:'6px 10px', cursor:'pointer',
                      color:'#27ae60', fontSize:11, fontFamily:'inherit' }}>
                    {escrowStatus !== 'idle' ? '…' : 'OK'}
                  </button>
                  <button onClick={() => setShowRebuy(false)}
                    style={{ background:'transparent', border:'1px solid #1a3a1a',
                      borderRadius:6, padding:'6px 8px', cursor:'pointer',
                      color:'#3a6a3a', fontSize:11, fontFamily:'inherit' }}>✕</button>
                </div>
              )}
            </div>
          )}

          {/* Creator lock notice */}
          {tableLocked && mounted && address?.toLowerCase() === gameState?.creator?.toLowerCase() && (
            <div style={{
              background:'rgba(230,126,34,.08)', border:'1px solid #e67e2244',
              borderRadius:8, padding:'10px 12px', fontSize:10, color:'#e67e22', lineHeight:1.5,
            }}>
              🔒 Table locked — a player must play 7 hands or all others must leave before you can close this table.
            </div>
          )}

          {/* Refund available (table not yet active) */}
          {refundAvailable && !cashoutSig && (
            <div>
              <div style={{ fontSize:9, color:'#d4af3799', letterSpacing:1, marginBottom:6 }}>
                You left the waiting room
              </div>
              <button onClick={handleRefund} disabled={escrowStatus !== 'idle'} style={{
                width:'100%', background:'rgba(212,175,55,.08)', border:'1px solid #d4af3766',
                borderRadius:6, padding:'8px', cursor: escrowStatus !== 'idle' ? 'not-allowed' : 'pointer',
                color:'#d4af37', fontSize:11, fontFamily:'inherit', fontWeight:700,
              }}>
                {escrowStatus !== 'idle' ? 'Processing…' : 'Return to Lobby'}
              </button>
            </div>
          )}

          {/* Leave — locked badge or button */}
          {!cashoutSig && !refundAvailable && (
            cashoutLocked ? (
              <div style={{
                background:'rgba(230,126,34,.08)', border:'1px solid #e67e2244',
                borderRadius:6, padding:'8px 12px', textAlign:'center',
                fontSize:11, color:'#e67e22', fontWeight:700,
              }}>
                🔒 Locked — {cashoutLocked.handsRemaining} hand{cashoutLocked.handsRemaining !== 1 ? 's' : ''} remaining
              </div>
            ) : (
              <button onClick={handleLeave} style={{
                background:'transparent', border:'1px solid #3a1a1a',
                borderRadius:6, padding:'8px', cursor:'pointer',
                color:'#6a4a4a', fontSize:11, fontFamily:'inherit', transition:'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color='#e74c3c'; e.currentTarget.style.borderColor='#c0392b'; }}
              onMouseLeave={e => { e.currentTarget.style.color='#6a4a4a'; e.currentTarget.style.borderColor='#3a1a1a'; }}>
                Leave Table
              </button>
            )
          )}
        </div>
      </div>

      {/* Mobile drawer toggle — floating pill, hidden while the drawer is open */}
      {isMobile && !drawerOpen && (
        <button onClick={() => setDrawerOpen(true)} style={{
          position:'fixed', top:50, right:10, zIndex:140,
          background:'rgba(10,22,10,.92)', border:'1px solid var(--gold-dim)',
          borderRadius:20, padding:'6px 14px', cursor:'pointer',
          color:'var(--gold)', fontSize:11, fontWeight:700, fontFamily:'inherit',
          letterSpacing:1, boxShadow:'0 2px 10px rgba(0,0,0,.5)',
        }}>
          ☰ Stacks &amp; Log
        </button>
      )}

      {/* Mobile drawer backdrop — tap outside to close */}
      {isMobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:145,
        }} />
      )}

      <HandOverOverlay
        handOver={showHandOver ? handOver : null}
        handleMap={handleMap}
        onDismiss={() => setShowHandOver(false)}
      />

      {/* Leave confirmation modal — used instead of window.confirm (broken in mobile WebViews) */}
      {showLeaveConfirm && (
        <ConfirmModal
          message="Leave the waiting room? You can rejoin later with the same table link."
          onConfirm={() => {
            setShowLeaveConfirm(false);
            leaveTable();
          }}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </div>
  );
}

export default function TablePage() {
  return (
    <Suspense fallback={null}>
      <TablePageInner />
    </Suspense>
  );
}
