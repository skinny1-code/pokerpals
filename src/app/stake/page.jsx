'use client';
import { useState, useCallback } from 'react';
import WalletBar from '../../components/WalletBar';
import { useWallet } from '../../hooks/usePokerWallet';

const TIERS = [
  { id:0, name:'Standard', icon:'♠', stake:0,       rake:'1.5%', apr:'0%',  color:'#6a9a6a', border:'#1a3a1a' },
  { id:1, name:'Bronze',   icon:'◈', stake:1_000,   rake:'1.3%', apr:'2%',  color:'#cd7f32', border:'#cd7f3244' },
  { id:2, name:'Silver',   icon:'◈', stake:10_000,  rake:'1.1%', apr:'4%',  color:'#c0c0c0', border:'#c0c0c044' },
  { id:3, name:'Gold',     icon:'◈', stake:50_000,  rake:'0.9%', apr:'7%',  color:'#d4af37', border:'#d4af3744' },
  { id:4, name:'Whale',    icon:'◈', stake:200_000, rake:'0.6%', apr:'12%', color:'#9b59b6', border:'#9b59b644' },
];

function TierCard({ tier, currentTier, onStake }) {
  const [hov, setHov] = useState(false);
  const isCurrent = tier.id === currentTier;
  const isLocked  = tier.id > currentTier;
  const fmt = v => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v/1_000).toFixed(0)}K` : String(v);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: isCurrent ? `${tier.color}11` : '#0c1e0c',
        border: `1px solid ${isCurrent ? tier.color : hov ? tier.border : '#1a3a1a'}`,
        borderRadius:12, padding:'20px 24px',
        display:'flex', flexDirection:'column', gap:12,
        transition:'all .2s',
        boxShadow: isCurrent ? `0 0 20px ${tier.color}22` : 'none',
        position:'relative', overflow:'hidden',
      }}
    >
      {isCurrent && (
        <div style={{
          position:'absolute', top:10, right:12,
          fontSize:8, color:tier.color, border:`1px solid ${tier.color}66`,
          borderRadius:8, padding:'2px 8px', letterSpacing:1,
        }}>CURRENT TIER</div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ fontSize:28, color:tier.color, lineHeight:1 }}>{tier.icon}</div>
        <div>
          <div style={{ fontSize:16, color:tier.color, fontWeight:700,
            fontFamily:"'Playfair Display',serif" }}>{tier.name}</div>
          <div style={{ fontSize:10, color:'#3a6a3a', letterSpacing:1 }}>
            {tier.stake === 0 ? 'No stake required' : `Stake ◈ ${fmt(tier.stake)}+ CHIPS`}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {[
          { label:'Rake Rate', value:tier.rake },
          { label:'Staking APR', value:tier.apr },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background:'rgba(0,0,0,.3)', borderRadius:8, padding:'8px 12px',
          }}>
            <div style={{ fontSize:8, color:'#3a6a3a', letterSpacing:1, marginBottom:3 }}>{label.toUpperCase()}</div>
            <div style={{ fontSize:18, color:tier.color, fontWeight:700,
              fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
          </div>
        ))}
      </div>

      {tier.stake > 0 && (
        <button
          onClick={() => onStake(tier)}
          disabled={isCurrent || isLocked}
          style={{
            background: isCurrent ? 'transparent' : `linear-gradient(135deg,${tier.color}22,${tier.color}11)`,
            border:`1px solid ${isCurrent ? tier.color+'44' : tier.border}`,
            borderRadius:8, padding:'10px', cursor: isCurrent ? 'default' : 'pointer',
            color: isCurrent ? tier.color+'66' : tier.color,
            fontSize:12, fontWeight:700, fontFamily:'inherit', letterSpacing:.5,
            transition:'all .15s',
          }}
        >
          {isCurrent ? 'Currently Active' : tier.id > currentTier ? `Stake ◈ ${fmt(tier.stake)}` : 'Downgrade'}
        </button>
      )}
    </div>
  );
}

function StakeModal({ tier, chipsBalance, onClose, onConfirm }) {
  const [amount, setAmount] = useState(tier.stake);
  const fmt = v => v >= 1_000 ? `${(v/1_000).toFixed(1)}K` : String(v);
  const canAfford = chipsBalance >= tier.stake;

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.8)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:300,
    }} onClick={onClose}>
      <div style={{
        background:'linear-gradient(135deg,#0a1f0a,#060e06)',
        border:'1px solid #d4af37', borderRadius:16, padding:'32px',
        width:360, animation:'fade-in .3s ease forwards',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:9, color:'#d4af3799', letterSpacing:3, marginBottom:8 }}>STAKE CHIPS</div>
        <div style={{ fontSize:22, color:tier.color, fontWeight:700, marginBottom:4,
          fontFamily:"'Playfair Display',serif" }}>{tier.name} Tier</div>
        <div style={{ fontSize:11, color:'#5a8a5a', marginBottom:24 }}>
          Stake ◈ {fmt(tier.stake)}+ CHIPS to activate {tier.name} tier benefits.
          Your chips stay in the staking contract and earn {tier.apr} APR.
        </div>

        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:9, color:'#3a6a3a', letterSpacing:1, marginBottom:6 }}>AMOUNT TO STAKE</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input
              type="number"
              min={tier.stake}
              max={Math.floor(chipsBalance)}
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              style={{
                flex:1, background:'#0c1e0c', border:'1px solid #1a3a1a',
                borderRadius:6, padding:'8px 12px', color:'#d4af37',
                fontSize:14, fontFamily:"'JetBrains Mono',monospace", outline:'none',
              }}
            />
            <button onClick={() => setAmount(Math.floor(chipsBalance))} style={{
              background:'#0c1e0c', border:'1px solid #1a3a1a', borderRadius:6,
              padding:'8px 10px', cursor:'pointer', color:'#6a9a6a',
              fontSize:10, fontFamily:'inherit',
            }}>MAX</button>
          </div>
          {!canAfford && (
            <div style={{ fontSize:10, color:'#c0392b', marginTop:6 }}>
              Insufficient CHIPS (balance: ◈ {fmt(Math.floor(chipsBalance))})
            </div>
          )}
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{
            flex:1, background:'transparent', border:'1px solid #1a3a1a',
            borderRadius:8, padding:'10px', cursor:'pointer', color:'#6a9a6a',
            fontSize:12, fontFamily:'inherit',
          }}>Cancel</button>
          <button onClick={() => onConfirm(amount)} disabled={!canAfford || amount < tier.stake} style={{
            flex:2, background:`linear-gradient(135deg,${tier.color}33,${tier.color}11)`,
            border:`1px solid ${tier.color}66`, borderRadius:8, padding:'10px',
            cursor: canAfford ? 'pointer' : 'not-allowed',
            color: tier.color, fontSize:12, fontWeight:700, fontFamily:'inherit',
          }}>
            Stake ◈ {fmt(amount)} CHIPS
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StakePage() {
  const { chipsBalance, isConnected } = useWallet();
  const [selectedTier, setSelectedTier] = useState(null);
  const currentTier = 0; // TODO: read from ChipsStaking contract via useReadContract

  const handleConfirmStake = useCallback((amount) => {
    // TODO: call ChipsStaking.stake(amount) via useWriteContract
    console.log('Stake', amount, 'CHIPS for tier', selectedTier?.id);
    setSelectedTier(null);
  }, [selectedTier]);

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg-deep)' }}>
      <WalletBar />

      <div style={{ maxWidth:800, margin:'0 auto', padding:'32px 16px' }}>
        {/* Header */}
        <div style={{ marginBottom:32 }}>
          <div style={{ fontSize:11, color:'#3a6a3a', letterSpacing:3, marginBottom:8 }}>
            VIP TIERS
          </div>
          <h1 style={{ fontSize:28, color:'#d4af37', fontWeight:700, marginBottom:8,
            fontFamily:"'Playfair Display',serif" }}>
            Stake CHIPS, Play Better Poker
          </h1>
          <p style={{ fontSize:12, color:'#5a8a5a', maxWidth:560 }}>
            Lock CHIPS in the staking contract to reduce your rake rate and earn passive yield.
            Higher tiers pay less rake — more of every pot stays with you.
          </p>
        </div>

        {/* Balance bar */}
        {isConnected && (
          <div style={{
            background:'#0c1e0c', border:'1px solid #1a3a1a', borderRadius:10,
            padding:'12px 20px', marginBottom:24,
            display:'flex', alignItems:'center', justifyContent:'space-between',
          }}>
            <span style={{ fontSize:11, color:'#5a8a5a' }}>Your CHIPS balance</span>
            <span style={{ fontSize:16, color:'#d4af37', fontWeight:700,
              fontFamily:"'JetBrains Mono',monospace" }}>
              ◈ {Math.floor(chipsBalance || 0).toLocaleString()}
            </span>
          </div>
        )}

        {/* Tier cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:16 }}>
          {TIERS.map(t => (
            <TierCard
              key={t.id}
              tier={t}
              currentTier={currentTier}
              onStake={setSelectedTier}
            />
          ))}
        </div>

        {/* Rakeback info */}
        <div style={{
          marginTop:32, padding:'20px 24px',
          background:'#0c1e0c', border:'1px solid #1a3a1a', borderRadius:12,
        }}>
          <div style={{ fontSize:12, color:'#d4af37', fontWeight:700, marginBottom:8 }}>
            Rakeback — 5% back on every hand
          </div>
          <div style={{ fontSize:11, color:'#5a8a5a', marginBottom:16 }}>
            Every player earns 5% rakeback regardless of tier. Accrues automatically in the escrow contract and is claimable at any time.
          </div>
          <button style={{
            background:'transparent', border:'1px solid #d4af3744', borderRadius:8,
            padding:'8px 20px', cursor:'pointer', color:'#d4af37',
            fontSize:12, fontFamily:'inherit',
          }}>
            Claim Rakeback ◈ 0
          </button>
        </div>
      </div>

      {selectedTier && (
        <StakeModal
          tier={selectedTier}
          chipsBalance={chipsBalance || 0}
          onClose={() => setSelectedTier(null)}
          onConfirm={handleConfirmStake}
        />
      )}
    </div>
  );
}
