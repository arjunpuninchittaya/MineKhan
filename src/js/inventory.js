import { SLAB, STAIR, shapes } from "./shapes"
import { blockData, blockIds } from "./blockData"

/**
* @type {HTMLCanvasElement}
*/
const invCanvas = document.getElementById("inventory")
const invCtx = invCanvas.getContext("2d")

/**
* @type {HTMLCanvasElement}
*/
const containerCanvas = document.getElementById("container")
const contCtx = containerCanvas.getContext("2d")

const heldItemCanvas = document.createElement("canvas")
heldItemCanvas.style.zIndex = 2
heldItemCanvas.style.pointerEvents = "none"
heldItemCanvas.width = 64
heldItemCanvas.height = 64
heldItemCanvas.className = "hidden corner"
heldItemCanvas.id = "heldItem"
document.body.append(heldItemCanvas)

invCanvas.oncontextmenu = heldItemCanvas.oncontextmenu = containerCanvas.oncontextmenu = function(e) {
	e.preventDefault()
}

const heldCtx = heldItemCanvas.getContext("2d")

/**
 * @type {HTMLDivElement}
 */
const hoverBox = document.getElementById("onhover")

/**
 * Draws a single Minecraft-style inset slot background.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Number} x
 * @param {Number} y
 * @param {Number} size
 */
const drawSlot = (ctx, x, y, size) => {
	const b = Math.max(1, size >> 4) // border ≈ 1/16 of slot size
	ctx.fillStyle = "#8b8b8b"
	ctx.fillRect(x, y, size, size)
	// Top/left dark edges (recessed look)
	ctx.fillStyle = "#373737"
	ctx.fillRect(x, y, size, b)
	ctx.fillRect(x, y, b, size)
	// Bottom/right light edges
	ctx.fillStyle = "#ffffff"
	ctx.fillRect(x, y + size - b, size, b)
	ctx.fillRect(x + size - b, y, b, size)
}

/**
 * Draws a simple Steve-like player figure on a 2D canvas.
 * The figure is 16 pixels wide × 32 pixels tall in "block pixels";
 * `sc` is the scale factor (pixels per block-pixel).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Number} cx  Centre-X of the figure
 * @param {Number} ty  Top-Y of the figure
 * @param {Number} sc  Scale factor
 */
/**
 * Draws a right-pointing arrow for the crafting output indicator.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Number} fromX  Left edge of the arrow
 * @param {Number} centerY  Vertical centre
 * @param {Number} w  Total width of the arrow
 */
const drawArrow = (ctx, fromX, centerY, w) => {
	const bodyH = Math.max(2, w * 0.2 | 0)
	const headH = Math.max(4, w * 0.5 | 0)
	const headW = Math.max(4, w * 0.35 | 0)
	const bodyW = w - headW
	ctx.fillStyle = "#555555"
	ctx.fillRect(fromX, centerY - (bodyH >> 1), bodyW, bodyH)
	ctx.beginPath()
	ctx.moveTo(fromX + bodyW, centerY - (headH >> 1))
	ctx.lineTo(fromX + w, centerY)
	ctx.lineTo(fromX + bodyW, centerY + (headH >> 1))
	ctx.closePath()
	ctx.fill()
}

const drawPlayerModel = (ctx, cx, ty, sc) => {
	sc = Math.max(1, sc)
	// Head (8×8)
	ctx.fillStyle = "#f4c98a"
	ctx.fillRect(cx - 4*sc, ty, 8*sc, 8*sc)
	// Hair detail
	ctx.fillStyle = "#6b4226"
	ctx.fillRect(cx - 4*sc, ty, 8*sc, 2*sc)           // top
	ctx.fillRect(cx - 4*sc, ty + 2*sc, sc, 5*sc)      // left side
	ctx.fillRect(cx + 3*sc, ty + 2*sc, sc, 5*sc)      // right side
	// Eyes
	ctx.fillStyle = "#111111"
	ctx.fillRect(cx - 2*sc, ty + 3*sc, sc, 2*sc)      // left eye
	ctx.fillRect(cx + sc,   ty + 3*sc, sc, 2*sc)      // right eye
	// Body (8×12)
	ctx.fillStyle = "#4a90d9"
	ctx.fillRect(cx - 4*sc, ty + 8*sc, 8*sc, 12*sc)
	// Left arm (4×12)
	ctx.fillStyle = "#4a90d9"
	ctx.fillRect(cx - 8*sc, ty + 8*sc, 4*sc, 8*sc)
	ctx.fillStyle = "#f4c98a"
	ctx.fillRect(cx - 8*sc, ty + 16*sc, 4*sc, 4*sc)  // left hand
	// Right arm (4×12)
	ctx.fillStyle = "#4a90d9"
	ctx.fillRect(cx + 4*sc, ty + 8*sc, 4*sc, 8*sc)
	ctx.fillStyle = "#f4c98a"
	ctx.fillRect(cx + 4*sc, ty + 16*sc, 4*sc, 4*sc)  // right hand
	// Legs (each 4×12)
	ctx.fillStyle = "#3d5a8a"
	ctx.fillRect(cx - 4*sc, ty + 20*sc, 4*sc, 10*sc) // left leg
	ctx.fillRect(cx,        ty + 20*sc, 4*sc, 10*sc) // right leg
	// Boots
	ctx.fillStyle = "#2a2a2a"
	ctx.fillRect(cx - 4*sc, ty + 30*sc, 4*sc, 2*sc)  // left boot
	ctx.fillRect(cx,        ty + 30*sc, 4*sc, 2*sc)  // right boot
}

const displayHoverText = (text, mouseX, mouseY) => {
	hoverBox.textContent = text
	hoverBox.classList.remove("hidden")
	if (mouseY < window.parent.innerHeight / 2) {
		hoverBox.style.bottom = ""
		hoverBox.style.top = mouseY + 10 + "px"
	}
	else {
		hoverBox.style.top = ""
		hoverBox.style.bottom = window.parent.innerHeight - mouseY + 10 + "px"
	}
	if (mouseX < window.parent.innerWidth / 2) {
		hoverBox.style.right = ""
		hoverBox.style.left = mouseX + 10 + "px"
	}
	else {
		hoverBox.style.left = ""
		hoverBox.style.right = window.parent.innerWidth - mouseX + 10 + "px"
	}
}

class InventoryItem {
	/**
	 * @param {Number} id
	 * @param {String} name
	 * @param {Number} stackSize
	 * @param {HTMLCanvasElement} icon
	 */
	constructor(id, name, stackSize, icon) {
		this.id = id
		this.name = name
		this.stackSize = stackSize
		this.icon = icon
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {Number} x
	 * @param {Number} y
	 * @param {Number} width
	 */
	render(ctx, x, y, width) {
		if (!this.icon) return
		ctx.drawImage(this.icon, x, y, width, width)

		if (this.stackSize > 1) {
			ctx.font = "12px Monospace"
			ctx.textAlign = "right"
			ctx.fillStyle = "white"
			ctx.fillText(this.stackSize.toString(), x + width - 4, y + width - 4)
		}
	}
	copy() {
		return new InventoryItem(this.id, this.name, this.stackSize, this.icon)
	}
}

const air = new InventoryItem(0, "Air", 1, null)

class InventoryPage {
	creative = true
	left = 0
	top = 0
	slotSize = 64
	size = 27
	width = 9 * this.slotSize
	height = Math.ceil(this.size / 9) * this.slotSize
	hoverIndex = -1

	/**
	 * @type {Array<InventoryItem>}
	 */
	items = []

	/**
	 * @param {CanvasRenderingContext2D} context The context to render to.
	 * @param {HTMLCanvasElement} icon The icon for the inventory page. Like a stair block for the stair inventory or whatever.
	 */
	constructor(context, icon) {
		this.icon = icon
		this.ctx = context
	}

	/**
	 * @param {InventoryItem} item
	 */
	addItem(item) {
		if (!item || item === air) return
		for (let i = 0; i < this.size; i++) {
			if (!this.items[i]) {
				this.items[i] = item
				return
			}
			if (this.items[i].id === item.id) {
				this.items[i].stackSize += item.stackSize
				return
			}
		}
	}
	sortByName() {
		this.items.sort((a, b) => a.name.localeCompare(b.name))
	}
	sortById() {
		this.items.sort((a, b) => blockData[a.id].shape.index - blockData[b.id].shape.index || a.id - b.id)
	}

	indexAt(x, y) {
		if (x < this.left || y < this.top || x > this.left + this.width || y > this.top + this.height) return -1
		x = (x - this.left) / this.slotSize | 0
		y = (y - this.top) / this.slotSize | 0
		if (x < 0 || x > 9 || y < 0 || y * 9 + x >= this.size) return -1
		return y * 9 + x
	}

	renderRow(left, top, slotSize, index) {
		for (let px = 0; px < 9 && index < this.size; px++) {
			if (this.items[index]?.icon) {
				this.items[index].render(this.ctx, left + px * slotSize, top, slotSize)
			}
			index++
		}
	}

	/**
	 * @param {Number} left
	 * @param {Number} top
	 * @param {Number} slotSize
	 */
	render(left = this.left, top = this.top, slotSize = this.slotSize) {
		// Save render data so we'll have it for click detection
		this.left = left
		this.top = top
		this.slotSize = slotSize
		this.width = 9 * slotSize
		this.height = Math.ceil(this.size / 9) * slotSize
		this.ctx.canvas.height = top + this.height + 10 // Clears the canvas like ctx.clearRect
		this.ctx.canvas.width = this.width + left * 2

		// Draw slot backgrounds (dark inset slots)
		for (let i = 0; i < this.size; i++) {
			drawSlot(this.ctx, left + i % 9 * slotSize, top + (i / 9 | 0) * slotSize, slotSize)
		}

		// Draw the blocks
		let drawn = 0
		for (let py = 0; drawn < this.size; py++) {
			this.renderRow(left, top + py * slotSize, slotSize, drawn)
			drawn += 9
		}
	}
	/**
	 * @param {MouseEvent} event
	 */
	mouseMove(event) {
		const mouseX = event.offsetX
		const mouseY = event.offsetY
		const overIndex = this.indexAt(mouseX, mouseY)
		if (this.items[overIndex]) displayHoverText(this.items[overIndex].name, event.x, event.y)
		if (this.hoverIndex === overIndex) return
		this.ctx.lineWidth = 2

		// Restore the previous slot (redraw background + item)
		if (this.hoverIndex >= 0) {
			const x = this.hoverIndex % 9 * this.slotSize + this.left
			const y = (this.hoverIndex / 9 | 0) * this.slotSize + this.top
			drawSlot(this.ctx, x, y, this.slotSize)
			if (this.items[this.hoverIndex]?.icon) {
				this.items[this.hoverIndex].render(this.ctx, x, y, this.slotSize)
			}
		}
		this.hoverIndex = overIndex

		// Draw new highlight
		if (overIndex >= 0 && this.items[overIndex]?.icon) {
			this.ctx.strokeStyle = "white"
			const x = overIndex % 9 * this.slotSize + this.left
			const y = (overIndex / 9 | 0) * this.slotSize + this.top
			this.ctx.strokeRect(x + 1, y + 1, this.slotSize - 2, this.slotSize - 2)
		}
		else hoverBox.classList.add("hidden")
	}

	/**
	 * What happens when the inventory is clicked
	 * @param {InventoryItem} heldItem The item being dragged around by the mouse
	 * @returns InvenetoryItem
	 */
	mouseClick(heldItem) {
		if (this.hoverIndex === -1) return null
		if (this.creative) {
			if (heldItem?.id === this.items[this.hoverIndex].id) {
				if (heldItem.stackSize < 64) heldItem.stackSize++
				return heldItem
			}
			return this.items[this.hoverIndex].copy() // Discard the previously held item
		}
		let old = this.items[this.hoverIndex]
		if (!heldItem && !old) return null
		if (old?.id === heldItem?.id) {
			old.stackSize += heldItem.stackSize
			if (old.stackSize > 64) {
				heldItem.stackSize = old.stackSize - 64
				old.stackSize = 64
				old = heldItem
			}
			else old = null
		}
		else this.items[this.hoverIndex] = heldItem || null

		// Redraw the tile
		const x = this.hoverIndex % 9 * this.slotSize + this.left
		const y = (this.hoverIndex / 9 | 0) * this.slotSize + this.top
		drawSlot(this.ctx, x, y, this.slotSize)
		if (this.items[this.hoverIndex]) {
			this.items[this.hoverIndex].render(this.ctx, x, y, this.slotSize)
			this.ctx.lineWidth = 2
			this.ctx.strokeStyle = "white"
			this.ctx.strokeRect(x + 1, y + 1, this.slotSize - 2, this.slotSize - 2)
		}

		return old
	}

	/**
	 * @param {InventoryItem | Number} item
	 * @param {Number} index
	 */
	setItem(item, index) {
		if (!item) {
			this.items[index] = null
		}
		else if (item instanceof InventoryItem) {
			this.items[index] = item
		}
		else {
			this.items[index] = new InventoryItem(item, blockData[item].name, 1, blockData[item].iconImg)
		}
	}
}

class Hotbar {
	/**
	 * @param {InventoryPage} inventory
	 * @param {Number} start The first index in the inv to use as the hotbar
	 */
	constructor(inventory, start) {
		this.inventory = inventory
		this.start = this.index = start

		/**
		 * @type {HTMLCanvasElement}
		 */
		this.canvas = document.getElementById("hotbar")
		this.ctx = this.canvas.getContext("2d")
	}

	// Make for..of loops loop over the correct elements
	*[Symbol.iterator]() {
		for (let i = this.start; i < this.inventory.size; i++) yield this.inventory.items[i]?.id || 0
	}

	pickBlock(blockID) {
		let empty = -1
		for (let i = this.start; i < this.inventory.size; i++) {
			if (this.inventory.items[i]?.id === blockID) {
				this.select("black")
				this.index = i
				this.select("white")
				return
			}
			else if (!this.inventory.items[i] && empty === -1) empty = i
		}

		if (empty >= 0 && this.hand !== air) {
			this.select("black")
			this.index = empty
		}
		else this.inventory.addItem(this.inventory.items[this.index])
		let itemData = blockData[blockID]
		this.inventory.items[this.index] = new InventoryItem(blockID, itemData.name, 1, itemData.iconImg)
		this.render()
	}

	setPosition(index) {
		this.select("black")
		this.index = this.start + index
		this.select("white")
	}
	shiftPosition(amount) {
		this.select("black")
		this.index += Math.sign(amount)
		if (this.index >= this.inventory.size) this.index -= 9
		if (this.index < this.start) this.index += 9
		this.select("white")
	}

	get hand() {
		return this.inventory.items[this.index] || air
	}

	select(color) {
		this.ctx.lineWidth = 4
		this.ctx.strokeStyle = color

		const width = this.inventory.slotSize
		this.ctx.strokeRect(2 + width * (this.index - this.start), 2, width, width)
	}

	render() {
		const width = this.inventory.slotSize
		this.canvas.width = width * 9 + 4
		this.canvas.height = width + 4
		this.ctx.lineWidth = 4
		this.ctx.strokeStyle = "black"

		for (let i = 0; i < 9; i++) {
			const x = 2 + width * i
			this.inventory.items[this.start + i]?.render(this.ctx, x, 2, width)
			this.ctx.strokeRect(x, 2, width, width)
		}
		this.select("white")
	}
}

class InventoryManager {
	/**
	 * @type {Array<InventoryPage>}
	 */
	containers = []
	currentPage = 0
	canvas = invCanvas
	iconSize = 64

	/**
	 * @type {InventoryItem}
	 */
	heldItem = null

	/** 2×2 crafting input slots (0-3) + output slot (4) */
	craftSlots = Array(5).fill(null)
	craftingRecipes = []
	craftArea = null

	// Don't initialize the inventory before the icons have been generated!
	init(creative) {
		// Creative Inventories
		if (creative) {
			let cubes = new InventoryPage(contCtx, blockData[blockIds.grass].iconImg)
			let slabs = new InventoryPage(contCtx, blockData[blockIds.smoothStone | SLAB].iconImg)
			let stairs = new InventoryPage(contCtx, blockData[blockIds.oakPlanks | STAIR].iconImg)
			let decor = new InventoryPage(contCtx, blockData[blockIds.poppy].iconImg)
			for (let id in blockData) {
				const block = blockData[id]
				// eslint-disable-next-line no-prototype-builtins
				if (!block.iconImg) continue

				let item = new InventoryItem(+id, block.name, 1, block.iconImg)

				if (block.shape === shapes.cube && block.solid) {
					cubes.items.push(item)
				}
				else if (block.shape === shapes.slab && block.solid) {
					slabs.items.push(item)
				}
				else if (block.shape === shapes.stair && block.solid) {
					stairs.items.push(item)
				}
				else {
					decor.items.push(item)
				}
			}
			cubes.size = cubes.items.length
			slabs.size = slabs.items.length
			stairs.size = stairs.items.length
			decor.size = decor.items.length
			this.containers.push(cubes, slabs, stairs, decor)
		}

		for (let container of this.containers) container.sortById()

		containerCanvas.onmousemove = e => this.mouseMove(e)
		containerCanvas.onmousedown = e => this.mouseClick(e)
		this.render()

		// Survival/hotbar inventory
		let storage = new InventoryPage(invCtx, blockData[blockIds.bookshelf].iconImg)
		storage.creative = false
		this.playerStorage = storage
		this.hotbar = new Hotbar(storage, 27)
		storage.size = 36
		storage.render(10, 10, this.iconSize)

		containerCanvas.onkeydown = invCanvas.onkeydown = window.parent.canvas.onkeydown
		containerCanvas.onkeyup = invCanvas.onkeyup = window.parent.canvas.onkeyup

		invCanvas.onmousemove = e => {
			storage.mouseMove(e)
		}
		invCanvas.onmousedown = () => {
			this.heldItem = storage.mouseClick(this.heldItem)

			if (this.heldItem) {
				heldItemCanvas.classList.remove("hidden")
				heldCtx.clearRect(0, 0, this.iconSize, this.iconSize)
				this.heldItem.render(heldCtx, 0, 0, this.iconSize)
			}
			else heldItemCanvas.classList.add("hidden")

			for (let i = 0; i < this.hotbar.length; i++) {
				this.hotbar[i] = storage.items[i + 27]?.id || 0
			}
		}

		// Render the player panel with a default name; overwritten with the real name on open
		this._initRecipes()
		this.renderPlayerPanel("Player")

		// Player panel mouse handlers (for crafting grid interaction)
		const playerCanvas = document.getElementById("inv-player-canvas")
		if (playerCanvas) {
			playerCanvas.onmousemove = e => this.playerPanelMouseMove(e)
			playerCanvas.onmousedown = e => this.playerPanelMouseDown(e)
			playerCanvas.oncontextmenu = e => e.preventDefault()
			playerCanvas.onkeydown = window.parent.canvas.onkeydown
			playerCanvas.onkeyup = window.parent.canvas.onkeyup
		}
	}

	render() {
		const left = 10
		const top = 10
		const tileSize = this.iconSize

		this.containers[this.currentPage].render(left, top + tileSize + 5, tileSize)

		// Draw each category tab with styled slot background
		for (let i = 0; i < this.containers.length; i++) {
			const inv = this.containers[i]
			drawSlot(contCtx, left + i * tileSize, top, tileSize)
			contCtx.drawImage(inv.icon, left + i * tileSize, top, tileSize, tileSize)
		}
		// Highlight the active tab
		contCtx.lineWidth = 2
		contCtx.strokeStyle = "white"
		contCtx.strokeRect(left + tileSize * this.currentPage + 1, top + 1, tileSize - 2, tileSize - 2)
	}

	/**
	 * @param {MouseEvent} event
	 */
	mouseMove(event) {
		this.containers[this.currentPage].mouseMove(event)
	}

	mouseClick(event) {
		const mouseX = event.offsetX
		const mouseY = event.offsetY
		if (mouseY < 10 + this.iconSize && mouseY > 10 && mouseX > 10 && mouseX < 10 + this.iconSize * this.containers.length) {
			let newPage = (mouseX - 10) / this.iconSize | 0
			if (newPage !== this.currentPage) {
				this.currentPage = newPage
				this.render()
			}
		}
		else {
			this.heldItem = this.containers[this.currentPage].mouseClick(this.heldItem)
			if (this.heldItem) {
				heldItemCanvas.classList.remove("hidden")
				heldCtx.clearRect(0, 0, this.iconSize, this.iconSize)
				this.heldItem.render(heldCtx, 0, 0, this.iconSize)
			}
			else heldItemCanvas.classList.add("hidden")
		}
	}

	/**
	 * @param {Number} newSize
	 */
	set size(newSize) {
		heldItemCanvas.width = heldItemCanvas.height = this.iconSize = newSize
		if (this.playerStorage) {
			this.playerStorage.render(10, 10, newSize)
			this.render()
			this.renderPlayerPanel(this.playerName)
		}
	}

	/**
	 * Renders the player model + armor slots + 2×2 crafting grid panel.
	 * @param {String} [playerName]
	 */
	renderPlayerPanel(playerName) {
		this.playerName = playerName || this.playerName || "Player"
		const canvas = document.getElementById("inv-player-canvas")
		if (!canvas) return
		const s = this.iconSize
		const pad = 10
		const W = 9 * s + pad * 2
		const H = 4 * s + pad * 2

		canvas.width = W
		canvas.height = H

		const ctx = canvas.getContext("2d")

		// --- Armor slots: left column (4 stacked slots) ---
		for (let i = 0; i < 4; i++) {
			drawSlot(ctx, pad, pad + i * s, s)
		}

		// --- Player model: 3-slot-wide area in the centre-left ---
		const modelAreaX = pad + s + 4
		const modelAreaW = 3 * s
		// sc = floor(s/8); model is 32*sc px tall which fits in the 4*s panel height
		const sc = Math.max(1, s >> 3)
		const modelH = 32 * sc
		const modelCX = modelAreaX + (modelAreaW >> 1)
		// >> has lower precedence than -, so (4*s - modelH) is shifted; vertically centres the model
		const modelTY = pad + (4 * s - modelH >> 1)
		drawPlayerModel(ctx, modelCX, modelTY, sc)

		// Player name centred below the model
		const nameFont = Math.max(8, s * 0.27 | 0)
		ctx.font = `${nameFont}px monospace`
		ctx.fillStyle = "#555555"
		ctx.textAlign = "center"
		ctx.fillText(this.playerName, modelCX, pad + 4 * s - 2)

		// --- 2×2 crafting grid (right of player model) ---
		const gx = modelAreaX + modelAreaW + 8
		const gy = pad + s  // vertically centred: (4 rows - 2 rows) / 2 = 1 row offset

		// Input slots (2 columns × 2 rows)
		for (let row = 0; row < 2; row++) {
			for (let col = 0; col < 2; col++) {
				const sx = gx + col * s
				const sy = gy + row * s
				drawSlot(ctx, sx, sy, s)
				const slot = this.craftSlots[row * 2 + col]
				if (slot?.icon) slot.render(ctx, sx, sy, s)
			}
		}

		// Arrow pointing right
		const arrowW = Math.max(12, s * 0.6 | 0)
		const arrowX = gx + 2 * s + 4
		drawArrow(ctx, arrowX, gy + s, arrowW)

		// Output slot (vertically centred in the 2-row grid)
		const ox = arrowX + arrowW + 4
		const oy = gy + (s >> 1)
		drawSlot(ctx, ox, oy, s)
		if (this.craftSlots[4]?.icon) this.craftSlots[4].render(ctx, ox, oy, s)

		// Store craft area coords for hit-testing
		this.craftArea = { gx, gy, ox, oy, s }
	}

	/**
	 * Initialises the crafting recipe list from blockIds.
	 */
	_initRecipes() {
		this.craftingRecipes = []
		const logPlanks = [
			["oakLog", "oakPlanks"],
			["birchLog", "birchPlanks"],
			["spruceLog", "sprucePlanks"],
			["jungleLog", "junglePlanks"],
			["acaciaLog", "acaciaPlanks"],
			["darkOakLog", "darkOakPlanks"],
			["crimsonStem", "crimsonPlanks"],
			["warpedStem", "warpedPlanks"],
		]
		for (const [log, plank] of logPlanks) {
			if (blockIds[log] && blockIds[plank]) {
				this.craftingRecipes.push({ type: "shapeless_single", inputId: blockIds[log], outputId: blockIds[plank], count: 4 })
			}
		}
		if (blockIds.stone && blockIds.stoneBricks) {
			this.craftingRecipes.push({ type: "shaped_2x2", pattern: [blockIds.stone, blockIds.stone, blockIds.stone, blockIds.stone], outputId: blockIds.stoneBricks, count: 4 })
		}
		if (blockIds.cobblestone && blockIds.bricks) {
			this.craftingRecipes.push({ type: "shaped_2x2", pattern: [blockIds.cobblestone, blockIds.cobblestone, blockIds.cobblestone, blockIds.cobblestone], outputId: blockIds.bricks, count: 4 })
		}

		// ── Sticks ────────────────────────────────────────────────────────────
		// Any two identical planks in any two of the four slots → 4 sticks.
		const plankNames = [
			"oakPlanks", "birchPlanks", "sprucePlanks", "junglePlanks",
			"acaciaPlanks", "darkOakPlanks", "crimsonPlanks", "warpedPlanks",
		]
		const plankIds = plankNames.map(n => blockIds[n]).filter(Boolean)
		if (blockIds.stick) {
			for (const pid of plankIds) {
				// shapeless_pair: exactly 2 slots filled with the same plank id → 4 sticks
				this.craftingRecipes.push({ type: "shapeless_pair", inputId: pid, outputId: blockIds.stick, count: 4 })
			}
		}

		// ── Wooden tools ──────────────────────────────────────────────────────
		// Recipes use a 2×2 grid; patterns allow null (must be empty).
		// Any plank type works for each tool.
		//
		//  Grid indices:   [0][1]
		//                  [2][3]
		//
		// Wooden Sword:  [plank][null]  →  2 planks in the left column + stick bottom-right
		//                [plank][null]     …expressed as shaped_partial below
		//
		// We use a single "shapeless_multi" recipe type:
		//   inputs: [{ plank: true, count }, { id, count }]
		//   All non-empty grid slots must satisfy the inputs exactly (no extra items).
		if (blockIds.stick) {
			if (blockIds.woodenSword) {
				// 2 planks (any type) + 1 stick → 1 wooden sword
				this.craftingRecipes.push({
					type: "shapeless_multi",
					inputs: [{ plank: true, count: 2 }, { id: blockIds.stick, count: 1 }],
					outputId: blockIds.woodenSword, count: 1,
				})
			}
			if (blockIds.woodenPickaxe) {
				// 2 planks + 2 sticks → 1 wooden pickaxe
				this.craftingRecipes.push({
					type: "shapeless_multi",
					inputs: [{ plank: true, count: 2 }, { id: blockIds.stick, count: 2 }],
					outputId: blockIds.woodenPickaxe, count: 1,
				})
			}
			if (blockIds.woodenAxe) {
				// 3 planks + 1 stick → 1 wooden axe  (all 4 slots used)
				this.craftingRecipes.push({
					type: "shapeless_multi",
					inputs: [{ plank: true, count: 3 }, { id: blockIds.stick, count: 1 }],
					outputId: blockIds.woodenAxe, count: 1,
				})
			}
			if (blockIds.woodenShovel) {
				// 1 plank + 1 stick → 1 wooden shovel  (only 2 slots used)
				this.craftingRecipes.push({
					type: "shapeless_multi",
					inputs: [{ plank: true, count: 1 }, { id: blockIds.stick, count: 1 }],
					outputId: blockIds.woodenShovel, count: 1,
				})
			}
		}
	}

	/** Set of all plank block IDs – used by shapeless_multi recipe matching. */
	get _plankIds() {
		if (this.__plankIds) return this.__plankIds
		const names = [
			"oakPlanks", "birchPlanks", "sprucePlanks", "junglePlanks",
			"acaciaPlanks", "darkOakPlanks", "crimsonPlanks", "warpedPlanks",
		]
		this.__plankIds = new Set(names.map(n => blockIds[n]).filter(Boolean))
		return this.__plankIds
	}

	/** Returns the recipe result for the current craft grid state, or null. */
	_checkRecipes() {
		const slots = this.craftSlots.slice(0, 4)
		for (const recipe of this.craftingRecipes) {
			if (recipe.type === "shapeless_single") {
				const filled = slots.filter(Boolean)
				if (filled.length === 1 && filled[0].id === recipe.inputId) {
					return { id: recipe.outputId, count: recipe.count }
				}
			}
			else if (recipe.type === "shapeless_pair") {
				// Exactly 2 identical planks, all other slots empty
				const filled = slots.filter(Boolean)
				if (filled.length === 2 && filled[0].id === recipe.inputId && filled[1].id === recipe.inputId) {
					return { id: recipe.outputId, count: recipe.count }
				}
			}
			else if (recipe.type === "shaped_2x2") {
				let match = true
				for (let i = 0; i < 4; i++) {
					const expected = recipe.pattern[i]
					const actual = slots[i]?.id ?? null
					if (expected !== actual) {
						match = false
						break
					}
				}
				if (match) return { id: recipe.outputId, count: recipe.count }
			}
			else if (recipe.type === "shapeless_multi") {
				// Count items in the grid and compare against the recipe inputs.
				// Each input spec is either { plank: true, count } or { id, count }.
				const itemCounts = new Map() // id → count
				for (const slot of slots) {
					if (slot) itemCounts.set(slot.id, (itemCounts.get(slot.id) || 0) + 1)
				}
				const plankIds = this._plankIds
				// Tally plank count and non-plank counts separately
				let plankCount = 0
				const nonPlankCounts = new Map()
				for (const [id, count] of itemCounts) {
					if (plankIds.has(id)) plankCount += count
					else nonPlankCounts.set(id, count)
				}
				let match = true
				let expectedPlank = 0
				for (const spec of recipe.inputs) {
					if (spec.plank) {
						expectedPlank += spec.count
					} else {
						if ((nonPlankCounts.get(spec.id) || 0) !== spec.count) { match = false; break }
					}
				}
				if (match && plankCount !== expectedPlank) match = false
				// Ensure no extra non-plank items are present beyond what the recipe requires
				if (match) {
					const specNonPlankIds = new Set(recipe.inputs.filter(s => !s.plank).map(s => s.id))
					for (const id of nonPlankCounts.keys()) {
						if (!specNonPlankIds.has(id)) { match = false; break }
					}
				}
				if (match) return { id: recipe.outputId, count: recipe.count }
			}
		}
		return null
	}

	/** Recomputes the craft output slot from the current inputs and redraws the panel. */
	_updateCraftOutput() {
		const result = this._checkRecipes()
		if (result) {
			this.craftSlots[4] = new InventoryItem(result.id, blockData[result.id].name, result.count, blockData[result.id].iconImg)
		}
		else {
			this.craftSlots[4] = null
		}
		this.renderPlayerPanel(this.playerName)
	}

	/**
	 * Returns which crafting slot (0-3 input, 4 output, -1 none) the coordinate hits.
	 * @param {Number} x
	 * @param {Number} y
	 */
	_craftSlotAt(x, y) {
		if (!this.craftArea) return -1
		const { gx, gy, ox, oy, s } = this.craftArea
		for (let row = 0; row < 2; row++) {
			for (let col = 0; col < 2; col++) {
				const sx = gx + col * s
				const sy = gy + row * s
				if (x >= sx && x < sx + s && y >= sy && y < sy + s) return row * 2 + col
			}
		}
		if (x >= ox && x < ox + s && y >= oy && y < oy + s) return 4
		return -1
	}

	/**
	 * @param {MouseEvent} event
	 */
	playerPanelMouseMove(event) {
		const idx = this._craftSlotAt(event.offsetX, event.offsetY)
		const item = idx >= 0 ? this.craftSlots[idx] : null
		if (item) displayHoverText(item.name, event.x, event.y)
		else hoverBox.classList.add("hidden")
	}

	/**
	 * @param {MouseEvent} event
	 */
	playerPanelMouseDown(event) {
		const idx = this._craftSlotAt(event.offsetX, event.offsetY)
		if (idx === -1) return

		const rightClick = event.button === 2

		if (idx === 4) {
			// Output slot: take crafted result and consume 1 set of inputs
			// (right-click behaves identically to left-click for the output slot)
			const result = this._checkRecipes()
			if (!result) return
			const resultItem = new InventoryItem(result.id, blockData[result.id].name, result.count, blockData[result.id].iconImg)
			if (!this.heldItem) {
				this.heldItem = resultItem
			}
			else if (this.heldItem.id === result.id && this.heldItem.stackSize + result.count <= 64) {
				this.heldItem.stackSize += result.count
			}
			else return // Hand full with a different item
			// Consume 1 of each occupied input slot
			for (let i = 0; i < 4; i++) {
				if (this.craftSlots[i]) {
					this.craftSlots[i].stackSize--
					if (this.craftSlots[i].stackSize <= 0) this.craftSlots[i] = null
				}
			}
		}
		else if (rightClick) {
			// Right-click on an input slot: place a single item from the held stack
			const existing = this.craftSlots[idx]
			if (this.heldItem) {
				if (!existing) {
					// Empty slot – place exactly 1
					this.craftSlots[idx] = new InventoryItem(this.heldItem.id, this.heldItem.name, 1, this.heldItem.icon)
					this.heldItem.stackSize--
					if (this.heldItem.stackSize <= 0) this.heldItem = null
				}
				else if (existing.id === this.heldItem.id && existing.stackSize < 64) {
					// Same item – add 1 to the slot
					existing.stackSize++
					this.heldItem.stackSize--
					if (this.heldItem.stackSize <= 0) this.heldItem = null
				}
				// Different item – do nothing
			}
			else if (existing) {
				// No held item: pick up half the stack (round up)
				const take = Math.ceil(existing.stackSize / 2)
				this.heldItem = new InventoryItem(existing.id, existing.name, take, existing.icon)
				existing.stackSize -= take
				if (existing.stackSize <= 0) this.craftSlots[idx] = null
			}
		}
		else {
			// Left-click on an input slot: swap held item with slot contents
			const existing = this.craftSlots[idx]
			if (this.heldItem) {
				if (existing?.id === this.heldItem.id) {
					existing.stackSize += this.heldItem.stackSize
					this.heldItem = null
				}
				else {
					this.craftSlots[idx] = this.heldItem.copy()
					this.heldItem = existing
				}
			}
			else {
				this.heldItem = existing
				this.craftSlots[idx] = null
			}
		}

		this._updateCraftOutput()

		if (this.heldItem) {
			heldItemCanvas.classList.remove("hidden")
			heldCtx.clearRect(0, 0, this.iconSize, this.iconSize)
			this.heldItem.render(heldCtx, 0, 0, this.iconSize)
		}
		else heldItemCanvas.classList.add("hidden")
	}

	/**
	 * Returns any items left in the crafting grid to the player's storage.
	 * Call this when closing the inventory.
	 */
	returnCraftItems() {
		for (let i = 0; i < 4; i++) {
			if (this.craftSlots[i]) {
				this.playerStorage?.addItem(this.craftSlots[i])
				this.craftSlots[i] = null
			}
		}
		this.craftSlots[4] = null
	}
}

const inventory = new InventoryManager()
export { InventoryItem, InventoryPage, InventoryManager, inventory }