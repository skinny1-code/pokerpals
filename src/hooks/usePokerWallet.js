// src/hooks/usePokerWallet.js
// wagmi v2 + viem — real EVM wallet integration

import { useEffect, useState, useCallback, useRef } from "react";
import { createConfig, http, useAccount, useConnect, useDisconnect,
         useReadContract, useWriteContract, useWaitForTransactionReceipt,
         useBalance, useSignMessage } from "wagmi";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { parseUnits, formatUnits } from "viem";

// ─── WAGMI CONFIG (export and wrap your app in <WagmiProvider config={wagmiConfig}>) ──
export const wagmiConfig = createConfig({
  chains:     [arbitrum, arbitrumSepolia],
  transports: {
    [arbitrum.id]:        http(),
    [arbitrumSepolia.id]: http(),
  },
  connectors: [
    injected(),
    walletConnect({ projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID }),
  ],
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
  { name:"TableCreated", type:"event",
    inputs:[
      {name:"id",type:"uint256",indexed:true},
      {name:"creator",type:"address",indexed:true},
      {name:"buyIn",type:"uint256",indexed:false},
      {name:"g",type:"uint8",indexed:false},
    ]},
];

const CHIPS   = process.env.NEXT_PUBLIC_CHIPS_TOKEN || process.env.NEXT_PUBLIC_PPP_TOKEN;
const ESCROW  = process.env.NEXT_PUBLIC_ESCROW;
const STAKING = process.env.NEXT_PUBLIC_STAKING;

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
  const [txHash, setTxHash]   = useState(null);
  const [status, setStatus]   = useState('idle'); // idle | approving | buying | settling | error

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Approve + BuyIn in one flow
  const buyIn = useCallback(async (buyInAmount) => {
    if (!address || !tableId) return;
    try {
      setStatus('approving');
      const amountBN = parseUnits(String(buyInAmount), 18);
      // Step 1: Approve escrow to spend CHIPS
      const approveTx = await writeContractAsync({
        address: CHIPS, abi: CHIPS_ABI, functionName: "approve",
        args: [ESCROW, amountBN],
      });
      setTxHash(approveTx);
      // Wait for approval
      await new Promise(r => setTimeout(r, 4000));
      // Step 2: Buy in
      setStatus('buying');
      const buyInTx = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: "buyIn",
        args: [BigInt(tableId)],
      });
      setTxHash(buyInTx);
      setStatus('idle');
      return buyInTx;
    } catch (e) {
      console.error("buyIn error:", e);
      setStatus('error');
    }
  }, [address, tableId, writeContractAsync]);

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

  // Table info read
  const { data: tableInfo } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: "getTableInfo",
    args: [BigInt(tableId || 0)],
    query: { enabled: !!tableId, refetchInterval: 5000 },
  });

  return { buyIn, refund, txHash, status, confirmed, tableInfo };
}

// ─── HOOK: TABLE WEBSOCKET ────────────────────────────────────────────────────
// Connects, authenticates, and manages real-time game state for a single table.
export function useTableSocket(tableId) {
  const { address }          = useAccount();
  const { signMessageAsync } = useSignMessage();
  const serverUrl            = process.env.NEXT_PUBLIC_WS_URL;

  const [gameState, setGameState] = useState(null);
  const [handOver,  setHandOver]  = useState(null);
  const [tableList, setTableList] = useState([]);
  const [wsStatus,  setWsStatus]  = useState('disconnected');
  const [wsError,   setWsError]   = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!serverUrl || !address) return;

    setWsStatus('connecting');
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      setWsStatus('connected');
      try {
        const nonce     = Date.now().toString();
        const signature = await signMessageAsync({ message: `PPP-AUTH:${nonce}` });
        ws.send(JSON.stringify({ type: 'AUTH', payload: { address, signature, nonce } }));
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
            if (tableId) ws.send(JSON.stringify({ type: 'JOIN_TABLE', payload: { tableId } }));
            else         ws.send(JSON.stringify({ type: 'LIST_TABLES' }));
            break;
          case 'AUTH_FAIL':
            setWsError('Authentication failed — check wallet signature');
            break;
          case 'GAME_STATE':
            setGameState(msg.state);
            setHandOver(null);
            break;
          case 'HAND_OVER':
            setHandOver(msg);
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

    ws.onclose  = () => { setWsStatus('disconnected'); wsRef.current = null; };
    ws.onerror  = () => setWsError('Connection error');

    return () => { ws.close(); };
  }, [serverUrl, address, tableId]);

  const sendAction = useCallback((action, amount) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'ACTION', payload: { tableId, action, amount } }));
  }, [tableId]);

  const leaveTable = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'LEAVE_TABLE', payload: { tableId } }));
  }, [tableId]);

  const refreshTables = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'LIST_TABLES' }));
  }, []);

  return { gameState, handOver, tableList, wsStatus, wsError, sendAction, leaveTable, refreshTables };
}

// ─── HOOK: CREATE TABLE ───────────────────────────────────────────────────────
export function useCreateTable() {
  const { address }            = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash]    = useState(null);
  const [status, setStatus]    = useState('idle');

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (receipt?.status === 'success') setStatus('confirmed');
  }, [receipt]);

  const createTable = useCallback(async ({ buyIn, bigBlind, maxPlayers, gameType }) => {
    if (!address) return null;
    setStatus('pending');
    try {
      const buyInBN    = parseUnits(String(buyIn), 18);
      const bigBlindBN = parseUnits(String(bigBlind), 18);
      const hash = await writeContractAsync({
        address: ESCROW, abi: ESCROW_ABI, functionName: 'createTable',
        args: [buyInBN, bigBlindBN, maxPlayers, gameType, 0n],
      });
      setTxHash(hash);
      return hash;
    } catch (e) {
      console.error('createTable error:', e);
      setStatus('error');
      return null;
    }
  }, [address, writeContractAsync]);

  // Extract tableId from receipt logs (TableCreated event first indexed param)
  const newTableId = receipt?.logs?.[0]
    ? (() => {
        try {
          const idHex = receipt.logs[0].topics?.[1];
          return idHex ? BigInt(idHex).toString() : null;
        } catch { return null; }
      })()
    : null;

  return { createTable, status, txHash, newTableId };
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
