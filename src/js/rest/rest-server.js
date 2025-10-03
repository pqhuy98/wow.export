/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Huy Pham <pqhuy98>
	License: MIT
*/
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const core = require('../core');
const crypto = require('crypto');
const log = require('../log');
const listfile = require('../casc/listfile');
const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');
const modelsService = require('../ui/tab-models');
const texturesService = require('../ui/tab-textures');
const charactersService = require('../ui/headless-character');
const WDCReader = require('../db/WDCReader');
const ADTExporter = require('../3D/exporters/ADTExporter');
const ExportHelper = require('../casc/export-helper');
const { buildADTExportOptions, getTileBounds, collectGameObjects } = require('../3D/utils/map-export-utils');

class RestServer {
	constructor() {
		this.server = null;
		this.port = Number(process.env.WOWEXPORT_REST_PORT || 17752);
		this._exportId = 1;
		this._pendingCASC = null; // transient casc during loadCASCLocal/Remote before Build
			// Response cache for export endpoints (10s TTL)
			this._responseCache = new Map(); // key -> { ts, status, obj }
			this._responseCacheTTL = 10 * 1000; // ms
	}

	get isRunning() {
		return this.server !== null;
	}

	// ---------------- routing ----------------

	async handleGet(pathname, query, res) {
		switch (pathname) {
			case '/rest/getCascInfo':
				return this.getCascInfo(res);
			case '/rest/getConfig':
				return this.getConfig(query, res);
			case '/rest/searchFiles':
				return this.searchFiles(query, res);
			case '/rest/getFileById':
				return this.getFileById(query, res);
			case '/rest/getFileByName':
				return this.getFileByName(query, res);
			case '/rest/getModelSkins':
				return this.getModelSkins(query, res);
			case '/rest/download':
				return this.download(query, res);
			case '/rest/getMapList':
				return this.getMapList(res);
			default:
				return this.sendJSON(res, 404, { id: 'ERR_NOT_FOUND' });
		}
	}

	async handlePost(pathname, body, res) {
		switch (pathname) {
			case '/rest/loadCascLocal':
				return this.loadCascLocal(body, res);
			case '/rest/loadCascRemote':
				return this.loadCascRemote(body, res);
			case '/rest/loadCascBuild':
				return this.loadCascBuild(body, res);
			case '/rest/setConfig':
				return this.setConfig(body, res);
			case '/rest/exportModels':
				return this.exportModels(body, res);
			case '/rest/exportTextures':
				return this.exportTextures(body, res);
			case '/rest/exportCharacter':
				return this.exportCharacter(body, res);
			case '/rest/exportADT':
				return this.exportADT(body, res);
			default:
				return this.sendJSON(res, 404, { id: 'ERR_NOT_FOUND' });
		}
	}

	// ---------------- handlers ----------------

	getCascInfo(res) {
		const casc = core.view.casc;
		if (!casc || !casc.isLoaded)
			return this.sendJSON(res, 503, { id: 'CASC_UNAVAILABLE' });

		return this.sendJSON(res, 200, {
			id: 'CASC_INFO',
			type: casc.constructor.name,
			build: casc.build,
			buildConfig: casc.buildConfig,
			buildName: casc.getBuildName(),
			buildKey: casc.getBuildKey()
		});
	}

	/**
	 * Securely download a file under the configured export directory.
	 * Only allows access within core.view.config.exportDirectory.
	 * Expected query: { path: string } where path is a relative path under export dir.
	 */
	download(query, res) {
		const exportDir = core.view?.config?.exportDirectory;
		if (typeof exportDir !== 'string' || exportDir.length === 0)
			return this.sendJSON(res, 503, { id: 'ERR_EXPORT_DIR_UNAVAILABLE' });

		const requested = String(query.path || '');
		if (!requested || requested.includes('\0'))
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { path: 'string (relative)' } });

		// Normalize and resolve to absolute path and ensure it stays within exportDir
		const base = path.resolve(exportDir);
		const abs = path.resolve(base, requested);
		if (!abs.startsWith(base + path.sep) && abs !== base)
			return this.sendJSON(res, 403, { id: 'ERR_FORBIDDEN' });

		fs.stat(abs, (err, stat) => {
			if (err || !stat.isFile())
				return this.sendJSON(res, 404, { id: 'ERR_NOT_FOUND' });

			const ext = path.extname(abs).toLowerCase();
			const allowedExts = ['.png', '.json', '.obj', '.mtl', '.csv'];
			if (!allowedExts.includes(ext)) {
				return this.sendJSON(res, 400, { id: 'ERR_INVALID_FILE_TYPE', ext, allowedExts });
			}
			let contentType = 'application/octet-stream';
			if (ext === '.png') contentType = 'image/png';
			else if (ext === '.json') contentType = 'application/json; charset=utf-8';
			else if (ext === '.obj' || ext === '.mtl' || ext === '.csv') contentType = 'text/plain; charset=utf-8';

			res.statusCode = 200;
			res.setHeader('Content-Type', contentType);
			const stream = fs.createReadStream(abs);
			stream.on('error', () => this.sendJSON(res, 500, { id: 'ERR_INTERNAL', message: 'Failed to read file' }));
			stream.pipe(res);
		});
	}

	getConfig(query, res) {
		if (typeof query.key === 'string')
			return this.sendJSON(res, 200, { id: 'CONFIG_SINGLE', key: query.key, value: core.view.config[query.key] });
		return this.sendJSON(res, 200, { id: 'CONFIG_FULL', config: core.view.config });
	}

	async getMapList(res) {
		const casc = core.view.casc;
		if (!casc || !casc.isLoaded)
			return this.sendJSON(res, 409, { id: 'ERR_NO_CASC' });

		try {
			const table = new WDCReader('DBFilesClient/Map.db2');
			await table.parse();
			const maps = [];
			for (const [id, entry] of table.getAllRows()) {
				const dir = entry.Directory;
				const wdtPath = path.posix.join('world/maps', dir, `${dir}.wdt`);
				if (listfile.getByFilename(wdtPath)) {
					maps.push({ id, name: entry.MapName_lang, dir, expansionID: entry.ExpansionID });
				}
			}
			return this.sendJSON(res, 200, { id: 'MAP_LIST', maps });
		} catch (e) {
			return this.sendJSON(res, 500, { id: 'ERR_INTERNAL', message: e.message });
		}
	}

	setConfig(body, res) {
		if (!body || typeof body.key !== 'string')
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { key: 'string', value: 'any' } });

		// Accept any JSON-serializable value
		core.view.config[body.key] = body.value;
		return this.sendJSON(res, 200, { id: 'CONFIG_SET_DONE', key: body.key, value: core.view.config[body.key] });
	}

	searchFiles(query, res) {
		if (!listfile.isLoaded())
			return this.sendJSON(res, 409, { id: 'ERR_LISTFILE_NOT_LOADED' });

		const search = String(query.search || '');
		const useRegularExpression = String(query.useRegularExpression || '0') === '1';
		const filter = useRegularExpression ? new RegExp(search, 'i') : search;
		return this.sendJSON(res, 200, { id: 'LISTFILE_SEARCH_RESULT', entries: listfile.getFilteredEntries(filter) });
	}

	getFileById(query, res) {
		if (!listfile.isLoaded())
			return this.sendJSON(res, 409, { id: 'ERR_LISTFILE_NOT_LOADED' });
		const fileDataID = Number(query.fileDataID);
		if (!Number.isFinite(fileDataID))
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { fileDataID: 'number' } });
		const fileName = listfile.getByID(fileDataID) ?? '';
		return this.sendJSON(res, 200, { id: 'LISTFILE_RESULT', fileDataID, fileName });
	}

	getFileByName(query, res) {
		if (!listfile.isLoaded())
			return this.sendJSON(res, 409, { id: 'ERR_LISTFILE_NOT_LOADED' });
		const fileName = String(query.fileName || '');
		if (!fileName)
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { fileName: 'string' } });
		const fileDataID = listfile.getByFilename(fileName) ?? 0;
		return this.sendJSON(res, 200, { id: 'LISTFILE_RESULT', fileDataID, fileName });
	}

	getModelSkins(query, res) {
		const fileDataID = Number(query.fileDataID);
		if (!Number.isFinite(fileDataID))
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { fileDataID: 'number' } });

		try {
			const skins = modelsService.getAllSkinsForModel(fileDataID);
			return this.sendJSON(res, 200, { id: 'MODEL_SKINS', fileDataID, skins });
		} catch (e) {
			return this.sendJSON(res, 500, { id: 'ERR_INTERNAL', message: e.message });
		}
	}

	async loadCascLocal(body, res) {
		if (core.view.casc)
			return this.sendJSON(res, 409, { id: 'ERR_CASC_ACTIVE' });
		if (!body || typeof body.installDirectory !== 'string')
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { installDirectory: 'string' } });

		try {
			const casc = new CASCLocal(body.installDirectory);
			await casc.init();
			this._pendingCASC = casc;
			return this.sendJSON(res, 200, { id: 'CASC_INSTALL_BUILDS', builds: casc.builds });
		} catch (e) {
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_INSTALL' });
		}
	}

	async loadCascRemote(body, res) {
		if (core.view.casc)
			return this.sendJSON(res, 409, { id: 'ERR_CASC_ACTIVE' });
		if (!body || typeof body.regionTag !== 'string')
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { regionTag: 'string' } });

		try {
			const casc = new CASCRemote(body.regionTag);
			await casc.init();
			this._pendingCASC = casc;
			return this.sendJSON(res, 200, { id: 'CASC_INSTALL_BUILDS', builds: casc.builds });
		} catch (e) {
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_INSTALL' });
		}
	}

	async loadCascBuild(body, res) {
		const casc = this._pendingCASC;
		if (!casc)
			return this.sendJSON(res, 409, { id: 'ERR_NO_CASC_SETUP' });
		if (!body || typeof body.buildIndex !== 'number')
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { buildIndex: 'number' } });
		if (body.buildIndex < 0 || body.buildIndex >= casc.builds.length)
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_CASC_BUILD' });

		core.view.showLoadScreen();
		try {
			await casc.load(body.buildIndex);
			// New build loaded; clear cached WDT data to avoid stale cache across builds
			try { ADTExporter.clearCache(); } catch (_) {}
			core.view.setScreen('tab-models');
			core.view.casc = casc;
			this._pendingCASC = null;
			return this.getCascInfo(res);
		} catch (e) {
			log.write('Failed to load CASC (REST): %o', e);
			core.view.setScreen('source-select');
			return this.sendJSON(res, 500, { id: 'ERR_CASC_FAILED' });
		}
	}

	async exportModels(body, res) {
		const casc = core.view.casc;
		const buildKey = casc?.getBuildKey ? casc.getBuildKey() : (casc?.buildKey || casc?.build || '');
		const cacheKey = this._makeCacheKey('/rest/exportModels|' + String(buildKey), body);
		const cached = this._getCachedResponse(cacheKey);
		if (cached) return this.sendJSON(res, cached.status, cached.obj);
		if (!casc) {
			const status = 409; const obj = { id: 'ERR_NO_CASC' };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}
		let models = [];
		if (Array.isArray(body?.models)) {
			models = body.models;
		} else if (body?.fileDataID !== undefined) {
			const ids = Array.isArray(body.fileDataID) ? body.fileDataID : [body.fileDataID];
			models = ids.map(id => ({ fileDataID: id }));
		} else {
			const status = 400; const obj = { id: 'ERR_INVALID_PARAMETERS', required: { models: 'object[]' } };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}

		const exportID = this.nextExportID();
		try {
			const result = await modelsService.exportFilesWithSkins(models, false, exportID, {
				suppressRcpHook: true,
				useExportPathsStream: false,
				skipGlobalCacheInvalidation: true
			});
			const succeeded = Array.isArray(result?.succeeded) ? result.succeeded.length : 0;
			const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
			if (succeeded === 0 && failed > 0) {
				const status = 422; const obj = Object.assign({ id: 'EXPORT_RESULT', reason: 'ALL_FAILED' }, result);
				this._setCachedResponse(cacheKey, status, obj);
				return this.sendJSON(res, status, obj);
			}
			const status = 200; const obj = Object.assign({ id: 'EXPORT_RESULT', partial: failed > 0 }, result);
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		} catch (e) {
			const status = 500; const obj = { id: 'ERR_INTERNAL', message: e.message };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}
	}

	async exportTextures(body, res) {
		const casc = core.view.casc;
		const buildKey = casc?.getBuildKey ? casc.getBuildKey() : (casc?.buildKey || casc?.build || '');
		const cacheKey = this._makeCacheKey('/rest/exportTextures|' + String(buildKey), body);
		const cached = this._getCachedResponse(cacheKey);
		if (cached) return this.sendJSON(res, cached.status, cached.obj);
		if (!casc) {
			const status = 409; const obj = { id: 'ERR_NO_CASC' };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}
		const ids = body?.fileDataID;
		const files = Array.isArray(ids) ? ids : (ids !== undefined ? [ids] : null);
		if (!files) {
			const status = 400; const obj = { id: 'ERR_INVALID_PARAMETERS', required: { fileDataID: ['number', 'number[]'] } };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}

		const exportID = this.nextExportID();
		try {
			const result = await texturesService.exportFiles(files, false, exportID, {
				suppressRcpHook: true,
				useExportPathsStream: false
			});
			const succeeded = Array.isArray(result?.succeeded) ? result.succeeded.length : 0;
			const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
			if (succeeded === 0 && failed > 0) {
				const status = 422;
				const obj = Object.assign({ id: 'EXPORT_RESULT', reason: 'ALL_FAILED' }, result);
				this._setCachedResponse(cacheKey, status, obj);
				return this.sendJSON(res, status, obj);
			}
			const status = 200;
			const obj = Object.assign({ id: 'EXPORT_RESULT', partial: failed > 0 }, result);
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		} catch (e) {
			const status = 500;
			const obj = { id: 'ERR_INTERNAL', message: e.message };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}
	}

	async exportCharacter(body, res) {
		const casc = core.view.casc;
		const buildKey = casc?.getBuildKey ? casc.getBuildKey() : (casc?.buildKey || casc?.build || '');
		const cacheKey = this._makeCacheKey('/rest/exportCharacter|' + String(buildKey), body);
		const cached = this._getCachedResponse(cacheKey);
		if (cached) return this.sendJSON(res, cached.status, cached.obj);
		if (!casc) {
			const status = 409; const obj = { id: 'ERR_NO_CASC' };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}
		const required = ['race', 'gender', 'customizations', 'geosetIds', 'hideGeosetIds', 'include_animations', 'include_base_clothing'];
		for (const key of required) {
			if (body?.[key] === undefined) {
				const status = 400;
				const obj = {
					id: 'ERR_INVALID_PARAMETERS',
					required: {
						race: 'number',
						gender: 'number',
						customizations: 'object',
						geosetIds: 'object',
						hideGeosetIds: 'object',
						include_animations: 'boolean',
						include_base_clothing: 'boolean'
					}
				};
				this._setCachedResponse(cacheKey, status, obj);
				return this.sendJSON(res, status, obj);
			}
		}

		const exportID = this.nextExportID();

		try {
			const suffix = crypto.createHash('md5').update(JSON.stringify(body || {})).digest('hex').slice(0, 8);
			const result = await charactersService.exportCharacterModelHeadless({ casc: core.view.casc, exportSuffix: suffix, ...body });

			const status = 200;
			const obj = {
				id: 'EXPORT_RESULT',
				type: 'CHARACTERS',
				exportID,
				exportPath: result.exportPath,
				fileName: result.fileName,
				fileManifest: result.fileManifest
			};
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		} catch (e) {
			const status = 500;
			const obj = { id: 'ERR_INTERNAL', message: e.message };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}
	}

	async exportADT(body, res) {
		const casc = core.view.casc;
		const buildKey = casc?.getBuildKey ? casc.getBuildKey() : (casc?.buildKey || casc?.build || '');
		const cacheKey = this._makeCacheKey('/rest/exportADT|' + String(buildKey), body);
		const cached = this._getCachedResponse(cacheKey);
		if (cached) return this.sendJSON(res, cached.status, cached.obj);
		if (!casc) {
			const status = 409; const obj = { id: 'ERR_NO_CASC' };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}

		// Validate required parameters
		const mapID = body?.mapID;
		const mapDir = body?.mapDir;
		const tileX = body?.tileX;
		const tileY = body?.tileY;

		if (typeof mapID !== 'number' || typeof mapDir !== 'string' || typeof tileX !== 'number' || typeof tileY !== 'number') {
			const status = 400;
			const obj = {
				id: 'ERR_INVALID_PARAMETERS',
				required: {
					mapID: 'number',
					mapDir: 'string',
					tileX: 'number (0-63)',
					tileY: 'number (0-63)',
					quality: 'number (optional, -1=alpha, 0=no tex, 1-512=minimap, 513+=baked, default 4096)',
					exportRaw: 'boolean (optional, default false)',
					includeM2: 'boolean (optional, default true)',
					includeWMO: 'boolean (optional, default true)',
					includeWMOSets: 'boolean (optional, default true)',
					includeGameObjects: 'boolean (optional, default false)',
					includeLiquid: 'boolean (optional, default true)',
					includeFoliage: 'boolean (optional, default true)',
					includeHoles: 'boolean (optional, default true)',
					splitAlphaMaps: 'boolean (optional, default false)',
					splitLargeTerrainBakes: 'boolean (optional, default false)',
					gameObjects: 'array (optional, additional game objects to export)'
				}
			};
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}

		if (tileX < 0 || tileX > 63 || tileY < 0 || tileY > 63) {
			const status = 400;
			const obj = { id: 'ERR_INVALID_TILE_COORDS', message: 'Tile coordinates must be 0-63' };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}

		const exportID = this.nextExportID();
		const tileIndex = tileY * 64 + tileX;

		// Build request-specific options without mutating global config
		const requestOptions = buildADTExportOptions(core.view.config, {
			mapsExportRaw: body.exportRaw,
			mapsIncludeM2: body.includeM2,
			mapsIncludeWMO: body.includeWMO,
			mapsIncludeWMOSets: body.includeWMOSets,
			mapsIncludeGameObjects: body.includeGameObjects,
			mapsIncludeLiquid: body.includeLiquid,
			mapsIncludeFoliage: body.includeFoliage,
			mapsIncludeHoles: body.includeHoles,
			splitAlphaMaps: body.splitAlphaMaps,
			splitLargeTerrainBakes: body.splitLargeTerrainBakes
		});

		try {

			const quality = body.quality !== undefined ? Number(body.quality) : 4096;
			const exportDir = path.join(core.view.config.exportDirectory, 'adt', mapDir);
			await fs.promises.mkdir(exportDir, { recursive: true });

			const exporter = new ADTExporter(mapID, mapDir, tileIndex);
			const helper = new ExportHelper(1);

			// Optional game objects set
			let gameObjects = body.gameObjects ? new Set(body.gameObjects) : undefined;
			if (!gameObjects && requestOptions.mapsIncludeGameObjects === true) {
				const { startX, startY, endX, endY } = getTileBounds(tileX, tileY);
				gameObjects = await collectGameObjects(mapID, obj => {
					const [posX, posY] = obj.Pos;
					return posX > startX && posX < endX && posY > startY && posY < endY;
				});
			}

			const result = await exporter.export(exportDir, quality, gameObjects, helper, requestOptions);

			// Keep WDT cache across REST exports for perf; only clear on build change above

			const status = 200;
			const obj = {
				id: 'EXPORT_RESULT',
				type: 'ADT',
				exportID,
				mapID,
				mapDir,
				tileX,
				tileY,
				tileIndex,
				exportPath: exportDir,
				exportType: result.type,
				mainFile: result.path ? path.relative(core.view.config.exportDirectory, result.path) : null
			};
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		} catch (e) {
			log.write('ADT export error: %s', e.message);
			const status = 500;
			const obj = { id: 'ERR_INTERNAL', message: e.message, stack: e.stack };
			this._setCachedResponse(cacheKey, status, obj);
			return this.sendJSON(res, status, obj);
		}
	}

	// --------------- internals ---------------

	load() {
		if (this.isRunning)
			throw new Error('REST server is already running.');

		this.server = http.createServer(async (req, res) => {
		try {
				const { pathname, query } = url.parse(req.url || '', true);
				if (req.method === 'GET')
					return await this.handleGet(pathname, query, res);
				if (req.method === 'POST') {
					const body = await this.readJSONBody(req);
					return await this.handlePost(pathname, body, res);
				}
				this.sendJSON(res, 404, { id: 'ERR_NOT_FOUND' });
			} catch (e) {
				try { log.write('REST error: %s', e.message); } catch (_) {}
				this.sendJSON(res, 500, { id: 'ERR_INTERNAL', message: e.message });
			}
		});

		this.server.listen(this.port, () => {
			log.write('Listening for REST requests on port %d', this.port);
		});
	}

	stop() {
		if (!this.isRunning)
			return;

		this.server.close();
		this.server = null;
	}

	// ---------------- cache helpers ----------------

	_makeCacheKey(endpoint, body) {
		const stableStringify = (value) => {
			const seen = new WeakSet();
			const stringify = (val) => {
				if (val === null || typeof val !== 'object') return val;
				if (seen.has(val)) return undefined;
				seen.add(val);
				if (Array.isArray(val)) return val.map(stringify);
				const out = {};
				for (const key of Object.keys(val).sort()) out[key] = stringify(val[key]);
				return out;
			};
			return JSON.stringify(stringify(value));
		};
		return endpoint + ':' + stableStringify(body || {});
	}

	_getCachedResponse(key) {
		const now = Date.now();
		const entry = this._responseCache.get(key);
		if (!entry) return null;
		if (now - entry.ts > this._responseCacheTTL) {
			this._responseCache.delete(key);
			return null;
		}
		return entry;
	}

	_setCachedResponse(key, status, obj) {
		this._responseCache.set(key, { ts: Date.now(), status, obj });
	}

	sendJSON(res, statusCode, obj) {
		res.statusCode = statusCode;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify(obj));
	}

	async readJSONBody(req) {
		return await new Promise((resolve, reject) => {
			let data = '';
			req.on('data', chunk => data += chunk);
			req.on('end', () => {
				if (!data) return resolve({});
				try { resolve(JSON.parse(data)); }
				catch (e) { reject(new Error('ERR_INVALID_JSON')); }
			});
			req.on('error', reject);
		});
	}

	// RCP hook interception removed; REST does not depend on RCP

	nextExportID() {
		const id = this._exportId++;
		if (this._exportId > 0x7FFFFFFF)
			this._exportId = 1;
		return id;
	}
}

module.exports = RestServer;


