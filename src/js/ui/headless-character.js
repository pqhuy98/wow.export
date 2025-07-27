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

// --- Attachment merging for head models ---
function generateBoneKey(bones, boneIndex) {
	const path = [];
	let currentIndex = boneIndex;
	while (currentIndex >= 0 && currentIndex < bones.length) {
		const bone = bones[currentIndex];
		const boneName = BoneMapper.get_bone_name(bone.boneID, currentIndex, bone.boneNameCRC);
		if (!boneName.startsWith('bone_' + currentIndex)) {
			path.unshift(boneName);
		} else {
			const pivotX = Math.round(bone.pivot[0] * 50) / 50;
			const pivotY = Math.round(bone.pivot[1] * 50) / 50;
			const pivotZ = Math.round(bone.pivot[2] * 50) / 50;
			path.unshift(`${pivotX},${pivotY},${pivotZ}`);
		}
		currentIndex = bone.parentBone;
	}
	return path.join('|');
}

async function mergeMainModelAttachmentsIfHead(fileDataID, exporter, casc) {
	const fileName = listfile.getByID(fileDataID);
	if (!fileName || !fileName.includes('_hd.m2')) { console.log('[headless] Not a head model, skipping attachment merge.'); return; }
	const mainModelName = fileName.replace('_hd.m2', '.m2');
	const mainFileDataID = listfile.getByFilename(mainModelName);
	if (!mainFileDataID) { console.log('[headless] No main model found for head model:', fileName); return; }
	const currentModel = exporter.m2;
	await currentModel.load();
	let currentBones = currentModel.bones;
	if ((!currentBones || currentBones.length === 0) && currentModel.skeletonFileID) {
		const skelData = await casc.getFile(currentModel.skeletonFileID);
		const skel = new SKELLoader(skelData);
		await skel.load();
		currentBones = skel.bones;
	}
	if (!currentBones || currentBones.length === 0) { console.log('[headless] Head model has no bones, cannot merge attachments.'); return; }
	const mainModelData = await casc.getFile(mainFileDataID);
	const mainModel = new M2Loader(mainModelData);
	await mainModel.load();
	if (!mainModel.attachments || mainModel.attachments.length === 0) { console.log('[headless] Main model has no attachments, skipping.'); return; }
	const currentBoneKeys = new Map();
	for (let i = 0; i < currentBones.length; i++) {
		const boneKey = generateBoneKey(currentBones, i);
		currentBoneKeys.set(boneKey, i);
	}
	const mainBoneIDs = new Map();
	const currentBoneIDs = new Map();
	const mainBoneNames = new Map();
	const currentBoneNames = new Map();
	for (let i = 0; i < mainModel.bones.length; i++) 
		if (mainModel.bones[i].boneID >= 0) mainBoneIDs.set(mainModel.bones[i].boneID, i);
	
	for (let i = 0; i < currentBones.length; i++) 
		if (currentBones[i].boneID >= 0) currentBoneIDs.set(currentBones[i].boneID, i);
	
	for (let i = 0; i < mainModel.bones.length; i++) {
		const boneName = BoneMapper.get_bone_name(mainModel.bones[i].boneID, i, mainModel.bones[i].boneNameCRC);
		mainBoneNames.set(boneName, i);
	}
	for (let i = 0; i < currentBones.length; i++) {
		const boneName = BoneMapper.get_bone_name(currentBones[i].boneID, i, currentBones[i].boneNameCRC);
		if (!/bone_\d+/.test(boneName)) currentBoneNames.set(boneName, i);
	}
	const attachments = [];
	for (const attachment of mainModel.attachments) {
		const mainBoneIndex = attachment.bone;
		if (mainBoneIndex >= 0 && mainBoneIndex < mainModel.bones.length) {
			const mainBone = mainModel.bones[mainBoneIndex];
			let currentBoneIndex = currentBoneIDs.get(mainBone.boneID);
			if (currentBoneIndex === undefined) {
				const mainBoneName = BoneMapper.get_bone_name(mainBone.boneID, mainBoneIndex, mainBone.boneNameCRC);
				currentBoneIndex = currentBoneNames.get(mainBoneName);
			}
			if (currentBoneIndex === undefined) {
				const mainBoneKey = generateBoneKey(mainModel.bones, mainBoneIndex);
				currentBoneIndex = currentBoneKeys.get(mainBoneKey);
			}
			if (currentBoneIndex === undefined) {
				let closestBoneIndex = -1;
				let closestDistance = Infinity;
				for (let i = 0; i < currentBones.length; i++) {
					const currentBone = currentBones[i];
					const distance = Math.sqrt(
						Math.pow(mainBone.pivot[0] - currentBone.pivot[0], 2) +
						Math.pow(mainBone.pivot[1] - currentBone.pivot[1], 2) +
						Math.pow(mainBone.pivot[2] - currentBone.pivot[2], 2)
					);
					if (distance < closestDistance && distance < 0.1) {
						closestDistance = distance;
						closestBoneIndex = i;
					}
				}
				if (closestBoneIndex !== -1) currentBoneIndex = closestBoneIndex;
			}
			if (currentBoneIndex !== undefined) {
				const mergedAttachment = { ...attachment, bone: currentBoneIndex };
				attachments.push(mergedAttachment);
			}
		}
	}
	exporter.setMergedAttachments(attachments);
	if (attachments.length > 0) exporter.m2.attachments = attachments;
	console.log(`[headless] Merged ${attachments.length} attachments for head model.`);
}

// LRU cache for already-parsed M2 models. Keeps memory bounded.
// We use a Map that is touched on every get() so iteration order reflects recency.
// When the size exceeds MAX_CACHE the oldest (first) entry is evicted.
const MAX_CACHE = 10;
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

async function exportCharacterModelHeadless({ race, gender, customizations, geosetIds, excludeAnimationIds = [] }) {
	try {
		await CharMaterialRenderer.init(); // Ensure shaders are loaded and compiled
		console.log('[headless] Starting export for', { race, gender, customizations, geosetIds });
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
			await mergeMainModelAttachmentsIfHead(fileDataID, exporter, casc);
		}
		exporter.setExcludedAnimIds(excludeAnimationIds);

		// 3. Merge attachments for head models
		// 4. Build geoset mask (UI logic, aligned by submeshID)
		const skin = exporter.m2.skins?.[0];
		const subMeshes = skin?.subMeshes || [];
		const enabledGeosetIds = new Set();
		for (const [, choiceID] of Object.entries(customizations || {})) {
			const chrCustGeoID = lookups.choiceToGeoset.get(Number(choiceID));
			const geoset = lookups.geosetMap.get(chrCustGeoID);
			if (geoset !== undefined) enabledGeosetIds.add(geoset);
		}

		// Build initial geoset mask. This now mirrors the default logic used by the UI (see M2Renderer)
		const geosetGroup = id => Math.floor(id / 100) * 100;
		let geosetMask = subMeshes.map(subMesh => {
			const id = subMesh.submeshID;

			// Default-on rules (taken from M2Renderer)
			let isDefault = (id === 0 || id.toString().endsWith('01') || id.toString().startsWith('32'));
			// Never enable eyeglow/earrings by default
			if (id.toString().startsWith('17') || id.toString().startsWith('35'))
				isDefault = false;

			const checked = enabledGeosetIds.has(id) || isDefault;
			return { id, checked };
		});

		// Apply explicit geoset overrides (geosetIds behaves like the UI RPC tuning)
		if (Array.isArray(geosetIds) && geosetIds.length > 0) {
			const idsToEnable = new Set(geosetIds);
			const groupsToOverride = new Set(geosetIds.map(id => geosetGroup(id)));

			for (let i = 0; i < geosetMask.length; i++) {
				const subMesh = subMeshes[i];
				if (!subMesh) continue;

				const group = geosetGroup(subMesh.submeshID);
				if (groupsToOverride.has(group)) {
					// Within overridden groups, enable only the explicitly requested IDs
					geosetMask[i].checked = idsToEnable.has(subMesh.submeshID);
				}
			}
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
		for (const [chrModelTextureTarget, chrMaterial] of chrMaterials) {
			let originalFilename = null;
			if (chrMaterial.textureTargets && chrMaterial.textureTargets.length > 0) {
				const target = chrMaterial.textureTargets.find(t => t.filename);
				if (target && target.filename) originalFilename = target.filename;
			}
			exporter.addURITexture(chrModelTextureTarget, chrMaterial.getURI(), originalFilename);
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