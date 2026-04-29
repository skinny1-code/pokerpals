// src/games/omaha.js
// Omaha Hi — 4 hole cards, MUST use exactly 2 hole + exactly 3 community

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const RV = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));

export function evalFive(cs) {
  const v  = cs.map(c => RV[c.r]).sort((a,b)=>b-a);
  const ss = cs.map(c => c.s);
  const flush = ss.every(x => x===ss[0]);
  const uniq  = [...new Set(v)];
  const cnts  = uniq.map(x=>({x,n:v.filter(y=>y===x).length})).sort((a,b)=>b.n-a.n||b.x-a.x);
  const str   = uniq.length===5 && v[0]-v[4]===4;
  const wheel = uniq.length===5 && v[0]===14 && v[1]===5;
  if (flush&&str&&v[0]===14) return {r:9,n:"Royal Flush 🎰"};
  if (flush&&(str||wheel))   return {r:8,n:"Straight Flush"};
  if (cnts[0].n===4)         return {r:7,n:"Four of a Kind"};
  if (cnts[0].n===3&&cnts[1]?.n===2) return {r:6,n:"Full House"};
  if (flush)                 return {r:5,n:"Flush"};
  if (str||wheel)            return {r:4,n:"Straight"};
  if (cnts[0].n===3)         return {r:3,n:"Three of a Kind"};
  if (cnts[0].n===2&&cnts[1]?.n===2) return {r:2,n:"Two Pair"};
  if (cnts[0].n===2)         return {r:1,n:"One Pair"};
  return {r:0,n:`High Card`};
}

// All C(4,2)=6 hole pairs
function holePairs(hole) {
  const out = [];
  for (let i=0;i<hole.length-1;i++)
    for (let j=i+1;j<hole.length;j++) out.push([hole[i],hole[j]]);
  return out;
}

// All C(5,3)=10 community trips
function commTrips(comm) {
  const out = [];
  for (let i=0;i<comm.length-2;i++)
    for (let j=i+1;j<comm.length-1;j++)
      for (let k=j+1;k<comm.length;k++) out.push([comm[i],comm[j],comm[k]]);
  return out;
}

// Best Omaha hand — must use exactly 2+3
export function bestOmahaHand(hole, community) {
  if (hole.length < 2 || community.length < 3) return { r:0, n:"—" };
  let best = null;
  for (const hp of holePairs(hole))
    for (const ct of commTrips(community)) {
      const e = evalFive([...hp,...ct]);
      if (!best || e.r > best.r) best = { ...e, usedHole:hp, usedComm:ct };
    }
  return best;
}

// Deal Omaha: 4 hole cards per player
export function dealOmaha(playerCount) {
  const suits = ["♠","♥","♦","♣"];
  const deck  = suits.flatMap(s => RANKS.map(r => ({s,r,id:r+s+Math.random()})));
  const shuffled = [...deck].sort(()=>Math.random()-.5);
  const hands = [];
  for (let i=0;i<playerCount;i++) hands.push(shuffled.splice(0,4));
  return { hands, remaining: shuffled };
}

// Short Deck (36 cards — remove 2s through 5s)
export function makeShortDeck() {
  const shortRanks = ["6","7","8","9","10","J","Q","K","A"];
  return ["♠","♥","♦","♣"].flatMap(s => shortRanks.map(r => ({s,r,id:r+s+Math.random()})));
}

// Short deck hand ranks differ: flush > full house
export function evalShortDeck(cs) {
  const e = evalFive(cs);
  // Swap flush and full house
  if (e.r === 5) return {...e, r:6.5, n:"Flush (Short Deck)"};
  if (e.r === 6) return {...e, r:5.5, n:"Full House (Short Deck)"};
  return e;
}

// Pineapple OFC scoring (simplified — open face chinese)
// Players lay 13 cards face up: 3 top / 5 middle / 5 bottom
// Bottom must beat middle must beat top (or foul)
export function scoreOFCHand(top3, mid5, bot5) {
  const t = evalFive(top3.concat({ s:"♠",r:"2"},{s:"♥",r:"2" })); // pad to 5 for eval
  const m = evalFive(mid5);
  const b = evalFive(bot5);

  const foul = b.r < m.r || m.r < t.r;
  if (foul) return { foul:true, score:-6, breakdown:"FOUL — hand doesn't qualify" };

  let score = 0;
  // Royalty bonuses (simplified)
  const royalties = [
    { hand: b, label:"bottom", bonus:[0,0,0,0,2,4,6,10,15,25] },
    { hand: m, label:"middle", bonus:[0,0,0,2,4,8,12,20,30,50] },
    { hand: t, label:"top",    bonus:[0,0,0,0,0,0,0, 0, 0, 0] },
  ];
  const breakdown = royalties.map(({hand,label,bonus})=>{
    const b2 = bonus[hand.r] || 0;
    score += b2;
    return `${label}: ${hand.n}${b2>0?` (+${b2})`:''}`;
  });

  return { foul:false, score, breakdown: breakdown.join(' | ') };
}
