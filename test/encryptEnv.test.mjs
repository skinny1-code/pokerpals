/**
 * encryptEnv guard tests — pure Node.js. Run: node test/encryptEnv.test.mjs
 *
 * .env.enc is committed, so anything this classifier misses gets sealed into git
 * history permanently. It errs toward refusing.
 */
import { findSecrets } from '../scripts/encryptEnv.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else      { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const flags = env => findSecrets(env);
const blocks = (name, env) => check(name, flags(env).length > 0, `allowed: ${env}`);
const allows = (name, env) => check(name, flags(env).length === 0, `flagged ${flags(env)}`);

console.log('populated secrets are refused');
{
  blocks('private key',        'OPERATOR_PRIVATE_KEY=0x' + 'a'.repeat(64));
  blocks('deployer key',       'DEPLOYER_KEY=0x' + 'b'.repeat(64));
  blocks('api key',            'ALCHEMY_API_KEY=abc123def456');
  blocks('arbiscan key',       'ARBISCAN_API_KEY=XYZ987');
  blocks('a passphrase',       'ENV_PASSPHRASE=hunter2');
  blocks('a dev secret',       'DEV_VERIFY_SECRET=letmein');
  blocks('keyed alchemy rpc',  'ARB_SEPOLIA_RPC=https://arb-sepolia.g.alchemy.com/v2/rEaLkEy12345678');
  blocks('key in an innocent name', 'BACKUP=0x' + 'c'.repeat(64));
  blocks('bare hex key, no 0x',     'STASH=' + 'd'.repeat(64));
  blocks('a bip-39 mnemonic',
    'NOTES=' + ('abandon '.repeat(11)) + 'about');
  blocks('quoted value',       'OPERATOR_PRIVATE_KEY="0x' + 'e'.repeat(64) + '"');
  blocks('spaces around =',    'DEPLOYER_KEY = 0x' + 'f'.repeat(64));
}

console.log('public configuration is allowed through');
{
  allows('contract address',   'NEXT_PUBLIC_ESCROW=0x3CACF9dcA501503761505cb3F1123c387a567d65');
  allows('chain id',           'NEXT_PUBLIC_CHAIN_ID=421614');
  allows('ws url',             'NEXT_PUBLIC_WS_URL=wss://pokerpals-server.fly.dev');
  allows('frontend origin',    'FRONTEND_ORIGIN=https://pokervsplayer.xyz');
  allows('feature flag',       'SPONSOR_CASHOUT=true');
  allows('walletconnect id',   'WC_PROJECT_ID=9f2b1c7de4a6');
  allows('public rpc, no key', 'ARB_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc');
  allows('a comment',          '# DEPLOYER_KEY=0x' + 'a'.repeat(64));
  allows('blank line',         '\n\n   \n');
  allows('empty secret slot',  'DEPLOYER_KEY=');
  allows('empty with spaces',  'OPERATOR_PRIVATE_KEY=   ');
  allows('a NEXT_PUBLIC token', 'NEXT_PUBLIC_WC_PROJECT_ID=9f2b1c7de4a6');
}

console.log('a realistic public-only .env passes whole');
{
  const env = [
    '# Saloon environment',
    'NEXT_PUBLIC_CHAIN_ID=421614',
    'NEXT_PUBLIC_ESCROW=0x3CACF9dcA501503761505cb3F1123c387a567d65',
    'NEXT_PUBLIC_STAKING=0x0f12039a3837cDBcd466BD202a39A69797c16d96',
    'DEPLOYER_KEY=',
    'OPERATOR_PRIVATE_KEY=',
    'ALCHEMY_API_KEY=',
    'SPONSOR_CASHOUT=true',
  ].join('\n');
  check('no findings', flags(env).length === 0, `flagged ${flags(env)}`);
}

console.log('a mixed .env reports every offender, not just the first');
{
  const env = [
    'NEXT_PUBLIC_ESCROW=0x3CACF9dcA501503761505cb3F1123c387a567d65',
    'DEPLOYER_KEY=0x' + '1'.repeat(64),
    'OPERATOR_PRIVATE_KEY=0x' + '2'.repeat(64),
    'ALCHEMY_API_KEY=zzz',
  ].join('\n');
  const f = flags(env);
  check('all three flagged', f.length === 3, JSON.stringify(f));
  check('the public address is not flagged', !f.includes('NEXT_PUBLIC_ESCROW'));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
