# @deepseek-ai/dsh-client-ui-whale-pet

English | [中文](README.zh.md)

Persistent browser plugin for the DeepSeek Harness 3D whale desktop pet.

The plugin registers one additive `whale-pet` entry in `shell.overlay`. It renders the procedural whale directly with the bundled `three@0.147.0`; it does not use a CDN, an iframe, a host RPC, or a workspace-absolute path.

## Behavior

- Rests at the viewport edge and patrols only at long, randomized intervals.
- Looks toward the pointer and shows a short heart reaction on hover or activation.
- Uses several body-shaped hit regions for dragging instead of a rectangular canvas target.
- Runs screen motion and Three.js rendering in one `requestAnimationFrame` loop.
- Uses exponential, non-overshooting drag follow and frame-rate-independent release inertia.
- Integrates animation phase over time so changing speed cannot jump the body, tail, or fins.

## Installation

The plugin currently installs from source. Use Node.js 22 or newer, then clone it into a DeepSeek Harness checkout:

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

## Model source and acknowledgements

The original whale model and visual reference come from the Bilibili video [BV17Buf69EVV](https://www.bilibili.com/video/BV17Buf69EVV/). Thanks to the original creator for publishing the model demonstration and design reference.

This plugin ports and packages the model for the DeepSeek Harness interaction and lifecycle system. This acknowledgement does not grant additional rights to the original model or video; downstream users remain responsible for complying with the original creator's terms.

## Lifecycle

The overlay registration, DOM listeners, animation frame, WebGL renderer, geometries, materials, and textures all unwind with the owning Cordis fiber. The package has no Host behavior.
