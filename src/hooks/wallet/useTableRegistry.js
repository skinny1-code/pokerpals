// src/hooks/wallet/useTableRegistry.js
// Private room leasing (TableRegistry contract).

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, formatUnits, isAddress } from "viem";
import { wagmiConfig, safeFeeOverrides, hasAllowance, CHIPS_ABI, ALLIN, REGISTRY_ABI, TABLE_REGISTRY } from "./core";

export function useTableRegistry() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]     = useState(null);
  const [status, setStatus]     = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: weeklyFeeRaw } = useReadContract({
    address: TABLE_REGISTRY, abi: REGISTRY_ABI, functionName: 'weeklyFee',
    query: { enabled: !!TABLE_REGISTRY },
  });
  const { data: monthlyFeeRaw } = useReadContract({
    address: TABLE_REGISTRY, abi: REGISTRY_ABI, functionName: 'monthlyFee',
    query: { enabled: !!TABLE_REGISTRY },
  });
  const { data: roomsRaw, refetch: refetchRooms } = useReadContract({
    address: TABLE_REGISTRY, abi: REGISTRY_ABI, functionName: 'getPublicRooms',
    query: { enabled: !!TABLE_REGISTRY, refetchInterval: 15000 },
  });

  const weeklyFee  = weeklyFeeRaw  ? Number(formatUnits(weeklyFeeRaw, 18))  : 33500;
  const monthlyFee = monthlyFeeRaw ? Number(formatUnits(monthlyFeeRaw, 18)) : 100000;

  const publicRooms = useMemo(() => (roomsRaw || []).map(r => ({
    id:          Number(r.id),
    lessee:      r.lessee,
    name:        r.name,
    nftGate:     r.nftGate,
    minBuyIn:    Number(formatUnits(r.minBuyIn, 18)),
    maxBuyIn:    Number(formatUnits(r.maxBuyIn, 18)),
    maxPlayers:  Number(r.maxPlayers),
    gameType:    Number(r.gameType),
    isPublic:    r.isPublic,
    leaseExpiry: Number(r.leaseExpiry),
    dailyRate:   Number(formatUnits(r.dailyRate, 18)),
  })), [roomsRaw]);

  const leaseRoom = useCallback(async ({ name, weeks, months, nftGate, minBuyIn, maxBuyIn, maxPlayers, gameType, isPublic }) => {
    setErrorMsg(null);
    if (!address) { setErrorMsg('Connect your wallet first.'); return null; }
    if (!TABLE_REGISTRY || !ALLIN) { setErrorMsg('Contract not configured — run npm run setup:env and restart.'); return null; }
    if (nftGate && !isAddress(nftGate)) { setErrorMsg('NFT gate must be a valid contract address.'); return null; }
    try {
      const useMonths = !!months;
      const count   = BigInt(useMonths ? months : weeks);
      const feeRate = useMonths ? (monthlyFeeRaw ?? 0n) : (weeklyFeeRaw ?? 0n);
      const feeBN   = feeRate * count;
      const nftGateAddr = nftGate ? nftGate : '0x0000000000000000000000000000000000000000';
      const minBuyInBN  = parseUnits(String(minBuyIn || 0), 18);
      const maxBuyInBN  = parseUnits(String(maxBuyIn || 0), 18);
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, TABLE_REGISTRY, feeBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: ALLIN, abi: CHIPS_ABI, functionName: 'approve',
          args: [TABLE_REGISTRY, feeBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('leasing');
      const tx = await writeContractAsync({
        address: TABLE_REGISTRY, abi: REGISTRY_ABI,
        functionName: useMonths ? 'leaseRoomMonths' : 'leaseRoom',
        args: [count, nftGateAddr, minBuyInBN, maxBuyInBN, maxPlayers, gameType, isPublic, name],
        ...feeOverrides,
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
      return null;
    }
  }, [address, writeContractAsync, publicClient, weeklyFeeRaw, monthlyFeeRaw]);

  useEffect(() => { if (confirmed) refetchRooms(); }, [confirmed, refetchRooms]);

  return { weeklyFee, monthlyFee, publicRooms, leaseRoom, status, txHash, confirmed, errorMsg, refetchRooms };
}
