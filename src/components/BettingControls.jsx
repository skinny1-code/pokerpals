'use client';
import { useState, useCallback } from 'react';

function ActionButton({ label, sub, onClick, disabled, variant = 'default', wide = false }) {
  const colors = {
    fold:    { bg: 'linear-gradient(135deg,#3a1210,#1a0807)', border: '#e0473b', color: '#f0675a', hover: '#e0473b' },
    check:   { bg: 'linear-gradient(135deg,#0d2438,#091626)', border: '#2f93d8', color: '#86c2e8', hover: '#2f93d8' },
    call:    { bg: 'linear-gradient(135deg,#0a3018,#06190d)', border: '#10b981', color: '#34d399', hover: '#10b981' },
    raise:   { bg: 'linear-gradient(135deg,#322207,#1c1303)', border: '#e8c25a', color: '#f7e7a8', hover: '#f7e7a8' },
    bet:     { bg: 'linear-gradient(135deg,#322207,#1c1303)', border: '#e8c25a', color: '#f7e7a8', hover: '#f7e7a8' },
    'all-in':{ bg: 'linear-gradient(135deg,#321a00,#1c0f00)', border: '#f0902a', color: '#f8b15a', hover: '#f0902a' },
    default: { bg: 'linear-gradient(135deg,#121,#0a0a0a)',    border: '#333',    color: '#aaa',    hover: '#555'    },
  };
  const s = colors[variant] || colors.default;
  const [hov, setHov] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: disabled ? '#111' : s.bg,
        border: `1px solid ${disabled ? '#222' : hov ? s.hover : s.border}`,
        borderRadius: 10,
        padding: wide ? '14px 24px' : '13px 18px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? '#333' : hov ? s.hover : s.color,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13.5, fontWeight: 700, letterSpacing: .5,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        minWidth: wide ? 124 : 84,
        transition: 'all .15s',
        transform: !disabled && hov ? 'translateY(-1px)' : 'none',
        boxShadow: !disabled && hov ? `0 6px 18px ${s.border}33, 0 0 14px ${s.border}33` : 'none',
      }}
    >
      <span>{label}</span>
      {sub && <span style={{ fontSize: 9, opacity: .7, fontWeight: 400 }}>{sub}</span>}
    </button>
  );
}

function BetSlider({ min, max, value, onChange, bigBlind }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(1)}K` : v.toLocaleString();

  const presets = [
    { label: '½ Pot', factor: 0.5 },
    { label: '¾ Pot', factor: 0.75 },
    { label: 'Pot',   factor: 1 },
    { label: '2× BB', factor: null, value: bigBlind * 2 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      {/* preset buttons */}
      <div style={{ display: 'flex', gap: 4 }}>
        {presets.map(p => {
          const v = p.value !== undefined ? p.value : null;
          return (
            <button key={p.label}
              onClick={() => v !== null && onChange(Math.max(min, Math.min(max, v)))}
              style={{
                flex: 1, background: '#0c1e0c', border: '1px solid #1a3a1a',
                borderRadius: 4, padding: '3px 0', cursor: 'pointer',
                color: '#6a9a6a', fontSize: 9, fontWeight: 700, letterSpacing: .5,
                fontFamily: "'JetBrains Mono', monospace",
                transition: 'all .1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#f7e7a8'; e.currentTarget.style.borderColor = '#e8c25a55'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#6a9a6a'; e.currentTarget.style.borderColor = '#1a3a1a'; }}
            >{p.label}</button>
          );
        })}
      </div>

      {/* slider track */}
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{
          width: '100%', height: 4, borderRadius: 2,
          background: '#0c1e0c', border: '1px solid #1a3a1a',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${pct}%`, background: 'linear-gradient(90deg, #10b981, #e8c25a)',
            borderRadius: 2, transition: 'width .05s',
          }} />
        </div>
        <input type="range" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', height: 20,
          }}
        />
        {/* thumb indicator */}
        <div style={{
          position: 'absolute', left: `${pct}%`, width: 16, height: 16,
          background: 'radial-gradient(circle at 35% 30%, #f7e7a8, #e8c25a 70%)',
          borderRadius: '50%', transform: 'translateX(-50%)',
          border: '2px solid #050a06', boxShadow: '0 0 8px #e8c25a88',
          pointerEvents: 'none', transition: 'left .05s',
        }} />
      </div>

      {/* value display */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#8aaa8a', fontFamily: "'JetBrains Mono', monospace" }}>
          MIN {fmt(min)}
        </span>
        <div style={{
          background: '#0c1e0c', border: '1px solid #d4af3744',
          borderRadius: 6, padding: '2px 12px',
          fontSize: 13, color: '#d4af37', fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          ◈ {fmt(value)}
        </div>
        <span style={{ fontSize: 9, color: '#8aaa8a', fontFamily: "'JetBrains Mono', monospace" }}>
          MAX {fmt(max)}
        </span>
      </div>
    </div>
  );
}

export default function BettingControls({
  isActive = false,
  inGame = false,
  canCheck = false,
  callAmount = 0,
  minRaise = 0,
  maxRaise = 0,
  pot = 0,
  bigBlind = 100,
  playerChips = 0,
  onFold,
  onCheck,
  onCall,
  onRaise,
  onAllIn,
  disabled = false,
}) {
  const [raiseAmount, setRaiseAmount] = useState(minRaise || bigBlind * 2);
  const [showRaise, setShowRaise] = useState(false);

  const canCall   = callAmount > 0 && callAmount < playerChips;
  const canRaise  = minRaise > 0 && playerChips > callAmount;
  const canAllIn  = playerChips > 0;
  const isAllInCall = callAmount >= playerChips;

  const handleRaise = useCallback(() => {
    if (showRaise) {
      onRaise?.(raiseAmount);
      setShowRaise(false);
    } else {
      setShowRaise(true);
    }
  }, [showRaise, raiseAmount, onRaise]);

  if (!isActive) {
    if (!inGame) return null;
    // Dimmed placeholder so layout stays stable during opponent's turn
    return (
      <div className="betting-controls betting-controls-bar" style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 640,
        background: 'linear-gradient(0deg, rgba(6,14,6,.98) 0%, rgba(6,14,6,.7) 100%)',
        padding: '12px 20px 20px', zIndex: 100,
        display: 'flex', justifyContent: 'center', gap: 8,
      }}>
        {['FOLD', 'CHECK', 'RAISE'].map(label => (
          <div key={label} style={{
            background: '#060e06', border: '1px solid #0a150a',
            borderRadius: 8, padding: '10px 16px',
            color: '#0f1f0f', fontSize: 13, fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            minWidth: 80, textAlign: 'center', userSelect: 'none',
          }}>{label}</div>
        ))}
      </div>
    );
  }

  const potOdds = callAmount > 0 && pot > 0
    ? `${Math.round((callAmount / (pot + callAmount)) * 100)}%`
    : null;

  return (
    <div className="betting-controls betting-controls-bar" style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 640,
      background: 'linear-gradient(0deg, rgba(6,14,6,.98) 0%, rgba(6,14,6,.85) 80%, transparent 100%)',
      padding: '16px 20px 20px',
      zIndex: 100,
    }}>
      {/* pot odds hint */}
      {potOdds && (
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: '#8aaa8a', letterSpacing: 1,
            fontFamily: "'JetBrains Mono', monospace" }}>
            POT ODDS  {potOdds}  •  TO CALL  ◈ {callAmount.toLocaleString()}  •  POT  ◈ {pot.toLocaleString()}
          </span>
        </div>
      )}

      {/* raise slider */}
      {showRaise && (
        <div style={{ marginBottom: 12, padding: '12px 16px',
          background: 'rgba(0,0,0,.6)', borderRadius: 10,
          border: '1px solid #1a3a1a' }}>
          <BetSlider
            min={minRaise}
            max={maxRaise || playerChips}
            value={Math.min(Math.max(raiseAmount, minRaise), maxRaise || playerChips)}
            onChange={setRaiseAmount}
            bigBlind={bigBlind}
          />
        </div>
      )}

      {/* action buttons */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <ActionButton
          label="FOLD"
          variant="fold"
          disabled={disabled}
          onClick={() => { setShowRaise(false); onFold?.(); }}
        />

        {canCheck ? (
          <ActionButton
            label="CHECK"
            variant="check"
            disabled={disabled}
            onClick={() => { setShowRaise(false); onCheck?.(); }}
          />
        ) : (
          <ActionButton
            label={isAllInCall ? 'ALL IN' : 'CALL'}
            sub={isAllInCall ? `◈ ${playerChips.toLocaleString()}` : `◈ ${callAmount.toLocaleString()}`}
            variant={isAllInCall ? 'all-in' : 'call'}
            disabled={disabled || (!canCall && !isAllInCall)}
            onClick={() => { setShowRaise(false); isAllInCall ? onAllIn?.() : onCall?.(); }}
          />
        )}

        <ActionButton
          label={showRaise ? 'CONFIRM' : (pot === 0 ? 'BET' : 'RAISE')}
          sub={showRaise ? `◈ ${raiseAmount.toLocaleString()}` : undefined}
          variant={showRaise ? 'raise' : 'raise'}
          disabled={disabled || !canRaise}
          wide={showRaise}
          onClick={handleRaise}
        />

        {canAllIn && !isAllInCall && (
          <ActionButton
            label="ALL IN"
            sub={`◈ ${playerChips.toLocaleString()}`}
            variant="all-in"
            disabled={disabled}
            onClick={() => { setShowRaise(false); onAllIn?.(); }}
          />
        )}
      </div>
    </div>
  );
}
