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

const PORT            = process.env.PORT || 4000;
const OPERATOR_KEY    = process.env.OPERATOR_PRIVATE_KEY;
const ESCROW_ADDR     = process.env.NEXT_PUBLIC_ESCROW || process.env.ESCROW_ADDRESS || _depl?.contracts?.PokerEscrow;
const RPC_URL         = process.env.ARB_SEPOLIA_RPC || process.env.ARB_RPC || process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";

if (!ESCROW_ADDR) throw new Error("ESCROW_ADDR not set — add NEXT_PUBLIC_ESCROW to .env or deploy first");
if (!OPERATOR_KEY) throw new Error("OPERATOR_PRIVATE_KEY not set in .env");
const PASSPORT_URL    = "https://api.scorer.gitcoin.co";
const PASSPORT_API    = process.env.GITCOIN_PASSPORT_API;
const SCORER_ID       = process.env.GITCOIN_SCORER_ID;

// ─── CHAIN SETUP ─────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC_URL);
const operator = new ethers.Wallet(OPERATOR_KEY, provider);

const ESCROW_ABI = [
  "function settle(uint256,uint256,address[],uint256[],bytes) external",
  "function getTableInfo(uint256 id) external view returns (uint256 tableId, uint256 buyInAmount, uint256 bigBlind, uint8 maxPlayers, uint8 gameType, uint8 status, uint256 potTotal, uint256 handNonce, uint8 playerCount)",
  "function markHuman(address,bool) external",
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
    // Cryptographically random shuffle
    const j = crypto.randomInt(0, i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─── HAND EVALUATOR (server-side authoritative) ───────────────────────────────
function evalFive(cs) {
  const v = cs.map(c => RV[c[0] === 'T' ? 'T' : c[0]]).sort((a,b)=>b-a);
  const ss = cs.map(c => c.slice(-1));
  const flush = ss.every(x => x === ss[0]);
  const uniq = [...new Set(v)];
  const cnts = uniq.map(x=>({x,n:v.filter(y=>y===x).length})).sort((a,b)=>b.n-a.n||b.x-a.x);
  const str = uniq.length===5 && v[0]-v[4]===4;
  const wheel = uniq.length===5 && v[0]===14 && v[1]===5;
  if (flush && str && v[0]===14) return {r:9,n:"Royal Flush"};
  if (flush && (str||wheel))    return {r:8,n:"Straight Flush"};
  if (cnts[0].n===4)            return {r:7,n:"Four of a Kind"};
  if (cnts[0].n===3&&cnts[1]?.n===2) return {r:6,n:"Full House"};
  if (flush)                    return {r:5,n:"Flush"};
  if (str||wheel)               return {r:4,n:"Straight"};
  if (cnts[0].n===3)            return {r:3,n:"Three of a Kind"};
  if (cnts[0].n===2&&cnts[1]?.n===2) return {r:2,n:"Two Pair"};
  if (cnts[0].n===2)            return {r:1,n:"One Pair"};
  return {r:0,n:"High Card"};
}
function best7(cs) {
  let b = null;
  for (let i=0;i<cs.length-1;i++)
    for (let j=i+1;j<cs.length;j++) {
      const e = evalFive(cs.filter((_,k)=>k!==i&&k!==j));
      if (!b || e.r > b.r) b = e;
    }
  return b || evalFive(cs);
}

// Omaha: must use exactly 2 hole + exactly 3 community
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
      if (!best || e.r > best.r) best = e;
    }
  return best;
}

// ─── ANTI-BOT VERIFICATION ───────────────────────────────────────────────────
async function verifyHuman(address) {
  // Testnet bypass — skip all checks and mark human directly
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
    // 1. Check wallet age + tx count on-chain
    const txCount = await provider.getTransactionCount(address);
    if (txCount < 50) return { ok: false, reason: "Less than 50 on-chain transactions" };

    // 2. Check Gitcoin Passport score
    if (PASSPORT_API && SCORER_ID) {
      const res = await fetch(
        `${PASSPORT_URL}/registry/score/${SCORER_ID}/${address}`,
        { headers: { "X-API-KEY": PASSPORT_API } }
      );
      const data = await res.json();
      const score = parseFloat(data?.score || 0);
      if (score < 15) return { ok: false, reason: `Passport score ${score} < 15` };
    }

    // 3. Mark on-chain via escrow
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
    this.id        = id;
    this.config    = config; // { buyIn, bigBlind, maxPlayers, gameType }
    this.players   = [];     // { addr, ws, chips, hand, bet, folded, allIn, actionLabel }
    this.spectators = [];
    this.deck      = [];
    this.community = [];
    this.pot       = 0;
    this.maxBet    = 0;
    this.phase     = 'waiting';
    this.dealerIdx = 0;
    this.actionIdx = 0;
    this.handNonce = 0;
    this.sideLog   = [];     // hash log for audit
  }

  seat(player) {
    if (this.players.length >= this.config.maxPlayers) return false;
    if (this.players.find(p => p.addr === player.addr)) return false;
    this.players.push({ ...player, chips: this.config.buyIn, hand:[], bet:0, folded:false, allIn:false, actionLabel:'' });
    return true;
  }

  start() {
    if (this.players.length < 2) return;
    this.deck      = shuffle(makeDeck());
    this.community = [];
    this.pot       = 0;
    this.phase     = 'preflop';
    const n        = this.players.length;
    const holeCount = this.config.gameType === 1 ? 4 : 2; // Omaha = 4 hole cards

    // Deal hole cards
    this.players.forEach((p, i) => {
      p.hand    = [];
      p.bet     = 0;
      p.folded  = false;
      p.allIn   = false;
      p.actionLabel = '';
      for (let j = 0; j < holeCount; j++) p.hand.push(this.deck.shift());
    });

    // Post blinds
    const sbIdx = (this.dealerIdx + 1) % n;
    const bbIdx = (this.dealerIdx + 2) % n;
    const sb    = this.config.bigBlind / 2;
    const bb    = this.config.bigBlind;
    this.players[sbIdx].chips -= sb; this.players[sbIdx].bet = sb;
    this.players[bbIdx].chips -= bb; this.players[bbIdx].bet = bb;
    this.pot    = sb + bb;
    this.maxBet = bb;
    this.actionIdx = (bbIdx + 1) % n;

    // Commit hand start to audit log
    const handHash = crypto.createHash('sha256')
      .update(JSON.stringify({ id:String(this.id), nonce:this.handNonce, deck:this.deck.slice(0,5).join(','), ts:Date.now() }))
      .digest('hex');
    this.sideLog.push({ event:'hand_start', handHash, nonce:this.handNonce });
  }

  // Advance actionIdx to the next player who can act (not folded, not all-in)
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

  // First active player after dealer (for new streets)
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

  applyAction(addr, action, amount = 0) {
    const idx = this.players.findIndex(x => x.addr === addr);
    // Only the player whose turn it is may act
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
    } else if (action === 'allin') {
      const pay = p.chips;
      p.chips = 0; p.bet += pay; this.pot += pay;
      this.maxBet = Math.max(this.maxBet, p.bet);
      p.allIn = true; p.actionLabel = 'ALL IN';
    }

    this._nextActionIdx();
    return this.advance();
  }

  advance() {
    const alive   = this.players.filter(p => !p.folded);
    const allBetsEq = alive.every(p => p.bet === this.maxBet || p.allIn);

    if (alive.length === 1) return this.doShowdown(alive);
    if (!allBetsEq) return null; // more betting to go

    // Reset bets for new street
    this.players.forEach(p => { p.bet = 0; p.actionLabel = ''; });
    this.maxBet = 0;

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
    return null;
  }

  doShowdown(alive) {
    this.phase = 'showdown';
    const results = alive.map(p => {
      const h = this.config.gameType === 1
        ? bestOmaha(p.hand, this.community)
        : best7([...p.hand, ...this.community]);
      return { p, h };
    }).sort((a,b) => b.h.r - a.h.r);

    const winners = results.filter(r => r.h.r === results[0].h.r).map(r => r.p);
    const share   = Math.floor(this.pot / winners.length);
    winners.forEach(w => w.chips += share);

    return { winners: winners.map(w => w.addr), results, pot: this.pot };
  }

  async signAndSettle(winners, shares) {
    const digest = ethers.solidityPackedKeccak256(
      ['uint256','uint256','address[]','uint256[]'],
      [BigInt(this.id), BigInt(this.handNonce), winners, shares.map(BigInt)]
    );
    const sig = await operator.signMessage(ethers.getBytes(digest));
    return sig;
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
      players: this.players.map(p => ({
        addr:        p.addr,
        chips:       p.chips,
        bet:         p.bet,
        folded:      p.folded,
        allIn:       p.allIn,
        actionLabel: p.actionLabel,
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
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'PokerPartyPals WS', tables: tables.size }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg;
    const client = clients.get(ws) || {};

    switch (type) {

      case 'AUTH': {
        // Verify signature: client signs nonce with their private key
        const { address, signature, nonce } = payload;
        const recovered = ethers.verifyMessage(`PPP-AUTH:${nonce}`, signature);
        if (recovered.toLowerCase() !== address.toLowerCase()) {
          return send(ws, { type: 'AUTH_FAIL', error: 'Bad signature' });
        }
        clients.set(ws, { addr: address, tableId: null });
        send(ws, { type: 'AUTH_OK', address });
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
        const { tableId } = payload;
        const tidKey = String(tableId);
        let t = tables.get(tidKey);

        // If not in memory, fetch config from on-chain
        if (!t) {
          try {
            const info = await escrow.getTableInfo(BigInt(tableId));
            // info: (tableId, buyInAmount, bigBlind, maxPlayers, gameType, status, potTotal, handNonce, playerCount)
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
            tables.set(tidKey, t);
            console.log(`[Server] Loaded table ${tidKey} from chain`);
          } catch (e) {
            console.error(`[Server] getTableInfo(${tidKey}) failed:`, e.message);
            return send(ws, { type: 'ERROR', error: 'Table not found' });
          }
        }

        const addr = client.addr;
        if (!addr) return send(ws, { type: 'ERROR', error: 'Not authenticated' });

        const seated = t.seat({ addr, ws });
        if (!seated) return send(ws, { type: 'ERROR', error: 'Cannot join table' });

        clients.set(ws, { ...client, tableId: tidKey });
        broadcastTable(t);

        if (t.players.length >= t.config.maxPlayers) {
          setTimeout(() => { t.start(); broadcastTable(t); }, 3000);
        }
        break;
      }

      case 'ACTION': {
        const { tableId, action, amount } = payload;
        const t = tables.get(String(tableId));
        if (!t) return;
        const result = t.applyAction(client.addr, action, amount);
        broadcastTable(t);

        if (result?.winners) {
          // Hand over — sign settlement
          const base   = Math.floor(1000 / result.winners.length);
          const shares = result.winners.map((_, i) =>
            i === 0 ? base + (1000 - base * result.winners.length) : base
          );
          const sig = await t.signAndSettle(result.winners, shares);
          broadcastToTable(t, {
            type: 'HAND_OVER',
            winners: result.winners,
            results: result.results.map(r => ({ addr: r.p.addr, hand: r.h.n })),
            pot: result.pot,
            sig,
            tableId: String(tableId),
            handNonce: t.handNonce,
            shares,
          });
          // Auto-restart after 6s
          setTimeout(() => {
            t.handNonce++;
            t.dealerIdx = (t.dealerIdx + 1) % t.players.length;
            t.start();
            broadcastTable(t);
          }, 6000);
        }
        break;
      }

      case 'LEAVE_TABLE': {
        const { tableId } = payload;
        const t = tables.get(String(tableId));
        if (t) {
          t.players = t.players.filter(p => p.addr !== client.addr);
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

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client?.tableId) {
      const t = tables.get(client.tableId);
      if (t) { t.players = t.players.filter(p => p.addr !== client.addr); broadcastTable(t); }
    }
    clients.delete(ws);
  });
});

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

server.listen(PORT, () => console.log(`PokerPartyPals WS server on :${PORT}`));
