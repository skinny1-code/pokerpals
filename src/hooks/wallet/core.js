// src/hooks/wallet/core.js
// wagmi config, contract ABIs, contract addresses, and shared tx helpers used
// across every hook in src/hooks/wallet/*. No React hooks live here — just
// config and plain functions.

import { createConfig, http } from "wagmi";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

// ─── WS URL HELPER ─────────────────────────────────────────────────────────────
// Upgrades ws:// → wss:// when the page is served over https (avoids mixed-content block).
export function safeWsUrl(url) {
  if (!url) return url;
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return url.replace(/^ws:\/\//, 'wss://');
  }
  return url;
}

// Game-server URL, resolved once. The localhost fallback keeps local dev working
// without configuration and — more importantly — turns a missing NEXT_PUBLIC_WS_URL
// in a production build into a VISIBLE connection error instead of every WS/HTTP
// consumer silently doing nothing (the username-claim gate used to dead-end with
// zero feedback when this var was absent at build time).
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';

// The game server also answers plain HTTP requests on the same port (see
// server/index.js's createServer) — /usernames and /claim-username for the free
// display-name store. Reuses safeWsUrl's https-upgrade so it never mixed-content-blocks.
export function wsHttpUrl() {
  return safeWsUrl(WS_URL).replace(/^ws/, 'http');
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

// Chain the app expects players to be on (matches WalletBar's EXPECTED).
export const EXPECTED_CHAIN = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 421614);

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

export const HAND_HISTORY_ABI = [
  { name:"getStats", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}],
    outputs:[{name:"handsPlayed",type:"uint256"},{name:"handsWon",type:"uint256"},
             {name:"totalWinnings",type:"uint256"},{name:"lastBatchAt",type:"uint256"}] },
];

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
  { name:"changeHandle", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"newHandle",type:"string"}], outputs:[] },
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
  { name:"HandleChanged", type:"event",
    inputs:[
      {name:"player",type:"address",indexed:true},
      {name:"tokenId",type:"uint256",indexed:true},
      {name:"oldHandle",type:"string",indexed:false},
      {name:"newHandle",type:"string",indexed:false},
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

export const LIQUIDITY_POOL_ABI = [
  { name:"buyChips",   type:"function", stateMutability:"nonpayable",
    inputs:[{name:"usdcAmount",type:"uint256"}], outputs:[] },
  { name:"redeemChips", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"chipsAmount",type:"uint256"}], outputs:[] },
  { name:"quoteChipsOut", type:"function", stateMutability:"view",
    inputs:[{name:"usdcAmount",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"quoteUsdcOut", type:"function", stateMutability:"view",
    inputs:[{name:"chipsAmount",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"rateUsdcPerChip", type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"paused",      type:"function", stateMutability:"view", inputs:[], outputs:[{type:"bool"}] },
  { name:"chipsBalance", type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"ChipsBought", type:"event",
    inputs:[
      {name:"buyer",type:"address",indexed:true},{name:"usdcIn",type:"uint256",indexed:false},
      {name:"chipsOut",type:"uint256",indexed:false},
    ]},
  { name:"ChipsRedeemed", type:"event",
    inputs:[
      {name:"redeemer",type:"address",indexed:true},{name:"chipsIn",type:"uint256",indexed:false},
      {name:"usdcOut",type:"uint256",indexed:false},
    ]},
];

// ─── CONTRACT ADDRESSES ────────────────────────────────────────────────────────
export const CHIPS          = process.env.NEXT_PUBLIC_CHIPS_TOKEN || process.env.NEXT_PUBLIC_PPP_TOKEN;
export const ESCROW         = process.env.NEXT_PUBLIC_ESCROW;
export const STAKING        = process.env.NEXT_PUBLIC_STAKING;
export const HANDLE         = process.env.NEXT_PUBLIC_POKER_HANDLE;
export const TOURNAMENT     = process.env.NEXT_PUBLIC_TOURNAMENT;
export const TABLE_REGISTRY = process.env.NEXT_PUBLIC_TABLE_REGISTRY;
export const KINGS_POOL     = process.env.NEXT_PUBLIC_KINGS_POOL;
export const PROMOTIONS_POOL = process.env.NEXT_PUBLIC_PROMOTIONS_POOL;
export const STABLECOIN_POOL = process.env.NEXT_PUBLIC_STABLECOIN_POOL;
export const LIQUIDITY_POOL  = process.env.NEXT_PUBLIC_LIQUIDITY_POOL;
export const MOCK_USDC      = process.env.NEXT_PUBLIC_MOCK_USDC;
export const HAND_HISTORY    = process.env.NEXT_PUBLIC_HAND_HISTORY;
export const USDC_ADDR      = MOCK_USDC || process.env.NEXT_PUBLIC_USDC;

// Exported for dashboard and other consumers
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

// ─── TX FEE HELPERS ────────────────────────────────────────────────────────────
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

export async function safeFeeOverrides(publicClient) {
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

// Returns true if `owner` has already approved at least `needed` of `tokenAddr` (default CHIPS)
// to `spender`. Lets the write flows skip a redundant approve popup — critical on MetaMask
// mobile, where back-to-back approve→action popups frequently leave the 2nd one blank/stuck.
export async function hasAllowance(publicClient, owner, spender, needed, tokenAddr = CHIPS) {
  if (!publicClient || !owner || !spender) return false;
  try {
    const current = await publicClient.readContract({
      address: tokenAddr, abi: CHIPS_ABI, functionName: "allowance", args: [owner, spender],
    });
    return current >= needed;
  } catch {
    return false; // can't read — fall back to approving
  }
}
