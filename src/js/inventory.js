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
		this.renderPlayerPanel("Player")
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
	 * Renders the player model + armor slots + name panel above the inventory grid.
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

		// --- Right section: name + "Mainhand" label + slot ---
		const rightX = modelAreaX + modelAreaW + 8

		const labelFont = Math.max(10, s * 0.35 | 0)
		ctx.fillStyle = "#404040"
		ctx.font = `bold ${labelFont}px monospace`
		ctx.textAlign = "left"
		ctx.fillText("Mainhand", rightX, pad + labelFont)

		const nameFont = Math.max(8, s * 0.27 | 0)
		ctx.font = `${nameFont}px monospace`
		ctx.fillStyle = "#606060"
		ctx.fillText(this.playerName, rightX, pad + labelFont + nameFont + 4)

		// Mainhand display slot (top-right corner of the panel)
		drawSlot(ctx, W - pad - s, pad, s)
		// Draw the currently held item in the mainhand slot
		if (this.playerStorage) {
			const heldItem = this.playerStorage.items[this.hotbar?.index]
			if (heldItem?.icon) heldItem.render(ctx, W - pad - s, pad, s)
		}
	}
}

const inventory = new InventoryManager()
export { InventoryItem, InventoryPage, InventoryManager, inventory }