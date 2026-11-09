// src/hooks/wallet/useEscrow.js
// Table economics: buy-in/rebuy/cashout/refund, table creation, and the
// on-chain hand-history stats contract.

import { useState, useCallback, useRef, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, formatUnits } from "viem";
import {
  wagmiConfig, safeFeeOverrides, hasAllowance, EXPECTED_CHAIN,
  CHIPS_ABI, CHIPS, ESCROW_ABI, ESCROW, HAND_HISTORY_ABI, HAND_HISTORY,
  HYPE_ESCROW_ABI, HYPE_ESCROW, HYPE_TESTNET_UI, GAME_WEI_PER_UNIT,
} from "./core";

// One integer game unit is 0.000001 test HYPE, stored on chain as 1e12 wei.
// Never round a float into financial accounting: reject non-integer game units.
const useNativeHype = HYPE_TESTNET_UI && EXPECTED_CHAIN === 99801;
const ESCROW_TARGET = useNativeHype ? HYPE_ESCROW : ESCROW;
const ESCROW_TARGET_ABI = useNativeHype ? HYPE_ESCROW_ABI : ESCROW_ABI;
function unitsToHypeWei(units) {
  if (!Number.isSafeInteger(Number(units)) || Number(units) <= 0)
    throw new RangeError('Native HYPE amounts must be positive integer micro-HYPE units.');
  return BigInt(units) * GAME_WEI_PER_UNIT;
}

// ─── HOOK: HAND HISTORY (batched on-chain gameplay stats) ──────────────────────
export function useHandHistory() {
  const { address } = useAccount();

  const { data, refetch, isLoading } = useReadContract({
    address: HAND_HISTORY, abi: HAND_HISTORY_ABI, functionName: "getStats",
    args: [address], query: { enabled: !!address && !!HAND_HISTORY, refetchInterval: 30000 },
  });

  const handsPlayed   = data ? Number(data[0]) : 0;
  const handsWon      = data ? Number(data[1]) : 0;
  const totalWinnings = data ? Number(formatUnits(data[2], 18)) : 0;
  const lastBatchAt   = data ? Number(data[3]) : 0;
  const winRate        = handsPlayed > 0 ? (handsWon / handsPlayed) * 100 : 0;

  return {
    available: !!HAND_HISTORY,
    handsPlayed, handsWon, totalWinnings, lastBatchAt, winRate,
    loading: isLoading, refetch,
  };
}

// ─── HOOK: ESCROW ACTIONS ──────────────────────────────────────────────────────
export function useEscrow(tableId) {
  const { address, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]   = useState(null);
  const [status, setStatus]   = useState('idle'); // idle | approving | buying | settling | error
  const [rebuyError, setRebuyError] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Read whether table is leased (resolved later in hook; use ref so buyIn callback is stable)
  const seatFeeRef = useRef(0n);

  const buyIn = useCallback(async (buyInAmount) => {
    if (!address || !tableId) return;
    setErrorMsg(null);
    try {
      if (useNativeHype) {
        if (chainId !== 99801 || !HYPE_ESCROW) throw new Error('HYPE testnet escrow not connected.');
        const wei = unitsToHypeWei(buyInAmount);
        const info = await publicClient.readContract({
          address: HYPE_ESCROW, abi: HYPE_ESCROW_ABI, functionName:'getTableInfo', args:[BigInt(tableId)],
        });
        if (info?.[1] !== wei || Number(info?.[5]) !== 0) throw new Error('On-chain HYPE buy-in or table status mismatch.');
        const code = await publicClient.getCode({ address: HYPE_ESCROW });
        if (!code || code === '0x') throw new Error('Native HYPE escrow bytecode not found.');
        setStatus('buying');
        const tx = await writeContractAsync({
          address:HYPE_ESCROW, abi:HYPE_ESCROW_ABI, functionName:'buyIn',
          args:[BigInt(tableId)], value:wei, chainId:99801,
        });
        setTxHash(tx);
        const receipt = await waitForTransactionReceipt(wagmiConfig,{hash:tx,timeout:120_000});
        if (receipt.status !== 'success') throw new Error('Native HYPE buy-in reverted.');
        setStatus('idle');
        return tx;
      }
      const amountBN    = parseUnits(Math.round(Number(buyInAmount)).toString(), 18);
      const seatFeeAmt  = seatFeeRef.current; // 0 for open tables, >0 for leased tables
      const needed      = amountBN + seatFeeAmt;
      const feeOverrides = await safeFeeOverrides(publicClient);
      // Step 1: Approve escrow to spend only what's needed — skip if already approved
      if (!(await hasAllowance(publicClient, address, ESCROW, needed))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
          args: [ESCROW, needed],
          ...feeOverrides,
        });
        setTxHash(approveTx);
        // Wait for approve tx to be mined before submitting buyIn
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      // Step 2: Buy in
      setStatus('buying');
      const buyInTx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "buyIn",
        args: [BigInt(tableId)],
        ...feeOverrides,
      });
      setTxHash(buyInTx);
      setStatus('idle');
      return buyInTx;
    } catch (e) {
      console.error("buyIn error:", e);
      setErrorMsg(e?.shortMessage || e?.message || 'Buy-in failed — please try again.');
      setStatus('error');
    }
  }, [address, chainId, tableId, writeContractAsync, publicClient]);

  const refund = useCallback(async () => {
    setErrorMsg(null);
    try {
      setStatus('refunding');
      const tx = await writeContractAsync({
        address: ESCROW_TARGET, abi: ESCROW_TARGET_ABI, functionName: "refund",
        args: [BigInt(tableId)],
        ...(useNativeHype ? { chainId:99801 } : {}),
      });
      if (useNativeHype) {
        const receipt = await waitForTransactionReceipt(wagmiConfig,{hash:tx,timeout:120_000});
        if (receipt.status !== 'success') throw new Error('Native HYPE refund reverted.');
      }
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      setErrorMsg(e?.shortMessage || e?.message || 'Refund failed — please try again.');
      setStatus('error');
    }
  }, [tableId, writeContractAsync]);

  // rebuy: approve + on-chain rebuy, then notify the game server
  const rebuy = useCallback(async (amount, notifyServer) => {
    if (!address || !tableId) return;
    setRebuyError(null);
    try {
      if (useNativeHype) {
        if (chainId !== 99801 || !HYPE_ESCROW) throw new Error('HYPE testnet escrow not connected.');
        const wei = unitsToHypeWei(amount);
        const isSeated = await publicClient.readContract({
          address:HYPE_ESCROW, abi:HYPE_ESCROW_ABI, functionName:'seated', args:[BigInt(tableId),address],
        });
        if (!isSeated) throw new Error('No existing HYPE table seat to rebuy.');
        const gasBal = await publicClient.getBalance({address});
        if (gasBal <= wei) throw new Error('Insufficient test HYPE for buy-in plus gas.');
        setStatus('buying');
        const hash = await writeContractAsync({
          address:HYPE_ESCROW, abi:HYPE_ESCROW_ABI, functionName:'rebuy',
          args:[BigInt(tableId),wei], value:wei, chainId:99801,
        });
        const receipt=await waitForTransactionReceipt(wagmiConfig,{hash,timeout:120_000});
        if (receipt.status !== 'success') throw new Error('Native HYPE rebuy reverted.');
        setTxHash(hash);
        notifyServer?.();
        setStatus('idle');
        return hash;
      }
      const amountBN = parseUnits(Math.round(Number(amount)).toString(), 18);

      // rebuy() reverts on-chain with "Not seated" if the caller has no deposit
      // recorded for this table (e.g. a contract redeploy wiped prior state, or the
      // player never called buyIn on the current escrow). A wallet can't estimate
      // gas for a call that's guaranteed to revert, so instead of a clean error it
      // shows a nonsensical multi-million-dollar fee — check first and never send
      // a doomed tx.
      const [deposit, roomId, seatFeeOnChain, balance] = await Promise.all([
        publicClient.readContract({
          address: ESCROW, abi: ESCROW_ABI, functionName: "getPlayerDeposit",
          args: [BigInt(tableId), address],
        }),
        publicClient.readContract({
          address: ESCROW, abi: ESCROW_ABI, functionName: "tableRoom", args: [BigInt(tableId)],
        }),
        publicClient.readContract({
          address: ESCROW, abi: ESCROW_ABI, functionName: "seatFeeCHIPS", args: [],
        }),
        publicClient.readContract({
          address: CHIPS, abi: CHIPS_ABI, functionName: "balanceOf", args: [address],
        }),
      ]);
      if (deposit <= 0n) {
        setRebuyError("You're not seated at this table on-chain — buy in instead of rebuying.");
        setStatus('error');
        return;
      }
      const fee = roomId !== 0n ? seatFeeOnChain / 2n : 0n;
      const needed = amountBN + fee;
      if (balance < needed) {
        setRebuyError('Insufficient CHIPS balance for that rebuy amount.');
        setStatus('error');
        return;
      }

      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, ESCROW, needed))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
          args: [ESCROW, needed], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('buying');
      const rebuyTx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "rebuy",
        args: [BigInt(tableId), amountBN], ...feeOverrides,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: rebuyTx, timeout: 30_000 });
      // Tell the game server to update the in-game stack
      notifyServer?.();
      setStatus('idle');
      return rebuyTx;
    } catch (e) {
      console.error("rebuy error:", e);
      setRebuyError('Rebuy failed — please try again.');
      setStatus('error');
    }
  }, [address, tableId, writeContractAsync, publicClient]);

  // cashOut: submit an operator-signed cashout to the contract
  const cashOut = useCallback(async (player, amount, nonce, sig) => {
    if (!ESCROW) return;
    setErrorMsg(null);
    try {
      setStatus('cashout');
      const args = [BigInt(tableId), player, useNativeHype ? BigInt(amount) * GAME_WEI_PER_UNIT : BigInt(amount), BigInt(nonce), sig];
      try {
        await publicClient.simulateContract({
          address: ESCROW_TARGET, abi: ESCROW_TARGET_ABI, functionName: "cashOut", args, account: player,
        });
      } catch (simErr) {
        console.error("cashOut simulate failed:", simErr.shortMessage || simErr.message);
        setErrorMsg(simErr?.shortMessage || simErr?.message || 'Cash-out failed — please try again.');
        setStatus('error');
        return;
      }
      const feeOverrides = await safeFeeOverrides(publicClient);
      const tx = await writeContractAsync({
        address: ESCROW_TARGET, abi: ESCROW_TARGET_ABI, functionName: "cashOut", args, ...feeOverrides,
        ...(useNativeHype ? {chainId:99801} : {}),
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      console.error("cashOut error:", e);
      setErrorMsg(e?.shortMessage || e?.message || 'Cash-out failed — please try again.');
      setStatus('error');
    }
  }, [tableId, writeContractAsync, publicClient]);

  // Table info read
  const { data: tableInfo } = useReadContract({
    address: ESCROW_TARGET, abi: ESCROW_TARGET_ABI, functionName: "getTableInfo",
    args: [BigInt(tableId || 0)],
    query: { enabled: !!tableId, refetchInterval: 5000 },
  });

  const { data: tableRoomId } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "tableRoom",
    args: [BigInt(tableId || 0)],
    query: { enabled: !useNativeHype && !!tableId },
  });

  const { data: seatFeeOnChain } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "seatFeeCHIPS",
    query: { enabled: !useNativeHype && !!ESCROW },
  });

  const isLeased = !useNativeHype && tableRoomId != null && tableRoomId > 0n;
  const seatFee  = isLeased ? (seatFeeOnChain ?? parseUnits("2", 18)) : 0n;

  // Keep seatFeeRef in sync so the buyIn callback always has the latest value
  useEffect(() => { seatFeeRef.current = seatFee; }, [seatFee]);

  return { buyIn, rebuy, refund, cashOut, txHash, status, confirmed, tableInfo, isLeased, seatFee, rebuyError, errorMsg };
}

// ─── HOOK: CREATE TABLE ───────────────────────────────────────────────────────
export function useCreateTable() {
  const { address, chainId }   = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (receipt?.status === 'success') setStatus('confirmed');
  }, [receipt]);

  const createTable = useCallback(async ({ buyIn, bigBlind, maxPlayers, gameType }) => {
    setErrorMsg(null);
    if (!address) { setErrorMsg('Connect your wallet first.'); return null; }
    if (!ESCROW)  { setErrorMsg('Contract not configured — run npm run setup:env and restart.'); return null; }
    if (chainId !== EXPECTED_CHAIN) {
      setErrorMsg(`Wrong network — switch MetaMask to ${EXPECTED_CHAIN === 421614 ? 'Arbitrum Sepolia' : 'Arbitrum One'} (chain ${EXPECTED_CHAIN}).`);
      return null;
    }
    setStatus('pending');
    try {
      const buyInBN    = parseUnits(Math.round(Number(buyIn)).toString(), 18);
      const bigBlindBN = parseUnits(Math.round(Number(bigBlind)).toString(), 18);
      const feeOverrides = await safeFeeOverrides(publicClient);
      const hash = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: 'createTable',
        args: [buyInBN, bigBlindBN, maxPlayers, gameType, 0n],
        chainId: EXPECTED_CHAIN,
        ...feeOverrides,
      });
      setTxHash(hash);
      return hash;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
      return null;
    }
  }, [address, chainId, writeContractAsync, publicClient]);

  // Extract tableId from receipt logs (TableCreated event first indexed param)
  const newTableId = receipt?.logs?.[0]
    ? (() => {
        try {
          const idHex = receipt.logs[0].topics?.[1];
          return idHex ? BigInt(idHex).toString() : null;
        } catch { return null; }
      })()
    : null;

  return { createTable, status, txHash, newTableId, errorMsg };
}
