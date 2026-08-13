# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Family Cinema turns family photos into short narrated videos: photos in → LLM writes a script →
text-to-speech narrates it → FFmpeg renders an MP4 → PDF album, QR code and a public share page out.

Two independent npm packages, **no workspaces**: `backend/` (Express + TypeScript + Sequelize +
BullMQ) and `frontend/` (React 18 + Vite). Each has its own `package-lock.json` and `node_modules`;
`npm ci` must be run in each. Root `package.json` only orchestrates.

The product-facing language is Russian: user-visible strings, API error messages and the project
documentation are in Russian. Code, comments and commit messages are in English.

## Commands

Run from the repository root:

```bash
npm run dev          # backend :4000 and frontend :5173 together
npm test             # backend test suite
npm run typecheck    # both packages, including the test suite
npm run lint         # both packages (ESLint)
npm run build        # both packages
npm run ci           # typecheck + lint + test + build, what CI runs
```

Inside `backend/`:

```bash
npm test                       # vitest run
npm run test:watch             # vitest
npm run typecheck              # sources only (tsconfig.json)
npm run typecheck:tests        # sources + tests (tsconfig.test.json)
npm run migrate                # create missing tables
npm run seed                   # templates and voice profiles (required to create a story)
npm run seed:demo              # demo user demo@family-cinema.local / demo1234 + 3 ready stories
```

A single test file or a single test:

```bash
cd backend && npx vitest run tests/api.test.ts
cd backend && npx vitest run -t "creates a story with slides"
```

Full stack in Docker. `JWT_SECRET` is mandatory — see *Configuration landmines*:

```bash
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") docker compose up --build
```

`docker compose` runs a one-shot `init` service (`migrate` then `seed`) that the backend waits on via
`service_completed_successfully`. Without it the `templates` table is empty and no story can be
created, because a template is mandatory.

## Architecture

### Two generation paths, only one of which uses the queue

Reading `story.controller.ts` alone is misleading. There are two distinct flows:

1. **`POST /api/stories`** saves photos, creates the story, then calls the private
   `generateScript()` **in the API process** as a fire-and-forget promise. The response returns
   before it finishes, so the story arrives at the client as `draft` and becomes `script_ready`
   moments later. This is why the frontend polls `draft` as well as the working statuses.
2. **`POST /api/stories/:id/generate`** creates a `Task` row and enqueues a BullMQ job. The worker
   in `queues/generationQueue.ts` runs the whole pipeline: script → narration → render → QR → PDF,
   writing progress into that `Task` (5 → 10 → 30 → 40 → 80 → 85 → 100).

`processFullGeneration()` in `story.controller.ts` is **dead code** — a leftover duplicate of the
worker pipeline from before BullMQ. Do not extend it; change the worker.

`POST /api/stories/:id/preview` is deliberately **synchronous** and skips narration: a preview is a
visual check that must return in seconds, so it avoids a second job type entirely.

The worker is started from `server.ts`, i.e. inside the API process. `worker:prod` exists to run it
standalone but no compose service uses it yet.

**Both paths call `aiService.generateScript()` independently** — the fire-and-forget call in
`story.controller.ts` and the worker's own step 1 in `generationQueue.ts` — each building its own
`images` array from the story's current slides and running its own LLM (or mock) pass. There is no
single call site to generate a script; a change to the request shape needs both updated together
(see the next section).

### Script generation sees the actual photos, not a text stand-in

`aiService.generateScript()` takes `images: Array<{ index, isKeyFrame, dataUri }>` — real photo bytes
as base64 data URIs, sent to the model as `image_url` content blocks (`detail: 'low'`, chosen for
cost: plenty for scene/mood/subject captioning, far cheaper in tokens than `'auto'`, which can pick
full resolution). `utils/imageDataUri.ts` reads a slide's file and encodes it; both call sites build
`images` this way before calling the service. The mock fallback (`mockScriptGeneration`, used with no
`OPENAI_API_KEY` or after the retry budget is exhausted) never sees the photos — it only has `index`
and `isKeyFrame`, so its captions are generic on purpose. Anything reached by `mockScriptGeneration`
must not claim to describe what's in a photo, because it never looked.

Because the worker unconditionally regenerates the script and overwrites every slide's `caption`,
clicking "Запустить генерацию" after hand-editing captions in the UI **silently discards those edits**
— this predates the change above and is not specific to it. Worth knowing before touching this path.

### Narration owns slide timing

`tts.service.ts` synthesises **one line per slide**, measures each with `ffprobe`, and the worker
writes the measured length back into `StorySlide.durationSeconds`. The slide's own duration acts as a
**lower bound**: `max(narration + 0.4s, 2s, slide.durationSeconds)`. That is what makes manual
duration edits meaningful ("show this photo longer") while making it impossible to truncate a spoken
line. If you change this, the editor UI copy in `StoryResultPage.tsx` ("Длительность — это минимум")
must change with it.

If `ffprobe` is missing, the length is **estimated from character count and the audio is kept** —
discarding speech that was already paid for is the wrong degradation.

### FFmpeg is invoked with an argument array, never a shell

`runFfmpeg(args: string[])` in `ffmpeg.helper.ts` uses `spawn` with `shell: false`, and slide
captions reach `drawtext` through a **file** (`textfile=caption_NNN.txt`, with `cwd` set to the temp
directory so no path escaping is needed). Caption text never appears in argv or in the filtergraph.

This is a security boundary, not a style choice: captions are user input via
`PUT /api/stories/:id/slides`. Never reintroduce a command string, `shell: true`, or `text=` with
inline caption content. `tests/render-injection.test.ts` asserts all of this with hostile payloads.

Because the boundary holds, caption validation only rejects control characters — quotes, `$` and
backticks are ordinary punctuation that narration needs.

### Configuration is snapshotted at import time

`src/config/index.ts` reads `process.env` **once**, when the module is first imported. Consequences:

- Any test that needs different configuration must set `process.env` **before** importing
  application modules. Static `import` statements are hoisted, so tests use dynamic
  `await import()` — see `tests/helpers/testApp.ts`.
- Rate limiters in `middleware/rateLimit.middleware.ts` are module-level singletons whose ceilings
  depend on `NODE_ENV` at import time, so tests needing production limits live in their own file
  (`tests/rate-limit.test.ts`, which sets `NODE_ENV` at the very top).
- `vitest.config.mts` therefore uses `isolate: true` with `pool: 'forks'`. This is required for
  correctness, not speed.

### Two Redis connections, on purpose

`generationQueue.ts` builds separate producer and worker connections. A BullMQ `Worker` refuses to
start unless `maxRetriesPerRequest` is `null`, but that same setting made `queue.add()` hang forever
when Redis was down. The producer therefore gets finite retries plus `enableOfflineQueue: false`, and
`enqueueGeneration()` additionally wraps the call in a timeout so the request answers **503** rather
than holding the connection open. Both connections keep reconnecting in the background.

### Schema lifecycle: `sync()` creates tables, `umzug` alters them

`sequelize.sync()` in development, the `init` compose service in Docker, and in production
`server.ts` **verifies the required tables exist and exits 1 with the missing list** if they do not.
`utils/migrate.ts` runs plain `sync()` (create-missing only, safe to re-run) and then `umzug.up()`
(`src/migrations/`, tracked in `SequelizeMeta`) for changes to a table that already exists — `sync()`
never alters one. A migration only needs to actually run anything on a database that predates the
column it adds; on a fresh database `sync()` already created it from the current model definition, so
the migration's `up()` finds the column already there and is a no-op (see the guard in
`0001-add-story-share-token.ts`). Add new migrations to the explicit list in `migrations/runner.ts`,
not by dropping a file into the directory — there is no glob-based discovery.

### Storage keys vs public URLs

The database stores public URLs (`/uploads/videos/x.mp4`) for videos, PDFs and QR codes but storage
**keys** (`videos/x.mp4`) for slide images. `storageService.keyFromUrl()` normalises either form, and
`deleteFile()` accepts both. `utils/storyArtefacts.ts` is the single list of files a story owns —
shared by the delete endpoint and the retention sweep so the two cannot drift.

### Auth token: cookie for the browser, header for everyone else

`authMiddleware` accepts the JWT from **either** an `Authorization: Bearer` header or an `httpOnly`
cookie (`utils/authCookie.ts`), header taking priority when both are present. Login/register set the
cookie *and* still return the token in the JSON body: the frontend (`AuthContext.tsx`) relies only on
the cookie and never reads `data.token`, but the response keeps it for API clients and the test suite,
which sign requests with the header. `POST /api/auth/logout` exists only because JS cannot read or
clear an `httpOnly` cookie itself. The cookie's `secure` flag mirrors `req.secure`, which already
accounts for `trust proxy` — hardcoding it to `true` would silently stop the cookie being sent on any
deployment not yet behind TLS.

### Share links are keyed by `shareToken`, never by the story's id

`Story.shareToken` is a separate UUID from the story's primary key, minted the first time a story
finishes rendering and reused across re-renders (editing slides and generating again must not break a
link already shared). `buildShareUrl()` and `GET /api/share/:token` both take the token, not the id —
building the public link from the id would make it impossible to revoke without breaking every foreign
key that points at the story. `POST /stories/:id/share/rotate` mints a fresh token (killing the old
link); `DELETE /stories/:id/share` clears it (disabling sharing until a rotate or another full
generation issues a new one).

### Retention expires whole stories

`retention.service.ts` deletes stories older than `FILE_RETENTION_DAYS` **together with their rows**,
not loose files by age. Deleting files alone would leave records pointing at missing images. The temp
sweep is separate and scoped to `uploads/temp` only.

## Configuration landmines

| Variable | Why it bites |
|---|---|
| `JWT_SECRET` | Production **refuses to start** if empty, under 32 characters, or equal to a published example value. Development warns and continues. |
| `PUBLIC_URL` | Origin of the **frontend**, not the API — `/share/:id` is a client-side route. Share links and QR codes are built from it. Distinct from `CORS_ORIGIN`, which is a list of permitted request origins. |
| `OPENAI_BASE_URL` | One OpenAI-compatible endpoint serves both the script and the narration. Set to `https://api.proxyapi.ru/openai/v1` for ProxyAPI; empty means official OpenAI. |
| `TTS_SERVICE` | Must be `openai` for real narration. Any other value (including the old `browser`) produces a deliberately **silent** track. |
| `FFMPEG_FONT_FILE` | `drawtext` needs a font file. The backend image installs `ttf-dejavu`; on a bare host without fonts, caption rendering fails outright. |

Without `OPENAI_API_KEY` the app still works end to end: the script falls back to canned template
phrases and the video is silent. Both are logged explicitly, and the script fallback is recorded in
`Task.resultData.scriptSource` — a story that sounds generic is attributable rather than mysterious.

## Sequelize + TypeScript: the class-fields trap

Model classes declare attributes as `public id!: string`. With `target: ES2022`, TypeScript's
`useDefineForClassFields` defaults to `true` and emits those declarations as **real class fields**,
which shadow Sequelize's attribute getters. Every attribute read then returns `undefined` at runtime
while `toJSON()` still serialises correctly — so HTTP responses look right and authentication breaks
silently.

`backend/tsconfig.json` sets `"useDefineForClassFields": false` for exactly this reason. Do not
remove it, and do not add `useDefineForClassFields: true` to any config that compiles the models.

## Testing conventions

Vitest + Supertest, in `backend/tests/` (flat, one file per concern — not the `unit/integration/`
layout that `CONTRIBUTING.md` still proposes; that section is out of date, as is its "add Jest" TODO).

- `tests/setup.ts` sets environment defaults and a per-file temp directory before anything imports
  the app. `LOG_LEVEL=silent` keeps output readable; `logger.ts` also skips `pino-pretty` under test
  because its worker thread prevents a clean exit.
- `tests/globalTeardown.ts` removes the scratch directories. It must run there: they are created in
  worker processes that Vitest terminates without running exit handlers.
- Redis is intentionally absent (port 6399). Tests assert the failure behaviour rather than mock it.
- The LLM and speech endpoints are stubbed with a local HTTP server, so the request contract itself
  is under test with no network and no key.
- Mocking a Node built-in used through a named import requires `vi.mock`, not `vi.spyOn` — the
  binding is captured at module load.

## CI

`.github/workflows/ci.yml` runs four jobs: backend types/lint/build/tests, frontend types/lint/build,
**Docker image builds**, and a compose smoke test that waits for `/api/health`, then asserts the
schema exists, reference data was seeded, and renders a real video end to end.

The last two jobs exist because of real incidents that no unit test would have caught: a
`.dockerignore` entry excluded the frontend `src/` directory so the image could not build at all, and
a missing seed step left the template table empty. When touching Docker or compose, assume the local
commands passing means nothing.

## Known gaps worth knowing before you plan work

`AUDIT_2026-08-12.md` holds the finding register with `file:line` references, `PROPOSALS.md` the
ranked suggestions, `PLAN_4_DAYS.md` the execution status and an acceptance checklist. Two older
documents in the root, `FS_CURRENT_STATE.md` and `FS_AUDIT_ONE.md`, are **historical and contradict
the current code** — do not plan from them.

Currently open: the worker sharing the API process, and `multer.memoryStorage()` holding up to 200 MB
per upload.

Unused dependencies still declared: `react-beautiful-dnd` and `qrcode.react` in the frontend,
`fluent-ffmpeg` in the backend (the project uses its own `spawn` wrapper).
