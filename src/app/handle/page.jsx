'use client';
import { useState, useEffect } from 'react';
import WalletBar from '../../components/WalletBar';
import { useHandle } from '../../hooks/usePokerWallet';
import { useWallet } from '../../hooks/usePokerWallet';
import Link from 'next/link';

function HandlePreview({ handle }) {
  const display = handle || 'YourHandle';
  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
      border: '1px solid #d4af3744', borderRadius: 16,
      width: 200, height: 200, margin: '0 auto',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8,
      boxShadow: '0 0 30px rgba(212,175,55,.2)',
    }}>
      <div style={{ fontSize: 40, color: '#d4af37' }}>♠</div>
      <div style={{
        fontSize: handle ? 18 : 14, fontWeight: 700, color: '#f1f5f9',
        fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1,
        opacity: handle ? 1 : 0.3,
      }}>
        {display}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', letterSpacing: 1 }}>
        PokerVsPlayer Handle
      </div>
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

function isValidHandle(h) {
  return h.length >= 3 && h.length <= 20 && /^[a-zA-Z0-9_]+$/.test(h);
}

export default function HandlePage() {
  const [mounted, setMounted]     = useState(false);
  const [inputVal, setInputVal]   = useState('');
  const { address, chipsBalance } = useWallet();
  const {
    myHandle, hasHandle, mintCost, currentTier,
    tierCostsCHIPS, TIER_LABELS, TIER_BOUNDS,
    totalMinted, mint, status, confirmed, errorMsg,
  } = useHandle();

  useEffect(() => setMounted(true), []);

  const canMint = mounted && !hasHandle && isValidHandle(inputVal) && chipsBalance >= mintCost && status === 'idle';

  const handleMint = async () => {
    if (!canMint) return;
    await mint(inputVal);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)' }}>
      <WalletBar />

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 10, color: '#3a6a3a', letterSpacing: 4, marginBottom: 6 }}>
            IDENTITY
          </div>
          <h1 style={{
            fontSize: 28, fontWeight: 900, color: '#d4af37',
            fontFamily: "'Playfair Display',serif", marginBottom: 8,
          }}>
            Poker Handle
          </h1>
          <p style={{ fontSize: 12, color: '#5a8a5a', lineHeight: 1.6 }}>
            Mint a unique on-chain poker alias. Burns CHIPS permanently —
            your handle lives on the blockchain forever.
          </p>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'CURRENT PRICE', value: `${mintCost.toLocaleString()} CHIPS` },
            { label: 'MINTED', value: totalMinted.toLocaleString() },
            { label: 'YOUR CHIPS', value: mounted && address ? `${Math.floor(chipsBalance).toLocaleString()}` : '—' },
          ].map(s => (
            <div key={s.label} style={{
              flex: 1, background: '#0c1e0c', border: '1px solid #1a3a1a',
              borderRadius: 8, padding: '10px 8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 8, color: '#3a6a3a', letterSpacing: 2, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 13, color: '#d4af37', fontWeight: 700,
                fontFamily: "'JetBrains Mono',monospace" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tier pricing table */}
        <div style={{
          background: '#060e06', border: '1px solid #1a3a1a', borderRadius: 10,
          overflow: 'hidden', marginBottom: 24,
        }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #1a3a1a',
            fontSize: 8, color: '#3a6a3a', letterSpacing: 2 }}>TIER PRICING</div>
          {[
            { tier: 0, label: '$5',  supply: `First 10,000`,           bound: 10_000 },
            { tier: 1, label: '$10', supply: `10,001 – 110,000`,       bound: 110_000 },
            { tier: 2, label: '$15', supply: `110,001 – 1,110,000`,    bound: 1_110_000 },
            { tier: 3, label: '$20', supply: `1,110,001+`,             bound: Infinity },
          ].map(row => {
            const isActive = currentTier === row.tier;
            const isFuture = currentTier < row.tier;
            const isPast   = currentTier > row.tier;
            return (
              <div key={row.tier} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px',
                borderBottom: row.tier < 3 ? '1px solid #0f1f0f' : 'none',
                background: isActive ? 'rgba(212,175,55,.04)' : 'transparent',
                opacity: isPast ? 0.4 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isActive && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#d4af37',
                    boxShadow: '0 0 4px #d4af37' }} />}
                  {!isActive && <div style={{ width: 5, height: 5 }} />}
                  <span style={{ fontSize: 10, color: isActive ? '#d4af37' : '#5a8a5a' }}>
                    {row.supply}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 10, color: '#5a8a5a',
                    fontFamily: "'JetBrains Mono',monospace",
                  }}>
                    {tierCostsCHIPS?.[row.tier]?.toLocaleString()} CHIPS
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: isActive ? '#d4af37' : isPast ? '#3a6a3a' : '#6a9a6a',
                    fontFamily: "'JetBrains Mono',monospace", minWidth: 32, textAlign: 'right',
                  }}>
                    {row.label}
                  </span>
                  {isPast && <span style={{ fontSize: 9, color: '#3a6a3a' }}>SOLD</span>}
                  {isActive && <span style={{ fontSize: 8, color: '#d4af37', border: '1px solid #d4af3744',
                    borderRadius: 4, padding: '1px 5px' }}>NOW</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Already has handle */}
        {mounted && hasHandle ? (
          <div style={{
            background: 'linear-gradient(135deg,#0a1f0a,#060e06)',
            border: '1px solid #d4af37', borderRadius: 16,
            padding: '32px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 3, marginBottom: 16 }}>
              YOUR HANDLE
            </div>
            <HandlePreview handle={myHandle} />
            <div style={{ marginTop: 20, fontSize: 22, fontWeight: 900,
              color: '#d4af37', fontFamily: "'JetBrains Mono',monospace", letterSpacing: 2 }}>
              @{myHandle}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#5a8a5a' }}>
              Your handle is an NFT — you can trade it on any ERC-721 marketplace.
            </div>
            <Link href="/" style={{
              display: 'inline-block', marginTop: 20,
              background: 'transparent', border: '1px solid #1a3a1a',
              borderRadius: 8, padding: '8px 20px',
              color: '#6a9a6a', fontSize: 11, textDecoration: 'none',
            }}>
              ← Back to Lobby
            </Link>
          </div>
        ) : (
          /* Mint form */
          <div style={{
            background: '#060e06', border: '1px solid #1a3a1a',
            borderRadius: 16, padding: '24px',
          }}>
            <div style={{ marginBottom: 20 }}>
              <HandlePreview handle={inputVal || null} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2, display: 'block', marginBottom: 6 }}>
                CHOOSE YOUR HANDLE
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16, color: '#d4af3766' }}>@</span>
                <input
                  type="text"
                  value={inputVal}
                  onChange={e => setInputVal(e.target.value.slice(0, 20))}
                  placeholder="e.g. PokerShark99"
                  maxLength={20}
                  style={{
                    flex: 1, background: '#0a160a', border: '1px solid #1a3a1a',
                    borderRadius: 8, padding: '10px 12px',
                    color: '#d4af37', fontSize: 14, fontFamily: "'JetBrains Mono',monospace",
                    outline: 'none', letterSpacing: 1,
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#d4af3766'}
                  onBlur={e => e.currentTarget.style.borderColor = '#1a3a1a'}
                />
              </div>
              <ValidationBadge handle={inputVal} />
              <div style={{ fontSize: 10, color: '#3a6a3a', marginTop: 6 }}>
                {inputVal.length}/20 · Letters, numbers, underscores · Case-insensitive unique
              </div>
            </div>

            {/* Cost breakdown */}
            <div style={{
              background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 8,
              padding: '12px', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#5a8a5a' }}>
                  Tier {currentTier + 1} price (burned)
                </span>
                <span style={{ fontSize: 11, color: '#e74c3c', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                  🔥 {mintCost.toLocaleString()} CHIPS
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#5a8a5a' }}>Target USD value</span>
                <span style={{ fontSize: 11, color: '#27ae60', fontWeight: 700 }}>
                  {TIER_LABELS?.[currentTier] || '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#5a8a5a' }}>You receive</span>
                <span style={{ fontSize: 11, color: '#d4af37', fontFamily: "'JetBrains Mono',monospace" }}>
                  1 Handle NFT
                </span>
              </div>
            </div>

            {/* Not connected */}
            {mounted && !address && (
              <div style={{ textAlign: 'center', fontSize: 11, color: '#5a8a5a', marginBottom: 12 }}>
                Connect your wallet to mint.
              </div>
            )}

            {/* Insufficient balance */}
            {mounted && address && chipsBalance < mintCost && (
              <div style={{
                background: '#1a0c0c', border: '1px solid #3a1a1a', borderRadius: 8,
                padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#e67e22',
              }}>
                You need {mintCost.toLocaleString()} CHIPS to mint. <Link href="/buy" style={{ color: '#d4af37' }}>Get CHIPS →</Link>
              </div>
            )}

            {/* Error */}
            {errorMsg && (
              <div style={{
                background: '#1a0c0c', border: '1px solid #c0392b', borderRadius: 8,
                padding: '8px 12px', marginBottom: 12, fontSize: 10, color: '#e74c3c',
                wordBreak: 'break-word',
              }}>
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleMint}
              disabled={!canMint}
              style={{
                width: '100%',
                background: canMint
                  ? 'linear-gradient(135deg,#1a4a1a,#0c2e0c)'
                  : '#0a160a',
                border: `1px solid ${canMint ? '#d4af37' : '#1a3a1a'}`,
                borderRadius: 8, padding: '12px',
                color: canMint ? '#d4af37' : '#3a6a3a',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                cursor: canMint ? 'pointer' : 'not-allowed',
                transition: 'all .15s',
              }}
            >
              {status === 'approving' ? 'Approving CHIPS…'
               : status === 'minting'  ? 'Minting Handle…'
               : confirmed             ? '✓ Handle Minted!'
               : `Burn ${mintCost.toLocaleString()} CHIPS (${TIER_LABELS?.[currentTier] || ''}) & Mint`}
            </button>

            <div style={{ marginTop: 12, fontSize: 10, color: '#3a6a3a', textAlign: 'center', lineHeight: 1.5 }}>
              One handle per wallet. Transfers are permanent on-chain.
              CHIPS are burned and non-refundable.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
