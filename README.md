# THE BIG CON


## Code layout

The game is native ES modules; `index.html` loads one entry, `static/js/main.js`,
so the repo root runs as-is (`npx --yes http-server . -p 8080 -c-1`) with no build.
Modules need an http(s) origin — opening `index.html` straight from `file://` does
not work. The inline `BUILD_COMMIT` classic script stays in `index.html` (CI
greps it there).

| Layer | Modules | Rules |
| --- | --- | --- |
| rules (DOM-free) | `hooks.js`, `util.js`, `data.js`, `state.js`, `boards.js`, `engine.js` | no `document`, `$()`, `toast`/`modal`/render calls, `window`, storage or global timers; the outside world is reached only through the injected `hooks` object (`setHooks({...})`, documented at the top of `hooks.js`) |
| browser | `core.js` (flags, `# THE BIG CON


, Discord presence), `net.js` (state sync, prompts, transports, lobby), `ui.js` (rendering, input), `discord.js`, `../bots.js` | may touch the DOM and the wire; nothing runs at import time |
| composition | `app.js` (`installHooks()` + `boot()`), `main.js` (the entry) | the one place the layers are wired together |

`tests/engine-isolated.test.mjs` imports the rules layer in plain Node with fake hooks
and a virtual clock; the rest of the suite uses `tests/helpers/harness.mjs`, which loads
the same modules against a stub DOM. `node --test tests/*.test.mjs` runs everything.

## Building and deploying

The game is a static site (plus a Discord Activity served through Discord's
proxy). `npm run build` turns the repo into a deployable `dist/` folder:

```sh
npm ci --include=dev
npm run build          # writes dist/ (git-ignored); only ever writes inside dist/
npm run build -- --out /some/dir      # or: BUILD_OUT=/some/dir npm run build
npx --yes http-server dist -p 8080 -c-1   # preview it locally
```

What the build does (`scripts/build.mjs`):

1. copies the HTML pages and every asset they use (`static/`, `characters/`, root
   images/favicon) into `dist/` — never `tests/`, `docs/`, `cloudflare-relay/`,
   `node_modules/`, `.github/` or `scripts/`;
2. bundles the Discord Embedded App SDK with esbuild directly into `dist/`;
3. bundles the game: the single entry module `static/js/main.js` and everything
   it imports become ONE ES-module file (the individual source modules and
   `static/bots.js` are not shipped); only the dynamic `import()` of the SDK
   bundle stays external;
4. stamps `BUILD_COMMIT` in `dist/index.html` with the first 7 characters of
   `$RENDER_GIT_COMMIT` (set by Render), else `git rev-parse HEAD`, else `dev`;
5. renames every local `.js`/`.css` file to `name.<10-char sha256>.ext` and
   rewrites the references in the HTML pages and the bundle's dynamic `import()`
   of the SDK bundle. Images are copied unhashed.

### Render settings (static site)

Render's dashboard: the site -> **Settings**.

| Setting | Value |
| --- | --- |
| Build Command | `npm ci --include=dev && npm run build` |
| Publish Directory | `dist` |

(`--include=dev` makes sure esbuild, a devDependency, is installed whatever
`NODE_ENV` is during the build.)

**Settings -> Headers** (add these four rules; Render matches `*` within one path
segment and `**` across directories):

| Path | Header name | Value |
| --- | --- | --- |
| `/` | `Cache-Control` | `no-cache` |
| `/*.html` | `Cache-Control` | `no-cache` |
| `/**/*.js` | `Cache-Control` | `public, max-age=31536000, immutable` |
| `/**/*.css` | `Cache-Control` | `public, max-age=31536000, immutable` |

Every `.js`/`.css` in `dist/` carries a content hash in its file name, so they can
safely be cached forever; HTML must always revalidate so a deploy takes effect at
once. Images are not hashed and keep Render's default caching.

The same configuration lives in [`render.yaml`](render.yaml). The site is
currently dashboard-managed, so that file is **inert unless you adopt it as a
Blueprint** (Dashboard -> New -> Blueprint, pointing at this repo; its service
`name` must match the existing site's name to take it over rather than create a
second site). Do one or the other, not both. Note that a Blueprint sync leaves
existing dashboard headers/routes that are not in the file untouched.

### Local development

`index.html` can still be opened straight from the repo root (the `BUILD_COMMIT` there is the placeholder `dev`). The Discord SDK bundle is **not** committed any more; to try the Discord Activity code path from the repo root run `npm run build:sdk` once (writes the git-ignored `static/discord-sdk.bundle.js`), or just serve `dist/`.

### Landing page

`landing.html` is the highlight reel: a three.js board built from the real node data
(`static/landing/world.js`), eleven scripted scenes (`scenes.js`) and the scroll/HUD glue
(`reel.js`, the entry — bundled by the build, with three.js loaded from a CDN through the
page's import map). The exhibit thumbnails come from one atlas image; after adding or
replacing a node image run `python scripts/build_landing_atlas.py` (needs Pillow) and commit
`static/landing/atlas.webp` + `atlas.js`. `landing.html?scene=<id>&t=<seconds>` freezes a
single frame of one scene.
`?perf` shows frame time, draw calls and the current quality tier; `?q=0..5` pins a tier
(0 = sharpest; otherwise the page starts at ≤1.5× pixel ratio and steps down on slow frames).

### Tests

```sh
npm ci
node --test tests/*.test.mjs
```

`tests/build.test.mjs` runs the real build into a temp directory.

`film.html` replays one whole game on the same board and shows every action in the rules.
The game is real: `scripts/film_script.mjs` says what each seat does (and which event card
is on top of the deck), `node scripts/build_film.mjs` plays that through `static/js/engine.js`
and writes the recording to `static/landing/match.js`. Re-run it after changing the rules or
the script — an illegal step fails the build with the engine's own refusal (`--check` plays
without writing, `--table` prints one line per turn, `--trace` prints the record).
`static/landing/acts.js` is the catalogue of actions the film must show; `tests/film.test.mjs`
fails if the recording is stale or misses one. `film.html?chip=<id>&u=0.5` freezes on the
first beat showing that action (`?kind=`, `?beat=`, `?t=` also work), and `?perf` / `?q` work
as on the landing page.
