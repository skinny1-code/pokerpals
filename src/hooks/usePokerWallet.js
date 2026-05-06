// src/hooks/usePokerWallet.js
// wagmi v2 + viem — real EVM wallet integration

import { useEffect, useState, useCallback, useRef } from "react";
import { createConfig, http, useAccount, useConnect, useDisconnect,
         useReadContract, useWriteContract, useWaitForTransactionReceipt,
         useBalance, useSignMessage, usePublicClient } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { parseUnits, formatUnits } from "viem";

// ─── WAGMI CONFIG (export and wrap your app in <WagmiProvider config={wagmiConfig}>) ──
const _connectors = [injected()];

export const wagmiConfig = createConfig({
  chains:     [arbitrum, arbitrumSepolia],
  transports: {
    [arbitrum.id]:        http(),
    [arbitrumSepolia.id]: http(),
  },
  connectors: _connectors,
  ssr: true,  // prevents wagmi from reading localStorage during SSR hydration
});

// ─── ABIs ─────────────────────────────────────────────────────────────────────
export const CHIPS_ABI = [
  { name:"balanceOf",  type:"function", stateMutability:"view",
    inputs:[{name:"account",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"approve",    type:"function", stateMutability:"nonpayable",
    inputs:[{name:"spender",type:"address"},{name:"amount",type:"uint256"}], outputs:[{type:"bool"}] },
  { name:"allowance",  type:"function", stateMutability:"view",
    inputs:[{name:"owner",type:"address"},{name:"spender",type:"address"}], outputs:[{type:"uint256"}] },
];
export const PPP_ABI = CHIPS_ABI;

export const STAKING_ABI = [
  { name:"stake",   type:"function", stateMutability:"nonpayable",
    inputs:[{name:"amount",type:"uint256"}], outputs:[] },
  { name:"unstake", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"amount",type:"uint256"}], outputs:[] },
  { name:"claimYield", type:"function", stateMutability:"nonpayable",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"getStakeInfo", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}],
    outputs:[
      {name:"amount",type:"uint256"},{name:"tier",type:"uint8"},
      {name:"lockedUntil",type:"uint256"},{name:"aprBps",type:"uint256"},
    ]},
  { name:"pendingYield", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"getTierStats", type:"function", stateMutability:"view",
    inputs:[],
    outputs:[
      {name:"thresholds",type:"uint256[5]"},
      {name:"aprs",type:"uint256[5]"},
      {name:"counts",type:"uint256[5]"},
    ]},
];

export const ESCROW_ABI = [
  { name:"createTable", type:"function", stateMutability:"nonpayable",
    inputs:[
      {name:"buyInAmount",type:"uint256"},{name:"bigBlind",type:"uint256"},
      {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},
      {name:"roomId",type:"uint256"},
    ],
    outputs:[{name:"id",type:"uint256"}]},
  { name:"buyIn",    type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"rebuy",    type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"},{name:"amount",type:"uint256"}], outputs:[] },
  { name:"refund",   type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"claimRakeback", type:"function", stateMutability:"nonpayable",
    inputs:[], outputs:[] },
  { name:"humanVerified", type:"function", stateMutability:"view",
    inputs:[{name:"addr",type:"address"}], outputs:[{type:"bool"}] },
  { name:"rakebackAccrued", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"getTableInfo", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"}],
    outputs:[
      {name:"id",type:"uint256"},{name:"buyIn",type:"uint256"},{name:"bigBlind",type:"uint256"},
      {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},
      {name:"status",type:"uint8"},{name:"pot",type:"uint256"},
      {name:"handNonce",type:"uint256"},{name:"seated",type:"uint8"},
    ]},
  { name:"tableCount", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"tableRoom", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"seatFeeCHIPS", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"getPlayerDeposit", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"},{name:"player",type:"address"}],
    outputs:[{type:"uint256"}] },
  { name:"cashOut", type:"function", stateMutability:"nonpayable",
    inputs:[
      {name:"tableId",type:"uint256"},{name:"player",type:"address"},
      {name:"amount",type:"uint256"},{name:"nonce",type:"uint256"},
      {name:"sig",type:"bytes"},
    ], outputs:[] },
  { name:"cashOutNonce", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"},{name:"player",type:"address"}],
    outputs:[{type:"uint256"}] },
  { name:"closeTable", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"TableCreated", type:"event",
    inputs:[
      {name:"id",type:"uint256",indexed:true},
      {name:"creator",type:"address",indexed:true},
      {name:"buyIn",type:"uint256",indexed:false},
      {name:"g",type:"uint8",indexed:false},
    ]},
];

export const HANDLE_ABI = [
  { name:"mintHandle", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"handle",type:"string"}], outputs:[] },
  { name:"getHandleByAddress", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}], outputs:[{type:"string"}] },
  { name:"getHandle", type:"function", stateMutability:"view",
    inputs:[{name:"tokenId",type:"uint256"}], outputs:[{type:"string"}] },
  { name:"ownerTokenId", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"address"}], outputs:[{type:"uint256"}] },
  { name:"handleTaken", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"string"}], outputs:[{type:"bool"}] },
  { name:"getCurrentMintCost", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"getCurrentTier", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint8"}] },
  { name:"tierCosts", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"tierBounds", type:"function", stateMutability:"view",
    inputs:[{name:"",type:"uint256"}], outputs:[{type:"uint256"}] },
  { name:"totalMinted", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"totalBurned", type:"function", stateMutability:"view",
    inputs:[], outputs:[{type:"uint256"}] },
  { name:"HandleMinted", type:"event",
    inputs:[
      {name:"player",type:"address",indexed:true},
      {name:"tokenId",type:"uint256",indexed:false},
      {name:"handle",type:"string",indexed:false},
      {name:"burned",type:"uint256",indexed:false},
    ]},
];

const CHIPS   = process.env.NEXT_PUBLIC_CHIPS_TOKEN || process.env.NEXT_PUBLIC_PPP_TOKEN;
const ESCROW  = process.env.NEXT_PUBLIC_ESCROW;
const STAKING = process.env.NEXT_PUBLIC_STAKING;
const HANDLE  = process.env.NEXT_PUBLIC_POKER_HANDLE;

// ─── HOOK: WALLET STATE ───────────────────────────────────────────────────────
export function useWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors }           = useConnect();
  const { disconnect }                    = useDisconnect();

  // CHIPS balance
  const { data: chipsRaw } = useReadContract({
    address: CHIPS, abi: CHIPS_ABI, functionName: "balanceOf",
    args: [address], query: { enabled: !!address, refetchInterval: 8000 },
  });
  const chipsBalance = chipsRaw ? Number(formatUnits(chipsRaw, 18)) : 0;

  // ETH/native balance for gas
  const { data: nativeBal } = useBalance({ address, query: { enabled: !!address } });

  // Is human verified on-chain?
  const { data: isHuman } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "humanVerified",
    args: [address], query: { enabled: !!address, refetchInterval: 30000 },
  });

  const connectMetaMask   = () => connect({ connector: connectors.find(c => c.id === 'injected') });
  const connectWalletConnect = () => connect({ connector: connectors.find(c => c.id === 'walletConnect') });

  return {
    address,
    isConnected,
    chainId,
    chipsBalance,
    pppBalance: chipsBalance,  // backwards-compat alias
    nativeBalance: nativeBal ? Number(formatUnits(nativeBal.value, 18)) : 0,
    isHuman: !!isHuman,
    connectMetaMask,
    connectWalletConnect,
    disconnect,
  };
}

// ─── HOOK: STAKING ────────────────────────────────────────────────────────────
export function useStaking() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
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
      setStatus('approving');
      const amountBN = parseUnits(String(amount), 18);
      await writeContractAsync({
        address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
        args: [STAKING, amountBN],
      });
      setStatus('staking');
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "stake",
        args: [amountBN],
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync]);

  const unstake = useCallback(async (amount) => {
    if (!address || !STAKING) return;
    try {
      setStatus('unstaking');
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "unstake",
        args: [parseUnits(String(amount), 18)],
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync]);

  const claimYield = useCallback(async () => {
    if (!address || !STAKING) return;
    try {
      setStatus('claiming');
      const tx = await writeContractAsync({
        address: STAKING, abi: STAKING_ABI, functionName: "claimYield", args: [],
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync]);

  const claimRakeback = useCallback(async () => {
    if (!address || !ESCROW) return;
    try {
      setStatus('claiming');
      const tx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "claimRakeback", args: [],
      });
      setTxHash(tx); setStatus('idle'); return tx;
    } catch { setStatus('error'); }
  }, [address, writeContractAsync]);

  return {
    stakedAmount, currentTier, lockedUntil, pendingYield, rakebackOwed,
    stake, unstake, claimYield, claimRakeback,
    status, confirmed,
    refetch: () => { refetchStake(); refetchPending(); refetchRakeback(); },
  };
}

// ─── HOOK: ESCROW ACTIONS ──────────────────────────────────────────────────────
export function useEscrow(tableId) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]   = useState(null);
  const [status, setStatus]   = useState('idle'); // idle | approving | buying | settling | error

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Read whether table is leased (resolved later in hook; use ref so buyIn callback is stable)
  const seatFeeRef = useRef(0n);

  const buyIn = useCallback(async (buyInAmount) => {
    if (!address || !tableId) return;
    try {
      setStatus('approving');
      const amountBN    = parseUnits(String(buyInAmount), 18);
      const seatFeeAmt  = seatFeeRef.current; // 0 for open tables, >0 for leased tables
      // Fetch live gas fees with 20% buffer to avoid base fee underrun
      const fees = await publicClient.estimateFeesPerGas();
      const feeOverrides = {
        maxFeePerGas:         fees.maxFeePerGas         ? fees.maxFeePerGas * 120n / 100n : undefined,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas * 120n / 100n : undefined,
      };
      // Step 1: Approve escrow to spend only what's needed
      const approveTx = await writeContractAsync({
        address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
        args: [ESCROW, amountBN + seatFeeAmt],
        ...feeOverrides,
      });
      setTxHash(approveTx);
      // Wait for approve tx to be mined before submitting buyIn
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
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
      setStatus('error');
    }
  }, [address, tableId, writeContractAsync, publicClient]);

  const refund = useCallback(async () => {
    try {
      setStatus('refunding');
      const tx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "refund",
        args: [BigInt(tableId)],
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) { setStatus('error'); }
  }, [tableId, writeContractAsync]);

  // rebuy: approve + on-chain rebuy, then notify the game server
  const rebuy = useCallback(async (amount, notifyServer) => {
    if (!address || !tableId) return;
    try {
      setStatus('approving');
      const amountBN = parseUnits(String(amount), 18);
      const fees = await publicClient.estimateFeesPerGas();
      const feeOverrides = {
        maxFeePerGas:         fees.maxFeePerGas         ? fees.maxFeePerGas * 120n / 100n : undefined,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas * 120n / 100n : undefined,
      };
      const approveTx = await writeContractAsync({
        address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
        args: [ESCROW, amountBN], ...feeOverrides,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
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
      setStatus('error');
    }
  }, [address, tableId, writeContractAsync, publicClient]);

  // cashOut: submit an operator-signed cashout to the contract
  const cashOut = useCallback(async (player, amount, nonce, sig) => {
    if (!ESCROW) return;
    try {
      setStatus('cashout');
      const fees = await publicClient.estimateFeesPerGas();
      const feeOverrides = {
        maxFeePerGas:         fees.maxFeePerGas         ? fees.maxFeePerGas * 120n / 100n : undefined,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas * 120n / 100n : undefined,
      };
      const tx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "cashOut",
        args: [BigInt(tableId), player, BigInt(amount), BigInt(nonce), sig],
        ...feeOverrides,
      });
      setTxHash(tx);
      setStatus('idle');
      return tx;
    } catch (e) {
      console.error("cashOut error:", e);
      setStatus('error');
    }
  }, [tableId, writeContractAsync, publicClient]);

  // Table info read
  const { data: tableInfo } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "getTableInfo",
    args: [BigInt(tableId || 0)],
    query: { enabled: !!tableId, refetchInterval: 5000 },
  });

  const { data: tableRoomId } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "tableRoom",
    args: [BigInt(tableId || 0)],
    query: { enabled: !!tableId },
  });

  const { data: seatFeeOnChain } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "seatFeeCHIPS",
    query: { enabled: !!ESCROW },
  });

  const isLeased = tableRoomId != null && tableRoomId > 0n;
  const seatFee  = isLeased ? (seatFeeOnChain ?? parseUnits("2", 18)) : 0n;

  // Keep seatFeeRef in sync so the buyIn callback always has the latest value
  useEffect(() => { seatFeeRef.current = seatFee; }, [seatFee]);

  return { buyIn, rebuy, refund, cashOut, txHash, status, confirmed, tableInfo, isLeased, seatFee };
}

// ─── HOOK: TABLE WEBSOCKET ────────────────────────────────────────────────────
// Connects, authenticates, and manages real-time game state for a single table.
export function useTableSocket(tableId, tableConfig) {
  const { address }          = useAccount();
  const { signMessageAsync } = useSignMessage();
  const serverUrl            = process.env.NEXT_PUBLIC_WS_URL;

  const [gameState,       setGameState]       = useState(null);
  const [handOver,        setHandOver]        = useState(null);
  const [tableList,       setTableList]       = useState([]);
  const [wsStatus,        setWsStatus]        = useState('disconnected');
  const [wsError,         setWsError]         = useState(null);
  const [cashoutSig,      setCashoutSig]      = useState(null);
  const [cashoutLocked,   setCashoutLocked]   = useState(null);
  const [tableLocked,     setTableLocked]     = useState(false);
  const [refundAvailable, setRefundAvailable] = useState(false);
  const [seatPickerData,  setSeatPickerData]  = useState(null); // { maxPlayers, takenSeats }
  const [reconnectKey,    setReconnectKey]    = useState(0);
  const wsRef           = useRef(null);
  const authCacheRef    = useRef(null); // { address, nonce, signature } — reused on reconnect
  const tableConfigRef  = useRef(tableConfig); // keep latest config accessible inside ws callbacks
  tableConfigRef.current = tableConfig;

  useEffect(() => {
    if (!serverUrl || !address) return;

    setWsStatus('connecting');
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      setWsStatus('connected');
      try {
        // Reuse cached sig for same address to avoid repeated MetaMask popups on reconnect
        let auth = authCacheRef.current;
        if (!auth || auth.address !== address) {
          const nonce     = Date.now().toString();
          const signature = await signMessageAsync({ message: `PPP-AUTH:${nonce}` });
          auth = { address, nonce, signature };
          authCacheRef.current = auth;
        }
        ws.send(JSON.stringify({ type: 'AUTH', payload: auth }));
      } catch {
        setWsError('Wallet signature required to connect');
        ws.close();
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'AUTH_OK':
            setWsStatus('authed');
            if (tableId) {
              // Always send JOIN_TABLE immediately; include config if available (server uses defaults otherwise)
              ws.send(JSON.stringify({ type: 'JOIN_TABLE', payload: { tableId, config: tableConfigRef.current || undefined } }));
            } else {
              ws.send(JSON.stringify({ type: 'LIST_TABLES' }));
            }
            break;
          case 'AUTH_FAIL':
            // Clear cache so next attempt prompts a fresh sign
            authCacheRef.current = null;
            setWsError('Authentication failed — check wallet signature');
            break;
          case 'GAME_STATE': {
            setGameState(msg.state);
            setSeatPickerData(null); // seated — dismiss picker
            setHandOver(null);
            if (msg.state && address) {
              const hero = msg.state.players?.find(
                p => p.addr?.toLowerCase() === address.toLowerCase()
              );
              if (hero) {
                const locked = (hero.cashoutLockedUntil ?? 0) > (msg.state.handNonce ?? 0);
                setCashoutLocked(locked ? { handsRemaining: (hero.cashoutLockedUntil ?? 0) - (msg.state.handNonce ?? 0) } : null);
              }
              if (!msg.state.anyLocked) setTableLocked(false);
            }
            break;
          }
          case 'HAND_OVER':
            setHandOver(msg);
            break;
          case 'CASHOUT_SIG':
            setCashoutSig({ amount: msg.amount, sig: msg.sig, nonce: msg.nonce, tableId: msg.tableId });
            break;
          case 'CASHOUT_LOCKED':
            setCashoutLocked({ handsRemaining: msg.handsRemaining });
            break;
          case 'TABLE_LOCKED':
            setTableLocked(true);
            break;
          case 'REFUND_AVAILABLE':
            setRefundAvailable(true);
            break;
          case 'SEAT_PICKER':
            setSeatPickerData({ maxPlayers: msg.maxPlayers, takenSeats: msg.takenSeats || [] });
            break;
          case 'REBUY_OK':
            break;
          case 'TABLE_LIST':
            setTableList(msg.tables || []);
            break;
          case 'ERROR':
            setWsError(msg.error);
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      wsRef.current = null;
      // Auto-reconnect after 3s (no new sign needed — cached auth is reused)
      setTimeout(() => setReconnectKey(k => k + 1), 3000);
    };
    ws.onerror = () => setWsError('Connection error');

    return () => {
      ws.onclose = null; // prevent reconnect loop on intentional cleanup
      ws.close();
    };
  }, [serverUrl, address, tableId, reconnectKey]);

  const sendAction = useCallback((action, amount) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'ACTION', payload: { tableId, action, amount } }));
  }, [tableId]);

  const leaveTable = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'LEAVE_TABLE', payload: { tableId } }));
  }, [tableId]);

  const sendRebuyConfirmed = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'REBUY_CONFIRMED', payload: { tableId } }));
  }, [tableId]);

  const refreshTables = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'LIST_TABLES' }));
  }, []);

  const joinWithSeat = useCallback((seatIndex) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'JOIN_TABLE', payload: { tableId, seatIndex, config: tableConfig || undefined } }));
  }, [tableId, tableConfig]);

  return {
    gameState, handOver, tableList, wsStatus, wsError,
    cashoutSig, setCashoutSig,
    cashoutLocked, tableLocked, refundAvailable,
    seatPickerData,
    sendAction, leaveTable, sendRebuyConfirmed, refreshTables, joinWithSeat,
  };
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

  const EXPECTED_CHAIN = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 421614);

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
      const buyInBN    = parseUnits(String(buyIn), 18);
      const bigBlindBN = parseUnits(String(bigBlind), 18);
      // Fetch live fees and add 20% buffer so we don't land below the block base fee
      const fees = await publicClient.estimateFeesPerGas();
      const maxFeePerGas         = fees.maxFeePerGas         ? fees.maxFeePerGas * 120n / 100n : undefined;
      const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas * 120n / 100n : undefined;
      const hash = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: 'createTable',
        args: [buyInBN, bigBlindBN, maxPlayers, gameType, 0n],
        chainId: EXPECTED_CHAIN,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
      setTxHash(hash);
      return hash;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
      return null;
    }
  }, [address, chainId, writeContractAsync, publicClient, EXPECTED_CHAIN]);

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

// ─── HOOK: POKER HANDLE NFT ───────────────────────────────────────────────────
export function useHandle() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: myHandle, refetch: refetchHandle } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "getHandleByAddress",
    args: [address],
    query: { enabled: !!address && !!HANDLE },
  });

  const { data: mintCostRaw } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "getCurrentMintCost",
    query: { enabled: !!HANDLE, refetchInterval: 15000 },
  });

  const { data: currentTierRaw } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "getCurrentTier",
    query: { enabled: !!HANDLE, refetchInterval: 15000 },
  });

  const { data: totalMinted } = useReadContract({
    address: HANDLE, abi: HANDLE_ABI, functionName: "totalMinted",
    query: { enabled: !!HANDLE, refetchInterval: 15000 },
  });

  // Read all four tier costs for the pricing table
  const { data: cost0 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [0n], query: { enabled: !!HANDLE } });
  const { data: cost1 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [1n], query: { enabled: !!HANDLE } });
  const { data: cost2 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [2n], query: { enabled: !!HANDLE } });
  const { data: cost3 } = useReadContract({ address: HANDLE, abi: HANDLE_ABI, functionName: "tierCosts", args: [3n], query: { enabled: !!HANDLE } });

  const mintCost    = mintCostRaw ? Number(formatUnits(mintCostRaw, 18)) : 5000;
  const currentTier = currentTierRaw != null ? Number(currentTierRaw) : 0;
  const DEFAULTS    = [5000, 10000, 15000, 20000];
  const tierCostsCHIPS = [cost0, cost1, cost2, cost3].map((c, i) =>
    c != null ? Number(formatUnits(c, 18)) : DEFAULTS[i]
  );
  const TIER_LABELS = ['$5', '$10', '$15', '$20'];
  const TIER_BOUNDS = [10_000, 110_000, 1_110_000];

  const mint = useCallback(async (handle) => {
    if (!address || !HANDLE || !CHIPS) return;
    setErrorMsg(null);
    try {
      setStatus('approving');
      const costBN = mintCostRaw ?? parseUnits("500", 18);
      const fees = await publicClient.estimateFeesPerGas();
      const feeOverrides = {
        maxFeePerGas:         fees.maxFeePerGas         ? fees.maxFeePerGas * 120n / 100n : undefined,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas * 120n / 100n : undefined,
      };
      const approveTx = await writeContractAsync({
        address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
        args: [HANDLE, costBN], ...feeOverrides,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      setStatus('minting');
      const mintTx = await writeContractAsync({
        address: HANDLE, abi: HANDLE_ABI, functionName: "mintHandle",
        args: [handle], ...feeOverrides,
      });
      setTxHash(mintTx);
      setStatus('idle');
      return mintTx;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [address, mintCostRaw, writeContractAsync, publicClient]);

  useEffect(() => { if (confirmed) refetchHandle(); }, [confirmed, refetchHandle]);

  return {
    myHandle: myHandle || null,
    hasHandle: !!myHandle,
    mintCost,
    currentTier,
    tierCostsCHIPS,
    TIER_LABELS,
    TIER_BOUNDS,
    totalMinted: totalMinted ? Number(totalMinted) : 0,
    mint, status, txHash, confirmed, errorMsg,
    refetch: refetchHandle,
  };
}

// Legacy hook kept for backwards compatibility
export function useGameSocket(serverUrl, address, onMessage) {
  const wsRef   = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!serverUrl || !address) return;
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;
    ws.onopen    = () => setReady(true);
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
    ws.onclose   = () => setReady(false);
    return () => ws.close();
  }, [serverUrl, address]);

  const send = useCallback((type, payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type, payload }));
  }, []);

  return { send, ready };
}
