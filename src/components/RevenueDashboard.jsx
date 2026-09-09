// src/components/RevenueDashboard.jsx
// Owner-only revenue dashboard — reads live onchain data via wagmi

import { useState, useEffect } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";

const ESCROW_ADDR     = process.env.NEXT_PUBLIC_ESCROW;
const TOURN_ADDR      = process.env.NEXT_PUBLIC_TOURNAMENT;
const STAKING_ADDR    = process.env.NEXT_PUBLIC_STAKING;
const REFERRAL_ADDR   = process.env.NEXT_PUBLIC_REFERRAL;
const KINGS_POOL_ADDR = process.env.NEXT_PUBLIC_KINGS_POOL;
const PROMO_POOL_ADDR = process.env.NEXT_PUBLIC_PROMOTIONS_POOL;
const STABLE_POOL_ADDR = process.env.NEXT_PUBLIC_STABLECOIN_POOL;
const LIQ_POOL_ADDR   = process.env.NEXT_PUBLIC_LIQUIDITY_POOL;
const CHIPS_ADDR      = process.env.NEXT_PUBLIC_CHIPS_TOKEN;

const ESCROW_ABI = [
  { name:"getRevenueSummary", type:"function", stateMutability:"view",
    inputs:[], outputs:[
      {name:"rake",type:"uint256"},{name:"burned",type:"uint256"},
      {name:"toStaking",type:"uint256"},{name:"seats",type:"uint256"},
      {name:"refs",type:"uint256"},{name:"total",type:"uint256"}
    ]},
  { name:"tierRakeNum",   type:"function", stateMutability:"view", inputs:[{type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"seatFeeCHIPS",  type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"tableCount",    type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
];
const TOURN_ABI = [
  { name:"getRevenue",      type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"tournamentCount", type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"tournamentRake",  type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
];
const STAKING_ABI = [
  { name:"totalStaked", type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { name:"getTierStats", type:"function", stateMutability:"view", inputs:[],
    outputs:[{type:"uint256[5]"},{type:"uint256[5]"},{type:"uint256[5]"}] },
];
const REFERRAL_ABI = [
  { name:"getLeaderboard", type:"function", stateMutability:"view", inputs:[],
    outputs:[{type:"address[10]"},{type:"uint256[10]"},{type:"uint256[10]"}] },
];

const BALANCE_ABI = [
  { name:"balanceOf", type:"function", stateMutability:"view",
    inputs:[{name:"account",type:"address"}], outputs:[{type:"uint256"}] },
];
const USDC_BALANCE_ABI = [
  { name:"balanceOf", type:"function", stateMutability:"view",
    inputs:[{name:"account",type:"address"}], outputs:[{type:"uint256"}] },
];
const STAKING_YIELD_ABI = [
  { name:"yieldPool", type:"function", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
];

const fmt   = n  => typeof n === 'bigint' ? Number(formatUnits(n, 18)).toLocaleString(undefined,{maximumFractionDigits:1}) : n;
const chips = n  => `◈ ${fmt(n)} SALOON`;
const gold  = '#c9b075';
const green = '#4caf50';

function StatCard({ label, value, sub, color = gold, icon }) {
  return (
    <div style={{
      background:'#0d0d0f88', border:`1px solid ${color}22`,
      borderRadius:10, padding:'16px 18px', minWidth:140,
    }}>
      <div style={{fontSize:10,color:'#57544b',letterSpacing:2,marginBottom:6}}>{icon} {label}</div>
      <div style={{fontSize:22,fontWeight:700,color,fontFamily:'monospace',letterSpacing:.5}}>{value}</div>
      {sub && <div style={{fontSize:10,color:'#42424a',marginTop:4}}>{sub}</div>}
    </div>
  );
}

function Bar({ label, value, max, color = gold }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
        <span style={{fontSize:11,color:'#847e71'}}>{label}</span>
        <span style={{fontSize:11,color,fontFamily:'monospace'}}>{fmt(value)} SALOON</span>
      </div>
      <div style={{height:4,background:'#111114',borderRadius:2}}>
        <div style={{height:'100%',width:`${pct}%`,background:`linear-gradient(90deg,${color}66,${color})`,borderRadius:2,transition:'width .5s'}}/>
      </div>
    </div>
  );
}

export default function RevenueDashboard({ address: ownerAddr }) {
  const [tab, setTab] = useState('overview');

  // ─── ON-CHAIN READS ───────────────────────────────────────────────────────
  const { data: escrowSummary } = useReadContract({
    address: ESCROW_ADDR, abi: ESCROW_ABI, functionName: 'getRevenueSummary',
    query: { refetchInterval: 15000 },
  });
  const { data: tournRevenue } = useReadContract({
    address: TOURN_ADDR, abi: TOURN_ABI, functionName: 'getRevenue',
    query: { refetchInterval: 15000 },
  });
  const { data: tournCount } = useReadContract({
    address: TOURN_ADDR, abi: TOURN_ABI, functionName: 'tournamentCount',
  });
  const { data: totalStaked } = useReadContract({
    address: STAKING_ADDR, abi: STAKING_ABI, functionName: 'totalStaked',
    query: { refetchInterval: 30000 },
  });
  const { data: tierStats } = useReadContract({
    address: STAKING_ADDR, abi: STAKING_ABI, functionName: 'getTierStats',
    query: { refetchInterval: 30000 },
  });
  const { data: leaderboard } = useReadContract({
    address: REFERRAL_ADDR, abi: REFERRAL_ABI, functionName: 'getLeaderboard',
    query: { refetchInterval: 30000 },
  });
  const { data: tableCount } = useReadContract({
    address: ESCROW_ADDR, abi: ESCROW_ABI, functionName: 'tableCount',
  });
  const { data: seatFee } = useReadContract({
    address: ESCROW_ADDR, abi: ESCROW_ABI, functionName: 'seatFeeCHIPS',
  });

  // Pool balances
  const { data: kingsBalance }  = useReadContracts({ contracts: [
    { address: CHIPS_ADDR, abi: BALANCE_ABI, functionName: 'balanceOf', args: [KINGS_POOL_ADDR] },
  ], query: { refetchInterval: 30000 } });
  const { data: promoBalance }  = useReadContracts({ contracts: [
    { address: CHIPS_ADDR, abi: BALANCE_ABI, functionName: 'balanceOf', args: [PROMO_POOL_ADDR] },
  ], query: { refetchInterval: 30000 } });
  const { data: liqBalance }    = useReadContracts({ contracts: [
    { address: CHIPS_ADDR, abi: BALANCE_ABI, functionName: 'balanceOf', args: [LIQ_POOL_ADDR] },
  ], query: { refetchInterval: 30000 } });
  const { data: stableBalance } = useReadContracts({ contracts: [
    { address: STABLE_POOL_ADDR, abi: USDC_BALANCE_ABI, functionName: 'balanceOf', args: [STABLE_POOL_ADDR] },
  ], query: { refetchInterval: 30000 } });
  const { data: stakingYield } = useReadContract({
    address: STAKING_ADDR, abi: STAKING_YIELD_ABI, functionName: 'yieldPool',
    query: { refetchInterval: 30000 },
  });

  const rake      = escrowSummary?.[0] || 0n;
  const seats     = escrowSummary?.[3] || 0n;
  const refs      = escrowSummary?.[4] || 0n;
  const cashTotal = rake + seats + (tournRevenue || 0n);

  const kingsChips  = kingsBalance?.[0]?.result  || 0n;
  const promoChips  = promoBalance?.[0]?.result  || 0n;
  const liqChips    = liqBalance?.[0]?.result    || 0n;
  const stableUsdc  = stableBalance?.[0]?.result || 0n;
  const stakingPool = stakingYield || 0n;

  const TIERS = ['Standard','Bronze','Silver','Gold','Whale'];
  const TIER_COLORS = ['#645f54','#cd7f32','#aaa','#d9c08a','#00e5ff'];

  const TABS = ['overview','streams','pools','staking','referrals'];

  return (
    <div style={{
      background:'#080809', color:'#ddd4b8', minHeight:'100vh',
      fontFamily:"'Book Antiqua','Palatino Linotype',serif",
    }}>
      <style>{`@keyframes ppulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Header */}
      <div style={{background:'#0d0d0e88',borderBottom:'1px solid #1c1c1f',padding:'14px 20px',
        display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontSize:18,color:gold,fontWeight:700,letterSpacing:2}}>♠ Revenue Dashboard</div>
          <div style={{fontSize:10,color:'#57544b',letterSpacing:3}}>POKERVSPLAYER™ OPERATOR VIEW</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:green,
            boxShadow:`0 0 6px ${green}`,animation:'ppulse 2s infinite'}}/>
          <span style={{fontSize:10,color:green,fontFamily:'monospace'}}>LIVE</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,padding:'12px 20px',borderBottom:'1px solid #19191c',overflowX:'auto'}}>
        {TABS.map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            background:tab===t?'#121215':'transparent',
            border:`1px solid ${tab===t?gold+'44':'#1a1a1f'}`,
            color:tab===t?gold:'#645f54', padding:'6px 16px', borderRadius:6,
            fontSize:11, fontWeight:700, letterSpacing:1, cursor:'pointer',
            textTransform:'uppercase', fontFamily:'inherit',
          }}>{t}</button>
        ))}
      </div>

      <div style={{maxWidth:900,margin:'0 auto',padding:'16px 16px'}}>

        {/* ── OVERVIEW ── */}
        {tab==='overview' && (
          <>
            {/* KPI row */}
            <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
              <StatCard icon="◈" label="TOTAL REVENUE"     value={chips(cashTotal)}  color={gold}  sub="Rake + seats + tournaments"/>
              <StatCard icon="♠" label="CASH GAME RAKE"    value={chips(rake)}       color={gold}  sub={`${Number(tableCount)||0} tables lifetime`}/>
              <StatCard icon="🪑" label="SEAT FEES"         value={chips(seats)}      color='#29b6f6' sub={seatFee?`${fmt(seatFee)} SALOON/seat`:''}/>
              <StatCard icon="🏆" label="TOURNAMENT RAKE"   value={chips(tournRevenue||0n)} color='#ff9800' sub={`${Number(tournCount)||0} tournaments`}/>
              <StatCard icon="👥" label="REFERRAL PAYOUTS"  value={chips(refs)}       color='#ab47bc' sub="20% of rake to referrers"/>
            </div>

            {/* Revenue timeline (simulated — wire to Alchemy events in prod) */}
            <div style={{background:'#0d0d0f88',border:'1px solid #191920',borderRadius:10,
              padding:'16px 18px',marginBottom:16}}>
              <div style={{fontSize:10,color:'#57544b',letterSpacing:2,marginBottom:14}}>REVENUE BREAKDOWN</div>
              <Bar label="Cash Game Rake (1.5%)" value={rake} max={cashTotal} color={gold}/>
              <Bar label="Seat Fees (2 SALOON/seat)" value={seats} max={cashTotal} color='#29b6f6'/>
              <Bar label="Tournament Rake (10%)" value={tournRevenue||0n} max={cashTotal} color='#ff9800'/>
            </div>

            {/* Revenue stream math */}
            <div style={{background:'#0d0d0f88',border:'1px solid #191920',borderRadius:10,
              padding:'16px 18px'}}>
              <div style={{fontSize:10,color:'#57544b',letterSpacing:2,marginBottom:14}}>PROJECTED EARNINGS</div>
              {[
                ['50 tables × 30 hands/hr × avg 1k SALOON pot × 1.5%', '22,500 SALOON/hr'],
                ['50 tables × 5 players × 2 SALOON seat fee',           '500 SALOON/hr'],
                ['1 daily tournament × 100 players × 100 SALOON × 10%', '1,000 SALOON/day'],
                ['SALOON token appreciation (500M float)',               'variable'],
              ].map(([calc,val])=>(
                <div key={calc} style={{display:'flex',justifyContent:'space-between',
                  padding:'7px 0',borderBottom:'1px solid #111114',gap:12}}>
                  <span style={{fontSize:11,color:'#645f54'}}>{calc}</span>
                  <span style={{fontSize:11,color:gold,fontFamily:'monospace',flexShrink:0}}>{val}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── REVENUE STREAMS ── */}
        {tab==='streams' && (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {[
              { icon:'♠', title:'Cash Game Rake', color:gold,
                lines:[
                  ['Rate','Standard 1.5% → Whale 0.6%'],
                  ['Cap','50 SALOON per pot max'],
                  ['When','Every hand settled via PokerEscrow.settle()'],
                  ['Contract','PokerEscrow.sol → tierRakeNum[]'],
                ]},
              { icon:'🪑', title:'Seat Fees', color:'#29b6f6',
                lines:[
                  ['Rate','2 SALOON per buy-in, 1 SALOON per rebuy'],
                  ['When','Charged at buyIn() + rebuy() calls'],
                  ['Note','Instant transfer to rakeRecipient — never in escrow'],
                  ['Tune','escrow.setRakeParams() — owner only'],
                ]},
              { icon:'🏆', title:'Tournaments', color:'#ff9800',
                lines:[
                  ['Rate','10% of entry pool (up to 15% max)'],
                  ['When','TournamentManager.startTournament()'],
                  ['Types','Scheduled, Sit-n-Go, Guaranteed Prize'],
                  ['Example','100 players × 100 SALOON = 1,000 SALOON rake'],
                ]},
              { icon:'💎', title:'VIP Staking', color:'#ab47bc',
                lines:[
                  ['Bronze 1k SALOON','1.3% rake + 2% APR yield'],
                  ['Silver 10k SALOON','1.1% rake + 4% APR yield'],
                  ['Gold 50k SALOON', '0.9% rake + 7% APR yield'],
                  ['Whale 200k SALOON','0.6% rake + 12% APR yield'],
                  ['Yield source','Funded from rake via fundYieldPool()'],
                ]},
              { icon:'👥', title:'Referrals', color:'#4caf50',
                lines:[
                  ['Split','20% of rake on every referred player hand'],
                  ['L2','Referrer-of-referrer gets 5% of that 20%'],
                  ['Net cost','~1.2% from your rake — drives free user acquisition'],
                  ['Code','keccak(address)[0:8] — shareable link'],
                ]},
              { icon:'◈', title:'SALOON Token Float', color:'#00e5ff',
                lines:[
                  ['Your allocation','500M SALOON liquidity'],
                  ['Demand driver','Every buy-in requires SALOON — continuous buy pressure'],
                  ['LP fees','Seed Uniswap/Camelot pool — earn 0.3% of all swaps'],
                  ['Governance','Lock SALOON for voting rights → future feature'],
                ]},
            ].map(({icon,title,color,lines})=>(
              <div key={title} style={{background:'#0d0d0f88',border:`1px solid ${color}22`,
                borderRadius:10,padding:'14px 18px'}}>
                <div style={{fontSize:13,color,fontWeight:700,marginBottom:12}}>{icon} {title}</div>
                {lines.map(([k,v])=>(
                  <div key={k} style={{display:'flex',gap:12,padding:'5px 0',
                    borderBottom:'1px solid #111114',justifyContent:'space-between'}}>
                    <span style={{fontSize:10,color:'#57544b',letterSpacing:.5,flexShrink:0}}>{k}</span>
                    <span style={{fontSize:11,color:'#9a9280',textAlign:'right'}}>{v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── POOLS ── */}
        {tab==='pools' && (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
              <StatCard icon="♠" label="KING OF SPADES POOL" value={chips(kingsChips)}
                sub="Ops expenses (100M seeded + 10% rake)" color='#c9b075'/>
              <StatCard icon="🎯" label="PROMOTIONS POOL" value={chips(promoChips)}
                sub="Contests, airdrops, tournaments" color='#ab47bc'/>
              <StatCard icon="💎" label="SALOON LIQUIDITY POOL" value={chips(liqChips)}
                sub="500M SALOON for buy/sell at $0.001/CHIP" color='#4caf50'/>
              <StatCard icon="💵" label="STABLECOIN POOL" value={`$${fmt(stableUsdc * 10n**12n)}`}
                sub="USDC reserve for on-network payouts" color='#29b6f6'/>
              <StatCard icon="⛏" label="STAKING YIELD POOL" value={chips(stakingPool)}
                sub="200M seeded + 45% rake — earns APR for stakers" color='#ab47bc'/>
            </div>
            <div style={{background:'#0d0d0f88',border:'1px solid #191920',borderRadius:10,
              padding:'16px 18px',marginTop:4}}>
              <div style={{fontSize:10,color:'#57544b',letterSpacing:2,marginBottom:12}}>RAKE FLOW</div>
              <Bar label="Burn (15%)"              value={escrowSummary?.[1]||0n} max={rake||1n} color='#ef5350'/>
              <Bar label="Staking yield (45%)"     value={escrowSummary?.[2]||0n} max={rake||1n} color='#ab47bc'/>
              <Bar label="King of Spades (10%)"    value={(rake * 1000n / 10000n)} max={rake||1n} color='#c9b075'/>
              <Bar label="Treasury — owner (20%)"  value={(rake * 2000n / 10000n)} max={rake||1n} color='#4caf50'/>
              <Bar label="Referrals (10%)"         value={escrowSummary?.[4]||0n} max={rake||1n} color='#29b6f6'/>
            </div>
          </div>
        )}

        {/* ── STAKING ── */}
        {tab==='staking' && (
          <>
            <StatCard icon="⛏" label="TOTAL SALOON STAKED" value={chips(totalStaked||0n)} color='#ab47bc'
              sub="Locked by VIP players"/>
            <div style={{height:12}}/>
            <div style={{background:'#0d0d0f88',border:'1px solid #191920',borderRadius:10,
              padding:'16px 18px'}}>
              <div style={{fontSize:10,color:'#57544b',letterSpacing:2,marginBottom:14}}>TIER DISTRIBUTION</div>
              {TIERS.map((name,i)=>{
                const count = tierStats?.[2]?.[i] || 0n;
                const apr   = tierStats?.[1]?.[i] || 0n;
                const thresh = tierStats?.[0]?.[i] || 0n;
                return (
                  <div key={name} style={{display:'flex',alignItems:'center',gap:12,
                    padding:'10px 0',borderBottom:'1px solid #111114',flexWrap:'wrap',gap:8}}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:TIER_COLORS[i],flexShrink:0}}/>
                    <div style={{flex:1,minWidth:80}}>
                      <div style={{fontSize:12,color:TIER_COLORS[i],fontWeight:700}}>{name}</div>
                      <div style={{fontSize:9,color:'#42424a'}}>≥ {fmt(thresh)} SALOON · {Number(apr)/100}% APR</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,color:'#9a9280',fontFamily:'monospace'}}>{fmt(count)}</div>
                      <div style={{fontSize:9,color:'#42424a'}}>SALOON locked</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── REFERRALS ── */}
        {tab==='referrals' && (
          <div style={{background:'#0d0d0f88',border:'1px solid #191920',borderRadius:10,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#57544b',letterSpacing:2,marginBottom:14}}>TOP REFERRERS</div>
            {(leaderboard?.[0]||Array(10).fill(null)).map((addr,i)=>{
              const earned   = leaderboard?.[1]?.[i] || 0n;
              const referred = leaderboard?.[2]?.[i] || 0n;
              if (!addr || addr === '0x0000000000000000000000000000000000000000') return null;
              return (
                <div key={i} style={{display:'flex',alignItems:'center',gap:12,
                  padding:'10px 0',borderBottom:'1px solid #111114'}}>
                  <div style={{width:24,height:24,borderRadius:'50%',background:'#121215',
                    border:`1px solid ${i===0?gold:i===1?'#aaa':i===2?'#cd7f32':'#232327'}`,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:11,color:i===0?gold:'#645f54',fontWeight:700,flexShrink:0}}>
                    {i+1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:'#b0a890',fontFamily:'monospace'}}>
                      {addr.slice(0,8)}…{addr.slice(-6)}
                    </div>
                    <div style={{fontSize:9,color:'#42424a'}}>{Number(referred)} players referred</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:12,color:gold,fontFamily:'monospace'}}>◈ {fmt(earned)}</div>
                    <div style={{fontSize:9,color:'#42424a'}}>SALOON earned</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
