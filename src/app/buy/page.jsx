'use client';
import { useState, useEffect, useRef } from 'react';
import WalletBar from '../../components/WalletBar';
import { useWallet } from '../../hooks/usePokerWallet';
import Link from 'next/link';

const CHIPS      = process.env.NEXT_PUBLIC_CHIPS_TOKEN;
const CHAIN_ID   = process.env.NEXT_PUBLIC_CHAIN_ID || '421614';
const IS_TESTNET = CHAIN_ID === '421614';

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#5a8a5a', marginBottom: 4, lineHeight: 1.7 }}>
        Buy ETH on any exchange with your card, then withdraw to{' '}
        <strong style={{ color: '#d4af37' }}>Arbitrum One</strong> network and swap to CHIPS.
      </div>
      {EXCHANGES.map(ex => (
        <a key={ex.name} href={ex.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <div
            style={{ background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 12, padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = ex.color + '66'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#1a3a1a'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ fontSize: 28 }}>{ex.logo}</div>
              <div>
                <div style={{ fontSize: 14, color: ex.color, fontWeight: 700 }}>{ex.name}</div>
                <div style={{ fontSize: 11, color: '#5a8a5a', marginTop: 2 }}>{ex.desc}</div>
              </div>
            </div>
            <div style={{ fontSize: 16, color: '#3a6a3a' }}>↗</div>
          </div>
        </a>
      ))}
      <div style={{ background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 8, padding: '12px 16px', marginTop: 4 }}>
        <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2, marginBottom: 6 }}>IMPORTANT — WITHDRAW TO ARBITRUM</div>
        <div style={{ fontSize: 11, color: '#5a8a5a', lineHeight: 1.6 }}>
          When withdrawing from the exchange, select <strong style={{ color: '#a8c8a8' }}>Arbitrum One</strong> as the network — not Ethereum mainnet (fees are 100× higher there).
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'swap',  label: '⇄  Swap Crypto' },
  { id: 'card',  label: '💳  Buy with Card' },
  ...(IS_TESTNET ? [{ id: 'faucet', label: '🚰  Testnet Faucet' }] : []),
];

export default function BuyPage() {
  const { address, chipsBalance } = useWallet();
  const [tab, setTab] = useState('swap');
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const copy = () => {
    navigator.clipboard.writeText(CHIPS || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)' }}>
      <WalletBar />

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 16px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 10, color: '#3a6a3a', letterSpacing: 4, marginBottom: 6 }}>
            GET CHIPS
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: '#d4af37',
            fontFamily: "'Playfair Display',serif", marginBottom: 6 }}>
            Buy CHIPS
          </h1>
          <p style={{ fontSize: 12, color: '#5a8a5a' }}>
            CHIPS is used for all tables, buy-ins, and staking on PokerVsPals.
          </p>
          {mounted && address && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#6a9a6a' }}>
              Your balance: <span style={{ color: '#d4af37', fontWeight: 700 }}>
                {chipsBalance?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}
              </span> CHIPS
            </div>
          )}
        </div>

        {/* Token address */}
        <div style={{
          background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 10,
          padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2, marginBottom: 3 }}>
              CHIPS TOKEN CONTRACT
            </div>
            <div style={{ fontSize: 11, color: '#a8c8a8', fontFamily: "'JetBrains Mono',monospace",
              wordBreak: 'break-all' }}>
              {CHIPS || 'Not deployed'}
            </div>
          </div>
          <button onClick={copy} style={{
            background: copied ? '#1a4a1a' : '#0a160a',
            border: '1px solid #1a3a1a', borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer',
            color: copied ? '#27ae60' : '#6a9a6a', fontSize: 10,
            fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '10px 6px', cursor: 'pointer',
              background: tab === t.id ? '#0c1e0c' : 'transparent',
              border: `1px solid ${tab === t.id ? '#d4af3744' : '#1a3a1a'}`,
              borderRadius: 8, color: tab === t.id ? '#d4af37' : '#6a9a6a',
              fontSize: 11, fontWeight: 700, fontFamily: 'inherit', letterSpacing: .3,
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Swap tab */}
        {tab === 'swap' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#5a8a5a', marginBottom: 4 }}>
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
                <div style={{
                  background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 12,
                  padding: '16px 20px', cursor: 'pointer', transition: 'border-color .15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = dex.color + '66'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#1a3a1a'}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ fontSize: 28 }}>{dex.logo}</div>
                    <div>
                      <div style={{ fontSize: 14, color: dex.color, fontWeight: 700 }}>
                        {dex.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#5a8a5a', marginTop: 2 }}>
                        {dex.desc}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 16, color: '#3a6a3a' }}>↗</div>
                </div>
              </a>
            ))}

            {IS_TESTNET && (
              <div style={{
                background: '#1a0c0c', border: '1px solid #3a1a1a', borderRadius: 8,
                padding: '12px 16px', fontSize: 11, color: '#e67e22',
              }}>
                ⚠️ You're on Arbitrum Sepolia testnet. DEX liquidity for CHIPS won't exist until
                mainnet launch. Use the Testnet Faucet tab to get CHIPS for testing.
              </div>
            )}

            <div style={{
              background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 8,
              padding: '12px 16px',
            }}>
              <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2, marginBottom: 6 }}>
                HOW TO ADD CHIPS TO METAMASK
              </div>
              <ol style={{ margin: 0, paddingLeft: 16, color: '#5a8a5a', fontSize: 11,
                display: 'flex', flexDirection: 'column', gap: 4 }}>
                <li>Open MetaMask → Assets → Import Token</li>
                <li>Paste the CHIPS contract address above</li>
                <li>Symbol: CHIPS, Decimals: 18 → Save</li>
              </ol>
            </div>
          </div>
        )}

        {/* Card tab */}
        {tab === 'card' && <CardOnRamp />}

        {/* Testnet faucet tab */}
        {tab === 'faucet' && IS_TESTNET && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              background: '#0c1e0c', border: '1px solid #1a3a1a', borderRadius: 12,
              padding: '24px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🚰</div>
              <div style={{ fontSize: 14, color: '#d4af37', fontWeight: 700, marginBottom: 8 }}>
                Testnet Faucet
              </div>
              <div style={{ fontSize: 12, color: '#5a8a5a', marginBottom: 20, lineHeight: 1.6 }}>
                You're on Arbitrum Sepolia testnet. Ask the operator to run the faucet script
                to receive test CHIPS — no real money involved.
              </div>
              <div style={{
                background: '#060e06', border: '1px solid #1a3a1a', borderRadius: 8,
                padding: '12px 16px', textAlign: 'left',
              }}>
                <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2, marginBottom: 6 }}>
                  OPERATOR COMMAND
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11,
                  color: '#a8c8a8', wordBreak: 'break-all' }}>
                  {`FAUCET_TO=${mounted && address ? address : '0xYOUR_ADDRESS'} npm run faucet`}
                </div>
              </div>
            </div>

            <div style={{
              background: '#0a160a', border: '1px solid #1a3a1a', borderRadius: 8,
              padding: '12px 16px',
            }}>
              <div style={{ fontSize: 9, color: '#3a6a3a', letterSpacing: 2, marginBottom: 6 }}>
                ALSO GET TESTNET ETH FOR GAS
              </div>
              <div style={{ fontSize: 11, color: '#5a8a5a', marginBottom: 8 }}>
                You'll also need Arbitrum Sepolia ETH for gas fees:
              </div>
              <a href="https://faucet.quicknode.com/arbitrum/sepolia" target="_blank"
                rel="noopener noreferrer" style={{
                  display: 'inline-block', background: '#0c2e0c',
                  border: '1px solid #d4af3744', borderRadius: 6,
                  padding: '6px 14px', textDecoration: 'none',
                  color: '#d4af37', fontSize: 11, fontWeight: 700,
                }}>
                Get Sepolia ETH ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
