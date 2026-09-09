'use client';
import { useState, useCallback, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useWallet, useStaking, useLottery } from '../../hooks/usePokerWallet';

const TIERS = [
  { id:0, name:'Standard', icon:'♠', stake:0,           rake:'1.5%', apr:'0%',  color:'#8d877a', border:'rgba(141,135,122,.3)', glow:'rgba(141,135,122,.25)' },
  { id:1, name:'Bronze',   icon:'◈', stake:25_000,      rake:'1.3%', apr:'5%',  color:'#cd7f32', border:'rgba(205,127,50,.35)', glow:'rgba(205,127,50,.3)' },
  { id:2, name:'Silver',   icon:'◈', stake:250_000,     rake:'1.1%', apr:'8%',  color:'#cdd3da', border:'rgba(205,211,218,.35)', glow:'rgba(205,211,218,.28)' },
  { id:3, name:'Gold',     icon:'◈', stake:1_000_000,   rake:'0.9%', apr:'12%', color:'#d9c08a', border:'rgba(217,192,138,.4)',  glow:'rgba(217,192,138,.35)' },
  { id:4, name:'Whale',    icon:'◈', stake:5_000_000,   rake:'0.6%', apr:'18%', color:'#f0e6cf', border:'rgba(240,230,207,.55)', glow:'rgba(217,192,138,.5)', luxe:true },
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
        background: hov && !disabled
          ? `linear-gradient(135deg,${color}33,${color}1a)`
          : `linear-gradient(135deg,${color}22,${color}0d)`,
        border: `1px solid ${disabled ? color+'22' : hov ? color : color+'66'}`,
        borderRadius: 'var(--r-sm)', padding: wide ? '11px 28px' : '11px',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        color: disabled ? color+'55' : hov ? '#fff' : color,
        fontSize: 12, fontWeight: 800, fontFamily: 'inherit', letterSpacing: .5,
        transition: 'all .18s ease', minWidth: wide ? 160 : undefined,
        opacity: loading ? 0.7 : 1,
        boxShadow: hov && !disabled ? `0 6px 20px ${color}33` : 'none',
        transform: hov && !disabled ? 'translateY(-1px)' : 'none',
      }}>
      {loading ? 'Pending…' : children}
    </button>
  );
}

function TierCard({ tier, currentTier, stakedAmount, onStake, onUnstake, isLocked }) {
  const [hov, setHov] = useState(false);
  const isCurrent = tier.id === currentTier;
  const isNext    = tier.id === currentTier + 1;
  const luxe      = tier.luxe;

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
      position: 'relative', overflow: 'hidden',
      background: luxe
        ? 'linear-gradient(160deg, rgba(30,26,18,.85), rgba(12,16,9,.9))'
        : isCurrent
          ? `linear-gradient(160deg, ${tier.color}1a, rgba(14,14,16,.85))`
          : 'linear-gradient(160deg, rgba(18,32,20,.7), rgba(11,11,13,.82))',
      border: `1px solid ${isCurrent ? tier.color : luxe ? tier.border : hov ? tier.border : 'var(--border)'}`,
      borderRadius: 'var(--r-lg)', padding: '22px 24px',
      display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'transform .22s ease, box-shadow .22s ease, border-color .22s ease',
      transform: hov ? 'translateY(-3px)' : 'none',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      boxShadow: isCurrent
        ? `0 0 34px ${tier.glow}, inset 0 1px 0 rgba(255,255,255,.05)`
        : luxe
          ? `0 14px 40px rgba(0,0,0,.5), 0 0 30px ${tier.glow}, inset 0 1px 0 rgba(240,230,207,.12)`
          : hov
            ? `0 14px 34px rgba(0,0,0,.55), 0 0 0 1px ${tier.border}`
            : 'var(--shadow-sm)',
    }}>
      {/* Gold top hairline */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${tier.color}, transparent)`,
        opacity: luxe ? 1 : .7,
      }} />
      {/* Luxe corner glow for the Whale tier */}
      {luxe && (
        <div aria-hidden style={{
          position: 'absolute', right: -50, top: -50, width: 200, height: 200,
          background: 'radial-gradient(circle, rgba(217,192,138,.14) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}

      {isCurrent && (
        <div className="pill" style={{
          position: 'absolute', top: 14, right: 14, padding: '4px 11px',
          fontSize: 8, letterSpacing: 2, color: tier.color,
          border: `1px solid ${tier.border}`, background: `${tier.color}1a`,
        }}>ACTIVE</div>
      )}
      {isNext && (
        <div className="pill" style={{
          position: 'absolute', top: 14, right: 14, padding: '4px 11px',
          fontSize: 8, letterSpacing: 2,
        }}>NEXT TIER</div>
      )}
      {luxe && !isCurrent && !isNext && (
        <div className="pill" style={{
          position: 'absolute', top: 14, right: 14, padding: '4px 11px',
          fontSize: 8, letterSpacing: 2, color: 'var(--gold-pale)',
          border: '1px solid var(--border-gold)', background: 'rgba(217,192,138,.1)',
        }}>★ ELITE</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
        <div style={{
          width: 50, height: 50, borderRadius: 'var(--r-md)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, color: tier.color, lineHeight: 1,
          background: `linear-gradient(145deg, ${tier.color}26, ${tier.color}08)`,
          border: `1px solid ${tier.border}`,
          boxShadow: luxe ? `0 0 18px ${tier.glow}` : 'none',
        }}>{tier.icon}</div>
        <div>
          <div className={luxe ? 'gold-text serif' : 'serif'} style={{
            fontSize: 19, fontWeight: 800, lineHeight: 1.1,
            color: luxe ? undefined : tier.color,
          }}>{tier.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, marginTop: 3 }}>
            {tier.stake === 0 ? 'No stake required' : `Stake ◈ ${fmt(tier.stake)}+ ALLIN`}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, position: 'relative' }}>
        {[{ label:'Rake Rate', value:tier.rake }, { label:'Staking APR', value:tier.apr }].map(({ label, value }) => (
          <div key={label} style={{
            background: 'rgba(5,5,6,.5)', borderRadius: 'var(--r-sm)', padding: '11px 14px',
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 1.5, marginBottom: 5, fontWeight: 800 }}>{label.toUpperCase()}</div>
            <div className={luxe ? 'gold-text' : ''} style={{
              fontSize: 22, fontWeight: 900,
              color: luxe ? undefined : tier.color,
              fontFamily: "'JetBrains Mono',monospace", lineHeight: 1,
            }}>{value}</div>
          </div>
        ))}
      </div>

      {tier.stake > 0 && (
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          {tier.id > currentTier && (
            <TxButton onClick={() => onStake(tier)} color={tier.color} wide>
              Stake ◈ {fmt(tier.stake)}
            </TxButton>
          )}
          {isCurrent && stakedAmount > 0 && (
            <TxButton onClick={() => onUnstake(stakedAmount)} disabled={isLocked} color="#e0473b">
              {isLocked ? 'Locked' : 'Unstake'}
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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.82)',
      backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:16 }}
      onClick={onClose}>
      <div className="glass-strong" style={{
        padding: '32px', width: '100%', maxWidth: 380,
        boxShadow:'0 28px 70px rgba(0,0,0,.75)',
        animation: 'pop-in .26s ease forwards',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 3, marginBottom: 8, fontWeight: 800 }}>STAKE ALLIN</div>
        <div className="gold-text serif" style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>{tier.name} Tier</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
          Stake ◈ {fmt(tier.stake)}+ ALLIN to activate {tier.name} benefits.
          Your chips stay in the staking contract and earn {tier.apr} APR.
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 8, fontWeight: 800 }}>AMOUNT</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" min={tier.stake} max={Math.floor(chipsBalance)} value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="input"
              style={{ flex:1, padding:'10px 14px', fontSize:15, fontFamily:"'JetBrains Mono',monospace" }} />
            <button onClick={() => setAmount(Math.floor(chipsBalance))} className="btn btn-ghost" style={{
              padding:'8px 14px', fontSize:10, letterSpacing:1,
            }}>MAX</button>
          </div>
          {!canAfford && (
            <div style={{ fontSize:10, color:'var(--red)', marginTop:8 }}>
              Insufficient balance (◈ {fmt(Math.floor(chipsBalance))} available)
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} className="btn btn-ghost" style={{
            flex:1, padding:'10px', fontSize:12,
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

function StakerPerks({ currentTier }) {
  const { enabled, prize, endsAt, entrants, myTickets, entered, enter, status, error } = useLottery();
  const eligible = currentTier >= 1;
  const secsLeft = Math.max(0, endsAt - Math.floor(Date.now() / 1000));
  const days  = Math.floor(secsLeft / 86400);
  const hours = Math.floor((secsLeft % 86400) / 3600);

  return (
    <div style={{
      background: 'linear-gradient(160deg, rgba(217,192,138,.07), rgba(14,14,16,.9))',
      border: '1px solid var(--border-gold)', borderRadius: 'var(--r-lg)',
      padding: '20px 24px', marginBottom: 24,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: '#d9c08a', fontWeight: 800, marginBottom: 14 }}>
        ♠ STAKER PERKS
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>

        {/* Weekly no-loss lottery */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
            Weekly No-Loss Lottery
          </div>
          {enabled ? (
            <>
              <div style={{ fontSize: 12.5, color: '#a29c8e', lineHeight: 1.6, marginBottom: 10 }}>
                Prize <span style={{ color: '#d9c08a', fontWeight: 800 }}>◈ {fmt(prize)}</span>
                {' '}· {entrants} entered · draw in {days}d {hours}h.
                Tickets = your staked ALLIN. Your stake is never touched.
              </div>
              {entered ? (
                <div style={{ fontSize: 12, color: '#27ae60', fontWeight: 800 }}>
                  ✓ Entered with {fmt(myTickets)} tickets — good luck!
                </div>
              ) : (
                <TxButton color="#d9c08a" wide
                  onClick={enter}
                  disabled={!eligible}
                  loading={status === 'entering'}>
                  {eligible ? 'ENTER FREE DRAW' : 'STAKE 25K+ TO ENTER'}
                </TxButton>
              )}
              {error && <div style={{ fontSize: 11, color: '#e74c3c', marginTop: 6 }}>{error}</div>}
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: '#6b6659' }}>Launching soon.</div>
          )}
        </div>

        {/* Freeroll */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
            Staker Freeroll Table
          </div>
          <div style={{ fontSize: 12.5, color: '#a29c8e', lineHeight: 1.6 }}>
            Table <span style={{ color: '#d9c08a', fontWeight: 800 }}>#9100 · Staker Freeroll</span> in
            the lobby is Bronze+ only: free 10K stacks, real opponents, zero risk.
            {eligible
              ? <span style={{ color: '#27ae60', fontWeight: 700 }}> You&apos;re in — take a seat.</span>
              : ' Stake 25,000+ ALLIN to unlock.'}
          </div>
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
  const [flash, setFlash] = useState(null); // { kind:'ok'|'err', text }
  useEffect(() => setMounted(true), []);

  const isLocked = lockedUntil > Date.now() / 1000;
  const unlockDate = isLocked ? new Date(lockedUntil * 1000).toLocaleDateString() : null;

  // Estimated daily yield at the current tier, for an honest "still growing" hint.
  const tierAprPct = parseFloat(TIERS[currentTier]?.apr || '0') || 0;
  const dailyYield = stakedAmount * (tierAprPct / 100) / 365;

  // Refetch a moment after a tx so on-chain state has settled before we re-read.
  const refetchSoon = useCallback(() => { refetch(); setTimeout(refetch, 4000); }, [refetch]);

  const handleStake = useCallback(async (amount) => {
    setSelectedTier(null);
    await stake(amount);
    refetchSoon();
  }, [stake, refetchSoon]);

  const handleUnstake = useCallback(async (amount) => {
    const tx = await unstake(amount);
    setFlash(tx
      ? { kind: 'ok', text: `Unstaking ${fmt(amount)} ALLIN back to your wallet.` }
      : { kind: 'err', text: 'Unstake failed — your stake is still locked or the tx was rejected.' });
    refetchSoon();
  }, [unstake, refetchSoon]);

  const handleClaimYield = useCallback(async () => {
    const amt = pendingYield;
    const tx = await claimYield();
    setFlash(tx
      ? { kind: 'ok', text: `Claimed ≈ ${fmt(amt)} ALLIN in yield to your wallet. Your ${fmt(stakedAmount)} stake stays locked and keeps earning.` }
      : { kind: 'err', text: 'Claim failed or was rejected — no ALLIN moved.' });
    refetchSoon();
  }, [claimYield, pendingYield, stakedAmount, refetchSoon]);

  const handleClaimRakeback = useCallback(async () => {
    const amt = rakebackOwed;
    const tx = await claimRakeback();
    setFlash(tx
      ? { kind: 'ok', text: `Claimed ≈ ${fmt(amt)} ALLIN in rakeback to your wallet.` }
      : { kind: 'err', text: 'Claim failed or was rejected — no ALLIN moved.' });
    refetchSoon();
  }, [claimRakeback, rakebackOwed, refetchSoon]);

  const handleCompound = useCallback(async () => {
    const amt = pendingYield;
    const tx = await compound();
    setFlash(tx
      ? { kind: 'ok', text: `Reinvested ≈ ${fmt(amt)} ALLIN into your stake — no dust, no wallet payout, just a bigger position.` }
      : { kind: 'err', text: 'Compound failed or was rejected.' });
    refetchSoon();
  }, [compound, pendingYield, refetchSoon]);

  const loading = status !== 'idle' && status !== 'error';

  return (
    <div className="has-bottom-nav" style={{ minHeight: '100vh', background: 'var(--bg-abyss)' }}>
      <WalletBar />

      {/* Hero */}
      <div className="page-hero felt-texture">
        <div className="aurora" aria-hidden />
        <div style={{ maxWidth:800, margin:'0 auto', position:'relative', zIndex:1 }}>
          <div className="pill animate-up s1" style={{ marginBottom:18, opacity:0 }}>
            <span className="dot-live" />
            VIP TIERS · STAKING
          </div>
          <h1 className="gold-text serif animate-up s2" style={{
            fontSize:38, fontWeight:900, marginBottom:12, lineHeight:1.1, opacity:0,
          }}>
            Stake ALLIN, Play Better Poker
          </h1>
          <p className="animate-up s3" style={{
            fontSize:14.5, color:'#8d877a', maxWidth:520, lineHeight:1.7, opacity:0,
          }}>
            Lock ALLIN to reduce your rake rate and earn passive yield.
            <br/><span style={{ color:'#a59f90' }}>Higher tier = less rake every hand.</span>
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '28px 16px' }}>

        {/* Stats bar */}
        {mounted && isConnected && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))',
            gap: 8, marginBottom: 24 }}>
            {[
              { label: 'ALLIN Balance',  value: `◈ ${fmt(Math.floor(chipsBalance || 0))}`,  color: '#c9b075' },
              { label: 'Staked',         value: `◈ ${fmt(stakedAmount)}`,                    color: TIERS[currentTier].color },
              { label: 'Pending Yield',  value: `◈ ${fmt(pendingYield)}`,                   color: '#27ae60' },
              { label: 'Rakeback Owed',  value: `◈ ${fmt(rakebackOwed)}`,                   color: '#2980b9' },
            ].map(s => (
              <div key={s.label} className="stat-card" style={{ padding: '14px 18px', textAlign: 'left', minWidth: 0 }}>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 1.5, marginBottom: 6, fontWeight: 800 }}>{s.label.toUpperCase()}</div>
                <div style={{ fontSize: 19, color: s.color, fontWeight: 900,
                  fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Staker perks: no-loss lottery + freeroll access */}
        {mounted && isConnected && (
          <StakerPerks currentTier={currentTier} />
        )}

        {/* Transaction result banner — confirms claims so they never look "lost" */}
        {flash && (
          <div style={{
            padding: '12px 16px', marginBottom: 16, fontSize: 12.5, fontWeight: 600,
            borderRadius: 'var(--r-sm)', lineHeight: 1.5,
            display: 'flex', gap: 10, alignItems: 'flex-start',
            background: flash.kind === 'ok' ? 'rgba(39,174,96,.12)' : 'rgba(224,71,59,.12)',
            border: `1px solid ${flash.kind === 'ok' ? 'rgba(39,174,96,.4)' : 'rgba(224,71,59,.4)'}`,
            color: flash.kind === 'ok' ? '#7ee0a8' : '#f0a097',
          }}>
            <span>{flash.kind === 'ok' ? '✓' : '⚠'}</span>
            <span style={{ flex: 1 }}>{flash.text}</span>
            <button onClick={() => setFlash(null)} aria-label="Dismiss"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, opacity: .7 }}>×</button>
          </div>
        )}

        {/* Lock warning */}
        {isLocked && (
          <div className="notice-warn" style={{ padding: '12px 18px', marginBottom: 16, fontSize: 11.5, fontWeight: 600 }}>
            ⏳ Stake locked until {unlockDate} — unstaking will be available then. Your rewards can still be claimed anytime.
          </div>
        )}

        {/* Tier cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
          {TIERS.map(t => (
            <TierCard key={t.id} tier={t} currentTier={currentTier}
              stakedAmount={stakedAmount}
              onStake={setSelectedTier}
              onUnstake={handleUnstake}
              isLocked={isLocked} />
          ))}
        </div>

        {/* Yield + Rakeback claim */}
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="glass-strong" style={{ padding: '22px 24px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>
              STAKING YIELD
            </div>
            <div style={{ fontSize: 28, color: 'var(--emerald-bright)', fontWeight: 900,
              fontFamily: "'JetBrains Mono',monospace", marginBottom: 14, lineHeight: 1,
              textShadow: '0 0 24px rgba(52,211,153,.3)' }}>
              ◈ {fmt(pendingYield)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <TxButton onClick={handleClaimYield} disabled={pendingYield < 0.01 || !isConnected}
                loading={loading && status === 'claiming'} color="#34d399" wide>
                Claim Yield
              </TxButton>
              <TxButton onClick={handleCompound} disabled={pendingYield < 0.01 || !isConnected || currentTier === 0}
                loading={loading && status === 'compounding'} color="#d9c08a" wide>
                ↻ Compound
              </TxButton>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
              Rewards only — your staked ALLIN stay locked and keep earning.
              {currentTier > 0 && dailyYield > 0 && <> Earning ≈ <span style={{ color: 'var(--emerald-bright)' }}>◈ {fmt(dailyYield)}/day</span>.</>}
              {' '}Claiming is an on-chain transaction (small gas fee) — for tiny amounts, <b>Compound</b> reinvests instead.
            </div>
          </div>

          <div className="glass-strong" style={{ padding: '22px 24px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>
              RAKEBACK (5% OF RAKE)
            </div>
            <div className="gold-text" style={{ fontSize: 28, fontWeight: 900,
              fontFamily: "'JetBrains Mono',monospace", marginBottom: 14, lineHeight: 1 }}>
              ◈ {fmt(rakebackOwed)}
            </div>
            <TxButton onClick={handleClaimRakeback} disabled={rakebackOwed < 0.01 || !isConnected}
              loading={loading && status === 'claiming'} color="#d9c08a" wide>
              Claim Rakeback
            </TxButton>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
              5% of the rake you pay, claimable to your wallet. On-chain claim (small gas fee).
            </div>
          </div>
        </div>

        {mounted && !isConnected && (
          <div className="glass" style={{ textAlign: 'center', padding: '32px 24px', marginTop: 24,
            color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600 }}>
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
