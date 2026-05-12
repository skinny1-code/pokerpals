'use client';
import Card, { EmptyCardSlot } from './Card';
import PlayerSeat from './PlayerSeat';

function CommunityCards({ cards = [], street = 'preflop' }) {
  // streets: preflop (0), flop (3), turn (4), river (5)
  const slots = 5;
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center',
    }}>
      {Array.from({ length: slots }).map((_, i) => {
        const card = cards[i];
        if (card) return <Card key={i} card={card} width={56} height={78} />;
        // animate-in placeholder for unrevealed slots
        return (
          <EmptyCardSlot key={i} width={56} height={78} />
        );
      })}
    </div>
  );
}

function PotDisplay({ pot, sidePots = [] }) {
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(1)}K` : v.toLocaleString();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(0,0,0,.55)', border: '1px solid #d4af3733',
        borderRadius: 20, padding: '6px 18px',
      }}>
        {/* chip stack visual */}
        <div style={{ display: 'flex', gap: -2 }}>
          {['#c0392b','#2980b9','#27ae60','#2c2c2c'].map((c, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: '50%',
              background: c, border: '1.5px solid rgba(255,255,255,.2)',
              marginLeft: i > 0 ? -4 : 0,
              boxShadow: '0 2px 4px rgba(0,0,0,.5)',
            }}/>
          ))}
        </div>
        <span style={{
          fontSize: 14, color: '#d4af37', fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          ◈ {fmt(pot)}
        </span>
        <span style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1 }}>POT</span>
      </div>

      {sidePots.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {sidePots.map((sp, i) => (
            <div key={i} style={{
              fontSize: 9, color: '#6a9a6a',
              fontFamily: "'JetBrains Mono', monospace",
              background: 'rgba(0,0,0,.4)', borderRadius: 8,
              padding: '2px 8px', border: '1px solid #1a3a1a',
            }}>
              SIDE {i+1}: ◈{fmt(sp)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StreetLabel({ street }) {
  if (!street || street === 'preflop') return null;
  const labels = { flop: 'FLOP', turn: 'TURN', river: 'RIVER', showdown: 'SHOWDOWN' };
  return (
    <div style={{
      position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
      fontSize: 9, color: '#d4af37aa', letterSpacing: 3, fontWeight: 700,
    }}>{labels[street] || street.toUpperCase()}</div>
  );
}

function WinnerBanner({ winners = [] }) {
  if (!winners.length) return null;
  return (
    <div style={{
      position: 'absolute', top: '35%', left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0,0,0,.85)', border: '1px solid #d4af37',
      borderRadius: 12, padding: '10px 24px',
      textAlign: 'center', zIndex: 50,
      animation: 'fade-in .4s ease forwards',
    }}>
      <div style={{ fontSize: 10, color: '#d4af37aa', letterSpacing: 3, marginBottom: 4 }}>
        WINNER
      </div>
      {winners.map((w, i) => (
        <div key={i} style={{ fontSize: 16, color: '#d4af37', fontWeight: 700 }}>
          {w.handle || (w.address ? `${w.address.slice(0,8)}…` : 'Player')}
          <span style={{ fontSize: 11, marginLeft: 8, color: '#f1c40f' }}>
            ◈ {w.amount?.toLocaleString()}
          </span>
        </div>
      ))}
      {winners[0]?.hand && (
        <div style={{ fontSize: 10, color: '#d4af3777', marginTop: 4, letterSpacing: 1 }}>
          {winners[0].hand}
        </div>
      )}
    </div>
  );
}

export default function PokerTable({
  seats = [],        // array of { player, cards, isActive, timerPct, lastAction, betAmount, isDealer }
  communityCards = [],
  pot = 0,
  sidePots = [],
  street = 'preflop',
  winners = [],
  tableInfo = null,  // { name, buyIn, bigBlind, gameType }
  onSeatClick = null,
}) {
  // Table outer dimensions (responsive)
  const tableW = 720;
  const tableH = 420;

  return (
    <div style={{
      position: 'relative',
      width: '100%', maxWidth: tableW,
      aspectRatio: `${tableW} / ${tableH}`,
      margin: '0 auto',
    }}>

      {/* ── Outer rail ── */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'radial-gradient(ellipse at center, #3d2515 0%, #2c1a0e 60%, #1a0f07 100%)',
        boxShadow: '0 8px 32px rgba(0,0,0,.8), inset 0 2px 8px rgba(255,255,255,.05)',
      }} />

      {/* ── Felt surface ── */}
      <div style={{
        position: 'absolute',
        inset: '5%',
        borderRadius: '50%',
        background: 'radial-gradient(ellipse at 45% 40%, #1f5a36 0%, #1a4a2e 50%, #0f3020 100%)',
        boxShadow: 'inset 0 4px 20px rgba(0,0,0,.5)',
        overflow: 'hidden',
      }}>
        {/* subtle felt texture */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,.005) 2px, rgba(255,255,255,.005) 4px)',
          pointerEvents: 'none',
        }} />

        {/* table logo watermark */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 64, color: 'rgba(255,255,255,.025)',
          pointerEvents: 'none', userSelect: 'none',
          lineHeight: 1,
        }}>♠</div>

        {/* street label */}
        <StreetLabel street={street} />

        {/* center content */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <CommunityCards cards={communityCards} street={street} />
          {pot > 0 && <PotDisplay pot={pot} sidePots={sidePots} />}
        </div>

        {/* table info strip (top) */}
        {tableInfo && (
          <div style={{
            position: 'absolute', top: 10, left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex', gap: 12, alignItems: 'center',
          }}>
            {tableInfo.name && (
              <span style={{ fontSize: 9, color: '#6a9a6a', letterSpacing: 1 }}>
                {tableInfo.name}
              </span>
            )}
            {tableInfo.bigBlind && (
              <span style={{ fontSize: 9, color: '#3a6a3a',
                fontFamily: "'JetBrains Mono', monospace" }}>
                {(tableInfo.bigBlind/2).toLocaleString()}/{tableInfo.bigBlind.toLocaleString()} CHIPS
              </span>
            )}
            {tableInfo.gameType === 1 && (
              <span style={{ fontSize: 8, color: '#8e44ad', letterSpacing: 1, border: '1px solid #8e44ad44',
                padding: '1px 5px', borderRadius: 3 }}>PLO</span>
            )}
          </div>
        )}

        {/* winner banner overlay */}
        <WinnerBanner winners={winners} />
      </div>

      {/* ── Rail edge highlight ── */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        border: '2px solid rgba(255,255,255,.04)',
        pointerEvents: 'none',
      }} />

      {/* ── Player seats (positioned absolutely around the table) ── */}
      {seats.map((seat, i) => (
        <PlayerSeat
          key={i}
          seatIndex={i}
          player={seat?.player || null}
          cards={seat?.cards || []}
          isActive={seat?.isActive || false}
          timerPct={seat?.timerPct ?? 1}
          lastAction={seat?.lastAction || null}
          betAmount={seat?.betAmount || 0}
          isDealer={seat?.isDealer || false}
          isEmpty={!seat?.player}
          onClick={!seat?.player && onSeatClick ? () => onSeatClick(i) : null}
        />
      ))}
    </div>
  );
}
