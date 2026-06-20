'use client';
import { useEffect, useRef, useState } from 'react';
import Card, { EmptyCardSlot } from './Card';
import PlayerSeat from './PlayerSeat';

const CHIP_DENOMS = [
  { bbMult: 1000, color: '#d4af37', hi: '#f1c40f' },
  { bbMult: 500,  color: '#8e44ad', hi: '#9b59b6' },
  { bbMult: 100,  color: '#1a1a1a', hi: '#555'    },
  { bbMult: 25,   color: '#1a6b32', hi: '#27ae60' },
  { bbMult: 5,    color: '#8b1a1a', hi: '#c0392b' },
  { bbMult: 1,    color: '#1a3a8b', hi: '#2980b9' },
  { bbMult: 0,    color: '#3a3a3a', hi: '#7f8c8d' },
];

function buildChips(amount, bigBlind, maxChips = 10) {
  const bb = bigBlind || 100;
  let rem = amount / bb;
  const chips = [];
  for (const { bbMult, color, hi } of CHIP_DENOMS) {
    if (chips.length >= maxChips) break;
    if (bbMult === 0) {
      if (chips.length === 0) chips.push({ color, hi });
      break;
    }
    if (rem >= bbMult) {
      const n = Math.min(Math.floor(rem / bbMult), maxChips - chips.length, 4);
      for (let i = 0; i < n; i++) chips.push({ color, hi });
      rem -= n * bbMult;
    }
  }
  return chips.length ? chips : [CHIP_DENOMS[CHIP_DENOMS.length - 1]];
}

function PotChips({ amount, bigBlind = 100 }) {
  if (!amount || amount <= 0) return null;
  const maxC = Math.min(10, Math.max(2, Math.ceil(Math.log10(amount / bigBlind + 1)) + 1));
  const chips = buildChips(amount, bigBlind, maxC);
  const chipW = 20, chipH = 7, gap = 5;

  // Split into up to 3 columns
  const colSize = Math.ceil(chips.length / 3);
  const cols = [];
  for (let i = 0; i < chips.length; i += colSize) cols.push(chips.slice(i, i + colSize));

  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
      {cols.map((col, ci) => (
        <div key={ci} style={{ position: 'relative', width: chipW, height: chipH + (col.length - 1) * gap + 4 }}>
          {col.map((chip, i) => (
            <div key={i} style={{
              position: 'absolute',
              bottom: i * gap,
              left: 0,
              width: chipW,
              height: chipH,
              borderRadius: chipH / 2,
              background: `radial-gradient(ellipse at 50% 25%, ${chip.hi}bb, ${chip.color})`,
              border: `1px solid ${chip.hi}55`,
              boxShadow: i === col.length - 1
                ? `0 3px 5px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.1)`
                : `0 1px 3px rgba(0,0,0,.5)`,
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CommunityCards({ cards = [] }) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center',
    }}>
      {Array.from({ length: 5 }).map((_, i) => {
        const card = cards[i];
        if (card) return (
          <div key={`${i}-${card}`} className="card-deal" style={{ animationDelay: `${i * 0.08}s` }}>
            <Card card={card} width={56} height={78} />
          </div>
        );
        return <EmptyCardSlot key={i} width={56} height={78} />;
      })}
    </div>
  );
}

function PotDisplay({ pot, sidePots = [], bigBlind = 100 }) {
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(1)}K` : v.toLocaleString();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(0,0,0,.55)', border: '1px solid #d4af3733',
        borderRadius: 20, padding: '6px 14px',
      }}>
        <PotChips amount={pot} bigBlind={bigBlind} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1 }}>POT</span>
          <span style={{
            fontSize: 14, color: '#d4af37', fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
          }}>◈ {fmt(pot)}</span>
        </div>
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
  const tableW = 720;
  const tableH = 420;
  const bigBlind = tableInfo?.bigBlind || 100;

  // The table is designed at a fixed 720×420px, but its outer box is responsive
  // (width:100%, capped at 720). Scale the design-size content as a unit to match
  // the rendered size, instead of every seat/card/avatar pixel value separately —
  // otherwise fixed-size hole cards collide with the community cards once the
  // table shrinks below its design width (e.g. on mobile, 9-max top-row seats).
  const outerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / tableW));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} style={{
      position: 'relative',
      width: '100%', maxWidth: tableW,
      aspectRatio: `${tableW} / ${tableH}`,
      margin: '0 auto',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: tableW, height: tableH,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
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
          {pot > 0 && <PotDisplay pot={pot} sidePots={sidePots} bigBlind={bigBlind} />}
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
          hideCards={!!seat?.player?.isHero}
          isActive={seat?.isActive || false}
          timerPct={seat?.timerPct ?? 1}
          lastAction={seat?.lastAction || null}
          betAmount={seat?.betAmount || 0}
          bigBlind={bigBlind}
          pot={pot}
          isDealer={seat?.isDealer || false}
          isEmpty={!seat?.player}
          onClick={!seat?.player && onSeatClick ? () => onSeatClick(i) : null}
        />
      ))}
      </div>
    </div>
  );
}
