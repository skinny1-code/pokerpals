'use client';
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import WalletBar from '../../../components/WalletBar';
import PokerTable from '../../../components/PokerTable';
import BettingControls from '../../../components/BettingControls';
import Card from '../../../components/Card';
import { useTableSocket, useEscrow, useHandleMap, useHandleAvatars, useWallet } from '../../../hooks/usePokerWallet';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useGameSounds } from '../../../hooks/useGameSounds';
import { playSfx } from '../../../lib/soundFx';
import VerifyHumanBanner from '../../../components/VerifyHumanBanner';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';

const HYPE_UI = process.env.NEXT_PUBLIC_CHAIN_ID === '99801' && process.env.NEXT_PUBLIC_ENABLE_ELYSIUM_NETWORKS === 'true';
const STAKE_UNIT = HYPE_UI ? 'μHYPE' : 'CHIPS';
const GAME_SCALE = HYPE_UI ? 1_000_000_000_000n : 1_000_000_000_000_000_000n;
function fromEscrowUnits(value) {
  const n = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  const q = n / GAME_SCALE;
  return q <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(q) : 0;
}

// Block explorer base for tx links (Arbitrum Sepolia by default, Arbitrum One on mainnet).
const EXPLORER_TX = (Number(process.env.NEXT_PUBLIC_CHAIN_ID) === 42161
  ? 'https://arbiscan.io/tx/'
  : 'https://sepolia.arbiscan.io/tx/');

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
function mapToSeats(state, heroAddr, handleMap = {}, avatarMap = {}, now = Date.now()) {
  if (!state) return Array(9).fill(null);

  const seats = Array(9).fill(null);
  const players = state.players || [];

  players.forEach(p => {
    const idx = p.seatIndex ?? null;
    if (idx == null || idx < 0 || idx > 8) return;
    const isActive = p.addr?.toLowerCase() === state.activeAddr?.toLowerCase();
    const timerPct = isActive && state.turnStartedAt && state.turnTimeoutMs
      ? Math.max(0, Math.min(1, 1 - (now - state.turnStartedAt) / state.turnTimeoutMs))
      : 1;
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
      isActive,
      timerPct,
      lastAction: parseActionLabel(p.actionLabel),
      betAmount:  p.bet || 0,
      isDealer:   p.addr?.toLowerCase() === state.dealerAddr?.toLowerCase(),
    };
  });

  return seats;
}

// ── hero hand panel — hero's own hole cards, shown bigger below the table ──────
function HeroHandPanel({ cards = [], folded = false }) {
  if (!cards.length) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      margin: '20px auto 0', opacity: folded ? 0.45 : 1, transition: 'opacity .3s',
    }}>
      <div style={{ fontSize: 9, color: '#d9c08a99', letterSpacing: 3 }}>YOUR HAND</div>
      <div style={{ display: 'flex', gap: 10 }}>
        {cards.map((c, i) => {
          const cardStr = typeof c === 'string' ? c : c?.card;
          const fd = typeof c === 'object' ? !!c?.faceDown : false;
          return (
            <div key={`${i}-${cardStr || 'fd'}`} className="card-deal" style={{ animationDelay: `${i * 0.12}s` }}>
              <Card card={cardStr} faceDown={fd} width={84} height={118} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── status badge ──────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const color = {
    disconnected: '#555',
    connecting:   '#f0902a',
    connected:    '#f0902a',
    authed:       '#10b981',
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
function ChatPanel({ messages, onSend }) {
  const endRef = useRef(null);
  const [draft, setDraft] = useState('');
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || !onSend) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="glass" style={{ display:'flex', flexDirection:'column', height:'100%',
      overflow:'hidden' }}>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)',
        fontSize:9, color:'#57544b', letterSpacing:2, fontWeight:800 }}>TABLE LOG</div>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 12px',
        display:'flex', flexDirection:'column', gap:2 }}>
        {messages.map((m,i) => (
          <div key={i} style={{
            fontSize:10, padding:'2px 0',
            borderBottom:'1px solid rgba(255,255,255,.03)',
            color: m.type==='system' ? '#57544b'
                 : m.type==='action' ? '#d9c08a'
                 : m.type==='winner' ? '#10b981'
                 : '#918b7e',
            fontFamily: m.type!=='chat' ? "'JetBrains Mono',monospace" : 'inherit',
          }}>
            {m.handle && <span style={{ color:'#807a6d', marginRight:5 }}>{m.handle}:</span>}
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {onSend && (
        <div style={{ display:'flex', gap:6, padding:8, borderTop:'1px solid #232327' }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            maxLength={200}
            placeholder="Say something…"
            style={{
              flex:1, background:'#0f0f11', border:'1px solid #232327', borderRadius:6,
              padding:'6px 10px', color:'#d9d4c7', fontSize:11,
              fontFamily:"'JetBrains Mono',monospace", outline:'none',
            }}
          />
          <button
            className={draft.trim() ? 'btn btn-gold' : 'btn btn-ghost'}
            onClick={submit}
            disabled={!draft.trim()}
            style={{
              padding:'6px 14px', fontSize:9, letterSpacing:1,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
              fontFamily:"'JetBrains Mono',monospace",
              opacity: draft.trim() ? 1 : .5,
            }}
          >SEND</button>
        </div>
      )}
    </div>
  );
}

// ── hand-over overlay ─────────────────────────────────────────────────────────
function HandOverOverlay({ handOver, handleMap = {}, onDismiss }) {
  const [secs, setSecs] = useState(6);
  const identity = handOver?.handNonce ?? 0;

  useEffect(() => {
    if (!handOver) return;
    setSecs(6);
    const iv = setInterval(() => setSecs(s => s - 1), 1000);
    const t  = setTimeout(() => { clearInterval(iv); onDismiss(); }, 6000);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [identity]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!handOver) return null;
  const winners  = handOver.winners || [];
  const results  = handOver.results || [];
  // Non-winners who showed their cards (losers at showdown)
  const losers   = results.filter(r => !winners.includes(r.addr) && r.cards?.length);

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.82)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:200,
    }} onClick={onDismiss}>
      <div className="glass-strong pop-in" style={{
        border:'1px solid var(--border-gold)',
        padding:'28px 36px', textAlign:'center',
        boxShadow:'var(--shadow-md), 0 0 50px rgba(217,192,138,.22)',
        maxWidth: 480, width: '90vw',
      }} onClick={e => e.stopPropagation()}>
        <div className="gold-text" style={{ fontSize:9, letterSpacing:4, marginBottom:12, fontWeight:800 }}>HAND COMPLETE</div>

        {/* Winners */}
        {winners.map((w, i) => {
          const res = results.find(r => r.addr === w);
          const displayName = handleMap[w?.toLowerCase()] || `${w.slice(0,8)}…`;
          return (
            <div key={i} style={{ marginBottom: losers.length ? 16 : 0 }}>
              <div style={{ fontSize:20, color:'#d9c08a', fontWeight:700,
                fontFamily:"'Playfair Display',serif" }}>
                {displayName} wins
              </div>
              {res?.hand && (
                <div style={{ fontSize:11, color:'#d9c08a99', letterSpacing:1, marginTop:2 }}>
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
              <div style={{ fontSize:15, color:'#10b981', fontWeight:700, marginTop:8,
                fontFamily:"'JetBrains Mono',monospace" }}>
                ◈ {handOver.pot?.toLocaleString()}
              </div>
            </div>
          );
        })}

        {/* Losers */}
        {losers.length > 0 && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--border)' }}>
            {losers.map((r, i) => {
              const displayName = handleMap[r.addr?.toLowerCase()] || `${r.addr?.slice(0,8)}…`;
              return (
                <div key={i} style={{ marginBottom: i < losers.length-1 ? 10 : 0 }}>
                  <div style={{ fontSize:10, color:'#726d61', marginBottom:4 }}>
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

        <div style={{ fontSize:9, color:'#57544b', marginTop:14, letterSpacing:1 }}>
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

function SeatPicker({ maxPlayers, takenSeats, pendingSeat, onSelect, onBuyIn, buyInAmount, onBuyInChange, minBuyIn, maxBuyIn, escrowStatus, escrowErrorMsg }) {
  const seats = SEAT_POS.slice(0, maxPlayers);
  const takenMap = Object.fromEntries((takenSeats || []).map(s => [s.seatIndex, s.addr]));
  const fmt = n => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n/1000).toFixed(0)}K` : String(n||0);

  return (
    <div style={{ position:'relative', width:'100%', maxWidth:480, margin:'0 auto' }}>
      {/* Oval table background */}
      <div style={{
        position:'relative', width:'100%', paddingBottom:'70%',
        background:'radial-gradient(ellipse at 45% 38%, #1c1c21 0%, #141418 52%, #0e0e11 100%)',
        border:'2px solid var(--border-gold)', borderRadius:'50%',
        boxShadow:'0 0 40px rgba(16,185,129,.14), inset 0 0 60px rgba(0,0,0,.35)',
      }}>
        {/* Centre label */}
        <div style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)', textAlign:'center',
        }}>
          <div style={{ fontSize:10, color:'#57544b', letterSpacing:2 }}>SELECT A SEAT</div>
          {minBuyIn != null && maxBuyIn != null && minBuyIn !== maxBuyIn ? (
            <div style={{ fontSize:10, color:'#7d786c', marginTop:4 }}>
              {fmt(minBuyIn)}–{fmt(maxBuyIn)} {STAKE_UNIT}
            </div>
          ) : (
            <div style={{ fontSize:13, color:'#d9c08a', fontWeight:700,
              fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>
              {fmt(buyInAmount)} {STAKE_UNIT}
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
                background: isTaken ? '#232327'
                  : isSelected ? 'linear-gradient(135deg,#2b2b31,#242428)'
                  : '#121215',
                border: `2px solid ${isTaken ? '#3a3a41' : isSelected ? '#d9c08a' : '#57544b'}`,
                cursor: isTaken ? 'default' : 'pointer',
                display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'center',
                transition:'all .15s',
                boxShadow: isSelected ? '0 0 14px rgba(217,192,138,.5)' : 'none',
              }}
            >
              {isTaken ? (
                <>
                  <div style={{ fontSize:9, color:'#7d786c' }}>●</div>
                  <div style={{ fontSize:7, color:'#57544b', marginTop:1 }}>
                    {addr?.slice(2,6)}
                  </div>
                </>
              ) : (
                <div style={{ fontSize:11, color: isSelected ? '#d9c08a' : '#57544b', fontWeight:700 }}>
                  {i+1}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Buy-in panel */}
      {pendingSeat !== null && (
        <div className="glass-strong pop-in" style={{
          marginTop:16, border:'1px solid var(--border-gold)',
          padding:'16px 20px', display:'flex', flexDirection:'column', gap:12,
        }}>
          <div style={{ fontSize:10, color:'#57544b', letterSpacing:1 }}>SEAT {pendingSeat + 1} — BUY IN</div>
          {minBuyIn != null && maxBuyIn != null && minBuyIn !== maxBuyIn && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <input
                type="range"
                min={minBuyIn} max={maxBuyIn} step={minBuyIn}
                value={buyInAmount}
                onChange={e => onBuyInChange(Number(e.target.value))}
                style={{ accentColor:'#d9c08a', width:'100%' }}
              />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#57544b' }}>
                <span>{fmt(minBuyIn)}</span>
                <span style={{ color:'#d9c08a', fontWeight:700, fontFamily:"'JetBrains Mono',monospace", fontSize:13 }}>
                  {fmt(buyInAmount)} {STAKE_UNIT}
                </span>
                <span>{fmt(maxBuyIn)}</span>
              </div>
            </div>
          )}
          {(minBuyIn == null || minBuyIn === maxBuyIn) && (
            <div style={{ fontSize:13, color:'#d9c08a', fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>
              {fmt(buyInAmount)} {STAKE_UNIT}
            </div>
          )}
          <button
            className={(escrowStatus !== 'idle' && escrowStatus !== 'error') ? 'btn btn-ghost' : 'btn btn-gold'}
            onClick={() => onBuyIn(pendingSeat)}
            disabled={escrowStatus !== 'idle' && escrowStatus !== 'error'}
            style={{
              padding:'10px 20px', cursor: (escrowStatus !== 'idle' && escrowStatus !== 'error') ? 'not-allowed' : 'pointer',
              fontSize:12, fontFamily:'inherit', alignSelf:'flex-end',
            }}
          >
            {escrowStatus === 'approving' ? 'Approving…'
             : escrowStatus === 'buying'  ? 'Buying In…'
             : escrowStatus === 'error'   ? 'Retry Buy In →'
             : 'Buy In →'}
          </button>
          {escrowStatus === 'error' && escrowErrorMsg && (
            <div style={{ fontSize:10, color:'#e0473b' }}>{escrowErrorMsg}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── confirm modal (replaces window.confirm which is broken in mobile WebViews) ─
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.75)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:400,
      padding:16,
    }}>
      <div className="glass-strong pop-in" style={{
        padding:'24px 20px',
        width:'100%', maxWidth:340, textAlign:'center',
      }}>
        <div style={{ fontSize:12, color:'#9d9789', lineHeight:1.6, marginBottom:20 }}>
          {message}
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-ghost" onClick={onCancel} style={{
            flex:1, padding:'12px', fontSize:12,
          }}>Stay</button>
          <button onClick={onConfirm} style={{
            flex:1, background:'linear-gradient(135deg,#3a0f0f,#1f0707)',
            border:'1px solid #7a2a2a', borderRadius:8, padding:'12px',
            cursor:'pointer', color:'#f0675a', fontSize:12,
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
  const [botCount, setBotCount] = useState(1);

  const { buyIn, rebuy, cashOut, refund, status: escrowStatus, tableInfo, rebuyError, errorMsg: escrowErrorMsg } = useEscrow(id);
  const { isHuman, refetchIsHuman } = useWallet();

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
    buyIn:      fromEscrowUnits(tableInfo.buyIn ?? tableInfo.buyInAmount ?? tableInfo[1]),
    bigBlind:   fromEscrowUnits(tableInfo.bigBlind ?? tableInfo[2]),
    maxPlayers: Number(tableInfo.maxPlayers),
    gameType:   Number(tableInfo.gameType),
  } : null);

  const {
    gameState, handOver, wsStatus, wsError,
    cashoutSig, setCashoutSig,
    cashoutRelay,
    cashoutLocked, tableLocked, refundAvailable,
    seatPickerData, needsRebuy,
    sendAction, extendTurn, leaveTable, sendRebuyConfirmed, joinWithSeat, spawnBot, botStatus,
    chatMessages, sendChat,
    verifyStatus, verifyFailures, sendVerifyHuman,
  } = useTableSocket(id, tableConfig);

  // Poker-room sound effects driven by live game-state transitions
  useGameSounds(gameState, handOver, address);

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

  // Merge incoming chat into the log so it interleaves with action/winner entries
  const seenChatRef = useRef(0);
  useEffect(() => {
    if (chatMessages.length <= seenChatRef.current) return;
    const fresh = chatMessages.slice(seenChatRef.current);
    seenChatRef.current = chatMessages.length;
    setLog(prev => [...prev.slice(-60), ...fresh.map(c => ({
      type: 'chat',
      handle: handleMap[c.addr?.toLowerCase()] || `${c.addr.slice(0,6)}…`,
      text: c.text,
    }))]);
  }, [chatMessages, handleMap]);

  // Derive hero state
  const heroPlayer = useMemo(() =>
    gameState?.players?.find(p => p.addr?.toLowerCase() === address?.toLowerCase()),
    [gameState, address]
  );
  const isHeroTurn = heroPlayer && !heroPlayer.folded &&
    gameState?.activeAddr?.toLowerCase() === address?.toLowerCase();
  const heroBustedOut = !heroPlayer && !!address &&
    needsRebuy?.busted?.some(a => a?.toLowerCase() === address.toLowerCase());
  const heroCards = useMemo(() =>
    (heroPlayer?.hand || []).map(c => c === '??' ? { faceDown: true } : c),
    [heroPlayer]
  );

  const callAmount = isHeroTurn
    ? Math.max(0, (gameState?.maxBet || 0) - (heroPlayer?.bet || 0))
    : 0;
  const canCheck   = isHeroTurn && callAmount === 0;
  const bigBlind   = gameState?.config?.bigBlind || 100;
  const minRaise   = Math.max(bigBlind, gameState?.lastRaiseAmount || bigBlind);

  // Tick while a hand is live so the per-seat turn timer ring animates smoothly,
  // independent of GAME_STATE updates (which only arrive when someone acts).
  const turnInProgress = !!gameState?.activeAddr && gameState.phase !== 'waiting' && gameState.phase !== 'showdown';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!turnInProgress) return;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [turnInProgress]);

  const seats = useMemo(() => mapToSeats(gameState, address, handleMap, avatarMap, now), [gameState, address, handleMap, avatarMap, now]);

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
    const tx = await cashOut(address, cashoutSig.amount, cashoutSig.nonce, cashoutSig.sig);
    if (!tx) return; // failed — keep cashoutSig so the player can retry instead of losing their payout
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
      const tx = await refund();
      if (!tx) return; // failed — stay put so the player can retry instead of silently losing the deposit
    }
    router.push('/');
  }, [refund, router]);

  const handleBuyIn = useCallback(async (seatIndex) => {
    const amount = selectedBuyIn
      || tableConfig?.buyIn
      || (tableInfo?.buyInAmount ? fromEscrowUnits(tableInfo.buyInAmount) : 0);
    if (!amount) return;
    const tx = await buyIn(amount);
    if (!tx) return; // failed — don't tell the server we're seated with no on-chain deposit
    joinWithSeat(seatIndex, amount);
  }, [buyIn, joinWithSeat, selectedBuyIn, tableConfig, tableInfo]);

  const maxBots = Math.max(1, (gameState?.config?.maxPlayers || tableConfig?.maxPlayers || 6) - 1);
  const botControlsDisabled = botStatus === 'spawning' || botStatus === 'seated' || botStatus === 'already_seated';

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)', display:'flex', flexDirection:'column' }}>
      <WalletBar />

      {/* Human verification banner — shown when wallet connected but not yet verified */}
      {mounted && address && isHuman === false && (
        <VerifyHumanBanner
          status={verifyStatus}
          failures={verifyFailures}
          onVerify={sendVerifyHuman}
          onVerified={refetchIsHuman}
          wsReady={wsStatus === 'authed'}
        />
      )}

      {/* Breadcrumb + status */}
      <div className="glass" style={{
        padding:'9px 16px', borderRadius:0, borderTop:'none', borderLeft:'none', borderRight:'none',
        display:'flex', alignItems:'center', gap:8, fontSize:10, color:'#57544b',
      }}>
        <Link href="/" onClick={e => {
          // Block navigation while connecting/authing (heroPlayer may not be set yet)
          if (wsStatus !== 'disconnected') {
            e.preventDefault();
            if (heroPlayer) setShowLeaveConfirm(true);
          }
        }} style={{ color:'#57544b', textDecoration:'none' }}>Lobby</Link>
        <span>›</span>
        <span style={{ color:'#8a8478' }}>
          Table #{id}
          {gameState?.config && <span className="gold-text" style={{ fontWeight:700 }}> · {(gameState.config.bigBlind/2).toLocaleString()}/{gameState.config.bigBlind.toLocaleString()} {STAKE_UNIT}</span>}
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
          justifyContent: isMobile ? 'center' : 'flex-start',
          padding:'24px 16px 100px',
          overflowY:'auto', position:'relative',
        }}>
          {/* Connecting placeholder */}
          {wsStatus === 'disconnected' && !gameState && !seatPickerData && (
            <div className="pop-in" style={{
              position:'absolute', top:'50%', left:'50%',
              transform:'translate(-50%,-50%)',
              textAlign:'center', color:'#57544b', fontSize:12,
            }}>
              <div className="gold-text" style={{ fontSize:40, marginBottom:14,
                filter:'drop-shadow(0 0 18px rgba(217,192,138,.35))' }}>♠</div>
              <div style={{ letterSpacing:1 }}>Connecting to game server…</div>
              {wsError && <div style={{ color:'#e0473b', marginTop:8, fontSize:11 }}>{wsError}</div>}
            </div>
          )}

          {/* Waiting for players — prominent banner in main area */}
          {gameState?.phase === 'waiting' && heroPlayer && (
            <div className="glass-strong pop-in" style={{
              padding:'22px 24px', marginBottom:16, textAlign:'center',
              boxShadow:'var(--shadow-md), 0 0 28px rgba(16,185,129,.1)',
            }}>
              <div className="gold-text" style={{ fontSize:26, marginBottom:8 }}>♠</div>
              <div style={{ fontSize:15, color:'#10b981', fontWeight:700,
                fontFamily:"'Playfair Display',serif", marginBottom:6 }}>
                You're at the table!
              </div>
              <div style={{ fontSize:11, color:'#8a8478', marginBottom:12 }}>
                {gameState.players.length < 2
                  ? `Waiting for ${2 - gameState.players.length} more player to start (${gameState.players.length}/${gameState.config?.maxPlayers || 2} seated)`
                  : `${gameState.players.length}/${gameState.config?.maxPlayers || 2} seated — starting soon…`}
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
                <button
                  className="btn btn-emerald"
                  onClick={() => {
                    navigator.clipboard?.writeText(window.location.href).catch(() => {});
                    alert('Table link copied!\n\n' + window.location.href + '\n\nShare this with your opponent.');
                  }}
                  style={{ padding:'10px 20px', fontSize:11, letterSpacing:1 }}
                >
                  COPY & SHARE TABLE LINK
                </button>
                <button
                  onClick={() => setBotCount(c => Math.max(1, c - 1))}
                  disabled={botControlsDisabled}
                  style={{
                    width:28, background:'#0c1e2e', border:'1px solid #4a7aaa66', borderRadius:8,
                    padding:'10px 0', color:'#7ab4e0', fontSize:13, fontFamily:'inherit',
                    fontWeight:700, cursor: botControlsDisabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={maxBots}
                  value={botCount}
                  onChange={e => setBotCount(Math.max(1, Math.min(maxBots, Number(e.target.value) || 1)))}
                  disabled={botControlsDisabled}
                  style={{
                    width:44, background:'#0c1e2e', border:'1px solid #4a7aaa66', borderRadius:8,
                    padding:'10px 6px', color:'#7ab4e0', fontSize:11, fontFamily:'inherit',
                    fontWeight:700, textAlign:'center',
                  }}
                />
                <button
                  onClick={() => setBotCount(c => Math.min(maxBots, c + 1))}
                  disabled={botControlsDisabled}
                  style={{
                    width:28, background:'#0c1e2e', border:'1px solid #4a7aaa66', borderRadius:8,
                    padding:'10px 0', color:'#7ab4e0', fontSize:13, fontFamily:'inherit',
                    fontWeight:700, cursor: botControlsDisabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  +
                </button>
                <button
                  className={botStatus === 'seated' || botStatus === 'already_seated' ? 'btn btn-emerald' : 'btn btn-ghost'}
                  onClick={() => spawnBot(undefined, botCount)}
                  disabled={botControlsDisabled}
                  style={{
                    padding:'10px 20px',
                    cursor: botStatus === 'spawning' || botStatus === 'seated' || botStatus === 'already_seated'
                      ? 'not-allowed' : 'pointer',
                    color: botStatus === 'error' ? '#f0675a' : undefined,
                    fontSize:11, letterSpacing:1,
                    opacity: botStatus === 'spawning' ? 0.7 : 1,
                  }}
                >
                  {botStatus === 'spawning'     ? '⏳ Spawning…'
                   : botStatus === 'seated'     ? '✓ Bot Seated'
                   : botStatus === 'already_seated' ? '✓ Bot Ready'
                   : botStatus === 'error'      ? '✗ Failed'
                   : '+ Spawn Bots'}
                </button>
              </div>
              <div style={{ fontSize:9, color:'#57544b', marginTop:10, letterSpacing:1 }}>
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
              escrowErrorMsg={escrowErrorMsg}
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

          <HeroHandPanel cards={heroCards} folded={!!heroPlayer?.folded} />

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
            onFold={() => { playSfx('fold'); sendAction('fold'); }}
            onCheck={() => { playSfx('check'); sendAction('check'); }}
            onCall={() => { playSfx('chip'); sendAction('call'); }}
            onRaise={amt => { playSfx('chip'); sendAction('raise', amt); }}
            onAllIn={() => { playSfx('allin'); sendAction('allin'); }}
            onExtendTurn={extendTurn}
            turnExtended={!!gameState?.turnExtended}
          />
        </div>

        {/* Side panel — desktop: right column; mobile: slide-up bottom drawer */}
        <div className="table-side-panel" style={{
          display:'flex', flexDirection:'column', gap:8,
          padding:'16px 12px 16px 0',
          borderLeft:'1px solid #232327',
          background:'rgba(0,0,0,.2)',
          overflowY:'auto',
          ...(isMobile ? {
            position:'fixed', left:0, right:0, bottom:0,
            maxHeight:'72vh',
            padding:'8px 12px calc(16px + env(safe-area-inset-bottom))',
            borderLeft:'none', borderTop:'1px solid var(--gold-dim)',
            borderRadius:'16px 16px 0 0',
            background:'linear-gradient(160deg, rgba(22,22,26,.92), rgba(11,11,13,.96))',
            backdropFilter:'blur(18px)', WebkitBackdropFilter:'blur(18px)',
            boxShadow:'0 -8px 30px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.04)',
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
                background:'#57544b', margin:'0 auto' }} />
            </div>
          )}

          {/* Player stacks */}
          <div className="glass" style={{ overflow:'hidden', flexShrink:0 }}>
            <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)',
              fontSize:9, color:'#57544b', letterSpacing:2, fontWeight:800 }}>STACKS</div>
            <div style={{ padding:'6px' }}>
              {(gameState?.players || []).map((p, i) => (
                <div key={i} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'5px 8px', borderRadius:4,
                  background: p.addr === gameState?.activeAddr ? 'rgba(217,192,138,.07)' : 'transparent',
                  opacity: p.folded ? 0.4 : 1,
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:8, height:8, borderRadius:'50%',
                      background: p.addr === gameState?.activeAddr ? '#d9c08a' : '#232327' }} />
                    <span style={{
                      fontSize:10, maxWidth:100,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      color: p.addr?.toLowerCase() === address?.toLowerCase() ? '#d9c08a' : '#9d9789',
                    }}>
                      {p.addr?.toLowerCase() === address?.toLowerCase()
                        ? 'You'
                        : handleMap[p.addr?.toLowerCase()]}
                    </span>
                    {p.allIn && <span style={{ fontSize:7, color:'#f0902a',
                      border:'1px solid #f0902a44', borderRadius:2, padding:'0 3px' }}>AI</span>}
                  </div>
                  <span style={{ fontSize:10, color:'#d9c08a',
                    fontFamily:"'JetBrains Mono',monospace" }}>
                    ◈{((p.chips||0)/1000).toFixed(1)}K
                  </span>
                </div>
              ))}
              {(!gameState || !gameState.players?.length) && (
                <div style={{ padding:'12px 8px', fontSize:10, color:'#232327', textAlign:'center' }}>
                  Waiting for players…
                </div>
              )}
            </div>
          </div>

          {/* Waiting status compact badge */}
          {gameState?.phase === 'waiting' && heroPlayer && (
            <div className="pill" style={{
              border:'1px solid #10b98144', color:'#10b981',
              justifyContent:'center', width:'100%',
            }}>
              <span className="dot-live" /> WAITING — {gameState.players.length}/{gameState.config?.maxPlayers} seated
            </div>
          )}

          {/* Table log */}
          <div style={{ flex:1, minHeight:180 }}>
            <ChatPanel messages={log} onSend={sendChat} />
          </div>

          {/* Phase indicator */}
          {gameState?.phase && gameState.phase !== 'waiting' && (
            <div className="glass" style={{
              padding:'8px 12px', display:'flex', justifyContent:'space-between',
              alignItems:'center',
            }}>
              <span style={{ fontSize:9, color:'#57544b', letterSpacing:1 }}>STREET</span>
              <span style={{ fontSize:11, color:'#d9c08a', fontWeight:700, letterSpacing:2,
                fontFamily:"'JetBrains Mono',monospace" }}>
                {gameState.phase.toUpperCase()}
              </span>
            </div>
          )}

          {/* Sponsored cashout — server covered the gas; player just watches it land */}
          {cashoutRelay && (
            <div className="glass-strong pop-in" style={{ border:'1px solid var(--border-gold)', padding:'12px' }}>
              <div className="gold-text" style={{ fontSize:9, letterSpacing:1, marginBottom:6, fontWeight:800 }}>
                {HYPE_UI ? (cashoutRelay.status === 'confirmed' ? 'TEST HYPE CREDIT AVAILABLE TO CLAIM' : 'TEST HYPE EXIT PROCESSING') : (cashoutRelay.status === 'confirmed' ? 'WITHDRAWAL COMPLETE' : 'WITHDRAWAL SPONSORED — GAS ON US ⛽')}
              </div>
              <div className="gold-text" style={{ fontSize:16, fontWeight:700,
                fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>
                ◈ {Number(cashoutRelay.amount).toLocaleString()}
              </div>
              <div style={{ fontSize:10, color:'var(--text-secondary)', marginBottom:8, lineHeight:1.5 }}>
                {HYPE_UI ? (cashoutRelay.status === 'confirmed' ? 'Your test HYPE is credited in escrow, NOT yet in your wallet. Claim it on the testnet escrow page.' : 'The testnet exit is processing, not yet a wallet payout.') : (cashoutRelay.status === 'confirmed' ? 'Sent to your wallet — you paid zero gas.' : 'On the way to your wallet — no gas, no signature needed.')}
                {!HYPE_UI && cashoutRelay.txHash && (
                  <> <a href={`${EXPLORER_TX}${cashoutRelay.txHash}`} target="_blank" rel="noreferrer"
                       className="gold-text" style={{ textDecoration:'underline' }}>View transaction ↗</a></>
                )}
              </div>
              <button className="btn btn-gold" onClick={() => router.push('/')}
                style={{ width:'100%', padding:'10px', fontSize:11, cursor:'pointer' }}>
                {HYPE_UI && cashoutRelay.status === 'confirmed' ? 'Back to Lobby (HYPE credit not claimed)' : cashoutRelay.status === 'confirmed' ? 'Back to Lobby' : 'Back to Lobby (payout still processing)'}
              </button>
            </div>
          )}

          {HYPE_UI && cashoutRelay?.status === 'confirmed' && (
            <Link href="/hype-staging" className="btn btn-emerald" style={{display:'block',textAlign:'center',padding:'10px',marginTop:8}}>
              Claim credited test HYPE on the escrow page — not paid to wallet until claimed
            </Link>
          )}
                    {/* Cashout banner — self-submit fallback when sponsorship is off or a sponsored tx reverted */}
          {cashoutSig && !cashoutRelay && (
            <div className="glass-strong pop-in" style={{ border:'1px solid var(--border-gold)', padding:'12px' }}>
              <div className="gold-text" style={{ fontSize:9, letterSpacing:1, marginBottom:6, fontWeight:800 }}>READY TO WITHDRAW</div>
              <div className="gold-text" style={{ fontSize:16, fontWeight:700,
                fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>
                ◈ {Number(cashoutSig.amount).toLocaleString()}
              </div>
              <button className="btn btn-gold" onClick={handleCashOut}
                disabled={escrowStatus !== 'idle' && escrowStatus !== 'error'}
                style={{ width:'100%', padding:'10px', fontSize:11,
                  cursor: (escrowStatus !== 'idle' && escrowStatus !== 'error') ? 'not-allowed' : 'pointer' }}>
                {escrowStatus === 'cashout' ? 'Withdrawing…'
                 : escrowStatus === 'error' ? 'Retry — Claim test HYPE + Leave'
                 : (HYPE_UI ? 'Claim test HYPE + Leave' : 'Claim Chips + Leave')}
              </button>
              {escrowStatus === 'error' && escrowErrorMsg && (
                <div style={{ fontSize:10, color:'#e0473b', marginTop:6 }}>{escrowErrorMsg}</div>
              )}
            </div>
          )}

          {/* Rebuy section — shown when low on chips, or fully busted out of the table */}
          {mounted && gameState && (heroBustedOut || (heroPlayer && heroPlayer.chips < gameState.config?.buyIn)) && (
            <div>
              {heroBustedOut && (
                <div style={{ fontSize:10, color:'#f0902a', marginBottom:6 }}>
                  You're out of chips — rebuy to keep playing.
                </div>
              )}
              {!showRebuy ? (
                <button className="btn btn-emerald" onClick={() => setShowRebuy(true)} style={{
                  width:'100%', padding:'8px', fontSize:11,
                }}>
                  + Rebuy
                </button>
              ) : (
                <div style={{ display:'flex', gap:4 }}>
                  <input className="glass" type="number" value={rebuyAmt} onChange={e => setRebuyAmt(e.target.value)}
                    placeholder="Amount"
                    style={{ flex:1, padding:'6px 8px', color:'var(--gold)', fontSize:11,
                      fontFamily:"'JetBrains Mono',monospace", outline:'none' }} />
                  <button className="btn btn-emerald" onClick={handleRebuy}
                    disabled={escrowStatus !== 'idle' && escrowStatus !== 'error'}
                    style={{ padding:'6px 12px', fontSize:11 }}>
                    {(escrowStatus !== 'idle' && escrowStatus !== 'error') ? '…' : 'OK'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setShowRebuy(false)}
                    style={{ padding:'6px 10px', fontSize:11 }}>✕</button>
                </div>
              )}
              {rebuyError && (
                <div style={{ fontSize:10, color:'#e0473b', marginTop:6 }}>{rebuyError}</div>
              )}
            </div>
          )}

          {/* Creator lock notice */}
          {tableLocked && mounted && address?.toLowerCase() === gameState?.creator?.toLowerCase() && (
            <div style={{
              background:'rgba(230,126,34,.08)', border:'1px solid #f0902a44',
              borderRadius:8, padding:'10px 12px', fontSize:10, color:'#f0902a', lineHeight:1.5,
            }}>
              🔒 Table locked — a player must play 7 hands or all others must leave before you can close this table.
            </div>
          )}

          {/* Refund available (table not yet active) */}
          {refundAvailable && !cashoutSig && !cashoutRelay && (
            <div>
              <div style={{ fontSize:9, color:'#d9c08a99', letterSpacing:1, marginBottom:6 }}>
                You left the waiting room
              </div>
              <button className="btn btn-gold" onClick={handleRefund}
                disabled={escrowStatus !== 'idle' && escrowStatus !== 'error'} style={{
                width:'100%', padding:'8px', fontSize:11,
                cursor: (escrowStatus !== 'idle' && escrowStatus !== 'error') ? 'not-allowed' : 'pointer',
              }}>
                {escrowStatus === 'error' ? 'Retry — Return to Lobby'
                 : escrowStatus !== 'idle' ? 'Processing…'
                 : 'Return to Lobby'}
              </button>
              {escrowStatus === 'error' && escrowErrorMsg && (
                <div style={{ fontSize:10, color:'#e0473b', marginTop:6 }}>{escrowErrorMsg}</div>
              )}
            </div>
          )}

          {/* Leave — locked badge or button */}
          {!cashoutSig && !cashoutRelay && !refundAvailable && (
            cashoutLocked ? (
              <div style={{
                background:'rgba(240,144,42,.08)', border:'1px solid #f0902a44',
                borderRadius:6, padding:'8px 12px', textAlign:'center',
                fontSize:11, color:'#f0902a', fontWeight:700,
              }}>
                🔒 Locked — {cashoutLocked.handsRemaining} hand{cashoutLocked.handsRemaining !== 1 ? 's' : ''} remaining
              </div>
            ) : (
              <button className="btn btn-ghost" onClick={handleLeave} style={{
                padding:'8px', fontSize:11, transition:'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color='#f0675a'; e.currentTarget.style.borderColor='#e0473b'; }}
              onMouseLeave={e => { e.currentTarget.style.color=''; e.currentTarget.style.borderColor=''; }}>
                Leave Table
              </button>
            )
          )}
        </div>
      </div>

      {/* Mobile: floating pill toggle (clear 58px header) or tap-to-close backdrop */}
      {isMobile && (drawerOpen
        ? <div onClick={() => setDrawerOpen(false)} style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:145,
          }} />
        : <button className="pill" onClick={() => setDrawerOpen(true)} style={{
            position:'fixed', top:58, right:10, zIndex:140,
            borderColor:'var(--gold-dim)', padding:'7px 16px', cursor:'pointer',
            color:'var(--gold)', fontSize:11, fontWeight:700, fontFamily:'inherit',
            letterSpacing:1, boxShadow:'0 2px 10px rgba(0,0,0,.5)',
          }}>
            ☰ Stacks &amp; Log
          </button>
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
