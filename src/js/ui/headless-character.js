// headless-character.js - Robust, stateless headless character export for wow.export
const core = require('../core');
const ExportHelper = require('../casc/export-helper');
const M2Exporter = require('../3D/exporters/M2Exporter');
const M2Loader = require('../3D/loaders/M2Loader');
const SKELLoader = require('../3D/loaders/SKELLoader');
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');
const WDCReader = require('../db/WDCReader');
const listfile = require('../casc/listfile');
const BoneMapper = require('../3D/BoneMapper');
const DBCreatures = require('../db/caches/DBCreatures');

let lookupsCache = null;
async function getLookups() {
	if (lookupsCache) return lookupsCache;
	console.log('[headless] Loading DB2s and building lookup maps...');

	// Lookup maps
	const chrRaceXChrModelMap = new Map();
	const chrModelIDToFileDataID = new Map();
	const chrModelIDToTextureLayoutID = new Map();
	const choiceToGeoset = new Map();
	const choiceToChrCustMaterialID = new Map();
	const choiceToSkinnedModel = new Map();
	const unsupportedChoices = [];
	const geosetMap = new Map();
	const chrCustMatMap = new Map();
	const chrModelTextureLayerMap = new Map();
	const charComponentTextureSectionMap = new Map();
	const chrModelMaterialMap = new Map();
	const chrCustSkinnedModelMap = new Map();

	// TextureFileData.db2
	const tfdDB = new WDCReader('DBFilesClient/TextureFileData.db2');
	await tfdDB.parse();
	const tfdMap = new Map();
	for (const tfdRow of tfdDB.getAllRows().values()) {
		if (tfdRow.UsageType != 0) continue;
		tfdMap.set(tfdRow.MaterialResourcesID, tfdRow.FileDataID);
	}

	// ChrModel.db2
	const chrModelDB = new WDCReader('DBFilesClient/ChrModel.db2');
	await chrModelDB.parse();
	for (const [chrModelID, chrModelRow] of chrModelDB.getAllRows()) {
		const fileDataID = DBCreatures.getFileDataIDByDisplayID(chrModelRow.DisplayID);
		chrModelIDToFileDataID.set(chrModelID, fileDataID);
		chrModelIDToTextureLayoutID.set(chrModelID, chrModelRow.CharComponentTextureLayoutID);
	}

	// ChrCustomizationElement.db2
	const chrCustElementDB = new WDCReader('DBFilesClient/ChrCustomizationElement.db2');
	await chrCustElementDB.parse();
	for (const row of chrCustElementDB.getAllRows().values()) {
		if (row.ChrCustomizationGeosetID != 0)
			choiceToGeoset.set(row.ChrCustomizationChoiceID, row.ChrCustomizationGeosetID);
		if (row.ChrCustomizationSkinnedModelID != 0)
			choiceToSkinnedModel.set(row.ChrCustomizationChoiceID, row.ChrCustomizationSkinnedModelID);
		if (row.ChrCustomizationBoneSetID != 0)
			unsupportedChoices.push(row.ChrCustomizationChoiceID);
		if (row.ChrCustomizationCondModelID != 0)
			unsupportedChoices.push(row.ChrCustomizationChoiceID);
		if (row.ChrCustomizationDisplayInfoID != 0)
			unsupportedChoices.push(row.ChrCustomizationChoiceID);
		if (row.ChrCustomizationMaterialID != 0) {
			if (choiceToChrCustMaterialID.has(row.ChrCustomizationChoiceID))
				choiceToChrCustMaterialID.get(row.ChrCustomizationChoiceID).push({ ChrCustomizationMaterialID: row.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: row.RelatedChrCustomizationChoiceID });
			else
				choiceToChrCustMaterialID.set(row.ChrCustomizationChoiceID, [{ ChrCustomizationMaterialID: row.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: row.RelatedChrCustomizationChoiceID }]);
		}
	}

	// ChrCustomizationMaterial.db2
	const chrCustMatDB = new WDCReader('DBFilesClient/ChrCustomizationMaterial.db2');
	await chrCustMatDB.parse();
	for (const row of chrCustMatDB.getAllRows().values()) {
		chrCustMatMap.set(row.ID, {
			ChrModelTextureTargetID: row.ChrModelTextureTargetID,
			FileDataID: tfdMap.get(row.MaterialResourcesID)
		});
	}

	// ChrCustomizationChoice.db2
	const chrCustChoiceDB = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2');
	await chrCustChoiceDB.parse();
	for (const row of chrCustChoiceDB.getAllRows().values()) {
		if (!choiceToGeoset.has(row.ID))
			choiceToGeoset.set(row.ID, row.ChrCustomizationGeosetID);
		if (!choiceToChrCustMaterialID.has(row.ID))
			choiceToChrCustMaterialID.set(row.ID, []);
	}

	// ChrCustomizationGeoset.db2
	const chrCustGeosetDB = new WDCReader('DBFilesClient/ChrCustomizationGeoset.db2');
	await chrCustGeosetDB.parse();
	for (const [id, row] of chrCustGeosetDB.getAllRows()) {
		const geoset = row.GeosetType.toString().padStart(2, '0') + row.GeosetID.toString().padStart(2, '0');
		geosetMap.set(id, Number(geoset));
	}

	// ChrModelTextureLayer.db2
	const chrModelTextureLayerDB = new WDCReader('DBFilesClient/ChrModelTextureLayer.db2');
	await chrModelTextureLayerDB.parse();
	for (const row of chrModelTextureLayerDB.getAllRows().values())
		chrModelTextureLayerMap.set(row.CharComponentTextureLayoutsID + '-' + row.ChrModelTextureTargetID[0], row);

	// CharComponentTextureSections.db2
	const charComponentTextureSectionDB = new WDCReader('DBFilesClient/CharComponentTextureSections.db2');
	await charComponentTextureSectionDB.parse();
	for (const row of charComponentTextureSectionDB.getAllRows().values()) {
		if (!charComponentTextureSectionMap.has(row.CharComponentTextureLayoutID))
			charComponentTextureSectionMap.set(row.CharComponentTextureLayoutID, []);
		charComponentTextureSectionMap.get(row.CharComponentTextureLayoutID).push(row);
	}

	// ChrModelMaterial.db2
	const chrModelMaterialDB = new WDCReader('DBFilesClient/ChrModelMaterial.db2');
	await chrModelMaterialDB.parse();
	for (const row of chrModelMaterialDB.getAllRows().values())
		chrModelMaterialMap.set(row.CharComponentTextureLayoutsID + '-' + row.TextureType, row);

	// ChrRaceXChrModel.db2
	const chrRaceXChrModelDB = new WDCReader('DBFilesClient/ChrRaceXChrModel.db2');
	await chrRaceXChrModelDB.parse();
	for (const row of chrRaceXChrModelDB.getAllRows().values()) {
		if (!chrRaceXChrModelMap.has(row.ChrRacesID))
			chrRaceXChrModelMap.set(row.ChrRacesID, new Map());
		chrRaceXChrModelMap.get(row.ChrRacesID).set(row.Sex, row.ChrModelID);
	}

	lookupsCache = {
		chrRaceXChrModelMap,
		chrModelIDToFileDataID,
		chrModelIDToTextureLayoutID,
		choiceToGeoset,
		choiceToChrCustMaterialID,
		choiceToSkinnedModel,
		unsupportedChoices,
		geosetMap,
		chrCustMatMap,
		chrModelTextureLayerMap,
		charComponentTextureSectionMap,
		chrModelMaterialMap,
		chrCustSkinnedModelMap
	};
	console.log('[headless] DB2s loaded and lookups built.');
	return lookupsCache;
}

// LRU cache for already-parsed M2 models. Keeps memory bounded.
// We use a Map that is touched on every get() so iteration order reflects recency.
// When the size exceeds MAX_CACHE the oldest (first) entry is evicted.
const MAX_CACHE = 50;
const m2ExporterCache = new Map();

function getCachedExporter(fileDataID) {
	if (m2ExporterCache.has(fileDataID)) {
		// Touch: move to the end (most-recent)
		const value = m2ExporterCache.get(fileDataID);
		m2ExporterCache.delete(fileDataID);
		m2ExporterCache.set(fileDataID, value);
		return value;
	}
	return null;
}

function addExporterToCache(fileDataID, exporter) {
	if (m2ExporterCache.has(fileDataID)) m2ExporterCache.delete(fileDataID);
	m2ExporterCache.set(fileDataID, exporter);
	// Evict oldest if over limit
	if (m2ExporterCache.size > MAX_CACHE) {
		const oldestKey = m2ExporterCache.keys().next().value;
		m2ExporterCache.delete(oldestKey);
	}
}

async function exportCharacterModelHeadless({ race, gender, customizations, geosetIds, hideGeosetIds, excludeAnimationIds = [] }) {
	try {
		await CharMaterialRenderer.init(); // Ensure shaders are loaded and compiled
		console.log('[headless] Starting export for', { race, gender, customizations, geosetIds, hideGeosetIds });
		const lookups = await getLookups();
		// 1. Find model for race/gender
		const modelMap = lookups.chrRaceXChrModelMap.get(race);
		console.log('[headless] Model map for race', race, ':', modelMap);
		if (!modelMap) throw new Error('Invalid race');
		const genderNum = typeof gender === 'string' ? parseInt(gender, 10) : gender;
		console.log('[headless] Using gender (as number):', genderNum, 'Keys in modelMap:', Array.from(modelMap.keys()));
		const modelID = modelMap.get(genderNum);
		console.log('[headless] ModelID for gender', genderNum, ':', modelID);
		if (!modelID) throw new Error('Invalid gender for race');
		const fileDataID = lookups.chrModelIDToFileDataID.get(modelID);
		console.log('[headless] fileDataID for modelID', modelID, ':', fileDataID, 'Available modelIDs:', Array.from(lookups.chrModelIDToFileDataID.keys()));
		if (!fileDataID) {
			console.log('[headless] No fileDataID for modelID', modelID, 'in chrModelIDToFileDataID:', Array.from(lookups.chrModelIDToFileDataID.keys()));
			throw new Error('No fileDataID for model (modelID: ' + modelID + ')');
		}
		const textureLayoutID = lookups.chrModelIDToTextureLayoutID.get(modelID);
		if (!textureLayoutID) throw new Error('No textureLayoutID for model');
		// 2. Load model file
		const casc = core.view.casc;
		if (!casc) throw new Error('CASC not loaded');
		console.log('[headless] Loading model file for fileDataID', fileDataID);

		let exporter = getCachedExporter(fileDataID);
		if (!exporter) {
			const file = await casc.getFile(fileDataID);
			exporter = new M2Exporter(file, [], fileDataID);
			addExporterToCache(fileDataID, exporter);
			await exporter.m2.load();
			await exporter.m2.getSkin(0);
		}
		exporter.setExcludedAnimIds(excludeAnimationIds);

		const skin = exporter.m2.skins?.[0];
		const subMeshes = skin?.subMeshes || [];

		// Build initial geoset mask. This now mirrors the default logic used by the UI (see M2Renderer)
		const geosetGroup = id => Math.floor(id / 100) * 100;
		const defaultGeosets = new Set([0, 401, 501, 601, 702, 801, 901, 1001, 1101, 1201, 1301, 1400, 1501, 1600, 1700, 1801, 1901, 2001, 2101, 2201, 2301, 2400, 2500, 2601, 2700, 2801, 2900, 3000, 3100, 3202, 3301, 3401, 3500, 3600, 3700, 3801, 3900, 4001, 4101, 4201, 4301, 4401, 4501, 4601, 4701, 4801, 4901, 5001, 5101])

		const geosetMask = subMeshes.map(subMesh => {
			const id = subMesh.submeshID;
			const checked = defaultGeosets.has(id);
			if (checked) console.log('subMesh is default', subMesh);
			return { id, checked };
		});

		const turnOnGeoset = (subMeshId, turnOffOthers = true) => {
			const group = geosetGroup(subMeshId);
			const matchingGeosets = geosetMask.filter(geoset => geoset.id === subMeshId);
			if (matchingGeosets.length > 0) {
				matchingGeosets.forEach(geoset => geoset.checked = true);
				if (group === 0 || !turnOffOthers) return; // base geometry cannot be overridden
				geosetMask.forEach(geoset => {
					if (group === geosetGroup(geoset.id) && geoset.id !== subMeshId) {
						geoset.checked = false;
					}
				});
			}
		}

		// Turn on customization geosets
		for (const [optionID, choiceID] of Object.entries(customizations || {})) {
			const chrCustGeoID = lookups.choiceToGeoset.get(Number(choiceID));
			const geosetId = lookups.geosetMap.get(chrCustGeoID);
			if (geosetId !== undefined) {
				console.log('turning on geoset', {geosetId, optionID, choiceID});
				turnOnGeoset(geosetId, true);
			}
		}

		if (Array.isArray(geosetIds) && geosetIds.length > 0) {
			for (const geosetId of geosetIds) {
				console.log('turning on geoset per RCP request', {geosetId});
				turnOnGeoset(geosetId, true);
			}
		}

		if (Array.isArray(hideGeosetIds) && hideGeosetIds.length > 0) {
			const idsToHide = new Set(hideGeosetIds);
			for (const geoset of geosetMask) {
				if (idsToHide.has(geoset.id)) {
					console.log('Hide geoset per RCP request', geoset.id, geoset);
					geoset.checked = false;
				}
			}
		}

		for(const geoset of geosetMask) {
			if (geoset.checked) console.log('geoset is checked', geoset);
		}

		exporter.setGeosetMask(geosetMask);
		// 5. Prepare materials (stateless, using CharMaterialRenderer)
		const chrMaterials = new Map();
		for (const [, choiceID] of Object.entries(customizations || {})) {
			const chrCustMatIDs = lookups.choiceToChrCustMaterialID.get(Number(choiceID));
			if (chrCustMatIDs != undefined) {
				for (const chrCustMatID of chrCustMatIDs) {
					if (chrCustMatID.RelatedChrCustomizationChoiceID != 0) {
						const hasRelatedChoice = Object.values(customizations || {}).find(
							v => Number(v) === chrCustMatID.RelatedChrCustomizationChoiceID
						);
						if (!hasRelatedChoice)
							continue;
					}
					const chrCustMat = lookups.chrCustMatMap.get(chrCustMatID.ChrCustomizationMaterialID);
					const chrModelTextureTarget = chrCustMat.ChrModelTextureTargetID;
					const chrModelTextureLayer = lookups.chrModelTextureLayerMap.get(textureLayoutID + '-' + chrModelTextureTarget);
					if (!chrModelTextureLayer) continue;
					const chrModelMaterial = lookups.chrModelMaterialMap.get(textureLayoutID + '-' + chrModelTextureLayer.TextureType);
					if (!chrModelMaterial) continue;
					let chrMaterial;
					if (!chrMaterials.has(chrModelMaterial.TextureType)) {
						chrMaterial = new CharMaterialRenderer(chrModelMaterial.TextureType, chrModelMaterial.Width, chrModelMaterial.Height, true);
						chrMaterials.set(chrModelMaterial.TextureType, chrMaterial);
						await chrMaterial.init();
					} else {
						chrMaterial = chrMaterials.get(chrModelMaterial.TextureType);
					}
					let charComponentTextureSection;
					if (chrModelTextureLayer.TextureSectionTypeBitMask == -1) {
						charComponentTextureSection = { X: 0, Y: 0, Width: chrModelMaterial.Width, Height: chrModelMaterial.Height };
					} else {
						const charComponentTextureSectionResults = lookups.charComponentTextureSectionMap.get(textureLayoutID);
						for (const charComponentTextureSectionRow of charComponentTextureSectionResults) {
							if ((1 << charComponentTextureSectionRow.SectionType) & chrModelTextureLayer.TextureSectionTypeBitMask) {
								charComponentTextureSection = charComponentTextureSectionRow;
								break;
							}
						}
					}
					await chrMaterial.setTextureTarget(chrCustMat, charComponentTextureSection, chrModelMaterial, chrModelTextureLayer, true);
				}
			}
		}
		exporter.resetURITextures();
		for (const [textureType, chrMaterial] of chrMaterials) {
			let originalFilename = null;
			if (chrMaterial.textureTargets && chrMaterial.textureTargets.length > 0) {
				const target = chrMaterial.textureTargets.find(t => t.filename);
				if (target && target.filename) originalFilename = target.filename;
			}
			// Key baked overlays strictly by TextureType so exporter can match by this.m2.textureTypes
			const textureTypeKey = Number(textureType);
			exporter.addURITexture(textureTypeKey, chrMaterial.getURI(), originalFilename);
		}
		// 6. Export
		const helper = new ExportHelper(1, 'model');
		helper.start();
		const fileName = listfile.getByID(fileDataID);
		const exportPath = ExportHelper.replaceExtension(ExportHelper.getExportPath(fileName), '.obj');
		
		const fileManifest = [];
		await exporter.exportAsOBJ(exportPath, false, helper, fileManifest);
		helper.mark(fileName, true);
		helper.finish();
		for (const [, chrMaterial] of chrMaterials)
			chrMaterial.dispose();
		return { exportPath, fileName, fileManifest };
	} catch (err) {
		console.log('Export failed:', err);
		throw err;
	}
}

module.exports = {
	exportCharacterModelHeadless
}; 