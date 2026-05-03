'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import WalletBar from '../components/WalletBar';

const GAME_TYPE_LABEL = { 0: "No Limit Hold'em", 1: 'Pot Limit Omaha' };
const STATUS_LABEL = { 0: 'Waiting', 1: 'Active', 2: 'Paused' };
const STATUS_COLOR = { 0: '#d4af37', 1: '#27ae60', 2: '#e67e22' };

// Mock tables for UI dev — replace with on-chain reads
const MOCK_TABLES = [
  { id: 1, name: 'High Rollers',  buyIn: 10000,  bigBlind: 200,  maxPlayers: 9, seated: 6, status: 1, gameType: 0, roomName: null   },
  { id: 2, name: 'Micro Stakes',  buyIn: 100,    bigBlind: 2,    maxPlayers: 6, seated: 2, status: 0, gameType: 0, roomName: null   },
  { id: 3, name: 'Bored Apes',    buyIn: 50000,  bigBlind: 1000, maxPlayers: 6, seated: 4, status: 1, gameType: 0, roomName: 'BAYC Poker Club', nftGated: true },
  { id: 4, name: 'Omaha $1/$2',   buyIn: 400,    bigBlind: 4,    maxPlayers: 6, seated: 0, status: 0, gameType: 1, roomName: null   },
  { id: 5, name: 'Mid Stakes',    buyIn: 2000,   bigBlind: 40,   maxPlayers: 9, seated: 7, status: 1, gameType: 0, roomName: null   },
  { id: 6, name: 'Whales Only',   buyIn: 500000, bigBlind: 10000,maxPlayers: 4, seated: 1, status: 0, gameType: 0, roomName: null   },
];

const STATS = [
  { label: 'Players Online', value: '1,284', icon: '◉' },
  { label: 'Active Tables',  value: '147',   icon: '♠' },
  { label: 'Total Pot',      value: '2.4M',  icon: '◈', unit: 'CHIPS' },
  { label: 'Hands Played',   value: '48K',   icon: '♣', unit: 'today' },
];

function StatBubble({ stat }) {
  return (
    <div style={{
      background: '#0c1e0c', border: '1px solid #1a3a1a',
      borderRadius: 10, padding: '12px 20px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      minWidth: 110,
    }}>
      <div style={{ fontSize: 18, color: '#d4af37' }}>{stat.icon}</div>
      <div style={{ fontSize: 18, color: '#d4af37', fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace" }}>{stat.value}</div>
      <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1, textAlign: 'center' }}>
        {stat.label}{stat.unit ? ` (${stat.unit})` : ''}
      </div>
    </div>
  );
}

function TableRow({ table, isHighlighted }) {
  const [hov, setHov] = useState(false);
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(0)}K` : v.toLocaleString();

  return (
    <Link href={`/table/${table.id}`} style={{ textDecoration: 'none' }}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1.2fr 1fr 1fr 80px 80px',
          alignItems: 'center',
          padding: '12px 16px',
          borderRadius: 8,
          background: hov ? 'rgba(212,175,55,.04)' : isHighlighted ? 'rgba(212,175,55,.03)' : 'transparent',
          border: `1px solid ${hov ? '#d4af3733' : isHighlighted ? '#d4af3720' : '#1a3a1a22'}`,
          cursor: 'pointer',
          transition: 'all .15s',
          gap: 8,
        }}
      >
        {/* Name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: hov ? '#d4af37' : '#d0c8b0', fontWeight: 600 }}>
              {table.name}
            </span>
            {table.nftGated && (
              <span style={{ fontSize: 8, color: '#8e44ad', border: '1px solid #8e44ad44',
                borderRadius: 3, padding: '1px 5px', letterSpacing: 1 }}>NFT</span>
            )}
          </div>
          {table.roomName && (
            <span style={{ fontSize: 9, color: '#5a8a5a', letterSpacing: .5 }}>
              ♦ {table.roomName}
            </span>
          )}
        </div>

        {/* Game type */}
        <div style={{ fontSize: 10, color: '#6a9a6a' }}>
          {GAME_TYPE_LABEL[table.gameType] || 'NLH'}
        </div>

        {/* Blinds */}
        <div style={{ fontSize: 11, color: '#a8c8a8',
          fontFamily: "'JetBrains Mono', monospace" }}>
          {fmt(table.bigBlind/2)}/{fmt(table.bigBlind)}
        </div>

        {/* Buy-in */}
        <div style={{ fontSize: 11, color: '#d4af37',
          fontFamily: "'JetBrains Mono', monospace" }}>
          ◈ {fmt(table.buyIn)}
        </div>

        {/* Seats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {Array.from({ length: table.maxPlayers }).map((_, i) => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: '50%',
              background: i < table.seated ? '#27ae60' : '#1a3a1a',
              border: '1px solid rgba(255,255,255,.1)',
            }} />
          ))}
          <span style={{ fontSize: 9, color: '#6a9a6a', marginLeft: 2 }}>
            {table.seated}/{table.maxPlayers}
          </span>
        </div>

        {/* Status */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{
            fontSize: 8, color: STATUS_COLOR[table.status],
            border: `1px solid ${STATUS_COLOR[table.status]}44`,
            borderRadius: 10, padding: '2px 8px', letterSpacing: 1,
            background: `${STATUS_COLOR[table.status]}11`,
          }}>
            {STATUS_LABEL[table.status]}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function LobbyPage() {
  const [filter, setFilter] = useState('all');  // all, nlh, plo, private
  const [sortBy, setSortBy] = useState('status');

  const filters = [
    { id: 'all',     label: 'All Tables' },
    { id: 'nlh',     label: "Hold'em" },
    { id: 'plo',     label: 'Omaha' },
    { id: 'private', label: 'Private Rooms' },
    { id: 'high',    label: 'High Stakes' },
  ];

  const filtered = MOCK_TABLES.filter(t => {
    if (filter === 'nlh') return t.gameType === 0;
    if (filter === 'plo') return t.gameType === 1;
    if (filter === 'private') return !!t.roomName;
    if (filter === 'high') return t.buyIn >= 10000;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'status') return b.status - a.status || b.seated - a.seated;
    if (sortBy === 'buyin') return b.buyIn - a.buyIn;
    if (sortBy === 'players') return b.seated - a.seated;
    return 0;
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)' }}>
      <WalletBar />

      {/* Hero banner */}
      <div style={{
        background: 'linear-gradient(180deg, #0a1f0a 0%, #060e06 100%)',
        borderBottom: '1px solid #1a3a1a',
        padding: '32px 24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, color: '#3a6a3a', letterSpacing: 4, marginBottom: 8 }}>
          ONCHAIN  •  PVP  •  POKER
        </div>
        <h1 style={{
          fontSize: 36, fontWeight: 900, color: '#d4af37',
          fontFamily: "'Playfair Display', serif",
          letterSpacing: 2, marginBottom: 4,
        }}>
          PokerVsPals
        </h1>
        <p style={{ fontSize: 12, color: '#5a8a5a', letterSpacing: 1 }}>
          Real PvP poker. Instant onchain settlement. No house edge. No bots.
        </p>

        {/* Live stats */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          {STATS.map(s => <StatBubble key={s.label} stat={s} />)}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>

        {/* Filter + sort bar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 16, flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {filters.map(f => (
              <button key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  background: filter === f.id ? '#0c1e0c' : 'transparent',
                  border: `1px solid ${filter === f.id ? '#d4af3744' : '#1a3a1a'}`,
                  borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                  color: filter === f.id ? '#d4af37' : '#6a9a6a',
                  fontSize: 11, fontWeight: 700, letterSpacing: .5,
                  fontFamily: 'inherit', transition: 'all .15s',
                }}
              >{f.label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#3a6a3a', letterSpacing: 1 }}>SORT</span>
            {[['status','Live First'],['buyin','Buy-in'],['players','Players']].map(([v,l]) => (
              <button key={v}
                onClick={() => setSortBy(v)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${sortBy === v ? '#d4af3744' : '#1a3a1a'}`,
                  borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                  color: sortBy === v ? '#d4af37' : '#4a7a4a',
                  fontSize: 9, letterSpacing: .5, fontFamily: 'inherit',
                }}
              >{l}</button>
            ))}
          </div>
        </div>

        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1.2fr 1fr 1fr 80px 80px',
          padding: '6px 16px', gap: 8,
          borderBottom: '1px solid #1a3a1a', marginBottom: 4,
        }}>
          {['Table', 'Game', 'Blinds', 'Buy-in', 'Seats', 'Status'].map(h => (
            <div key={h} style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1 }}>{h.toUpperCase()}</div>
          ))}
        </div>

        {/* Table rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.map((t, i) => (
            <TableRow key={t.id} table={t} isHighlighted={i === 0 && t.status === 1} />
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0',
              color: '#3a6a3a', fontSize: 12 }}>
              No tables match this filter
            </div>
          )}
        </div>

        {/* Create room CTA */}
        <div style={{
          marginTop: 32, padding: '24px',
          background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 14, color: '#d4af37', fontWeight: 700, marginBottom: 4 }}>
              Host a Private Room
            </div>
            <div style={{ fontSize: 11, color: '#5a8a5a', maxWidth: 400 }}>
              Lease a private room for 100 CHIPS/week. Set custom buy-ins, NFT-gate for your community, and earn a share of the rake.
            </div>
          </div>
          <Link href="/stake" style={{
            background: 'linear-gradient(135deg, #1a4a1a, #0c2e0c)',
            border: '1px solid #d4af3744', borderRadius: 8,
            padding: '10px 24px', cursor: 'pointer',
            color: '#d4af37', fontSize: 12, fontWeight: 700,
            textDecoration: 'none', letterSpacing: .5,
          }}>
            Lease a Room →
          </Link>
        </div>
      </div>
    </div>
  );
}
