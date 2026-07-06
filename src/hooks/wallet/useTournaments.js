// src/hooks/wallet/useTournaments.js
// Scheduled tournament listing and registration.

import { useState, useCallback, useMemo } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { formatUnits, parseUnits } from "viem";
import { wagmiConfig, safeFeeOverrides, hasAllowance, CHIPS_ABI, CHIPS, TOURNAMENT_ABI, TOURNAMENT } from "./core";

// ─── HOOK: TOURNAMENTS ────────────────────────────────────────────────────────
export function useTournaments() {
  const { address }  = useAccount();

  const { data: countRaw } = useReadContract({
    address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: 'tournamentCount',
    query: { enabled: !!TOURNAMENT, refetchInterval: 15000 },
  });
  const count = countRaw ? Number(countRaw) : 0;
  const ids   = Array.from({ length: count }, (_, i) => BigInt(i + 1));

  const { data: tournData } = useReadContracts({
    contracts: ids.map(id => ({
      address: TOURNAMENT, abi: TOURNAMENT_ABI,
      functionName: 'tournaments', args: [id],
    })),
    query: { enabled: !!TOURNAMENT && count > 0, refetchInterval: 15000 },
  });

  const { data: regData } = useReadContracts({
    contracts: ids.map(id => ({
      address: TOURNAMENT, abi: TOURNAMENT_ABI,
      functionName: 'registered', args: [id, address],
    })),
    query: { enabled: !!TOURNAMENT && count > 0 && !!address },
  });

  const tournaments = useMemo(() =>
    ids.map((id, i) => {
      const t = tournData?.[i]?.result;
      if (!t) return null;
      return {
        id:              Number(t[0]),
        name:            t[1],
        entryFee:        Number(formatUnits(t[2], 18)),
        startTime:       Number(t[3]),
        maxPlayers:      Number(t[4]),
        gameType:        Number(t[5]),
        status:          Number(t[6]),   // 0=Registration 1=Running 2=Settled 3=Cancelled
        entrantCount:    t[7]?.length ?? 0,
        prizePool:       Number(formatUnits(t[8], 18)),
        guaranteed:      t[10],
        guaranteedPrize: Number(formatUnits(t[11], 18)),
        isRegistered:    !!(regData?.[i]?.result),
      };
    }).filter(Boolean),
  [tournData, regData, ids]);

  return { tournaments, count };
}

export function useRegisterTournament() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [status, setStatus]    = useState('idle');
  const [txHash, setTxHash]    = useState(null);

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const register = useCallback(async (tournId, entryFee) => {
    if (!address || !TOURNAMENT || !CHIPS) return;
    try {
      const feeBN = parseUnits(String(entryFee), 18);
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, TOURNAMENT, feeBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: 'approve',
          args: [TOURNAMENT, feeBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('registering');
      const tx = await writeContractAsync({
        address: TOURNAMENT, abi: TOURNAMENT_ABI, functionName: 'register',
        args: [BigInt(tournId)], ...feeOverrides,
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      console.error('register error:', e);
      setStatus('error');
    }
  }, [address, writeContractAsync, publicClient]);

  return { register, status, txHash, confirmed };
}
