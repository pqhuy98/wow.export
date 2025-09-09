const assert = require('assert');

const { baseURL, client } = require('./http');

async function testLoadCASCLocalMissingParam() {
  const url = `${baseURL}/rest/loadCascLocal`;
  console.log(`[rest-load-casc] POST ${url}`);
  const { status, data: json } = await client.post(url, {});
  console.log('[rest-load-casc] Response (local missing):', status, JSON.stringify(json));
  if (status === 400) {
    assert.strictEqual(json.id, 'ERR_INVALID_PARAMETERS');
  } else {
    assert.strictEqual(status, 409);
    assert.strictEqual(json.id, 'ERR_CASC_ACTIVE');
  }
  console.log('[rest-load-casc] loadCASCLocal missing param OK');
}

async function testLoadCASCRemoteMissingParam() {
  const url = `${baseURL}/rest/loadCascRemote`;
  console.log(`[rest-load-casc] POST ${url}`);
  const { status, data: json } = await client.post(url, {});
  console.log('[rest-load-casc] Response (remote missing):', status, JSON.stringify(json));
  if (status === 400) {
    assert.strictEqual(json.id, 'ERR_INVALID_PARAMETERS');
  } else {
    assert.strictEqual(status, 409);
    assert.strictEqual(json.id, 'ERR_CASC_ACTIVE');
  }
  console.log('[rest-load-casc] loadCASCRemote missing param OK');
}

async function testLoadCASCBuildMissingParam() {
  const url = `${baseURL}/rest/loadCascBuild`;
  console.log(`[rest-load-casc] POST ${url}`);
  const { status, data: json } = await client.post(url, {});
  console.log('[rest-load-casc] Response (build missing):', status, JSON.stringify(json));
  if (status === 400) {
    assert.strictEqual(json.id, 'ERR_INVALID_PARAMETERS');
  } else {
    assert.strictEqual(status, 409);
    assert.strictEqual(json.id, 'ERR_NO_CASC_SETUP');
  }
  console.log('[rest-load-casc] loadCASCBuild missing param OK');
}

async function testLoadCASCBuildNoSetup() {
  const url = `${baseURL}/rest/loadCascBuild`;
  console.log(`[rest-load-casc] POST ${url}`);
  const { status, data: json } = await client.post(url, { buildIndex: 0 });
  console.log('[rest-load-casc] Response (build no setup):', status, JSON.stringify(json));
  assert.strictEqual(status, 409);
  assert.strictEqual(json.id, 'ERR_NO_CASC_SETUP');
  console.log('[rest-load-casc] loadCASCBuild no setup OK');
}

async function main() {
  await testLoadCASCLocalMissingParam();
  await testLoadCASCRemoteMissingParam();
  await testLoadCASCBuildMissingParam();
  await testLoadCASCBuildNoSetup();
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { testLoadCASCLocalMissingParam, testLoadCASCRemoteMissingParam, testLoadCASCBuildMissingParam, testLoadCASCBuildNoSetup };


