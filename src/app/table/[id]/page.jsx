'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import WalletBar from '../../../components/WalletBar';
import PokerTable from '../../../components/PokerTable';
import BettingControls from '../../../components/BettingControls';
import { useTableSocket } from '../../../hooks/usePokerWallet';
import { useAccount } from 'wagmi';

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

// ── map server pubState → PokerTable seats array ──────────────────────────────
function mapToSeats(state, heroAddr) {
  if (!state) return Array(9).fill(null);

  const players = state.players || [];
  // Rotate so hero is always at index 0 (bottom of oval)
  const heroIdx = players.findIndex(p => p.addr?.toLowerCase() === heroAddr?.toLowerCase());
  const rotated = heroIdx >= 0
    ? [...players.slice(heroIdx), ...players.slice(0, heroIdx)]
    : players;

  // Fill up to 9 seats
  const seats = rotated.map(p => ({
    player: {
      address: p.addr,
      chips:   p.chips,
      isHero:  p.addr?.toLowerCase() === heroAddr?.toLowerCase(),
      isFolded: p.folded,
      isAllIn:  p.allIn,
    },
    cards: (p.hand || []).map(c => c === '??' ? { faceDown: true } : c),
    isActive: p.addr?.toLowerCase() === state.activeAddr?.toLowerCase(),
    lastAction: parseActionLabel(p.actionLabel),
    betAmount:  p.bet || 0,
    isDealer:   p.addr?.toLowerCase() === state.dealerAddr?.toLowerCase(),
  }));

  while (seats.length < 9) seats.push(null);
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
  const endRef = { current: null };
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); });
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
function HandOverOverlay({ handOver, onDismiss }) {
  if (!handOver) return null;
  const winners = handOver.winners || [];
  const results = handOver.results || [];
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.7)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:200,
    }} onClick={onDismiss}>
      <div style={{
        background:'linear-gradient(135deg,#0a1f0a,#060e06)',
        border:'1px solid #d4af37', borderRadius:16,
        padding:'32px 48px', textAlign:'center',
        boxShadow:'0 0 40px rgba(212,175,55,.3)',
        animation:'fade-in .4s ease forwards',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:9, color:'#d4af3799', letterSpacing:4, marginBottom:8 }}>HAND COMPLETE</div>
        {winners.map((w, i) => {
          const res = results.find(r => r.addr === w);
          return (
            <div key={i}>
              <div style={{ fontSize:22, color:'#d4af37', fontWeight:700,
                fontFamily:"'Playfair Display',serif" }}>
                {w.slice(0,8)}…
              </div>
              {res?.hand && (
                <div style={{ fontSize:12, color:'#d4af3777', letterSpacing:1, marginTop:4 }}>
                  {res.hand}
                </div>
              )}
              <div style={{ fontSize:16, color:'#27ae60', fontWeight:700, marginTop:4,
                fontFamily:"'JetBrains Mono',monospace" }}>
                ◈ {handOver.pot?.toLocaleString()}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize:9, color:'#3a6a3a', marginTop:16, letterSpacing:1 }}>
          Click to continue
        </div>
      </div>
    </div>
  );
}

// ── main table page ───────────────────────────────────────────────────────────
export default function TablePage() {
  const { id }   = useParams();
  const router   = useRouter();
  const { address } = useAccount();

  const { gameState, handOver, wsStatus, wsError, sendAction, leaveTable } = useTableSocket(id);

  const [log, setLog] = useState([
    { type:'system', text:`Joined table ${id}` },
  ]);
  const [showHandOver, setShowHandOver] = useState(false);

  // Append server events to the log
  useEffect(() => {
    if (!gameState) return;
    const acted = gameState.players?.find(p => p.actionLabel && !p.folded);
    if (acted) {
      setLog(prev => {
        const last = prev[prev.length - 1];
        const entry = { type:'action', text:`${acted.addr.slice(0,8)}… ${acted.actionLabel}` };
        if (last?.text === entry.text) return prev;
        return [...prev.slice(-60), entry];
      });
    }
  }, [gameState]);

  useEffect(() => {
    if (!handOver) return;
    setShowHandOver(true);
    const names = handOver.winners?.map(w => w.slice(0,8)+'…').join(', ') || '?';
    setLog(prev => [...prev.slice(-60), {
      type: 'winner',
      text: `Winner: ${names}  ◈${handOver.pot?.toLocaleString()}  (${handOver.results?.[0]?.hand || ''})`,
    }]);
  }, [handOver]);

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
  const minRaise   = bigBlind * 2;

  const seats = useMemo(() => mapToSeats(gameState, address), [gameState, address]);

  const handleLeave = useCallback(() => {
    leaveTable();
    router.push('/');
  }, [leaveTable, router]);

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)', display:'flex', flexDirection:'column' }}>
      <WalletBar />

      {/* Breadcrumb + status */}
      <div style={{
        padding:'8px 16px', borderBottom:'1px solid #1a3a1a',
        display:'flex', alignItems:'center', gap:8, fontSize:10, color:'#3a6a3a',
      }}>
        <Link href="/" style={{ color:'#3a6a3a', textDecoration:'none' }}>Lobby</Link>
        <span>›</span>
        <span style={{ color:'#6a9a6a' }}>
          Table #{id}
          {gameState?.config && ` · ${(gameState.config.bigBlind/2).toLocaleString()}/${gameState.config.bigBlind.toLocaleString()} CHIPS`}
        </span>
        <div style={{ marginLeft:'auto' }}><StatusDot status={wsStatus} /></div>
      </div>

      {/* Layout */}
      <div style={{
        flex:1, display:'grid', gridTemplateColumns:'1fr 260px',
        overflow:'hidden',
      }}>

        {/* Table area */}
        <div style={{
          display:'flex', flexDirection:'column',
          padding:'24px 16px 100px',
          overflowY:'auto', position:'relative',
        }}>
          {/* No-server placeholder */}
          {wsStatus === 'disconnected' && !gameState && (
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

        {/* Side panel */}
        <div style={{
          display:'flex', flexDirection:'column', gap:8,
          padding:'16px 12px 16px 0',
          borderLeft:'1px solid #1a3a1a',
          background:'rgba(0,0,0,.2)',
          overflowY:'auto',
        }}>
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

          {/* Leave */}
          <button onClick={handleLeave} style={{
            background:'transparent', border:'1px solid #3a1a1a',
            borderRadius:6, padding:'8px', cursor:'pointer',
            color:'#6a4a4a', fontSize:11, fontFamily:'inherit', transition:'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color='#e74c3c'; e.currentTarget.style.borderColor='#c0392b'; }}
          onMouseLeave={e => { e.currentTarget.style.color='#6a4a4a'; e.currentTarget.style.borderColor='#3a1a1a'; }}>
            Leave Table
          </button>
        </div>
      </div>

      <HandOverOverlay
        handOver={showHandOver ? handOver : null}
        onDismiss={() => setShowHandOver(false)}
      />
    </div>
  );
}
