import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../../.github/workflows/mobile-debug.yml', import.meta.url), 'utf8');

test('mobile application has an explicit Android/iOS identifier', () => {
  assert.match(config.appId, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/);
  assert.equal(config.appName, 'PokerPals');
  assert.equal(config.webDir, 'www');
});
test('remote app shell is HTTPS-only and pinned to known origin', () => {
  const u = new URL(config.server.url);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.origin, 'https://pokervsplayer.xyz');
  assert.equal(u.pathname, '/');
  assert.equal(u.username, '');
  assert.equal(u.password, '');
  assert.equal(u.search, '');
  assert.equal(u.hash, '');
  assert.equal(config.server.cleartext, false);
  assert.equal(config.android.allowMixedContent, false);
  assert.ok(!Object.hasOwn(config.server, 'allowNavigation'), 'do not weaken navigation policy');
});
test('debug build uses Java 21 and never publishes to stores', () => {
  assert.match(workflow, /java-version:\s*'21'/);
  assert.match(workflow, /assembleDebug/);
  assert.doesNotMatch(workflow, /publish-google-play|upload-app-store|deploy:mainnet|store-upload/);
});
test('mobile scripts never deploy contracts', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const command of Object.values(pkg.scripts)) {
    assert.doesNotMatch(command, /hardhat|deploy:mainnet|etherscan|publish/i);
  }
});
