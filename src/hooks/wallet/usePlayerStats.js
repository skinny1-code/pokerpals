// src/hooks/wallet/usePlayerStats.js
// Lifetime player stats (from on-chain event logs) and the staked-SALOON
// leaderboard. Both index a bounded block range client-side.

import { useState, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { formatUnits, parseAbiItem } from "viem";
import { ESCROW, TOURNAMENT, HANDLE, STAKING, STAKING_ABI } from "./core";

// ─── HOOK: PLAYER STATS (lifetime P/L + activity feed from on-chain logs) ─────
// Indexes Escrow + Tournament event logs over a bounded block range (same
// approach as useLeaderboard) and folds them into per-player lifetime stats and
// a reverse-chronological activity feed. All filtering is client-side because
// several relevant args (PlayerJoined.player, TournamentPaid.winners[]) are not
// indexed and so can't be filtered by topic.
export function usePlayerStats(target) {
  const { address: connected } = useAccount();
  const address = target || connected;
  const publicClient = usePublicClient();
  const [stats, setStats]   = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !publicClient || (!ESCROW && !TOURNAMENT)) return;
    let cancelled = false;
    const me = address.toLowerCase();
    setLoading(true);

    (async () => {
      try {
        let fromBlock;
        if (process.env.NEXT_PUBLIC_DEPLOY_BLOCK) {
          fromBlock = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK);
        } else {
          const latest = await publicClient.getBlockNumber();
          fromBlock = latest > 500_000n ? latest - 500_000n : 0n;
        }

        // Helper: tolerate a missing contract / RPC hiccup on any single query.
        const safeLogs = async (params) => {
          try { return await publicClient.getLogs({ fromBlock, ...params }); }
          catch (e) { console.warn('[usePlayerStats] getLogs', e.message); return []; }
        };

        const [joined, cashed, rebuyed, handSettled, registered, tournPaid] = await Promise.all([
          ESCROW ? safeLogs({ address: ESCROW, event: parseAbiItem('event PlayerJoined(uint256 indexed id, address player, uint256 buyIn, uint256 seatFee)') }) : [],
          ESCROW ? safeLogs({ address: ESCROW, event: parseAbiItem('event PlayerCashedOut(uint256 indexed id, address indexed player, uint256 amount)'), args: { player: address } }) : [],
          ESCROW ? safeLogs({ address: ESCROW, event: parseAbiItem('event PlayerRebuyed(uint256 indexed id, address indexed player, uint256 amount)'), args: { player: address } }) : [],
          ESCROW ? safeLogs({ address: ESCROW, event: parseAbiItem('event HandSettled(uint256 indexed id, uint256 nonce, address[] winners, uint256[] payouts, uint256 rake, uint256 burned, uint256 toStaking, uint256 referralPaid)') }) : [],
          TOURNAMENT ? safeLogs({ address: TOURNAMENT, event: parseAbiItem('event PlayerRegistered(uint256 indexed id, address player, uint256 feePaid)') }) : [],
          TOURNAMENT ? safeLogs({ address: TOURNAMENT, event: parseAbiItem('event TournamentPaid(uint256 indexed id, address[] winners, uint256[] payouts)') }) : [],
        ]);
        if (cancelled) return;

        const num = (v) => Number(formatUnits(v, 18));
        const feed = [];
        let buyInTotal = 0, rebuyTotal = 0, cashOutTotal = 0, seatFeesPaid = 0;
        let handsWon = 0, handWinnings = 0;
        let tournEntries = 0, tournFeesPaid = 0, tournCashes = 0, tournWinnings = 0;

        joined.filter(l => l.args.player?.toLowerCase() === me).forEach(l => {
          buyInTotal   += num(l.args.buyIn);
          seatFeesPaid += num(l.args.seatFee);
          feed.push({ kind: 'buyin', block: l.blockNumber, table: Number(l.args.id),
            amount: num(l.args.buyIn), seatFee: num(l.args.seatFee) });
        });
        rebuyed.forEach(l => {
          rebuyTotal += num(l.args.amount);
          feed.push({ kind: 'rebuy', block: l.blockNumber, table: Number(l.args.id), amount: num(l.args.amount) });
        });
        cashed.forEach(l => {
          cashOutTotal += num(l.args.amount);
          feed.push({ kind: 'cashout', block: l.blockNumber, table: Number(l.args.id), amount: num(l.args.amount) });
        });
        handSettled.forEach(l => {
          const winners = (l.args.winners || []).map(w => w.toLowerCase());
          const idx = winners.indexOf(me);
          if (idx === -1) return;
          const won = num(l.args.payouts?.[idx] ?? 0n);
          handsWon += 1; handWinnings += won;
          feed.push({ kind: 'handwin', block: l.blockNumber, table: Number(l.args.id), amount: won });
        });
        registered.filter(l => l.args.player?.toLowerCase() === me).forEach(l => {
          tournEntries += 1; tournFeesPaid += num(l.args.feePaid);
          feed.push({ kind: 'tournreg', block: l.blockNumber, tourn: Number(l.args.id), amount: num(l.args.feePaid) });
        });
        tournPaid.forEach(l => {
          const winners = (l.args.winners || []).map(w => w.toLowerCase());
          const idx = winners.indexOf(me);
          if (idx === -1) return;
          const won = num(l.args.payouts?.[idx] ?? 0n);
          const place = idx + 1;
          tournCashes += 1; tournWinnings += won;
          feed.push({ kind: 'tournwin', block: l.blockNumber, tourn: Number(l.args.id), amount: won, place });
        });

        feed.sort((a, b) => Number(b.block - a.block));

        const cashGamePnl = cashOutTotal - buyInTotal - rebuyTotal;
        const tournPnl    = tournWinnings - tournFeesPaid;

        if (!cancelled) {
          setStats({
            chipsBoughtIn: buyInTotal + rebuyTotal,
            cashOutTotal,
            seatFeesPaid,
            cashGamePnl,
            handsWon,
            handWinnings,
            tablesPlayed: new Set(
              feed.filter(f => f.table != null).map(f => f.table)
            ).size,
            tournEntries,
            tournFeesPaid,
            tournCashes,
            tournWinnings,
            tournPnl,
            netPnl: cashGamePnl + tournPnl,
          });
          setActivity(feed);
        }
      } catch (e) {
        console.error('[usePlayerStats]', e.message);
        if (!cancelled) { setStats(null); setActivity([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address, publicClient]);

  return { stats, activity, loading };
}

// ─── HOOK: LEADERBOARD (handle holders sorted by staked SALOON) ───────────────
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
