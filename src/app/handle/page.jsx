'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import WalletBar from '../../components/WalletBar';
import VerifyHumanBanner from '../../components/VerifyHumanBanner';
import {
  useWallet, useHandle, useHandleAvatars, useTableSocket,
  useStaking, usePlayerStats, useTournaments, useRegisterTournament,
} from '../../hooks/usePokerWallet';
import Link from 'next/link';

// ─── shared formatting / tier config ──────────────────────────────────────────
const TIERS = [
  { id:0, name:'Standard', stake:0,         rake:'1.5%', apr:'0%',  color:'#8a8478' },
  { id:1, name:'Bronze',   stake:25_000,    rake:'1.3%', apr:'5%',  color:'#cd7f32' },
  { id:2, name:'Silver',   stake:250_000,   rake:'1.1%', apr:'8%',  color:'#c0c0c0' },
  { id:3, name:'Gold',     stake:1_000_000, rake:'0.9%', apr:'12%', color:'#c9b075' },
  { id:4, name:'Whale',    stake:5_000_000, rake:'0.6%', apr:'18%', color:'#9b59b6' },
];
const TOURN_STATUS_LABEL = ['Registration','Running','Settled','Cancelled'];
const TOURN_STATUS_COLOR = ['#27ae60','#e67e22','#8a8478','#e74c3c'];
const GAME_LABEL = { 0:'NLH', 1:'PLO' };

function fmt(v) {
  v = Number(v || 0);
  const a = Math.abs(v);
  return a >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M`
       : a >= 1_000     ? `${(v/1_000).toFixed(1)}K`
       : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function signed(v) { return `${v > 0 ? '+' : ''}${fmt(v)}`; }
function short(a) { return a ? `${a.slice(0,6)}…${a.slice(-4)}` : ''; }

function isValidHandle(h) {
  return h.length >= 3 && h.length <= 20 && /^[a-zA-Z0-9_]+$/.test(h);
}

// ─── small presentational pieces ──────────────────────────────────────────────
function HandlePreview({ handle }) {
  const display = handle || 'YourHandle';
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: 'radial-gradient(ellipse 120% 90% at 50% -10%, rgba(217,192,138,.1), transparent 60%), linear-gradient(160deg, #161619, #09090a)',
      border: '1px solid var(--border-gold)', borderRadius: 'var(--r-lg)',
      width: 180, height: 180, margin: '0 auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8,
      boxShadow: 'var(--shadow-glow-gold), inset 0 1px 0 rgba(255,255,255,.05)',
    }}>
      <div className="gold-text" style={{ fontSize: 40, lineHeight: 1 }}>♠</div>
      <div className="mono" style={{
        fontSize: handle ? 18 : 14, fontWeight: 700, color: 'var(--gold-pale)',
        letterSpacing: 1,
        opacity: handle ? 1 : 0.35,
      }}>{display}</div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, fontWeight: 800 }}>POKER VS PLAYER HANDLE</div>
    </div>
  );
}

function ValidationBadge({ handle }) {
  if (!handle) return null;
  const errors = [];
  if (handle.length < 3) errors.push('At least 3 characters');
  if (handle.length > 20) errors.push('Max 20 characters');
  if (!/^[a-zA-Z0-9_]+$/.test(handle)) errors.push('Letters, numbers, underscores only');
  if (errors.length > 0)
    return <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 4, fontWeight: 600 }}>{errors[0]}</div>;
  return <div style={{ fontSize: 10, color: 'var(--emerald-bright)', marginTop: 4, fontWeight: 600 }}>✓ Valid handle</div>;
}

function StatCard({ label, value, color, sub }) {
  return (
    <div className="stat-card" style={{ padding: '14px 16px', minWidth: 0, textAlign: 'left' }}>
      <div style={{ fontSize: 8.5, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 5, fontWeight: 800 }}>{label}</div>
      <div className={color ? undefined : 'gold-text'} style={{ fontSize: 19, color, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`tab ${active ? 'tab-active' : ''}`}
      style={{
        border: active ? undefined : '1px solid var(--border)',
        padding: '9px 16px', fontSize: 11.5, letterSpacing: .5, whiteSpace: 'nowrap',
      }}>{children}</button>
  );
}

function TxButton({ onClick, disabled, loading, color = '#d9c08a', children, full }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled || loading}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: `linear-gradient(135deg,${color}2e,${color}14)`,
        border: `1px solid ${disabled ? color+'22' : hov ? color : color+'66'}`,
        borderRadius: 'var(--r-sm)', padding: '11px 16px', width: full ? '100%' : undefined,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        color: disabled ? color+'55' : hov ? '#fff' : color,
        fontSize: 12, fontWeight: 700, fontFamily: 'inherit', letterSpacing: .5,
        boxShadow: hov && !disabled ? `0 6px 20px ${color}33` : 'none',
        transition: 'all .15s', opacity: loading ? 0.7 : 1,
      }}>{loading ? 'Pending…' : children}</button>
  );
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────
const FEED_META = {
  buyin:    { icon: '↳', color: '#e67e22', label: 'Bought in',          sign: -1 },
  rebuy:    { icon: '↻', color: '#e67e22', label: 'Re-bought',          sign: -1 },
  cashout:  { icon: '↰', color: '#27ae60', label: 'Cashed out',         sign: +1 },
  handwin:  { icon: '♠', color: '#c9b075', label: 'Won hand',           sign: +1 },
  tournreg: { icon: '🏆', color: '#2980b9', label: 'Registered',        sign: -1 },
  tournwin: { icon: '🏆', color: '#c9b075', label: 'Tournament cash',   sign: +1 },
};

function ActivityRow({ ev }) {
  const m = FEED_META[ev.kind] || { icon: '•', color: '#8a8478', label: ev.kind, sign: 0 };
  const where = ev.table != null ? `Table #${ev.table}` : ev.tourn != null ? `Tournament #${ev.tourn}` : '';
  const place = ev.place ? ` · ${ev.place}${['','st','nd','rd'][ev.place] || 'th'}` : '';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 16px', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{m.icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--cream)', fontWeight: 600 }}>{m.label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{where}{place} · blk {ev.block?.toString()}</div>
      </div>
      <div style={{
        fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
        color: m.sign > 0 ? 'var(--emerald-bright)' : m.sign < 0 ? 'var(--orange)' : 'var(--text-secondary)',
      }}>
        {m.sign > 0 ? '+' : m.sign < 0 ? '−' : ''}◈ {fmt(ev.amount)}
      </div>
    </div>
  );
}

// ─── STAKING PANEL ────────────────────────────────────────────────────────────
function StakingPanel() {
  const { chipsBalance, isConnected } = useWallet();
  const {
    stakedAmount, currentTier, lockedUntil, pendingYield, rakebackOwed,
    stake, unstake, claimYield, claimRakeback, compound, status, refetch,
  } = useStaking();
  const [amount, setAmount] = useState('');
  const loading = status !== 'idle' && status !== 'error';
  const isLocked = lockedUntil > Date.now() / 1000;
  const tier = TIERS[currentTier] || TIERS[0];
  const nextTier = TIERS[currentTier + 1];
  const toNext = nextTier ? Math.max(0, nextTier.stake - stakedAmount) : 0;

  const run = useCallback(async (fn, arg) => { await fn(arg); refetch(); }, [refetch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
        <StatCard label="STAKED" value={`◈ ${fmt(stakedAmount)}`} color={tier.color} sub={`${tier.name} tier`} />
        <StatCard label="VIP RAKE" value={tier.rake} color={tier.color} sub={`${tier.apr} APR`} />
        <StatCard label="PENDING YIELD" value={`◈ ${fmt(pendingYield)}`} color="#27ae60" />
        <StatCard label="RAKEBACK" value={`◈ ${fmt(rakebackOwed)}`} color="#2980b9" />
      </div>

      {nextTier && (
        <div className="glass" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Stake <span style={{ color: nextTier.color, fontWeight: 700 }}>◈ {fmt(toNext)}</span> more to reach{' '}
            <span style={{ color: nextTier.color, fontWeight: 700 }}>{nextTier.name}</span> ({nextTier.rake} rake · {nextTier.apr} APR)
          </div>
          <div style={{ height: 7, background: 'var(--bg-abyss)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4, background: nextTier.color,
              boxShadow: `0 0 10px ${nextTier.color}99`,
              width: `${Math.min(100, (stakedAmount / nextTier.stake) * 100)}%`, transition: 'width .3s',
            }} />
          </div>
        </div>
      )}

      {isLocked && (
        <div className="notice-warn" style={{ borderRadius: 'var(--r-sm)', padding: '11px 14px', fontSize: 11 }}>
          ⏳ Stake locked until {new Date(lockedUntil * 1000).toLocaleDateString()}.
        </div>
      )}

      {/* Stake / unstake input */}
      <div className="glass-strong" style={{ padding: 18 }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 9, fontWeight: 800 }}>AMOUNT (ALLIN)</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input type="number" min={0} value={amount} placeholder="0"
            onChange={e => setAmount(e.target.value)}
            className="input"
            style={{ flex: 1, padding: '11px 12px', fontSize: 14, fontFamily: "'JetBrains Mono',monospace" }} />
          <button onClick={() => setAmount(String(Math.floor(chipsBalance || 0)))} style={{
            background: 'var(--bg-abyss)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            padding: '8px 14px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
          }}>MAX</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <TxButton onClick={() => run(stake, Number(amount))}
            disabled={!isConnected || !(Number(amount) > 0) || Number(amount) > (chipsBalance || 0)}
            loading={loading && (status === 'staking' || status === 'approving')} color="#27ae60" full>
            Stake
          </TxButton>
          <TxButton onClick={() => run(unstake, Number(amount))}
            disabled={!isConnected || !(Number(amount) > 0) || Number(amount) > stakedAmount || isLocked}
            loading={loading && status === 'unstaking'} color="#c0392b" full>
            Unstake
          </TxButton>
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 9 }}>
          Balance: ◈ {fmt(Math.floor(chipsBalance || 0))} · Staked: ◈ {fmt(stakedAmount)}
        </div>
      </div>

      {/* Yield + rakeback */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="glass" style={{ padding: 18 }}>
          <div style={{ fontSize: 11, color: 'var(--emerald-bright)', fontWeight: 800, marginBottom: 12, letterSpacing: .5 }}>Staking Yield</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <TxButton onClick={() => run(claimYield)} disabled={pendingYield < 0.01 || !isConnected}
              loading={loading && status === 'claiming'} color="#10b981" full>Claim</TxButton>
            <TxButton onClick={() => run(compound)} disabled={pendingYield < 0.01 || !isConnected || currentTier === 0}
              loading={loading && status === 'compounding'} color="#9b59b6" full>↻ Compound</TxButton>
          </div>
        </div>
        <div className="glass" style={{ padding: 18 }}>
          <div style={{ fontSize: 11, color: '#2980b9', fontWeight: 800, marginBottom: 12, letterSpacing: .5 }}>Rakeback</div>
          <TxButton onClick={() => run(claimRakeback)} disabled={rakebackOwed < 0.01 || !isConnected}
            loading={loading && status === 'claiming'} color="#2980b9" full>Claim Rakeback</TxButton>
        </div>
      </div>

      <Link href="/stake" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '11px', textAlign: 'center', textDecoration: 'none' }}>
        Full staking & tier breakdown →
      </Link>
    </div>
  );
}

// ─── EVENTS / TOURNAMENTS PANEL ───────────────────────────────────────────────
function EventsPanel({ address, isHuman }) {
  const { tournaments } = useTournaments();
  const { register, status } = useRegisterTournament();
  const [busyId, setBusyId] = useState(null);

  const onRegister = useCallback(async (t) => {
    setBusyId(t.id);
    await register(t.id, t.entryFee);
    setBusyId(null);
  }, [register]);

  const upcoming = tournaments.filter(t => t.status === 0);
  const mine     = tournaments.filter(t => t.isRegistered);

  if (!tournaments.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 12 }}>
        No tournaments scheduled yet. <Link href="/tournament" style={{ color: 'var(--gold)' }}>Browse events →</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {mine.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--emerald-bright)', letterSpacing: 2, fontWeight: 800 }}>
          ✓ YOU'RE REGISTERED FOR {mine.length} EVENT{mine.length > 1 ? 'S' : ''}
        </div>
      )}
      <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2.5, fontWeight: 800 }}>OPEN REGISTRATION</div>
      {upcoming.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>No open events right now — check back soon.</div>
      )}
      {tournaments.map(t => {
        const isOpen = t.status === 0;
        const isFull = t.entrantCount >= t.maxPlayers;
        const canRegister = isOpen && !t.isRegistered && !isFull && !!address && isHuman;
        const sColor = TOURN_STATUS_COLOR[t.status] || '#8a8478';
        const prize = t.guaranteed && t.guaranteedPrize > t.prizePool ? t.guaranteedPrize : t.prizePool;
        return (
          <div key={t.id} className="card-elevated" style={{
            border: `1px solid ${t.isRegistered ? 'rgba(16,185,129,.4)' : 'var(--border)'}`,
            borderRadius: 'var(--r-md)', padding: '15px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="serif" style={{ fontSize: 15, color: 'var(--cream)', fontWeight: 700,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {GAME_LABEL[t.gameType] || 'NLH'} · {t.entrantCount}/{t.maxPlayers} players
                  {t.startTime ? ` · ${new Date(t.startTime * 1000).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 8, color: sColor, border: `1px solid ${sColor}55`,
                borderRadius: 6, padding: '2px 8px', letterSpacing: 1, whiteSpace: 'nowrap' }}>
                {TOURN_STATUS_LABEL[t.status]}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12 }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 1.5, fontWeight: 800 }}>ENTRY</div>
                  <div className="gold-text" style={{ fontSize: 13, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>
                    ◈ {fmt(t.entryFee)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 1.5, fontWeight: 800 }}>PRIZE POOL</div>
                  <div style={{ fontSize: 13, color: 'var(--emerald-bright)', fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>
                    ◈ {fmt(prize)}{t.guaranteed ? ' GTD' : ''}
                  </div>
                </div>
              </div>
              {t.isRegistered ? (
                <span style={{ fontSize: 11, color: 'var(--emerald-bright)', fontWeight: 700 }}>✓ Registered</span>
              ) : canRegister ? (
                <TxButton onClick={() => onRegister(t)} loading={busyId === t.id}
                  color="#10b981">Register</TxButton>
              ) : (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {isFull ? 'Full' : !isOpen ? '—' : !address ? 'Connect wallet' : !isHuman ? 'Verify first' : ''}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <Link href="/tournament" className="btn btn-ghost" style={{ fontSize: 11.5, padding: '11px', textAlign: 'center', textDecoration: 'none' }}>
        Open full tournament lobby →
      </Link>
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPanel({ myHandle, mintCost, chipsBalance, changeHandle, status, errorMsg, address, avatar }) {
  const [renameVal, setRenameVal] = useState('');
  const [copied, setCopied] = useState(false);
  const canRename = isValidHandle(renameVal) && chipsBalance >= mintCost && (status === 'idle' || status === 'error');

  const onRename = async () => {
    if (!canRename) return;
    const tx = await changeHandle(renameVal);
    if (tx) setRenameVal('');
  };

  const copyAddr = () => {
    navigator.clipboard?.writeText(address || '');
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Wallet / identity */}
      <div className="glass" style={{ padding: 18 }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 11, fontWeight: 800 }}>WALLET</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--cream)', fontFamily: "'JetBrains Mono',monospace" }}>{short(address)}</span>
          <button onClick={copyAddr} style={{
            background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            padding: '6px 12px', cursor: 'pointer', color: copied ? 'var(--emerald-bright)' : 'var(--text-secondary)', fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
          }}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      </div>

      {/* Rename handle */}
      <div className="glass-strong" style={{ padding: 18 }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 5, fontWeight: 800 }}>CHANGE HANDLE</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Your handle is an NFT — renaming burns ALLIN and swaps the name in place.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 16, color: 'var(--border-gold)' }}>@</span>
          <input type="text" value={renameVal} maxLength={20}
            onChange={e => setRenameVal(e.target.value.slice(0, 20))}
            placeholder={myHandle || 'NewHandle'}
            className="input"
            style={{ flex: 1, padding: '11px 12px', fontSize: 14, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }} />
        </div>
        <ValidationBadge handle={renameVal} />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Rename cost (burned)</span>
          <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
            🔥 {fmt(mintCost)} ALLIN
          </span>
        </div>

        {address && chipsBalance < mintCost && (
          <div style={{ background: 'rgba(224,71,59,.08)', border: '1px solid rgba(224,71,59,.32)', borderRadius: 'var(--r-sm)',
            padding: '9px 12px', marginBottom: 12, fontSize: 11, color: 'var(--orange)' }}>
            Need {fmt(mintCost)} ALLIN. <Link href="/buy" style={{ color: 'var(--gold)' }}>Get ALLIN →</Link>
          </div>
        )}
        {errorMsg && (
          <div style={{ background: 'rgba(224,71,59,.08)', border: '1px solid rgba(224,71,59,.4)', borderRadius: 'var(--r-sm)',
            padding: '9px 12px', marginBottom: 12, fontSize: 10, color: 'var(--red)', wordBreak: 'break-word' }}>
            {errorMsg}
          </div>
        )}

        <TxButton onClick={onRename} disabled={!canRename}
          loading={status === 'approving' || status === 'changing'} color="#d9c08a" full>
          {status === 'approving' ? 'Approving ALLIN…'
           : status === 'changing' ? 'Changing…'
           : `Burn ${fmt(mintCost)} ALLIN & Rename`}
        </TxButton>
      </div>

      {/* Avatar / NFT */}
      <div className="glass-strong" style={{ padding: 18, textAlign: 'center' }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 14, fontWeight: 800 }}>HANDLE NFT</div>
        {avatar
          ? <img src={avatar} alt={`@${myHandle}`} width={160} height={160}
              style={{ width: 160, height: 160, borderRadius: 'var(--r-md)', border: '1px solid var(--border-gold)', boxShadow: 'var(--shadow-glow-gold)' }} />
          : <HandlePreview handle={myHandle} />}
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 14, lineHeight: 1.6 }}>
          Your avatar is generated on-chain from your handle and updates automatically when you rename.
          Tradeable on any ERC-721 marketplace.
        </div>
      </div>
    </div>
  );
}

// ─── MINT VIEW (no handle yet) ────────────────────────────────────────────────
function MintView({
  mounted, address, isHuman, chipsBalance, mintCost, currentTier,
  tierCostsCHIPS, TIER_LABELS, totalMinted, mint, status, confirmed, errorMsg,
  verifyStatus, verifyFailures, sendVerifyHuman, refetchIsHuman, wsReady, wsError,
}) {
  const [inputVal, setInputVal] = useState('');
  const canMint = mounted && isHuman && isValidHandle(inputVal) && chipsBalance >= mintCost && (status === 'idle' || status === 'error');

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="animate-up s1" style={{ textAlign: 'center', marginBottom: 26, opacity: 0 }}>
        <div className="pill" style={{ marginBottom: 16 }}>
          <span className="dot-live" />
          ON-CHAIN IDENTITY
        </div>
        <h1 className="gold-text serif" style={{ fontSize: 30, fontWeight: 900, marginBottom: 10 }}>Claim Your Poker Handle</h1>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Mint a unique on-chain alias to unlock your player dashboard — stats, history,
          tournaments and staking all live behind your handle.
        </p>
      </div>

      <div className="animate-up s2" style={{ display: 'flex', gap: 8, marginBottom: 16, opacity: 0 }}>
        {[
          { label: 'CURRENT PRICE', value: `${fmt(mintCost)} ALLIN` },
          { label: 'MINTED', value: totalMinted.toLocaleString() },
          { label: 'YOUR ALLIN', value: mounted && address ? fmt(Math.floor(chipsBalance)) : '—' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ flex: 1, minWidth: 0, padding: '12px 8px' }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 5, fontWeight: 800 }}>{s.label}</div>
            <div className="gold-text" style={{ fontSize: 13, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {mounted && address && isHuman === false ? (
        <div className="glass-strong animate-up s3" style={{ borderRadius: 'var(--r-lg)', overflow: 'hidden', opacity: 0 }}>
          <VerifyHumanBanner status={verifyStatus} failures={verifyFailures}
            onVerify={sendVerifyHuman} onVerified={refetchIsHuman} wsReady={wsReady} />
          <div style={{ padding: '20px 24px', fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
            Human verification is required before minting a handle.
          </div>
          {wsError && (
            <div style={{ padding: '0 24px 16px', fontSize: 10, color: '#e0473b', textAlign: 'center' }}>
              ⚠ {wsError}
            </div>
          )}
        </div>
      ) : (
        <div className="glass-strong animate-up s3" style={{ borderRadius: 'var(--r-lg)', padding: 24, opacity: 0 }}>
          <div style={{ marginBottom: 20 }}><HandlePreview handle={inputVal || null} /></div>
          <label style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, display: 'block', marginBottom: 7, fontWeight: 800 }}>
            CHOOSE YOUR HANDLE
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16, color: 'var(--border-gold)' }}>@</span>
            <input type="text" value={inputVal} maxLength={20}
              onChange={e => setInputVal(e.target.value.slice(0, 20))}
              placeholder="e.g. PokerShark99"
              className="input"
              style={{ flex: 1, padding: '11px 12px', fontSize: 14, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }} />
          </div>
          <ValidationBadge handle={inputVal} />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, marginBottom: 16 }}>
            {inputVal.length}/20 · Letters, numbers, underscores · Case-insensitive unique
          </div>

          <div className="glass" style={{ padding: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tier {currentTier + 1} price (burned)</span>
              <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                🔥 {fmt(mintCost)} ALLIN ({TIER_LABELS?.[currentTier] || ''})
              </span>
            </div>
          </div>

          {mounted && !address && (
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Connect your wallet to mint.
            </div>
          )}
          {mounted && address && chipsBalance < mintCost && (
            <div style={{ background: 'rgba(224,71,59,.08)', border: '1px solid rgba(224,71,59,.32)', borderRadius: 'var(--r-sm)',
              padding: '9px 12px', marginBottom: 12, fontSize: 11, color: 'var(--orange)' }}>
              You need {fmt(mintCost)} ALLIN to mint. <Link href="/buy" style={{ color: 'var(--gold)' }}>Get ALLIN →</Link>
            </div>
          )}
          {errorMsg && (
            <div style={{ background: 'rgba(224,71,59,.08)', border: '1px solid rgba(224,71,59,.4)', borderRadius: 'var(--r-sm)',
              padding: '9px 12px', marginBottom: 12, fontSize: 10, color: 'var(--red)', wordBreak: 'break-word' }}>
              {errorMsg}
            </div>
          )}

          <button onClick={() => canMint && mint(inputVal)} disabled={!canMint}
            className="btn btn-gold" style={{ width: '100%', padding: '13px', fontSize: 13.5,
              opacity: !canMint ? .55 : 1, cursor: !canMint ? 'not-allowed' : 'pointer' }}>
            {status === 'approving' ? 'Approving ALLIN…'
             : status === 'minting' ? 'Minting…'
             : confirmed ? '✓ Handle Minted!' : `Burn ${fmt(mintCost)} ALLIN & Mint`}
          </button>
          <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            One handle per wallet. ALLIN are burned and non-refundable.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
function HandlePageInner() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'overview');
  useEffect(() => setMounted(true), []);

  const { address, chipsBalance, isHuman, refetchIsHuman } = useWallet();
  const {
    myHandle, hasHandle, mintCost, currentTier: handleTier,
    tierCostsCHIPS, TIER_LABELS, totalMinted,
    mint, changeHandle, status, confirmed, errorMsg,
  } = useHandle();
  const { verifyStatus, verifyFailures, sendVerifyHuman, wsStatus, wsError } = useTableSocket();
  const { currentTier: stakeTier, stakedAmount } = useStaking();
  const { stats, activity, loading: statsLoading } = usePlayerStats(address);

  const avatarMap = useHandleAvatars(address ? [address] : []);
  const myAvatar  = address ? avatarMap[address.toLowerCase()] : null;
  const tier = TIERS[stakeTier] || TIERS[0];

  // Not connected / no handle → mint experience.
  if (mounted && (!hasHandle)) {
    return (
      <div className="has-bottom-nav" style={{ minHeight: '100vh', background: 'var(--bg-abyss)' }}>
        <WalletBar />
        <div style={{ padding: '40px 16px' }}>
          <MintView
            mounted={mounted} address={address} isHuman={isHuman}
            chipsBalance={chipsBalance} mintCost={mintCost} currentTier={handleTier}
            tierCostsCHIPS={tierCostsCHIPS} TIER_LABELS={TIER_LABELS} totalMinted={totalMinted}
            mint={mint} status={status} confirmed={confirmed} errorMsg={errorMsg}
            verifyStatus={verifyStatus} verifyFailures={verifyFailures}
            sendVerifyHuman={sendVerifyHuman} refetchIsHuman={refetchIsHuman}
            wsReady={wsStatus === 'authed'} wsError={wsError}
          />
        </div>
      </div>
    );
  }

  const bestFinish = activity
    .filter(a => a.kind === 'tournwin')
    .reduce((best, a) => (best == null || a.place < best ? a.place : best), null);

  return (
    <div className="has-bottom-nav" style={{ minHeight: '100vh', background: 'var(--bg-abyss)' }}>
      <WalletBar />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>

        {/* Identity header */}
        <div className="glass-strong felt-texture animate-up s1" style={{
          position: 'relative', overflow: 'hidden',
          border: '1px solid var(--border-gold)', borderRadius: 'var(--r-lg)', padding: 22,
          display: 'flex', gap: 18, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap',
          boxShadow: 'var(--shadow-md), var(--shadow-glow-gold)', opacity: 0,
        }}>
          <div aria-hidden style={{
            position: 'absolute', right: -50, top: -50, width: 220, height: 220,
            background: 'radial-gradient(circle, rgba(217,192,138,.1) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          {myAvatar
            ? <img src={myAvatar} alt={`@${myHandle}`} width={84} height={84}
                style={{ width: 84, height: 84, borderRadius: 'var(--r-md)', border: '1px solid var(--border-gold)', boxShadow: 'var(--shadow-glow-gold)', position: 'relative' }} />
            : <div style={{ width: 84, height: 84, borderRadius: 'var(--r-md)',
                background: 'radial-gradient(ellipse 120% 90% at 50% -10%, rgba(217,192,138,.12), transparent 60%), linear-gradient(160deg,#161619,#09090a)',
                border: '1px solid var(--border-gold)', display: 'flex', position: 'relative',
                alignItems: 'center', justifyContent: 'center', fontSize: 36 }} className="gold-text">♠</div>}
          <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
            <div className="gold-text" style={{ fontSize: 24, fontWeight: 900,
              fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>@{myHandle}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono',monospace", marginTop: 3 }}>
              {short(address)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: tier.color, border: `1px solid ${tier.color}55`,
                background: `${tier.color}14`, borderRadius: 999, padding: '4px 10px', letterSpacing: 1, fontWeight: 700 }}>
                {tier.name.toUpperCase()} · {tier.rake} RAKE
              </span>
              {isHuman && (
                <span style={{ fontSize: 9, color: 'var(--emerald-bright)', border: '1px solid rgba(16,185,129,.4)',
                  background: 'rgba(16,185,129,.1)', borderRadius: 999, padding: '4px 10px', letterSpacing: 1, fontWeight: 700 }}>✓ VERIFIED HUMAN</span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right', position: 'relative' }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: 1.5, fontWeight: 800 }}>ALLIN OWNED</div>
            <div className="gold-text" style={{ fontSize: 24, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>
              ◈ {mounted ? fmt(Math.floor(chipsBalance || 0)) : '—'}
            </div>
          </div>
        </div>

        {/* Headline stat cards */}
        <div className="animate-up s2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 20, opacity: 0 }}>
          <StatCard label="NET P/L" value={stats ? `◈ ${signed(stats.netPnl)}` : '—'}
            color={stats && stats.netPnl >= 0 ? 'var(--emerald-bright)' : 'var(--red)'} sub="lifetime, all formats" />
          <StatCard label="CASH-GAME P/L" value={stats ? `◈ ${signed(stats.cashGamePnl)}` : '—'}
            color={stats && stats.cashGamePnl >= 0 ? 'var(--emerald-bright)' : 'var(--red)'} />
          <StatCard label="HANDS WON" value={stats ? stats.handsWon.toLocaleString() : '—'} sub={stats ? `◈ ${fmt(stats.handWinnings)} won` : ''} />
          <StatCard label="TOURNEY CASHES" value={stats ? stats.tournCashes.toLocaleString() : '—'}
            color="#2980b9" sub={bestFinish ? `best: ${bestFinish}${['','st','nd','rd'][bestFinish] || 'th'}` : ''} />
          <StatCard label="STAKED" value={`◈ ${fmt(stakedAmount)}`} color={tier.color} sub={`${tier.apr} APR`} />
          <StatCard label="TABLES PLAYED" value={stats ? stats.tablesPlayed.toLocaleString() : '—'} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, overflowX: 'auto', paddingBottom: 4 }}>
          {[
            ['overview', 'Overview'], ['history', 'History'], ['events', 'Events'],
            ['staking', 'Staking'], ['settings', 'Settings'],
          ].map(([id, label]) => (
            <TabButton key={id} active={tab === id} onClick={() => setTab(id)}>{label}</TabButton>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
              <StatCard label="ALLIN BALANCE" value={`◈ ${fmt(chipsBalance || 0)}`} />
              <StatCard label="STAKED" value={`◈ ${fmt(stakedAmount)}`} color={tier.color} sub={`${tier.name} tier`} />
              <StatCard label="HANDS WON" value={fmt(stats?.handsWon || 0)} />
              <StatCard label="TABLES PLAYED" value={fmt(stats?.tablesPlayed || 0)} />
              <StatCard label="TOURNEYS ENTERED" value={fmt(stats?.tournEntries || 0)} />
              <StatCard label="TOURNEYS CASHED" value={fmt(stats?.tournCashes || 0)} />
            </div>

            <div className="glass-strong" style={{ padding: 20 }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2, marginBottom: 14, fontWeight: 800 }}>LIFETIME BREAKDOWN</div>
              {[
                ['Total bought in',     stats?.chipsBoughtIn, 'var(--orange)', '-'],
                ['Total cashed out',    stats?.cashOutTotal,  'var(--emerald-bright)', '+'],
                ['Seat fees paid',      stats?.seatFeesPaid,  'var(--text-secondary)', '-'],
                ['Tournament fees',     stats?.tournFeesPaid, 'var(--text-secondary)', '-'],
                ['Tournament winnings', stats?.tournWinnings, 'var(--emerald-bright)', '+'],
              ].map(([label, val, color, s]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontSize: 12, color, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                    {s}◈ {fmt(val || 0)}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 0' }}>
                <span style={{ fontSize: 13, color: 'var(--cream)', fontWeight: 700 }}>Net P/L</span>
                <span style={{ fontSize: 15, color: stats && stats.netPnl >= 0 ? 'var(--emerald-bright)' : 'var(--red)',
                  fontFamily: "'JetBrains Mono',monospace", fontWeight: 800 }}>
                  ◈ {signed(stats?.netPnl || 0)}
                </span>
              </div>
            </div>

            {statsLoading && (
              <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Indexing your on-chain history…</div>
            )}
            {!statsLoading && stats && stats.tablesPlayed === 0 && stats.tournEntries === 0 && (
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>
                No games yet. <Link href="/" style={{ color: 'var(--gold)' }}>Find a table →</Link>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Link href="/" className="btn btn-gold" style={{ textDecoration: 'none', padding: '14px', fontSize: 13 }}>
                ♠ Play Now
              </Link>
              <Link href="/buy" className="btn btn-emerald" style={{ textDecoration: 'none', padding: '14px', fontSize: 13 }}>
                $ Buy ALLIN
              </Link>
              <button onClick={() => setTab('staking')} className="btn btn-ghost" style={{ padding: '14px', fontSize: 13 }}>
                ◈ Stake
              </button>
              <Link href="/buy?tab=withdraw" className="btn btn-ghost" style={{ textDecoration: 'none', padding: '14px', fontSize: 13 }}>
                ⬇ Withdraw
              </Link>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="glass-strong" style={{ overflow: 'hidden' }}>
            {statsLoading && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Loading activity…</div>
            )}
            {!statsLoading && activity.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                No on-chain activity found yet.
              </div>
            )}
            {activity.slice(0, 60).map((ev, i) => <ActivityRow key={i} ev={ev} />)}
            {activity.length > 60 && (
              <div style={{ padding: 12, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
                Showing 60 most recent of {activity.length} events.
              </div>
            )}
          </div>
        )}

        {tab === 'events'   && <EventsPanel address={address} isHuman={isHuman} />}
        {tab === 'staking'  && <StakingPanel />}
        {tab === 'settings' && (
          <SettingsPanel myHandle={myHandle} mintCost={mintCost} chipsBalance={chipsBalance}
            changeHandle={changeHandle} status={status} errorMsg={errorMsg}
            address={address} avatar={myAvatar} />
        )}

        <Link href="/" style={{ display: 'block', textAlign: 'center', marginTop: 24,
          fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'none' }}>
          ← Back to Lobby
        </Link>
      </div>
    </div>
  );
}

export default function HandlePage() {
  return (
    <Suspense fallback={null}>
      <HandlePageInner />
    </Suspense>
  );
}
