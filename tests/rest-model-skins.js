const assert = require('assert');

const { baseURL, client } = require('./http');

async function testGetModelSkinsMissingParam() {
  const url = `${baseURL}/rest/getModelSkins`;
  console.log(`[rest-model-skins] GET ${url}`);
  const { status, data: json } = await client.get(url);
  console.log('[rest-model-skins] Response (missing):', status, JSON.stringify(json));
  assert.strictEqual(status, 400);
  assert.strictEqual(json.id, 'ERR_INVALID_PARAMETERS');
  console.log('[rest-model-skins] missing param OK');
}

async function testGetModelSkinsInvalidParam() {
  const url = `${baseURL}/rest/getModelSkins?fileDataID=${encodeURIComponent('abc')}`;
  console.log(`[rest-model-skins] GET ${url}`);
  const { status, data: json } = await client.get(url);
  console.log('[rest-model-skins] Response (invalid):', status, JSON.stringify(json));
  assert.strictEqual(status, 400);
  assert.strictEqual(json.id, 'ERR_INVALID_PARAMETERS');
  console.log('[rest-model-skins] invalid param OK');
}

async function main() {
  await testGetModelSkinsMissingParam();
  await testGetModelSkinsInvalidParam();
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { testGetModelSkinsMissingParam, testGetModelSkinsInvalidParam };


