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

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDeployment() {
  try {
    return JSON.parse(readFileSync(join(__dirname, "../deployments/arbitrumSepolia.json"), "utf8"));
  } catch { return null; }
}
const _depl = loadDeployment();

const PORT         = process.env.PORT || 4000;
const OPERATOR_KEY = process.env.OPERATOR_PRIVATE_KEY;
const ESCROW_ADDR  = process.env.NEXT_PUBLIC_ESCROW || process.env.ESCROW_ADDRESS || _depl?.contracts?.PokerEscrow;
const RPC_URL      = process.env.ARB_SEPOLIA_RPC || process.env.ARB_RPC || process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";

if (!ESCROW_ADDR) throw new Error("ESCROW_ADDR not set — add NEXT_PUBLIC_ESCROW to .env or deploy first");
if (!OPERATOR_KEY) throw new Error("OPERATOR_PRIVATE_KEY not set in .env");

const PASSPORT_URL = "https://api.scorer.gitcoin.co";
const PASSPORT_API = process.env.GITCOIN_PASSPORT_API;
const SCORER_ID    = process.env.GITCOIN_SCORER_ID;

// ─── CHAIN SETUP ─────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC_URL);
const operator = new ethers.Wallet(OPERATOR_KEY, provider);

const ESCROW_ABI = [
  "function settle(uint256,uint256,address[],uint256[],bytes) external",
  "function getTableInfo(uint256 id) external view returns (uint256 tableId, uint256 buyInAmount, uint256 bigBlind, uint8 maxPlayers, uint8 gameType, uint8 status, uint256 potTotal, uint256 handNonce, uint8 playerCount)",
  "function getPlayerDeposit(uint256 tableId, address player) external view returns (uint256)",
  "function markHuman(address,bool) external",
  "function closeTable(uint256) external",
];
const escrow = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, operator);

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
async function verifyHuman(address) {
  if (process.env.TESTNET_SKIP_HUMAN_CHECK === 'true') {
    try {
      const tx = await escrow.markHuman(address, true);
      await tx.wait();
      console.log(`[AntiBot] Testnet bypass: marked ${address} as human`);
      return { ok: true };
    } catch (e) {
      console.error("markHuman (testnet bypass) error:", e.message);
      return { ok: false, reason: e.message };
    }
  }

  try {
    const txCount = await provider.getTransactionCount(address);
    if (txCount < 50) return { ok: false, reason: "Less than 50 on-chain transactions" };

    if (PASSPORT_API && SCORER_ID) {
      const res = await fetch(
        `${PASSPORT_URL}/registry/score/${SCORER_ID}/${address}`,
        { headers: { "X-API-KEY": PASSPORT_API } }
      );
      const data = await res.json();
      const score = parseFloat(data?.score || 0);
      if (score < 15) return { ok: false, reason: `Passport score ${score} < 15` };
    }

    const tx = await escrow.markHuman(address, true);
    await tx.wait();
    return { ok: true };
  } catch (e) {
    console.error("verifyHuman error:", e.message);
    return { ok: false, reason: "Verification error" };
  }
}

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
    this.phase        = 'waiting';
    this.dealerIdx    = 0;
    this.actionIdx    = 0;
    this.handNonce    = 0;
    this.sideLog      = [];
    this.cashOutNonces   = new Map(); // addr => nonce
    this.pendingCashouts = new Map(); // addr => { amount, sig, nonce, tableId }
    this.creator      = null;   // first player to sit
    this.isActive     = false;  // mirrors on-chain TableStatus.Active
  }

  seat(player, preferredSeat) {
    if (this.players.length >= this.config.maxPlayers) return false;
    if (this.players.find(p => p.addr === player.addr)) return false;
    if (this.players.length === 0) this.creator = player.addr;
    const chips = player.onChainDeposit ?? this.config.buyIn;
    // Assign seat position: use preferred if free, else first open slot
    const taken = new Set(this.players.map(p => p.seatIndex));
    let seatIndex = (preferredSeat != null && !taken.has(preferredSeat))
      ? preferredSeat
      : [...Array(this.config.maxPlayers).keys()].find(i => !taken.has(i)) ?? 0;
    this.players.push({
      ...player,
      chips,
      onChainDeposit: chips,
      hand: [], bet: 0, folded: false, allIn: false, actionLabel: '',
      cashoutLockedUntil: 0,
      seatIndex,
    });
    return true;
  }

  start() {
    if (this.players.length < 2) return;
    this.deck       = shuffle(makeDeck());
    this.community  = [];
    this.pot        = 0;
    this.phase      = 'preflop';
    this.streetActed = new Set(); // tracks who has acted this betting round
    const n         = this.players.length;
    const holeCount = this.config.gameType === 1 ? 4 : 2;

    this.players.forEach(p => {
      p.hand = []; p.bet = 0; p.folded = false; p.allIn = false; p.actionLabel = '';
      for (let j = 0; j < holeCount; j++) p.hand.push(this.deck.shift());
    });

    // Heads-up (2-player): dealer IS the small blind and acts first preflop
    const sbIdx = n === 2 ? this.dealerIdx : (this.dealerIdx + 1) % n;
    const bbIdx = n === 2 ? (this.dealerIdx + 1) % n : (this.dealerIdx + 2) % n;
    const sb    = this.config.bigBlind / 2;
    const bb    = this.config.bigBlind;
    this.players[sbIdx].chips -= sb; this.players[sbIdx].bet = sb;
    this.players[bbIdx].chips -= bb; this.players[bbIdx].bet = bb;
    this.pot    = sb + bb;
    this.maxBet = bb;
    // Preflop: in HU the SB/dealer acts first; multi-way starts left of BB
    this.actionIdx = n === 2 ? sbIdx : (bbIdx + 1) % n;

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
    if (p.folded || this.phase === 'showdown') return null;

    const due = Math.max(0, this.maxBet - p.bet);

    if (action === 'fold') {
      p.folded = true; p.actionLabel = 'FOLD';
    } else if (action === 'check') {
      if (due > 0) return { error: 'Must call or raise' };
      p.actionLabel = 'CHECK';
    } else if (action === 'call') {
      const pay = Math.min(due, p.chips);
      p.chips -= pay; p.bet += pay; this.pot += pay;
      if (p.chips === 0) p.allIn = true;
      p.actionLabel = `CALL ${pay}`;
    } else if (action === 'raise') {
      const total = this.maxBet + amount;
      const pay   = Math.min(total - p.bet, p.chips);
      p.chips -= pay; p.bet += pay; this.pot += pay;
      this.maxBet = p.bet;
      if (p.chips === 0) p.allIn = true;
      p.actionLabel = `RAISE +${amount}`;
      // After a raise, prior actors must respond again — clear the acted set
      this.streetActed = new Set();
    } else if (action === 'allin') {
      const pay = p.chips;
      p.chips = 0; p.bet += pay; this.pot += pay;
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
    // Single remaining player wins uncontested — skip hand evaluation entirely
    if (alive.length === 1) {
      alive[0].chips += this.pot;
      return { winners:[alive[0].addr], results:[{p:alive[0],h:{r:-1,n:'Uncontested',kickers:[]}}], pot:this.pot };
    }
    const results = alive.map(p => {
      const h = this.config.gameType === 1
        ? bestOmaha(p.hand, this.community)
        : best7([...p.hand, ...this.community]);
      return { p, h };
    }).sort((a,b) => compareHands(b.h, a.h));

    const topHand = results[0].h;
    const winners = results.filter(r => compareHands(r.h, topHand) === 0).map(r => r.p);
    const share   = Math.floor(this.pot / winners.length);
    winners.forEach(w => w.chips += share);

    return { winners: winners.map(w => w.addr), results, pot: this.pot };
  }

  async signAndSettle(winners, shares) {
    const digest = ethers.solidityPackedKeccak256(
      ['uint256','uint256','address[]','uint256[]'],
      [BigInt(this.id), BigInt(this.handNonce), winners, shares.map(BigInt)]
    );
    return operator.signMessage(ethers.getBytes(digest));
  }

  async signCashOut(player, amount, nonce) {
    const digest = ethers.solidityPackedKeccak256(
      ['string','uint256','address','uint256','uint256'],
      ['CASHOUT', BigInt(this.id), player, BigInt(amount), BigInt(nonce)]
    );
    return operator.signMessage(ethers.getBytes(digest));
  }

  pubState(forAddr) {
    const activePlayer = this.phase !== 'waiting' && this.phase !== 'showdown'
      ? this.players[this.actionIdx]
      : null;
    return {
      tableId:    String(this.id),
      phase:      this.phase,
      pot:        this.pot,
      maxBet:     this.maxBet,
      community:  this.community,
      activeAddr: activePlayer?.addr || null,
      dealerAddr: this.players[this.dealerIdx]?.addr || null,
      config:     this.config,
      creator:    this.creator ?? null,
      handNonce:  this.handNonce,
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
        hand: p.addr === forAddr || this.phase === 'showdown'
          ? p.hand
          : p.hand.map(() => '??'),
      })),
    };
  }
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const tables  = new Map();
const clients = new Map(); // ws => { addr, tableId }

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/tables') {
    const list = [...tables.values()].map(t => ({
      id: String(t.id), config: t.config, seated: t.players.length, phase: t.phase,
    }));
    res.writeHead(200);
    res.end(JSON.stringify({ tables: list }));
  } else {
    res.writeHead(200);
    res.end(JSON.stringify({ service: 'PokerPartyPals WS', tables: tables.size }));
  }
});

const wss = new WebSocketServer({ server });

// ─── Helpers ──────────────────────────────────────────────────────────────────
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcastTable(t) {
  t.players.forEach(p => {
    if (p.ws?.readyState === WebSocket.OPEN)
      send(p.ws, { type: 'GAME_STATE', state: t.pubState(p.addr) });
  });
}
function broadcastToTable(t, msg) {
  t.players.forEach(p => send(p.ws, msg));
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
      send(ws, { type: 'REFUND_AVAILABLE', tableId: String(t.id) });
      if (t.players.length === 0) tables.delete(t.id);
      broadcastTable(t);
    } else {
      p.ws = null; // keep seated; they can reconnect and resume waiting
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
  // If it's their turn in an active hand, fold them first
  if (t.phase !== 'waiting' && t.phase !== 'showdown' && t.players[t.actionIdx]?.addr === addr) {
    t.foldPlayer(addr);
    const result = t.advance();
    if (result?.winners) {
      try { await handleHandOver(t, result); }
      catch (e) { console.error('[Server] handleHandOver in signAndRemovePlayer:', e.message); }
    }
  }

  t.players = t.players.filter(x => x.addr !== addr);

  // Pause if fewer than 2 players remain mid-hand
  if (t.phase !== 'waiting' && t.phase !== 'showdown' && t.players.filter(x => !x.folded).length < 2) {
    t.phase = 'waiting';
  }

  // Sign a cashout if player has chips
  if (amount > 0) {
    const nonce = t.cashOutNonces.get(addr) ?? 0;
    try {
      const sig = await t.signCashOut(addr, amount, nonce);
      t.cashOutNonces.set(addr, nonce + 1);
      const msg = { type: 'CASHOUT_SIG', amount, sig, nonce, tableId: String(t.id) };
      if (ws && ws.readyState === WebSocket.OPEN) {
        send(ws, msg);
      } else {
        t.pendingCashouts.set(addr, msg);
      }
    } catch (e) {
      console.error(`[Server] signCashOut error for ${addr}:`, e.message);
    }
  }

  // Close table when last player exits
  if (t.players.length === 0) {
    if (process.env.TESTNET_SKIP_CHAIN_VERIFY !== 'true') {
      try {
        const tx = await escrow.closeTable(BigInt(t.id));
        await tx.wait();
      } catch (e) {
        console.error(`[Server] closeTable error:`, e.message);
      }
    }
    tables.delete(t.id);
  }
}

// Handle a hand-over result: sign settlement, broadcast, schedule next hand.
async function handleHandOver(t, result) {
  const n      = result.winners.length;
  const base   = Math.floor(1000 / n);
  const shares = result.winners.map((_, i) => i === 0 ? base + (1000 - base * n) : base);
  const sig    = await t.signAndSettle(result.winners, shares);
  broadcastToTable(t, {
    type:      'HAND_OVER',
    winners:   result.winners,
    results:   result.results.map(r => ({ addr: r.p.addr, hand: r.h.n })),
    pot:       result.pot,
    sig,
    tableId:   String(t.id),
    handNonce: t.handNonce,
    shares,
  });

  // Anti-snipe lock: if a winner's share of this pot ≥ 50% of all chips at the table,
  // lock their cashout for 7 more hands (lockedUntil = current nonce + 8).
  const totalChips = t.players.reduce((sum, p) => sum + p.chips, 0);
  const perWinner  = result.pot / result.winners.length;
  if (totalChips > 0 && perWinner >= totalChips * 0.5) {
    for (const winnerAddr of result.winners) {
      const winner = t.players.find(x => x.addr === winnerAddr);
      if (winner) winner.cashoutLockedUntil = t.handNonce + 8;
    }
  }

  setTimeout(() => {
    if (t.players.length < 2) { t.phase = 'waiting'; broadcastTable(t); return; }
    t.handNonce++;
    t.dealerIdx = (t.dealerIdx + 1) % t.players.length;
    t.start();
    broadcastTable(t);
  }, 6000);
}

// ─── WebSocket message handler ────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  console.log(`[WS] New connection from ${req.socket.remoteAddress}`);
  ws.on('close', () => console.log(`[WS] Connection closed`));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg;
    const client = clients.get(ws) || {};
    console.log(`[WS] ← ${type}`, payload?.tableId ? `tableId=${payload.tableId}` : payload?.address ? `addr=${payload.address.slice(0,10)}` : '');

    switch (type) {

      case 'AUTH': {
        const { address, signature, nonce } = payload;
        const recovered = ethers.verifyMessage(`PPP-AUTH:${nonce}`, signature);
        if (recovered.toLowerCase() !== address.toLowerCase()) {
          return send(ws, { type: 'AUTH_FAIL', error: 'Bad signature' });
        }
        clients.set(ws, { addr: address, tableId: null });
        send(ws, { type: 'AUTH_OK', address });
        console.log(`[WS] → AUTH_OK for ${address.slice(0,10)}`);

        // Deliver any pending cashout from a prior disconnection
        for (const [, t] of tables) {
          const pending = t.pendingCashouts.get(address);
          if (pending) { send(ws, pending); break; }
        }
        break;
      }

      case 'VERIFY_HUMAN': {
        const { address } = payload;
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

        const skipChainVerify = process.env.TESTNET_SKIP_CHAIN_VERIFY === 'true';

        // If not in memory, load config from chain (or use client-provided config in testnet mode)
        if (!t) {
          if (skipChainVerify) {
            const cfg = clientConfig || { buyIn: 1000, bigBlind: 20, maxPlayers: 6, gameType: 0 };
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
          onChainDeposit = t.config.buyIn; // trust client, treat as fully bought-in
        } else {
          try {
            onChainDeposit = Number(await escrow.getPlayerDeposit(BigInt(tableId), addr));
          } catch (e) {
            console.error(`[Server] getPlayerDeposit error:`, e.message);
            return send(ws, { type: 'ERROR', error: 'Could not verify buy-in' });
          }
        }
        if (onChainDeposit === 0) {
          // Player hasn't bought in yet — send current seat occupancy so UI can show seat picker
          const takenSeats = t.players.map(p => ({ addr: p.addr, seatIndex: p.seatIndex }));
          return send(ws, { type: 'SEAT_PICKER', tableId: tidKey, maxPlayers: t.config.maxPlayers, takenSeats });
        }

        // Deliver pending cashout if this player has one from a prior disconnection
        const pending = t.pendingCashouts.get(addr);
        if (pending) { send(ws, pending); return; }

        // If player is already seated (reconnect), just update their ws reference
        const existing = t.players.find(p => p.addr === addr);
        if (existing) {
          existing.ws = ws;
          clients.set(ws, { ...client, tableId: tidKey });
          broadcastTable(t);
          return;
        }

        const seated = t.seat({ addr, ws, onChainDeposit }, seatIndex ?? null);
        if (!seated) return send(ws, { type: 'ERROR', error: 'Cannot join table' });

        clients.set(ws, { ...client, tableId: tidKey });
        console.log(`[WS] Seated ${addr.slice(0,10)} at table ${tidKey} (${t.players.length}/${t.config.maxPlayers})`);
        broadcastTable(t);

        if (t.players.length >= t.config.maxPlayers) {
          t.isActive = true;
          if (t.phase === 'waiting') {
            setTimeout(() => { t.start(); broadcastTable(t); }, 3000);
          }
        }
        break;
      }

      case 'ACTION': {
        const { tableId, action, amount } = payload;
        const t = tables.get(String(tableId));
        if (!t) return;
        const result = t.applyAction(client.addr, action, amount);
        broadcastTable(t);
        if (result?.winners) await handleHandOver(t, result);
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
        if (!p) return send(ws, { type: 'ERROR', error: 'Not seated at table' });

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

      case 'LIST_TABLES': {
        const list = [...tables.values()].map(t => ({
          id: String(t.id), config: t.config, seated: t.players.length, phase: t.phase,
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

server.listen(PORT, () => console.log(`PokerPartyPals WS server on :${PORT}`));
