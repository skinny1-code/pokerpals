// src/hooks/wallet/useUsername.js
// Free, off-chain display username — claimed once via a signed message (no CHIPS,
// no gas). Separate from the paid PokerHandle NFT (useHandle.js), which stays the
// "verified" badge required for tournaments/events (see useTournaments.js). Backed
// by the game server's small JSON store (server/usernameStore.js), read/written
// over plain HTTP on the same port as the WebSocket connection.

import { useState, useCallback, useEffect } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { wsHttpUrl } from "./core";

export function useUsername() {
  const { address }          = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [username, setUsername] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [status, setStatus]     = useState('idle'); // idle | claiming | error
  const [error, setError]       = useState(null);

  const refetch = useCallback(async () => {
    const base = wsHttpUrl();
    if (!base || !address) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${base}/usernames?addresses=${address}`);
      const json = await res.json();
      setUsername(json.usernames?.[address.toLowerCase()] || null);
    } catch (e) {
      console.warn('[useUsername] fetch failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { refetch(); }, [refetch]);

  const claim = useCallback(async (desired) => {
    const base = wsHttpUrl();
    if (!base || !address) return;
    setError(null);
    setStatus('claiming');
    try {
      const signature = await signMessageAsync({ message: `PVP-CLAIM-USERNAME:${desired}` });
      const res = await fetch(`${base}/claim-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, username: desired }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || 'Could not claim that username.');
        setStatus('error');
        return;
      }
      setUsername(json.username);
      setStatus('idle');
      return json.username;
    } catch (e) {
      setError(e?.shortMessage || e?.message || 'Signature failed or was rejected.');
      setStatus('error');
    }
  }, [address, signMessageAsync]);

  return { username, hasUsername: !!username, loading, claim, status, error, refetch };
}
