/*
  Simplified on-disk cache for wow.export heavy initialisation.
  -----------------------------------------------------------------------
  1. Call  cache.init(buildKey)  once you know which build to load.
  2. We monkey-patch CASC .load():
     • If a snapshot for the build exists we hydrate state and skip all heavy
       work (archives, encoding, root, indexes).
     • Otherwise run the normal load then snapshot the heavy properties.
  3. DB2 parsing is still patched (rows/copy/string maps) because it happens
     after CASC.load().
  4. Snapshots are stored in   .cache/<buildKey>/casc_snapshot.v8
     using v8 binary serialisation for fast IO.
*/

const fs   = require('fs-extra');
const path = require('path');
const v8   = require('v8');
const log  = require('./log');
const zlib = require('zlib');

const CACHE_ROOT = path.resolve('.', '.cache');
let   activeDir  = null;

/* -------------------------------------------------------------------- */
/*  DB2 reader patch                                                     */
/* -------------------------------------------------------------------- */
let wdcPatched = false;
function patchWDCReader() {
  if (wdcPatched) return;
  const WDCReader = require('./db/WDCReader');
  const original  = WDCReader.prototype.parse;

  WDCReader.prototype.parse = async function (data) {
    if (!activeDir) return original.call(this, data);

    const base      = path.basename(this.fileName, '.db2');
    const rowsPath  = path.join(activeDir, `${base}.rows.v8`);
    const copyPath  = path.join(activeDir, `${base}.copy.v8`);
    const strPath   = path.join(activeDir, `${base}.strings.v8`);

    try {
      if (fs.existsSync(rowsPath) && fs.existsSync(copyPath) && fs.existsSync(strPath)) {
        log.write('[cache] WDC %s hit', base);
        let start = Date.now();
        this.rows        = v8.deserialize(fs.readFileSync(rowsPath));
        this.copyTable   = v8.deserialize(fs.readFileSync(copyPath));
        this.stringTable = v8.deserialize(fs.readFileSync(strPath));
        let end = Date.now();
        log.write('[cache] WDC %s deserialization took %dms', base, end - start);
        this.isLoaded    = this.isInflated = true;
        return;
      }
    } catch (e) {
      log.write('[cache] failed to hydrate WDC %s (%s)', base, e.message);
    }

    // slow path
    start = Date.now();
    await original.call(this, data);
    end = Date.now();
    log.write('[cache] WDC %s slow path took %dms', base, end - start);
    try {
      await fs.ensureDir(activeDir);
      fs.writeFileSync(rowsPath, v8.serialize(this.rows));
      fs.writeFileSync(copyPath, v8.serialize(this.copyTable));
      fs.writeFileSync(strPath,  v8.serialize(this.stringTable));
    } catch (e) {
      log.write('[cache] failed to write WDC %s snapshot (%s)', base, e.message);
    }
  };
  wdcPatched = true;
}

/* -------------------------------------------------------------------- */
/*  CASC load patch                                                      */
/* -------------------------------------------------------------------- */

function patchCASC(casc, method, properties) {
  if (casc[method].__cacheWrapped) return
  const realMethod = casc[method];

  const newMethod = async (...args) => {
    log.write('calling patched', method);
    if (!activeDir) {
      log.write('no activeDir, calling original', method);
      return realMethod.apply(casc, args);
    }

    const snapFile = path.join(activeDir, `casc_${method}_snapshot.v8`);

    /* fast path */
    if (fs.existsSync(snapFile)) {
      const start = Date.now();
      const snapshot = v8.deserialize(zlib.gunzipSync(fs.readFileSync (snapFile)));
      try {
        for (const k of properties) {
          casc[k] = snapshot[k];
        }
        const end = Date.now();
        log.write('hydration of '+method+' took', end - start, 'ms');
        return;
      } catch (e) {
        log.write('bad snapshot (%s) – rebuild', e.message);
        // delete the snapFile so we rebuild it
        fs.removeSync(snapFile);
      }
    }

    /* slow path */
    log.write('calling original load');
    await realMethod.apply(casc, args);

    /* snapshot */
    try {
      log.write('writing CASC snapshot');
      fs.ensureDirSync(activeDir);
      const snapshot = {};
      for (const k of properties) {
        const val = casc[k];
        snapshot[k] = val;
      }
      fs.writeFileSync(snapFile, zlib.gzipSync(v8.serialize(snapshot)));
      log.write('wrote CASC snapshot');
    } catch (e) { 
      log.write('failed to write snapshot (%s)', e.message);
    }
  }

  casc[method] = newMethod.bind(casc);
  casc[method].__cacheWrapped = true;
}

/* -------------------------------------------------------------------- */
/*  Public API                                                           */
/* -------------------------------------------------------------------- */
async function init(buildKey, casc) {
  if (!buildKey) throw new Error('cache.init(buildKey) requires buildKey');
  activeDir = path.join(CACHE_ROOT, buildKey);
  fs.ensureDirSync(activeDir);
  log.write('[cache] activeDir %s', activeDir);

  patchWDCReader();
  // patchCASC(casc, 'loadArchives', ['archives']);
  // patchCASC(casc, 'parseEncodingFile', ['encodingKeys', 'encodingSizes']);
  // patchCASC(casc, 'parseRootFile', ['rootEntries', 'rootTypes']);
}

module.exports = { init };