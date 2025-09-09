const assert = require('assert');

const { baseURL, client } = require('./http');

async function testSearchFiles() {
  const url = `${baseURL}/rest/searchFiles?search=${encodeURIComponent('m2')}&useRegularExpression=0`;
  console.log(`[rest-listfile] GET ${url}`);
  const { status, data: json } = await client.get(url);
  console.log('[rest-listfile] Response (searchFiles):', status, JSON.stringify(json).slice(0, 100), "...");
  if (status === 200) {
    assert.strictEqual(json.id, 'LISTFILE_SEARCH_RESULT');
    assert.ok(Array.isArray(json.entries));
  } else {
    assert.strictEqual(status, 409);
    assert.strictEqual(json.id, 'ERR_LISTFILE_NOT_LOADED');
  }
  console.log('[rest-listfile] searchFiles OK');
}

async function testGetFileByIDMissingParam() {
  const url = `${baseURL}/rest/getFileById`;
  console.log(`[rest-listfile] GET ${url}`);
  const { status, data: json } = await client.get(url);
  console.log('[rest-listfile] Response (getFileByID missing):', status, JSON.stringify(json));
  assert.strictEqual(status, 400);
  assert.strictEqual(json.id, 'ERR_INVALID_PARAMETERS');
  console.log('[rest-listfile] getFileByID missing param OK');
}

async function testGetFileByID() {
  const url = `${baseURL}/rest/getFileById?fileDataID=1`;
  console.log(`[rest-listfile] GET ${url}`);
  const { status, data: json } = await client.get(url);
  console.log('[rest-listfile] Response (getFileByID):', status, JSON.stringify(json));
  if (status === 200) {
    assert.strictEqual(json.id, 'LISTFILE_RESULT');
    assert.strictEqual(json.fileDataID, 1);
    assert.ok(typeof json.fileName === 'string');
  } else {
    assert.strictEqual(status, 409);
    assert.strictEqual(json.id, 'ERR_LISTFILE_NOT_LOADED');
  }
  console.log('[rest-listfile] getFileByID OK');
}

async function testGetFileByNameMissingParam() {
  const url = `${baseURL}/rest/getFileByName`;
  console.log(`[rest-listfile] GET ${url}`);
  const { status, data: json } = await client.get(url);
  console.log('[rest-listfile] Response (getFileByName missing):', status, JSON.stringify(json));
  assert.strictEqual(status, 400);
  assert.strictEqual(json.id, 'ERR_INVALID_PARAMETERS');
  console.log('[rest-listfile] getFileByName missing param OK');
}

async function testGetFileByName() {
  const fileName = 'nonexistent.file';
  const url = `${baseURL}/rest/getFileByName?fileName=${encodeURIComponent(fileName)}`;
  console.log(`[rest-listfile] GET ${url}`);
  const { status, data: json } = await client.get(url);
  console.log('[rest-listfile] Response (getFileByName):', status, JSON.stringify(json));
  if (status === 200) {
    assert.strictEqual(json.id, 'LISTFILE_RESULT');
    assert.strictEqual(json.fileName, fileName);
    assert.ok(Number.isFinite(json.fileDataID));
  } else {
    assert.strictEqual(status, 409);
    assert.strictEqual(json.id, 'ERR_LISTFILE_NOT_LOADED');
  }
  console.log('[rest-listfile] getFileByName OK');
}

async function main() {
  await testSearchFiles();
  await testGetFileByIDMissingParam();
  await testGetFileByID();
  await testGetFileByNameMissingParam();
  await testGetFileByName();
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { testSearchFiles, testGetFileByIDMissingParam, testGetFileByID, testGetFileByNameMissingParam, testGetFileByName };


