'use client';
import Card, { EmptyCardSlot } from './Card';

const AVATAR_COLORS = ['#c0392b','#2980b9','#27ae60','#8e44ad','#e67e22','#16a085','#d35400','#2c3e50'];

// Chip denominations in BB multiples (highest first)
const CHIP_DENOMS = [
  { bbMult: 1000, color: '#d4af37', hi: '#f1c40f' },
  { bbMult: 500,  color: '#8e44ad', hi: '#9b59b6' },
  { bbMult: 100,  color: '#1a1a1a', hi: '#555'    },
  { bbMult: 25,   color: '#1a6b32', hi: '#27ae60' },
  { bbMult: 5,    color: '#8b1a1a', hi: '#c0392b' },
  { bbMult: 1,    color: '#1a3a8b', hi: '#2980b9' },
  { bbMult: 0,    color: '#3a3a3a', hi: '#7f8c8d' },
];

function buildChips(amount, bigBlind, maxChips = 7) {
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

function ChipPile({ amount, bigBlind = 100, maxChips = 7, chipW = 26, chipH = 7 }) {
  if (!amount || amount <= 0) return null;
  const chips = buildChips(amount, bigBlind, maxChips);
  const gap = chipH - 2;
  const totalH = chipH + (chips.length - 1) * gap;
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(1)}K` : v.toLocaleString();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ position: 'relative', width: chipW, height: totalH + 4 }}>
        {chips.map((chip, i) => (
          <div key={i} style={{
            position: 'absolute',
            bottom: i * gap,
            left: 0,
            width: chipW,
            height: chipH,
            borderRadius: chipH / 2,
            background: `radial-gradient(ellipse at 50% 25%, ${chip.hi}bb, ${chip.color})`,
            border: `1px solid ${chip.hi}55`,
            boxShadow: i === chips.length - 1
              ? `0 3px 6px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.1)`
              : `0 1px 3px rgba(0,0,0,.5)`,
          }} />
        ))}
      </div>
      <div style={{
        fontSize: 9, color: '#d4af37', fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
        background: 'rgba(0,0,0,.75)', borderRadius: 4, padding: '1px 5px',
        border: '1px solid #d4af3733', whiteSpace: 'nowrap',
      }}>◈ {fmt(amount)}</div>
    </div>
  );
}

function TimerRing({ pct = 1, size = 56 }) {
  const r = 24, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const urgent = pct < 0.25;
  return (
    <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3"/>
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke={urgent ? '#c0392b' : '#d4af37'}
        strokeWidth="3"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset .5s linear', filter: urgent ? 'drop-shadow(0 0 4px #c0392b)' : 'none' }}
      />
    </svg>
  );
}

function ChipCount({ amount }) {
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(1)}K` : String(v);
  return (
    <div style={{
      background: 'rgba(0,0,0,.75)', border: '1px solid #d4af3766',
      borderRadius: 20, padding: '3px 10px',
      fontSize: 11, color: '#d4af37', fontWeight: 700,
      fontFamily: "'JetBrains Mono', monospace",
      whiteSpace: 'nowrap',
    }}>
      ◈ {fmt(amount)}
    </div>
  );
}

function ActionBadge({ action }) {
  const styles = {
    fold:   { bg: '#3a1a1a', border: '#c0392b', color: '#c0392b', label: 'FOLD' },
    check:  { bg: '#1a2a3a', border: '#2980b9', color: '#7fb3d3', label: 'CHECK' },
    call:   { bg: '#1a2a3a', border: '#27ae60', color: '#2ecc71', label: 'CALL' },
    raise:  { bg: '#2a1a00', border: '#d4af37', color: '#d4af37', label: 'RAISE' },
    'all-in': { bg: '#2a1a00', border: '#d4af37', color: '#f39c12', label: 'ALL IN' },
    bet:    { bg: '#2a1a00', border: '#d4af37', color: '#d4af37', label: 'BET' },
    blind:  { bg: '#1a2a1a', border: '#27ae60', color: '#27ae60', label: 'BLIND' },
  };
  const s = styles[action?.toLowerCase()] || { bg: '#111', border: '#444', color: '#aaa', label: action };
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 4, padding: '2px 8px',
      fontSize: 9, color: s.color, fontWeight: 700,
      letterSpacing: 1, position: 'absolute', top: -18, left: '50%',
      transform: 'translateX(-50%)', whiteSpace: 'nowrap',
    }}>
      {s.label}
    </div>
  );
}

// positions: seat index → { top%, left%, labelPos }
// For a 9-player oval table
const SEAT_POSITIONS = [
  { top: '85%', left: '50%',  label: 'bottom' },  // 0 hero
  { top: '72%', left: '18%',  label: 'left'   },  // 1
  { top: '42%', left: '5%',   label: 'left'   },  // 2
  { top: '12%', left: '18%',  label: 'top'    },  // 3
  { top: '4%',  left: '50%',  label: 'top'    },  // 4
  { top: '12%', left: '82%',  label: 'top'    },  // 5
  { top: '42%', left: '95%',  label: 'right'  },  // 6
  { top: '72%', left: '82%',  label: 'right'  },  // 7
  { top: '85%', left: '75%',  label: 'bottom' },  // 8
];

export function getSeatPosition(seatIndex, total = 9) {
  return SEAT_POSITIONS[seatIndex % SEAT_POSITIONS.length];
}

export default function PlayerSeat({
  seatIndex = 0,
  player = null,       // { address, handle, avatarUrl, chips, isHero, isFolded, isAllIn }
  cards = [],          // ['AH','KS'] or [{card, faceDown}]
  hideCards = false,   // suppress in-seat hole cards (hero's are shown in a bigger panel below the table)
  isActive = false,    // it's this player's turn
  timerPct = 1,        // 0→1 countdown
  lastAction = null,   // 'fold','check','call','raise','bet','all-in'
  betAmount = 0,
  bigBlind = 100,
  pot = 0,
  isDealer = false,
  isEmpty = false,
  onClick = null,
}) {
  const pos = SEAT_POSITIONS[seatIndex % SEAT_POSITIONS.length];
  const colorIdx = seatIndex % AVATAR_COLORS.length;
  const initials = player?.handle
    ? player.handle.slice(0, 2).toUpperCase()
    : player?.address
      ? player.address.slice(2, 4).toUpperCase()
      : '??';

  const AVATAR_SIZE = 56;

  if (isEmpty) {
    return (
      <div style={{
        position: 'absolute',
        top: pos.top, left: pos.left,
        transform: 'translate(-50%, -50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        cursor: onClick ? 'pointer' : 'default',
        opacity: 0.4,
        transition: 'opacity .2s',
        zIndex: 10,
      }}
      onClick={onClick}
      onMouseEnter={e => onClick && (e.currentTarget.style.opacity = '0.8')}
      onMouseLeave={e => onClick && (e.currentTarget.style.opacity = '0.4')}
      >
        <div style={{
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: '50%',
          border: '2px dashed #d4af3733',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, color: '#d4af3744',
        }}>+</div>
        <div style={{ fontSize: 9, color: '#d4af3366', letterSpacing: 1 }}>EMPTY</div>
      </div>
    );
  }

  if (!player) return null;

  const isFolded  = player.isFolded;
  const isAllIn   = player.isAllIn;
  const avatarUrl = player.avatarUrl;

  // How big is this bet relative to pot (for chip pile sizing)
  const betPct   = pot > 0 ? Math.min(betAmount / pot, 1) : 0;
  const chipCount = betAmount > 0 ? Math.max(2, Math.min(7, Math.ceil(betPct * 6) + 1)) : 0;

  return (
    <div style={{
      position: 'absolute',
      top: pos.top, left: pos.left,
      transform: 'translate(-50%, -50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      zIndex: isActive ? 20 : 10,
      opacity: isFolded ? 0.4 : 1,
      transition: 'opacity .3s',
    }}>

      {/* hole cards above/below seat depending on position */}
      {!hideCards && cards.length > 0 && (
        <div style={{
          display: 'flex', gap: 3,
          order: pos.label === 'bottom' ? -1 : 1,
          marginBottom: pos.label === 'bottom' ? 4 : 0,
          marginTop: pos.label !== 'bottom' ? 4 : 0,
        }}>
          {cards.map((c, i) => {
            const cardStr = typeof c === 'string' ? c : c?.card;
            const fd = typeof c === 'object' ? !!c?.faceDown : false;
            return (
              <div key={`${i}-${cardStr || 'fd'}`} className="card-deal" style={{ animationDelay: `${i * 0.12}s` }}>
                <Card card={cardStr} faceDown={fd || isFolded} width={36} height={50} />
              </div>
            );
          })}
          {cards.length === 0 && !isFolded && [0,1].map(i => <EmptyCardSlot key={i} width={36} height={50}/>)}
        </div>
      )}

      {/* avatar ring */}
      <div style={{ position: 'relative', width: AVATAR_SIZE, height: AVATAR_SIZE }}>
        {isActive && <TimerRing pct={timerPct} size={AVATAR_SIZE} />}

        <div style={{
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: '50%',
          overflow: 'hidden',
          border: `2px solid ${isActive ? '#d4af37' : isAllIn ? '#e67e22' : '#1a3a1a'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: isActive ? '0 0 12px #d4af3766' : 'none',
          transition: 'border-color .3s, box-shadow .3s',
          position: 'relative', zIndex: 1,
        }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={player.handle || ''}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `radial-gradient(circle at 35% 35%, ${AVATAR_COLORS[colorIdx]}cc, ${AVATAR_COLORS[colorIdx]}44)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff',
              fontFamily: "'JetBrains Mono', monospace",
            }}>{initials}</div>
          )}
        </div>

        {/* dealer button */}
        {isDealer && (
          <div style={{
            position: 'absolute', bottom: 0, right: -2,
            width: 18, height: 18, borderRadius: '50%',
            background: '#fff', color: '#1a1a1a',
            fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #ccc', zIndex: 2,
          }}>D</div>
        )}

        {/* all-in badge */}
        {isAllIn && (
          <div style={{
            position: 'absolute', top: -8, right: -4,
            background: '#e67e22', borderRadius: 4,
            fontSize: 7, color: '#fff', fontWeight: 700,
            padding: '1px 4px', letterSpacing: .5, zIndex: 2,
          }}>ALL IN</div>
        )}
      </div>

      {/* name + chips */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative' }}>
        {lastAction && <ActionBadge action={lastAction} />}
        <div style={{
          fontSize: player.handle ? 11 : 9,
          color: player.isHero ? '#d4af37' : avatarUrl ? '#e8f0e8' : '#a8c8a8',
          fontWeight: 700, maxWidth: 80, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textAlign: 'center',
          textShadow: player.handle ? '0 0 8px rgba(0,0,0,0.8)' : 'none',
        }}>
          {player.handle
            ? `@${player.handle}`
            : (player.address ? `${player.address.slice(0,6)}…` : 'Player')}
        </div>
        <ChipCount amount={player.chips || 0} />
      </div>

      {/* chip pile bet in front of player */}
      {betAmount > 0 && (
        <div style={{
          position: 'absolute',
          top: pos.label === 'bottom' ? '-72px' : pos.label === 'top' ? '72px' : '0',
          left: pos.label === 'left' ? '76px' : pos.label === 'right' ? '-76px' : '50%',
          transform: pos.label === 'left' || pos.label === 'right' ? 'translateY(-50%)' : 'translateX(-50%)',
        }}>
          <ChipPile amount={betAmount} bigBlind={bigBlind} maxChips={chipCount} />
        </div>
      )}
    </div>
  );
}
