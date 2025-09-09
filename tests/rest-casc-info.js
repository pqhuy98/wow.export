const assert = require('assert');

const { baseURL, client } = require('./http');

async function testRestGetCascInfo() {
  const url1 = `${baseURL}/rest/getCascInfo`;
  console.log(`[rest-casc-info] GET ${url1}`);
  const { status: s1, data: json } = await client.get(url1);
  if (s1 !== 200) throw new Error(`HTTP ${s1}`);
  console.log('[rest-casc-info] Response (getCascInfo):', JSON.stringify(json).slice(0, 30), "...");
  assert.strictEqual(json.id, 'CASC_INFO');
  assert.ok(json.build && json.build.Product);
  assert.ok(json.buildName);
  console.log('[rest-casc-info] getCascInfo OK');
}

if (require.main === module) {
  testRestGetCascInfo().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { testRestGetCascInfo };
