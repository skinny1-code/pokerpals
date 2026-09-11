#!/usr/bin/env node
// scripts/slitherCheck.js — run Slither and fail on anything not already triaged.
//
//   npm run slither            # report + compare against the baseline
//   npm run slither -- --update-baseline
//
// Every finding in security/slither-baseline.json has been reviewed and written
// up in docs/SLITHER.md. The point of the baseline is that a NEW finding is
// loud: suppressing detectors wholesale would also hide the next real one.
//
// Findings are keyed by (detector, file, element) rather than line number, so
// they survive edits that move code around.
//
// Needs slither on PATH: pip install slither-analyzer
// It reads the existing Hardhat build (--ignore-compile), so run `npm run
// compile` first; solc-select cannot fetch binaries in a sandboxed network.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASELINE = 'security/slither-baseline.json';
const KEEP_IMPACT = new Set(['High', 'Medium']);

function run() {
  const out = join(mkdtempSync(join(tmpdir(), 'slither-')), 'report.json');
  const r = spawnSync('slither', ['.', '--ignore-compile', '--json', out],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  if (!existsSync(out)) {
    console.error('[slither] did not produce a report.');
    console.error((r.stderr || r.stdout || '').split('\n').slice(-15).join('\n'));
    console.error('\nIs slither installed?  pip install slither-analyzer');
    process.exit(2);
  }
  return JSON.parse(readFileSync(out, 'utf8'));
}

/** Findings in our own contracts, keyed stably. */
function ourFindings(report) {
  const out = new Map();
  for (const d of report.results?.detectors || []) {
    if (!KEEP_IMPACT.has(d.impact)) continue;
    const el = (d.elements || []).find(e =>
      (e.source_mapping?.filename_relative || '').startsWith('contracts/'));
    if (!el) continue;
    const file = el.source_mapping.filename_relative;
    const key  = `${d.check}|${file}|${el.type}:${el.name}`;
    if (!out.has(key)) {
      out.set(key, {
        key, check: d.check, impact: d.impact, file,
        element: `${el.type} ${el.name}`,
        line: el.source_mapping.lines?.[0] ?? null,
      });
    }
  }
  return out;
}

const findings = ourFindings(run());
const sorted = [...findings.values()].sort((a, b) => a.key.localeCompare(b.key));

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE, JSON.stringify({
    note: 'Reviewed Slither findings. Each is explained in docs/SLITHER.md. ' +
          'Regenerate with: npm run slither -- --update-baseline',
    generated: new Date().toISOString().slice(0, 10),
    findings: sorted.map(({ key, check, impact, file, element }) => ({ key, check, impact, file, element })),
  }, null, 2) + '\n');
  console.log(`[slither] baseline written: ${sorted.length} finding(s)`);
  process.exit(0);
}

const known = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).findings.map(f => f.key))
  : new Set();

const fresh = sorted.filter(f => !known.has(f.key));
const gone  = [...known].filter(k => !findings.has(k));

console.log(`[slither] ${sorted.length} High/Medium finding(s) in contracts/ — ${known.size} triaged`);
for (const f of sorted) {
  const mark = known.has(f.key) ? '   ' : ' + ';
  console.log(`${mark}${f.impact.padEnd(7)} [${f.check}] ${f.file}:${f.line}  ${f.element}`);
}
if (gone.length) {
  console.log(`\n${gone.length} baselined finding(s) no longer reported (code changed?):`);
  for (const k of gone) console.log(`  - ${k}`);
  console.log('Re-run with --update-baseline once you have confirmed why.');
}
if (fresh.length) {
  console.error(`\n❌ ${fresh.length} NEW finding(s) — review, then document in docs/SLITHER.md:`);
  for (const f of fresh) console.error(`  + ${f.impact} [${f.check}] ${f.file}:${f.line}  ${f.element}`);
  process.exit(1);
}
console.log('\n✅ No new findings.');
