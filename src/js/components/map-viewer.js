/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
	const util = require('util');
	const core = require('../core');
	const constants = require('../constants');
	
	const MAP_SIZE = constants.GAME.MAP_SIZE;
	const MAP_SIZE_SQ = constants.GAME.MAP_SIZE_SQ;
	const MAP_COORD_BASE = constants.GAME.MAP_COORD_BASE;
	const TILE_SIZE = constants.GAME.TILE_SIZE;
	
	// Persisted state for the map-viewer component. This generally goes against the
	// principals of reactive instanced components, but unfortunately nothing else worked
	// for maintaining state. This just means we can only have one map-viewer component.
	const state = {
		offsetX: 0,
		offsetY: 0,
		zoomFactor: 2,
		tileQueue: [],
		selectCache: new Set(),
		// Track queued/in-flight requests to avoid duplicates and reprioritize safely.
		pendingRequests: new Set()
	};
	
module.exports = {
	/**
	 * loader: Tile loader function.
	 * tileSize: Base size of tiles (before zoom).
	 * map: ID of the current map. We use this to listen for map changes.
	 * zoom: Maxium zoom-out factor allowed.
	 * mask: Chunk mask. Expected MAP_SIZE ^ 2 array.
	 * selection: Array defining selected tiles.
	 */
	props: ['loader', 'tileSize', 'map', 'zoom', 'mask', 'selection'],

	data: function() {
		return {
			hoverInfo: '',
			hoverTile: null,
			isHovering: false,
			isPanning: false,
			isSelecting: false,
			selectState: true
		}
	},

	/**
	 * Invoked when this component is mounted in the DOM.
	 */
	mounted: function() {
		// Store a local reference to the canvas context for faster rendering.
		this.context = this.$refs.canvas.getContext('2d');

		// Ensure cache exists on first mount.
		this.initializeCache();

		// Internal RAF render throttle flag.
		this._renderPending = false;

		// Create anonymous pass-through functions for our event handlers
		// to maintain context. We store them so we can unregister them later.
		this.onMouseMove = event => this.handleMouseMove(event);
		this.onMouseUp = event => this.handleMouseUp(event);

		// Mouse move/up events are registered onto the document so we can
		// still handle them if the user moves off the component while dragging.
		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		// Listen for key press evetns to handle Select All function.
		this.onKeyPress = event => this.handleKeyPress(event);
		document.addEventListener('keydown', this.onKeyPress);

		// Register a resize listener onto the window so we can adjust.
		// We use an anonymous function to maintain context, and store it
		// on the instance so we can unregister later.
		this.onResize = () => this.scheduleRender();
		window.addEventListener('resize', this.onResize);

		// We need to also monitor for size changes to the canvas itself so we
		// can keep it relatively positioned.
		this.observer = new ResizeObserver(() => this.onResize());
		this.observer.observe(this.$el);

		// Manually trigger an initial render.
		this.scheduleRender();
	},

	/**
	 * Invoked when this component is about to be destroyed.
	 */
	beforeDestory: function() {
		// Unregister window resize listener.
		window.removeEventListener('resize', this.onResize);

		// Unregister mouse listeners applied to document.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		// Unregister key listener.
		document.removeEventListener('keydown', this.onKeyPress);

		// Disconnect the resize observer for the canvas.
		this.observer.disconnect();
	},

	watch: {
		/**
		 * Invoked when the map property changes for this component.
		 * This indicates that a new map has been selected for rendering.
		 */
		map: function() {
			// Reset the cache.
			this.initializeCache();

			// Set the map position to a default position.
			// This will trigger a re-render for us too.
			this.setToDefaultPosition();
		},

		/**
		 * Invoked when the tile being hovered over changes.
		 */
		hoverTile: function() {
			this.scheduleRender();
		}
	},

	methods: {
			/**
			 * Pick the best mip canvas for the requested draw size.
			 */
			pickMipCanvas: function(entry, drawSize) {
				if (entry && entry.mips && entry.mips.sizes && entry.mips.canvases) {
					const sizes = entry.mips.sizes;
					const canvases = entry.mips.canvases;
					// The sizes array is maintained in descending order. Scan from
					// the smallest upward (end to start) to find the smallest mip >= drawSize.
					for (let i = sizes.length - 1; i >= 0; i--) {
						if (sizes[i] >= drawSize)
							return canvases[i];
					}
					// No mip >= draw size, fall back to the largest available mip.
					return canvases[0] || entry.canvas || null;
				}
				return entry && entry.canvas ? entry.canvas : null;
			},

			/**
			 * Ensure an entry object exists for a cache index.
			 */
			ensureEntryForIndex: function(index) {
				let entry = state.cache[index];
				if (!entry || entry === true || entry === false)
					entry = state.cache[index] = { mips: { sizes: [], canvases: [] } };
				if (!entry.mips)
					entry.mips = { sizes: [], canvases: [] };
				return entry;
			},

			/**
			 * Add a mip of a given size, scaled from baseCanvas, if missing.
			 */
			addMipIfMissing: function(entry, size, baseCanvas) {
				const sizes = entry.mips.sizes;
				if (sizes.indexOf(size) !== -1)
					return;
				const c = document.createElement('canvas');
				c.width = size;
				c.height = size;
				const cctx = c.getContext('2d');
				if (cctx) {
					cctx.imageSmoothingEnabled = false;
					cctx.drawImage(baseCanvas, 0, 0, size, size);
				}
				entry.mips.sizes.push(size);
				entry.mips.canvases.push(c);
				// Maintain sizes in descending order to match selection logic.
				const pairs = entry.mips.sizes.map((s, i) => ({ s, c: entry.mips.canvases[i] }));
				pairs.sort((a, b) => b.s - a.s);
				entry.mips.sizes = pairs.map(p => p.s);
				entry.mips.canvases = pairs.map(p => p.c);
			},

			/**
			 * Populate mip chain for an entry from a base canvas/size.
			 */
			populateMipsFromBase: function(entry, baseCanvas, baseSize) {
				// Always store the exact base size mip.
				this.addMipIfMissing(entry, baseSize, baseCanvas);
				// Generate pow2 mips down to a reasonable minimum (32px) similar to web.
				let sizePow2 = 1;
				const minDim = Math.min(baseCanvas.width, baseCanvas.height);
				while (sizePow2 * 2 <= minDim)
					sizePow2 *= 2;
				for (let s = sizePow2; s >= 32; s = Math.floor(s / 2))
					this.addMipIfMissing(entry, s, baseCanvas);
			},

			/**
			 * Get the largest available mip size for an entry.
			 */
			getLargestMipSize: function(entry) {
				if (entry && entry.mips && entry.mips.sizes && entry.mips.sizes.length > 0)
					return entry.mips.sizes[0]; // sizes kept in descending order
				if (entry && entry.size)
					return entry.size;
				return 0;
			},
		/**
		 * Schedule a render using requestAnimationFrame, collapsing multiple
		 * immediate render requests into a single frame.
		 */
		scheduleRender: function() {
			if (this._renderPending)
				return;

			this._renderPending = true;
			requestAnimationFrame(() => {
				this._renderPending = false;
				this.render();
			});
		},
		/**
		 * Initialize a fresh cache array.
		 */
		initializeCache: function() {
			state.tileQueue = [];
			state.cache = new Array(MAP_SIZE_SQ);
			state.pendingRequests.clear();
			this.awaitingTile = false;
		},

		/**
		 * Process the next tile in the loading queue.
		 */
		checkTileQueue: function() {
			if (state.tileQueue.length === 0) {
				this.awaitingTile = false;
				return;
			}

			// Prioritize by distance to hovered tile (or viewport center).
			state.tileQueue.sort((a, b) => this.computePriority(a[0], a[1]) - this.computePriority(b[0], b[1]));
			const tile = state.tileQueue.shift();
			this.loadTile(tile);
		},

		/**
		 * Add a tile to the queue to be loaded.
		 * @param {number} x 
		 * @param {number} y 
		 * @param {number} index 
		 * @param {number} tileSize 
		 */
		queueTile: function(x, y, index, tileSize) {
			// Avoid duplicate requests for the same tile/size.
			const key = index + ':' + tileSize;
			if (state.pendingRequests.has(key))
				return;

			// Skip if tile not visible anymore.
			const viewport = this.$el;
			const drawX = (x * tileSize) + state.offsetX;
			const drawY = (y * tileSize) + state.offsetY;
			if (drawX > (viewport.clientWidth + tileSize) || drawY > (viewport.clientHeight + tileSize) || drawX + tileSize < -tileSize || drawY + tileSize < -tileSize)
				return;

			state.pendingRequests.add(key);
			const node = [x, y, index, tileSize];
			state.tileQueue.push(node);

			if (!this.awaitingTile)
				this.loadTile(node);
		},

		/**
		 * Compute priority based on Manhattan distance to hovered tile or viewport center.
		 */
		computePriority: function(x, y) {
			if (this.hoverTile !== null) {
				const hx = Math.floor(this.hoverTile / MAP_SIZE);
				const hy = this.hoverTile % MAP_SIZE;
				return Math.abs(x - hx) + Math.abs(y - hy);
			} else {
				const rect = this.$el.getBoundingClientRect();
				const center = this.mapPositionFromClientPoint(rect.x + (rect.width / 2), rect.y + (rect.height / 2));
				return Math.abs(x - center.tileX) + Math.abs(y - center.tileY);
			}
		},

		/**
		 * Load a given tile into the cache.
		 * Triggers a re-render and queue-check once loaded.
		 * @param {Array} tile 
		 */
		loadTile: function(tile) {
			this.awaitingTile = true;

			const [x, y, index, tileSize] = tile;

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected. 
			const cache = state.cache;

		this.loader(x, y, tileSize).then(data => {
				if (data !== false && data) {
					// Convert ImageData to an offscreen canvas and store with mip metadata.
					const baseCanvas = document.createElement('canvas');
					baseCanvas.width = data.width;
					baseCanvas.height = data.height;
					baseCanvas.getContext('2d').putImageData(data, 0, 0);
					const entry = this.ensureEntryForIndex(index);
					entry.canvas = baseCanvas; // fallback/base
					entry.size = Math.max(entry.size || 0, tileSize);
					this.populateMipsFromBase(entry, baseCanvas, tileSize);
					cache[index] = entry;
				} else {
					cache[index] = false;
				}

				// Mark request complete for this tile/size
				state.pendingRequests.delete(index + ':' + tileSize);

				this.scheduleRender();
				this.checkTileQueue();
			});
		},

		/**
		 * Set the map to a sensible default position. For most maps this will be centered
		 * on 0, 0. For maps without a chunk at 0, 0 it will center on the first chunk that
		 * is activated in the mask (providing one is set).
		 */
		setToDefaultPosition: function() {
			let posX = 0, posY = 0;

			// We can only search for a chunk if we have a mask set.
			if (this.mask) {
				// Check if we have a center chunk, if so we can leave the default as 0,0.
				const center = Math.floor(MAP_COORD_BASE / TILE_SIZE);
				const centerIndex = this.mask[(center * MAP_SIZE) + center];
				
				// No center chunk, find first chunk available.
				if (centerIndex !== 1) {
					const index = this.mask.findIndex(e => e === 1);

					if (index > -1) {
						// Translate the index into chunk co-ordinates, expand those to in-game co-ordinates
						// and then offset by half a chunk so that we are centered on the chunk.
						const chunkX = index % MAP_SIZE;
						const chunkY = Math.floor(index / MAP_SIZE);
						posX = ((chunkX - 32) * TILE_SIZE) * -1;
						posY = ((chunkY - 32) * TILE_SIZE) * -1;
					}
				}
			}

			this.setMapPosition(posX, posY);
		},

		/**
		 * Update the position of the internal container.
		 */
		render: function() {
			// If no map has been selected, do not render.
			if (this.map === null)
				return;

			// No canvas reference? Component likely dismounting.
			const canvas = this.$refs.canvas;
			if (!canvas)
				return;

			// DPI-aware canvas sizing; operate in CSS pixel space via transform.
			const dpr = Math.max(1, Math.min(3, Math.floor(window.devicePixelRatio || 1)));
			const cssW = canvas.offsetWidth;
			const cssH = canvas.offsetHeight;
			if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
				canvas.width = Math.floor(cssW * dpr);
				canvas.height = Math.floor(cssH * dpr);
				this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
			}

			// Viewport width/height defines what is visible to the user.
			const viewport = this.$el;
			const viewportWidth = viewport.clientWidth;
			const viewportHeight = viewport.clientHeight;

			// Calculate which tiles will appear within the viewer.
			let tileSize = Math.floor(this.tileSize / state.zoomFactor);
			tileSize = Math.max(1, tileSize);

			// Get local reference to the canvas context.
			const ctx = this.context;
			ctx.imageSmoothingEnabled = false;
			// Clear the full frame once per render to avoid per-tile clears
			ctx.clearRect(0, 0, cssW, cssH);

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected. 
			const cache = state.cache;

			// Compute visible tile range to avoid iterating the full grid.
			const startX = Math.max(0, Math.floor((-state.offsetX) / tileSize) - 1);
			const endX = Math.min(MAP_SIZE - 1, Math.floor((viewportWidth - state.offsetX) / tileSize) + 1);
			const startY = Math.max(0, Math.floor((-state.offsetY) / tileSize) - 1);
			const endY = Math.min(MAP_SIZE - 1, Math.floor((viewportHeight - state.offsetY) / tileSize) + 1);

			// Iterate only visible tiles.
			for (let x = startX; x <= endX; x++) {
				for (let y = startY; y <= endY; y++) {
					// drawX/drawY is the absolute position to draw this tile.
					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;

					// Cache is a one-dimensional array, calculate the index as such.
					const index = (x * MAP_SIZE) + y;
					const cached = cache[index];

					// This chunk is masked out, so skip rendering it.
					if (this.mask && this.mask[index] !== 1)
						continue;

					// No cache, request it (async) then skip.
					if (cached === undefined) {
						// Set the tile cache to 'true' so it is skipped while loading.
						cache[index] = true;

						// Add this tile to the loading queue.
						this.queueTile(x, y, index, tileSize);
				} else if (cached && cached.canvas) {
					// Upgrade legacy single-canvas cache entry to mip-aware entry on the fly.
					if (!cached.mips) {
						const upgraded = this.ensureEntryForIndex(index);
						upgraded.canvas = cached.canvas;
						upgraded.size = cached.size || cached.canvas.width;
						this.populateMipsFromBase(upgraded, cached.canvas, upgraded.size);
						state.cache[index] = cached = upgraded;
					}
					const src = this.pickMipCanvas(cached, tileSize) || cached.canvas;
					if (src)
						ctx.drawImage(src, drawX, drawY, tileSize, tileSize);
					// If our largest mip is smaller than requested draw size, request a higher-res tile.
					if (this.getLargestMipSize(cached) < tileSize) {
						if (cached.requestedSize !== tileSize) {
							cached.requestedSize = tileSize;
							this.queueTile(x, y, index, tileSize);
						}
					}
					} else if (cached instanceof ImageData) {
						// Backward compatibility: convert ImageData cache into a canvas once.
						const tmp = document.createElement('canvas');
						tmp.width = cached.width;
						tmp.height = cached.height;
						tmp.getContext('2d').putImageData(cached, 0, 0);
						const entry = this.ensureEntryForIndex(index);
						entry.canvas = tmp;
						entry.size = tmp.width;
						this.populateMipsFromBase(entry, tmp, tmp.width);
						cache[index] = entry;
						const src = this.pickMipCanvas(entry, tileSize) || tmp;
						ctx.drawImage(src, drawX, drawY, tileSize, tileSize);
					}

					// Draw the selection overlay if this tile is selected.
					if (this.selection.includes(index)) {
						ctx.fillStyle = 'rgba(159, 241, 161, 0.5)';
						ctx.fillRect(drawX, drawY, tileSize, tileSize);	
					}

					// Draw the hover overlay if this tile is hovered over.
					if (this.hoverTile === index) {
						ctx.fillStyle = 'rgba(87, 175, 226, 0.5)';
						ctx.fillRect(drawX, drawY, tileSize, tileSize);
					}
				}
			}
		},

		/**
		 * Invoked when a key press event is fired on the document.
		 * @param {KeyboardEvent} event 
		 */
		handleKeyPress: function(event) {
			// Check if the user cursor is over the map viewer.
			if (this.isHovering === false)
				return;

			if (event.ctrlKey === true && event.key === 'a') {
				// Without a WDT mask, we can't reliably select everything.
				if (!this.mask) {
					core.setToast('error', 'Unable to perform Select All operation on this map (Missing WDT)', null, -1);
					return;
				}

				this.selection.length = 0; // Reset the selection array.
				
				// Iterate over all available tiles in the mask and select them.
				for (let i = 0, n = this.mask.length; i < n; i++) {
					if (this.mask[i] === 1)
						this.selection.push(i);
				}

			// Trigger a re-render to show the new selection.
			this.scheduleRender();
				
				// Absorb this event preventing further action.
				event.preventDefault();
				event.stopPropagation();
			}
		},

		/**
		 * @param {MouseEvent} event 
		 * @returns 
		 */
		handleTileInteraction: function(event, isFirst = false) {
			// Calculate which chunk we shift-clicked on.
			const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);
			const index = (point.tileX * MAP_SIZE) + point.tileY;

			// Prevent toggling a tile that we've already touched during this selection.
			if (state.selectCache.has(index))
				return;

			state.selectCache.add(index);

			if (this.mask) {
				// If we have a WDT, and this tile is not defined, disallow selection.
				if (this.mask[index] !== 1)
					return;
			} else {
				// No WDT, disallow selection if tile is not rendered.
				if (typeof state.cache[index] !== 'object')
					return;
			}

			const check = this.selection.indexOf(index);
			if (isFirst)
				this.selectState = check > -1;

			if (this.selectState && check > -1)
				this.selection.splice(check, 1);
			else if (!this.selectState && check === -1)
				this.selection.push(index);

		// Trigger a re-render so the overlay updates.
		this.scheduleRender();
		},

		/**
		 * Invoked on mousemove events captured on the document.
		 * @param {MouseEvent} event
		 */
		handleMouseMove: function(event) {
			if (this.isSelecting) {
				this.handleTileInteraction(event, false);
			} else if (this.isPanning) {
				// Calculate the distance from our mousedown event.
				const deltaX = this.mouseBaseX - event.clientX;
				const deltaY = this.mouseBaseY - event.clientY;

				// Update the offset based on our pan base.
				state.offsetX = this.panBaseX - deltaX;
				state.offsetY = this.panBaseY - deltaY;

				// Offsets are not reactive, manually trigger an update.
				this.scheduleRender();
			}
		},

		/**
		 * Invoked on mouseup events captured on the document.
		 */
		handleMouseUp: function() {
			if (this.isPanning)
				this.isPanning = false;

			if (this.isSelecting) {
				this.isSelecting = false;
				state.selectCache.clear();
			}
		},

		/**
		 * Invoked on mousedown events captured on the container element.
		 * @param {MouseEvent} event
		 */
		handleMouseDown: function(event) {
			if (event.shiftKey) {
				this.handleTileInteraction(event, true);
				this.isSelecting = true;
			} else if (!this.isPanning) {
				this.isPanning = true;

				// Store the X/Y of the mouse event to calculate drag deltas.
				this.mouseBaseX = event.clientX;
				this.mouseBaseY = event.clientY;

				// Store the current offsetX/offsetY used for relative panning
				// as the user drags the component.
				this.panBaseX = state.offsetX;
				this.panBaseY = state.offsetY;
			}
		},

		/**
		 * Convert an absolute client point (such as cursor position) to a relative
		 * position on the map. Returns { tileX, tileY posX, posY }
		 * @param {number} x 
		 * @param {number} y 
		 */
		mapPositionFromClientPoint: function(x, y) {
			const viewport = this.$el.getBoundingClientRect();
			
			const viewOfsX = (x - viewport.x) - state.offsetX;
			const viewOfsY = (y - viewport.y) - state.offsetY;

			let tileSize = Math.floor(this.tileSize / state.zoomFactor);
			tileSize = Math.max(1, tileSize);

			const tileX = viewOfsX / tileSize;
			const tileY = viewOfsY / tileSize;

			const posX = MAP_COORD_BASE - (TILE_SIZE * tileX);
			const posY = MAP_COORD_BASE - (TILE_SIZE * tileY);

			return { tileX: Math.floor(tileX), tileY: Math.floor(tileY), posX: posY, posY: posX };
		},

		/**
		 * Centers the map on a given X, Y in-game position.
		 * @param {number} x 
		 * @param {number} y 
		 */
		setMapPosition: function(x, y) {
			// Translate to WoW co-ordinates.
			const posX = y;
			const posY = x;

			let tileSize = Math.floor(this.tileSize / state.zoomFactor);
			tileSize = Math.max(1, tileSize);

			const ofsX = (((posX - MAP_COORD_BASE) / TILE_SIZE) * tileSize);
			const ofsY = (((posY - MAP_COORD_BASE) / TILE_SIZE) * tileSize);

			const viewport = this.$el;
			state.offsetX = ofsX + (viewport.clientWidth / 2);
			state.offsetY = ofsY + (viewport.clientHeight / 2);

			this.scheduleRender();
		},

		/**
		 * Set the zoom factor. This will invalidate the cache.
		 * This function will not re-render the preview.
		 * @param {number} factor 
		 */
		setZoomFactor: function(factor) {
			state.zoomFactor = factor;
		},

		/**
		 * Invoked when the mouse is moved over the component.
		 * @param {MouseEvent} event 
		 */
		handleMouseOver: function(event) {
			this.isHovering = true;

			const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);
			this.hoverInfo = util.format('%d %d (%d %d)', Math.floor(point.posX), Math.floor(point.posY), point.tileX, point.tileY);

			// If we're not panning, highlight the current tile.
			if (!this.isPanning)
				this.hoverTile = (point.tileX * MAP_SIZE) + point.tileY;
		},

		/**
		 * Invoked when the mouse leaves the component.
		 */
		handleMouseOut: function() {
			this.isHovering = false;

			// Remove the current hover overlay.
			this.hoverTile = null;
		},

		/**
		 * Invoked on mousewheel events captured on the container element.
		 * @param {WheelEvent} event 
		 */
		handleMouseWheel: function(event) {
			const delta = event.deltaY > 0 ? 1 : -1;
			const newZoom = Math.max(1, Math.min(this.zoom, state.zoomFactor + delta));

			// Anchor zoom at the mouse position: the world point under the cursor
			// remains under the cursor after zooming.
			if (newZoom !== state.zoomFactor) {
				const rect = this.$el.getBoundingClientRect();
				const localX = event.clientX - rect.x;
				const localY = event.clientY - rect.y;

				// Compute fractional tile coordinates under the cursor at current zoom.
				let oldTileSize = Math.floor(this.tileSize / state.zoomFactor);
				oldTileSize = Math.max(1, oldTileSize);
				const fracTileX = (localX - state.offsetX) / oldTileSize;
				const fracTileY = (localY - state.offsetY) / oldTileSize;

				// Apply new zoom level.
				this.setZoomFactor(newZoom);

				// Recompute offsets so the same world point stays under the cursor.
				let newTileSize = Math.floor(this.tileSize / state.zoomFactor);
				newTileSize = Math.max(1, newTileSize);
				state.offsetX = localX - (fracTileX * newTileSize);
				state.offsetY = localY - (fracTileY * newTileSize);

				this.scheduleRender();
			}
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-map-viewer" @mousedown="handleMouseDown" @wheel="handleMouseWheel" @mousemove="handleMouseOver" @mouseout="handleMouseOut">
		<div class="info">
			<span>Navigate: Click + Drag</span>
			<span>Select Tile: Shift + Click</span>
			<span>Zoom: Mouse Wheel</span>
			<span>Select All: Control + A</span>
		</div>
		<div class="hover-info">{{ hoverInfo }}</div>
		<canvas ref="canvas"></canvas>
	</div>`
};