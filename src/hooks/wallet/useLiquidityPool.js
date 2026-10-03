// src/hooks/wallet/useLiquidityPool.js
// SALOON ⇄ USDC swap pool — used by the /buy page (card on-ramp, DEX, and
// the SALOON -> USDC withdraw flow).

import { useState, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, formatUnits } from "viem";
import {
  wagmiConfig, safeFeeOverrides, hasAllowance,
  CHIPS_ABI, SALOON, LIQUIDITY_POOL_ABI, LIQUIDITY_POOL, USDC_ADDR,
} from "./core";

export function useLiquidityPool() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle'); // idle | approving | buying | redeeming | error

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: usdcRaw, refetch: refetchUsdc } = useReadContract({
    address: USDC_ADDR, abi: CHIPS_ABI, functionName: "balanceOf",
    args: [address], query: { enabled: !!address && !!USDC_ADDR, refetchInterval: 8000 },
  });
  const usdcBalance = usdcRaw ? Number(formatUnits(usdcRaw, 6)) : 0; // USDC is 6 decimals

  const { data: rateRaw, refetch: refetchRate } = useReadContract({
    address: LIQUIDITY_POOL, abi: LIQUIDITY_POOL_ABI, functionName: "rateUsdcPerChip",
    query: { enabled: !!LIQUIDITY_POOL, refetchInterval: 30000 },
  });

  const { data: poolPaused, refetch: refetchPaused } = useReadContract({
    address: LIQUIDITY_POOL, abi: LIQUIDITY_POOL_ABI, functionName: "paused",
    query: { enabled: !!LIQUIDITY_POOL, refetchInterval: 30000 },
  });

  const { data: poolChipsRaw, refetch: refetchPoolChips } = useReadContract({
    address: LIQUIDITY_POOL, abi: LIQUIDITY_POOL_ABI, functionName: "chipsBalance",
    query: { enabled: !!LIQUIDITY_POOL, refetchInterval: 15000 },
  });
  const poolChipsAvailable = poolChipsRaw ? Number(formatUnits(poolChipsRaw, 18)) : 0;

  // Quote helpers mirror the contract's exact integer math so the UI never shows a
  // number the chain would disagree with — no extra RPC round-trip per keystroke.
  const quoteChipsOut = useCallback((usdcHuman) => {
    if (!rateRaw || !usdcHuman || Number(usdcHuman) <= 0) return 0;
    const usdcAmt = parseUnits(String(usdcHuman), 6);
    return Number(formatUnits((usdcAmt * 10n ** 18n) / rateRaw, 18));
  }, [rateRaw]);

  const quoteUsdcOut = useCallback((chipsHuman) => {
    if (!rateRaw || !chipsHuman || Number(chipsHuman) <= 0) return 0;
    const chipsAmt = parseUnits(String(Math.round(Number(chipsHuman))), 18);
    return Number(formatUnits((chipsAmt * rateRaw) / 10n ** 18n, 6));
  }, [rateRaw]);

  // Buy SALOON with USDC (the leg the card on-ramp lands in, once USDC is in the wallet).
  const buyChips = useCallback(async (usdcHuman) => {
    if (!address || !LIQUIDITY_POOL || !USDC_ADDR) return;
    try {
      const usdcAmt = parseUnits(String(usdcHuman), 6);
      if (usdcAmt <= 0n) { setStatus('error'); return; }
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, LIQUIDITY_POOL, usdcAmt, USDC_ADDR))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: USDC_ADDR, abi: CHIPS_ABI, functionName: "approve",
          args: [LIQUIDITY_POOL, usdcAmt], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('buying');
      const tx = await writeContractAsync({
        address: LIQUIDITY_POOL, abi: LIQUIDITY_POOL_ABI, functionName: "buyChips",
        args: [usdcAmt], ...feeOverrides,
      });
      setTxHash(tx);
      await waitForTransactionReceipt(wagmiConfig, { hash: tx, timeout: 60_000 });
      refetchUsdc(); refetchPoolChips();
      setStatus('idle');
      return tx;
    } catch (e) {
      console.error("buyChips error:", e);
      setStatus('error');
    }
  }, [address, writeContractAsync, publicClient, refetchUsdc, refetchPoolChips]);

  // Redeem SALOON back for USDC, paid out of StablecoinPool.
  const redeemChips = useCallback(async (chipsHuman) => {
    if (!address || !LIQUIDITY_POOL) return;
    try {
      const chipsAmt = parseUnits(String(Math.round(Number(chipsHuman))), 18);
      if (chipsAmt <= 0n) { setStatus('error'); return; }
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, LIQUIDITY_POOL, chipsAmt))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: SALOON, abi: CHIPS_ABI, functionName: "approve",
          args: [LIQUIDITY_POOL, chipsAmt], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('redeeming');
      const tx = await writeContractAsync({
        address: LIQUIDITY_POOL, abi: LIQUIDITY_POOL_ABI, functionName: "redeemChips",
        args: [chipsAmt], ...feeOverrides,
      });
      setTxHash(tx);
      await waitForTransactionReceipt(wagmiConfig, { hash: tx, timeout: 60_000 });
      refetchPoolChips();
      setStatus('idle');
      return tx;
    } catch (e) {
      console.error("redeemChips error:", e);
      setStatus('error');
    }
  }, [address, writeContractAsync, publicClient, refetchPoolChips]);

  return {
    usdcBalance, poolChipsAvailable, paused: !!poolPaused, rateRaw,
    quoteChipsOut, quoteUsdcOut,
    buyChips, redeemChips,
    txHash, status, confirmed,
    refetch: () => { refetchUsdc(); refetchRate(); refetchPaused(); refetchPoolChips(); },
  };
}
