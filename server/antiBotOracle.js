// server/antiBotOracle.js
// Standalone service — monitors blockchain + Gitcoin Passport + behavioral signals
// Calls PokerEscrow.markHuman() when a player passes all checks

import { ethers } from "ethers";
import fetch from "node-fetch";

const RPC_URL        = process.env.RPC_URL;
const OPERATOR_KEY   = process.env.OPERATOR_PRIVATE_KEY;
const ESCROW_ADDR    = process.env.ESCROW_ADDRESS;
const PASSPORT_API   = process.env.GITCOIN_PASSPORT_API;
const SCORER_ID      = process.env.GITCOIN_SCORER_ID;
const ALCHEMY_API    = process.env.ALCHEMY_API_KEY;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(OPERATOR_KEY, provider);

const ESCROW_ABI = [
  "function markHuman(address player, bool status) external",
  "event HumanVerified(address indexed player, bool status)",
];
const escrow = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, signer);

// ─── CHECKS ───────────────────────────────────────────────────────────────────

// 1. On-chain activity (via Alchemy API)
async function checkOnChainActivity(address) {
  const url = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API}`;
  const body = JSON.stringify({
    jsonrpc:"2.0", id:1, method:"alchemy_getAssetTransfers",
    params:[{ fromAddress:address, category:["external","erc20"], withMetadata:true, maxCount:"0x64" }]
  });
  const res  = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body });
  const data = await res.json();
  const transfers = data?.result?.transfers || [];

  if (transfers.length < 50) return { pass:false, reason:`Only ${transfers.length} txs (need 50+)` };

  // Check wallet age — first tx timestamp
  const oldest = transfers[transfers.length-1];
  const firstTs = new Date(oldest?.metadata?.blockTimestamp).getTime();
  const ageDays = (Date.now() - firstTs) / 86400000;
  if (ageDays < 30) return { pass:false, reason:`Wallet only ${ageDays.toFixed(0)} days old (need 30+)` };

  return { pass:true, txCount:transfers.length, ageDays:ageDays.toFixed(0) };
}

// 2. Gitcoin Passport score
async function checkPassportScore(address) {
  try {
    // Submit passport for scoring
    await fetch(`https://api.scorer.gitcoin.co/registry/submit-passport`, {
      method:"POST",
      headers:{ "X-API-KEY":PASSPORT_API, "Content-Type":"application/json" },
      body: JSON.stringify({ address, scorer_id: SCORER_ID })
    });
    await new Promise(r => setTimeout(r, 2000)); // wait for indexing

    const res  = await fetch(`https://api.scorer.gitcoin.co/registry/score/${SCORER_ID}/${address}`,
      { headers:{ "X-API-KEY":PASSPORT_API } });
    const data = await res.json();
    const score = parseFloat(data?.score || 0);

    return {
      pass: score >= 15,
      score,
      reason: score < 15 ? `Passport score ${score} < 15 required` : undefined
    };
  } catch (e) {
    return { pass:false, reason:"Passport check failed: "+e.message };
  }
}

// 3. Contract interaction diversity (degens touch multiple contracts, bots repeat same calls)
async function checkContractDiversity(address) {
  // Simplified: check token interactions via Alchemy token balances
  const url = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API}`;
  const body = JSON.stringify({
    jsonrpc:"2.0", id:1, method:"alchemy_getTokenBalances",
    params:[address, "erc20"]
  });
  const res  = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body });
  const data = await res.json();
  const tokenCount = data?.result?.tokenBalances?.length || 0;

  return {
    pass: tokenCount >= 3,
    reason: tokenCount < 3 ? `Only ${tokenCount} token interactions (need 3+)` : undefined,
    tokenCount,
  };
}

// ─── MASTER VERIFY ───────────────────────────────────────────────────────────
export async function fullVerify(address) {
  console.log(`[AntiBot] Verifying ${address}`);
  const results = {};

  // Run all checks in parallel
  const [activity, passport, diversity] = await Promise.all([
    checkOnChainActivity(address),
    checkPassportScore(address),
    checkContractDiversity(address),
  ]);

  results.activity  = activity;
  results.passport  = passport;
  results.diversity = diversity;

  const pass = activity.pass && passport.pass && diversity.pass;
  const failures = [activity, passport, diversity]
    .filter(r => !r.pass).map(r => r.reason);

  if (pass) {
    // Mark human on-chain
    const tx = await escrow.markHuman(address, true);
    await tx.wait();
    results.txHash = tx.hash;
    console.log(`[AntiBot] ✅ ${address} verified — tx: ${tx.hash}`);
  } else {
    console.log(`[AntiBot] ❌ ${address} FAILED — ${failures.join(', ')}`);
  }

  return { pass, failures, details: results };
}

// ─── BEHAVIORAL ANALYSIS ─────────────────────────────────────────────────────
// Tracks action timing and patterns during play — called by game server
export class BehaviorMonitor {
  constructor() {
    this.sessions = new Map(); // address => { actions:[], flagged:bool }
  }

  recordAction(address, action, msSinceLastAction) {
    if (!this.sessions.has(address)) {
      this.sessions.set(address, { actions:[], flagged:false, warnings:0 });
    }
    const s = this.sessions.get(address);
    s.actions.push({ action, ms:msSinceLastAction, ts:Date.now() });

    // Bot signals:
    // 1. Actions too fast (<200ms consistently) — human reaction time ~200-400ms
    // 2. Perfect timing consistency (variance < 50ms over 20+ actions)
    // 3. Only ever calls — no bluffing, no folds at wrong times
    if (s.actions.length >= 10) {
      const recent = s.actions.slice(-10);
      const times  = recent.map(a => a.ms);
      const avg    = times.reduce((a,b)=>a+b,0) / times.length;
      const variance = times.reduce((s,t)=>s+(t-avg)**2,0) / times.length;

      if (avg < 250 && variance < 100) {
        s.warnings++;
        console.warn(`[BehaviorMonitor] 🚨 Bot pattern for ${address} — avg ${avg}ms variance ${variance}`);
        if (s.warnings >= 3) { s.flagged = true; return 'FLAGGED'; }
        return 'WARNING';
      }
    }
    return 'OK';
  }

  isFlagged(address) {
    return this.sessions.get(address)?.flagged || false;
  }

  reset(address) {
    this.sessions.delete(address);
  }
}

export const behaviorMonitor = new BehaviorMonitor();
