// src/hooks/wallet/useStaking.js
// Stake/unstake ALLIN for a VIP tier, claim staking yield and rakeback.

import { useState, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, formatUnits } from "viem";
import {
  wagmiConfig, safeFeeOverrides, hasAllowance,
  CHIPS_ABI, ALLIN, STAKING_ABI, STAKING, ESCROW_ABI, ESCROW,
} from "./core";

export function useStaking() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle');

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: stakeInfo, refetch: refetchStake } = useReadContract({
    address: STAKING, abi: STAKING_ABI, functionName: "getStakeInfo",
    args: [address], query: { enabled: !!address && !!STAKING, refetchInterval: 15000 },
  });

  const { data: pendingRaw, refetch: refetchPending } = useReadContract({
    address: STAKING, abi: STAKING_ABI, functionName: "pendingYield",
    args: [address], query: { enabled: !!address && !!STAKING, refetchInterval: 15000 },
  });

  const { data: rakebackRaw, refetch: refetchRakeback } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "rakebackAccrued",
    args: [address], query: { enabled: !!address && !!ESCROW, refetchInterval: 15000 },
  });

  const stakedAmount  = stakeInfo ? Number(formatUnits(stakeInfo[0], 18)) : 0;
  const currentTier   = stakeInfo ? Number(stakeInfo[1]) : 0;
  const lockedUntil   = stakeInfo ? Number(stakeInfo[2]) : 0;
  const pendingYield  = pendingRaw  ? Number(formatUnits(pendingRaw,  18)) : 0;
  const rakebackOwed  = rakebackRaw ? Number(formatUnits(rakebackRaw, 18)) : 0;

  const stake = useCallback(async (amount) => {
    if (!address || !STAKING) return;
    try {
      const chipsInt = Math.round(Number(amount));
      if (!chipsInt || chipsInt <= 0) { setStatus('error'); return; }
      const amountBN = parseUnits(String(chipsInt), 18);
      // Skip the approve popup if we've already approved enough — avoids the flaky
      // back-to-back double popup on MetaMask mobile that leaves the 2nd one blank.
      if (!(await hasAllowance(publicClient, address, STAKING, amountBN))) {
        setStatus('approving');
        const approveFees = await safeFeeOverrides(publicClient);
        const approveTx = await writeContractAsync({
          address: ALLIN, abi: CHIPS_ABI, functionName: "approve",
          args: [STAKING, amountBN], ...approveFees,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('staking');
      const stakeFees = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "stake",
        args: [amountBN], ...stakeFees,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: tx, timeout: 60_000 });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) { console.error('stake error:', e); setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const unstake = useCallback(async (amount) => {
    if (!address || !STAKING) return;
    try {
      setStatus('unstaking');
      const chipsInt = Math.round(Number(amount));
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "unstake",
        args: [parseUnits(String(chipsInt), 18)], ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch (e) { console.error('unstake error:', e); setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const claimYield = useCallback(async () => {
    if (!address || !STAKING) return;
    try {
      setStatus('claiming');
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "claimYield", args: [],
        ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const claimRakeback = useCallback(async () => {
    if (!address || !ESCROW) return;
    try {
      setStatus('claiming');
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "claimRakeback", args: [],
        ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  const compound = useCallback(async () => {
    if (!address || !STAKING) return;
    try {
      setStatus('compounding');
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "compound", args: [],
        ...feeOverrides,
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync, publicClient]);

  return {
    stakedAmount, currentTier, lockedUntil, pendingYield, rakebackOwed,
    stake, unstake, claimYield, claimRakeback, compound,
    status, confirmed,
    refetch: () => { refetchStake(); refetchPending(); refetchRakeback(); },
  };
}
