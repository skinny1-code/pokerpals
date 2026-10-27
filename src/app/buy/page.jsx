'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import WalletBar from '../../components/WalletBar';
import { useWallet, useLiquidityPool } from '../../hooks/usePokerWallet';
import Link from 'next/link';

const CHIPS      = process.env.NEXT_PUBLIC_CHIPS_TOKEN;
const CHAIN_ID   = process.env.NEXT_PUBLIC_CHAIN_ID || '421614';
const IS_TESTNET = CHAIN_ID === '421614' || CHAIN_ID === '46630';
const IS_ROBINHOOD = CHAIN_ID === '4663' || CHAIN_ID === '46630';
const TESTNET_NAME = CHAIN_ID === '46630' ? 'Robinhood Chain Testnet' : 'Arbitrum Sepolia';

// ─── CARD ON-RAMP (Transak) ────────────────────────────────────────────────────
// Public, domain-scoped widget key — not a secret (mirrors a Stripe "publishable key").
// Leave blank to keep this tab in its "not configured" state.
const TRANSAK_API_KEY = process.env.NEXT_PUBLIC_TRANSAK_API_KEY;
const TRANSAK_ENV     = process.env.NEXT_PUBLIC_TRANSAK_ENV || 'STAGING'; // 'STAGING' | 'PRODUCTION'

// Builds the Transak widget URL pre-targeted at landing USDC on Arbitrum for `walletAddress`.
// NOTE: query param names are Transak's documented widget options as of this writing — if
// Transak changes their contract, this is the only function that needs updating.
function buildTransakUrl(walletAddress) {
  const base = TRANSAK_ENV === 'PRODUCTION'
    ? 'https://global.transak.com'
    : 'https://global-stg.transak.com';
  const params = new URLSearchParams({
    apiKey: TRANSAK_API_KEY || '',
    network: 'arbitrum',
    cryptoCurrencyCode: 'USDC',
    walletAddress,
    disableWalletAddressForm: 'true',
    productsAvailed: 'BUY',
    themeColor: 'd4af37',
  });
  return `${base}?${params.toString()}`;
}

function openTransakPopup(url) {
  const w = 480, h = 720;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top  = window.screenY + (window.outerHeight - h) / 2;
  window.open(url, 'transak', `width=${w},height=${h},left=${left},top=${top}`);
}

const UNISWAP_URL = CHIPS
  ? `https://app.uniswap.org/swap?outputCurrency=${CHIPS}&chain=${IS_TESTNET ? 'arbitrum_sepolia' : 'arbitrum'}`
  : 'https://app.uniswap.org';

const CAMELOT_URL = CHIPS
  ? `https://app.camelot.exchange/?token2=${CHIPS}`
  : 'https://app.camelot.exchange';

const EXCHANGES = [
  { name: 'Coinbase', desc: 'Buy ETH with debit/credit card, then withdraw to Arbitrum.', logo: '🔵', url: 'https://www.coinbase.com/price/ethereum', color: '#0052ff' },
  { name: 'Binance', desc: 'Buy ETH with card or bank transfer.', logo: '🟡', url: 'https://www.binance.com/en/buy-sell-crypto?fiat=USD&crypto=ETH', color: '#f0b90b' },
  { name: 'Kraken', desc: 'Buy ETH with debit card or wire transfer.', logo: '🟣', url: 'https://www.kraken.com/buy-crypto/ethereum', color: '#9945ff' },
];

function CardOnRamp() {
  const { address } = useWallet();
  const {
    usdcBalance, paused, quoteChipsOut, buyChips,
    status, confirmed, refetch,
  } = useLiquidityPool();
  const [amount, setAmount]         = useState('');
  const [showManual, setShowManual] = useState(false);

  // Best-effort USDC-balance refresh once the Transak popup posts back — tolerant of the
  // exact message shape so it keeps working even if Transak changes their payload format.
  useEffect(() => {
    function onMsg(e) {
      if (typeof e.origin === 'string' && e.origin.includes('transak.com')) refetch();
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [refetch]);

  const configured   = !!TRANSAK_API_KEY;
  const amountNum    = Number(amount) || 0;
  const quotedChips  = quoteChipsOut(amountNum);
  const canConvert   = !!address && amountNum > 0 && amountNum <= usdcBalance && !paused && (status === 'idle' || status === 'error');

  const handleBuyCard = () => {
    if (!address || !configured) return;
    openTransakPopup(buildTransakUrl(address));
  };

  const handleConvert = async () => {
    if (!canConvert) return;
    const tx = await buyChips(amountNum);
    if (tx) setAmount('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        Buy <strong className="gold-text" style={{ fontWeight: 800 }}>USDC</strong> with a debit/credit card, then convert it
        straight to CHIPS at the pool rate — no DEX or manual bridging needed.
      </div>

      {!configured ? (
        <div className="notice-warn" style={{ padding: '13px 16px', fontSize: 11.5 }}>
          ⚠️ Card payments aren't configured yet — set <code style={{ color: 'var(--gold-pale)' }}>NEXT_PUBLIC_TRANSAK_API_KEY</code> to
          enable this tab. Use a manual exchange below in the meantime.
        </div>
      ) : !address ? (
        <div className="glass" style={{ padding: '13px 16px', fontSize: 11.5, color: 'var(--text-secondary)' }}>
          Connect your wallet above to buy CHIPS with a card.
        </div>
      ) : (
        <>
          {/* Step 1 — card → USDC */}
          <div className="glass-strong" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2.5, marginBottom: 9, fontWeight: 800 }}>STEP 1</div>
            <div className="serif" style={{ fontSize: 16, color: 'var(--gold-pale)', fontWeight: 700, marginBottom: 6 }}>Buy USDC with your card</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.6 }}>
              Opens a secure Transak window. USDC lands directly in your connected wallet on Arbitrum.
            </div>
            <button onClick={handleBuyCard} className="btn btn-gold" style={{
              width: '100%', padding: '13px', fontSize: 13,
            }}>
              💳 Buy USDC with Card
            </button>
          </div>

          {/* Step 2 — USDC → CHIPS via ChipsLiquidityPool */}
          <div className="glass-strong" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 2.5, marginBottom: 9, fontWeight: 800 }}>STEP 2</div>
            <div className="serif" style={{ fontSize: 16, color: 'var(--gold-pale)', fontWeight: 700, marginBottom: 6 }}>Convert USDC → CHIPS</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Your USDC balance:{' '}
              <span style={{ color: 'var(--gold-pale)', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
                ${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>

            {paused ? (
              <div style={{ fontSize: 11.5, color: 'var(--orange)' }}>The swap pool is temporarily paused — try again later.</div>
            ) : (
              <>
                <input
                  type="number" min="0" step="any" placeholder="USDC amount"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className="input"
                  style={{
                    width: '100%', padding: '12px 14px',
                    fontFamily: "'JetBrains Mono',monospace", fontSize: 14, marginBottom: 10,
                    boxSizing: 'border-box',
                  }}
                />
                {amountNum > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
                    ≈{' '}
                    <span className="gold-text" style={{ fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>
                      ◈{quotedChips.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>{' '}
                    CHIPS
                  </div>
                )}
                <button onClick={handleConvert} disabled={!canConvert} className="btn btn-gold" style={{
                  width: '100%', padding: '13px', fontSize: 13,
                  opacity: canConvert ? 1 : .45,
                  cursor: canConvert ? 'pointer' : 'not-allowed',
                }}>
                  {status === 'approving' ? 'Approving USDC…'
                   : status === 'buying'    ? 'Converting…'
                   : confirmed              ? '✓ Converted!'
                   : 'Convert to CHIPS'}
                </button>
                {status === 'error' && (
                  <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 8 }}>Something went wrong — try again.</div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Manual fallback — buy ETH on an exchange and swap, no Transak account needed */}
      <div>
        <button onClick={() => setShowManual(v => !v)} style={{
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          fontSize: 11.5, cursor: 'pointer', padding: 0, textDecoration: 'underline',
          fontFamily: 'inherit', fontWeight: 600,
        }}>
          {showManual ? '▾' : '▸'} Prefer to buy manually on an exchange?
        </button>
        {showManual && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              Buy ETH on any exchange with your card, then withdraw to{' '}
              <strong className="gold-text" style={{ fontWeight: 800 }}>Arbitrum One</strong> network and swap to CHIPS.
            </div>
            {EXCHANGES.map(ex => (
              <a key={ex.name} href={ex.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                <div className="card-elevated"
                  style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = ex.color + '66'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = ''}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ fontSize: 28 }}>{ex.logo}</div>
                    <div>
                      <div style={{ fontSize: 14.5, color: ex.color, fontWeight: 700 }}>{ex.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{ex.desc}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 16, color: 'var(--text-muted)' }}>↗</div>
                </div>
              </a>
            ))}
            <div className="glass" style={{ padding: '13px 16px' }}>
              <div style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: 2.5, marginBottom: 7, fontWeight: 800 }}>IMPORTANT — WITHDRAW TO ARBITRUM</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                When withdrawing from the exchange, select <strong style={{ color: 'var(--gold-pale)' }}>Arbitrum One</strong> as the network — not Ethereum mainnet (fees are 100× higher there).
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── WITHDRAW — redeem CHIPS back to USDC via ChipsLiquidityPool ──────────────
function WithdrawPanel() {
  const { address, chipsBalance } = useWallet();
  const {
    paused, quoteUsdcOut, redeemChips,
    status, confirmed, refetch,
  } = useLiquidityPool();
  const [amount, setAmount] = useState('');

  const amountNum   = Number(amount) || 0;
  const quotedUsdc  = quoteUsdcOut(amountNum);
  const canRedeem   = !!address && amountNum > 0 && amountNum <= (chipsBalance || 0) && !paused && (status === 'idle' || status === 'error');

  const handleRedeem = async () => {
    if (!canRedeem) return;
    const tx = await redeemChips(amountNum);
    if (tx) { setAmount(''); refetch(); }
  };

  if (!address) {
    return (
      <div className="glass" style={{ padding: '13px 16px', fontSize: 11.5, color: 'var(--text-secondary)' }}>
        Connect your wallet above to withdraw CHIPS.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        Redeem <strong className="gold-text" style={{ fontWeight: 800 }}>CHIPS</strong> back to{' '}
        <strong className="gold-text" style={{ fontWeight: 800 }}>USDC</strong> at the pool rate — paid out
        directly to your wallet.
      </div>

      <div className="glass-strong" style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Your CHIPS balance:{' '}
          <span className="gold-text" style={{ fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
            ◈{(chipsBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>

        {paused ? (
          <div style={{ fontSize: 11.5, color: 'var(--orange)' }}>The swap pool is temporarily paused — try again later.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="number" min="0" step="any" placeholder="CHIPS amount"
                value={amount} onChange={e => setAmount(e.target.value)}
                className="input"
                style={{
                  flex: 1, padding: '12px 14px',
                  fontFamily: "'JetBrains Mono',monospace", fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />
              <button onClick={() => setAmount(String(Math.floor(chipsBalance || 0)))} style={{
                background: 'var(--bg-abyss)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                padding: '8px 14px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
              }}>MAX</button>
            </div>
            {amountNum > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
                ≈{' '}
                <span className="gold-text" style={{ fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>
                  ${quotedUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>{' '}
                USDC
              </div>
            )}
            <button onClick={handleRedeem} disabled={!canRedeem} className="btn btn-gold" style={{
              width: '100%', padding: '13px', fontSize: 13,
              opacity: canRedeem ? 1 : .45,
              cursor: canRedeem ? 'pointer' : 'not-allowed',
            }}>
              {status === 'approving' ? 'Approving CHIPS…'
               : status === 'redeeming' ? 'Redeeming…'
               : confirmed              ? '✓ Redeemed!'
               : 'Redeem to USDC'}
            </button>
            {status === 'error' && (
              <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 8 }}>Something went wrong — try again.</div>
            )}
          </>
        )}
      </div>

      <div className="glass" style={{ padding: '13px 16px' }}>
        <div style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: 2.5, marginBottom: 7, fontWeight: 800 }}>
          USDC LANDS ON ARBITRUM
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          USDC is paid out on Arbitrum One. Bridge or swap from there if you need it elsewhere.
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'swap',     label: '⇄  Swap Crypto' },
  ...(!IS_ROBINHOOD ? [{ id: 'card', label: '💳  Buy with Card' }, { id: 'withdraw', label: '⬇  Withdraw' }] : []),
  ...(IS_TESTNET ? [{ id: 'faucet', label: '🚰  Testnet Faucet' }] : []),
];

function BuyPageInner() {
  const searchParams = useSearchParams();
  const { address, chipsBalance } = useWallet();
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'swap');
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const copy = () => {
    navigator.clipboard.writeText(CHIPS || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="has-bottom-nav" style={{ minHeight: '100vh', background: 'var(--bg-abyss)' }}>
      <WalletBar />

      {/* Hero */}
      <div className="page-hero felt-texture" style={{ textAlign:'center', padding:'52px 24px 44px' }}>
        {/* Animated aurora backdrop */}
        <div className="aurora" aria-hidden />
        <div style={{ position:'relative', zIndex:1 }}>
          <div className="pill animate-up s1" style={{ marginBottom:18, opacity:0 }}>
            <span className="dot-live" />
            GET CHIPS
          </div>
          <h1 className="gold-text serif animate-up s2" style={{
            fontSize:46, fontWeight:900, marginBottom:10, opacity:0, lineHeight:1.05,
            textShadow:'0 0 50px rgba(217,192,138,.25)',
          }}>
            Buy CHIPS
          </h1>
          <p className="animate-up s3" style={{ fontSize:14, color:'var(--text-secondary)', maxWidth:420, margin:'0 auto', lineHeight:1.7, opacity:0 }}>
            CHIPS is used for all tables, buy-ins, and staking on PokerVsPlayer.
          </p>
          {mounted && address && (
            <div className="animate-up s4" style={{ marginTop:18, opacity:0 }}>
              <div className="stat-card" style={{ display:'inline-block' }}>
                <div className="gold-text" style={{
                  fontSize:28, fontWeight:900, lineHeight:1.1,
                  fontFamily:"'JetBrains Mono',monospace" }}>
                  ◈{chipsBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}
                </div>
                <div style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:2, marginTop:6, fontWeight:800 }}>
                  YOUR BALANCE
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 16px' }}>

        {/* Token address */}
        <div className="glass" style={{
          padding: '14px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: 2.5, marginBottom: 4, fontWeight: 800 }}>
              CHIPS TOKEN CONTRACT
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono',monospace",
              wordBreak: 'break-all' }}>
              {CHIPS || 'Not deployed'}
            </div>
          </div>
          <button onClick={copy} className={copied ? 'btn btn-emerald' : 'btn btn-ghost'} style={{
            padding: '8px 14px', fontSize: 11,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 3, marginBottom: 22,
          background: 'rgba(11,11,13,.8)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)', padding: 4,
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`}
              style={{ flex: 1, padding: '11px 6px', fontSize: 11.5, letterSpacing: .3 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Swap tab */}
        {tab === 'swap' && IS_ROBINHOOD && (
          <div className="notice-warn" style={{ padding: '18px 20px', fontSize: 12 }}>
            Robinhood Chain swaps and card purchases are disabled until CHIPS has a verified
            deployment, compatible liquidity, and an approved payment route on this network.
            Do not send assets using the Arbitrum exchange links.
          </div>
        )}
        {tab === 'swap' && !IS_ROBINHOOD && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.6 }}>
              Swap any token for CHIPS on Arbitrum. Choose your preferred DEX:
            </div>

            {[
              {
                name: 'Uniswap',
                desc: 'Largest DEX. Swap ETH, USDC, USDT → CHIPS.',
                color: '#fc72ff',
                url: UNISWAP_URL,
                logo: '🦄',
              },
              {
                name: 'Camelot',
                desc: 'Native Arbitrum DEX. Lower fees for ARB tokens.',
                color: '#f59e0b',
                url: CAMELOT_URL,
                logo: '⚔️',
              },
            ].map(dex => (
              <a key={dex.name} href={dex.url} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}>
                <div className="card-elevated" style={{
                  padding: '16px 20px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = dex.color + '66'}
                onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ fontSize: 28 }}>{dex.logo}</div>
                    <div>
                      <div style={{ fontSize: 14.5, color: dex.color, fontWeight: 700 }}>
                        {dex.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {dex.desc}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 16, color: 'var(--text-muted)' }}>↗</div>
                </div>
              </a>
            ))}

            {IS_TESTNET && (
              <div className="notice-warn" style={{ padding: '13px 16px', fontSize: 11.5 }}>
                ⚠️ You're on {TESTNET_NAME} testnet. DEX liquidity for CHIPS won't exist until
                mainnet launch. Use the Testnet Faucet tab to get CHIPS for testing.
              </div>
            )}

            <div className="glass" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: 2.5, marginBottom: 8, fontWeight: 800 }}>
                HOW TO ADD CHIPS TO METAMASK
              </div>
              <ol style={{ margin: 0, paddingLeft: 16, color: 'var(--text-secondary)', fontSize: 11.5,
                display: 'flex', flexDirection: 'column', gap: 5 }}>
                <li>Open MetaMask → Assets → Import Token</li>
                <li>Paste the CHIPS contract address above</li>
                <li>Symbol: CHIPS, Decimals: 18 → Save</li>
              </ol>
            </div>
          </div>
        )}

        {/* Card tab */}
        {tab === 'card' && !IS_ROBINHOOD && <CardOnRamp />}

        {/* Withdraw tab */}
        {tab === 'withdraw' && !IS_ROBINHOOD && <WithdrawPanel />}

        {/* Testnet faucet tab */}
        {tab === 'faucet' && IS_TESTNET && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="glass-strong felt-texture" style={{
              padding: '28px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🚰</div>
              <div className="gold-text serif" style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
                Testnet Faucet
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 22, lineHeight: 1.6, maxWidth: 380, margin: '0 auto 22px' }}>
                You're on {TESTNET_NAME}. Ask the operator to run the faucet script
                to receive test CHIPS — no real money involved.
              </div>
              <div style={{
                background: '#0b0b0d', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                padding: '14px 16px', textAlign: 'left',
              }}>
                <div style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: 2.5, marginBottom: 7, fontWeight: 800 }}>
                  OPERATOR COMMAND
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5,
                  color: 'var(--gold-pale)', wordBreak: 'break-all' }}>
                  {`FAUCET_TO=${mounted && address ? address : '0xYOUR_ADDRESS'} npm run faucet`}
                </div>
              </div>
            </div>

            <div className="glass" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: 2.5, marginBottom: 7, fontWeight: 800 }}>
                ALSO GET TESTNET ETH FOR GAS
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
                You'll also need {TESTNET_NAME} ETH for gas fees:
              </div>
              <a href={CHAIN_ID === "46630" ? "https://faucet.testnet.chain.robinhood.com" : "https://faucet.quicknode.com/arbitrum/sepolia"} target="_blank"
                rel="noopener noreferrer" className="btn btn-emerald" style={{
                  padding: '9px 18px', textDecoration: 'none',
                  fontSize: 11.5,
                }}>
                Get Testnet ETH ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BuyPage() {
  return (
    <Suspense fallback={null}>
      <BuyPageInner />
    </Suspense>
  );
}
