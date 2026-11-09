// Non-signing RPC probe. No private keys, balances, bridge, deployment, or token transfers.
import "dotenv/config";

const NETWORKS = Object.freeze({
  testnet: {
    id: 99801,
    url: process.env.ELYSIUM_TESTNET_RPC || "https://testnet-rpc.elysium.kinetiq.xyz",
    explorer: "https://elysium.kinetiq.xyz/testnet-explorer",
    asset: "test HYPE (no cash value)",
  },
  mainnet: {
    id: 99901,
    url: process.env.ELYSIUM_RPC || "https://rpc.elysium.kinetiq.xyz",
    explorer: "https://elysium.kinetiq.xyz/explorer",
    asset: "HYPE",
  },
});

const kind = process.argv[2] || "testnet";
const cfg = NETWORKS[kind];
if (!cfg) {
  console.error("Usage: node scripts/verifyElysiumReadOnly.mjs testnet|mainnet");
  process.exit(2);
}

async function rpc(method, params = []) {
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status} calling ${method}`);
  const data = await resp.json();
  if (data.error) throw new Error(`RPC error ${method}: ${JSON.stringify(data.error)}`);
  if (typeof data.result !== "string") throw new Error(`Invalid JSON-RPC ${method} result`);
  return data.result;
}

try {
  const chainIdHex = await rpc("eth_chainId");
  const observed = Number(BigInt(chainIdHex));
  if (observed !== cfg.id) {
    throw new Error(`CHAIN_ID_MISMATCH: ${kind} expected ${cfg.id}, RPC returned ${observed}. Refusing to continue.`);
  }
  const block = Number(BigInt(await rpc("eth_blockNumber")));
  console.log(JSON.stringify({
    ok: true, mode: "READ_ONLY", network: kind, chainId: observed,
    lastObservedBlock: block, gasAsset: cfg.asset, explorer: cfg.explorer,
    warning: "RPC availability is NOT evidence that PokerVsPlayer native-HYPE gaming or licensing is ready.",
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false, mode: "READ_ONLY", network: kind, expectedChainId: cfg.id,
    error: String(error?.message || error), action: "Verify official Kinetiq endpoint and TLS; do not change chain ID to bypass mismatch.",
  }, null, 2));
  process.exit(1);
}
