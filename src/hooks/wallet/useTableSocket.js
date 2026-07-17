// src/hooks/wallet/useTableSocket.js
// The real-time game WebSocket connection: auth, game state, chat, and the
// legacy generic game-socket hook.

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { safeWsUrl, WS_URL } from "./core";

// ─── AUTH CACHE (sessionStorage) ─────────────────────────────────────────────
// Survives page navigation within the same tab so PVP-AUTH fires only once per session.
function getAuthCache(address) {
  try {
    const c = JSON.parse(sessionStorage.getItem('pvp-auth') || 'null');
    return c?.address?.toLowerCase() === address?.toLowerCase() ? c : null;
  } catch { return null; }
}
function setAuthCache(auth) {
  try { sessionStorage.setItem('pvp-auth', JSON.stringify(auth)); } catch {}
}
function clearAuthCache() {
  try { sessionStorage.removeItem('pvp-auth'); } catch {}
}

// ─── HOOK: TABLE WEBSOCKET ────────────────────────────────────────────────────
// Connects, authenticates, and manages real-time game state for a single table.
export function useTableSocket(tableId, tableConfig) {
  const { address }          = useAccount();
  const { signMessageAsync } = useSignMessage();
  const serverUrl            = safeWsUrl(WS_URL);

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
  const [needsRebuy,      setNeedsRebuy]      = useState(null); // { busted: [addr,...] } — set when hero busts out
  const [reconnectKey,    setReconnectKey]    = useState(0);
  const [botStatus,       setBotStatus]       = useState(null); // null | 'spawning' | 'seated' | 'already_seated' | 'error'
  const [chatMessages,    setChatMessages]    = useState([]); // [{ addr, text, ts }]
  const [verifyStatus,    setVerifyStatus]    = useState('idle'); // idle | pending | done | error
  const [verifyFailures,  setVerifyFailures]  = useState([]);
  const wsRef           = useRef(null);
  const authCacheRef    = useRef(null);
  const authFailedRef   = useRef(false); // set true on sign dismiss — breaks infinite reconnect loop
  const tableConfigRef  = useRef(tableConfig); // keep latest config accessible inside ws callbacks
  tableConfigRef.current = tableConfig;

  useEffect(() => {
    if (!serverUrl || !address) return;

    setWsStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(serverUrl);
    } catch (err) {
      console.error('[useTableSocket] WebSocket creation failed:', err);
      setWsError('Unable to connect to game server');
      setWsStatus('disconnected');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      authFailedRef.current = false; // reset on each new connection attempt
      setWsStatus('connected');
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'AUTH_CHALLENGE': {
            signMessageAsync({ message: `PVP-AUTH:${msg.nonce}` })
              .then(signature => {
                if (ws.readyState === WebSocket.OPEN) {
                  authCacheRef.current = { address, nonce: msg.nonce, signature };
                  ws.send(JSON.stringify({ type: 'AUTH', payload: { address, signature } }));
                } else {
                  // Socket died while the wallet app had focus — common on mobile,
                  // where backgrounding the browser to sign can get the tab's
                  // connection killed. Not a decline, so don't set authFailedRef
                  // (that would block the automatic reconnect below); the fresh
                  // connection will issue a new challenge and re-prompt to sign.
                  setWsError('Connection dropped while signing — reconnecting…');
                }
              })
              .catch((err) => {
                // signMessageAsync rejects both for a genuine decline AND for a
                // dropped WalletConnect session (e.g. the wallet app's session
                // times out while the browser tab is backgrounded to sign) — the
                // two look identical here without inspecting the error. Only a
                // real EIP-1193 user rejection (code 4001 / "rejected") should
                // stop auto-reconnect; anything else is more likely a transient
                // session hiccup, so let the fresh connection re-prompt instead
                // of dead-ending on a manual refresh.
                const declined = err?.code === 4001 || err?.name === 'UserRejectedRequestError' ||
                  /reject/i.test(err?.shortMessage || err?.message || '');
                if (declined) {
                  authFailedRef.current = true;
                  setWsError('Signature declined — tap to retry');
                } else {
                  setWsError('Signature request failed — reconnecting…');
                }
                ws.close();
              });
            break;
          }
          case 'AUTH_OK':
            setWsStatus('authed');
            setWsError(null);
            if (tableId) {
              // Always send JOIN_TABLE immediately; include config if available (server uses defaults otherwise)
              ws.send(JSON.stringify({ type: 'JOIN_TABLE', payload: { tableId, config: tableConfigRef.current || undefined } }));
            } else {
              ws.send(JSON.stringify({ type: 'LIST_TABLES' }));
            }
            break;
          case 'AUTH_FAIL':
            clearAuthCache();
            authCacheRef.current = null;
            setWsError(msg.error || 'Authentication failed — check wallet signature');
            break;
          case 'GAME_STATE': {
            setGameState(msg.state);
            setSeatPickerData(null); // seated — dismiss picker
            if (msg.state && address) {
              const hero = msg.state.players?.find(
                p => p.addr?.toLowerCase() === address.toLowerCase()
              );
              if (hero) {
                const locked = (hero.cashoutLockedUntil ?? 0) > (msg.state.handNonce ?? 0);
                setCashoutLocked(locked ? { handsRemaining: (hero.cashoutLockedUntil ?? 0) - (msg.state.handNonce ?? 0) } : null);
                setNeedsRebuy(null); // hero is seated again — clear any pending busted-rebuy prompt
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
            setSeatPickerData({ maxPlayers: msg.maxPlayers, takenSeats: msg.takenSeats || [],
              minBuyIn: msg.minBuyIn, maxBuyIn: msg.maxBuyIn });
            break;
          case 'REBUY_OK':
            break;
          case 'NEEDS_REBUY':
            setNeedsRebuy({ busted: msg.busted || [] });
            break;
          case 'TABLE_LIST':
            setTableList(msg.tables || []);
            break;
          case 'BOT_STATUS':
            setBotStatus(msg.status); // 'seated' | 'already_seated'
            break;
          case 'CHAT':
            setChatMessages(prev => [...prev.slice(-100), { addr: msg.addr, text: msg.text, ts: msg.ts }]);
            break;
          case 'VERIFY_PENDING':
            setVerifyStatus('pending');
            break;
          case 'VERIFY_RESULT':
            setVerifyStatus(msg.pass ? 'done' : 'error');
            setVerifyFailures(msg.failures || []);
            break;
          case 'ERROR':
            setWsError(msg.error);
            if (msg.error?.toLowerCase().includes('bot') || msg.error?.toLowerCase().includes('seat')) {
              setBotStatus('error');
            }
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      wsRef.current = null;
      if (!authFailedRef.current) {
        setTimeout(() => setReconnectKey(k => k + 1), 3000);
      }
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

  const extendTurn = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'EXTEND_TURN', payload: { tableId } }));
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

  const joinWithSeat = useCallback((seatIndex, buyInAmount) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'JOIN_TABLE', payload: { tableId, seatIndex, buyInAmount: buyInAmount || undefined, config: tableConfig || undefined } }));
  }, [tableId, tableConfig]);

  const spawnBot = useCallback((buyInAmount, count) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setBotStatus('spawning');
      wsRef.current.send(JSON.stringify({ type: 'SPAWN_BOT', payload: { tableId, buyIn: buyInAmount, count } }));
    }
  }, [tableId]);

  const sendChat = useCallback((text) => {
    const t = String(text || '').trim();
    if (t && wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'CHAT', payload: { tableId, text: t.slice(0, 200) } }));
  }, [tableId]);

  const sendVerifyHuman = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'VERIFY_HUMAN' }));
  }, []);

  return {
    gameState, handOver, tableList, wsStatus, wsError,
    cashoutSig, setCashoutSig,
    cashoutLocked, tableLocked, refundAvailable,
    seatPickerData, needsRebuy,
    sendAction, extendTurn, leaveTable, sendRebuyConfirmed, refreshTables, joinWithSeat, spawnBot, botStatus,
    chatMessages, sendChat,
    verifyStatus, verifyFailures, sendVerifyHuman,
  };
}

// Legacy hook kept for backwards compatibility
export function useGameSocket(serverUrl, address, onMessage) {
  const wsRef   = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!serverUrl || !address) return;
    let ws;
    try {
      ws = new WebSocket(safeWsUrl(serverUrl));
    } catch (err) {
      console.error('[useGameSocket] WebSocket creation failed:', err);
      return;
    }
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
