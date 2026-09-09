'use client';
import { useEffect, useRef, useState } from 'react';
import Card, { EmptyCardSlot } from './Card';
import PlayerSeat from './PlayerSeat';
import { generatedNameForAddress } from '../hooks/usePokerWallet';

const CHIP_DENOMS = [
  { bbMult: 1000, color: '#d9c08a', hi: '#f0e6cf' },
  { bbMult: 500,  color: '#a06cd4', hi: '#b985e0' },
  { bbMult: 100,  color: '#1a1a1a', hi: '#555'    },
  { bbMult: 25,   color: '#1a6b32', hi: '#10b981' },
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
  const maxC = Math.min(12, Math.max(3, Math.ceil(Math.log10(amount / bigBlind + 1)) + 2));
  const chips = buildChips(amount, bigBlind, maxC);
  const chipD = 30, gap = 6; // round casino chips, stacked with a slight rise

  // Split into up to 3 stacks
  const colSize = Math.ceil(chips.length / 3);
  const cols = [];
  for (let i = 0; i < chips.length; i += colSize) cols.push(chips.slice(i, i + colSize));

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
      {cols.map((col, ci) => (
        <div key={ci} style={{ position: 'relative', width: chipD, height: chipD + (col.length - 1) * gap }}>
          {col.map((chip, i) => (
            <div key={i} style={{
              position: 'absolute',
              bottom: i * gap,
              left: 0,
              width: chipD,
              height: chipD,
              borderRadius: '50%',
              background: `radial-gradient(circle at 40% 30%, ${chip.hi}, ${chip.color} 70%)`,
              border: `2px dashed rgba(255,255,255,.55)`,
              boxSizing: 'border-box',
              boxShadow: i === col.length - 1
                ? `0 3px 6px rgba(0,0,0,.7), inset 0 0 0 3px rgba(0,0,0,.25)`
                : `0 1px 3px rgba(0,0,0,.6)`,
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
          <div key={`${i}-${card}`} className="card-flip" style={{ animationDelay: `${i * 0.09}s` }}>
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
        background: 'rgba(0,0,0,.55)', border: '1px solid #d9c08a33',
        borderRadius: 20, padding: '6px 14px',
      }}>
        <PotChips amount={pot} bigBlind={bigBlind} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span style={{ fontSize: 9, color: '#57544b', letterSpacing: 1 }}>POT</span>
          <span style={{
            fontSize: 14, color: '#d9c08a', fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
          }}>◈ {fmt(pot)}</span>
        </div>
      </div>

      {sidePots.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {sidePots.map((sp, i) => (
            <div key={i} style={{
              fontSize: 9, color: '#8a8478',
              fontFamily: "'JetBrains Mono', monospace",
              background: 'rgba(0,0,0,.4)', borderRadius: 8,
              padding: '2px 8px', border: '1px solid #232327',
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
      fontSize: 9, color: '#d9c08aaa', letterSpacing: 3, fontWeight: 700,
    }}>{labels[street] || street.toUpperCase()}</div>
  );
}

function WinnerBanner({ winners = [] }) {
  if (!winners.length) return null;
  return (
    <div style={{
      position: 'absolute', top: '35%', left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0,0,0,.85)', border: '1px solid #d9c08a',
      borderRadius: 12, padding: '10px 24px',
      textAlign: 'center', zIndex: 50,
      animation: 'fade-in .4s ease forwards',
    }}>
      <div style={{ fontSize: 10, color: '#d9c08aaa', letterSpacing: 3, marginBottom: 4 }}>
        WINNER
      </div>
      {winners.map((w, i) => (
        <div key={i} style={{ fontSize: 16, color: '#d9c08a', fontWeight: 700 }}>
          {w.handle || generatedNameForAddress(w.address)}
          <span style={{ fontSize: 11, marginLeft: 8, color: '#f0e6cf' }}>
            ◈ {w.amount?.toLocaleString()}
          </span>
        </div>
      ))}
      {winners[0]?.hand && (
        <div style={{ fontSize: 10, color: '#d9c08a77', marginTop: 4, letterSpacing: 1 }}>
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

      {/* ── Outer rail: padded leather ring ── */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'radial-gradient(ellipse at 50% 30%, #4a3524 0%, #3a2817 55%, #241608 100%)',
        boxShadow: '0 18px 55px rgba(0,0,0,.9), inset 0 3px 12px rgba(255,255,255,.10), inset 0 -6px 18px rgba(0,0,0,.6)',
      }} />
      {/* leather stitch line around the rail */}
      <div aria-hidden style={{
        position: 'absolute', inset: '4.5%', borderRadius: '50%',
        border: '2px dashed rgba(217,192,138,.22)',
        pointerEvents: 'none',
      }} />

      {/* ── Gold rim between rail and felt ── */}
      <div aria-hidden style={{
        position: 'absolute', inset: '7%', borderRadius: '50%',
        border: '2px solid rgba(217,192,138,.55)',
        boxShadow: '0 0 22px rgba(217,192,138,.30), inset 0 0 20px rgba(217,192,138,.14)',
        pointerEvents: 'none',
      }} />

      {/* ── Felt surface: classic casino green ── */}
      <div style={{
        position: 'absolute',
        inset: '8%',
        borderRadius: '50%',
        background: 'radial-gradient(ellipse at 46% 36%, #1f7a4d 0%, #14663f 45%, #0c4429 78%, #07301d 100%)',
        boxShadow: 'inset 0 6px 34px rgba(0,0,0,.6), inset 0 0 90px rgba(0,0,0,.4)',
        overflow: 'hidden',
      }}>
        {/* felt nap texture */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%', opacity: .5,
          background: 'radial-gradient(rgba(255,255,255,.05) 0.5px, transparent 0.5px)',
          backgroundSize: '16px 16px',
          pointerEvents: 'none',
        }} />
        {/* overhead-light sheen on the felt */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'radial-gradient(ellipse 70% 50% at 50% 34%, rgba(255,255,255,.10), transparent 60%)',
          pointerEvents: 'none',
        }} />

        {/* table logo watermark */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 120, color: 'rgba(255,255,255,.06)',
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
              <span style={{ fontSize: 9, color: '#8a8478', letterSpacing: 1 }}>
                {tableInfo.name}
              </span>
            )}
            {tableInfo.bigBlind && (
              <span style={{ fontSize: 9, color: '#57544b',
                fontFamily: "'JetBrains Mono', monospace" }}>
                {(tableInfo.bigBlind/2).toLocaleString()}/{tableInfo.bigBlind.toLocaleString()} ALLIN
              </span>
            )}
            {tableInfo.gameType === 1 && (
              <span style={{ fontSize: 8, color: '#a06cd4', letterSpacing: 1, border: '1px solid #a06cd444',
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
