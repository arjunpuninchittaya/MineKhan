# MineKhan
Minecraft for Khan Academy

Khan Academy link can be found [here](https://www.khanacademy.org/computer-programming/minekhan/5647155001376768).

GitHub release can be found [here](https://willard21.github.io/MineKhan/dist/).

[Replit post](https://repl.it/talk/share/MineKhan-Minecraft-for-Khan-Academy/87382) and [app](https://replit.com/@Willard21/MineKhan)

Multiplayer [login](https://minekhan.arjun-puninchittaya.workers.dev/login) and [game](https://minekhan.arjun-puninchittaya.workers.dev/). This is the most up-to-date version.

Texture encoder is [here](https://willard.fun/minekhan/textures).

If you'd like to contribute, join the conversation on [Discord](https://discord.gg/j3SzCQU).

## Building the Frontend

Clone/download the repository, `cd` into the directory, then:

```bash
npm install
node index.js
```

This builds the project into the `dist` folder and starts a server on http://localhost:4000. It watches for any changes in `src/` and automatically re-builds.

## Deploying the Backend (Cloudflare Workers)

The backend runs on Cloudflare Workers and requires a **KV namespace** (for auth and cloud saves) and **Durable Objects** (for real-time multiplayer).

### 1. Create a KV namespace

```bash
npx wrangler kv namespace create MineKhanKV
```

Wrangler will print an `id`. Copy it, then run the same command with `--preview` for the preview ID:

```bash
npx wrangler kv namespace create MineKhanKV --preview
```

Open `wrangler.jsonc` and replace the placeholder KV IDs with the ones printed by the commands above.

### 2. Deploy

```bash
npm run deploy
```

This builds and deploys both the static frontend (`dist/`) and the Worker backend to Cloudflare. Durable Objects are registered automatically via the `migrations` entry in `wrangler.jsonc`.

### 3. Local preview

```bash
npm run preview
```

> **Note:** Durable Objects require a paid Cloudflare Workers plan. KV works on the free tier.

## Compiling Caves (optional)

Compiling `src/c/caves.c` into WASM requires emscripten:

```bash
emcc src/c/caves.c -o test.js -O3 -Os -sEXPORTED_FUNCTIONS=_getCaves -sERROR_ON_UNDEFINED_SYMBOLS=0
```

Delete the generated JS file, convert the `.wasm` to base64, and paste it into `workers/Caves.js`.
