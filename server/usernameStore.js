// server/usernameStore.js — free, off-chain display username store (address -> username).
// No CHIPS/gas cost: claimed once via a signed message and persisted to a small JSON
// file next to the server process. Separate from the paid PokerHandle NFT
// (contracts/PokerHandle.sol), which remains the "verified" badge required for
// tournaments/events — see useHandle.js / useRegisterTournament().

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, "data");
const DATA_FILE = join(DATA_DIR, "usernames.json");

// Same shape as the on-chain PokerHandle rules: 3-20 chars, alphanumeric + underscore.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function load() {
  try { return JSON.parse(readFileSync(DATA_FILE, "utf8")); }
  catch { return {}; }
}

// addr(lowercased) -> username
const store = load();
// username(lowercased) -> addr(lowercased), for O(1) uniqueness checks
const byUsername = new Map(Object.entries(store).map(([addr, u]) => [u.toLowerCase(), addr]));

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('[usernameStore] persist failed:', e.message);
  }
}

export function getUsername(address) {
  if (!address) return null;
  return store[address.toLowerCase()] || null;
}

export function getUsernames(addresses) {
  const out = {};
  for (const a of addresses) {
    if (!a) continue;
    out[a.toLowerCase()] = getUsername(a);
  }
  return out;
}

export function claimUsername(address, username) {
  const addr = address.toLowerCase();
  const name = String(username || '').trim();
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: 'Username must be 3-20 characters: letters, numbers, underscore only.' };
  }
  const existing = store[addr];
  if (existing && existing.toLowerCase() === name.toLowerCase()) {
    return { ok: true, username: existing }; // idempotent re-claim of the same name
  }
  const takenBy = byUsername.get(name.toLowerCase());
  if (takenBy && takenBy !== addr) {
    return { ok: false, error: 'That username is already taken.' };
  }
  if (existing) byUsername.delete(existing.toLowerCase());
  store[addr] = name;
  byUsername.set(name.toLowerCase(), addr);
  persist();
  return { ok: true, username: name };
}
