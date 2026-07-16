'use client';

const SUIT_COLOR  = { s: '#16181c', c: '#16181c', h: '#cf2f25', d: '#cf2f25' };
const SUIT_SYMBOL = { s: '♠', c: '♣', h: '♥', d: '♦' };

// Pip positions for the body of number cards, modeled on the standard
// French-suited layout (2/3 center column; 4/5 corners ± center; 6/7/8 two
// columns ± center pip(s); 9/10 two columns of four ± center pip(s)).
// Coordinates are in the 72×100 viewBox. `rotated` mirrors real card pips:
// top-half upright, bottom-half upside-down, true-center pips stay upright.
const L = 26, C = 36, R = 46;
const PIP_LAYOUTS = {
  '2':  [{ x: C, y: 38 }, { x: C, y: 78, rotated: true }],
  '3':  [{ x: C, y: 34 }, { x: C, y: 58 }, { x: C, y: 82, rotated: true }],
  '4':  [{ x: L, y: 38 }, { x: R, y: 38 },
         { x: L, y: 78, rotated: true }, { x: R, y: 78, rotated: true }],
  '5':  [{ x: L, y: 38 }, { x: R, y: 38 }, { x: C, y: 58 },
         { x: L, y: 78, rotated: true }, { x: R, y: 78, rotated: true }],
  '6':  [{ x: L, y: 34 }, { x: R, y: 34 }, { x: L, y: 58 }, { x: R, y: 58 },
         { x: L, y: 82, rotated: true }, { x: R, y: 82, rotated: true }],
  '7':  [{ x: L, y: 32 }, { x: R, y: 32 }, { x: C, y: 44 },
         { x: L, y: 58 }, { x: R, y: 58 },
         { x: L, y: 82, rotated: true }, { x: R, y: 82, rotated: true }],
  '8':  [{ x: L, y: 30 }, { x: R, y: 30 }, { x: C, y: 42 },
         { x: L, y: 58 }, { x: R, y: 58 },
         { x: C, y: 74, rotated: true },
         { x: L, y: 86, rotated: true }, { x: R, y: 86, rotated: true }],
  '9':  [{ x: L, y: 30 }, { x: R, y: 30 }, { x: L, y: 46 }, { x: R, y: 46 },
         { x: C, y: 58 },
         { x: L, y: 70, rotated: true }, { x: R, y: 70, rotated: true },
         { x: L, y: 86, rotated: true }, { x: R, y: 86, rotated: true }],
  '10': [{ x: L, y: 28 }, { x: R, y: 28 }, { x: C, y: 36 },
         { x: L, y: 44 }, { x: R, y: 44 },
         { x: L, y: 72, rotated: true }, { x: R, y: 72, rotated: true },
         { x: C, y: 80, rotated: true },
         { x: L, y: 88, rotated: true }, { x: R, y: 88, rotated: true }],
};
const FACE_RANKS = new Set(['J', 'Q', 'K']);

// Parse "AH", "TS", "2d" → { rank, suit }. Server notation uses 'T' for Ten;
// display always shows '10' (PIP_LAYOUTS is keyed by '10', not 'T').
function parseCard(str) {
  if (!str || str.length < 2) return null;
  const raw  = str.toUpperCase();
  const rank = raw.slice(0, -1);
  const suit = raw.slice(-1).toLowerCase();
  return { rank: rank === 'T' ? '10' : rank, suit };
}

function CardBack({ width = 72, height = 100 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 72 100"
      style={{ display: 'block', borderRadius: 6, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.5))' }}>
      {/* Card body — obsidian with champagne trim */}
      <rect x="0" y="0" width="72" height="100" rx="6" fill="#131316"/>
      <rect x="3" y="3" width="66" height="94" rx="4" fill="none" stroke="#d9c08a" strokeWidth="1" opacity=".5"/>
      {/* Fine diamond lattice */}
      <pattern id="bp" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M4 0L8 4L4 8L0 4Z" fill="none" stroke="#2b2b31" strokeWidth=".5"/>
      </pattern>
      <rect x="4" y="4" width="64" height="92" rx="3" fill="url(#bp)" opacity=".8"/>
      {/* Center spade */}
      <text x="36" y="58" textAnchor="middle" fontSize="24" fill="#d9c08a" opacity=".8">♠</text>
    </svg>
  );
}

// Body content for the card face: pips for 2-10, a court-card icon for J/Q/K,
// one large symbol for A.
function CardBody({ rank, symbol, color }) {
  if (rank === 'A') {
    return <text x="36" y="58" textAnchor="middle" fontSize="32" fill={color}>{symbol}</text>;
  }
  if (FACE_RANKS.has(rank)) {
    return (
      <g textAnchor="middle">
        <path d="M22 40 L27 30 L32 38 L36 28 L40 38 L45 30 L50 40 Z" fill={color}/>
        <text x="36" y="74" fontSize="30" fontWeight="700" fill={color}>{rank}</text>
      </g>
    );
  }
  const pips = PIP_LAYOUTS[rank];
  if (!pips) return <text x="36" y="58" textAnchor="middle" fontSize="32" fill={color}>{symbol}</text>;
  return (
    <g textAnchor="middle">
      {pips.map((p, i) => (
        <text key={i} x={p.x} y={p.y} fontSize="13" fill={color}
          transform={p.rotated ? `rotate(180, ${p.x}, ${p.y})` : undefined}>
          {symbol}
        </text>
      ))}
    </g>
  );
}

export default function Card({ card, faceDown = false, width = 72, height = 100, className = '' }) {
  if (faceDown || !card) return <CardBack width={width} height={height} />;

  const parsed = typeof card === 'string' ? parseCard(card) : card;
  if (!parsed) return <CardBack width={width} height={height} />;

  const { rank, suit } = parsed;
  const color  = SUIT_COLOR[suit] || '#1a1a1a';
  const symbol = SUIT_SYMBOL[suit] || '?';
  const fontSize = rank === '10' ? 14 : 16;

  return (
    <svg width={width} height={height} viewBox="0 0 72 100"
      className={className}
      style={{ display: 'block', borderRadius: 6, cursor: 'default',
        filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.5))' }}>
      {/* Shadow */}
      <rect x="2" y="2" width="70" height="98" rx="6" fill="rgba(0,0,0,.3)"/>
      {/* Card body */}
      <rect x="0" y="0" width="72" height="100" rx="6" fill="#faf3e0"/>
      <rect x="1" y="1" width="70" height="98" rx="5" fill="none" stroke="#e8e0cc" strokeWidth=".5"/>
      {/* Top-left rank + suit */}
      <text x="5" y="16" fontSize={fontSize} fontWeight="700" fill={color}
        fontFamily="'JetBrains Mono',monospace">{rank}</text>
      <text x="5" y="27" fontSize="13" fontWeight="700" fill={color}>{symbol}</text>
      {/* Bottom-right rank + suit (rotated) */}
      <g transform="rotate(180, 36, 50)">
        <text x="5" y="16" fontSize={fontSize} fontWeight="700" fill={color}
          fontFamily="'JetBrains Mono',monospace">{rank}</text>
        <text x="5" y="27" fontSize="13" fontWeight="700" fill={color}>{symbol}</text>
      </g>
      {/* Card body: pips (2-10), court-card icon (J/Q/K), or single symbol (A) */}
      <CardBody rank={rank} symbol={symbol} color={color}/>
    </svg>
  );
}

// Compact mini card for mobile / tight layouts
export function MiniCard({ card, faceDown = false }) {
  return <Card card={card} faceDown={faceDown} width={48} height={68} />;
}

// Placeholder / empty card slot
export function EmptyCardSlot({ width = 72, height = 100 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 72 100"
      style={{ display: 'block', borderRadius: 6 }}>
      <rect x="0" y="0" width="72" height="100" rx="6"
        fill="none" stroke="rgba(217,192,138,.18)" strokeWidth="1.5" strokeDasharray="4 3"/>
    </svg>
  );
}
