// src/hooks/usePokerWallet.js
// wagmi v2 + viem — real EVM wallet integration

import { useEffect, useState, useCallback, useRef } from "react";
import { createConfig, http, useAccount, useConnect, useDisconnect,
         useReadContract, useWriteContract, useWaitForTransactionReceipt,
         useBalance } from "wagmi";
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
// backwards-compat alias
export const PPP_ABI = CHIPS_ABI;

export const ESCROW_ABI = [
  { name:"buyIn",       type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"rebuy",       type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"},{name:"amount",type:"uint256"}], outputs:[] },
  { name:"refund",      type:"function", stateMutability:"nonpayable",
    inputs:[{name:"tableId",type:"uint256"}], outputs:[] },
  { name:"humanVerified", type:"function", stateMutability:"view",
    inputs:[{name:"addr",type:"address"}], outputs:[{type:"bool"}] },
  { name:"getTableInfo", type:"function", stateMutability:"view",
    inputs:[{name:"tableId",type:"uint256"}],
    outputs:[
      {name:"id",type:"uint256"},{name:"buyIn",type:"uint256"},{name:"bigBlind",type:"uint256"},
      {name:"maxPlayers",type:"uint8"},{name:"gameType",type:"uint8"},
      {name:"status",type:"uint8"},{name:"pot",type:"uint256"},
      {name:"handNonce",type:"uint256"},{name:"seated",type:"uint8"},
    ]},
];

const CHIPS  = process.env.NEXT_PUBLIC_CHIPS_TOKEN || process.env.NEXT_PUBLIC_PPP_TOKEN;
const ESCROW = process.env.NEXT_PUBLIC_ESCROW;

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

// ─── HOOK: WEBSOCKET ──────────────────────────────────────────────────────────
export function useGameSocket(serverUrl, address, onMessage) {
  const wsRef   = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!serverUrl || !address) return;
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      // Auth: sign a nonce
      const nonce = Date.now().toString();
      // In real app, use ethers/viem to sign — here we show the pattern
      // const sig = await signer.signMessage(`PPP-AUTH:${nonce}`);
      // ws.send(JSON.stringify({ type:'AUTH', payload:{ address, signature:sig, nonce } }));
      setReady(true);
    };

    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch {}
    };

    ws.onclose  = () => setReady(false);
    ws.onerror  = (e) => console.error("WS error:", e);

    return () => ws.close();
  }, [serverUrl, address]);

  const send = useCallback((type, payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type, payload }));
  }, []);

  return { send, ready };
}
