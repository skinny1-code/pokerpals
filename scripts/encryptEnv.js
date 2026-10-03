#!/usr/bin/env node
// scripts/encryptEnv.js — encrypt .env → .env.enc, refusing to encrypt secrets.
//
// .env.enc is COMMITTED so cloud sessions can rebuild a working .env from the
// ENV_PASSPHRASE held in environment secrets. That is only safe while the file
// contains nothing but public configuration: committed ciphertext is permanent
// (git history keeps every version), the passphrase is a human-chosen string,
// and an offline attacker has unlimited time. So this script is the gate — it
// refuses outright if .env holds a populated private key, RPC URL with an
// embedded key, or API token, instead of silently sealing it into history.
//
// Usage: ENV_PASSPHRASE=… node scripts/encryptEnv.js [inFile] [outFile]

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Anything whose VALUE is a secret. NEXT_PUBLIC_* is exempt by definition: it is
// compiled into the browser bundle, so it is already public.
const SECRET_NAME = /(_KEY|KEY_|^KEY$|PRIVATE|SECRET|PASSPHRASE|PASSWORD|MNEMONIC|SEED|TOKEN|CREDENTIAL)/i;
// Names that match the pattern above but hold public data.
const PUBLIC_ALLOW = new Set([
  'WC_PROJECT_ID',            // WalletConnect project id — public by design
  'NEXT_PUBLIC_WC_PROJECT_ID',
]);

/** An RPC URL with the provider key in the path, e.g. …/v2/<apiKey>. */
const KEYED_RPC = /^https?:\/\/[^\s]*\/(v2|v3)\/[A-Za-z0-9_-]{8,}/;
/** A raw secp256k1 private key, whatever the variable happens to be called. */
const RAW_PRIVATE_KEY = /^(0x)?[A-Fa-f0-9]{64}$/;
/** A BIP-39 mnemonic (12/15/18/21/24 lowercase words). */
const MNEMONIC = /^([a-z]+\s+){11,23}[a-z]+$/;

export function findSecrets(envText) {
  const found = [];
  for (const raw of envText.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, name, rawValue] = m;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (!value) continue;                       // empty slot — nothing to leak
    if (PUBLIC_ALLOW.has(name)) continue;
    if (name.startsWith('NEXT_PUBLIC_')) continue;
    // Name-based detection catches the obvious ones; value-based detection
    // catches a key smuggled into an innocuously named variable.
    if (SECRET_NAME.test(name) || KEYED_RPC.test(value)
        || RAW_PRIVATE_KEY.test(value) || MNEMONIC.test(value)) found.push(name);
  }
  return found;
}

function main() {
  const inFile  = process.argv[2] || '.env';
  const outFile = process.argv[3] || '.env.enc';

  if (!existsSync(inFile)) {
    console.error(`[encryptEnv] ${inFile} not found — nothing to encrypt`);
    process.exit(1);
  }
  if (!process.env.ENV_PASSPHRASE) {
    console.error('[encryptEnv] ENV_PASSPHRASE is not set — refusing to encrypt');
    process.exit(1);
  }

  const secrets = findSecrets(readFileSync(inFile, 'utf8'));
  if (secrets.length) {
    console.error(
      `[encryptEnv] REFUSING to encrypt: ${inFile} holds ${secrets.length} populated ` +
      `secret value(s) and ${outFile} is committed to git.\n` +
      secrets.map(n => `  - ${n}`).join('\n') +
      `\n\nCommitted ciphertext is permanent. Keep real keys in the deployment ` +
      `platform's secret store (GitHub Actions secrets, Fly secrets, Vercel env, ` +
      `Claude Code environment secrets) and leave these blank in ${inFile}.`
    );
    process.exit(1);
  }

  // -pass env: keeps the passphrase out of the process list and CI logs, unlike
  // -pass pass:. -iter raises PBKDF2 well above openssl's 10k default.
  const r = spawnSync('openssl', [
    'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '600000',
    '-pass', 'env:ENV_PASSPHRASE', '-in', inFile, '-out', outFile,
  ], { stdio: 'inherit' });

  if (r.status !== 0) {
    console.error('[encryptEnv] openssl failed');
    process.exit(r.status || 1);
  }
  console.log(`[encryptEnv] ✅ ${inFile} → ${outFile} (public configuration only)`);
}

// Only run when invoked directly, so the classifier stays importable by tests.
if (process.argv[1] && process.argv[1].endsWith('encryptEnv.js')) main();
