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
const log = require('../log');
const listfile = require('../casc/listfile');
const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');
const modelsService = require('../ui/tab-models');
const texturesService = require('../ui/tab-textures');
const charactersService = require('../ui/headless-character');

class RestServer {
	constructor() {
		this.server = null;
		this.port = Number(process.env.WOWEXPORT_REST_PORT || 17752);
		this._exportId = 1;
		this._pendingCASC = null; // transient casc during loadCASCLocal/Remote before Build
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
		if (!core.view.casc)
			return this.sendJSON(res, 409, { id: 'ERR_NO_CASC' });
		let models = [];
		if (Array.isArray(body?.models)) {
			models = body.models;
		} else if (body?.fileDataID !== undefined) {
			const ids = Array.isArray(body.fileDataID) ? body.fileDataID : [body.fileDataID];
			models = ids.map(id => ({ fileDataID: id }));
		} else {
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { models: 'object[]' } });
		}

		const exportID = this.nextExportID();
		try {
			const result = await modelsService.exportFilesWithSkins(models, false, exportID);
			const succeeded = Array.isArray(result?.succeeded) ? result.succeeded.length : 0;
			const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
			if (succeeded === 0 && failed > 0)
				return this.sendJSON(res, 422, Object.assign({ id: 'EXPORT_RESULT', reason: 'ALL_FAILED' }, result));
			return this.sendJSON(res, 200, Object.assign({ id: 'EXPORT_RESULT', partial: failed > 0 }, result));
		} catch (e) {
			return this.sendJSON(res, 500, { id: 'ERR_INTERNAL', message: e.message });
		}
	}

	async exportTextures(body, res) {
		if (!core.view.casc)
			return this.sendJSON(res, 409, { id: 'ERR_NO_CASC' });
		const ids = body?.fileDataID;
		const files = Array.isArray(ids) ? ids : (ids !== undefined ? [ids] : null);
		if (!files)
			return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: { fileDataID: ['number', 'number[]'] } });

		const exportID = this.nextExportID();
		try {
			const result = await texturesService.exportFiles(files, false, exportID);
			const succeeded = Array.isArray(result?.succeeded) ? result.succeeded.length : 0;
			const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
			if (succeeded === 0 && failed > 0)
				return this.sendJSON(res, 422, Object.assign({ id: 'EXPORT_RESULT', reason: 'ALL_FAILED' }, result));
			return this.sendJSON(res, 200, Object.assign({ id: 'EXPORT_RESULT', partial: failed > 0 }, result));
		} catch (e) {
			return this.sendJSON(res, 500, { id: 'ERR_INTERNAL', message: e.message });
		}
	}

	async exportCharacter(body, res) {
		if (!core.view.casc)
			return this.sendJSON(res, 409, { id: 'ERR_NO_CASC' });
		const required = ['race', 'gender', 'customizations', 'geosetIds', 'hideGeosetIds', 'include_animations', 'include_base_clothing'];
		for (const key of required) {
			if (body?.[key] === undefined)
				return this.sendJSON(res, 400, { id: 'ERR_INVALID_PARAMETERS', required: {
					race: 'number',
					gender: 'number',
					customizations: 'object',
					geosetIds: 'object',
					hideGeosetIds: 'object',
					include_animations: 'boolean',
					include_base_clothing: 'boolean'
				}});
		}

		const exportID = this.nextExportID();

		try {
			const result = await charactersService.exportCharacterModelHeadless({ casc: core.view.casc, ...body });

			return this.sendJSON(res, 200, {
				id: 'EXPORT_RESULT',
				type: 'CHARACTERS',
				exportID,
				exportPath: result.exportPath,
				fileName: result.fileName,
				fileManifest: result.fileManifest
			});
		} catch (e) {
			return this.sendJSON(res, 500, { id: 'ERR_INTERNAL', message: e.message });
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


