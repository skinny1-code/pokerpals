import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateGameApiUrl, loadTables } from '../src/api.mjs';
const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
test('native Android + iOS identifiers configured', () => {
  assert.match(config.android.package, /^com\./);
  assert.match(config.ios.bundleIdentifier, /^com\./);
});
test('API rejects insecure or credentialed origins', () => {
  for (const x of ['http://example.org','https://user:pass@example.org','https://example.org/path','https://example.org/?x=1']) assert.throws(()=>validateGameApiUrl(x));
  assert.equal(validateGameApiUrl('https://example.org'), 'https://example.org');
});
test('native lobby consumes real server table schema', async () => {
  let request;
  const fetcher = async (url) => {request=url;return {ok:true,json:async()=>({tables:[{id:'15',config:{buyIn:300},seated:2,phase:'waiting'}]})};};
  const result=await loadTables(fetcher,'https://example.org');
  assert.equal(request,'https://example.org/tables');
  assert.equal(result[0].id,'15');
  assert.equal(result[0].config.buyIn,300);
});
test('broken server response fails visibly instead of inventing tables', async () => {
  await assert.rejects(loadTables(async()=>({ok:true,json:async()=>({})}),'https://example.org'));
});
test('app does not render a website or use WebView',()=>{
  const src=readFileSync(new URL('../App.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/WebView|react-native-webview|source=\{\{\s*uri/);
  assert.match(src,/FlatList/);
  assert.match(src,/Pressable/);
});
