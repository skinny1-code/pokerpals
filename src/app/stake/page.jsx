'use client';
import { useState, useCallback, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useWallet, useStaking } from '../../hooks/usePokerWallet';

const TIERS = [
  { id:0, name:'Standard', icon:'♠', stake:0,           rake:'1.5%', apr:'0%',  color:'#6a9a6a', border:'#1a3a1a' },
  { id:1, name:'Bronze',   icon:'◈', stake:25_000,      rake:'1.3%', apr:'5%',  color:'#cd7f32', border:'#cd7f3244' },
  { id:2, name:'Silver',   icon:'◈', stake:250_000,     rake:'1.1%', apr:'8%',  color:'#c0c0c0', border:'#c0c0c044' },
  { id:3, name:'Gold',     icon:'◈', stake:1_000_000,   rake:'0.9%', apr:'12%', color:'#d4af37', border:'#d4af3744' },
  { id:4, name:'Whale',    icon:'◈', stake:5_000_000,   rake:'0.6%', apr:'18%', color:'#9b59b6', border:'#9b59b644' },
];

function fmt(v) {
  return v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
       : v >= 1_000     ? `${(v/1_000).toFixed(1)}K`
       : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function TxButton({ onClick, disabled, loading, color, children, wide }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled || loading}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: `linear-gradient(135deg,${color}22,${color}11)`,
        border: `1px solid ${disabled ? color+'22' : hov ? color : color+'66'}`,
        borderRadius: 8, padding: wide ? '10px 28px' : '10px',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        color: disabled ? color+'44' : hov ? '#fff' : color,
        fontSize: 12, fontWeight: 700, fontFamily: 'inherit', letterSpacing: .5,
        transition: 'all .15s', minWidth: wide ? 160 : undefined,
        opacity: loading ? 0.7 : 1,
      }}>
      {loading ? 'Pending…' : children}
    </button>
  );
}

function TierCard({ tier, currentTier, stakedAmount, onStake, onUnstake }) {
  const [hov, setHov] = useState(false);
  const isCurrent = tier.id === currentTier;
  const isNext    = tier.id === currentTier + 1;

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
      background: isCurrent ? `${tier.color}11` : '#0c1e0c',
      border: `1px solid ${isCurrent ? tier.color : hov ? tier.border : '#1a3a1a'}`,
      borderRadius: 12, padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'all .2s',
      boxShadow: isCurrent ? `0 0 20px ${tier.color}22` : 'none',
      position: 'relative',
    }}>
      {isCurrent && (
        <div style={{
          position: 'absolute', top: 10, right: 12,
          fontSize: 8, color: tier.color, border: `1px solid ${tier.color}66`,
          borderRadius: 8, padding: '2px 8px', letterSpacing: 1,
        }}>ACTIVE</div>
      )}
      {isNext && (
        <div style={{
          position: 'absolute', top: 10, right: 12,
          fontSize: 8, color: '#3a6a3a', border: '1px solid #1a3a1a',
          borderRadius: 8, padding: '2px 8px', letterSpacing: 1,
        }}>NEXT TIER</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 28, color: tier.color, lineHeight: 1 }}>{tier.icon}</div>
        <div>
          <div style={{ fontSize: 16, color: tier.color, fontWeight: 700,
            fontFamily: "'Playfair Display',serif" }}>{tier.name}</div>
          <div style={{ fontSize: 10, color: '#3a6a3a', letterSpacing: 1 }}>
            {tier.stake === 0 ? 'No stake required' : `Stake ◈ ${fmt(tier.stake)}+ CHIPS`}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[{ label:'Rake Rate', value:tier.rake }, { label:'Staking APR', value:tier.apr }].map(({ label, value }) => (
          <div key={label} style={{ background: 'rgba(0,0,0,.3)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 1, marginBottom: 3 }}>{label.toUpperCase()}</div>
            <div style={{ fontSize: 18, color: tier.color, fontWeight: 700,
              fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
          </div>
        ))}
      </div>

      {tier.stake > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {tier.id > currentTier && (
            <TxButton onClick={() => onStake(tier)} color={tier.color} wide>
              Stake ◈ {fmt(tier.stake)}
            </TxButton>
          )}
          {isCurrent && stakedAmount > 0 && (
            <TxButton onClick={() => onUnstake(stakedAmount)} color="#c0392b">
              Unstake
            </TxButton>
          )}
        </div>
      )}
    </div>
  );
}

function StakeModal({ tier, chipsBalance, onClose, onConfirm, loading }) {
  const [amount, setAmount] = useState(tier.stake);
  const canAfford = chipsBalance >= tier.stake;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.8)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:300 }}
      onClick={onClose}>
      <div style={{
        background: 'linear-gradient(135deg,#0a1f0a,#060e06)',
        border: '1px solid #d4af37', borderRadius: 16, padding: '32px',
        width: 360, animation: 'fade-in .3s ease forwards',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 9, color: '#d4af3799', letterSpacing: 3, marginBottom: 8 }}>STAKE CHIPS</div>
        <div style={{ fontSize: 22, color: tier.color, fontWeight: 700, marginBottom: 4,
          fontFamily: "'Playfair Display',serif" }}>{tier.name} Tier</div>
        <div style={{ fontSize: 11, color: '#5a8a5a', marginBottom: 24 }}>
          Stake ◈ {fmt(tier.stake)}+ CHIPS to activate {tier.name} benefits.
          Your chips stay in the staking contract and earn {tier.apr} APR.
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1, marginBottom: 6 }}>AMOUNT</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" min={tier.stake} max={Math.floor(chipsBalance)} value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              style={{ flex:1, background:'#0c1e0c', border:'1px solid #1a3a1a',
                borderRadius:6, padding:'8px 12px', color:'#d4af37',
                fontSize:14, fontFamily:"'JetBrains Mono',monospace", outline:'none' }} />
            <button onClick={() => setAmount(Math.floor(chipsBalance))} style={{
              background:'#0c1e0c', border:'1px solid #1a3a1a', borderRadius:6,
              padding:'8px 10px', cursor:'pointer', color:'#6a9a6a', fontSize:10, fontFamily:'inherit',
            }}>MAX</button>
          </div>
          {!canAfford && (
            <div style={{ fontSize:10, color:'#c0392b', marginTop:6 }}>
              Insufficient balance (◈ {fmt(Math.floor(chipsBalance))} available)
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            flex:1, background:'transparent', border:'1px solid #1a3a1a',
            borderRadius:8, padding:'10px', cursor:'pointer', color:'#6a9a6a', fontSize:12, fontFamily:'inherit',
          }}>Cancel</button>
          <TxButton onClick={() => onConfirm(amount)}
            disabled={!canAfford || amount < tier.stake} loading={loading}
            color={tier.color} wide>
            Stake ◈ {fmt(amount)}
          </TxButton>
        </div>
      </div>
    </div>
  );
}

export default function StakePage() {
  const { chipsBalance, isConnected } = useWallet();
  const {
    stakedAmount, currentTier, lockedUntil, pendingYield, rakebackOwed,
    stake, unstake, claimYield, claimRakeback, compound, status, confirmed, refetch,
  } = useStaking();

  const [selectedTier, setSelectedTier] = useState(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isLocked = lockedUntil > Date.now() / 1000;
  const unlockDate = isLocked ? new Date(lockedUntil * 1000).toLocaleDateString() : null;

  const handleStake = useCallback(async (amount) => {
    setSelectedTier(null);
    await stake(amount);
    refetch();
  }, [stake, refetch]);

  const handleUnstake = useCallback(async (amount) => {
    await unstake(amount);
    refetch();
  }, [unstake, refetch]);

  const handleClaimYield = useCallback(async () => {
    await claimYield();
    refetch();
  }, [claimYield, refetch]);

  const handleClaimRakeback = useCallback(async () => {
    await claimRakeback();
    refetch();
  }, [claimRakeback, refetch]);

  const handleCompound = useCallback(async () => {
    await compound();
    refetch();
  }, [compound, refetch]);

  const loading = status !== 'idle' && status !== 'error';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)' }}>
      <WalletBar />

      {/* Hero */}
      <div className="page-hero">
        <div style={{ maxWidth:800, margin:'0 auto', position:'relative', zIndex:1 }}>
          <div style={{ fontSize:10, color:'#3a6a3a', letterSpacing:3, marginBottom:10, fontWeight:700 }}>
            VIP TIERS
          </div>
          <h1 style={{
            fontSize:36, color:'#d4af37', fontWeight:700, marginBottom:10,
            fontFamily:"'Playfair Display',serif",
            textShadow:'0 0 40px rgba(212,175,55,.2)',
          }}>
            Stake CHIPS, Play Better Poker
          </h1>
          <p style={{ fontSize:13, color:'#5a8a5a', maxWidth:520, lineHeight:1.7 }}>
            Lock CHIPS to reduce your rake rate and earn passive yield.
            Higher tier = less rake every hand.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '28px 16px' }}>

        {/* Stats bar */}
        {mounted && isConnected && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))',
            gap: 8, marginBottom: 24 }}>
            {[
              { label: 'CHIPS Balance',  value: `◈ ${fmt(Math.floor(chipsBalance || 0))}`,  color: '#d4af37' },
              { label: 'Staked',         value: `◈ ${fmt(stakedAmount)}`,                    color: TIERS[currentTier].color },
              { label: 'Pending Yield',  value: `◈ ${fmt(pendingYield)}`,                   color: '#27ae60' },
              { label: 'Rakeback Owed',  value: `◈ ${fmt(rakebackOwed)}`,                   color: '#2980b9' },
            ].map(s => (
              <div key={s.label} style={{ background: '#0c1e0c', border: '1px solid #1a3a1a',
                borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 16, color: s.color, fontWeight: 700,
                  fontFamily: "'JetBrains Mono',monospace" }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Lock warning */}
        {isLocked && (
          <div style={{ background: 'rgba(230,126,34,.08)', border: '1px solid #e67e2244',
            borderRadius: 8, padding: '10px 16px', marginBottom: 16,
            fontSize: 11, color: '#e67e22' }}>
            ⏳ Stake locked until {unlockDate} — unstaking will be available then.
          </div>
        )}

        {/* Tier cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
          {TIERS.map(t => (
            <TierCard key={t.id} tier={t} currentTier={currentTier}
              stakedAmount={stakedAmount}
              onStake={setSelectedTier}
              onUnstake={handleUnstake} />
          ))}
        </div>

        {/* Yield + Rakeback claim */}
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 12,
            padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#27ae60', fontWeight: 700, marginBottom: 6 }}>
              Staking Yield
            </div>
            <div style={{ fontSize: 22, color: '#27ae60', fontWeight: 700,
              fontFamily: "'JetBrains Mono',monospace", marginBottom: 12 }}>
              ◈ {fmt(pendingYield)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <TxButton onClick={handleClaimYield} disabled={pendingYield < 0.01 || !isConnected}
                loading={loading && status === 'claiming'} color="#27ae60" wide>
                Claim Yield
              </TxButton>
              <TxButton onClick={handleCompound} disabled={pendingYield < 0.01 || !isConnected || currentTier === 0}
                loading={loading && status === 'compounding'} color="#9b59b6" wide>
                ↻ Compound
              </TxButton>
            </div>
          </div>

          <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 12,
            padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#2980b9', fontWeight: 700, marginBottom: 6 }}>
              Rakeback (5% of rake)
            </div>
            <div style={{ fontSize: 22, color: '#2980b9', fontWeight: 700,
              fontFamily: "'JetBrains Mono',monospace", marginBottom: 12 }}>
              ◈ {fmt(rakebackOwed)}
            </div>
            <TxButton onClick={handleClaimRakeback} disabled={rakebackOwed < 0.01 || !isConnected}
              loading={loading && status === 'claiming'} color="#2980b9" wide>
              Claim Rakeback
            </TxButton>
          </div>
        </div>

        {mounted && !isConnected && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#3a6a3a', fontSize: 12 }}>
            Connect your wallet to see your staking position
          </div>
        )}
      </div>

      {selectedTier && (
        <StakeModal tier={selectedTier} chipsBalance={chipsBalance || 0}
          loading={loading} onClose={() => setSelectedTier(null)} onConfirm={handleStake} />
      )}
    </div>
  );
}
