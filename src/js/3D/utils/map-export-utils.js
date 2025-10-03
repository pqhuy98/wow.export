/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Project Refactor
	License: MIT
*/
const constants = require('../../constants');
const WDCReader = require('../../db/WDCReader');

// Cache for GameObjects.db2/GameObjectDisplayInfo.db2 mapping by mapID
let gameObjectsDB2 = null; // Map<mapID, Set<row>>

/**
 * Build a normalized ADT export options object.
 * Values from overrides take precedence, then baseConfig, then sensible defaults.
 * @param {object} baseConfig
 * @param {object} overrides
 */
function buildADTExportOptions(baseConfig = {}, overrides = {}) {
	const pick = (key, def) => (overrides[key] !== undefined ? overrides[key] : (baseConfig[key] !== undefined ? baseConfig[key] : def));
	return {
		mapsExportRaw: !!pick('mapsExportRaw', false),
		pathFormat: String(pick('pathFormat', 'win32')),
		enableSharedTextures: !!pick('enableSharedTextures', false),
		overwriteFiles: !!pick('overwriteFiles', true),
		splitAlphaMaps: !!pick('splitAlphaMaps', false),
		splitLargeTerrainBakes: !!pick('splitLargeTerrainBakes', false),
		mapsIncludeHoles: !!pick('mapsIncludeHoles', true),
		enableSharedChildren: !!pick('enableSharedChildren', false),
		modelsExportCollision: !!pick('modelsExportCollision', false),
		mapsIncludeWMO: !!pick('mapsIncludeWMO', true),
		mapsIncludeM2: !!pick('mapsIncludeM2', true),
		mapsIncludeWMOSets: !!pick('mapsIncludeWMOSets', true),
		exportFoliageMeta: !!pick('exportFoliageMeta', false),
		mapsIncludeFoliage: !!pick('mapsIncludeFoliage', false),
		mapsIncludeLiquid: !!pick('mapsIncludeLiquid', true),
		mapsIncludeGameObjects: !!pick('mapsIncludeGameObjects', false)
	};
}

/**
 * Compute ADT tile world bounds.
 * @param {number} tileX
 * @param {number} tileY
 * @returns {{startX:number,startY:number,endX:number,endY:number}}
 */
function getTileBounds(tileX, tileY) {
	const TILE_SIZE = constants.GAME.TILE_SIZE;
	const MAP_OFFSET = constants.GAME.MAP_OFFSET;
	const startX = MAP_OFFSET - (tileX * TILE_SIZE) - TILE_SIZE;
	const startY = MAP_OFFSET - (tileY * TILE_SIZE) - TILE_SIZE;
	return { startX, startY, endX: startX + TILE_SIZE, endY: startY + TILE_SIZE };
}

/**
 * Collect game objects for a specific map with optional filter.
 * Indexed by mapID and cached across calls.
 * @param {number} mapID
 * @param {(row:any)=>boolean} [filter]
 * @returns {Promise<Set<any>>}
 */
async function collectGameObjects(mapID, filter) {
	if (gameObjectsDB2 === null) {
		const objTable = new WDCReader('DBFilesClient/GameObjects.db2');
		await objTable.parse();

		const idTable = new WDCReader('DBFilesClient/GameObjectDisplayInfo.db2');
		await idTable.parse();

		gameObjectsDB2 = new Map();
		for (const row of objTable.getAllRows().values()) {
			const fidRow = idTable.getRow(row.DisplayID);
			if (fidRow !== null) {
				row.FileDataID = fidRow.FileDataID;
				let map = gameObjectsDB2.get(row.OwnerID);
				if (map === undefined) {
					map = new Set();
					map.add(row);
					gameObjectsDB2.set(row.OwnerID, map);
				} else {
					map.add(row);
				}
			}
		}
	}

	const result = new Set();
	const mapObjects = gameObjectsDB2.get(mapID);
	if (mapObjects !== undefined) {
		for (const obj of mapObjects) {
			if (filter !== undefined && filter(obj))
				result.add(obj);
		}
	}
	return result;
}

module.exports = {
	buildADTExportOptions,
	getTileBounds,
	collectGameObjects
};



