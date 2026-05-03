'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import WalletBar from '../../../components/WalletBar';
import PokerTable from '../../../components/PokerTable';
import BettingControls from '../../../components/BettingControls';

// ── mock game state for UI dev ─────────────────────────────────────────────
function makeMockState(heroAddress) {
  return {
    tableId: 1,
    tableName: 'High Rollers',
    bigBlind: 200,
    gameType: 0,
    street: 'flop',
    pot: 12400,
    sidePots: [],
    communityCards: ['AH', 'KS', '7D'],
    seats: [
      { player: { address: heroAddress || '0xDEAD', handle: 'You', chips: 18200, isHero: true }, cards: ['QH','QD'], isActive: true,  timerPct: 0.6, lastAction: null,    betAmount: 400, isDealer: false },
      { player: { address: '0xAAAA', handle: 'shark99',  chips: 31000 }, cards: [{faceDown:true},{faceDown:true}], isActive: false, lastAction: 'call',  betAmount: 400, isDealer: false },
      { player: { address: '0xBBBB', handle: 'CryptoKing', chips: 5200 }, cards: [{faceDown:true},{faceDown:true}], isActive: false, lastAction: 'fold',  betAmount: 0,   isDealer: false, isFolded: true },
      { player: { address: '0xCCCC', handle: 'alice.eth', chips: 22000 }, cards: [{faceDown:true},{faceDown:true}], isActive: false, lastAction: 'raise', betAmount: 800, isDealer: true  },
      null, null, null, null, null,
    ],
    activePlayer: 0,
    winners: [],
  };
}

function ChatMessage({ msg }) {
  const isSystem = msg.type === 'system';
  const isAction = msg.type === 'action';
  return (
    <div style={{
      fontSize: 11,
      color: isSystem ? '#3a6a3a' : isAction ? '#d4af37' : '#8aaa8a',
      padding: '2px 0',
      borderBottom: '1px solid rgba(255,255,255,.03)',
      fontFamily: isSystem || isAction ? "'JetBrains Mono', monospace" : 'inherit',
    }}>
      {!isSystem && (
        <span style={{ color: '#5a9a5a', marginRight: 6 }}>
          {msg.handle || msg.address?.slice(0,8) || 'anon'}:
        </span>
      )}
      {msg.text}
    </div>
  );
}

function ChatPanel({ messages, onSend }) {
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: '#060e06',
      border: '1px solid #1a3a1a', borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a3a1a',
        fontSize: 9, color: '#3a6a3a', letterSpacing: 2 }}>
        TABLE CHAT
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {messages.map((m, i) => <ChatMessage key={i} msg={m} />)}
        <div ref={endRef} />
      </div>
      <form onSubmit={e => { e.preventDefault(); if (input.trim()) { onSend(input.trim()); setInput(''); } }}
        style={{ padding: '8px', borderTop: '1px solid #1a3a1a', display: 'flex', gap: 6 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Say something…"
          maxLength={120}
          style={{
            flex: 1, background: '#0c1e0c', border: '1px solid #1a3a1a',
            borderRadius: 4, padding: '5px 8px',
            color: '#d0c8b0', fontSize: 11, fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button type="submit" style={{
          background: '#1a3a1a', border: '1px solid #2a5a2a', borderRadius: 4,
          padding: '5px 10px', cursor: 'pointer', color: '#6a9a6a', fontSize: 11,
        }}>↵</button>
      </form>
    </div>
  );
}

function HandHistory({ hands = [] }) {
  return (
    <div style={{
      background: '#060e06', border: '1px solid #1a3a1a', borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a3a1a',
        fontSize: 9, color: '#3a6a3a', letterSpacing: 2 }}>
        HAND HISTORY
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hands.length === 0 && (
          <div style={{ fontSize: 10, color: '#1a3a1a', textAlign: 'center', padding: '12px 0' }}>
            No hands yet
          </div>
        )}
        {hands.map((h, i) => (
          <div key={i} style={{
            fontSize: 10, color: '#6a9a6a', display: 'flex', justifyContent: 'space-between',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span>#{h.nonce} {h.winner}</span>
            <span style={{ color: '#d4af37' }}>+◈{h.amount?.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TablePage() {
  const { id } = useParams();
  const router = useRouter();

  const [gameState, setGameState] = useState(() => makeMockState('0xDEAD'));
  const [chat, setChat] = useState([
    { type: 'system', text: 'Table started. Good luck!' },
    { type: 'action', text: 'shark99 called 400' },
    { type: 'action', text: 'CryptoKing folded' },
    { type: 'action', text: 'alice.eth raised to 800' },
    { handle: 'shark99', address: '0xAAAA', text: 'gg' },
  ]);
  const [handHistory, setHandHistory] = useState([
    { nonce: 1, winner: 'shark99', amount: 8200 },
    { nonce: 2, winner: 'alice.eth', amount: 5600 },
  ]);

  const heroSeat = gameState.seats[gameState.activePlayer];
  const isHeroTurn = heroSeat?.isActive && heroSeat?.player?.isHero;
  const heroChips  = heroSeat?.player?.chips ?? 0;
  const pot        = gameState.pot;
  const bigBlind   = gameState.bigBlind;
  const callAmt    = heroSeat?.betAmount ? 400 : 0;  // mock

  const handleAction = useCallback((type, amount) => {
    setChat(prev => [...prev, {
      type: 'action',
      text: `You ${type}${amount ? ` ${amount.toLocaleString()}` : ''}`,
    }]);
    // In real impl: ws.send(JSON.stringify({ type, amount }))
    setGameState(prev => ({
      ...prev,
      seats: prev.seats.map((s, i) =>
        i === prev.activePlayer ? { ...s, isActive: false, lastAction: type } : s
      ),
    }));
  }, []);

  const sendChat = useCallback((text) => {
    setChat(prev => [...prev, { handle: 'You', address: '0xDEAD', text }]);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', display: 'flex', flexDirection: 'column' }}>
      <WalletBar />

      {/* Breadcrumb */}
      <div style={{
        padding: '8px 16px', borderBottom: '1px solid #1a3a1a',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 10, color: '#3a6a3a',
      }}>
        <Link href="/" style={{ color: '#3a6a3a', textDecoration: 'none' }}>Lobby</Link>
        <span>›</span>
        <span style={{ color: '#6a9a6a' }}>{gameState.tableName || `Table #${id}`}</span>
        <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace" }}>
          {(gameState.bigBlind/2).toLocaleString()}/{gameState.bigBlind.toLocaleString()} CHIPS
        </span>
      </div>

      {/* Main layout */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '1fr 260px',
        gap: 0,
        overflow: 'hidden',
      }}>

        {/* Left: table + controls */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          padding: '24px 16px 100px',
          position: 'relative',
          overflowY: 'auto',
        }}>
          <PokerTable
            seats={gameState.seats.map(s => s ? {
              player: s.player,
              cards: s.cards || [],
              isActive: s.isActive,
              timerPct: s.timerPct ?? 1,
              lastAction: s.lastAction,
              betAmount: s.betAmount || 0,
              isDealer: s.isDealer,
            } : null)}
            communityCards={gameState.communityCards}
            pot={gameState.pot}
            sidePots={gameState.sidePots}
            street={gameState.street}
            winners={gameState.winners}
            tableInfo={{
              name: gameState.tableName,
              bigBlind: gameState.bigBlind,
              gameType: gameState.gameType,
            }}
          />

          {/* Betting controls overlay */}
          <BettingControls
            isActive={isHeroTurn}
            canCheck={callAmt === 0}
            callAmount={callAmt}
            minRaise={bigBlind * 2}
            maxRaise={heroChips}
            pot={pot}
            bigBlind={bigBlind}
            playerChips={heroChips}
            onFold={() => handleAction('fold')}
            onCheck={() => handleAction('check')}
            onCall={() => handleAction('call', callAmt)}
            onRaise={amt => handleAction('raise', amt)}
            onAllIn={() => handleAction('all-in', heroChips)}
          />
        </div>

        {/* Right panel */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '16px 12px 16px 0',
          borderLeft: '1px solid #1a3a1a',
          background: 'rgba(0,0,0,.2)',
          height: '100%',
          overflowY: 'auto',
        }}>
          {/* Player stack summary */}
          <div style={{
            background: '#060e06', border: '1px solid #1a3a1a',
            borderRadius: 8, overflow: 'hidden', flexShrink: 0,
          }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a3a1a',
              fontSize: 9, color: '#3a6a3a', letterSpacing: 2 }}>
              PLAYERS
            </div>
            <div style={{ padding: '6px' }}>
              {gameState.seats.filter(Boolean).filter(s => s.player).map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 8px', borderRadius: 4,
                  background: s.isActive ? 'rgba(212,175,55,.05)' : 'transparent',
                  opacity: s.player?.isFolded ? 0.4 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {s.isDealer && (
                      <div style={{
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#fff', color: '#000',
                        fontSize: 7, fontWeight: 900,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>D</div>
                    )}
                    {!s.isDealer && <div style={{ width: 14 }} />}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: s.isActive ? '#d4af37' : '#1a3a1a',
                    }} />
                    <span style={{
                      fontSize: 11, color: s.player?.isHero ? '#d4af37' : '#8aaa8a',
                      maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {s.player?.handle || `${s.player?.address?.slice(0,8)}…`}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 10, color: '#d4af37',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    ◈{(s.player?.chips / 1000).toFixed(1)}K
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Chat */}
          <div style={{ flex: 1, minHeight: 200 }}>
            <ChatPanel messages={chat} onSend={sendChat} />
          </div>

          {/* Hand history */}
          <HandHistory hands={handHistory} />

          {/* Leave table */}
          <button
            onClick={() => router.push('/')}
            style={{
              background: 'transparent', border: '1px solid #3a1a1a',
              borderRadius: 6, padding: '8px', cursor: 'pointer',
              color: '#6a4a4a', fontSize: 11, fontFamily: 'inherit',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e74c3c'; e.currentTarget.style.borderColor = '#c0392b'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#6a4a4a'; e.currentTarget.style.borderColor = '#3a1a1a'; }}
          >
            Leave Table
          </button>
        </div>
      </div>
    </div>
  );
}
