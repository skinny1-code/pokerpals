// src/hooks/wallet/useLottery.js
// Weekly no-loss staker lottery: free entry for tier >= 1 stakers, ticket
// weight = staked SALOON, prize paid from the PromotionsPool. Principal is
// never at risk — entering costs nothing but gas.

import { useState, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { formatUnits } from "viem";
import { wagmiConfig, safeFeeOverrides } from "./core";

export const LOTTERY = process.env.NEXT_PUBLIC_LOTTERY;

const LOTTERY_ABI = [
  { name: "currentEpoch", type: "function", stateMutability: "view", inputs: [],
    outputs: [
      { name: "id", type: "uint256" }, { name: "endsAt", type: "uint256" },
      { name: "prize", type: "uint256" }, { name: "entrants", type: "uint256" },
      { name: "totalTickets", type: "uint256" },
    ] },
  { name: "myTickets", type: "function", stateMutability: "view",
    inputs: [{ name: "player", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "enter", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

export function useLottery() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [status, setStatus]    = useState('idle'); // idle | entering | error
  const [error, setError]      = useState(null);

  const { data: epoch, refetch: refetchEpoch } = useReadContract({
    address: LOTTERY, abi: LOTTERY_ABI, functionName: "currentEpoch",
    query: { enabled: !!LOTTERY, refetchInterval: 30000 },
  });

  const { data: ticketsRaw, refetch: refetchTickets } = useReadContract({
    address: LOTTERY, abi: LOTTERY_ABI, functionName: "myTickets",
    args: [address], query: { enabled: !!address && !!LOTTERY, refetchInterval: 30000 },
  });

  const enter = useCallback(async () => {
    if (!address || !LOTTERY) return;
    setError(null);
    setStatus('entering');
    try {
      const fees = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: LOTTERY, abi: LOTTERY_ABI, functionName: "enter", args: [], ...fees,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: tx, timeout: 30_000 });
      setStatus('idle');
      refetchEpoch(); refetchTickets();
    } catch (e) {
      setError(e?.shortMessage || e?.message || 'Entry failed');
      setStatus('error');
    }
  }, [address, publicClient, writeContractAsync, refetchEpoch, refetchTickets]);

  return {
    enabled: !!LOTTERY,
    prize:        epoch ? Number(formatUnits(epoch[2], 18)) : 0,
    endsAt:       epoch ? Number(epoch[1]) : 0,
    entrants:     epoch ? Number(epoch[3]) : 0,
    totalTickets: epoch ? Number(epoch[4]) : 0,
    myTickets:    ticketsRaw ? Number(ticketsRaw) : 0,
    entered:      !!ticketsRaw && Number(ticketsRaw) > 0,
    enter, status, error,
  };
}
