const DBModelFileData = require('./DBModelFileData');
const DBItemDisplays = require('./DBItemDisplays');
const DBCreatures = require('./DBCreatures');
const DBTextureFileData = require('./DBTextureFileData');

module.exports = {
  initModelCaches: () => [
    DBModelFileData.initializeModelFileData(),
    DBItemDisplays.initializeItemDisplays(),
    DBCreatures.initializeCreatureData(),
    DBTextureFileData.initializeTextureFileData(),
  ]
}