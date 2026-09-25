// server/index.js — Node 20+ WebSocket game server
// Run: node server/index.js
// Env: OPERATOR_PRIVATE_KEY, NEXT_PUBLIC_ESCROW, ARB_SEPOLIA_RPC, PORT

import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { ethers } from "ethers";
import crypto from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { fullVerify, BehaviorMonitor } from "./antiBotOracle.js";
import { getUsernames, claimUsername, storeStatus } from "./usernameStore.js";
import { decide as botDecide } from "./botBrain.js";
import { createCashoutRelay } from "./cashoutRelay.js";
import { createOperatorQueue } from "./operatorQueue.js";
import { createConnectionGuard, clientIp } from "./connectionGuard.js";
import { buildSidePots, awardPots, payoutsToShares } from "./sidePots.js";
import { canRevealHand, canElectToShow } from "./reveal.js";
import { chooseSeat } from "./seating.js";

// Prevent unhandled rejections from crashing the server
process.on('uncaughtException',    e => console.error('[Server] uncaughtException:', e.message));
process.on('unhandledRejection',   e => console.error('[Server] unhandledRejection:', e?.message ?? e));

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDeployment() {
  try {
    return JSON.parse(readFileSync(join(__dirname, "../deployments/arbitrumSepolia.json"), "utf8"));
  } catch { return null; }
}
const _depl = loadDeployment();

const PORT         = process.env.PORT || 4000;
const OPERATOR_KEY = process.env.OPERATOR_PRIVATE_KEY;

// Contract addresses: the committed deployment manifest wins over env secrets.
// Fly secrets are a snapshot from whenever `fly secrets set` last ran and rot
// silently across contract redeploys — the manifest ships with every code
// deploy and always matches what the frontend resolves to. (A stale
// NEXT_PUBLIC_ESCROW secret once had this server calling markHuman on a
// retired escrow generation for weeks: every verification reverted
// "Unauthorized" while the fix had been applied to the current contract.)
function resolveAddr(name, manifestValue, ...envValues) {
  const envValue = envValues.find(Boolean);
  if (manifestValue && envValue && manifestValue.toLowerCase() !== envValue.toLowerCase()) {
    console.warn(`[Server] WARNING: ${name} env secret (${envValue}) differs from deployment manifest (${manifestValue}) — using the manifest. Remove or update the stale secret.`);
  }
  return manifestValue || envValue;
}
const ESCROW_ADDR  = resolveAddr('ESCROW', _depl?.contracts?.PokerEscrow,
  process.env.NEXT_PUBLIC_ESCROW, process.env.ESCROW_ADDRESS);
const RPC_URL      = process.env.ARB_SEPOLIA_RPC || process.env.ARB_RPC || process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";

if (!ESCROW_ADDR) { console.error('[Server] FATAL: ESCROW_ADDR not set — add NEXT_PUBLIC_ESCROW to secrets or deploy first'); process.exit(1); }
if (!OPERATOR_KEY) { console.error('[Server] FATAL: OPERATOR_PRIVATE_KEY not set in secrets'); process.exit(1); }

const PASSPORT_URL = "https://api.scorer.gitcoin.co";
const PASSPORT_API = process.env.GITCOIN_PASSPORT_API;
const SCORER_ID    = process.env.GITCOIN_SCORER_ID;

// ─── CHAIN SETUP ─────────────────────────────────────────────────────────────
const provider   = new ethers.JsonRpcProvider(RPC_URL);
const operator   = new ethers.Wallet(OPERATOR_KEY, provider);

// Chain id bound into settle/cashout signatures — must match the escrow's
// block.chainid or the contract's ecrecover check fails. Seeded from env for
// immediate correctness, then reconciled against the live RPC at boot.
let CHAIN_ID = BigInt(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 0);
let chainIdResolved = CHAIN_ID !== 0n;
provider.getNetwork()
  .then(n => {
    const live = BigInt(n.chainId);
    if (CHAIN_ID && live !== CHAIN_ID) {
      console.warn(`[Server] ⚠️  CHAIN_ID env (${CHAIN_ID}) != RPC chain (${live}); using RPC chain for signing.`);
    }
    CHAIN_ID = live;
    chainIdResolved = true;
  })
  .catch(e => console.error('[Server] getNetwork for CHAIN_ID failed:', e.message));

// Never sign with an unknown chain id. If the env var is unset AND the boot
// getNetwork() call failed, CHAIN_ID would stay 0 for the life of the process:
// every settle/cashout signature would be bound to chain 0, the contract (which
// hashes the real block.chainid) would reject all of them, and no hand could
// ever settle. Fail loudly at signing time instead of emitting dead signatures.
function assertChainIdReady() {
  if (!chainIdResolved || CHAIN_ID === 0n) {
    throw new Error('CHAIN_ID unresolved — refusing to sign. Set CHAIN_ID/NEXT_PUBLIC_CHAIN_ID or fix the RPC.');
  }
}

// ─── OPERATOR GAS WATCHDOG ───────────────────────────────────────────────────
// The operator wallet pays gas for markHuman / settle-adjacent txs. When it runs
// dry every verification fails silently from the player's point of view — this
// happened in production and went unnoticed for weeks. Check at boot and on an
// interval, complain loudly, and expose the state via /health.
const MIN_OPERATOR_ETH = ethers.parseEther(process.env.MIN_OPERATOR_ETH || '0.005');
const health = {
  startedAt: Date.now(),
  operator: { address: operator.address, balanceEth: null, lowGas: null, checkedAt: null },
  rpc: { ok: null, blockNumber: null, checkedAt: null },
  lastMarkHuman: null, // { ok, address?, error?, at }
};

async function checkOperatorGas() {
  try {
    const [bal, block] = await Promise.all([
      provider.getBalance(operator.address),
      provider.getBlockNumber(),
    ]);
    health.rpc = { ok: true, blockNumber: block, checkedAt: Date.now() };
    health.operator.balanceEth = ethers.formatEther(bal);
    health.operator.lowGas = bal < MIN_OPERATOR_ETH;
    health.operator.checkedAt = Date.now();
    if (health.operator.lowGas) {
      console.error(`[Server] ⚠️  OPERATOR WALLET LOW ON GAS: ${operator.address} has ` +
        `${health.operator.balanceEth} ETH (< ${ethers.formatEther(MIN_OPERATOR_ETH)}). ` +
        `Verifications and on-chain writes WILL FAIL. Fund it: npm run faucet -- ${operator.address}`);
    }
  } catch (e) {
    health.rpc = { ok: false, blockNumber: null, checkedAt: Date.now() };
    console.error('[Server] gas watchdog RPC check failed:', e.message);
  }
}
checkOperatorGas();
setInterval(checkOperatorGas, Number(process.env.GAS_CHECK_INTERVAL_MS) || 10 * 60 * 1000);

// SECURITY: these flags disable on-chain buy-in verification and must be OFF on
// mainnet. Warn loudly at boot so a testnet config can't silently ship to prod.
if (process.env.TESTNET_SKIP_CHAIN_VERIFY === 'true' || process.env.TESTNET_SKIP_HUMAN_CHECK === 'true') {
  console.warn('[Server] ⚠️  TESTNET bypass flags are ON (TESTNET_SKIP_CHAIN_VERIFY / ' +
    'TESTNET_SKIP_HUMAN_CHECK). On-chain deposits are NOT verified. NEVER run this on mainnet.');
}
if (process.env.ENABLE_WS_BOTS === 'true') {
  console.warn('[Server] ⚠️  ENABLE_WS_BOTS is ON — bots can be seated on real-money tables. Disable for mainnet.');
}

// ─── IN-PROCESS BOT ──────────────────────────────────────────────────────────
const BOT_KEY  = process.env.OPS_WALLET_KEY;
const BOT_ADDR = BOT_KEY ? new ethers.Wallet(BOT_KEY).address.toLowerCase() : null;

const ESCROW_ABI = [
  "function settle(uint256,uint256,address[],uint256[],bytes) external",
  "function getTableInfo(uint256 id) external view returns (uint256 tableId, uint256 buyInAmount, uint256 bigBlind, uint8 maxPlayers, uint8 gameType, uint8 status, uint256 potTotal, uint256 handNonce, uint8 playerCount)",
  "function getPlayerDeposit(uint256 tableId, address player) external view returns (uint256)",
  "function cashOutNonce(uint256,address) external view returns (uint256)",
  "function cashOut(uint256 tableId, address player, uint256 amount, uint256 nonce, bytes sig) external",
  "function markHuman(address,bool) external",
  "function closeTable(uint256) external",
];
const escrow = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, operator);

// Every tx signed by the operator wallet goes through this one queue. ethers
// assigns the wallet nonce at broadcast time, so two overlapping sends claim the
// same nonce and one is dropped by the node. Sponsored cashouts, markHuman,
// closeTable and HandHistory batches all share the wallet, so they share the
// queue — a send that skipped it would collide with the ones that don't.
const queueOperatorTx = createOperatorQueue();

// Cashout messages owed to a player whose socket is closed, keyed by
// "<tableId>:<addrLower>" so they OUTLIVE the table. The last player to leave a
// non-permanent table triggers both the cashout and the table's deletion, so a
// stash living on the table itself would be thrown away moments after it was
// written — and the background receipt handlers (revert / timeout fallback) can
// fire long after the table is gone. Delivered on the player's next AUTH or
// JOIN_TABLE.
const pendingCashouts = new Map(); // key -> { msg, at }
const CASHOUT_STASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cashoutKey = (tableId, addr) => `${tableId}:${String(addr).toLowerCase()}`;

function stashCashout(tableId, addr, msg) {
  const now = Date.now();
  for (const [k, v] of pendingCashouts)
    if (now - v.at > CASHOUT_STASH_TTL_MS) pendingCashouts.delete(k);
  pendingCashouts.set(cashoutKey(tableId, addr), { msg, at: now });
}

// Send every cashout owed to this address (across tables) and clear them.
function flushPendingCashouts(addr, ws) {
  const suffix = `:${String(addr).toLowerCase()}`;
  for (const [k, v] of pendingCashouts) {
    if (!k.endsWith(suffix)) continue;
    send(ws, v.msg);
    pendingCashouts.delete(k);
  }
}

// ─── STAKING (freeroll tier gate) ────────────────────────────────────────────
const STAKING_ADDR = resolveAddr('STAKING', _depl?.contracts?.ChipsStaking,
  process.env.NEXT_PUBLIC_STAKING);
const stakingContract = STAKING_ADDR
  ? new ethers.Contract(STAKING_ADDR, ["function getTier(address) view returns (uint8)"], provider)
  : null;

// Tier lookups are cached briefly so seating a freeroll doesn't hammer the RPC.
const tierCache = new Map(); // addrLower -> { tier, at }
const TIER_CACHE_MS = 5 * 60 * 1000;
async function getStakeTier(addr) {
  if (!stakingContract) return 0;
  const key = addr.toLowerCase();
  const hit = tierCache.get(key);
  if (hit && Date.now() - hit.at < TIER_CACHE_MS) return hit.tier;
  try {
    const tier = Number(await stakingContract.getTier(addr));
    tierCache.set(key, { tier, at: Date.now() });
    return tier;
  } catch (e) {
    console.error('[Server] getTier failed:', e.message);
    // Fail closed for freeroll gating: unknown tier counts as 0.
    return hit ? hit.tier : 0;
  }
}

// ─── HAND HISTORY (batched on-chain gameplay stats) ─────────────────────────
const HAND_HISTORY_ADDR = resolveAddr('HAND_HISTORY', _depl?.contracts?.HandHistory,
  process.env.NEXT_PUBLIC_HAND_HISTORY);
const HAND_HISTORY_FLUSH_MS = Number(process.env.HAND_HISTORY_FLUSH_MS) || 15 * 60 * 1000; // default 15 min
const HAND_HISTORY_ABI = [
  "function recordBatch(address[],uint256[],uint256[],uint256[]) external",
];
const handHistory = HAND_HISTORY_ADDR
  ? new ethers.Contract(HAND_HISTORY_ADDR, HAND_HISTORY_ABI, operator)
  : null;

// addr -> { handsPlayed, handsWon, winnings (bigint, SALOON wei) }
const pendingHandStats = new Map();

function recordHandStatsLocally(participantAddrs, winnerAddrs, winningsByAddr) {
  for (const addr of participantAddrs) {
    const key = addr.toLowerCase();
    const entry = pendingHandStats.get(key) || { handsPlayed: 0, handsWon: 0, winnings: 0n };
    entry.handsPlayed += 1;
    if (winnerAddrs.includes(addr)) entry.handsWon += 1;
    const won = winningsByAddr.get(addr);
    if (won) entry.winnings += won;
    pendingHandStats.set(key, entry);
  }
}

async function flushHandHistory() {
  if (!handHistory || pendingHandStats.size === 0) return;
  const batch = new Map(pendingHandStats);
  pendingHandStats.clear();
  try {
    const players          = [...batch.keys()];
    const handsPlayedDelta = players.map(a => BigInt(batch.get(a).handsPlayed));
    const handsWonDelta    = players.map(a => BigInt(batch.get(a).handsWon));
    const winningsDelta    = players.map(a => batch.get(a).winnings);
    const tx = await queueOperatorTx(() =>
      handHistory.recordBatch(players, handsPlayedDelta, handsWonDelta, winningsDelta));
    await tx.wait();
    console.log(`[Server] HandHistory batch flushed: ${players.length} players`);
  } catch (e) {
    // Re-queue this batch's deltas so a transient RPC error doesn't lose stats
    for (const [addr, delta] of batch) {
      const entry = pendingHandStats.get(addr) || { handsPlayed: 0, handsWon: 0, winnings: 0n };
      entry.handsPlayed += delta.handsPlayed;
      entry.handsWon    += delta.handsWon;
      entry.winnings    += delta.winnings;
      pendingHandStats.set(addr, entry);
    }
    console.error('[Server] flushHandHistory error:', e.message);
  }
}

if (handHistory) {
  setInterval(flushHandHistory, HAND_HISTORY_FLUSH_MS);
  console.log(`[Server] HandHistory batching enabled — flush every ${HAND_HISTORY_FLUSH_MS / 1000}s`);
} else {
  console.log('[Server] HandHistory not deployed — gameplay stats will not be recorded on-chain');
}

// ─── CARD ENGINE ─────────────────────────────────────────────────────────────
const SUITS = ["S","H","D","C"];
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const RV    = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));

function makeDeck() {
  return SUITS.flatMap(s => RANKS.map(r => `${r}${s}`));
}
function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─── HAND EVALUATOR ──────────────────────────────────────────────────────────
function evalFive(cs) {
  const v = cs.map(c => RV[c[0] === 'T' ? 'T' : c[0]]).sort((a,b)=>b-a);
  const ss = cs.map(c => c.slice(-1));
  const flush = ss.every(x => x === ss[0]);
  const uniq = [...new Set(v)];
  const cnts = uniq.map(x=>({x,n:v.filter(y=>y===x).length})).sort((a,b)=>b.n-a.n||b.x-a.x);
  const str   = uniq.length===5 && v[0]-v[4]===4;
  const wheel = uniq.length===5 && v[0]===14 && v[1]===5;
  // kickers: tiebreak values ordered by group size desc, then rank desc
  const kickers = cnts.map(c => c.x);
  if (flush && str && v[0]===14) return {r:9,n:"Royal Flush",        kickers:[14]};
  if (flush && (str||wheel))    return {r:8,n:"Straight Flush",      kickers:wheel?[5]:[v[0]]};
  if (cnts[0].n===4)            return {r:7,n:"Four of a Kind",      kickers};
  if (cnts[0].n===3&&cnts[1]?.n===2) return {r:6,n:"Full House",    kickers};
  if (flush)                    return {r:5,n:"Flush",               kickers:v};
  if (str||wheel)               return {r:4,n:"Straight",            kickers:wheel?[5]:[v[0]]};
  if (cnts[0].n===3)            return {r:3,n:"Three of a Kind",     kickers};
  if (cnts[0].n===2&&cnts[1]?.n===2) return {r:2,n:"Two Pair",      kickers};
  if (cnts[0].n===2)            return {r:1,n:"One Pair",            kickers};
  return {r:0,n:"High Card",kickers:v};
}
// Compare two evaluated hands: >0 means a wins, 0 means tie, <0 means b wins
function compareHands(a, b) {
  if (a.r !== b.r) return a.r - b.r;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const ak = a.kickers[i] ?? 0, bk = b.kickers[i] ?? 0;
    if (ak !== bk) return ak - bk;
  }
  return 0;
}
function best7(cs) {
  let b = null;
  for (let i=0;i<cs.length-1;i++)
    for (let j=i+1;j<cs.length;j++) {
      const e = evalFive(cs.filter((_,k)=>k!==i&&k!==j));
      if (!b || compareHands(e,b) > 0) b = e;
    }
  return b || evalFive(cs);
}
function bestOmaha(hole, comm) {
  let best = null;
  const holePairs = [];
  for (let i=0;i<hole.length-1;i++)
    for (let j=i+1;j<hole.length;j++) holePairs.push([hole[i],hole[j]]);
  const commTrips = [];
  for (let i=0;i<comm.length-2;i++)
    for (let j=i+1;j<comm.length-1;j++)
      for (let k=j+1;k<comm.length;k++) commTrips.push([comm[i],comm[j],comm[k]]);
  for (const hp of holePairs)
    for (const ct of commTrips) {
      const e = evalFive([...hp,...ct]);
      if (!best || compareHands(e,best) > 0) best = e;
    }
  return best;
}

// ─── ANTI-BOT VERIFICATION ───────────────────────────────────────────────────
// Real verification delegates to antiBotOracle.js's fullVerify() (2-of-3 checks).
// Testnet bypass marks human directly without touching the external APIs.
async function verifyHuman(address) {
  if (process.env.TESTNET_SKIP_HUMAN_CHECK === 'true') {
    try {
      const tx = await queueOperatorTx(() => escrow.markHuman(address, true));
      await tx.wait();
      console.log(`[AntiBot] Testnet bypass: marked ${address} as human`);
      health.lastMarkHuman = { ok: true, address, at: Date.now() };
      return { pass: true, failures: [] };
    } catch (e) {
      console.error("markHuman (testnet bypass) error:", e.message);
      health.lastMarkHuman = { ok: false, address, error: e.shortMessage || e.message, at: Date.now() };
      return { pass: false, failures: [e.message] };
    }
  }
  return fullVerify(address);
}

// Bot-timing detector — flags suspiciously fast/consistent action timing.
// Separate process from server/antiBotOracle.js's own instance (see CLAUDE.md),
// so a fresh BehaviorMonitor is created here for the live game server.
const behaviorMonitor = new BehaviorMonitor();

// AFK guard: a player who doesn't act within this window is auto-checked
// (if free) or auto-folded, so one stalled player can't hold up the table.
const ACTION_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS) || 30_000;
// One manual "+30 secs" extension allowed per turn, requested via EXTEND_TURN.
const TURN_EXTENSION_MS = Number(process.env.TURN_EXTENSION_MS) || 30_000;

// ─── GAME STATE MACHINE ───────────────────────────────────────────────────────
class PokerTable {
  constructor(id, config) {
    this.id           = id;
    this.config       = config; // { buyIn, bigBlind, maxPlayers, gameType }
    this.players      = [];     // { addr, ws, chips, onChainDeposit, hand, bet, folded, allIn, actionLabel, cashoutLockedUntil }
    this.deck         = [];
    this.community    = [];
    this.pot          = 0;
    this.maxBet       = 0;
    this.lastRaiseAmount = 0;
    this.phase        = 'waiting';
    this.dealerIdx    = 0;
    this.actionIdx    = 0;
    this.handNonce    = 0;
    this.sideLog      = [];
    this.bustedSeats     = new Map(); // addr => { seatIndex, ws }
    this.creator      = null;   // first player to sit
    this.isActive     = false;  // mirrors on-chain TableStatus.Active
  }

  seat(player, preferredSeat) {
    if (this.players.length >= this.config.maxPlayers) return false;
    // Case-insensitive de-dupe: defense in depth behind the AUTH normalization,
    // so one wallet can never occupy two seats via address casing.
    if (this.players.find(p => String(p.addr).toLowerCase() === String(player.addr).toLowerCase())) return false;
    if (this.players.length === 0) this.creator = player.addr;
    const chips = player.onChainDeposit ?? this.config.buyIn;
    // Seat position. A player who asked for a specific seat gets that seat or
    // nothing: quietly dropping them somewhere else is worse than telling them
    // it was taken, because they chose it for a reason (position relative to
    // the players they want to sit behind).
    const picked = chooseSeat({
      taken: this.players.map(p => p.seatIndex),
      maxPlayers: this.config.maxPlayers,
      preferredSeat,
    });
    if (!picked.ok) return false;
    const seatIndex = picked.seatIndex;
    this.players.push({
      ...player,
      chips,
      onChainDeposit: chips,
      hand: [], bet: 0, committed: 0, folded: false, allIn: false, actionLabel: '',
      cashoutLockedUntil: 0,
      seatIndex,
    });
    return true;
  }

  start() {
    if (this.players.length < 2) return;
    this.dealerIdx       = this.dealerIdx % this.players.length;
    this.deck            = shuffle(makeDeck());
    this.community       = [];
    this.pot             = 0;
    this.lastRaiseAmount = 0;
    this.phase           = 'preflop';
    this.streetActed     = new Set(); // tracks who has acted this betting round
    // A hand only shows cards if two or more players were still in it at the
    // end. Folding everyone out wins the pot without showing anything.
    this.wentToShowdown  = false;
    this.showdownSeats   = new Set();
    const n         = this.players.length;
    const holeCount = this.config.gameType === 1 ? 4 : 2;

    this.players.forEach(p => {
      p.hand = []; p.bet = 0; p.committed = 0; p.folded = false; p.allIn = false; p.actionLabel = ''; p.leaving = false;
      p.revealed = false;   // only set when a player chooses to show
      for (let j = 0; j < holeCount; j++) p.hand.push(this.deck.shift());
    });

    // Heads-up (2-player): dealer IS the small blind and acts first preflop
    const sbIdx = n === 2 ? this.dealerIdx : (this.dealerIdx + 1) % n;
    const bbIdx = n === 2 ? (this.dealerIdx + 1) % n : (this.dealerIdx + 2) % n;
    // A player left with less than a blind is still dealt in — they are only
    // removed once they hit zero. Posting the full blind regardless drove their
    // stack negative, and a negative stack then flows straight into the pot
    // (`pay = Math.min(due, p.chips)`), shrinking it and destroying chips. Post
    // at most what they have, and mark them all-in for it.
    const postBlind = (p, blind) => {
      const pay = Math.min(blind, p.chips);
      p.chips     -= pay;
      p.bet        = pay;
      p.committed += pay;
      if (p.chips === 0) p.allIn = true;
      return pay;
    };
    const sbPaid = postBlind(this.players[sbIdx], this.config.bigBlind / 2);
    const bbPaid = postBlind(this.players[bbIdx], this.config.bigBlind);
    this.pot    = sbPaid + bbPaid;
    this.maxBet = Math.max(sbPaid, bbPaid);
    // Preflop: in HU the SB/dealer acts first; multi-way starts left of BB
    this.actionIdx = n === 2 ? sbIdx : (bbIdx + 1) % n;
    this.turnStartedAt = Date.now();
    this.turnExtraMs = 0;
    this.turnExtended = false;

    const handHash = crypto.createHash('sha256')
      .update(JSON.stringify({ id: String(this.id), nonce: this.handNonce, deck: this.deck.slice(0,5).join(','), ts: Date.now() }))
      .digest('hex');
    this.sideLog.push({ event: 'hand_start', handHash, nonce: this.handNonce });
  }

  _nextActionIdx() {
    const n = this.players.length;
    let next = (this.actionIdx + 1) % n;
    let iters = 0;
    while ((this.players[next].folded || this.players[next].allIn) && iters < n) {
      next = (next + 1) % n;
      iters++;
    }
    this.actionIdx = next;
    this.turnStartedAt = Date.now();
    this.turnExtraMs = 0;
    this.turnExtended = false;
  }

  _resetActionIdxForStreet() {
    const n = this.players.length;
    let next = (this.dealerIdx + 1) % n;
    let iters = 0;
    while ((this.players[next].folded || this.players[next].allIn) && iters < n) {
      next = (next + 1) % n;
      iters++;
    }
    this.actionIdx = next;
    this.turnStartedAt = Date.now();
    this.turnExtraMs = 0;
    this.turnExtended = false;
  }

  // Fold a player without advancing action (used when removing a player mid-hand)
  foldPlayer(addr) {
    const p = this.players.find(x => x.addr === addr);
    if (p) { p.folded = true; p.actionLabel = 'FOLD'; }
  }

  applyAction(addr, action, amount = 0) {
    const idx = this.players.findIndex(x => x.addr === addr);
    if (idx < 0 || idx !== this.actionIdx) return { error: 'Not your turn' };
    const p = this.players[idx];
    if (p.folded || this.phase === 'showdown') return { error: 'Action not allowed' };

    const VALID_ACTIONS = ['fold','check','call','raise','allin'];
    if (!VALID_ACTIONS.includes(action)) return { error: 'Invalid action' };

    const due = Math.max(0, this.maxBet - p.bet);

    if (action === 'fold') {
      p.folded = true; p.actionLabel = 'FOLD';
    } else if (action === 'check') {
      if (due > 0) return { error: 'Must call or raise' };
      p.actionLabel = 'CHECK';
    } else if (action === 'call') {
      const pay = Math.min(due, p.chips);
      p.chips -= pay; p.bet += pay; p.committed += pay; this.pot += pay;
      if (p.chips === 0) p.allIn = true;
      p.actionLabel = `CALL ${pay}`;
    } else if (action === 'raise') {
      const minRaise = Math.max(this.config.bigBlind, this.lastRaiseAmount || this.config.bigBlind);
      if (amount < minRaise) return { error: `Minimum raise is ${minRaise}` };
      const prevMax = this.maxBet;
      const total = this.maxBet + amount;
      const pay   = Math.min(total - p.bet, p.chips);
      p.chips -= pay; p.bet += pay; p.committed += pay; this.pot += pay;
      // `pay` is capped by the stack, so a player who cannot cover the current
      // bet ends up below it. Assigning maxBet = p.bet unconditionally then
      // moved the bar DOWN: later players owed the smaller amount, and whoever
      // had already bet more could never satisfy `bet === maxBet`, so the street
      // never completed and the whole table sat until everyone timed out.
      this.maxBet = Math.max(prevMax, p.bet);
      // Record the raise that actually happened, not the one that was asked
      // for: an unbounded `amount` became the next minimum raise and locked
      // everyone out of raising for the rest of the street.
      this.lastRaiseAmount = Math.max(0, this.maxBet - prevMax);
      if (p.chips === 0) p.allIn = true;
      p.actionLabel = p.bet < this.maxBet ? `ALL IN ${p.bet}` : `RAISE +${this.lastRaiseAmount}`;
      // After a raise, prior actors must respond again — clear the acted set
      this.streetActed = new Set();
    } else if (action === 'allin') {
      const pay = p.chips;
      p.chips = 0; p.bet += pay; p.committed += pay; this.pot += pay;
      this.maxBet = Math.max(this.maxBet, p.bet);
      p.allIn = true; p.actionLabel = 'ALL IN';
      // All-in acts as an implicit raise if it exceeds current maxBet — clear acted set
      this.streetActed = new Set();
    }
    this.streetActed.add(addr);

    this._nextActionIdx();
    return this.advance();
  }

  advance() {
    const alive     = this.players.filter(p => !p.folded);
    const allBetsEq = alive.every(p => p.bet === this.maxBet || p.allIn);
    // All non-folded, non-allin players must have acted this street
    const allActed  = alive.every(p => p.allIn || this.streetActed.has(p.addr));

    if (alive.length === 1) return this.doShowdown(alive);
    if (!allBetsEq || !allActed) return null;

    this.players.forEach(p => { p.bet = 0; p.actionLabel = ''; });
    this.maxBet = 0;
    this.lastRaiseAmount = 0;
    this.streetActed = new Set();

    if (this.phase === 'preflop') {
      this.community = [this.deck.shift(), this.deck.shift(), this.deck.shift()];
      this.phase = 'flop';
    } else if (this.phase === 'flop') {
      this.community.push(this.deck.shift());
      this.phase = 'turn';
    } else if (this.phase === 'turn') {
      this.community.push(this.deck.shift());
      this.phase = 'river';
    } else if (this.phase === 'river') {
      return this.doShowdown(alive);
    }

    this._resetActionIdxForStreet();
    // If all alive players are all-in, no betting needed — run out the board
    if (alive.every(p => p.allIn)) return this.advance();
    return null;
  }

  doShowdown(alive) {
    this.phase = 'showdown';
    // Cards go face up only when the pot was actually contested to the end.
    // With one player left everyone else folded, so there is nothing to beat
    // and no obligation to show — see pubState and the SHOW_CARDS handler.
    this.wentToShowdown = alive.length > 1;
    this.showdownSeats  = new Set(alive.map(p => p.addr));

    // Rank the surviving hands, best first, with ties grouped. One player left
    // needs no evaluation, but it still goes through the pot split below: their
    // opponent may have folded after betting more than they could call, and that
    // uncalled remainder belongs back to whoever bet it.
    const results = alive.length === 1
      ? [{ p: alive[0], h: { r: -1, n: 'Uncontested', kickers: [] } }]
      : alive.map(p => ({
          p,
          h: this.config.gameType === 1
            ? bestOmaha(p.hand, this.community)
            : best7([...p.hand, ...this.community]),
        })).sort((a, b) => compareHands(b.h, a.h));

    const rankedGroups = [];
    for (const r of results) {
      const last = rankedGroups[rankedGroups.length - 1];
      if (last && compareHands(results.find(x => x.p.addr === last[0]).h, r.h) === 0) last.push(r.p.addr);
      else rankedGroups.push([r.p.addr]);
    }

    // Every chip in the pot must be attributable to somebody's commitment,
    // otherwise the split below cannot be right. This catches any future path
    // that adds to `pot` without recording it on the player — the failure mode
    // it replaces is a silently mis-sized settlement that the operator signs.
    const committed = this.players.reduce((a, p) => a + (p.committed || 0), 0);
    if (committed !== this.pot) {
      console.error(`[Server] table ${this.id} hand ${this.handNonce}: pot accounting mismatch — ` +
        `pot=${this.pot} committed=${committed}. Settling against committed totals.`);
      this.pot = committed;
    }

    // Split by all-in level rather than handing the whole pot to the best hand:
    // a short stack can only win what each opponent also put in. See
    // server/sidePots.js.
    const pots = buildSidePots(this.players);
    const { won, refunds } = awardPots(pots, rankedGroups);

    // Uncalled money goes back to its owner before anything is settled, exactly
    // as a card room returns an uncalled bet before raking the pot. Those chips
    // stay backed by the same escrow deposit they came from, so they leave
    // `pot` — settling them would rake a pot nobody contested, charging the
    // player a slice of their own returned bet.
    for (const [addr, amount] of refunds) {
      const p = this.players.find(x => x.addr === addr);
      if (p) p.chips += amount;
      this.pot -= amount;
    }
    for (const [addr, amount] of won) {
      const p = this.players.find(x => x.addr === addr);
      if (p) p.chips += amount;
    }
    const payouts = won;

    // `winners` is what the hand's showdown decided — the top group that could
    // actually win something. A player collecting only an uncalled bet back is
    // in `payouts`, not here.
    const topGroup = rankedGroups[0] || [];
    const winners  = topGroup.filter(a => (payouts.get(a) || 0) > 0);

    return {
      winners: winners.length ? winners : [...payouts.keys()],
      results, pot: this.pot, payouts, refunds, pots,
    };
  }

  /** Whether `p`'s hole cards are visible to `forAddr`. See server/reveal.js. */
  canReveal(p, forAddr) {
    return canRevealHand({
      player: p, forAddr,
      phase: this.phase,
      wentToShowdown: this.wentToShowdown,
      showdownSeats: this.showdownSeats,
    });
  }

  /**
   * A player elects to show their cards. Only meaningful for a hand that was
   * not contested to the end — the point of it is the winner choosing to show
   * a bluff — and only while that hand is still on screen.
   */
  showCards(addr) {
    const p = this.players.find(x => x.addr === addr);
    const allowed = canElectToShow({ player: p, phase: this.phase });
    if (!allowed.ok) return { error: allowed.error };
    p.revealed = true;   // idempotent
    return { ok: true };
  }

  async signAndSettle(winners, shares, potAmount) {
    // Digest must match PokerEscrow.settle: chainId + escrow address bind the sig
    // to this chain/contract (blocks cross-chain / cross-deployment replay), and
    // potAmount binds it to THIS hand's pot so the signature can't be used to
    // sweep the table's entire escrow.
    assertChainIdReady();
    const digest = ethers.solidityPackedKeccak256(
      ['uint256','address','uint256','uint256','uint256','address[]','uint256[]'],
      // Floor the pot: chain-loaded tables carry wei-scale amounts as JS Numbers,
      // so pot arithmetic is floating point. BigInt() THROWS on a fractional
      // value, and rounding up could push potAmount past the contract's
      // `potAmount <= potTotal` check and revert the settlement.
      [CHAIN_ID, ESCROW_ADDR, BigInt(this.id), BigInt(this.handNonce), BigInt(Math.floor(potAmount)), winners, shares.map(BigInt)]
    );
    return operator.signMessage(ethers.getBytes(digest));
  }

  async signCashOut(player, amount, nonce) {
    // Must match PokerEscrow.cashOut's chainId + address-bound digest.
    assertChainIdReady();
    const digest = ethers.solidityPackedKeccak256(
      ['string','uint256','address','uint256','address','uint256','uint256'],
      ['CASHOUT', CHAIN_ID, ESCROW_ADDR, BigInt(this.id), player, BigInt(amount), BigInt(nonce)]
    );
    return operator.signMessage(ethers.getBytes(digest));
  }

  pubState(forAddr) {
    const activePlayer = this.phase !== 'waiting' && this.phase !== 'showdown'
      ? this.players[this.actionIdx]
      : null;
    return {
      tableId:         String(this.id),
      phase:           this.phase,
      pot:             this.pot,
      maxBet:          this.maxBet,
      lastRaiseAmount: this.lastRaiseAmount,
      community:       this.community,
      activeAddr:      activePlayer?.addr || null,
      turnStartedAt:   activePlayer ? this.turnStartedAt ?? null : null,
      turnTimeoutMs:   ACTION_TIMEOUT_MS + (this.turnExtraMs || 0),
      turnExtended:    !!this.turnExtended,
      dealerAddr:      this.players[this.dealerIdx]?.addr || null,
      config:          this.config,
      creator:         this.creator ?? null,
      handNonce:       this.handNonce,
      anyLocked:  this.players.some(p => (p.cashoutLockedUntil ?? 0) > this.handNonce),
      players: this.players.map(p => ({
        addr:               p.addr,
        chips:              p.chips,
        bet:                p.bet,
        folded:             p.folded,
        allIn:              p.allIn,
        actionLabel:        p.actionLabel,
        cashoutLockedUntil: p.cashoutLockedUntil ?? 0,
        seatIndex:          p.seatIndex ?? null,
        // You always see your own cards. Everyone else's are face down unless
        // this hand was contested to the end and they were still in it, or they
        // chose to show. Revealing on `phase === 'showdown'` alone exposed the
        // winner of a hand nobody called, and exposed folded players' cards too.
        hand: this.canReveal(p, forAddr) ? p.hand : p.hand.map(() => '??'),
        revealed: !!p.revealed,
        isBot:    !!p.isBot,
      })),
    };
  }
}

// ─── WALLET SIGNATURE VERIFICATION ────────────────────────────────────────────
// EIP-1271 magic value a smart-contract account returns for a valid signature.
const ERC1271_MAGIC = '0x1626ba7e';
const ERC1271_ABI   = ['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)'];

const shortAddr = a => (a && a.length >= 10) ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a);

// Verify a personal_sign signature across the wallet behaviors seen in the wild,
// not just the textbook one:
//   1. standard EOA recovery of the plain message
//   2. wallets that sign the hex-encoded form of the message as literal text
//   3. ERC-1271 smart-contract accounts, checked on-chain
// Returns { ok, recovered } — when !ok, `recovered` is the address standard
// recovery produced (or null), so callers can tell the player exactly which
// account actually signed instead of a bare "Bad signature".
async function verifyWalletSignature(message, signature, address) {
  const want = String(address).toLowerCase();
  let recovered = null;
  try {
    recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() === want) return { ok: true, recovered };
  } catch {}
  try {
    const hexForm = ethers.verifyMessage(ethers.hexlify(ethers.toUtf8Bytes(message)), signature);
    if (hexForm.toLowerCase() === want) return { ok: true, recovered: hexForm };
  } catch {}
  try {
    const account = new ethers.Contract(address, ERC1271_ABI, provider);
    if (await account.isValidSignature(ethers.hashMessage(message), signature) === ERC1271_MAGIC) {
      return { ok: true, recovered: want };
    }
  } catch {}
  return { ok: false, recovered };
}

// Human-readable reason for a failed verification, specific enough to act on.
function sigFailureMessage(check, address) {
  if (check.recovered && check.recovered.toLowerCase() !== String(address).toLowerCase()) {
    return `Signature came from account ${shortAddr(check.recovered)}, but you're connected as ${shortAddr(address)}. ` +
      `Open your wallet, switch to the account you connected with (or disconnect and reconnect with the one you want), then try again.`;
  }
  return 'Bad signature — your wallet returned a signature that could not be verified. Try again, or reconnect your wallet.';
}

// ─── SESSION PASS ─────────────────────────────────────────────────────────────
// After a successful wallet-signature AUTH, the server issues an HMAC-signed
// session token so each device signs ONCE and then reconnects silently for
// SESSION_TTL_DAYS (default 30). Stateless: the secret is derived from the
// operator key, so tokens survive server restarts and need no storage, and
// rotating the operator key invalidates every outstanding token at once.
// A token only authenticates the game WebSocket — anything that moves funds
// still requires an on-chain transaction signed by the wallet itself.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) ||
  (Number(process.env.SESSION_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;
const SESSION_SECRET = ethers.keccak256(ethers.toUtf8Bytes(`${OPERATOR_KEY}:pvp-session-v1`));

function issueSessionToken(address) {
  const payload = Buffer.from(JSON.stringify({
    a: String(address).toLowerCase(),
    exp: Date.now() + SESSION_TTL_MS,
  })).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return { token: `${payload}.${mac}`, expiresAt: Date.now() + SESSION_TTL_MS };
}

function verifySessionToken(token, address) {
  try {
    const [payload, mac] = String(token).split('.');
    if (!payload || !mac) return { ok: false, reason: 'malformed' };
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const a = Buffer.from(mac), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-mac' };
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.a !== String(address).toLowerCase()) return { ok: false, reason: 'address-mismatch' };
    if (typeof data.exp !== 'number' || Date.now() >= data.exp) return { ok: false, reason: 'expired' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const tables  = new Map();
const clients = new Map(); // ws => { addr, tableId }

// Pre-seeded permanent tables — always available, reset (not deleted) when empty
// Seeded tables live only in server memory. PokerEscrow allocates table ids from
// `++tableCount` (starting at 1), so ids in the 9000s have NO on-chain
// counterpart: getPlayerDeposit() returns 0 for them and no cashout can ever
// settle. A table therefore cannot be both "seeded" and "real money" — that
// state is incoherent, and previously left these two tables either unplayable
// (endless SEAT_PICKER) or, before the deposit-verification fix, backed by
// client-supplied stacks. They are play money until they are given a real
// on-chain table id (see `onChainId` below).
const SEED_TABLES = [
  { id: 9001n, name: 'Micro — NLH 9-Max (Play Money)',      buyIn: 1000, minBuyIn: 1000, maxBuyIn: 10000, bigBlind: 20, maxPlayers: 9, gameType: 0, playMoney: true },
  { id: 9002n, name: 'High Stakes — NLH 9-Max (Play Money)', buyIn: 5000, minBuyIn: 5000, maxBuyIn: 50000, bigBlind: 50, maxPlayers: 9, gameType: 0, playMoney: true },
  // Staker freeroll: free fixed stacks, seating gated to staking tier >= 1.
  // Chips here are play money — never cashable (see signAndRemovePlayer);
  // prizes are paid separately from the PromotionsPool.
  { id: 9100n, name: 'Staker Freeroll — Bronze+', buyIn: 10000, minBuyIn: 10000, maxBuyIn: 10000, bigBlind: 100, maxPlayers: 9, gameType: 0, isFreeroll: true },
];
for (const { id, name, isFreeroll, playMoney, ...config } of SEED_TABLES) {
  const t = new PokerTable(id, config);
  t.name = name;
  t.isPermanent = true;
  t.isFreeroll = !!isFreeroll;
  // Chips are play money unless the table is backed by real on-chain deposits.
  // A freeroll is one kind of play money; the seeded cash tables are another.
  t.playMoney = !!playMoney || !!isFreeroll;
  if (!t.playMoney) {
    // Guard the incoherent state rather than silently shipping a table whose
    // chips look real but have nothing behind them.
    throw new Error(`Seeded table ${id} is marked real-money but has no on-chain table id.`);
  }
  tables.set(String(id), t);
}
console.log(`[Server] Seeded ${SEED_TABLES.length} permanent tables`);

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  // Public lobby/name data is open CORS; everything else is restricted to the frontend origin.
  // /claim-username is also open — its actual security is the wallet-signature check
  // below, not the origin, and it needs to work from every Vercel preview URL, not just
  // one hardcoded production domain.
  if (req.url === '/tables' || req.url?.startsWith('/usernames') || req.url === '/claim-username' || req.url === '/health') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '');
  }
  if (req.method === 'OPTIONS') {
    // Preflight for the JSON POST below — browsers require this before /claim-username.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/health') {
    // Always HTTP 200 — Fly's health check restarts "unhealthy" machines, and a
    // degraded chain state (low gas, RPC blip) must not cause a restart loop.
    // Consumers read `status` / the detail fields instead.
    const degraded = [];
    if (health.rpc.ok === false)        degraded.push('rpc-unreachable');
    if (health.operator.lowGas)         degraded.push('operator-low-gas');
    if (health.lastMarkHuman && !health.lastMarkHuman.ok) degraded.push('last-markhuman-failed');
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: degraded.length ? 'degraded' : 'ok',
      degraded,
      uptimeSec: Math.floor((Date.now() - health.startedAt) / 1000),
      escrow: {
        address: ESCROW_ADDR,
        matchesManifest: !_depl?.contracts?.PokerEscrow ||
          ESCROW_ADDR.toLowerCase() === _depl.contracts.PokerEscrow.toLowerCase(),
      },
      operator: { ...health.operator, minEth: ethers.formatEther(MIN_OPERATOR_ETH) },
      rpc: health.rpc,
      lastMarkHuman: health.lastMarkHuman,
      usernameStore: storeStatus(),
      flags: {
        skipHumanCheck: process.env.TESTNET_SKIP_HUMAN_CHECK === 'true',
        skipChainVerify: process.env.TESTNET_SKIP_CHAIN_VERIFY === 'true',
      },
      tables: tables.size,
      connectedClients: clients.size,
    }, null, 2));
  }
  if (req.url === '/tables') {
    const list = [...tables.values()].map(t => ({
      id: String(t.id), name: t.name || null, config: t.config, seated: t.players.length, phase: t.phase, isFreeroll: !!t.isFreeroll, playMoney: !!t.playMoney,
    }));
    res.writeHead(200);
    res.end(JSON.stringify({ tables: list }));
  } else if (req.url?.startsWith('/usernames')) {
    // Free, off-chain display names (see usernameStore.js) — batch address -> username
    // lookup used by the frontend's useHandleMap/useUsername fallback chain.
    const url = new URL(req.url, 'http://x');
    const addrs = (url.searchParams.get('addresses') || '').split(',').map(s => s.trim()).filter(Boolean);
    res.writeHead(200);
    res.end(JSON.stringify({ usernames: getUsernames(addrs) }));
  } else if (req.url === '/claim-username' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { address, signature, username } = JSON.parse(body);
        if (!address || !signature || !username) {
          res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing fields' }));
        }
        const check = await verifyWalletSignature(`PVP-CLAIM-USERNAME:${username}`, signature, address);
        if (!check.ok) {
          console.warn(`[Server] claim-username sig mismatch: sent=${shortAddr(String(address))} recovered=${check.recovered ? shortAddr(check.recovered) : 'n/a'}`);
          res.writeHead(401); return res.end(JSON.stringify({ ok: false, error: sigFailureMessage(check, address) }));
        }
        const result = claimUsername(address, username);
        res.writeHead(result.ok ? 200 : 409);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
      }
    });
  } else if (req.url?.startsWith('/spawn-bot')) {
    const secret = req.headers['x-bot-secret'];
    if (!process.env.BOT_API_SECRET || secret !== process.env.BOT_API_SECRET) {
      res.writeHead(401); return res.end('{"error":"Unauthorized"}');
    }
    const url    = new URL(req.url, 'http://x');
    const tidKey = url.searchParams.get('tableId') || '9001';
    const buyIn  = Number(url.searchParams.get('buyIn') || 1000);
    const count  = Math.max(1, Math.min(8, Number(url.searchParams.get('count') || 1)));
    const t = tables.get(tidKey);
    if (!t) { res.writeHead(404); return res.end('{"error":"table not found"}'); }
    const result = spawnBot(t, buyIn, count);
    if (!result.ok) {
      const code = result.error.includes('configured') ? 503 : 400;
      res.writeHead(code); return res.end(JSON.stringify({ error: result.error }));
    }
    res.end(JSON.stringify({ status: 'ok', addrs: result.addrs, chips: result.chips }));
  } else {
    res.writeHead(200);
    res.end(JSON.stringify({ service: 'Saloon WS', tables: tables.size }));
  }
});

const wss = new WebSocketServer({ server, maxPayload: 65536 });

// Per-IP connection caps, a per-socket message budget, and an AUTH attempt
// budget. Tuned so ordinary play never notices: see server/connectionGuard.js
// for what each limit is actually defending.
const guard = createConnectionGuard();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function send(ws, data) {
  // Null-safe: bots (and busted/disconnected players) have ws === null. Callers
  // like broadcastToTable() pass p.ws unguarded, so without the optional chain a
  // single bot at the table throws here mid-HAND_OVER and aborts handleHandOver
  // before it can schedule the next-hand restart — freezing the table at showdown.
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// Sponsored (gasless) cashout relay. On by default; SPONSOR_CASHOUT=false makes
// players self-submit. Auto-pauses when the operator wallet is low on gas.
const { relayOrSignCashOut } = createCashoutRelay({
  escrow, health, send, queueOperatorTx,
  stashCashout: (t, addr, msg) => stashCashout(t.id, addr, msg),
  isSocketOpen: ws => ws?.readyState === WebSocket.OPEN,
  shortAddr,
  sponsorEnabled: () => process.env.SPONSOR_CASHOUT !== 'false',
});

function broadcastTable(t) {
  t.players.forEach(p => {
    if (p.ws?.readyState === WebSocket.OPEN)
      send(p.ws, { type: 'GAME_STATE', state: t.pubState(p.addr) });
  });
  // Busted players are removed from t.players but still wait on a rebuy —
  // keep their screen updating instead of freezing at the bust moment.
  for (const [addr, info] of t.bustedSeats) {
    if (info.ws?.readyState === WebSocket.OPEN)
      send(info.ws, { type: 'GAME_STATE', state: t.pubState(addr) });
  }
  maybeBotAct(t);
  scheduleActionTimer(t);
}

// AFK guard — (re)arms a single timeout for the current actor. Safe to call after
// every broadcast: it clears any prior timer and recomputes the remaining time from
// turnStartedAt, so repeated calls during the same turn don't reset the countdown.
function scheduleActionTimer(t) {
  if (t.actionTimer) { clearTimeout(t.actionTimer); t.actionTimer = null; }
  if (t.phase === 'waiting' || t.phase === 'showdown') return;
  const active = t.players[t.actionIdx];
  if (!active || active.folded || active.allIn || active.isBot) return;
  const timeout = ACTION_TIMEOUT_MS + (t.turnExtraMs || 0);
  const remaining = Math.max(0, timeout - (Date.now() - (t.turnStartedAt || Date.now())));
  t.actionTimer = setTimeout(() => onActionTimeout(t, active.addr), remaining);
}

async function onActionTimeout(t, addr) {
  const idx = t.players.findIndex(p => p.addr === addr);
  if (idx < 0 || idx !== t.actionIdx) return; // state already moved on
  const p = t.players[idx];
  if (p.folded || p.allIn) return;
  const due    = Math.max(0, t.maxBet - p.bet);
  const action = due === 0 ? 'check' : 'fold';
  console.log(`[Server] Turn timeout — auto-${action} for ${addr.slice(0,10)} at table ${t.id}`);
  const result = t.applyAction(addr, action, 0);
  broadcastTable(t);
  if (result?.winners) await handleHandOver(t, result);
}

function spawnBot(t, buyIn, count = 1) {
  if (!BOT_ADDR) return { ok: false, error: 'OPS_WALLET_KEY not configured' };
  const min = t.config.minBuyIn ?? t.config.buyIn;
  const max = t.config.maxBuyIn ?? t.config.buyIn;
  const chips = Math.max(min, Math.min(max, buyIn || min));
  const seatedAddrs = [];
  for (let i = 0; i < count; i++) {
    const addr = new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(`${BOT_KEY}:${t.id}:${i}`))).address.toLowerCase();
    const seated = t.seat({ addr, ws: null, isBot: true, onChainDeposit: chips }, null);
    if (!seated) break;
    seatedAddrs.push(addr);
  }
  if (seatedAddrs.length === 0) return { ok: false, error: 'could not seat bot' };
  console.log(`[Bot] ${seatedAddrs.length} in-process bot(s) spawned at table ${t.id} with ${chips} chips each`);
  broadcastTable(t);
  maybeAutoStart(t);
  return { ok: true, chips, addrs: seatedAddrs };
}

function maybeBotAct(t) {
  if (t.botActPending) return;
  const active = t.phase !== 'waiting' && t.phase !== 'showdown' ? t.players[t.actionIdx] : null;
  if (!active?.isBot || active.folded) return;
  t.botActPending = true;
  // Human-ish, variable think time (overridable for tests / simulations)
  const delay = Number(process.env.BOT_ACT_DELAY_MS) ||
    (900 + Math.floor(Math.random() * 1400));
  setTimeout(async () => {
    t.botActPending = false;
    // Re-validate: the hand may have moved on while we "thought"
    const still = t.phase !== 'waiting' && t.phase !== 'showdown' ? t.players[t.actionIdx] : null;
    if (!still || still.addr !== active.addr || still.folded) return;

    const toCall = Math.max(0, (t.maxBet || 0) - (active.bet || 0));
    const ctx = {
      hand: active.hand, community: t.community, phase: t.phase,
      pot: t.pot, toCall, myBet: active.bet || 0, chips: active.chips + (active.bet || 0),
      bigBlind: t.config.bigBlind,
      minRaise: Math.max(t.config.bigBlind, t.lastRaiseAmount || t.config.bigBlind),
      numActive: t.players.filter(x => !x.folded).length,
      lastToAct: t.actionIdx === t.players.length - 1,
      wasRaisedPre: (t.maxBet || 0) > t.config.bigBlind,
    };
    let { action, amount } = botDecide(ctx);
    let result = t.applyAction(active.addr, action, amount);
    if (result?.error) {
      // Strategy produced an illegal move for this spot (e.g. short-stack raise
      // below minimum) — degrade gracefully rather than stall the table.
      console.warn(`[Bot] ${action}${amount ? ' ' + amount : ''} rejected (${result.error}) — falling back`);
      const fallback = toCall === 0 ? 'check' : 'call';
      result = t.applyAction(active.addr, fallback, 0);
      action = fallback; amount = 0;
    }
    console.log(`[Bot] ${action}${amount ? ` +${amount}` : ''} (${t.phase}) at table ${t.id}`);
    broadcastTable(t);
    if (result?.winners) await handleHandOver(t, result);
  }, delay);
}
function broadcastToTable(t, msg) {
  t.players.forEach(p => send(p.ws, msg));
}

// Kick off the next hand once at least 2 players are seated and the table is idle.
// `autoStartPending` guards against scheduling one timer per JOIN_TABLE call: at
// higher maxPlayers, several players can join while the table is still 'waiting'
// (phase only flips once start() actually runs), and each would otherwise queue
// its own redundant t.start() — re-dealing and re-deducting blinds every time.
function maybeAutoStart(t) {
  if (t.players.length < 2 || t.phase !== 'waiting' || t.autoStartPending) return;
  t.isActive = true;
  t.autoStartPending = true;
  setTimeout(() => {
    t.autoStartPending = false;
    try { t.start(); }
    catch (e) { console.error(`[Server] t.start() error in maybeAutoStart:`, e.message); t.phase = 'waiting'; }
    broadcastTable(t);
  }, 3000);
}

// Sign and send cashout to a player, removing them from the table.
// If ws is closed, stores the pending cashout for retrieval on reconnect.
async function signAndRemovePlayer(t, addr, ws) {
  const p = t.players.find(x => x.addr === addr);
  if (!p) return;

  // If table isn't Active on-chain yet, handle by intent:
  // - Intentional leave (ws open) → remove player, signal refund
  // - WS disconnect (ws null/closed) → keep player seated, just null their ws
  if (!t.isActive) {
    if (ws?.readyState === WebSocket.OPEN) {
      t.players = t.players.filter(x => x.addr !== addr);
      // Freeroll seats have no on-chain deposit — nothing to refund.
      if (!t.playMoney) send(ws, { type: 'REFUND_AVAILABLE', tableId: String(t.id) });
      if (t.players.length === 0 && !t.isPermanent) tables.delete(t.id);
      broadcastTable(t);
    } else {
      // Only null the WS reference if the player hasn't already reconnected with a new WS.
      // (Race condition: reconnect can update p.ws before this close handler fires.)
      if (!p.ws || p.ws.readyState !== WebSocket.OPEN) {
        p.ws = null; // keep seated; they can reconnect and resume waiting
      }
    }
    return;
  }

  // Anti-snipe lock check
  const lockedUntil    = p.cashoutLockedUntil ?? 0;
  const handsLocked    = lockedUntil > t.handNonce;
  // Unlock condition 2: this is the last player — nobody else remains to hold them
  const othersLeft     = t.players.filter(x => x.addr !== addr).length;
  const everyoneElseLeft = othersLeft === 0;

  if (handsLocked && !everyoneElseLeft) {
    if (ws?.readyState === WebSocket.OPEN)
      send(ws, {
        type: 'CASHOUT_LOCKED',
        handsRemaining: lockedUntil - t.handNonce,
        tableId: String(t.id),
      });
    return; // stay seated
  }
  // Lock lifted — clear it so it doesn't linger
  p.cashoutLockedUntil = 0;

  const amount = p.chips;
  const midHand = t.phase !== 'waiting' && t.phase !== 'showdown';

  if (midHand) {
    // Leaving mid-hand does NOT take the player out of t.players. Whatever they
    // already put in this hand is dead money that still belongs to the pot, and
    // the side-pot split reads contributions off the seated players — dropping
    // them here left those chips in `pot` attributed to nobody, which the
    // showdown's accounting check then had to write off, underpaying whoever
    // was still in the hand. (Seen live: pot=4050 against committed=4040, one
    // small blind short, after a player left between the blinds and showdown.)
    //
    // So: fold them, zero the stack they are cashing out, and mark the seat for
    // removal once the hand is settled.
    p.folded  = true;
    p.allIn   = false;
    p.chips   = 0;
    p.leaving = true;
    p.actionLabel = 'LEFT';

    const wasTheirTurn = t.players[t.actionIdx]?.addr === addr;
    if (wasTheirTurn) {
      const result = t.advance();
      if (result?.winners) {
        broadcastTable(t); // broadcast showdown state before hand-over
        try { await handleHandOver(t, result); }
        catch (e) { console.error('[Server] handleHandOver in signAndRemovePlayer:', e.message); }
      } else {
        t._nextActionIdx();
      }
    }
  } else {
    t.players = t.players.filter(x => x.addr !== addr);
  }

  // If the leave emptied the hand, finish it rather than abandoning it. Setting
  // the phase straight back to 'waiting' left the pot sitting in `t.pot` until
  // the next start() zeroed it — the player who was still in the hand simply
  // lost chips they had already won uncontested.
  if (t.phase !== 'waiting' && t.phase !== 'showdown') {
    const stillIn = t.players.filter(x => !x.folded);
    if (stillIn.length < 2) {
      const result = t.doShowdown(stillIn);
      broadcastTable(t);
      try { await handleHandOver(t, result); }
      catch (e) { console.error('[Server] handleHandOver after last-player leave:', e.message); }
    }
  }

  // Sign a cashout if player has chips. Freeroll chips are play money with no
  // on-chain backing — never sign cashouts for them; prizes are paid from the
  // PromotionsPool separately.
  // Only chips backed by a verified on-chain deposit may become a cashout.
  if (amount > 0 && !t.playMoney) {
    await relayOrSignCashOut(t, addr, amount, ws);
  }

  // Close or reset table when last player exits. A seat kept only so its dead
  // money stays in the hand does not count as a player.
  if (t.players.filter(x => !x.leaving).length === 0 && !midHand) {
    if (t.isPermanent) {
      // Reset permanent table so it's ready for the next game
      t.phase     = 'waiting';
      t.community = [];
      t.pot       = 0;
      t.maxBet    = 0;
      t.deck      = [];
      t.creator   = null;
      t.isActive  = false;
      console.log(`[Server] Permanent table ${t.id} reset after last player left`);
    } else {
      if (process.env.TESTNET_SKIP_CHAIN_VERIFY !== 'true') {
        try {
          const tx = await queueOperatorTx(() => escrow.closeTable(BigInt(t.id)));
          await tx.wait();
        } catch (e) {
          console.error(`[Server] closeTable error:`, e.message);
        }
      }
      tables.delete(t.id);
    }
  }
}

// Handle a hand-over result: sign settlement, broadcast, schedule next hand.
async function handleHandOver(t, result) {
  // The settlement pair comes from the side-pot payouts, not from splitting the
  // pot evenly across showdown winners: with side pots two players can both be
  // owed money in different proportions, and one of them may be collecting an
  // uncalled bet rather than winning anything.
  const payouts = result.payouts
    || new Map(result.winners.map(a => [a, Math.floor(result.pot / result.winners.length)]));
  const { winners: paidTo, shares } = payoutsToShares(payouts, result.pot);

  // A hand can end with nothing to settle — every chip was an uncalled bet
  // returned to its owner, so no money changed hands and the contract (which
  // requires winners.length > 0) has nothing to do. Still tell the table the
  // hand is over, or it sits in showdown forever.
  if (!paidTo.length || result.pot <= 0) {
    console.log(`[Server] table ${t.id} hand ${t.handNonce}: nothing contested — no settlement needed`);
    broadcastToTable(t, {
      type: 'HAND_OVER', winners: [], shares: [],
      showdownWinners: result.winners,
      payouts: Object.fromEntries(result.payouts || []),
      results: result.results.map(r => ({
        addr: r.p.addr,
        hand: t.canReveal(r.p, null) ? r.h.n : null,
        cards: t.canReveal(r.p, null) ? (r.p.hand || []) : [],
      })),
      wentToShowdown: t.wentToShowdown,
      pot: result.pot, sig: null, tableId: String(t.id), handNonce: t.handNonce,
    });
    scheduleNextHand(t);
    return;
  }

  const sig = await t.signAndSettle(paidTo, shares, result.pot);

  // Accumulate gameplay stats in memory; flushed to HandHistory on-chain periodically.
  const participantAddrs = result.results.map(r => r.p.addr);
  const winningsByAddr   = new Map();
  for (const [addr, amount] of payouts) {
    winningsByAddr.set(addr, (winningsByAddr.get(addr) || 0n) + BigInt(Math.floor(amount)));
  }
  recordHandStatsLocally(participantAddrs, result.winners, winningsByAddr);

  broadcastToTable(t, {
    type:      'HAND_OVER',
    // winners/shares are the settlement pair and must stay paired with `sig`.
    winners:   paidTo,
    shares,
    // Who actually won the showdown, and what each player collected — the pot
    // is no longer one number handed to one player.
    showdownWinners: result.winners,
    payouts:   Object.fromEntries(payouts),
    // Same reveal rule as pubState: a hand nobody called shows no cards, and a
    // fold is never shown. `canShow` tells the client a voluntary reveal is
    // still available to the player who won it.
    results:   result.results.map(r => ({
      addr: r.p.addr,
      hand: t.canReveal(r.p, null) ? r.h.n : null,
      cards: t.canReveal(r.p, null) ? (r.p.hand || []) : [],
    })),
    wentToShowdown: t.wentToShowdown,
    pot:       result.pot,
    sig,
    tableId:   String(t.id),
    handNonce: t.handNonce,
  });

  // Anti-snipe lock: if a winner's share of this pot ≥ 50% of all chips at the table,
  // lock their cashout for 7 more hands (lockedUntil = current nonce + 8).
  const totalChips = t.players.reduce((sum, p) => sum + p.chips, 0);
  if (totalChips > 0) {
    for (const [addr, won] of payouts) {
      if (won < totalChips * 0.5) continue;   // what THIS player took, not pot/n
      const winner = t.players.find(x => x.addr === addr);
      if (winner) winner.cashoutLockedUntil = t.handNonce + 8;
    }
  }

  scheduleNextHand(t);
}

// Clear the busted seats and deal the next hand. Every path that ends a hand
// must call this, including one that settles nothing — otherwise the table sits
// in showdown forever.
function scheduleNextHand(t) {
  setTimeout(() => {
    // Remove bust players (0 chips) before the next hand, but keep their seat
    // reserved in bustedSeats so a REBUY_CONFIRMED can re-seat them.
    // Seats held only to keep a departed player's dead money in the finished
    // hand go now, silently — they already cashed out and want no rebuy.
    t.players = t.players.filter(p => !p.leaving);
    const busted = t.players.filter(p => p.chips <= 0);
    t.players = t.players.filter(p => p.chips > 0);
    for (const p of busted) {
      console.log(`[Server] Player ${p.addr?.slice(0,10)} busted — removed from table ${t.id}`);
      t.bustedSeats.set(p.addr, { seatIndex: p.seatIndex, ws: p.ws });
      send(p.ws, { type: 'NEEDS_REBUY', tableId: String(t.id), busted: busted.map(b => b.addr) });
    }
    if (t.players.length < 2) { t.phase = 'waiting'; broadcastTable(t); maybeAutoStart(t); return; }
    t.handNonce++;
    t.dealerIdx = (t.dealerIdx + 1) % t.players.length;
    try {
      t.start();
    } catch (e) {
      console.error(`[Server] t.start() error in hand restart:`, e.message);
      t.phase = 'waiting';
      maybeAutoStart(t);
    }
    broadcastTable(t);
  }, Number(process.env.HAND_RESTART_DELAY_MS) || 6000);
}

// ─── WebSocket message handler ────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const conn = guard.open(ip);
  if (!conn.ok) {
    console.warn(`[WS] refused connection from ${ip}: ${conn.reason}`);
    send(ws, { type: 'ERROR', error: 'Too many connections from your network — try again shortly.' });
    return ws.close(1013, 'too many connections');
  }
  console.log(`[WS] New connection from ${ip}`);
  const challenge = crypto.randomUUID();
  clients.set(ws, { addr: null, tableId: null, challenge });
  send(ws, { type: 'AUTH_CHALLENGE', nonce: challenge });

  // A socket that never authenticates holds a slot forever. Reclaim it.
  const authDeadline = setTimeout(() => {
    if (!clients.get(ws)?.addr) {
      console.log(`[WS] closing unauthenticated connection from ${ip}`);
      ws.close(1008, 'authentication timeout');
    }
  }, guard.authGraceMs);
  authDeadline.unref?.();

  ws.on('close', () => {
    clearTimeout(authDeadline);
    conn.release();
    console.log(`[WS] Connection closed`);
  });
  // Frames already in flight keep arriving after close() begins its handshake,
  // so without this a single flood logs a line per buffered frame — an attacker
  // choosing how much log volume we pay for. Log once, then drop in silence and
  // terminate rather than negotiate.
  let abusive = false;
  ws.on('message', async (raw) => {
    if (abusive) return;
    if (!conn.allowMessage()) {
      abusive = true;
      console.warn(`[WS] rate limit hit by ${ip} — closing`);
      return ws.terminate();
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg;
    const client = clients.get(ws);
    if (!client) return;
    // Sanitize attacker-controlled fields before logging to prevent ANSI/control-char console spoofing.
    const clean = s => String(s).replace(/[^\x20-\x7E]/g, '?').slice(0, 42);
    const safeType = clean(type).slice(0, 32);
    const safeDetail = payload?.tableId ? `tableId=${clean(payload.tableId)}`
      : payload?.address ? `addr=${clean(payload.address).slice(0,10)}` : '';
    console.log(`[WS] ← ${safeType}`, safeDetail);

    switch (type) {

      case 'AUTH': {
        try {
          const { address, signature, token } = payload;
          const nonce = client.challenge;
          if (!nonce) return send(ws, { type: 'AUTH_FAIL', error: 'No challenge' });

          if (token) {
            // Session-pass path: no wallet prompt. On failure the challenge stays
            // valid, so the client falls back to a signature on this connection.
            const t = verifySessionToken(token, address);
            if (!t.ok) {
              console.log(`[WS] session token rejected (${t.reason}) for ${shortAddr(String(address))}`);
              return send(ws, { type: 'AUTH_FAIL', tokenExpired: true,
                error: 'Session expired — sign with your wallet to continue.' });
            }
          } else {
            // Each attempt costs two ECDSA recoveries and, for a contract
            // account, an RPC round trip. Cheap to send, expensive to serve.
            if (!conn.allowAuthAttempt()) {
              console.warn(`[WS] AUTH attempt budget exhausted for ${ip} — closing`);
              send(ws, { type: 'AUTH_FAIL', error: 'Too many failed attempts — reconnect and try again.' });
              return ws.close(1008, 'auth attempts exceeded');
            }
            const check = await verifyWalletSignature(`PVP-AUTH:${nonce}`, signature, address);
            if (!check.ok) {
              console.warn(`[WS] AUTH sig mismatch: sent=${shortAddr(String(address))} recovered=${check.recovered ? shortAddr(check.recovered) : 'n/a'}`);
              return send(ws, { type: 'AUTH_FAIL', error: sigFailureMessage(check, address) });
            }
          }
          // Normalize at the trust boundary. Signature verification and the
          // session-token check both compare case-insensitively, so a client
          // could authenticate the SAME wallet twice under different casings
          // (0xAbC… and 0xabc…). PokerTable.seat() de-dupes with strict ===, so
          // those two forms took two seats — each credited with the full
          // on-chain deposit from a single buy-in. Store one canonical form.
          clients.set(ws, { addr: address.toLowerCase(), tableId: null });
          conn.authSucceeded();
          clearTimeout(authDeadline);
          // Fresh token on every successful auth — a rolling window, so active
          // players never see a signature prompt again on this device.
          const session = issueSessionToken(address);
          send(ws, { type: 'AUTH_OK', address, sessionToken: session.token, sessionExpiresAt: session.expiresAt });
          console.log(`[WS] → AUTH_OK for ${address.slice(0,10)}${token ? ' (session pass)' : ' (signature)'}`);

          // Testnet: auto-verify immediately on auth so players never see or need
          // the manual "Request Verification" gate while this flag is on — fire
          // and forget so the mark-human tx doesn't block the auth handshake.
          if (process.env.TESTNET_SKIP_HUMAN_CHECK === 'true') {
            verifyHuman(address)
              .then(result => send(ws, { type: 'VERIFY_RESULT', ...result }))
              .catch(() => {});
          }

          // Deliver any cashouts owed from a prior disconnection, including
          // ones for tables that no longer exist.
          flushPendingCashouts(address, ws);
        } catch {
          send(ws, { type: 'AUTH_FAIL', error: 'Invalid signature format' });
        }
        break;
      }

      case 'VERIFY_HUMAN': {
        const address = client.addr;
        if (!address) return send(ws, { type: 'ERROR', error: 'Not authenticated' });
        send(ws, { type: 'VERIFY_PENDING' });
        const result = await verifyHuman(address);
        send(ws, { type: 'VERIFY_RESULT', ...result });
        break;
      }

      case 'JOIN_TABLE': {
        const { tableId, seatIndex, config: clientConfig } = payload;
        const tidKey = String(tableId);
        let t = tables.get(tidKey);

        const addr = client.addr;
        if (!addr) return send(ws, { type: 'ERROR', error: 'Not authenticated' });

        // Freeroll tables are a staker perk — tier >= 1 (25K+ SALOON staked) to sit.
        if (t?.isFreeroll) {
          const tier = await getStakeTier(addr);
          if (tier < 1) {
            return send(ws, { type: 'ERROR',
              error: 'Freerolls are for stakers — stake 25,000+ SALOON on the Stake page to enter.' });
          }
        }

        // Only skip on-chain buy-in verification for play-money freeroll tables
        // (which can never trigger an on-chain cashout — see the !isFreeroll guard
        // in signAndRemovePlayer) or when the explicit testnet flag is set. Real-
        // money tables (incl. the permanent cash tables 9001/9002) MUST read the
        // player's actual on-chain deposit — otherwise a client could claim an
        // arbitrary `buyInAmount`, receive unbacked in-memory chips, and have the
        // operator sign a real cashout for chips it never verified.
        // SECURITY: TESTNET_SKIP_CHAIN_VERIFY must be false/unset on mainnet.
        const skipChainVerify = (t?.playMoney === true) || process.env.TESTNET_SKIP_CHAIN_VERIFY === 'true';

        // If not in memory, load config from chain (or use client-provided config in testnet mode)
        if (!t) {
          if (skipChainVerify) {
            const cfg = clientConfig || { buyIn: 1000, bigBlind: 20, maxPlayers: 6, gameType: 0 };
            // Clamp client-supplied config so a malicious payload (e.g. bigBlind:0) can't corrupt blind math.
            cfg.bigBlind   = (Number(cfg.bigBlind) >= 1) ? Math.floor(cfg.bigBlind) : 20;
            cfg.maxPlayers = (cfg.maxPlayers >= 2 && cfg.maxPlayers <= 9) ? Math.floor(cfg.maxPlayers) : 6;
            cfg.buyIn      = (Number(cfg.buyIn) >= cfg.bigBlind * 10) ? Math.floor(cfg.buyIn) : cfg.bigBlind * 100;
            cfg.gameType   = [0,1,2,3].includes(Number(cfg.gameType)) ? Number(cfg.gameType) : 0;
            t = new PokerTable(BigInt(tableId), cfg);
            tables.set(tidKey, t);
            console.log(`[Server] Created table ${tidKey} from client config (TESTNET_SKIP_CHAIN_VERIFY)`);
          } else {
            try {
              const info = await escrow.getTableInfo(BigInt(tableId));
              if (!info || info[0] === 0n) {
                return send(ws, { type: 'ERROR', error: 'Table not found on chain' });
              }
              const config = {
                buyIn:      Number(info[1]),
                bigBlind:   Number(info[2]),
                maxPlayers: Number(info[3]),
                gameType:   Number(info[4]),
              };
              t = new PokerTable(BigInt(tableId), config);
              t.playMoney = false; // deposits come from escrow.getPlayerDeposit
              t.handNonce = Number(info[7]);
              t.isActive  = Number(info[5]) === 1; // TableStatus.Active = 1
              tables.set(tidKey, t);
              console.log(`[Server] Loaded table ${tidKey} from chain`);
            } catch (e) {
              console.error(`[Server] getTableInfo(${tidKey}) failed:`, e.message);
              return send(ws, { type: 'ERROR', error: 'Table not found' });
            }
          }
        }

        // Verify player has bought in on-chain before seating them (skipped in testnet mode)
        let onChainDeposit;
        if (skipChainVerify) {
          const min = t.config.minBuyIn ?? t.config.buyIn;
          const max = t.config.maxBuyIn ?? t.config.buyIn;
          const req = payload.buyInAmount;
          onChainDeposit = (typeof req === 'number' && isFinite(req) && req > 0)
            ? Math.max(min, Math.min(max, req))
            : min;
        } else {
          try {
            onChainDeposit = Number(await escrow.getPlayerDeposit(BigInt(tableId), addr));
          } catch (e) {
            console.error(`[Server] getPlayerDeposit error:`, e.message);
            return send(ws, { type: 'ERROR', error: 'Could not verify buy-in' });
          }
        }
        // Offer the seat picker when the player has not chosen a seat yet, or has
        // not bought in. It used to be gated on `onChainDeposit === 0`, which is
        // never true on a play-money table — so on the only tables most players
        // ever see, they were dropped into whichever seat happened to be free
        // and never got to choose. Already-seated players skip this (handled
        // below as a reconnect), as do busted players waiting on a rebuy.
        const alreadySeated = t.players.some(p => p.addr === addr) || t.bustedSeats.has(addr);
        if (!alreadySeated && (onChainDeposit === 0 || seatIndex == null)) {
          const takenSeats = t.players.map(p => ({
            addr: p.addr, seatIndex: p.seatIndex, isBot: !!p.isBot,
          }));
          return send(ws, { type: 'SEAT_PICKER', tableId: tidKey, maxPlayers: t.config.maxPlayers, takenSeats,
            minBuyIn: t.config.minBuyIn ?? t.config.buyIn,
            maxBuyIn: t.config.maxBuyIn ?? t.config.buyIn,
            needsBuyIn: onChainDeposit === 0,
          });
        }

        // Deliver pending cashout if this player has one from a prior disconnection
        const pendingKey = cashoutKey(t.id, addr);
        const pending = pendingCashouts.get(pendingKey);
        if (pending) { send(ws, pending.msg); pendingCashouts.delete(pendingKey); return; }

        // If player is already seated (reconnect), just update their ws reference
        const existing = t.players.find(p => p.addr === addr);
        if (existing) {
          existing.ws = ws;
          clients.set(ws, { ...client, tableId: tidKey });
          broadcastTable(t);
          return;
        }

        // Busted and waiting on a rebuy — update their ws reference instead of
        // re-seating them (REBUY_CONFIRMED handles re-seating), so a page
        // refresh while waiting doesn't lose the spectator connection.
        const bustedExisting = t.bustedSeats.get(addr);
        if (bustedExisting) {
          bustedExisting.ws = ws;
          clients.set(ws, { ...client, tableId: tidKey });
          send(ws, { type: 'GAME_STATE', state: t.pubState(addr) });
          return;
        }

        const seated = t.seat({ addr, ws, onChainDeposit }, seatIndex ?? null);
        if (!seated) {
          // Almost always the requested seat was taken while the picker was
          // open. Re-send it with current occupancy rather than a dead end.
          const takenSeats = t.players.map(p => ({
            addr: p.addr, seatIndex: p.seatIndex, isBot: !!p.isBot,
          }));
          return send(ws, {
            type: 'SEAT_PICKER', tableId: tidKey, maxPlayers: t.config.maxPlayers, takenSeats,
            minBuyIn: t.config.minBuyIn ?? t.config.buyIn,
            maxBuyIn: t.config.maxBuyIn ?? t.config.buyIn,
            needsBuyIn: false,
            error: t.players.length >= t.config.maxPlayers
              ? 'That table just filled up.'
              : 'That seat was just taken — pick another.',
          });
        }

        clients.set(ws, { ...client, tableId: tidKey });
        console.log(`[WS] Seated ${addr.slice(0,10)} at table ${tidKey} (${t.players.length}/${t.config.maxPlayers})`);
        broadcastTable(t);
        maybeAutoStart(t);
        break;
      }

      case 'ACTION': {
        if (!client.addr) return send(ws, { type: 'ERROR', error: 'Not authenticated' });
        const now = Date.now();
        if (client.lastAction && now - client.lastAction < 100)
          return send(ws, { type: 'ERROR', error: 'Too fast' });
        client.lastAction = now;
        const { tableId, action, amount } = payload;
        const safeAmount = typeof amount === 'number' && isFinite(amount) && amount >= 0 ? amount : 0;
        const t = tables.get(String(tableId));
        if (!t) return;
        const reactionMs = t.turnStartedAt ? Date.now() - t.turnStartedAt : null;
        const result = t.applyAction(client.addr, action, safeAmount);
        if (result?.error) return send(ws, { type: 'ERROR', error: result.error });
        // recordAction() already console.warns internally on WARNING/FLAGGED — log-only, no enforcement.
        behaviorMonitor.recordAction(client.addr, action, reactionMs);
        broadcastTable(t);
        if (result?.winners) await handleHandOver(t, result);
        break;
      }

      case 'EXTEND_TURN': {
        if (!client.addr) return send(ws, { type: 'ERROR', error: 'Not authenticated' });
        const { tableId } = payload;
        const t = tables.get(String(tableId));
        if (!t) return;
        const active = t.players[t.actionIdx];
        if (!active || active.addr !== client.addr)
          return send(ws, { type: 'ERROR', error: 'Not your turn' });
        if (t.turnExtended)
          return send(ws, { type: 'ERROR', error: 'Turn already extended' });
        t.turnExtraMs = TURN_EXTENSION_MS;
        t.turnExtended = true;
        broadcastTable(t);
        break;
      }

      // A player choosing to show a hand nobody called. Voluntary: winning a pot
      // by folding everyone out never exposes cards on its own.
      case 'SHOW_CARDS': {
        if (!client.addr) return send(ws, { type: 'ERROR', error: 'Not authenticated' });
        const t = tables.get(String(payload?.tableId));
        if (!t) return;
        const result = t.showCards(client.addr);
        if (result.error) return send(ws, { type: 'ERROR', error: result.error });
        console.log(`[Server] ${shortAddr(client.addr)} showed their hand at table ${t.id}`);
        // Re-send the finished hand with the newly visible cards, then refresh
        // the table so the seats show them too.
        broadcastToTable(t, {
          type: 'CARDS_SHOWN', tableId: String(t.id), handNonce: t.handNonce,
          addr: client.addr,
          cards: t.players.find(x => x.addr === client.addr)?.hand || [],
        });
        broadcastTable(t);
        break;
      }

      case 'CHAT': {
        if (!client.addr) return send(ws, { type: 'ERROR', error: 'Not authenticated' });
        const now = Date.now();
        if (client.lastChat && now - client.lastChat < 500)
          return send(ws, { type: 'ERROR', error: 'Too fast' });
        const { tableId, text } = payload;
        const t = tables.get(String(tableId));
        if (!t) return;
        if (!t.players.find(p => p.addr === client.addr)) {
          return send(ws, { type: 'ERROR', error: 'Not seated at this table' });
        }
        // Strip control chars (terminal/log injection) but keep normal unicode (emoji etc.) for chat text.
        const safeText = String(text || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 200);
        if (!safeText) return;
        client.lastChat = now;
        broadcastToTable(t, { type: 'CHAT', tableId: String(t.id), addr: client.addr, text: safeText, ts: now });
        break;
      }

      case 'REBUY_CONFIRMED': {
        // Client sends this after their on-chain rebuy transaction confirms.
        // Server verifies by reading the updated deposit from chain.
        const { tableId } = payload;
        const t = tables.get(String(tableId));
        if (!t) return send(ws, { type: 'ERROR', error: 'Table not found' });
        const addr = client.addr;
        if (!addr) return;
        const p = t.players.find(x => x.addr === addr);

        if (!p) {
          // Player busted out of a previous hand — re-seat them in their old spot
          // instead of rejecting, so a rebuy actually gets them back into play.
          const bustedInfo = t.bustedSeats.get(addr);
          if (!bustedInfo) return send(ws, { type: 'ERROR', error: 'Not seated at table' });
          try {
            const onChainDeposit = Number(await escrow.getPlayerDeposit(BigInt(tableId), addr));
            if (onChainDeposit <= 0) {
              return send(ws, { type: 'ERROR', error: 'Rebuy not detected on-chain yet' });
            }
            t.bustedSeats.delete(addr);
            // Prefer their old seat, but a rebuy must never be refused because
            // someone sat down there while they were busted — seat() is strict
            // about a requested seat now, so fall back to any free one.
            if (!t.seat({ addr, ws, onChainDeposit }, bustedInfo.seatIndex)) {
              if (!t.seat({ addr, ws, onChainDeposit }, null)) {
                t.bustedSeats.set(addr, bustedInfo);
                return send(ws, { type: 'ERROR', error: 'Table is full — no seat to rebuy into' });
              }
            }
            broadcastTable(t);
            maybeAutoStart(t);
            send(ws, { type: 'REBUY_OK', amount: onChainDeposit, newStack: onChainDeposit });
          } catch (e) {
            console.error(`[Server] REBUY_CONFIRMED (busted) error:`, e.message);
            send(ws, { type: 'ERROR', error: 'Could not verify rebuy on-chain' });
          }
          return;
        }

        try {
          const newDeposit = Number(await escrow.getPlayerDeposit(BigInt(tableId), addr));
          const rebuyAmount = newDeposit - p.onChainDeposit;
          if (rebuyAmount <= 0) {
            return send(ws, { type: 'ERROR', error: 'Rebuy not detected on-chain yet' });
          }
          p.chips          += rebuyAmount;
          p.onChainDeposit  = newDeposit;
          broadcastTable(t);
          send(ws, { type: 'REBUY_OK', amount: rebuyAmount, newStack: p.chips });
        } catch (e) {
          console.error(`[Server] REBUY_CONFIRMED error:`, e.message);
          send(ws, { type: 'ERROR', error: 'Could not verify rebuy on-chain' });
        }
        break;
      }

      case 'LEAVE_TABLE': {
        const { tableId } = payload;
        const t = tables.get(String(tableId));
        if (t) {
          // Creator restriction: can't leave while another player has an active lock
          const isCreator = t.creator === client.addr;
          const anyLocked = t.players.some(
            x => x.addr !== client.addr && (x.cashoutLockedUntil ?? 0) > t.handNonce
          );
          if (isCreator && anyLocked) {
            send(ws, { type: 'TABLE_LOCKED', reason: 'A player is locked in; wait for 7 hands or all others to leave.' });
            break;
          }
          await signAndRemovePlayer(t, client.addr, ws);
          broadcastTable(t);
        }
        clients.set(ws, { ...client, tableId: null });
        break;
      }

      case 'SPAWN_BOT': {
        // Require authentication (mirrors ACTION/JOIN/CHAT) — the handler used to
        // accept SPAWN_BOT from any unauthenticated socket on any table.
        if (!client.addr) { send(ws, { type: 'ERROR', error: 'Not authenticated' }); break; }
        const tidKey = String(payload?.tableId || client.tableId || '9001');
        const t = tables.get(tidKey);
        if (!t) { send(ws, { type: 'ERROR', error: 'Table not found' }); break; }
        // Bots seat with unbacked in-memory chips, so they must never touch a
        // real-money table (they'd corrupt the pot and settlement). Allow only on
        // play-money freeroll/practice tables, testnet, or when explicitly enabled.
        const botsAllowed = t.playMoney === true
          || process.env.TESTNET_SKIP_CHAIN_VERIFY === 'true'
          || process.env.ENABLE_WS_BOTS === 'true';
        if (!botsAllowed) { send(ws, { type: 'ERROR', error: 'Bots are not available on this table.' }); break; }
        const count = Math.max(1, Math.min(8, Number(payload?.count) || 1));
        const result = spawnBot(t, Number(payload?.buyIn) || undefined, count);
        if (!result.ok) {
          send(ws, { type: 'ERROR', error: result.error }); break;
        }
        send(ws, { type: 'BOT_STATUS', status: 'seated', chips: result.chips, addrs: result.addrs });
        break;
      }

      case 'LIST_TABLES': {
        const list = [...tables.values()].map(t => ({
          id: String(t.id), config: t.config, seated: t.players.length, phase: t.phase, name: t.name || null, isFreeroll: !!t.isFreeroll, playMoney: !!t.playMoney,
        }));
        send(ws, { type: 'TABLE_LIST', tables: list });
        break;
      }
    }
  });

  ws.on('close', async () => {
    const client = clients.get(ws);
    if (client?.tableId) {
      const t = tables.get(client.tableId);
      if (t) {
        await signAndRemovePlayer(t, client.addr, null); // null ws = store pending cashout
        broadcastTable(t);
      }
    }
    clients.delete(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Saloon WS server on :${PORT}`));
