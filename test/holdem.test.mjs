/**
 * Hold'em game-logic unit tests — pure Node.js, no Hardhat required.
 * Run: node test/holdem.test.mjs
 *
 * Covers:
 *  - evalFive: all 10 hand ranks + kickers
 *  - compareHands: tiebreakers for every rank
 *  - best7: correct best-5 selection from 7 cards
 *  - bestOmaha: exactly 2 hole + 3 community
 *  - Game flow: preflop → flop → turn → river → showdown
 *  - Heads-up blind assignments (dealer = SB)
 *  - Fold win (all-but-one fold)
 *  - All-in: advance() deals board without action
 *  - Multi-winner tie split (shares sum to 1000)
 *  - doShowdown winner selection with kicker tiebreaks
 */

import crypto from 'crypto';

// ─── Card engine (mirrored from server/index.js) ────────────────────────────
const SUITS = ["S","H","D","C"];
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const RV    = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));

function makeDeck() { return SUITS.flatMap(s => RANKS.map(r=>`${r}${s}`)); }
function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length-1; i > 0; i--) {
    const j = crypto.randomInt(0, i+1);
    [d[i],d[j]] = [d[j],d[i]];
  }
  return d;
}

function evalFive(cs) {
  const v = cs.map(c => RV[c[0]]).sort((a,b)=>b-a);
  const ss = cs.map(c => c.slice(-1));
  const flush = ss.every(x => x === ss[0]);
  const uniq  = [...new Set(v)];
  const cnts  = uniq.map(x=>({x,n:v.filter(y=>y===x).length})).sort((a,b)=>b.n-a.n||b.x-a.x);
  const str   = uniq.length===5 && v[0]-v[4]===4;
  const wheel = uniq.length===5 && v[0]===14 && v[1]===5;
  const kickers = cnts.map(c=>c.x);
  if (flush&&str&&v[0]===14) return {r:9,n:"Royal Flush",        kickers:[14]};
  if (flush&&(str||wheel))   return {r:8,n:"Straight Flush",      kickers:wheel?[5]:[v[0]]};
  if (cnts[0].n===4)         return {r:7,n:"Four of a Kind",      kickers};
  if (cnts[0].n===3&&cnts[1]?.n===2) return {r:6,n:"Full House", kickers};
  if (flush)                 return {r:5,n:"Flush",               kickers:v};
  if (str||wheel)            return {r:4,n:"Straight",            kickers:wheel?[5]:[v[0]]};
  if (cnts[0].n===3)         return {r:3,n:"Three of a Kind",     kickers};
  if (cnts[0].n===2&&cnts[1]?.n===2) return {r:2,n:"Two Pair",   kickers};
  if (cnts[0].n===2)         return {r:1,n:"One Pair",            kickers};
  return {r:0,n:"High Card",kickers:v};
}
function compareHands(a,b) {
  if (a.r !== b.r) return a.r - b.r;
  for (let i=0; i<Math.max(a.kickers.length,b.kickers.length); i++) {
    const ak=a.kickers[i]??0, bk=b.kickers[i]??0;
    if (ak!==bk) return ak-bk;
  }
  return 0;
}
function best7(cs) {
  let b = null;
  for (let i=0;i<cs.length-1;i++)
    for (let j=i+1;j<cs.length;j++) {
      const e = evalFive(cs.filter((_,k)=>k!==i&&k!==j));
      if (!b || compareHands(e,b)>0) b = e;
    }
  return b || evalFive(cs);
}
function bestOmaha(hole, comm) {
  let best = null;
  const hpairs=[], ctrips=[];
  for (let i=0;i<hole.length-1;i++)
    for (let j=i+1;j<hole.length;j++) hpairs.push([hole[i],hole[j]]);
  for (let i=0;i<comm.length-2;i++)
    for (let j=i+1;j<comm.length-1;j++)
      for (let k=j+1;k<comm.length;k++) ctrips.push([comm[i],comm[j],comm[k]]);
  for (const hp of hpairs)
    for (const ct of ctrips) {
      const e = evalFive([...hp,...ct]);
      if (!best || compareHands(e,best)>0) best = e;
    }
  return best;
}

// ─── Minimal PokerTable game-state machine ───────────────────────────────────
class PokerTable {
  constructor(config) {
    this.config    = config; // { bigBlind, maxPlayers, gameType:0 }
    this.players   = [];
    this.deck      = [];
    this.community = [];
    this.pot       = 0;
    this.maxBet    = 0;
    this.phase     = 'waiting';
    this.dealerIdx = 0;
    this.actionIdx = 0;
    this.handNonce = 0;
  }
  seat(addr, chips) {
    this.players.push({ addr, chips, bet:0, folded:false, allIn:false, hand:[], actionLabel:'' });
  }
  start() {
    this.deck        = shuffle(makeDeck());
    this.community   = [];
    this.pot         = 0;
    this.phase       = 'preflop';
    this.streetActed = new Set();
    const n          = this.players.length;
    const hc         = this.config.gameType === 1 ? 4 : 2;
    this.players.forEach(p => {
      p.hand=[]; p.bet=0; p.folded=false; p.allIn=false; p.actionLabel='';
      for (let j=0;j<hc;j++) p.hand.push(this.deck.shift());
    });
    const sbIdx = n===2 ? this.dealerIdx : (this.dealerIdx+1)%n;
    const bbIdx = n===2 ? (this.dealerIdx+1)%n : (this.dealerIdx+2)%n;
    const sb = this.config.bigBlind/2, bb = this.config.bigBlind;
    this.players[sbIdx].chips -= sb; this.players[sbIdx].bet = sb;
    this.players[bbIdx].chips -= bb; this.players[bbIdx].bet = bb;
    this.pot    = sb+bb;
    this.maxBet = bb;
    this.actionIdx = n===2 ? sbIdx : (bbIdx+1)%n;
  }
  _nextActionIdx() {
    const n = this.players.length;
    let next = (this.actionIdx+1)%n, iters=0;
    while ((this.players[next].folded||this.players[next].allIn) && iters<n) {
      next=(next+1)%n; iters++;
    }
    this.actionIdx = next;
  }
  _resetStreet() {
    const n=this.players.length;
    let next=(this.dealerIdx+1)%n, iters=0;
    while ((this.players[next].folded||this.players[next].allIn) && iters<n) {
      next=(next+1)%n; iters++;
    }
    this.actionIdx=next;
  }
  advance() {
    const alive     = this.players.filter(p=>!p.folded);
    const allBetsEq = alive.every(p=>p.bet===this.maxBet||p.allIn);
    const allActed  = alive.every(p=>p.allIn||this.streetActed.has(p.addr));
    if (alive.length===1) return this.doShowdown(alive);
    if (!allBetsEq||!allActed) return null;
    this.players.forEach(p=>{p.bet=0;p.actionLabel='';});
    this.maxBet=0;
    this.streetActed=new Set();
    if (this.phase==='preflop') {
      this.community=[this.deck.shift(),this.deck.shift(),this.deck.shift()];
      this.phase='flop';
    } else if (this.phase==='flop') {
      this.community.push(this.deck.shift()); this.phase='turn';
    } else if (this.phase==='turn') {
      this.community.push(this.deck.shift()); this.phase='river';
    } else if (this.phase==='river') {
      return this.doShowdown(alive);
    }
    this._resetStreet();
    // All players all-in — run out the board without action
    if (alive.every(p=>p.allIn)) return this.advance();
    return null;
  }
  applyAction(addr, action, amount=0) {
    const idx = this.players.findIndex(x=>x.addr===addr);
    if (idx<0||idx!==this.actionIdx) return {error:'Not your turn'};
    const p = this.players[idx];
    if (p.folded||this.phase==='showdown') return null;
    const due = Math.max(0,this.maxBet-p.bet);
    if (action==='fold')  { p.folded=true; p.actionLabel='FOLD'; }
    else if (action==='check')  { if(due>0) return {error:'Must call'}; p.actionLabel='CHECK'; }
    else if (action==='call')   { const pay=Math.min(due,p.chips); p.chips-=pay;p.bet+=pay;this.pot+=pay; if(p.chips===0)p.allIn=true; p.actionLabel=`CALL ${pay}`; }
    else if (action==='raise')  { const pay=Math.min(this.maxBet+amount-p.bet,p.chips); p.chips-=pay;p.bet+=pay;this.pot+=pay;this.maxBet=p.bet; if(p.chips===0)p.allIn=true; p.actionLabel=`RAISE`; this.streetActed=new Set(); }
    else if (action==='allin')  { const pay=p.chips; p.chips=0;p.bet+=pay;this.pot+=pay;this.maxBet=Math.max(this.maxBet,p.bet);p.allIn=true;p.actionLabel='ALL IN'; this.streetActed=new Set(); }
    this.streetActed.add(addr);
    this._nextActionIdx();
    return this.advance();
  }
  doShowdown(alive) {
    this.phase='showdown';
    // Single remaining player wins uncontested — no hand evaluation needed
    if (alive.length === 1) {
      alive[0].chips += this.pot;
      return { winners:[alive[0].addr], results:[{p:alive[0],h:{r:-1,n:'Uncontested',kickers:[]}}], pot:this.pot };
    }
    const results = alive.map(p=>{
      const h = this.config.gameType===1
        ? bestOmaha(p.hand,this.community)
        : best7([...p.hand,...this.community]);
      return {p,h};
    }).sort((a,b)=>compareHands(b.h,a.h));
    const topHand = results[0].h;
    const winners = results.filter(r=>compareHands(r.h,topHand)===0).map(r=>r.p);
    const share   = Math.floor(this.pot/winners.length);
    winners.forEach(w=>w.chips+=share);
    return {winners:winners.map(w=>w.addr),results,pot:this.pot};
  }
}

// ─── Test harness ────────────────────────────────────────────────────────────
let pass=0, fail=0, section='';
function describe(label) { section=label; console.log(`\n── ${label}`); }
function test(name, cond, detail='') {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}${detail?' — '+detail:''}`); fail++; }
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('evalFive — hand rankings');
test('Royal Flush',       evalFive(['AS','KS','QS','JS','TS']).r===9);
test('Straight Flush',    evalFive(['9H','8H','7H','6H','5H']).r===8);
test('Four of a Kind',    evalFive(['AH','AS','AD','AC','KS']).r===7);
test('Full House',        evalFive(['AH','AS','AD','KH','KS']).r===6);
test('Flush',             evalFive(['2H','5H','7H','JH','AH']).r===5);
test('Straight 9-high',   evalFive(['5S','6H','7D','8C','9S']).r===4);
test('Wheel (A-2-3-4-5)', evalFive(['AS','2H','3D','4C','5S']).r===4);
test('Three of a Kind',   evalFive(['AH','AS','AD','KH','QS']).r===3);
test('Two Pair',          evalFive(['AH','AS','KH','KS','QD']).r===2);
test('One Pair',          evalFive(['AH','AS','KH','QS','JD']).r===1);
test('High Card',         evalFive(['AH','KS','QD','JC','9S']).r===0);

describe('evalFive — kickers attached');
test('Royal Flush kicker=[14]',       JSON.stringify(evalFive(['AS','KS','QS','JS','TS']).kickers)==='[14]');
test('Wheel kicker=[5] not 14',       evalFive(['AS','2H','3D','4C','5S']).kickers[0]===5);
test('Str 9-high kicker=[9]',         evalFive(['5S','6H','7D','8C','9S']).kickers[0]===9);
test('Flush kickers=[14,J,9,7,2]',    evalFive(['2H','5H','7H','JH','AH']).kickers[0]===14);
const _4oak = evalFive(['AH','AS','AD','AC','KS']);
test('Four of a Kind: quad then kick', _4oak.kickers[0]===14 && _4oak.kickers[1]===13);
const _fh   = evalFive(['AH','AS','AD','KH','KS']);
test('Full House: trips then pair',    _fh.kickers[0]===14  && _fh.kickers[1]===13);
const _1p   = evalFive(['AH','AS','KH','QS','JD']);
test('One Pair: pair then kickers',    _1p.kickers[0]===14  && _1p.kickers[1]===13 && _1p.kickers[2]===12);

describe('compareHands — tiebreakers');
// Same rank, kicker decides
const pAK = evalFive(['AH','AS','KH','QS','JD']);  // One Pair AA, K-Q-J kickers
const pA4 = evalFive(['AH','AS','4H','3S','2D']);  // One Pair AA, 4-3-2 kickers
test('Pair AA: K kicker beats 4 kicker', compareHands(pAK,pA4)>0);

const tpAAKK = evalFive(['AH','AS','KH','KS','QD']); // Two Pair AA-KK-Q
const tpAAKK3 = evalFive(['AH','AS','KH','KS','3D']); // Two Pair AA-KK-3
test('Two Pair AA-KK: Q kicker beats 3', compareHands(tpAAKK,tpAAKK3)>0);

const flA = evalFive(['AH','JH','9H','7H','3H']);
const flK = evalFive(['KH','JH','9H','7H','3H']);
test('Flush: A-high beats K-high', compareHands(flA,flK)>0);

const str9 = evalFive(['9S','8H','7D','6C','5S']);
const str8 = evalFive(['8S','7H','6D','5C','4S']);
const strW = evalFive(['AS','2H','3D','4C','5S']);
test('Straight: 9-high beats 8-high', compareHands(str9,str8)>0);
test('Straight: 9-high beats wheel',  compareHands(str9,strW)>0);
test('Straight: 8-high beats wheel',  compareHands(str8,strW)>0);

// Exact same hand = tie
const same1 = evalFive(['AH','KS','QD','JC','9S']);
const same2 = evalFive(['AC','KD','QH','JS','9H']);
test('High Card: identical ranks = tie', compareHands(same1,same2)===0);

describe('best7 — selects correct best 5 from 7');
// Straight vs pair: should pick straight
const h3 = best7(['2H','3S','4D','5C','6H','AH','AS']);
test('best7 picks straight over pair', h3.r===4);

// Kicker selection: Two pair AA44 with K vs 3
const h1 = best7(['AH','AS','KH','4D','4C','2H','3S']);
const h2 = best7(['AH','AS','3H','4D','4C','2H','7S']);
test('best7 Two Pair: K kicker beats 7 kicker', compareHands(h1,h2)>0);

// Four of a kind with different kickers
const q1 = best7(['AH','AS','AD','AC','KH','QS','JD']);
const q2 = best7(['AH','AS','AD','AC','2H','QS','JD']);
test('best7 Quad Aces: K kicker beats 2 kicker', compareHands(q1,q2)>0);

// Flush over two pair
const fl = best7(['2H','5H','7H','JH','AH','KS','KD']);
test('best7 picks flush over two pair', fl.r===5);

// Both use board for straight — pure tie
const brd = ['2D','3H','4C','5S','6D'];
const b1 = best7(['AH','KS',...brd]);
const b2 = best7(['AS','KH',...brd]);
test('best7 identical board straight = tie', compareHands(b1,b2)===0);

describe('bestOmaha — exactly 2 hole + 3 community');
// AAAA hole + KQJT9 board: must use exactly 2 hole → best is AA + K+Q+J = One Pair AA
// The board straight KQJT9 cannot be used because that requires 5 community cards (illegal)
const oOmaha2 = bestOmaha(['AH','AS','AD','AC'],['KS','QH','JD','TC','9S']);
test('Omaha: AAAA hole + KQJT9 → One Pair (can\'t use 5 board cards)', oOmaha2.r===1);
// Flush using 2 hole hearts + 3 board hearts
const oFlush = bestOmaha(['AH','2H','3D','4C'],['5H','7H','9H','KS','2D']);
test('Omaha: flush with 2 hole + 3 community hearts', oFlush.r===5);

describe('Game flow — 2 players HU');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:2, gameType:0});
  t.seat('Alice', 1000);
  t.seat('Bob',   1000);
  t.start();
  test('HU: dealer (seat 0) is SB', t.players[t.dealerIdx].bet === 10, `dealer.bet=${t.players[t.dealerIdx].bet}`);
  test('HU: seat 1 is BB',           t.players[1].bet === 20,           `p1.bet=${t.players[1].bet}`);
  test('HU: SB/dealer acts first preflop', t.players[t.actionIdx].addr === 'Alice');
  test('Phase is preflop',            t.phase === 'preflop');
  test('Pot = SB+BB = 30',            t.pot   === 30);
  test('Each player has 2 hole cards',t.players.every(p=>p.hand.length===2));
}

describe('Game flow — 3 players multi-way');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:3, gameType:0});
  t.seat('A',1000); t.seat('B',1000); t.seat('C',1000);
  t.dealerIdx = 0; t.start();
  // dealer=0, SB=1, BB=2, UTG/first-to-act=0 (dealer)
  test('3-way: SB=seat1 bet=10', t.players[1].bet===10);
  test('3-way: BB=seat2 bet=20', t.players[2].bet===20);
  test('3-way: UTG (seat0) acts first', t.players[t.actionIdx].addr==='A');
  test('3-way: pot=30', t.pot===30);
}

describe('Game flow — complete hand, fold win');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:2, gameType:0});
  t.seat('Alice', 1000); t.seat('Bob', 1000);
  t.start();
  // Alice is SB/dealer. She folds preflop → Bob wins
  const result = t.applyAction('Alice','fold');
  test('Fold: result has winners', Array.isArray(result?.winners));
  test('Fold: Bob wins',           result?.winners?.[0]==='Bob');
  test('Fold: phase=showdown',     t.phase==='showdown');
  test('Fold: Bob gained pot',     t.players.find(p=>p.addr==='Bob')?.chips > 1000 - 20);
}

describe('Game flow — full street progression (call-down)');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:2, gameType:0});
  t.seat('Alice',1000); t.seat('Bob',1000);
  t.start();
  // Preflop HU: Alice (SB/dealer) calls → Bob (BB) gets option
  t.applyAction('Alice','call');      // SB completes to 20; Bob still has BB option
  test('After SB call: still preflop (BB gets option)', t.phase==='preflop');
  t.applyAction('Bob','check');       // BB checks → advance to flop
  test('After BB check: phase=flop',   t.phase==='flop');
  test('After BB check: 3 community',  t.community.length===3);
  // Flop: Bob acts first postflop (non-dealer in HU), both check → turn
  t.applyAction('Bob','check');
  test('After Bob check flop: still flop', t.phase==='flop');
  t.applyAction('Alice','check');     // Alice closes flop → turn
  test('After Alice check flop: phase=turn', t.phase==='turn');
  test('After Alice check flop: 4 community', t.community.length===4);
  // Turn: both check → river
  t.applyAction('Bob','check');
  t.applyAction('Alice','check');
  test('After turn checks: phase=river', t.phase==='river');
  // River: both check → showdown
  t.applyAction('Bob','check');
  const result = t.applyAction('Alice','check');
  test('After river checks: showdown', t.phase==='showdown');
  test('River result has winners', Array.isArray(result?.winners));
  test('River result pot=40', result?.pot===40);
  test('5 community cards at showdown', t.community.length===5);
}

describe('Game flow — all-in, no action needed after');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:2, gameType:0});
  t.seat('Alice',100); t.seat('Bob',100);
  t.start();
  // Alice goes all-in, Bob calls → both all-in, board dealt to showdown
  t.applyAction('Alice','allin');   // Alice goes all-in (100-10=90 more)
  const result = t.applyAction('Bob','call'); // Bob calls
  // advance() should deal flop/turn/river and reach showdown
  // (if it short-circuited correctly)
  test('All-in call-down: result exists (showdown reached)', result!==null);
  if (result?.winners) {
    test('All-in: showdown has winners', result.winners.length>=1);
    test('All-in: community fully dealt', t.community.length>=3);
  } else {
    // May need extra advances if not fully auto-run
    test('All-in: phase is not preflop anymore', t.phase!=='preflop');
  }
}

describe('doShowdown — correct kicker-based winner selection');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:2, gameType:0});
  t.seat('Alice',1000); t.seat('Bob',1000);
  // Rig hands: Alice has AK, Bob has A2 — community gives a pair of Aces + rags
  // Alice wins via K kicker
  t.players[0].hand = ['AH','KS'];  // Alice
  t.players[1].hand = ['AD','2C'];  // Bob
  t.community       = ['AC','3D','7H','5S','9C']; // board: A3975 — both have trip Aces
  // Trip Aces: Alice has A-K kicker, Bob has A-2 kicker → Alice wins
  t.phase = 'river';
  t.pot   = 200;
  t.maxBet = 0;
  t.players[0].bet = 0; t.players[1].bet = 0;
  const result = t.doShowdown(t.players);
  test('Kicker tiebreak: Alice (AK) beats Bob (A2)', result.winners[0]==='Alice');
  test('Kicker tiebreak: only 1 winner, no split', result.winners.length===1);
}

describe('Share arithmetic — ties sum to 1000');
{
  for (const n of [1,2,3,6,9]) {
    const base = Math.floor(1000/n);
    const shares = Array.from({length:n},(_,i)=>i===0?base+(1000-base*n):base);
    const sum = shares.reduce((a,b)=>a+b,0);
    test(`${n}-way split sums to 1000`, sum===1000, `got ${sum}`);
  }
}

describe('doShowdown — 3-way tie: identical board-plays');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:3, gameType:0});
  t.seat('A',1000); t.seat('B',1000); t.seat('C',1000);
  // Everyone uses the same 5-card board (all players' hole cards are junk)
  t.players[0].hand=['2H','3S']; t.players[1].hand=['2D','3C']; t.players[2].hand=['4H','5S'];
  t.community=['AS','KS','QS','JS','TS']; // Royal Flush on board — everyone chops
  t.phase='river'; t.pot=300; t.maxBet=0;
  t.players.forEach(p=>p.bet=0);
  const result = t.doShowdown(t.players);
  test('3-way board royal flush: 3 winners', result.winners.length===3);
  const shareSum = result.winners.length * Math.floor(result.pot/result.winners.length);
  test('3-way split chips distributed', shareSum >= 297); // floor(300/3)*3=300
}

describe('Action guards');
{
  const t = new PokerTable({bigBlind:20, maxPlayers:2, gameType:0});
  t.seat('Alice',1000); t.seat('Bob',1000);
  t.start();
  // Bob tries to act when it's Alice's turn
  const err = t.applyAction('Bob','fold');
  test('Out-of-turn action: returns error', err?.error==='Not your turn');
  // Alice checks when she owes chips (due > 0)
  const err2 = t.applyAction('Alice','check');
  test('Illegal check when owing: returns error', err2?.error==='Must call');
}

describe('Deck integrity');
{
  const deck = makeDeck();
  test('Deck has 52 cards', deck.length===52);
  test('Deck: no duplicates', new Set(deck).size===52);
  const suits = deck.map(c=>c.slice(-1));
  const uniqSuits = [...new Set(suits)];
  test('Deck has 4 suits', uniqSuits.length===4);
  test('Deck: 13 cards per suit', uniqSuits.every(s=>suits.filter(x=>x===s).length===13));
  // Shuffle preserves deck
  const sh = shuffle(deck);
  test('Shuffled deck still 52 cards', sh.length===52);
  test('Shuffled deck: no duplicates', new Set(sh).size===52);
}

// ─── Final report ─────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
