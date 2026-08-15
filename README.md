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
- **Right-click menu** — rename the pet, toggle corner snapping, glide back to a
  corner, or hide it. The menu is keyboard-accessible (Enter/Space) and closes
  on outside click or Escape.
- **Corner snapping** — real drags (beyond the click threshold) glide to the
  nearest corner on release; toggle it from the menu.
- **`Ctrl`/`Cmd` + `Alt` + `W`** — toggle the pet's visibility from anywhere;
  the shortcut works even when the pet is hidden.
- **Persistence** — the pet's name, position, hidden state and snap preference
  survive reloads through `localStorage` (guarded against private mode), and
  the recap tracks the days you have spent together.

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
| Tool fails (non-zero exit code or error node) | `error`: sweat drop + startled eyes for 8s |
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
3. Restart `dsh web` and hard-refresh the browser.

### Build from source (development)

The plugin can also be installed from source inside a DeepSeek Harness
checkout. Use Node.js 22 or newer:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git clone https://github.com/rongzi5/dsh-whale-pet.git packages/client/ui-whale-pet
```

Add the workspace package to `packages/bundle/web-app/package.json`:

```json
"@deepseek-ai/dsh-client-ui-whale-pet": "workspace:^"
```

Add the formal Cordis row to the browser-plugin block in `packages/bundle/web-app/cordis.patch.yml`:

```yaml
- id: ui-whale-pet
  name: '@deepseek-ai/dsh-client-ui-whale-pet'
```

Add the package source mapping to `compilerOptions.paths` in `tsconfig.base.json`:

```json
"@deepseek-ai/dsh-client-ui-whale-pet": ["./packages/client/ui-whale-pet/src"]
```

Add the package project to `references` in `tsconfig.client.json`:

```json
{ "path": "./packages/client/ui-whale-pet" }
```

Install, build, and start the Web UI:

```sh
corepack pnpm install
corepack pnpm run build
corepack pnpm dsh web
```

Open `http://127.0.0.1:3080` after the process starts. The Host composition is loaded at process startup, so restart `dsh web` after adding or updating this plugin; refreshing the browser alone does not add a new composition row.

## Architecture

- `src/client/activity.ts` — pure mood/effect vocabulary and the view snapshot type.
- `src/client/motion.ts` — pure frame-rate-independent screen-space motion, including the celebration loop path and corner snapping.
- `src/client/persistence.ts` — guarded `localStorage` state (name, position, hidden, snap preference, first-run date).
- `src/client/runtime/scheduler.ts` — the single `requestAnimationFrame` clock.
- `src/client/runtime/whale-pet-controller.ts` — owns the Three.js scene, DOM listeners, and per-frame rendering.
- `src/client/runtime/whale-pet-service.ts` — observable runtime service (`ctx.whalePet`) with activity, transient effects, recap history and persisted state.
- `src/client/runtime/session-observer.ts` — polls the current session and maps session state to moods/effects and user typing.
- `src/client/WhalePet.tsx` — thin view consuming the service snapshot through `useSyncExternalStore`; owns the DOM focus listeners for typing detection and the context menu.

## Model source and acknowledgements

The original whale model and visual reference come from the Bilibili video [BV17Buf69EVV](https://www.bilibili.com/video/BV17Buf69EVV/). Thanks to the original creator for publishing the model demonstration and design reference.

This plugin ports and packages the model for the DeepSeek Harness interaction and lifecycle system. This acknowledgement does not grant additional rights to the original model or video; downstream users remain responsible for complying with the original creator's terms.

## Lifecycle

The overlay registration, DOM listeners, animation frame, WebGL renderer, geometries, materials, and textures all unwind with the owning Cordis fiber. The package has no Host behavior.
