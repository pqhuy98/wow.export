const { spawn } = require('child_process');
const path = require('path');
const { baseURL } = require('./http');

const testsDir = __dirname;
const tests = [
  'rest-casc-info.js',
  'rest-config.js',
  'rest-listfile.js',
  'rest-model-skins.js',
  'rest-load-casc.js',
  'rest-export.js'
];

function runTest(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(testsDir, file);
    console.log(`\n=== RUN ${file} (base=${baseURL}) ===`);
    const child = spawn(process.execPath, [fullPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      const passed = code === 0;
      console.log(`=== ${passed ? 'PASS' : 'FAIL'} ${file} (${passed ? 0 : code}) ===`);
      resolve({ file, code, passed });
    });
  });
}

async function main() {
  const only = process.env.ONLY ? process.env.ONLY.split(',').map(s => s.trim()).filter(Boolean) : null;
  const list = only ? tests.filter(t => only.includes(t) || only.some(o => t.includes(o))) : tests;
  const results = [];
  const start = Date.now();
  for (const file of list) {
    // eslint-disable-next-line no-await-in-loop
    const res = await runTest(file);
    results.push(res);
  }
  const durationMs = Date.now() - start;
  const failed = results.filter(r => !r.passed);
  console.log('\n====================');
  console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}, Time: ${durationMs} ms`);
  if (failed.length) {
    console.log('Failed tests:');
    for (const f of failed) console.log(` - ${f.file} (code ${f.code})`);
  }
  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}


