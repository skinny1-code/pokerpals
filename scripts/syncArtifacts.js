#!/usr/bin/env node
// scripts/syncArtifacts.js — refresh scripts/artifacts/*.json from the Hardhat
// build output. Run after `npm run compile` whenever a contract that has a
// standalone deploy script changes; test/contracts/PinnedArtifacts.test.js
// fails until you do.
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PINNED_DIR   = 'scripts/artifacts';
const COMPILED_DIR = 'artifacts/contracts';

if (!existsSync(COMPILED_DIR)) {
  console.error('[syncArtifacts] no artifacts/contracts — run `npm run compile` first');
  process.exit(1);
}

let changed = 0;
for (const file of readdirSync(PINNED_DIR).filter(f => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');
  let compiled = null;
  for (const dir of readdirSync(COMPILED_DIR)) {
    const p = join(COMPILED_DIR, dir, `${name}.json`);
    if (existsSync(p)) { compiled = JSON.parse(readFileSync(p, 'utf8')); break; }
  }
  if (!compiled) { console.warn(`[syncArtifacts] ⚠️  no compiled contract for ${name} — left as-is`); continue; }

  const target = join(PINNED_DIR, file);
  const before = readFileSync(target, 'utf8');
  const after  = JSON.stringify({ contractName: name, abi: compiled.abi, bytecode: compiled.bytecode });
  if (before === after) { console.log(`[syncArtifacts] ${name}: already in sync`); continue; }
  writeFileSync(target, after);
  console.log(`[syncArtifacts] ✅ ${name}: updated`);
  changed++;
}
console.log(`[syncArtifacts] ${changed} artifact(s) updated`);
