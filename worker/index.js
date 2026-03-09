/**
 * MineKhan Cloudflare Worker Backend
 *
 * Handles: Authentication, Cloud Saves, and Multiplayer WebSockets
 *
 * KV Storage layout (single namespace: KV):
 *   user:{username_lowercase}  -> { id, username, passwordHash, salt }
 *   userid:{userId}            -> username  (reverse lookup)
 *   session:{token}            -> { userId, username, expiresAt }
 *   saves:{userId}             -> [{ id, name, version, size, edited }]
 *   savedata:{userId}:{saveId} -> ArrayBuffer (binary world data)
 *   world:{worldId}            -> { id, name, host, online, version, public, target }
 *
 * Durable Objects: WorldRoom (one per multiplayer world)
 */

const SESSION_TTL_SECS = 7 * 24 * 60 * 60 // 7 days
const MS_PER_SEC = 1000
const MAX_SAVE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_SAVES_PER_USER = 20
const WORLD_KV_TTL = 7200 // 2 hours – auto-expires inactive worlds

// =====================================================================
// Durable Object: WorldRoom
// One instance per multiplayer world (keyed by worldId via idFromName)
// =====================================================================

export class WorldRoom {
	constructor(state, env) {
		this.state = state
		this.env = env
		/** @type {Map<string, {ws: WebSocket, isHost: boolean}>} */
		this.sessions = new Map()
		this.worldId = null
		this.worldName = ""
		this.worldVersion = ""
		this.password = ""
		this.isPublic = true
		this.initialized = false
	}

	async fetch(request) {
		const url = new URL(request.url)

		// HTTP route: return world info for the worlds list
		if (url.pathname === "/info") {
			if (!this.initialized) return new Response("null", { headers: { "Content-Type": "application/json" } })
			return new Response(
				JSON.stringify({
					id: this.worldId,
					target: this.worldId,
					name: this.worldName,
					host: this.hostUsername(),
					online: this.sessions.size,
					version: this.worldVersion,
					public: this.isPublic,
				}),
				{ headers: { "Content-Type": "application/json" } }
			)
		}

		// WebSocket upgrade
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 })
		}

		const username = url.searchParams.get("username")
		const worldId = url.searchParams.get("worldId")
		if (!username) return new Response("Username required", { status: 400 })

		if (worldId) this.worldId = worldId

		// Close any existing connection for this user (reconnect)
		const existing = this.sessions.get(username)
		if (existing) {
			try {
				existing.ws.close()
			} catch {}
			this.sessions.delete(username)
		}

		const pair = new WebSocketPair()
		const [client, server] = Object.values(pair)
		server.accept()

		const isHost = this.sessions.size === 0
		this.sessions.set(username, { ws: server, isHost })

		this.handleSession(server, username)
		return new Response(null, { status: 101, webSocket: client })
	}

	hostUsername() {
		for (const [name, s] of this.sessions) {
			if (s.isHost) return name
		}
		return ""
	}

	handleSession(ws, username) {
		ws.addEventListener("message", (evt) => {
			this.onMessage(ws, username, evt.data).catch((e) => console.error("WS error:", e))
		})
		ws.addEventListener("close", () => this.onClose(username))
		ws.addEventListener("error", () => this.onClose(username))
	}

	async onMessage(ws, username, data) {
		if (data === "pong") return

		if (data === "fetchUsers") {
			ws.send(JSON.stringify({ type: "users", data: [...this.sessions.keys()] }))
			return
		}

		// Binary data = world save sent from host to new joiners
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
			const session = this.sessions.get(username)
			if (session && session.isHost) {
				for (const [name, s] of this.sessions) {
					if (name !== username) {
						try {
							s.ws.send(data)
						} catch {}
					}
				}
			}
			return
		}

		let packet
		try {
			packet = JSON.parse(data)
		} catch {
			return
		}
		packet.author = username

		const session = this.sessions.get(username)

		if (packet.type === "init") {
			// Only the host initialises the room
			if (!session || !session.isHost) return
			this.worldName = packet.name || "Unnamed World"
			this.worldVersion = packet.version || ""
			this.password = packet.password || ""
			this.isPublic = !packet.password
			this.initialized = true

			// Persist world info to KV so /minekhan/worlds can list it
			if (this.worldId) {
				await this.env.KV.put(
					`world:${this.worldId}`,
					JSON.stringify({
						id: this.worldId,
						target: this.worldId,
						name: this.worldName,
						host: username,
						online: this.sessions.size,
						version: this.worldVersion,
						public: this.isPublic,
					}),
					{ expirationTtl: WORLD_KV_TTL }
				).catch(() => {})
			}
			return
		}

		if (packet.type === "connect") {
			// Non-hosts must provide the correct password (if any)
			if (session && !session.isHost && this.password && packet.password !== this.password) {
				ws.send(JSON.stringify({ type: "error", data: "Incorrect password" }))
				ws.close()
				return
			}
			// Broadcast to everyone else so the host knows to send the world save
			this.broadcastExcept(username, JSON.stringify(packet))

			// Refresh online count in KV
			await this.refreshWorldKV().catch(() => {})
			return
		}

		if (packet.type === "ban") {
			if (!session || !session.isHost) {
				ws.send(JSON.stringify({ type: "error", data: "Permission denied" }))
				return
			}
			const target = packet.data
			const targetSession = this.sessions.get(target)
			if (targetSession) {
				try {
					targetSession.ws.send(JSON.stringify({ type: "ban", data: "You have been banned from this world." }))
					targetSession.ws.close()
				} catch {}
				this.sessions.delete(target)
			}
			this.broadcast(JSON.stringify({ type: "ban", data: `${target} has been banned.` }))
			return
		}

		// All other packets are relayed to every other connected client
		this.broadcastExcept(username, JSON.stringify(packet))
	}

	async onClose(username) {
		const session = this.sessions.get(username)
		const wasHost = session ? session.isHost : false
		this.sessions.delete(username)

		if (this.sessions.size === 0) {
			this.initialized = false
			if (this.worldId) {
				await this.env.KV.delete(`world:${this.worldId}`).catch(() => {})
			}
			return
		}

		// Hand host role to the next connected player
		if (wasHost) {
			const [, nextSession] = [...this.sessions.entries()][0]
			nextSession.isHost = true
		}

		this.broadcast(JSON.stringify({ type: "dc", author: username }))
		await this.refreshWorldKV().catch(() => {})
	}

	async refreshWorldKV() {
		if (!this.worldId || !this.initialized) return
		await this.env.KV.put(
			`world:${this.worldId}`,
			JSON.stringify({
				id: this.worldId,
				target: this.worldId,
				name: this.worldName,
				host: this.hostUsername(),
				online: this.sessions.size,
				version: this.worldVersion,
				public: this.isPublic,
			}),
			{ expirationTtl: WORLD_KV_TTL }
		)
	}

	broadcast(msg) {
		for (const { ws } of this.sessions.values()) {
			try {
				ws.send(msg)
			} catch {}
		}
	}

	broadcastExcept(exclude, msg) {
		for (const [name, { ws }] of this.sessions) {
			if (name !== exclude) {
				try {
					ws.send(msg)
				} catch {}
			}
		}
	}
}

// =====================================================================
// Helpers
// =====================================================================

function jsonResponse(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", ...extraHeaders },
	})
}

function errorResponse(message, status = 400) {
	return jsonResponse({ error: message }, status)
}

async function hashPassword(password, salt) {
	const encoder = new TextEncoder()
	const buf = await crypto.subtle.digest("SHA-256", encoder.encode(password + salt))
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}

function generateUUID() {
	return crypto.randomUUID()
}

function generateId() {
	return crypto.randomUUID().replace(/-/g, "")
}

async function getSessionUser(request, env) {
	const cookieHeader = request.headers.get("Cookie") || ""
	let token = null
	for (const part of cookieHeader.split(";")) {
		const eqIdx = part.indexOf("=")
		if (eqIdx === -1) continue
		const k = part.slice(0, eqIdx).trim()
		const v = part.slice(eqIdx + 1).trim()
		if (k === "session") {
			token = v
			break
		}
	}
	if (!token) return null

	const sessionData = await env.KV.get(`session:${token}`, { type: "json" })
	if (!sessionData) return null
	if (sessionData.expiresAt < Date.now()) {
		await env.KV.delete(`session:${token}`).catch(() => {})
		return null
	}
	return { ...sessionData, token }
}

function sessionCookie(token, maxAge = SESSION_TTL_SECS) {
	const value = maxAge > 0 ? token : ""
	return `session=${value}; Path=/; Max-Age=${maxAge > 0 ? maxAge : 0}; HttpOnly; SameSite=Lax; Secure`
}

// =====================================================================
// Auth handlers
// =====================================================================

async function handleRegister(request, env) {
	let body
	try {
		body = await request.json()
	} catch {
		return errorResponse("Invalid JSON")
	}

	const { username, password } = body || {}
	if (!username || !password) return errorResponse("Username and password required")
	if (username.length < 3 || username.length > 20) return errorResponse("Username must be 3–20 characters")
	if (!/^[a-zA-Z0-9_]+$/.test(username)) return errorResponse("Username may only contain letters, numbers, and underscores")
	if (password.length < 6) return errorResponse("Password must be at least 6 characters")

	const userKey = `user:${username.toLowerCase()}`

	let existing
	try {
		existing = await env.KV.get(userKey)
	} catch (err) {
		console.error("KV error during register:", err)
		return errorResponse("Service unavailable, please try again later", 503)
	}
	if (existing) return errorResponse("Username already taken")

	const salt = generateId()
	const passwordHash = await hashPassword(password, salt)
	const userId = generateId()

	try {
		await env.KV.put(userKey, JSON.stringify({ id: userId, username, passwordHash, salt }))
		await env.KV.put(`userid:${userId}`, username)
	} catch (err) {
		console.error("KV error saving user:", err)
		return errorResponse("Service unavailable, please try again later", 503)
	}

	return jsonResponse({ ok: true })
}

async function handleLogin(request, env) {
	let body
	try {
		body = await request.json()
	} catch {
		return errorResponse("Invalid JSON")
	}

	const { username, password } = body || {}
	if (!username || !password) return errorResponse("Username and password required")

	let userData
	try {
		userData = await env.KV.get(`user:${username.toLowerCase()}`, { type: "json" })
	} catch (err) {
		console.error("KV error during login:", err)
		return errorResponse("Service unavailable, please try again later", 503)
	}
	if (!userData) return errorResponse("Invalid username or password", 401)

	const hash = await hashPassword(password, userData.salt)
	if (hash !== userData.passwordHash) return errorResponse("Invalid username or password", 401)

	const token = generateUUID()
	const expiresAt = Date.now() + SESSION_TTL_SECS * MS_PER_SEC
	try {
		await env.KV.put(
			`session:${token}`,
			JSON.stringify({ userId: userData.id, username: userData.username, expiresAt }),
			{ expirationTtl: SESSION_TTL_SECS }
		)
	} catch (err) {
		console.error("KV error saving session:", err)
		return errorResponse("Service unavailable, please try again later", 503)
	}

	return new Response(JSON.stringify({ ok: true, username: userData.username }), {
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": sessionCookie(token),
		},
	})
}

// =====================================================================
// Cloud saves handlers
// =====================================================================

async function handleGetSaves(request, env) {
	const user = await getSessionUser(request, env)
	if (!user) return errorResponse("Not authenticated", 401)

	const saves = await env.KV.get(`saves:${user.userId}`, { type: "json" })
	return jsonResponse(saves || [])
}

async function handlePostSave(request, env) {
	const user = await getSessionUser(request, env)
	if (!user) return errorResponse("Not authenticated", 401)

	const url = new URL(request.url)
	const id = url.searchParams.get("id")
	const edited = parseInt(url.searchParams.get("edited")) || Date.now()
	const name = decodeURIComponent(url.searchParams.get("name") || "Unnamed World")
	const version = decodeURIComponent(url.searchParams.get("version") || "")

	if (!id) return errorResponse("Save ID required")

	const body = await request.arrayBuffer()
	if (body.byteLength > MAX_SAVE_SIZE) return errorResponse("Save too large (max 10 MB)")

	let saves = (await env.KV.get(`saves:${user.userId}`, { type: "json" })) || []
	const idx = saves.findIndex((s) => s.id === id)
	const meta = { id, name, version, size: body.byteLength, edited }

	if (idx >= 0) {
		saves[idx] = meta
	} else {
		if (saves.length >= MAX_SAVES_PER_USER) return errorResponse("Maximum number of cloud saves reached")
		saves.push(meta)
	}

	await env.KV.put(`saves:${user.userId}`, JSON.stringify(saves))
	await env.KV.put(`savedata:${user.userId}:${id}`, body)

	return jsonResponse({ ok: true })
}

async function handleGetSave(request, env, id) {
	const user = await getSessionUser(request, env)
	if (!user) return errorResponse("Not authenticated", 401)

	const data = await env.KV.get(`savedata:${user.userId}:${id}`, { type: "arrayBuffer" })
	if (!data) return errorResponse("Save not found", 404)

	return new Response(data, { headers: { "Content-Type": "application/octet-stream" } })
}

async function handleDeleteSave(request, env, id) {
	const user = await getSessionUser(request, env)
	if (!user) return errorResponse("Not authenticated", 401)

	let saves = (await env.KV.get(`saves:${user.userId}`, { type: "json" })) || []
	saves = saves.filter((s) => s.id !== id)
	await env.KV.put(`saves:${user.userId}`, JSON.stringify(saves))
	await env.KV.delete(`savedata:${user.userId}:${id}`)

	return jsonResponse({ ok: true })
}

// =====================================================================
// Multiplayer handlers
// =====================================================================

async function handleGetWorlds(request, env) {
	const user = await getSessionUser(request, env)
	if (!user) return errorResponse("Not authenticated", 401)

	const list = await env.KV.list({ prefix: "world:" })
	const worlds = []
	for (const key of list.keys) {
		const data = await env.KV.get(key.name, { type: "json" }).catch(() => null)
		if (data) worlds.push(data)
	}
	return jsonResponse(worlds)
}

async function handleWebSocket(request, env) {
	const user = await getSessionUser(request, env)
	if (!user) return new Response("Not authenticated", { status: 401 })

	const url = new URL(request.url)
	const target = url.searchParams.get("target")
	if (!target) return new Response("Target world ID required", { status: 400 })

	// Route to the Durable Object for this world
	const doId = env.WORLD_ROOM.idFromName(target)
	const stub = env.WORLD_ROOM.get(doId)

	// Forward the request with the authenticated username and worldId added
	const wsUrl = new URL(request.url)
	wsUrl.searchParams.set("username", user.username)
	wsUrl.searchParams.set("worldId", target)

	return stub.fetch(new Request(wsUrl.toString(), request))
}

// =====================================================================
// Login page HTML (served at /login)
// CSS is intentionally inlined and minified to keep the Worker self-contained.
// =====================================================================

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MineKhan – Login</title>
<style>
*{box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#1a1a2e;color:#eee;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.container{background:#16213e;padding:2rem;border-radius:12px;width:100%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
h1{text-align:center;color:#4a9eff;margin:0 0 1.5rem;font-size:1.8rem}
.tabs{display:flex;gap:4px;margin-bottom:1.5rem;background:#0f3460;border-radius:8px;padding:4px}
.tab{flex:1;padding:.6rem;background:transparent;border:none;color:#aaa;cursor:pointer;font-size:.95rem;border-radius:6px;transition:.2s}
.tab.active{background:#4a9eff;color:#fff}
.fg{margin-bottom:1rem}
label{display:block;margin-bottom:.3rem;font-size:.85rem;color:#aaa}
input{width:100%;padding:.75rem;background:#0f3460;border:1px solid rgba(74,158,255,.2);border-radius:8px;color:#eee;font-size:1rem;transition:.2s}
input:focus{outline:none;border-color:#4a9eff}
button[type=submit]{width:100%;padding:.85rem;background:#4a9eff;border:none;border-radius:8px;color:#fff;font-size:1rem;cursor:pointer;margin-top:.5rem;font-weight:600;transition:.2s}
button[type=submit]:hover{background:#3a8eef;transform:translateY(-1px)}
.msg{margin-top:.75rem;padding:.5rem .75rem;border-radius:6px;font-size:.9rem;display:none}
.error{background:rgba(255,107,107,.15);color:#ff6b6b;border:1px solid rgba(255,107,107,.3)}
.success{background:rgba(107,255,107,.15);color:#6bff6b;border:1px solid rgba(107,255,107,.3)}
.back{text-align:center;margin-top:1.25rem;font-size:.9rem}
.back a{color:#4a9eff;text-decoration:none}
.back a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="container">
<h1>🎮 MineKhan</h1>
<div class="tabs">
<button class="tab active" onclick="showTab('login')">Login</button>
<button class="tab" onclick="showTab('register')">Register</button>
</div>
<div id="lf">
<div class="fg"><label>Username</label><input type="text" id="lu" placeholder="Your username" autocomplete="username"></div>
<div class="fg"><label>Password</label><input type="password" id="lp" placeholder="Your password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()"></div>
<button type="submit" onclick="doLogin()">Login</button>
<div class="msg error" id="le"></div>
</div>
<div id="rf" style="display:none">
<div class="fg"><label>Username</label><input type="text" id="ru" placeholder="Choose a username (3–20 chars)" autocomplete="username"></div>
<div class="fg"><label>Password</label><input type="password" id="rp" placeholder="At least 6 characters" autocomplete="new-password"></div>
<div class="fg"><label>Confirm Password</label><input type="password" id="rc" placeholder="Repeat password" autocomplete="new-password" onkeydown="if(event.key==='Enter')doRegister()"></div>
<button type="submit" onclick="doRegister()">Create Account</button>
<div class="msg error" id="re"></div>
<div class="msg success" id="rs"></div>
</div>
<div class="back"><a href="/">← Back to Game</a></div>
</div>
<script>
function showTab(t){
document.querySelectorAll('.tab').forEach((b,i)=>b.classList.toggle('active',t==='login'?i===0:i===1))
document.getElementById('lf').style.display=t==='login'?'':'none'
document.getElementById('rf').style.display=t==='register'?'':'none'
}
function show(id,text,vis=true){const el=document.getElementById(id);el.textContent=text;el.style.display=vis?'block':'none'}
async function doLogin(){
const u=document.getElementById('lu').value.trim()
const p=document.getElementById('lp').value
show('le','',false)
if(!u||!p){show('le','Please fill in all fields.');return}
const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})
const d=await res.json().catch(()=>({}))
if(res.ok){window.location.href='/'}else{show('le',d.error||'Login failed.')}
}
async function doRegister(){
const u=document.getElementById('ru').value.trim()
const p=document.getElementById('rp').value
const c=document.getElementById('rc').value
show('re','',false);show('rs','',false)
if(!u||!p){show('re','Please fill in all fields.');return}
if(u.length<3||u.length>20){show('re','Username must be 3–20 characters.');return}
if(!/^[a-zA-Z0-9_]+$/.test(u)){show('re','Username: letters, numbers, underscores only.');return}
if(p.length<6){show('re','Password must be at least 6 characters.');return}
if(p!==c){show('re','Passwords do not match.');return}
const res=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})
const d=await res.json().catch(()=>({}))
if(res.ok){show('rs','Account created! You can now log in.');showTab('login');document.getElementById('lu').value=u}
else{show('re',d.error||'Registration failed.')}
}
fetch('/profile').then(r=>{if(r.ok)window.location.href='/'})
</script>
</body>
</html>`

// =====================================================================
// Main Worker fetch handler
// =====================================================================

export default {
	async fetch(request, env) {
		try {
			return await handleRequest(request, env)
		} catch (err) {
			console.error("Unhandled worker error:", err)
			return new Response(JSON.stringify({ error: "Internal server error" }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			})
		}
	},
}

async function handleRequest(request, env) {
	const url = new URL(request.url)
	const { pathname } = url

	// CORS pre-flight
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
				"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
				"Access-Control-Allow-Credentials": "true",
				"Access-Control-Max-Age": "86400",
			},
		})
	}

	// Login page
	if (pathname === "/login") {
		return new Response(LOGIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
	}

	// Register
	if (pathname === "/api/register" && request.method === "POST") {
		return handleRegister(request, env)
	}

	// Login
	if (pathname === "/api/login" && request.method === "POST") {
		return handleLogin(request, env)
	}

	// Logout
	if (pathname === "/api/logout") {
		const user = await getSessionUser(request, env)
		if (user) await env.KV.delete(`session:${user.token}`).catch(() => {})
		return new Response(JSON.stringify({ ok: true }), {
			headers: {
				"Content-Type": "application/json",
				"Set-Cookie": sessionCookie("", 0),
			},
		})
	}

	// Profile
	if (pathname === "/profile") {
		const user = await getSessionUser(request, env)
		if (!user) return new Response("401", { status: 401 })
		return new Response(JSON.stringify({ username: user.username, id: user.userId }), {
			headers: { "Content-Type": "application/json" },
		})
	}

	// Multiplayer worlds list
	if (pathname === "/minekhan/worlds" && request.method === "GET") {
		return handleGetWorlds(request, env)
	}

	// Cloud saves
	if (pathname === "/minekhan/saves") {
		if (request.method === "GET") return handleGetSaves(request, env)
		if (request.method === "POST") return handlePostSave(request, env)
	}

	const saveMatch = pathname.match(/^\/minekhan\/saves\/(.+)$/)
	if (saveMatch) {
		if (request.method === "GET") return handleGetSave(request, env, saveMatch[1])
		if (request.method === "DELETE") return handleDeleteSave(request, env, saveMatch[1])
	}

	// WebSocket multiplayer
	if (pathname === "/ws") {
		return handleWebSocket(request, env)
	}

	// Fall through to static assets (the bundled game)
	return env.ASSETS.fetch(request)
}
