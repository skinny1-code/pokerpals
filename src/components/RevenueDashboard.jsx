// src/components/RevenueDashboard.jsx
// Owner-only revenue dashboard — reads live onchain data via wagmi

import { useState, useEffect } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";

const ESCROW_ADDR   = process.env.NEXT_PUBLIC_ESCROW;
const TOURN_ADDR    = process.env.NEXT_PUBLIC_TOURNAMENT;
const STAKING_ADDR  = process.env.NEXT_PUBLIC_STAKING;
const REFERRAL_ADDR = process.env.NEXT_PUBLIC_REFERRAL;

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

const fmt   = n  => typeof n === 'bigint' ? Number(formatUnits(n, 18)).toLocaleString(undefined,{maximumFractionDigits:1}) : n;
const chips = n  => `◈ ${fmt(n)} CHIPS`;
const gold  = '#d4af37';
const green = '#4caf50';

function StatCard({ label, value, sub, color = gold, icon }) {
  return (
    <div style={{
      background:'#08140888', border:`1px solid ${color}22`,
      borderRadius:10, padding:'16px 18px', minWidth:140,
    }}>
      <div style={{fontSize:10,color:'#3a6a3a',letterSpacing:2,marginBottom:6}}>{icon} {label}</div>
      <div style={{fontSize:22,fontWeight:700,color,fontFamily:'monospace',letterSpacing:.5}}>{value}</div>
      {sub && <div style={{fontSize:10,color:'#3a5a3a',marginTop:4}}>{sub}</div>}
    </div>
  );
}

function Bar({ label, value, max, color = gold }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
        <span style={{fontSize:11,color:'#6a8a6a'}}>{label}</span>
        <span style={{fontSize:11,color,fontFamily:'monospace'}}>{fmt(value)} CHIPS</span>
      </div>
      <div style={{height:4,background:'#0d1a0d',borderRadius:2}}>
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

  const rake      = escrowSummary?.[0] || 0n;
  const seats     = escrowSummary?.[3] || 0n;
  const refs      = escrowSummary?.[4] || 0n;
  const cashTotal = rake + seats + (tournRevenue || 0n);

  const TIERS = ['Standard','Bronze','Silver','Gold','Whale'];
  const TIER_COLORS = ['#4a7a4a','#cd7f32','#aaa','#ffd700','#00e5ff'];

  const TABS = ['overview','streams','staking','referrals'];

  return (
    <div style={{
      background:'#040a04', color:'#ddd4b8', minHeight:'100vh',
      fontFamily:"'Book Antiqua','Palatino Linotype',serif",
    }}>
      <style>{`@keyframes ppulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Header */}
      <div style={{background:'#06100688',borderBottom:'1px solid #122012',padding:'14px 20px',
        display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontSize:18,color:gold,fontWeight:700,letterSpacing:2}}>♠ Revenue Dashboard</div>
          <div style={{fontSize:10,color:'#3a6a3a',letterSpacing:3}}>POKERVSPLAYER™ OPERATOR VIEW</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:green,
            boxShadow:`0 0 6px ${green}`,animation:'ppulse 2s infinite'}}/>
          <span style={{fontSize:10,color:green,fontFamily:'monospace'}}>LIVE</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,padding:'12px 20px',borderBottom:'1px solid #0e1e0e',overflowX:'auto'}}>
        {TABS.map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            background:tab===t?'#0c1e0c':'transparent',
            border:`1px solid ${tab===t?gold+'44':'#1a2a1a'}`,
            color:tab===t?gold:'#4a7a4a', padding:'6px 16px', borderRadius:6,
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
              <StatCard icon="🪑" label="SEAT FEES"         value={chips(seats)}      color='#29b6f6' sub={seatFee?`${fmt(seatFee)} CHIPS/seat`:''}/>
              <StatCard icon="🏆" label="TOURNAMENT RAKE"   value={chips(tournRevenue||0n)} color='#ff9800' sub={`${Number(tournCount)||0} tournaments`}/>
              <StatCard icon="👥" label="REFERRAL PAYOUTS"  value={chips(refs)}       color='#ab47bc' sub="20% of rake to referrers"/>
            </div>

            {/* Revenue timeline (simulated — wire to Alchemy events in prod) */}
            <div style={{background:'#08140888',border:'1px solid #162a16',borderRadius:10,
              padding:'16px 18px',marginBottom:16}}>
              <div style={{fontSize:10,color:'#3a6a3a',letterSpacing:2,marginBottom:14}}>REVENUE BREAKDOWN</div>
              <Bar label="Cash Game Rake (1.5%)" value={rake} max={cashTotal} color={gold}/>
              <Bar label="Seat Fees (2 CHIPS/seat)" value={seats} max={cashTotal} color='#29b6f6'/>
              <Bar label="Tournament Rake (10%)" value={tournRevenue||0n} max={cashTotal} color='#ff9800'/>
            </div>

            {/* Revenue stream math */}
            <div style={{background:'#08140888',border:'1px solid #162a16',borderRadius:10,
              padding:'16px 18px'}}>
              <div style={{fontSize:10,color:'#3a6a3a',letterSpacing:2,marginBottom:14}}>PROJECTED EARNINGS</div>
              {[
                ['50 tables × 30 hands/hr × avg 1k CHIPS pot × 1.5%', '22,500 CHIPS/hr'],
                ['50 tables × 5 players × 2 CHIPS seat fee',           '500 CHIPS/hr'],
                ['1 daily tournament × 100 players × 100 CHIPS × 10%', '1,000 CHIPS/day'],
                ['CHIPS token appreciation (500M float)',               'variable'],
              ].map(([calc,val])=>(
                <div key={calc} style={{display:'flex',justifyContent:'space-between',
                  padding:'7px 0',borderBottom:'1px solid #0d1a0d',gap:12}}>
                  <span style={{fontSize:11,color:'#4a7a4a'}}>{calc}</span>
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
                  ['Cap','50 CHIPS per pot max'],
                  ['When','Every hand settled via PokerEscrow.settle()'],
                  ['Contract','PokerEscrow.sol → tierRakeNum[]'],
                ]},
              { icon:'🪑', title:'Seat Fees', color:'#29b6f6',
                lines:[
                  ['Rate','2 CHIPS per buy-in, 1 CHIPS per rebuy'],
                  ['When','Charged at buyIn() + rebuy() calls'],
                  ['Note','Instant transfer to rakeRecipient — never in escrow'],
                  ['Tune','escrow.setRakeParams() — owner only'],
                ]},
              { icon:'🏆', title:'Tournaments', color:'#ff9800',
                lines:[
                  ['Rate','10% of entry pool (up to 15% max)'],
                  ['When','TournamentManager.startTournament()'],
                  ['Types','Scheduled, Sit-n-Go, Guaranteed Prize'],
                  ['Example','100 players × 100 CHIPS = 1,000 CHIPS rake'],
                ]},
              { icon:'💎', title:'VIP Staking', color:'#ab47bc',
                lines:[
                  ['Bronze 1k CHIPS','1.3% rake + 2% APR yield'],
                  ['Silver 10k CHIPS','1.1% rake + 4% APR yield'],
                  ['Gold 50k CHIPS', '0.9% rake + 7% APR yield'],
                  ['Whale 200k CHIPS','0.6% rake + 12% APR yield'],
                  ['Yield source','Funded from rake via fundYieldPool()'],
                ]},
              { icon:'👥', title:'Referrals', color:'#4caf50',
                lines:[
                  ['Split','20% of rake on every referred player hand'],
                  ['L2','Referrer-of-referrer gets 5% of that 20%'],
                  ['Net cost','~1.2% from your rake — drives free user acquisition'],
                  ['Code','keccak(address)[0:8] — shareable link'],
                ]},
              { icon:'◈', title:'CHIPS Token Float', color:'#00e5ff',
                lines:[
                  ['Your allocation','500M CHIPS liquidity'],
                  ['Demand driver','Every buy-in requires CHIPS — continuous buy pressure'],
                  ['LP fees','Seed Uniswap/Camelot pool — earn 0.3% of all swaps'],
                  ['Governance','Lock CHIPS for voting rights → future feature'],
                ]},
            ].map(({icon,title,color,lines})=>(
              <div key={title} style={{background:'#08140888',border:`1px solid ${color}22`,
                borderRadius:10,padding:'14px 18px'}}>
                <div style={{fontSize:13,color,fontWeight:700,marginBottom:12}}>{icon} {title}</div>
                {lines.map(([k,v])=>(
                  <div key={k} style={{display:'flex',gap:12,padding:'5px 0',
                    borderBottom:'1px solid #0d1a0d',justifyContent:'space-between'}}>
                    <span style={{fontSize:10,color:'#3a6a3a',letterSpacing:.5,flexShrink:0}}>{k}</span>
                    <span style={{fontSize:11,color:'#8aaa6a',textAlign:'right'}}>{v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── STAKING ── */}
        {tab==='staking' && (
          <>
            <StatCard icon="⛏" label="TOTAL CHIPS STAKED" value={chips(totalStaked||0n)} color='#ab47bc'
              sub="Locked by VIP players"/>
            <div style={{height:12}}/>
            <div style={{background:'#08140888',border:'1px solid #162a16',borderRadius:10,
              padding:'16px 18px'}}>
              <div style={{fontSize:10,color:'#3a6a3a',letterSpacing:2,marginBottom:14}}>TIER DISTRIBUTION</div>
              {TIERS.map((name,i)=>{
                const count = tierStats?.[2]?.[i] || 0n;
                const apr   = tierStats?.[1]?.[i] || 0n;
                const thresh = tierStats?.[0]?.[i] || 0n;
                return (
                  <div key={name} style={{display:'flex',alignItems:'center',gap:12,
                    padding:'10px 0',borderBottom:'1px solid #0d1a0d',flexWrap:'wrap',gap:8}}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:TIER_COLORS[i],flexShrink:0}}/>
                    <div style={{flex:1,minWidth:80}}>
                      <div style={{fontSize:12,color:TIER_COLORS[i],fontWeight:700}}>{name}</div>
                      <div style={{fontSize:9,color:'#3a5a3a'}}>≥ {fmt(thresh)} CHIPS · {Number(apr)/100}% APR</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,color:'#8aaa6a',fontFamily:'monospace'}}>{fmt(count)}</div>
                      <div style={{fontSize:9,color:'#3a5a3a'}}>CHIPS locked</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── REFERRALS ── */}
        {tab==='referrals' && (
          <div style={{background:'#08140888',border:'1px solid #162a16',borderRadius:10,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'#3a6a3a',letterSpacing:2,marginBottom:14}}>TOP REFERRERS</div>
            {(leaderboard?.[0]||Array(10).fill(null)).map((addr,i)=>{
              const earned   = leaderboard?.[1]?.[i] || 0n;
              const referred = leaderboard?.[2]?.[i] || 0n;
              if (!addr || addr === '0x0000000000000000000000000000000000000000') return null;
              return (
                <div key={i} style={{display:'flex',alignItems:'center',gap:12,
                  padding:'10px 0',borderBottom:'1px solid #0d1a0d'}}>
                  <div style={{width:24,height:24,borderRadius:'50%',background:'#0c1e0c',
                    border:`1px solid ${i===0?gold:i===1?'#aaa':i===2?'#cd7f32':'#1a3a1a'}`,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:11,color:i===0?gold:'#4a7a4a',fontWeight:700,flexShrink:0}}>
                    {i+1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:'#a8c888',fontFamily:'monospace'}}>
                      {addr.slice(0,8)}…{addr.slice(-6)}
                    </div>
                    <div style={{fontSize:9,color:'#3a5a3a'}}>{Number(referred)} players referred</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:12,color:gold,fontFamily:'monospace'}}>◈ {fmt(earned)}</div>
                    <div style={{fontSize:9,color:'#3a5a3a'}}>CHIPS earned</div>
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
