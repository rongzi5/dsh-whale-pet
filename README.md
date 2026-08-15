# @deepseek-ai/dsh-client-ui-whale-pet

English | [中文](README.zh.md)

Persistent browser plugin for the DeepSeek Harness 3D whale desktop pet.

The plugin registers one additive `whale-pet` entry in `shell.overlay`. It renders the procedural whale directly with the bundled `three@0.147.0`; it does not use a CDN, an iframe, a host RPC, or a workspace-absolute path.

## Behavior

- Rests at the viewport edge and patrols only at long, randomized intervals.
- Looks toward the pointer and shows a short heart reaction on hover or activation.
- Uses several body-shaped hit regions for dragging instead of a rectangular canvas target.
- Uses a continuous model yaw, so look, drag, patrol, and celebration all follow their movement direction instead of snapping left/right.
- Runs screen motion and Three.js rendering in one `requestAnimationFrame` loop.
- Uses exponential, non-overshooting drag follow and frame-rate-independent release inertia.
- Integrates animation phase over time so changing speed cannot jump the body, tail, or fins.

## Interactions and persistence

- **Click recap** — clicking the pet cycles a speech bubble through the name/days
  entry and recent session events (completed long turns, goal/plan milestones,
  tool failures with tool name and exit code, typing greetings).
- **Right-click menu** — chat with the pet (LLM, see below), rename the pet,
  toggle corner snapping, glide back to a corner, or hide it. The menu is
  keyboard-accessible (Enter/Space) and closes on outside click or Escape.
- **Corner snapping** — real drags (beyond the click threshold) glide to the
  nearest corner on release; toggle it from the menu.
- **`Ctrl`/`Cmd` + `Alt` + `W`** — toggle the pet's visibility from anywhere;
  the shortcut works even when the pet is hidden.
- **Persistence** — the pet's name, position, hidden state and snap preference
  survive reloads through `localStorage` (guarded against private mode), and
  the recap tracks the days you have spent together.

## LLM chat and memory

The right-click **"和鲸鲸聊天…"** entry opens an inline input bubble next to
the pet (Enter to send, Esc/outside click to close), and the pet replies in
its speech bubble. The bubble carries a **model selector** and a **reasoning
effort selector**: the model list comes from the DSH LLM service
(`GET /api/whale-pet/models`), and models that expose multiple reasoning
levels (e.g. deepseek-reasoner low/high) show an effort dropdown. Choices
persist to `localStorage` (`dsh.whale-pet.chat-prefs.v1`) and ride along with
every request.

Architecture: the browser pet never talks to an upstream LLM directly — the
host-side entry of this package registers the `/api/whale-pet` prefix on the
web server, and the client calls the same-origin `POST /api/whale-pet/chat`
endpoint. The API key stays on the server.

**Backend selection**: when the dsh `ctx.llm` service is available the proxy
uses it (DSH-configured providers, credentials, retries and reasoning
efforts); otherwise it falls back to the direct OpenAI-compatible upstream,
whose key resolves per request:

1. plugin `config.apiKey` (patch entry `config:` field)
2. env `DSH_WHALE_API_KEY` (fallback `DEEPSEEK_API_KEY`)
3. the dsh credentials service (`DEEPSEEK_API_KEY`) — the pet works with the
   same key the agent already uses, zero extra configuration

Other configuration (direct mode only): `DSH_WHALE_API_BASE` (default
`https://api.deepseek.com`, OpenAI-compatible upstream origin) and
`DSH_WHALE_API_MODEL` (default `deepseek-chat`).

Memory: the pet keeps long-term facts about you plus a bounded recent
conversation under the `dsh.whale-pet.memory.v1` localStorage key (same guarded
storage channel as the rest of the pet state). The system prompt asks the model
to report memorable facts with a `[记住] <fact>` line; the chat coordinator
strips those markers before showing the bubble and stores the extracted facts.
While a request is in flight the pet holds the `thinking` mood (an external
override the session observer respects) and reacts with an error mood and sweat
drops if the proxy is unreachable or unconfigured (no key → HTTP 503).

### Session progress (read-only, probed on ask)

The pet can answer "进度如何了": **when asked**, the pet actively probes the
current progress and appends a compact **read-only snapshot** to its own
system prompt, so it truthfully reports long-task progress. The probe has
three layers — the live projection state (running tools, turn duration, node
count, goal/plan phase), a fine-grained summary from the host event log
(current step, latest activity like "运行 bash：npm test", latest result
summary), and the **jobs registry's real state** (running task labels,
elapsed time, output tail like "进度 45%"; served at
`GET /api/whale-pet/progress?session=<id>`). It only reads — it **never
writes to the DSH conversation**, so long chats are not disturbed.

While the agent is busy, a plain **click on the pet** bubbles a playful but
factual progress line ("正在鼓捣终端（bash），已经 3 分钟" / "正在深度思考…";
a running background job wins: "正在后台跑 npm run build（已 5 分钟）")
without typing.

The pet's own context stays **bounded**: up to 24 memory facts (80 chars
each) + the last 8 turns (240 chars each) + the progress block, worst case
≈ 4.4 KB (~1.3k tokens). When a turn overflows the 8-turn window, evicted
old turns are not dropped — they are **compacted** into a capped summary
(`summary`, 400 chars) so long conversations keep a coarse digest of what
was discussed.

Debug: `GET /api/whale-pet/health` reports `{ ok, configured }`.

## Session integration

The plugin observes the current DSH session through `ctx.sessions` and drives
the pet's mood from the conversation snapshot and the `goal`/`plan`
projections. The bridge retries until the sessions service is available and
absorbs history-window lag after binding, so old errors never trigger a
reaction.

| Session state | Pet reaction |
|---|---|
| Assistant tokens or tool calls are running | `working`/`thinking`: faster swimming, input-area gaze, periodic bubbles |
| One turn runs longer than 20s | `focused`: a slight dive posture |
| Tool fails (non-zero exit code or error node) | `error`: pouring sweat drops, a trembling body, a pulsing red "！" mark and wide eyes for 3s |
| Long turn (≥15s), goal completion, or plan exit | `celebrating`: a 360° elliptical lap with continuous yaw and screen-space depth, while hearts stream every 650ms |
| You are composing a reply in the chat input | `listening`: gazes at the input area, shows a floating "？", and recaps "在呢，我听着～" on click |
| Hover or drag while sleeping | Wakes immediately and resets the idle clock |
| No activity for 60s | `sleeping`: closed eyes, slow breathing, z-z-z |

Debug attributes on the pet element:

- `data-whale-activity` — current mood (`idle`, `thinking`, `working`, `focused`, `celebrating`, `error`, `sleeping`, `listening`)
- `data-whale-bridge` — session bridge state (`off`, `waiting`, `bound`)

## Installation

### Plug-and-play (prebuilt, recommended)

The repository ships prebuilt runtime artifacts in `lib/`, so a downloaded
copy needs no pnpm workspace and no build step. Requires Node.js 22+ on the
machine running `dsh`.

1. Download the repository (GitHub ZIP or `git clone`).
2. Run the profile installer:

   ```sh
   node install-profile.mjs web
   ```

   This copies the package to `$DSH_HOME/profiles/web/plugins/ui-whale-pet`,
   adds it to the profile manifest and node_modules, and appends the
   `ui-whale-pet` Cordis row to `$DSH_HOME/profiles/web/cordis.patch.yml`.

   Use another profile name as the argument to install there.
3. Configure the chat proxy API key (see [LLM chat and memory](#llm-chat-and-memory))
   or the pet chat reports an unconfigured error.
4. Restart `dsh web` and hard-refresh the browser.

### Build from source (standalone)

The repository builds standalone (no pnpm workspace, no dsh checkout):

```sh
npm install            # dev toolchain: typescript, esbuild, vitest, three…
npm run build          # tsc declarations + esbuild host/client bundles → lib/
npm test               # vitest suite (126 tests)
node install-profile.mjs web
```

The build is self-contained: host bundles inline everything (only type-only
imports), so the cordis loader needs no node_modules next to the plugin, and
the client bundle keeps the DSH `__ModuleLoader__.load` browser format with
`react`/`react/jsx-runtime` external.

## Architecture

- `src/client/activity.ts` — pure mood/effect vocabulary and the view snapshot type.
- `src/client/motion.ts` — pure frame-rate-independent screen-space motion, including the celebration loop path and corner snapping.
- `src/client/persistence.ts` — guarded `localStorage` state (name, position, hidden, snap preference, first-run date).
- `src/client/runtime/scheduler.ts` — the single `requestAnimationFrame` clock.
- `src/client/runtime/whale-pet-controller.ts` — owns the DOM listeners, scheduler, and per-frame rendering; composes the Three.js scene from `src/client/whale`.
- `src/client/runtime/whale-pet-service.ts` — observable runtime service (`ctx.whalePet`) with activity, transient effects, recap history and persisted state.
- `src/client/runtime/session-observer.ts` — subscribes to the current session snapshot (with a low-frequency polling fallback) and maps session state to moods/effects and user typing.
- `src/client/whale/config.ts` — shared geometry/animation constants and SVG contours.
- `src/client/whale/geometry.ts` — pure SVG/contour helpers and BufferGeometry builders.
- `src/client/whale/materials.ts` — material factories, including the blue/white body-mask shader.
- `src/client/whale/animation.ts` — frame pose animation (swim, tail, fins, eyes, float, error/sleep reactions).
- `src/client/whale/scene.ts` — `createWhaleScene` factory composing config, geometry, materials and animation into a `WhaleScene` handle.
- `src/client/WhalePet.tsx` — thin view consuming the service snapshot through `useSyncExternalStore`; owns the DOM focus listeners for typing detection, the context menu and the chat bubble (model/effort selectors).
- `src/client/memory.ts` — long-term memory store (facts + recent turns) with the `[记住]` extraction protocol, persisted through the guarded storage channel.
- `src/client/llm.ts` — browser transport for the same-origin chat proxy (`/api/whale-pet/chat`, `/api/whale-pet/models`), injectable for headless tests.
- `src/client/runtime/whale-pet-chat.ts` — chat coordinator: thinking override, reply bubble, memory persistence, error reactions, chat preferences.
- `src/chat-proxy.ts` — pure host-side proxy logic: backend interface, direct upstream forwarding, HTTP handler for `/health`, `/models`, `/chat`.
- `src/llm-backend.ts` — dsh-llm backend: model catalog with reasoning efforts, streaming completion via `ctx.llm`.
- `src/index.ts` — host entry: mounts the `/api/whale-pet` prefix on `ctx.webServer`, picks the backend (dsh llm service first, direct upstream fallback).

## Model source and acknowledgements

The original whale model and visual reference come from the Bilibili video [BV17Buf69EVV](https://www.bilibili.com/video/BV17Buf69EVV/). Thanks to the original creator for publishing the model demonstration and design reference.

This plugin ports and packages the model for the DeepSeek Harness interaction and lifecycle system. This acknowledgement does not grant additional rights to the original model or video; downstream users remain responsible for complying with the original creator's terms.

## Lifecycle

The overlay registration, DOM listeners, animation frame, WebGL renderer, geometries, materials, and textures all unwind with the owning Cordis fiber. The host chat-proxy route unwinds with its fiber too; the API key never enters the browser.
