// src/hooks/usePokerWallet.js
// wagmi v2 + viem — real EVM wallet integration

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createConfig, http, useAccount, useConnect, useDisconnect,
         useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt,
         useBalance, useSignMessage, usePublicClient } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { parseUnits, formatUnits, parseAbiItem, isAddress } from "viem";

// ─── WS URL HELPER ─────────────────────────────────────────────────────────────
// Upgrades ws:// → wss:// when the page is served over https (avoids mixed-content block).
export function safeWsUrl(url) {
  if (!url) return url;
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return url.replace(/^ws:\/\//, 'wss://');
  }
  return url;
}

// ─── WAGMI CONFIG (export and wrap your app in <WagmiProvider config={wagmiConfig}>) ──
const _wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
const _connectors = [
  injected(),           // MetaMask / injected wallets — try first so mobile in-app browsers work
  ...(_wcProjectId ? [walletConnect({ projectId: _wcProjectId })] : []),
  farcasterMiniApp(),   // auto-connects when running inside Farcaster / Base mini app (last)
];

export const wagmiConfig = createConfig({
  chains:     [arbitrum, arbitrumSepolia],
  transports: {
    [arbitrum.id]:        http(process.env.NEXT_PUBLIC_ARB_RPC),
    [arbitrumSepolia.id]: http(process.env.NEXT_PUBLIC_ARB_SEPOLIA_RPC),
  },
  connectors: _connectors,
  ssr: true,  // prevents wagmi from reading localStorage during SSR hydration
});

// ─── ABIs ─────────────────────────────────────────────────────────────────────
export const CHIPS_ABI = [
  { name:"balanceOf",  type:"function", stateMutability:"view",
    inputs:[{name:"account",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"approve",    type:"function", stateMutability:"nonpayable",
    inputs:[{name:"spender",type:"address"},{name:"amount",type:"uint256"}], outputs:[{type:"bool"}] },
  { name:"allowance",  type:"function", stateMutability:"view",
    inputs:[{name:"owner",type:"address"},{name:"spender",type:"address"}], outputs:[{type:"uint256"}] },
];
export const PPP_ABI = CHIPS_ABI; // kept for backwards compat

export const STAKING_ABI = [
  { name:"stake",   type:"function", stateMutability:"nonpayable",
    inputs:[{name:"amount",type:"uint256"}], outputs:[] },
  { name:"unstake", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"amount",type:"uint256"}], outputs:[] },
  { name:"claimYield", type:"function", stateMutability:"nonpayable",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"compound", type:"function", stateMutability:"nonpayable",
    inputs:[], outputs:[] },
  { name:"getStakeInfo", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}],
    outputs:[
      {name:"amount",type:"uint256"},{name:"tier",type:"uint8"},
      {name:"lockedUntil",type:"uint256"},{name:"aprBps",type:"uint256"},
    ]},
  { name:"pendingYield", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"getTierStats", type:"function", stateMutability:"view",
    inputs:[],
    outputs:[
      {name:"thresholds",type:"uint256[5]"},
      {name:"aprs",type:"uint256[5]"},
      {name:"counts",type:"uint256[5]"},
    ]},
];

export const ESCROW_ABI = [
  { name:"createTable", type:"function", stateMutability:"nonpayable",
    inputs:[
      {name:"buyInAmount",type:"uint256"},{name:"bigBlind",type:"uint256"},
      {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},
      {name:"roomId",type:"uint256"},
    ],
    outputs:[{name:"id",type:"uint256"}]},
  { name:"buyIn",    type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"rebuy",    type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"},{name:"amount",type:"uint256"}], outputs:[] },
  { name:"refund",   type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"claimRakeback", type:"function", stateMutability:"nonpayable",
    inputs:[], outputs:[] },
  { name:"humanVerified", type:"function", stateMutability:"view",
    inputs:[{name:"addr",type:"address"}], outputs:[{type:"bool"}] },
  { name:"rakebackAccrued", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"getTableInfo", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"}],
    outputs:[
      {name:"id",type:"uint256"},{name:"buyIn",type:"uint256"},{name:"bigBlind",type:"uint256"},
      {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},
      {name:"status",type:"uint8"},{name:"pot",type:"uint256"},
      {name:"handNonce",type:"uint256"},{name:"seated",type:"uint8"},
    ]},
  { name:"tableCount", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"tableRoom", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"seatFeeCHIPS", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"getPlayerDeposit", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"},{name:"player",type:"address"}],
    outputs:[{type:"uint256"}] },
  { name:"cashOut", type:"function", stateMutability:"nonpayable",
    inputs:[
      {name:"tableId",type:"uint256"},{name:"player",type:"address"},
      {name:"amount",type:"uint256"},{name:"nonce",type:"uint256"},
      {name:"sig",type:"bytes"},
    ], outputs:[] },
  { name:"cashOutNonce", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"},{name:"player",type:"address"}],
    outputs:[{type:"uint256"}] },
  { name:"closeTable", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"TableCreated", type:"event",
    inputs:[
      {name:"id",type:"uint256",indexed:true},
      {name:"creator",type:"address",indexed:true},
      {name:"buyIn",type:"uint256",indexed:false},
      {name:"g",type:"uint8",indexed:false},
    ]},
];

export const HANDLE_ABI = [
  { name:"mintHandle", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"handle",type:"string"}], outputs:[] },
  { name:"getHandleByAddress", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}], outputs:[{type:"string"}] },
  { name:"getHandle", type:"function", stateMutability:"view",
    inputs:[{name:"tokenId",type:"uint256"}], outputs:[{type:"string"}] },
  { name:"ownerTokenId", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"handleTaken", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"string"}], outputs:[{type:"bool"}] },
  { name:"getCurrentMintCost", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"getCurrentTier", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint8"}] },
  { name:"tierCosts", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"tierBounds", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"totalMinted", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"totalBurned", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"tokenURI", type:"function", stateMutability:"view",
    inputs:[{name:"tokenId",type:"uint256"}], outputs:[{type:"string"}] },
  { name:"HandleMinted", type:"event",
    inputs:[
      {name:"player",type:"address",indexed:true},
      {name:"tokenId",type:"uint256",indexed:false},
      {name:"handle",type:"string",indexed:false},
      {name:"burned",type:"uint256",indexed:false},
    ]},
];

export const TOURNAMENT_ABI = [
  { name:"tournamentCount", type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"tournaments", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"uint256"}],
    outputs:[
      {name:"id",type:"uint256"},{name:"name",type:"string"},{name:"entryFee",type:"uint256"},
      {name:"startTime",type:"uint256"},{name:"maxPlayers",type:"uint8"},
      {name:"gameType",type:"uint8"},{name:"status",type:"uint8"},
      {name:"entrants",type:"address[]"},{name:"prizePool",type:"uint256"},
      {name:"rakeCollected",type:"uint256"},{name:"guaranteed",type:"bool"},
      {name:"guaranteedPrize",type:"uint256"},
    ]},
  { name:"register", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tournId",type:"uint256"}], outputs:[] },
  { name:"registered", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"uint256"},{name:"",type:"address"}], outputs:[{type:"bool"}] },
];

const ROOM_TUPLE_OUTPUTS = [
  {name:"id",type:"uint256"},{name:"lessee",type:"address"},{name:"name",type:"string"},
  {name:"nftGate",type:"address"},{name:"minBuyIn",type:"uint256"},{name:"maxBuyIn",type:"uint256"},
  {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},{name:"isPublic",type:"bool"},
  {name:"leaseExpiry",type:"uint256"},{name:"dailyRate",type:"uint256"},{name:"heldFunds",type:"uint256"},
];

export const REGISTRY_ABI = [
  { name:"weeklyFee",  type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"monthlyFee", type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"minWeeks",   type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"maxWeeks",   type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"minMonths",  type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"maxMonths",  type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"roomCount",  type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"leaseRoom", type:"function", stateMutability:"nonpayable",
    inputs:[
      {name:"weeks_",type:"uint256"},{name:"nftGate",type:"address"},
      {name:"minBuyIn",type:"uint256"},{name:"maxBuyIn",type:"uint256"},
      {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},
      {name:"isPublic",type:"bool"},{name:"name",type:"string"},
    ], outputs:[{name:"roomId",type:"uint256"}] },
  { name:"leaseRoomMonths", type:"function", stateMutability:"nonpayable",
    inputs:[
      {name:"months_",type:"uint256"},{name:"nftGate",type:"address"},
      {name:"minBuyIn",type:"uint256"},{name:"maxBuyIn",type:"uint256"},
      {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},
      {name:"isPublic",type:"bool"},{name:"name",type:"string"},
    ], outputs:[{name:"roomId",type:"uint256"}] },
  { name:"getRoom", type:"function", stateMutability:"view",
    inputs:[{name:"roomId",type:"uint256"}], outputs:[{type:"tuple", components: ROOM_TUPLE_OUTPUTS}] },
  { name:"getPublicRooms", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"tuple[]", components: ROOM_TUPLE_OUTPUTS}] },
  { name:"RoomLeased", type:"event",
    inputs:[
      {name:"roomId",type:"uint256",indexed:true},{name:"lessee",type:"address",indexed:true},
      {name:"name",type:"string",indexed:false},{name:"nftGate",type:"address",indexed:false},
      {name:"leaseExpiry",type:"uint256",indexed:false},{name:"feePaid",type:"uint256",indexed:false},
    ]},
];

const CHIPS          = process.env.NEXT_PUBLIC_CHIPS_TOKEN || process.env.NEXT_PUBLIC_PPP_TOKEN;
const ESCROW         = process.env.NEXT_PUBLIC_ESCROW;
const STAKING        = process.env.NEXT_PUBLIC_STAKING;
const HANDLE         = process.env.NEXT_PUBLIC_POKER_HANDLE;
const TOURNAMENT     = process.env.NEXT_PUBLIC_TOURNAMENT;
const TABLE_REGISTRY = process.env.NEXT_PUBLIC_TABLE_REGISTRY;
const KINGS_POOL     = process.env.NEXT_PUBLIC_KINGS_POOL;
const PROMOTIONS_POOL = process.env.NEXT_PUBLIC_PROMOTIONS_POOL;
const STABLECOIN_POOL = process.env.NEXT_PUBLIC_STABLECOIN_POOL;
const LIQUIDITY_POOL  = process.env.NEXT_PUBLIC_LIQUIDITY_POOL;
const MOCK_USDC      = process.env.NEXT_PUBLIC_MOCK_USDC;
const USDC_ADDR      = MOCK_USDC || process.env.NEXT_PUBLIC_USDC;

// ─── CONTRACT ADDRESSES (exported for dashboard and other consumers) ──────────
export const CONTRACT_ADDRESSES = {
  chipsToken:      CHIPS,
  escrow:          ESCROW,
  staking:         STAKING,
  handle:          HANDLE,
  tournament:      TOURNAMENT,
  tableRegistry:   TABLE_REGISTRY,
  kingsPool:       KINGS_POOL,
  promotionsPool:  PROMOTIONS_POOL,
  stablecoinPool:  STABLECOIN_POOL,
  liquidityPool:   LIQUIDITY_POOL,
  usdc:            USDC_ADDR,
};

// Safe fee estimation — returns {} if blocked (sandbox) so MetaMask estimates instead.
// IMPORTANT: always return BOTH 1559 fields together (never leave one undefined).
// On Arbitrum the priority fee is ~0; if we send only maxFeePerGas, MetaMask auto-fills
// a garbage maxPriorityFeePerGas on testnets (the "network suggested = thousands of ETH"
// bug) which can also stall the confirm popup. Sending an explicit 0n priority + headroom
// on maxFeePerGas keeps the fee sane, cheap, and unstuck.
// Floor at 0.1 gwei so MetaMask shows a visible non-zero "site suggested" fee instead
// of "$0 / 0 ETH". A non-zero PRIORITY floor matters too: MetaMask mobile flags a
// maxPriorityFeePerGas of exactly 0 as "Network fee Unavailable / Review alerts".
// And a CEILING is critical — without it, if the RPC returns a garbage-huge estimate
// (the root of the "network suggested = thousands of ETH" bug), doubling it makes OUR
// own "site suggested" value just as insane. Arbitrum fees are tiny, so 2 gwei is a
// safe cap that still confirms instantly.
const MIN_MAX_FEE_PER_GAS = 100_000_000n;   // 0.1 gwei floor
const MAX_MAX_FEE_PER_GAS = 2_000_000_000n; // 2 gwei ceiling — caps RPC garbage
const MIN_PRIORITY_FEE    = 10_000_000n;    // 0.01 gwei — non-zero so MM doesn't flag it
const clampFee = (v) =>
  v < MIN_MAX_FEE_PER_GAS ? MIN_MAX_FEE_PER_GAS : v > MAX_MAX_FEE_PER_GAS ? MAX_MAX_FEE_PER_GAS : v;
// Hardcoded safe fallback pair — never return {} here. An empty object lets the wallet
// fall back to its own 1559 estimate, which is the exact "thousands of ETH" bug above.
const SAFE_FALLBACK_FEES = { maxFeePerGas: MIN_MAX_FEE_PER_GAS, maxPriorityFeePerGas: MIN_PRIORITY_FEE };
async function safeFeeOverrides(publicClient) {
  try {
    const fees = await publicClient.estimateFeesPerGas();
    if (!fees.maxFeePerGas) return SAFE_FALLBACK_FEES; // no data — use safe hardcoded pair
    let maxPriorityFeePerGas = (fees.maxPriorityFeePerGas ?? 0n) * 120n / 100n;
    if (maxPriorityFeePerGas < MIN_PRIORITY_FEE) maxPriorityFeePerGas = MIN_PRIORITY_FEE;
    if (maxPriorityFeePerGas > MAX_MAX_FEE_PER_GAS) maxPriorityFeePerGas = MAX_MAX_FEE_PER_GAS;
    // Clamp to [0.1 gwei, 2 gwei] so neither a too-low nor a garbage-huge RPC estimate leaks through.
    let maxFeePerGas = clampFee(fees.maxFeePerGas * 2n);
    if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas; // 1559 invariant
    return { maxFeePerGas, maxPriorityFeePerGas };
  } catch {
    return SAFE_FALLBACK_FEES; // estimate failed — use safe hardcoded pair, never {}
  }
}

// Returns true if `owner` has already approved at least `needed` CHIPS to `spender`.
// Lets the write flows skip a redundant approve popup — critical on MetaMask mobile,
// where back-to-back approve→action popups frequently leave the 2nd one blank/stuck.
async function hasAllowance(publicClient, owner, spender, needed) {
  if (!publicClient || !owner || !spender) return false;
  try {
    const current = await publicClient.readContract({
      address: CHIPS, abi: CHIPS_ABI, functionName: "allowance", args: [owner, spender],
    });
    return current >= needed;
  } catch {
    return false; // can't read — fall back to approving
  }
}

// ─── HOOK: WALLET STATE ───────────────────────────────────────────────────────
// Chain the app expects players to be on (matches WalletBar's EXPECTED).
const EXPECTED_CHAIN = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 421614);

export function useWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, status: connectStatus, error: connectError } = useConnect();
  const { disconnect }                    = useDisconnect();

  // CHIPS balance
  const { data: chipsRaw } = useReadContract({
    address: CHIPS, abi: CHIPS_ABI, functionName: "balanceOf",
    args: [address], query: { enabled: !!address, refetchInterval: 8000 },
  });
  const chipsBalance = chipsRaw ? Number(formatUnits(chipsRaw, 18)) : 0;

  // ETH/native balance for gas
  const { data: nativeBal } = useBalance({ address, query: { enabled: !!address } });

  // Is human verified on-chain?
  const { data: isHuman, refetch: refetchIsHuman } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "humanVerified",
    args: [address], query: { enabled: !!address, refetchInterval: 30000 },
  });

  const connectMetaMask      = () => {
    // Prefer the EIP-6963-discovered MetaMask connector (e.g. inside MetaMask's
    // in-app browser it announces as 'io.metamask'); fall back to generic injected.
    const mm = connectors.find(c => c.id === 'io.metamask')
            || connectors.find(c => c.type === 'injected' && /meta\s*mask/i.test(c.name || ''))
            || connectors.find(c => c.id === 'injected');
    if (!mm) { alert('No injected wallet found. Open this page inside MetaMask, or use WalletConnect.'); return; }
    // Pass chainId so a chain mismatch can't silently stall the connect.
    connect({ connector: mm, chainId: EXPECTED_CHAIN });
  };
  const connectWalletConnect = () => {
    const wc = connectors.find(c => c.id === 'walletConnect');
    if (wc) connect({ connector: wc, chainId: EXPECTED_CHAIN });
    else alert('WalletConnect is not configured. Set NEXT_PUBLIC_WC_PROJECT_ID.');
  };
  const connectFarcaster     = () => connect({ connector: connectors.find(c => c.id === 'farcasterMiniApp') });

  return {
    address,
    isConnected,
    chainId,
    chipsBalance,
    pppBalance: chipsBalance,  // backwards-compat alias
    nativeBalance: nativeBal ? Number(formatUnits(nativeBal.value, 18)) : 0,
    isHuman: !!isHuman,
    refetchIsHuman,
    connectMetaMask,
    connectWalletConnect,
    connectFarcaster,
    connectStatus,            // 'idle' | 'pending' | 'success' | 'error'
    connectError,             // wagmi connect error (null when none)
    disconnect,
  };
}

// ─── HOOK: STAKING ────────────────────────────────────────────────────────────
export function useStaking() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle');

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: stakeInfo, refetch: refetchStake } = useReadContract({
    address: STAKING, abi: STAKING_ABI, functionName: "getStakeInfo",
    args: [address], query: { enabled: !!address && !!STAKING, refetchInterval: 15000 },
  });

  const { data: pendingRaw, refetch: refetchPending } = useReadContract({
    address: STAKING, abi: STAKING_ABI, functionName: "pendingYield",
    args: [address], query: { enabled: !!address && !!STAKING, refetchInterval: 15000 },
  });

  const { data: rakebackRaw, refetch: refetchRakeback } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "rakebackAccrued",
    args: [address], query: { enabled: !!address && !!ESCROW, refetchInterval: 15000 },
  });

  const stakedAmount  = stakeInfo ? Number(formatUnits(stakeInfo[0], 18)) : 0;
  const currentTier   = stakeInfo ? Number(stakeInfo[1]) : 0;
  const lockedUntil   = stakeInfo ? Number(stakeInfo[2]) : 0;
  const pendingYield  = pendingRaw  ? Number(formatUnits(pendingRaw,  18)) : 0;
  const rakebackOwed  = rakebackRaw ? Number(formatUnits(rakebackRaw, 18)) : 0;

  const stake = useCallback(async (amount) => {
    if (!address || !STAKING) return;
    try {
      const chipsInt = Math.round(Number(amount));
      if (!chipsInt || chipsInt <= 0) { setStatus('error'); return; }
      const amountBN = parseUnits(String(chipsInt), 18);
      // Skip the approve popup if we've already approved enough — avoids the flaky
      // back-to-back double popup on MetaMask mobile that leaves the 2nd one blank.
      if (!(await hasAllowance(publicClient, address, STAKING, amountBN))) {
        setStatus('approving');
        const approveFees = await safeFeeOverrides(publicClient);
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
          args: [STAKING, amountBN], ...approveFees,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('staking');
      const stakeFees = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "stake",
        args: [amountBN], ...stakeFees,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: tx, timeout: 60_000 });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) { console.error('stake error:', e); setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const unstake = useCallback(async (amount) => {
    if (!address || !STAKING) return;
    try {
      setStatus('unstaking');
      const chipsInt = Math.round(Number(amount));
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "unstake",
        args: [parseUnits(String(chipsInt), 18)], ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch (e) { console.error('unstake error:', e); setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const claimYield = useCallback(async () => {
    if (!address || !STAKING) return;
    try {
      setStatus('claiming');
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "claimYield", args: [],
        ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const claimRakeback = useCallback(async () => {
    if (!address || !ESCROW) return;
    try {
      setStatus('claiming');
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "claimRakeback", args: [],
        ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const compound = useCallback(async () => {
    if (!address || !STAKING) return;
    try {
      setStatus('compounding');
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "compound", args: [],
        ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  return {
    stakedAmount, currentTier, lockedUntil, pendingYield, rakebackOwed,
    stake, unstake, claimYield, claimRakeback, compound,
    status, confirmed,
    refetch: () => { refetchStake(); refetchPending(); refetchRakeback(); },
  };
}

// ─── HOOK: ESCROW ACTIONS ──────────────────────────────────────────────────────
export function useEscrow(tableId) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]   = useState(null);
  const [status, setStatus]   = useState('idle'); // idle | approving | buying | settling | error

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Read whether table is leased (resolved later in hook; use ref so buyIn callback is stable)
  const seatFeeRef = useRef(0n);

  const buyIn = useCallback(async (buyInAmount) => {
    if (!address || !tableId) return;
    try {
      const amountBN    = parseUnits(Math.round(Number(buyInAmount)).toString(), 18);
      const seatFeeAmt  = seatFeeRef.current; // 0 for open tables, >0 for leased tables
      const needed      = amountBN + seatFeeAmt;
      const feeOverrides = await safeFeeOverrides(publicClient);
      // Step 1: Approve escrow to spend only what's needed — skip if already approved
      if (!(await hasAllowance(publicClient, address, ESCROW, needed))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
          args: [ESCROW, needed],
          ...feeOverrides,
        });
        setTxHash(approveTx);
        // Wait for approve tx to be mined before submitting buyIn
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      // Step 2: Buy in
      setStatus('buying');
      const buyInTx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "buyIn",
        args: [BigInt(tableId)],
        ...feeOverrides,
      });
      setTxHash(buyInTx);
      setStatus('idle');
      return buyInTx;
    } catch (e) {
      console.error("buyIn error:", e);
      setStatus('error');
    }
  }, [address, tableId, writeContractAsync, publicClient]);

  const refund = useCallback(async () => {
    try {
      setStatus('refunding');
      const tx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "refund",
        args: [BigInt(tableId)],
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) { setStatus('error'); }
  }, [tableId, writeContractAsync]);

  // rebuy: approve + on-chain rebuy, then notify the game server
  const rebuy = useCallback(async (amount, notifyServer) => {
    if (!address || !tableId) return;
    try {
      const amountBN = parseUnits(Math.round(Number(amount)).toString(), 18);
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, ESCROW, amountBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
          args: [ESCROW, amountBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('buying');
      const rebuyTx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "rebuy",
        args: [BigInt(tableId), amountBN], ...feeOverrides,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: rebuyTx, timeout: 30_000 });
      // Tell the game server to update the in-game stack
      notifyServer?.();
      setStatus('idle');
      return rebuyTx;
    } catch (e) {
      console.error("rebuy error:", e);
      setStatus('error');
    }
  }, [address, tableId, writeContractAsync, publicClient]);

  // cashOut: submit an operator-signed cashout to the contract
  const cashOut = useCallback(async (player, amount, nonce, sig) => {
    if (!ESCROW) return;
    try {
      setStatus('cashout');
      const args = [BigInt(tableId), player, BigInt(amount), BigInt(nonce), sig];
      try {
        await publicClient.simulateContract({
          address: ESCROW, abi: ESCROW_ABI, functionName: "cashOut", args, account: player,
        });
      } catch (simErr) {
        console.error("cashOut simulate failed:", simErr.shortMessage || simErr.message);
        setStatus('error');
        return;
      }
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "cashOut", args, ...feeOverrides,
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      console.error("cashOut error:", e);
      setStatus('error');
    }
  }, [tableId, writeContractAsync, publicClient]);

  // Table info read
  const { data: tableInfo } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "getTableInfo",
    args: [BigInt(tableId || 0)],
    query: { enabled: !!tableId, refetchInterval: 5000 },
  });

  const { data: tableRoomId } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "tableRoom",
    args: [BigInt(tableId || 0)],
    query: { enabled: !!tableId },
  });

  const { data: seatFeeOnChain } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "seatFeeCHIPS",
    query: { enabled: !!ESCROW },
  });

  const isLeased = tableRoomId != null && tableRoomId > 0n;
  const seatFee  = isLeased ? (seatFeeOnChain ?? parseUnits("2", 18)) : 0n;

  // Keep seatFeeRef in sync so the buyIn callback always has the latest value
  useEffect(() => { seatFeeRef.current = seatFee; }, [seatFee]);

  return { buyIn, rebuy, refund, cashOut, txHash, status, confirmed, tableInfo, isLeased, seatFee };
}

// ─── AUTH CACHE (sessionStorage) ─────────────────────────────────────────────
// Survives page navigation within the same tab so PVP-AUTH fires only once per session.
function getAuthCache(address) {
  try {
    const c = JSON.parse(sessionStorage.getItem('pvp-auth') || 'null');
    return c?.address?.toLowerCase() === address?.toLowerCase() ? c : null;
  } catch { return null; }
}
function setAuthCache(auth) {
  try { sessionStorage.setItem('pvp-auth', JSON.stringify(auth)); } catch {}
}
function clearAuthCache() {
  try { sessionStorage.removeItem('pvp-auth'); } catch {}
}

// ─── HOOK: TABLE WEBSOCKET ────────────────────────────────────────────────────
// Connects, authenticates, and manages real-time game state for a single table.
export function useTableSocket(tableId, tableConfig) {
  const { address }          = useAccount();
  const { signMessageAsync } = useSignMessage();
  const serverUrl            = safeWsUrl(process.env.NEXT_PUBLIC_WS_URL);

  const [gameState,       setGameState]       = useState(null);
  const [handOver,        setHandOver]        = useState(null);
  const [tableList,       setTableList]       = useState([]);
  const [wsStatus,        setWsStatus]        = useState('disconnected');
  const [wsError,         setWsError]         = useState(null);
  const [cashoutSig,      setCashoutSig]      = useState(null);
  const [cashoutLocked,   setCashoutLocked]   = useState(null);
  const [tableLocked,     setTableLocked]     = useState(false);
  const [refundAvailable, setRefundAvailable] = useState(false);
  const [seatPickerData,  setSeatPickerData]  = useState(null); // { maxPlayers, takenSeats }
  const [needsRebuy,      setNeedsRebuy]      = useState(null); // { busted: [addr,...] } — set when hero busts out
  const [reconnectKey,    setReconnectKey]    = useState(0);
  const [botStatus,       setBotStatus]       = useState(null); // null | 'spawning' | 'seated' | 'already_seated' | 'error'
  const wsRef           = useRef(null);
  const authCacheRef    = useRef(null);
  const authFailedRef   = useRef(false); // set true on sign dismiss — breaks infinite reconnect loop
  const tableConfigRef  = useRef(tableConfig); // keep latest config accessible inside ws callbacks
  tableConfigRef.current = tableConfig;

  useEffect(() => {
    if (!serverUrl || !address) return;

    setWsStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(serverUrl);
    } catch (err) {
      console.error('[useTableSocket] WebSocket creation failed:', err);
      setWsError('Unable to connect to game server');
      setWsStatus('disconnected');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      authFailedRef.current = false; // reset on each new connection attempt
      setWsStatus('connected');
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'AUTH_CHALLENGE': {
            signMessageAsync({ message: `PVP-AUTH:${msg.nonce}` })
              .then(signature => {
                if (ws.readyState === WebSocket.OPEN) {
                  authCacheRef.current = { address, nonce: msg.nonce, signature };
                  ws.send(JSON.stringify({ type: 'AUTH', payload: { address, signature } }));
                } else {
                  authFailedRef.current = true;
                  setWsError('Connection lost during sign — refresh to retry');
                }
              })
              .catch(() => {
                authFailedRef.current = true;
                setWsError('Wallet signature required — refresh to retry');
                ws.close();
              });
            break;
          }
          case 'AUTH_OK':
            setWsStatus('authed');
            if (tableId) {
              // Always send JOIN_TABLE immediately; include config if available (server uses defaults otherwise)
              ws.send(JSON.stringify({ type: 'JOIN_TABLE', payload: { tableId, config: tableConfigRef.current || undefined } }));
            } else {
              ws.send(JSON.stringify({ type: 'LIST_TABLES' }));
            }
            break;
          case 'AUTH_FAIL':
            clearAuthCache();
            authCacheRef.current = null;
            setWsError('Authentication failed — check wallet signature');
            break;
          case 'GAME_STATE': {
            setGameState(msg.state);
            setSeatPickerData(null); // seated — dismiss picker
            if (msg.state && address) {
              const hero = msg.state.players?.find(
                p => p.addr?.toLowerCase() === address.toLowerCase()
              );
              if (hero) {
                const locked = (hero.cashoutLockedUntil ?? 0) > (msg.state.handNonce ?? 0);
                setCashoutLocked(locked ? { handsRemaining: (hero.cashoutLockedUntil ?? 0) - (msg.state.handNonce ?? 0) } : null);
                setNeedsRebuy(null); // hero is seated again — clear any pending busted-rebuy prompt
              }
              if (!msg.state.anyLocked) setTableLocked(false);
            }
            break;
          }
          case 'HAND_OVER':
            setHandOver(msg);
            break;
          case 'CASHOUT_SIG':
            setCashoutSig({ amount: msg.amount, sig: msg.sig, nonce: msg.nonce, tableId: msg.tableId });
            break;
          case 'CASHOUT_LOCKED':
            setCashoutLocked({ handsRemaining: msg.handsRemaining });
            break;
          case 'TABLE_LOCKED':
            setTableLocked(true);
            break;
          case 'REFUND_AVAILABLE':
            setRefundAvailable(true);
            break;
          case 'SEAT_PICKER':
            setSeatPickerData({ maxPlayers: msg.maxPlayers, takenSeats: msg.takenSeats || [],
              minBuyIn: msg.minBuyIn, maxBuyIn: msg.maxBuyIn });
            break;
          case 'REBUY_OK':
            break;
          case 'NEEDS_REBUY':
            setNeedsRebuy({ busted: msg.busted || [] });
            break;
          case 'TABLE_LIST':
            setTableList(msg.tables || []);
            break;
          case 'BOT_STATUS':
            setBotStatus(msg.status); // 'seated' | 'already_seated'
            break;
          case 'ERROR':
            setWsError(msg.error);
            if (msg.error?.toLowerCase().includes('bot') || msg.error?.toLowerCase().includes('seat')) {
              setBotStatus('error');
            }
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      wsRef.current = null;
      if (!authFailedRef.current) {
        setTimeout(() => setReconnectKey(k => k + 1), 3000);
      }
    };
    ws.onerror = () => setWsError('Connection error');

    return () => {
      ws.onclose = null; // prevent reconnect loop on intentional cleanup
      ws.close();
    };
  }, [serverUrl, address, tableId, reconnectKey]);

  const sendAction = useCallback((action, amount) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'ACTION', payload: { tableId, action, amount } }));
  }, [tableId]);

  const leaveTable = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'LEAVE_TABLE', payload: { tableId } }));
  }, [tableId]);

  const sendRebuyConfirmed = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'REBUY_CONFIRMED', payload: { tableId } }));
  }, [tableId]);

  const refreshTables = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'LIST_TABLES' }));
  }, []);

  const joinWithSeat = useCallback((seatIndex, buyInAmount) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'JOIN_TABLE', payload: { tableId, seatIndex, buyInAmount: buyInAmount || undefined, config: tableConfig || undefined } }));
  }, [tableId, tableConfig]);

  const spawnBot = useCallback((buyInAmount, count) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setBotStatus('spawning');
      wsRef.current.send(JSON.stringify({ type: 'SPAWN_BOT', payload: { tableId, buyIn: buyInAmount, count } }));
    }
  }, [tableId]);

  return {
    gameState, handOver, tableList, wsStatus, wsError,
    cashoutSig, setCashoutSig,
    cashoutLocked, tableLocked, refundAvailable,
    seatPickerData, needsRebuy,
    sendAction, leaveTable, sendRebuyConfirmed, refreshTables, joinWithSeat, spawnBot, botStatus,
  };
}

// ─── HOOK: CREATE TABLE ───────────────────────────────────────────────────────
export function useCreateTable() {
  const { address, chainId }   = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (receipt?.status === 'success') setStatus('confirmed');
  }, [receipt]);

  const EXPECTED_CHAIN = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 421614);

  const createTable = useCallback(async ({ buyIn, bigBlind, maxPlayers, gameType }) => {
    setErrorMsg(null);
    if (!address) { setErrorMsg('Connect your wallet first.'); return null; }
    if (!ESCROW)  { setErrorMsg('Contract not configured — run npm run setup:env and restart.'); return null; }
    if (chainId !== EXPECTED_CHAIN) {
      setErrorMsg(`Wrong network — switch MetaMask to ${EXPECTED_CHAIN === 421614 ? 'Arbitrum Sepolia' : 'Arbitrum One'} (chain ${EXPECTED_CHAIN}).`);
      return null;
    }
    setStatus('pending');
    try {
      const buyInBN    = parseUnits(Math.round(Number(buyIn)).toString(), 18);
      const bigBlindBN = parseUnits(Math.round(Number(bigBlind)).toString(), 18);
      const feeOverrides = await safeFeeOverrides(publicClient);
      const hash = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: 'createTable',
        args: [buyInBN, bigBlindBN, maxPlayers, gameType, 0n],
        chainId: EXPECTED_CHAIN,
        ...feeOverrides,
      });
      setTxHash(hash);
      return hash;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
      return null;
    }
  }, [address, chainId, writeContractAsync, publicClient, EXPECTED_CHAIN]);

  // Extract tableId from receipt logs (TableCreated event first indexed param)
  const newTableId = receipt?.logs?.[0]
    ? (() => {
        try {
          const idHex = receipt.logs[0].topics?.[1];
          return idHex ? BigInt(idHex).toString() : null;
        } catch { return null; }
      })()
    : null;

  return { createTable, status, txHash, newTableId, errorMsg };
}

// ─── HOOK: POKER HANDLE NFT ───────────────────────────────────────────────────
export function useHandle() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: myHandle, refetch: refetchHandle } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "getHandleByAddress",
    args: [address],
    query: { enabled: !!address && !!HANDLE },
  });

  const { data: mintCostRaw } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "getCurrentMintCost",
    query: { enabled: !!HANDLE, refetchInterval: 15000 },
  });

  const { data: currentTierRaw } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "getCurrentTier",
    query: { enabled: !!HANDLE, refetchInterval: 15000 },
  });

  const { data: totalMinted, refetch: refetchTotalMinted } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "totalMinted",
    query: { enabled: !!HANDLE, refetchInterval: 15000 },
  });

  // Read all four tier costs for the pricing table
  const { data: cost0 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [0n], query: { enabled: !!HANDLE } });
  const { data: cost1 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [1n], query: { enabled: !!HANDLE } });
  const { data: cost2 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [2n], query: { enabled: !!HANDLE } });
  const { data: cost3 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [3n], query: { enabled: !!HANDLE } });

  const mintCost    = mintCostRaw ? Number(formatUnits(mintCostRaw, 18)) : 5000;
  const currentTier = currentTierRaw != null ? Number(currentTierRaw) : 0;
  const DEFAULTS    = [5000, 10000, 15000, 20000];
  const tierCostsCHIPS = [cost0, cost1, cost2, cost3].map((c, i) =>
    c != null ? Number(formatUnits(c, 18)) : DEFAULTS[i]
  );
  const TIER_LABELS = ['$5', '$10', '$15', '$20'];
  const TIER_BOUNDS = [10_000, 110_000, 1_110_000];

  const mint = useCallback(async (handle) => {
    if (!address || !HANDLE || !CHIPS) return;
    setErrorMsg(null);
    if (!mintCostRaw) { setErrorMsg('Loading mint cost — please wait a moment and try again.'); setStatus('error'); return; }
    try {
      const costBN = mintCostRaw;
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, HANDLE, costBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
          args: [HANDLE, costBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('minting');
      const mintTx = await writeContractAsync({
        address: HANDLE, abi: HANDLE_ABI, functionName: "mintHandle",
        args: [handle], gas: 400_000n, ...feeOverrides,
      });
      setTxHash(mintTx);
      await waitForTransactionReceipt(wagmiConfig, { hash: mintTx, timeout: 60_000 });
      await refetchHandle();
      await refetchTotalMinted();
      setStatus('idle');
      return mintTx;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [address, mintCostRaw, writeContractAsync, publicClient, refetchHandle, refetchTotalMinted]);

  useEffect(() => {
    if (confirmed) {
      refetchHandle();
      refetchTotalMinted();
    }
  }, [confirmed, refetchHandle, refetchTotalMinted]);

  return {
    myHandle: myHandle || null,
    hasHandle: !!myHandle,
    mintCost,
    currentTier,
    tierCostsCHIPS,
    TIER_LABELS,
    TIER_BOUNDS,
    totalMinted: totalMinted ? Number(totalMinted) : 0,
    mint, status, txHash, confirmed, errorMsg,
    refetch: refetchHandle,
  };
}

// ─── HOOK: HANDLE MAP (batch lookup address → handle) ────────────────────────
export function useHandleMap(addresses) {
  const cleaned = useMemo(() => (addresses || []).filter(Boolean), [addresses?.join(',')]);
  const { data } = useReadContracts({
    contracts: cleaned.map(addr => ({
      address: HANDLE, abi: HANDLE_ABI,
      functionName: 'getHandleByAddress', args: [addr],
    })),
    query: { enabled: !!HANDLE && cleaned.length > 0 },
  });
  return useMemo(() => {
    const map = {};
    cleaned.forEach((addr, i) => {
      const h = data?.[i]?.result;
      if (h) map[addr.toLowerCase()] = h;
    });
    return map;
  }, [data, cleaned]);
}

// ─── HOOK: HANDLE AVATARS (on-chain NFT image per address) ───────────────────
export function useHandleAvatars(addresses) {
  const cleaned = useMemo(() => (addresses || []).filter(Boolean), [addresses?.join(',')]);

  const { data: tokenIdData } = useReadContracts({
    contracts: cleaned.map(addr => ({
      address: HANDLE, abi: HANDLE_ABI,
      functionName: 'ownerTokenId', args: [addr],
    })),
    query: { enabled: !!HANDLE && cleaned.length > 0, refetchInterval: 5000 },
  });

  const validEntries = useMemo(() => {
    if (!tokenIdData) return [];
    return cleaned.map((addr, i) => {
      const tokenId = tokenIdData[i]?.result;
      return tokenId && tokenId > 0n ? { addr, tokenId } : null;
    }).filter(Boolean);
  }, [tokenIdData, cleaned]);

  const { data: uriData } = useReadContracts({
    contracts: validEntries.map(({ tokenId }) => ({
      address: HANDLE, abi: HANDLE_ABI,
      functionName: 'tokenURI', args: [tokenId],
    })),
    query: { enabled: validEntries.length > 0, refetchInterval: 5000 },
  });

  return useMemo(() => {
    const map = {};
    validEntries.forEach(({ addr }, i) => {
      const uri = uriData?.[i]?.result;
      if (!uri) return;
      try {
        const json = JSON.parse(atob(uri.replace('data:application/json;base64,', '')));
        if (json.image) map[addr.toLowerCase()] = json.image;
      } catch {}
    });
    return map;
  }, [uriData, validEntries]);
}

// ─── HOOK: LEADERBOARD (handle holders sorted by staked CHIPS) ───────────────
export function useLeaderboard() {
  const publicClient = usePublicClient();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!HANDLE || !STAKING || !publicClient) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        let fromBlock;
        if (process.env.NEXT_PUBLIC_DEPLOY_BLOCK) {
          fromBlock = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK);
        } else {
          // No deploy block known — cap to last 500K blocks to stay within Alchemy limits
          const latest = await publicClient.getBlockNumber();
          fromBlock = latest > 500_000n ? latest - 500_000n : 0n;
        }
        const logs = await publicClient.getLogs({
          address: HANDLE,
          event: parseAbiItem('event HandleMinted(address indexed player, uint256 indexed tokenId, string handle, uint256 burned)'),
          fromBlock,
        });
        if (cancelled) return;
        const addrMap = {};
        logs.forEach(l => { addrMap[l.args.player.toLowerCase()] = l.args.handle; });
        const addrs = Object.keys(addrMap);
        if (!addrs.length) { setEntries([]); setLoading(false); return; }

        const results = await publicClient.multicall({
          contracts: addrs.map(a => ({
            address: STAKING, abi: STAKING_ABI,
            functionName: 'getStakeInfo', args: [a],
          })),
        });
        if (cancelled) return;

        const rows = addrs.map((addr, i) => {
          const info = results[i]?.result;
          return {
            addr,
            handle: addrMap[addr],
            staked: info ? Number(formatUnits(info[0], 18)) : 0,
            tier:   info ? Number(info[1]) : 0,
          };
        }).sort((a, b) => b.staked - a.staked)
          .map((r, idx) => ({ ...r, rank: idx + 1 }));

        setEntries(rows);
      } catch (e) {
        console.error('[useLeaderboard]', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [publicClient]);

  return { entries, loading };
}

// ─── HOOK: TOURNAMENTS ────────────────────────────────────────────────────────
export function useTournaments() {
  const { address }  = useAccount();

  const { data: countRaw } = useReadContract({
    address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: 'tournamentCount',
    query: { enabled: !!TOURNAMENT, refetchInterval: 15000 },
  });
  const count = countRaw ? Number(countRaw) : 0;
  const ids   = Array.from({ length: count }, (_, i) => BigInt(i + 1));

  const { data: tournData } = useReadContracts({
    contracts: ids.map(id => ({
      address: TOURNAMENT, abi: TOURNAMENT_ABI,
      functionName: 'tournaments', args: [id],
    })),
    query: { enabled: !!TOURNAMENT && count > 0, refetchInterval: 15000 },
  });

  const { data: regData } = useReadContracts({
    contracts: ids.map(id => ({
      address: TOURNAMENT, abi: TOURNAMENT_ABI,
      functionName: 'registered', args: [id, address],
    })),
    query: { enabled: !!TOURNAMENT && count > 0 && !!address },
  });

  const tournaments = useMemo(() =>
    ids.map((id, i) => {
      const t = tournData?.[i]?.result;
      if (!t) return null;
      return {
        id:              Number(t[0]),
        name:            t[1],
        entryFee:        Number(formatUnits(t[2], 18)),
        startTime:       Number(t[3]),
        maxPlayers:      Number(t[4]),
        gameType:        Number(t[5]),
        status:          Number(t[6]),   // 0=Registration 1=Running 2=Settled 3=Cancelled
        entrantCount:    t[7]?.length ?? 0,
        prizePool:       Number(formatUnits(t[8], 18)),
        guaranteed:      t[10],
        guaranteedPrize: Number(formatUnits(t[11], 18)),
        isRegistered:    !!(regData?.[i]?.result),
      };
    }).filter(Boolean),
  [tournData, regData, ids]);

  return { tournaments, count };
}

export function useRegisterTournament() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [status, setStatus]    = useState('idle');
  const [txHash, setTxHash]    = useState(null);

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const register = useCallback(async (tournId, entryFee) => {
    if (!address || !TOURNAMENT || !CHIPS) return;
    try {
      const feeBN = parseUnits(String(entryFee), 18);
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, TOURNAMENT, feeBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: 'approve',
          args: [TOURNAMENT, feeBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('registering');
      const tx = await writeContractAsync({
        address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: 'register',
        args: [BigInt(tournId)], ...feeOverrides,
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      console.error('register error:', e);
      setStatus('error');
    }
  }, [address, writeContractAsync, publicClient]);

  return { register, status, txHash, confirmed };
}

// ─── HOOK: TABLE REGISTRY (private room leasing) ──────────────────────────────
export function useTableRegistry() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]     = useState(null);
  const [status, setStatus]     = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: weeklyFeeRaw } = useReadContract({
    address: TABLE_REGISTRY, abi: REGISTRY_ABI, functionName: 'weeklyFee',
    query: { enabled: !!TABLE_REGISTRY },
  });
  const { data: monthlyFeeRaw } = useReadContract({
    address: TABLE_REGISTRY, abi: REGISTRY_ABI, functionName: 'monthlyFee',
    query: { enabled: !!TABLE_REGISTRY },
  });
  const { data: roomsRaw, refetch: refetchRooms } = useReadContract({
    address: TABLE_REGISTRY, abi: REGISTRY_ABI, functionName: 'getPublicRooms',
    query: { enabled: !!TABLE_REGISTRY, refetchInterval: 15000 },
  });

  const weeklyFee  = weeklyFeeRaw  ? Number(formatUnits(weeklyFeeRaw, 18))  : 33500;
  const monthlyFee = monthlyFeeRaw ? Number(formatUnits(monthlyFeeRaw, 18)) : 100000;

  const publicRooms = useMemo(() => (roomsRaw || []).map(r => ({
    id:          Number(r.id),
    lessee:      r.lessee,
    name:        r.name,
    nftGate:     r.nftGate,
    minBuyIn:    Number(formatUnits(r.minBuyIn, 18)),
    maxBuyIn:    Number(formatUnits(r.maxBuyIn, 18)),
    maxPlayers:  Number(r.maxPlayers),
    gameType:    Number(r.gameType),
    isPublic:    r.isPublic,
    leaseExpiry: Number(r.leaseExpiry),
    dailyRate:   Number(formatUnits(r.dailyRate, 18)),
  })), [roomsRaw]);

  const leaseRoom = useCallback(async ({ name, weeks, months, nftGate, minBuyIn, maxBuyIn, maxPlayers, gameType, isPublic }) => {
    setErrorMsg(null);
    if (!address) { setErrorMsg('Connect your wallet first.'); return null; }
    if (!TABLE_REGISTRY || !CHIPS) { setErrorMsg('Contract not configured — run npm run setup:env and restart.'); return null; }
    if (nftGate && !isAddress(nftGate)) { setErrorMsg('NFT gate must be a valid contract address.'); return null; }
    try {
      const useMonths = !!months;
      const count   = BigInt(useMonths ? months : weeks);
      const feeRate = useMonths ? (monthlyFeeRaw ?? 0n) : (weeklyFeeRaw ?? 0n);
      const feeBN   = feeRate * count;
      const nftGateAddr = nftGate ? nftGate : '0x0000000000000000000000000000000000000000';
      const minBuyInBN  = parseUnits(String(minBuyIn || 0), 18);
      const maxBuyInBN  = parseUnits(String(maxBuyIn || 0), 18);
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, TABLE_REGISTRY, feeBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: 'approve',
          args: [TABLE_REGISTRY, feeBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('leasing');
      const tx = await writeContractAsync({
        address: TABLE_REGISTRY, abi: REGISTRY_ABI,
        functionName: useMonths ? 'leaseRoomMonths' : 'leaseRoom',
        args: [count, nftGateAddr, minBuyInBN, maxBuyInBN, maxPlayers, gameType, isPublic, name],
        ...feeOverrides,
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
      return null;
    }
  }, [address, writeContractAsync, publicClient, weeklyFeeRaw, monthlyFeeRaw]);

  useEffect(() => { if (confirmed) refetchRooms(); }, [confirmed, refetchRooms]);

  return { weeklyFee, monthlyFee, publicRooms, leaseRoom, status, txHash, confirmed, errorMsg, refetchRooms };
}

// Legacy hook kept for backwards compatibility
export function useGameSocket(serverUrl, address, onMessage) {
  const wsRef   = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!serverUrl || !address) return;
    let ws;
    try {
      ws = new WebSocket(safeWsUrl(serverUrl));
    } catch (err) {
      console.error('[useGameSocket] WebSocket creation failed:', err);
      return;
    }
    wsRef.current = ws;
    ws.onopen    = () => setReady(true);
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
    ws.onclose   = () => setReady(false);
    return () => ws.close();
  }, [serverUrl, address]);

  const send = useCallback((type, payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type, payload }));
  }, []);

  return { send, ready };
}
