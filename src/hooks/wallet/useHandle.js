// src/hooks/wallet/useHandle.js
// Poker Handle NFT — mint/rename, batch address->handle lookups, avatars,
// and the generated-name fallback so a raw wallet address is never shown
// to other players.

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { formatUnits } from "viem";
import { wagmiConfig, safeFeeOverrides, hasAllowance, CHIPS_ABI, SALOON, HANDLE_ABI, HANDLE, wsHttpUrl } from "./core";

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

  const { data: totalMinted, refetch: refetchTotalMinted } = useReadContract({
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
    if (!address || !HANDLE || !SALOON) return;
    setErrorMsg(null);
    if (!mintCostRaw) { setErrorMsg('Loading mint cost — please wait a moment and try again.'); setStatus('error'); return; }
    try {
      const costBN = mintCostRaw;
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, HANDLE, costBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: SALOON, abi: CHIPS_ABI, functionName: "approve",
          args: [HANDLE, costBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('minting');
      const mintTx = await writeContractAsync({
        address: HANDLE, abi: HANDLE_ABI, functionName: "mintHandle",
        args: [handle], gas: 400_000n, ...feeOverrides,
      });
      setTxHash(mintTx);
      await waitForTransactionReceipt(wagmiConfig, { hash: mintTx, timeout: 60_000 });
      await refetchHandle();
      await refetchTotalMinted();
      setStatus('idle');
      return mintTx;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [address, mintCostRaw, writeContractAsync, publicClient, refetchHandle, refetchTotalMinted]);

  const changeHandle = useCallback(async (newHandle) => {
    if (!address || !HANDLE || !SALOON) return;
    setErrorMsg(null);
    if (!mintCostRaw) { setErrorMsg('Loading rename cost — please wait a moment and try again.'); setStatus('error'); return; }
    try {
      const costBN = mintCostRaw;
      const feeOverrides = await safeFeeOverrides(publicClient);
      if (!(await hasAllowance(publicClient, address, HANDLE, costBN))) {
        setStatus('approving');
        const approveTx = await writeContractAsync({
          address: SALOON, abi: CHIPS_ABI, functionName: "approve",
          args: [HANDLE, costBN], ...feeOverrides,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, timeout: 30_000 });
      }
      setStatus('changing');
      const changeTx = await writeContractAsync({
        address: HANDLE, abi: HANDLE_ABI, functionName: "changeHandle",
        args: [newHandle], gas: 400_000n, ...feeOverrides,
      });
      setTxHash(changeTx);
      await waitForTransactionReceipt(wagmiConfig, { hash: changeTx, timeout: 60_000 });
      await refetchHandle();
      setStatus('idle');
      return changeTx;
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [address, mintCostRaw, writeContractAsync, publicClient, refetchHandle]);

  useEffect(() => {
    if (confirmed) {
      refetchHandle();
      refetchTotalMinted();
    }
  }, [confirmed, refetchHandle, refetchTotalMinted]);

  return {
    myHandle: myHandle || null,
    hasHandle: !!myHandle,
    mintCost,
    currentTier,
    tierCostsCHIPS,
    TIER_LABELS,
    TIER_BOUNDS,
    totalMinted: totalMinted ? Number(totalMinted) : 0,
    mint, changeHandle, status, txHash, confirmed, errorMsg,
    refetch: refetchHandle,
  };
}

// ─── DISPLAY NAME (never show a raw wallet address to other players) ────────
const NAME_ADJECTIVES = [
  'Silver','Crimson','Golden','Shadow','Lucky','Iron','Velvet','Neon',
  'Midnight','Rogue','Royal','Wild','Frozen','Blazing','Quiet','Savage',
  'Electric','Amber','Cosmic','Rusty',
];
const NAME_NOUNS = [
  'Shark','Ace','Bluff','Chip','Raider','Wolf','Falcon','Bandit',
  'Cobra','Maverick','Grinder','Hustler','Viper','Rabbit','Ghost','Outlaw',
  'Whale','Jackal','Panther','Rider',
];

// Deterministic djb2-style hash — same address always yields the same name,
// on any device, with no persistence needed.
function hashAddress(address) {
  let h = 5381;
  for (let i = 0; i < address.length; i++) h = ((h * 33) ^ address.charCodeAt(i)) >>> 0;
  return h;
}

/** A free, deterministic display name for a wallet that hasn't minted a Poker
 * Handle yet — e.g. "SilverShark482". Never returns a raw address. */
export function generatedNameForAddress(address) {
  if (!address) return 'Player';
  const h = hashAddress(address.toLowerCase());
  const adj = NAME_ADJECTIVES[h % NAME_ADJECTIVES.length];
  const noun = NAME_NOUNS[(h >>> 8) % NAME_NOUNS.length];
  const num = (h >>> 16) % 1000;
  return `${adj}${noun}${num}`;
}

// ─── HOOK: HANDLE MAP (batch lookup address → handle, free username, or a generated name) ──
export function useHandleMap(addresses) {
  const cleaned = useMemo(() => (addresses || []).filter(Boolean), [addresses?.join(',')]);
  const { data } = useReadContracts({
    contracts: cleaned.map(addr => ({
      address: HANDLE, abi: HANDLE_ABI,
      functionName: 'getHandleByAddress', args: [addr],
    })),
    query: { enabled: !!HANDLE && cleaned.length > 0 },
  });

  // Free, off-chain usernames (server/usernameStore.js) — the fallback between a
  // minted PokerHandle NFT and the last-resort generated name.
  const [usernames, setUsernames] = useState({});
  useEffect(() => {
    const base = wsHttpUrl();
    if (!base || cleaned.length === 0) { setUsernames({}); return; }
    let cancelled = false;
    fetch(`${base}/usernames?addresses=${cleaned.join(',')}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setUsernames(j.usernames || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cleaned.join(',')]);

  return useMemo(() => {
    const map = {};
    cleaned.forEach((addr, i) => {
      const h = data?.[i]?.result;
      const lc = addr.toLowerCase();
      map[lc] = h || usernames[lc] || generatedNameForAddress(addr);
    });
    return map;
  }, [data, cleaned, usernames]);
}

// ─── HOOK: HANDLE AVATARS (on-chain NFT image per address) ───────────────────
export function useHandleAvatars(addresses) {
  const cleaned = useMemo(() => (addresses || []).filter(Boolean), [addresses?.join(',')]);

  const { data: tokenIdData } = useReadContracts({
    contracts: cleaned.map(addr => ({
      address: HANDLE, abi: HANDLE_ABI,
      functionName: 'ownerTokenId', args: [addr],
    })),
    query: { enabled: !!HANDLE && cleaned.length > 0, refetchInterval: 5000 },
  });

  const validEntries = useMemo(() => {
    if (!tokenIdData) return [];
    return cleaned.map((addr, i) => {
      const tokenId = tokenIdData[i]?.result;
      return tokenId && tokenId > 0n ? { addr, tokenId } : null;
    }).filter(Boolean);
  }, [tokenIdData, cleaned]);

  const { data: uriData } = useReadContracts({
    contracts: validEntries.map(({ tokenId }) => ({
      address: HANDLE, abi: HANDLE_ABI,
      functionName: 'tokenURI', args: [tokenId],
    })),
    query: { enabled: validEntries.length > 0, refetchInterval: 5000 },
  });

  return useMemo(() => {
    const map = {};
    validEntries.forEach(({ addr }, i) => {
      const uri = uriData?.[i]?.result;
      if (!uri) return;
      try {
        const json = JSON.parse(atob(uri.replace('data:application/json;base64,', '')));
        if (json.image) map[addr.toLowerCase()] = json.image;
      } catch {}
    });
    return map;
  }, [uriData, validEntries]);
}
