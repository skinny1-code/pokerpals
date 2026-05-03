'use client';

const SUIT_COLOR  = { s: '#1a1a1a', c: '#1a1a1a', h: '#c0392b', d: '#c0392b' };
const SUIT_SYMBOL = { s: '♠', c: '♣', h: '♥', d: '♦' };
const SUIT_FILL   = { s: '#1a1a1a', c: '#1a1a1a', h: '#c0392b', d: '#c0392b' };

// Parse "AH", "TS", "2d" → { rank, suit }
function parseCard(str) {
  if (!str || str.length < 2) return null;
  const raw  = str.toUpperCase();
  const rank = raw.slice(0, -1);
  const suit = raw.slice(-1).toLowerCase();
  return { rank, suit };
}

function CardBack({ width = 72, height = 100 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 72 100"
      style={{ display: 'block', borderRadius: 6, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.5))' }}>
      {/* Card body */}
      <rect x="0" y="0" width="72" height="100" rx="6" fill="#1a3a7a"/>
      <rect x="3" y="3" width="66" height="94" rx="4" fill="none" stroke="#2a4a9a" strokeWidth="1"/>
      {/* Diamond pattern */}
      <pattern id="bp" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M4 0L8 4L4 8L0 4Z" fill="none" stroke="#2a4a9a" strokeWidth=".5"/>
      </pattern>
      <rect x="4" y="4" width="64" height="92" rx="3" fill="url(#bp)" opacity=".6"/>
      {/* Center spade */}
      <text x="36" y="58" textAnchor="middle" fontSize="22" fill="#2a4a9a">♠</text>
    </svg>
  );
}

export default function Card({ card, faceDown = false, width = 72, height = 100, className = '' }) {
  if (faceDown || !card) return <CardBack width={width} height={height} />;

  const parsed = typeof card === 'string' ? parseCard(card) : card;
  if (!parsed) return <CardBack width={width} height={height} />;

  const { rank, suit } = parsed;
  const color  = SUIT_COLOR[suit] || '#1a1a1a';
  const symbol = SUIT_SYMBOL[suit] || '?';
  const displayRank = rank === '10' ? '10' : rank;
  const fontSize = rank === '10' ? 11 : 13;

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
        fontFamily="'JetBrains Mono',monospace">{displayRank}</text>
      <text x="5" y="26" fontSize="9" fill={color}>{symbol}</text>
      {/* Bottom-right rank + suit (rotated) */}
      <g transform="rotate(180, 36, 50)">
        <text x="5" y="16" fontSize={fontSize} fontWeight="700" fill={color}
          fontFamily="'JetBrains Mono',monospace">{displayRank}</text>
        <text x="5" y="26" fontSize="9" fill={color}>{symbol}</text>
      </g>
      {/* Center suit */}
      <text x="36" y="58" textAnchor="middle" fontSize="32" fill={color}>{symbol}</text>
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
        fill="none" stroke="rgba(212,175,55,.15)" strokeWidth="1.5" strokeDasharray="4 3"/>
    </svg>
  );
}
