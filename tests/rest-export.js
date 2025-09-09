const assert = require('assert');

const { baseURL, client } = require('./http');

async function testExportModelsNoCASC() {
  const url = `${baseURL}/rest/exportModels`;
  console.log(`[rest-export] POST ${url}`);
  const { status, data: json } = await client.post(url, { models: [{ fileDataID: 1011653 }] });
  console.log('[rest-export] Response (models):', status, JSON.stringify(json));
  assert.strictEqual(status, 200);
  assert.strictEqual(json.id, 'EXPORT_RESULT');
  console.log('[rest-export] exportModels no casc OK');
}

async function testExportTexturesNoCASC() {
  const url = `${baseURL}/rest/exportTextures`;
  console.log(`[rest-export] POST ${url}`);
  const { status, data: json } = await client.post(url, { fileDataID: 4531024 });
  console.log('[rest-export] Response (textures):', status, JSON.stringify(json));
  assert.strictEqual(status, 200);
  assert.strictEqual(json.id, 'EXPORT_RESULT');
  console.log('[rest-export] exportTextures no casc OK');
}

async function testExportCharacterNoCASC() {
  const url = `${baseURL}/rest/exportCharacter`;
  console.log(`[rest-export] POST ${url}`);
  const payload = {
    race: 1,
    gender: 0,
    customizations: {},
    geosetIds: {},
    hideGeosetIds: {},
    include_animations: false,
    include_base_clothing: false
  };
  const { status, data: json } = await client.post(url, payload);
  console.log('[rest-export] Response (character):', status, JSON.stringify(json));
  assert.strictEqual(status, 200);
  assert.strictEqual(json.id, 'EXPORT_RESULT');
  console.log('[rest-export] exportCharacter no casc OK');
}

async function main() {
  await testExportModelsNoCASC();
  await testExportTexturesNoCASC();
  await testExportCharacterNoCASC();
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { testExportModelsNoCASC, testExportTexturesNoCASC, testExportCharacterNoCASC };


