const fs = require('fs');
const path = require('path');
const os = require('os');
const sass = require('sass');
const childProcess = require('child_process');

const isWindows = process.platform === 'win32';
const debugTarget = isWindows ? 'win-x64-debug' : 'linux-x64-debug';
const nwBinary = isWindows ? 'nw.exe' : 'nw';
const nwPath = `./bin/${debugTarget}/${nwBinary}`;
const srcDir = './src/';
const appScss = './src/app.scss';
const appName = 'wow.export-huy-edition';

const resolveDataPath = () => {
	// Emulate nw.App.dataPath default per OS
	if (process.platform === 'win32') {
		const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
		return path.join(localAppData, appName, 'User Data', 'Default');
	}
	if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support', appName, 'Default');
	}
	// linux and others
	return path.join(os.homedir(), '.config', appName, 'Default');
};

const runtimeLog = path.join(resolveDataPath(), 'runtime.log');
console.log('Runtime log: %s', runtimeLog);

(async () => {
	// Check if NW.js debug binary exists
	try {
		await fs.promises.access(nwPath);
	} catch (err) {
		throw new Error(`Could not find debug executable at ${nwPath}, ensure you have run \`node build ${debugTarget}\` first.`);
	}

	// Locate all .scss files under /src/
	const scssFiles = (await fs.promises.readdir(srcDir)).filter(file => file.endsWith('.scss'));

	// Recompile app.scss on startup.
	try {
		const result = sass.compile(appScss);
		await fs.promises.writeFile(appScss.replace('.scss', '.css'), result.css);
	} catch (err) {
		console.error('Failed to compile application css: %s', err);
	}

	// Monitor the .scss files for changes
	scssFiles.forEach(file => {
		fs.watchFile(path.join(srcDir, file), async () => {
			console.log('Detected change in %s, recompiling...', file);
			// If there are any changes in any of the .scss files, recompile app.scss.
			try {
				const result = sass.compile(appScss);
				await fs.promises.writeFile(appScss.replace('.scss', '.css'), result.css);
			} catch (err) {
				console.error('Failed to compile application css: %s', err);
			}
		});
	});

	// Start tailing runtime.log in the background (if/when it appears)
	const startRuntimeLogTail = async () => {
		// Wait until the log file exists
		for (;;) {
			try {
				await fs.promises.access(runtimeLog);
				break;
			} catch (e) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
		}

		// Begin tailing appended content only (skip existing content)
		fs.watchFile(runtimeLog, { interval: 500 }, (curr, prev) => {
			// Handle truncation/rotation
			if (curr.size < prev.size) {
				prev = { ...prev, size: 0 };
			}

			if (curr.size > prev.size) {
				const stream = fs.createReadStream(runtimeLog, { start: prev.size, end: curr.size - 1 });
				stream.pipe(process.stdout, { end: false });
			}
		});
	};

	// Fire and forget; do not block the rest of the script
	startRuntimeLogTail().catch(err => console.error('Failed to tail runtime.log: %s', err));

	// Launch NW.js
	const nwProcess = childProcess.spawn(nwPath, { stdio: 'inherit' });

	// When the spawned process is closed, exit the Node.js process as well
	nwProcess.on('close', code => {
		fs.unwatchFile(runtimeLog);
		process.exit(code);
	});
})();