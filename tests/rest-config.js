const assert = require('assert');

const { baseURL, client } = require('./http');

async function testRestGetConfigFull() {
  const url = `${baseURL}/rest/getConfig`;
  console.log(`[rest-config] GET ${url}`);
  const { status, data: json } = await client.get(url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  console.log('[rest-config] Response (full):', JSON.stringify(json).slice(0, 30), "...");
  assert.strictEqual(json.id, 'CONFIG_FULL');
  assert.ok(json.config && typeof json.config === 'object');
  console.log('[rest-config] GET_CONFIG OK');
}

async function testRestGetConfigSingle() {
  const key = '__nonexistent_key__';
  const url = `${baseURL}/rest/getConfig?key=${encodeURIComponent(key)}`;
  console.log(`[rest-config] GET ${url}`);
  const { status, data: json } = await client.get(url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  console.log('[rest-config] Response (single):', JSON.stringify(json).slice(0, 30), "...");
  assert.strictEqual(json.id, 'CONFIG_SINGLE');
  assert.strictEqual(json.key, key);
  // Value may be undefined and omitted; ensure contract for id/key only.
  console.log('[rest-config] getConfig (single) OK');
}

async function main() {
  await testRestGetConfigFull();
  await testRestGetConfigSingle();
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { testRestGetConfigFull, testRestGetConfigSingle };


