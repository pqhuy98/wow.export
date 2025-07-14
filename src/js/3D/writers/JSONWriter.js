/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const generics = require('../../generics');
const path = require('path');
const FileWriter = require('../../file-writer');

class JSONWriter {
	/**
	 * Construct a new JSONWriter instance.
	 * @param {string} out 
	 */
	constructor(out) {
		this.out = out;
		this.data = {};
	}

	/**
	 * Add a property to this JSON.
	 * @param {string} name 
	 * @param {object} data 
	 */
	addProperty(name, data) {
		this.data[name] = data;
	}

	/**
	 * Write the JSON to disk.
	 * @param {boolean} overwrite
	 */
	async write(overwrite = true, minify = false) {
		const start = performance.now();
		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);

		// Try the fastest stringify path first (no replacer). If the payload contains
		// BigInt values Node will throw – fall back to a replacer only in that case.
		let jsonStr;
		try {
			jsonStr = JSON.stringify(this.data, null, minify ? null : '\t');
		} catch (err) {
			if (err && /BigInt/.test(err.message)) 
				jsonStr = JSON.stringify(this.data, (key, value) => typeof value === 'bigint' ? value.toString() : value, minify ? null : '\t');
			else throw err;			
		}

		await writer.writeLine(jsonStr);
		writer.close();
		console.log('JSONWriter write', this.out, 'took', performance.now() - start, 'ms');
	}
}

module.exports = JSONWriter;