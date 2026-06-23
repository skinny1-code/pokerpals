'use client';
import { useState, useEffect, useCallback } from 'react';
import WalletBar from '../../components/WalletBar';
import VerifyHumanBanner from '../../components/VerifyHumanBanner';
import {
  useWallet, useHandle, useHandleAvatars, useTableSocket,
  useStaking, usePlayerStats, useTournaments, useRegisterTournament,
} from '../../hooks/usePokerWallet';
import Link from 'next/link';

// ─── shared formatting / tier config ──────────────────────────────────────────
const TIERS = [
  { id:0, name:'Standard', stake:0,         rake:'1.5%', apr:'0%',  color:'#6a9a6a' },
  { id:1, name:'Bronze',   stake:25_000,    rake:'1.3%', apr:'5%',  color:'#cd7f32' },
  { id:2, name:'Silver',   stake:250_000,   rake:'1.1%', apr:'8%',  color:'#c0c0c0' },
  { id:3, name:'Gold',     stake:1_000_000, rake:'0.9%', apr:'12%', color:'#d4af37' },
  { id:4, name:'Whale',    stake:5_000_000, rake:'0.6%', apr:'18%', color:'#9b59b6' },
];
const TOURN_STATUS_LABEL = ['Registration','Running','Settled','Cancelled'];
const TOURN_STATUS_COLOR = ['#27ae60','#e67e22','#6a9a6a','#e74c3c'];
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
      background: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
      border: '1px solid #d4af3744', borderRadius: 16,
      width: 180, height: 180, margin: '0 auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8,
      boxShadow: '0 0 30px rgba(212,175,55,.2)',
    }}>
      <div style={{ fontSize: 36, color: '#d4af37' }}>♠</div>
      <div style={{
        fontSize: handle ? 18 : 14, fontWeight: 700, color: '#f1f5f9',
        fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1,
        opacity: handle ? 1 : 0.3,
      }}>{display}</div>
      <div style={{ fontSize: 10, color: '#64748b', letterSpacing: 1 }}>PokerVsPlayer Handle</div>
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
    return <div style={{ fontSize: 10, color: '#e74c3c', marginTop: 4 }}>{errors[0]}</div>;
  return <div style={{ fontSize: 10, color: '#27ae60', marginTop: 4 }}>✓ Valid handle</div>;
}

function StatCard({ label, value, color = '#d4af37', sub }) {
  return (
    <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 1.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, color, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: '#5a8a5a', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'rgba(212,175,55,.08)' : 'transparent',
      border: `1px solid ${active ? '#d4af3766' : '#1a3a1a'}`,
      borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
      color: active ? '#d4af37' : '#6a9a6a', fontSize: 11, fontWeight: 700,
      fontFamily: 'inherit', letterSpacing: .5, whiteSpace: 'nowrap', transition: 'all .15s',
    }}>{children}</button>
  );
}

function TxButton({ onClick, disabled, loading, color = '#d4af37', children, full }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled || loading}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: `linear-gradient(135deg,${color}22,${color}11)`,
        border: `1px solid ${disabled ? color+'22' : hov ? color : color+'66'}`,
        borderRadius: 8, padding: '10px 16px', width: full ? '100%' : undefined,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        color: disabled ? color+'44' : hov ? '#fff' : color,
        fontSize: 12, fontWeight: 700, fontFamily: 'inherit', letterSpacing: .5,
        transition: 'all .15s', opacity: loading ? 0.7 : 1,
      }}>{loading ? 'Pending…' : children}</button>
  );
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────
const FEED_META = {
  buyin:    { icon: '↳', color: '#e67e22', label: 'Bought in',          sign: -1 },
  rebuy:    { icon: '↻', color: '#e67e22', label: 'Re-bought',          sign: -1 },
  cashout:  { icon: '↰', color: '#27ae60', label: 'Cashed out',         sign: +1 },
  handwin:  { icon: '♠', color: '#d4af37', label: 'Won hand',           sign: +1 },
  tournreg: { icon: '🏆', color: '#2980b9', label: 'Registered',        sign: -1 },
  tournwin: { icon: '🏆', color: '#d4af37', label: 'Tournament cash',   sign: +1 },
};

function ActivityRow({ ev }) {
  const m = FEED_META[ev.kind] || { icon: '•', color: '#6a9a6a', label: ev.kind, sign: 0 };
  const where = ev.table != null ? `Table #${ev.table}` : ev.tourn != null ? `Tournament #${ev.tourn}` : '';
  const place = ev.place ? ` · ${ev.place}${['','st','nd','rd'][ev.place] || 'th'}` : '';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderBottom: '1px solid #0f1f0f',
    }}>
      <div style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{m.icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: '#cbd5c0' }}>{m.label}</div>
        <div style={{ fontSize: 10, color: '#5a8a5a' }}>{where}{place} · blk {ev.block?.toString()}</div>
      </div>
      <div style={{
        fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
        color: m.sign > 0 ? '#27ae60' : m.sign < 0 ? '#e67e22' : '#6a9a6a',
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
        <div style={{ background: '#060e06', border: '1px solid #1a3a1a', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: '#5a8a5a', marginBottom: 6 }}>
            Stake <span style={{ color: nextTier.color, fontWeight: 700 }}>◈ {fmt(toNext)}</span> more to reach{' '}
            <span style={{ color: nextTier.color, fontWeight: 700 }}>{nextTier.name}</span> ({nextTier.rake} rake · {nextTier.apr} APR)
          </div>
          <div style={{ height: 6, background: '#0a160a', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4, background: nextTier.color,
              width: `${Math.min(100, (stakedAmount / nextTier.stake) * 100)}%`, transition: 'width .3s',
            }} />
          </div>
        </div>
      )}

      {isLocked && (
        <div style={{ background: 'rgba(230,126,34,.08)', border: '1px solid #e67e2244', borderRadius: 8,
          padding: '10px 14px', fontSize: 11, color: '#e67e22' }}>
          ⏳ Stake locked until {new Date(lockedUntil * 1000).toLocaleDateString()}.
        </div>
      )}

      {/* Stake / unstake input */}
      <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1.5, marginBottom: 8 }}>AMOUNT (CHIPS)</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input type="number" min={0} value={amount} placeholder="0"
            onChange={e => setAmount(e.target.value)}
            style={{ flex: 1, background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 6,
              padding: '10px 12px', color: '#d4af37', fontSize: 14,
              fontFamily: "'JetBrains Mono',monospace", outline: 'none' }} />
          <button onClick={() => setAmount(String(Math.floor(chipsBalance || 0)))} style={{
            background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 6,
            padding: '8px 12px', cursor: 'pointer', color: '#6a9a6a', fontSize: 10, fontFamily: 'inherit',
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
        <div style={{ fontSize: 9, color: '#3a6a3a', marginTop: 8 }}>
          Balance: ◈ {fmt(Math.floor(chipsBalance || 0))} · Staked: ◈ {fmt(stakedAmount)}
        </div>
      </div>

      {/* Yield + rakeback */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#27ae60', fontWeight: 700, marginBottom: 10 }}>Staking Yield</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <TxButton onClick={() => run(claimYield)} disabled={pendingYield < 0.01 || !isConnected}
              loading={loading && status === 'claiming'} color="#27ae60" full>Claim</TxButton>
            <TxButton onClick={() => run(compound)} disabled={pendingYield < 0.01 || !isConnected || currentTier === 0}
              loading={loading && status === 'compounding'} color="#9b59b6" full>↻ Compound</TxButton>
          </div>
        </div>
        <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#2980b9', fontWeight: 700, marginBottom: 10 }}>Rakeback</div>
          <TxButton onClick={() => run(claimRakeback)} disabled={rakebackOwed < 0.01 || !isConnected}
            loading={loading && status === 'claiming'} color="#2980b9" full>Claim Rakeback</TxButton>
        </div>
      </div>

      <Link href="/stake" style={{ fontSize: 11, color: '#6a9a6a', textAlign: 'center', textDecoration: 'none' }}>
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
      <div style={{ textAlign: 'center', padding: '32px 0', color: '#3a6a3a', fontSize: 12 }}>
        No tournaments scheduled yet. <Link href="/tournament" style={{ color: '#d4af37' }}>Browse events →</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {mine.length > 0 && (
        <div style={{ fontSize: 10, color: '#27ae60', letterSpacing: 2 }}>
          ✓ YOU'RE REGISTERED FOR {mine.length} EVENT{mine.length > 1 ? 'S' : ''}
        </div>
      )}
      <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2 }}>OPEN REGISTRATION</div>
      {upcoming.length === 0 && (
        <div style={{ fontSize: 11, color: '#5a8a5a' }}>No open events right now — check back soon.</div>
      )}
      {tournaments.map(t => {
        const isOpen = t.status === 0;
        const isFull = t.entrantCount >= t.maxPlayers;
        const canRegister = isOpen && !t.isRegistered && !isFull && !!address && isHuman;
        const sColor = TOURN_STATUS_COLOR[t.status] || '#6a9a6a';
        const prize = t.guaranteed && t.guaranteedPrize > t.prizePool ? t.guaranteedPrize : t.prizePool;
        return (
          <div key={t.id} style={{
            background: '#0c1a0c', border: `1px solid ${t.isRegistered ? '#27ae6066' : '#1a3a1a'}`,
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#e8eadf', fontWeight: 700,
                  fontFamily: "'Playfair Display',serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </div>
                <div style={{ fontSize: 10, color: '#5a8a5a', marginTop: 2 }}>
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
                  <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 1 }}>ENTRY</div>
                  <div style={{ fontSize: 13, color: '#d4af37', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
                    ◈ {fmt(t.entryFee)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 1 }}>PRIZE POOL</div>
                  <div style={{ fontSize: 13, color: '#27ae60', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
                    ◈ {fmt(prize)}{t.guaranteed ? ' GTD' : ''}
                  </div>
                </div>
              </div>
              {t.isRegistered ? (
                <span style={{ fontSize: 11, color: '#27ae60', fontWeight: 700 }}>✓ Registered</span>
              ) : canRegister ? (
                <TxButton onClick={() => onRegister(t)} loading={busyId === t.id}
                  color="#27ae60">Register</TxButton>
              ) : (
                <span style={{ fontSize: 10, color: '#3a6a3a' }}>
                  {isFull ? 'Full' : !isOpen ? '—' : !address ? 'Connect wallet' : !isHuman ? 'Verify first' : ''}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <Link href="/tournament" style={{ fontSize: 11, color: '#6a9a6a', textAlign: 'center', textDecoration: 'none' }}>
        Open full tournament lobby →
      </Link>
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPanel({ myHandle, mintCost, chipsBalance, changeHandle, status, errorMsg, address, avatar }) {
  const [renameVal, setRenameVal] = useState('');
  const [copied, setCopied] = useState(false);
  const canRename = isValidHandle(renameVal) && chipsBalance >= mintCost && status === 'idle';

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
      <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1.5, marginBottom: 10 }}>WALLET</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#cbd5c0', fontFamily: "'JetBrains Mono',monospace" }}>{short(address)}</span>
          <button onClick={copyAddr} style={{
            background: 'transparent', border: '1px solid #1a3a1a', borderRadius: 6,
            padding: '5px 10px', cursor: 'pointer', color: copied ? '#27ae60' : '#6a9a6a', fontSize: 10, fontFamily: 'inherit',
          }}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      </div>

      {/* Rename handle */}
      <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1.5, marginBottom: 4 }}>CHANGE HANDLE</div>
        <div style={{ fontSize: 11, color: '#5a8a5a', marginBottom: 12 }}>
          Your handle is an NFT — renaming burns CHIPS and swaps the name in place.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 16, color: '#d4af3766' }}>@</span>
          <input type="text" value={renameVal} maxLength={20}
            onChange={e => setRenameVal(e.target.value.slice(0, 20))}
            placeholder={myHandle || 'NewHandle'}
            style={{ flex: 1, background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 8,
              padding: '10px 12px', color: '#d4af37', fontSize: 14,
              fontFamily: "'JetBrains Mono',monospace", outline: 'none', letterSpacing: 1 }} />
        </div>
        <ValidationBadge handle={renameVal} />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: '#5a8a5a' }}>Rename cost (burned)</span>
          <span style={{ fontSize: 11, color: '#e74c3c', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
            🔥 {fmt(mintCost)} CHIPS
          </span>
        </div>

        {address && chipsBalance < mintCost && (
          <div style={{ background: '#1a0c0c', border: '1px solid #3a1a1a', borderRadius: 8,
            padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#e67e22' }}>
            Need {fmt(mintCost)} CHIPS. <Link href="/buy" style={{ color: '#d4af37' }}>Get CHIPS →</Link>
          </div>
        )}
        {errorMsg && (
          <div style={{ background: '#1a0c0c', border: '1px solid #c0392b', borderRadius: 8,
            padding: '8px 12px', marginBottom: 12, fontSize: 10, color: '#e74c3c', wordBreak: 'break-word' }}>
            {errorMsg}
          </div>
        )}

        <TxButton onClick={onRename} disabled={!canRename}
          loading={status === 'approving' || status === 'changing'} color="#d4af37" full>
          {status === 'approving' ? 'Approving CHIPS…'
           : status === 'changing' ? 'Changing…'
           : `Burn ${fmt(mintCost)} CHIPS & Rename`}
        </TxButton>
      </div>

      {/* Avatar / NFT */}
      <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10, padding: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1.5, marginBottom: 12 }}>HANDLE NFT</div>
        {avatar
          ? <img src={avatar} alt={`@${myHandle}`} width={160} height={160}
              style={{ width: 160, height: 160, borderRadius: 14, boxShadow: '0 0 24px rgba(212,175,55,.2)' }} />
          : <HandlePreview handle={myHandle} />}
        <div style={{ fontSize: 10, color: '#5a8a5a', marginTop: 12 }}>
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
  verifyStatus, verifyFailures, sendVerifyHuman, refetchIsHuman,
}) {
  const [inputVal, setInputVal] = useState('');
  const canMint = mounted && isHuman && isValidHandle(inputVal) && chipsBalance >= mintCost && status === 'idle';

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: '#3a6a3a', letterSpacing: 4, marginBottom: 6 }}>IDENTITY</div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#d4af37',
          fontFamily: "'Playfair Display',serif", marginBottom: 8 }}>Claim Your Poker Handle</h1>
        <p style={{ fontSize: 12, color: '#5a8a5a', lineHeight: 1.6 }}>
          Mint a unique on-chain alias to unlock your player dashboard — stats, history,
          tournaments and staking all live behind your handle.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'CURRENT PRICE', value: `${fmt(mintCost)} CHIPS` },
          { label: 'MINTED', value: totalMinted.toLocaleString() },
          { label: 'YOUR CHIPS', value: mounted && address ? fmt(Math.floor(chipsBalance)) : '—' },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: '#0c1e0c', border: '1px solid #1a3a1a',
            borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 2, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 13, color: '#d4af37', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {mounted && address && isHuman === false ? (
        <div style={{ background: '#060e06', border: '1px solid #1a3a1a', borderRadius: 16, overflow: 'hidden' }}>
          <VerifyHumanBanner status={verifyStatus} failures={verifyFailures}
            onVerify={sendVerifyHuman} onVerified={refetchIsHuman} />
          <div style={{ padding: '20px 24px', fontSize: 11, color: '#5a8a5a', textAlign: 'center' }}>
            Human verification is required before minting a handle.
          </div>
        </div>
      ) : (
        <div style={{ background: '#060e06', border: '1px solid #1a3a1a', borderRadius: 16, padding: 24 }}>
          <div style={{ marginBottom: 20 }}><HandlePreview handle={inputVal || null} /></div>
          <label style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2, display: 'block', marginBottom: 6 }}>
            CHOOSE YOUR HANDLE
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16, color: '#d4af3766' }}>@</span>
            <input type="text" value={inputVal} maxLength={20}
              onChange={e => setInputVal(e.target.value.slice(0, 20))}
              placeholder="e.g. PokerShark99"
              style={{ flex: 1, background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 8,
                padding: '10px 12px', color: '#d4af37', fontSize: 14,
                fontFamily: "'JetBrains Mono',monospace", outline: 'none', letterSpacing: 1 }} />
          </div>
          <ValidationBadge handle={inputVal} />
          <div style={{ fontSize: 10, color: '#3a6a3a', marginTop: 6, marginBottom: 16 }}>
            {inputVal.length}/20 · Letters, numbers, underscores · Case-insensitive unique
          </div>

          <div style={{ background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#5a8a5a' }}>Tier {currentTier + 1} price (burned)</span>
              <span style={{ fontSize: 11, color: '#e74c3c', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                🔥 {fmt(mintCost)} CHIPS ({TIER_LABELS?.[currentTier] || ''})
              </span>
            </div>
          </div>

          {mounted && !address && (
            <div style={{ textAlign: 'center', fontSize: 11, color: '#5a8a5a', marginBottom: 12 }}>
              Connect your wallet to mint.
            </div>
          )}
          {mounted && address && chipsBalance < mintCost && (
            <div style={{ background: '#1a0c0c', border: '1px solid #3a1a1a', borderRadius: 8,
              padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#e67e22' }}>
              You need {fmt(mintCost)} CHIPS to mint. <Link href="/buy" style={{ color: '#d4af37' }}>Get CHIPS →</Link>
            </div>
          )}
          {errorMsg && (
            <div style={{ background: '#1a0c0c', border: '1px solid #c0392b', borderRadius: 8,
              padding: '8px 12px', marginBottom: 12, fontSize: 10, color: '#e74c3c', wordBreak: 'break-word' }}>
              {errorMsg}
            </div>
          )}

          <TxButton onClick={() => canMint && mint(inputVal)} disabled={!canMint}
            loading={status === 'approving' || status === 'minting'} color="#d4af37" full>
            {confirmed ? '✓ Handle Minted!' : `Burn ${fmt(mintCost)} CHIPS & Mint`}
          </TxButton>
          <div style={{ marginTop: 12, fontSize: 10, color: '#3a6a3a', textAlign: 'center', lineHeight: 1.5 }}>
            One handle per wallet. CHIPS are burned and non-refundable.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function HandlePage() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState('overview');
  useEffect(() => setMounted(true), []);

  const { address, chipsBalance, isHuman, refetchIsHuman } = useWallet();
  const {
    myHandle, hasHandle, mintCost, currentTier: handleTier,
    tierCostsCHIPS, TIER_LABELS, totalMinted,
    mint, changeHandle, status, confirmed, errorMsg,
  } = useHandle();
  const { verifyStatus, verifyFailures, sendVerifyHuman } = useTableSocket();
  const { currentTier: stakeTier, stakedAmount } = useStaking();
  const { stats, activity, loading: statsLoading } = usePlayerStats(address);

  const avatarMap = useHandleAvatars(address ? [address] : []);
  const myAvatar  = address ? avatarMap[address.toLowerCase()] : null;
  const tier = TIERS[stakeTier] || TIERS[0];

  // Not connected / no handle → mint experience.
  if (mounted && (!hasHandle)) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-deep)' }}>
        <WalletBar />
        <div style={{ padding: '32px 16px' }}>
          <MintView
            mounted={mounted} address={address} isHuman={isHuman}
            chipsBalance={chipsBalance} mintCost={mintCost} currentTier={handleTier}
            tierCostsCHIPS={tierCostsCHIPS} TIER_LABELS={TIER_LABELS} totalMinted={totalMinted}
            mint={mint} status={status} confirmed={confirmed} errorMsg={errorMsg}
            verifyStatus={verifyStatus} verifyFailures={verifyFailures}
            sendVerifyHuman={sendVerifyHuman} refetchIsHuman={refetchIsHuman}
          />
        </div>
      </div>
    );
  }

  const bestFinish = activity
    .filter(a => a.kind === 'tournwin')
    .reduce((best, a) => (best == null || a.place < best ? a.place : best), null);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)' }}>
      <WalletBar />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>

        {/* Identity header */}
        <div style={{
          background: 'linear-gradient(135deg,#0a1f0a,#060e06)',
          border: '1px solid #d4af3744', borderRadius: 16, padding: 20,
          display: 'flex', gap: 18, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap',
        }}>
          {myAvatar
            ? <img src={myAvatar} alt={`@${myHandle}`} width={84} height={84}
                style={{ width: 84, height: 84, borderRadius: 14, boxShadow: '0 0 24px rgba(212,175,55,.25)' }} />
            : <div style={{ width: 84, height: 84, borderRadius: 14,
                background: 'linear-gradient(135deg,#0f172a,#1e3a5f)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 36, color: '#d4af37' }}>♠</div>}
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#d4af37',
              fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>@{myHandle}</div>
            <div style={{ fontSize: 11, color: '#6a9a6a', fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>
              {short(address)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: tier.color, border: `1px solid ${tier.color}55`,
                borderRadius: 6, padding: '3px 8px', letterSpacing: 1 }}>
                {tier.name.toUpperCase()} · {tier.rake} RAKE
              </span>
              {isHuman && (
                <span style={{ fontSize: 9, color: '#27ae60', border: '1px solid #27ae6055',
                  borderRadius: 6, padding: '3px 8px', letterSpacing: 1 }}>✓ VERIFIED HUMAN</span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 1.5 }}>CHIPS OWNED</div>
            <div style={{ fontSize: 22, color: '#d4af37', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
              ◈ {mounted ? fmt(Math.floor(chipsBalance || 0)) : '—'}
            </div>
          </div>
        </div>

        {/* Headline stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 20 }}>
          <StatCard label="NET P/L" value={stats ? `◈ ${signed(stats.netPnl)}` : '—'}
            color={stats && stats.netPnl >= 0 ? '#27ae60' : '#e74c3c'} sub="lifetime, all formats" />
          <StatCard label="CASH-GAME P/L" value={stats ? `◈ ${signed(stats.cashGamePnl)}` : '—'}
            color={stats && stats.cashGamePnl >= 0 ? '#27ae60' : '#e74c3c'} />
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
            <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 1.5, marginBottom: 14 }}>LIFETIME BREAKDOWN</div>
              {[
                ['Total bought in',     stats?.chipsBoughtIn, '#e67e22', '-'],
                ['Total cashed out',    stats?.cashOutTotal,  '#27ae60', '+'],
                ['Seat fees paid',      stats?.seatFeesPaid,  '#6a9a6a', '-'],
                ['Tournament fees',     stats?.tournFeesPaid, '#6a9a6a', '-'],
                ['Tournament winnings', stats?.tournWinnings, '#27ae60', '+'],
              ].map(([label, val, color, s]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #0f1f0f' }}>
                  <span style={{ fontSize: 12, color: '#5a8a5a' }}>{label}</span>
                  <span style={{ fontSize: 12, color, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                    {s}◈ {fmt(val || 0)}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0' }}>
                <span style={{ fontSize: 13, color: '#cbd5c0', fontWeight: 700 }}>Net P/L</span>
                <span style={{ fontSize: 14, color: stats && stats.netPnl >= 0 ? '#27ae60' : '#e74c3c',
                  fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                  ◈ {signed(stats?.netPnl || 0)}
                </span>
              </div>
            </div>

            {statsLoading && (
              <div style={{ textAlign: 'center', fontSize: 11, color: '#3a6a3a' }}>Indexing your on-chain history…</div>
            )}
            {!statsLoading && stats && stats.tablesPlayed === 0 && stats.tournEntries === 0 && (
              <div style={{ textAlign: 'center', fontSize: 12, color: '#5a8a5a', padding: '8px 0' }}>
                No games yet. <Link href="/" style={{ color: '#d4af37' }}>Find a table →</Link>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Link href="/" style={{ textDecoration: 'none' }}>
                <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10,
                  padding: 16, textAlign: 'center', color: '#d4af37', fontSize: 12, fontWeight: 700 }}>
                  ♠ Play Now
                </div>
              </Link>
              <Link href="/buy" style={{ textDecoration: 'none' }}>
                <div style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10,
                  padding: 16, textAlign: 'center', color: '#27ae60', fontSize: 12, fontWeight: 700 }}>
                  $ Buy CHIPS
                </div>
              </Link>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div style={{ background: '#0c1a0c', border: '1px solid #1a3a1a', borderRadius: 12, overflow: 'hidden' }}>
            {statsLoading && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: '#3a6a3a' }}>Loading activity…</div>
            )}
            {!statsLoading && activity.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#5a8a5a' }}>
                No on-chain activity found yet.
              </div>
            )}
            {activity.slice(0, 60).map((ev, i) => <ActivityRow key={i} ev={ev} />)}
            {activity.length > 60 && (
              <div style={{ padding: 12, textAlign: 'center', fontSize: 10, color: '#3a6a3a' }}>
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
          fontSize: 11, color: '#6a9a6a', textDecoration: 'none' }}>
          ← Back to Lobby
        </Link>
      </div>
    </div>
  );
}
