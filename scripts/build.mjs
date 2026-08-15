#!/usr/bin/env node
/**
 * Standalone build for the whale pet package (no dsh workspace required).
 *
 *  1. tsc (declaration-only) → lib/types (d.ts tree)
 *  2. esbuild host bundles  → lib/index.js, lib/invariant.js (self-contained
 *     ESM: all imports are type-only or inlined, so the cordis loader needs
 *     no node_modules next to the plugin)
 *  3. esbuild client bundle → lib/client.js in the DSH `__ModuleLoader__.load`
 *     browser format (external: react / react/jsx-runtime, everything else
 *     inlined)
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'node_modules', '.bin')
const PACKAGE_ID = '@deepseek-ai/dsh-client-ui-whale-pet'

function step(message) {
  console.log(`[build] ${message}`)
}

/**
 * CSS Modules for the DSH browser bundle, mirroring what the tsdown pipeline
 * emitted: hash-prefixed class names, the mapping object as the module's
 * default export, and the stylesheet injected as one deduplicated `<style
 * data-plugin-css>` tag at runtime. Without this the `.module.css` default
 * export is an empty object and every className comes out undefined.
 */
const cssModulePlugin = () => ({
  name: 'whale-css-modules',
  setup(build) {
    build.onResolve({ filter: /\.module\.css$/ }, (args) => {
      return { path: resolve(args.resolveDir, args.path), namespace: 'whale-css' }
    })
    build.onLoad({ filter: /.*/, namespace: 'whale-css' }, async (args) => {
      const source = readFileSync(args.path, 'utf8')
      const hash = createHash('md5').update(args.path).digest('hex').slice(0, 6)
      const prefix = `v${hash}`
      const classNames = [...new Set(source.match(/\.([a-zA-Z][\w-]*)/g)?.map(token => token.slice(1)) ?? [])]
      const css = source.replace(/\.([a-zA-Z][\w-]*)/g, (token, name) => `.${prefix}_${name}`)
      const tagId = `${PACKAGE_ID}/${args.path.split('/').at(-1)}`
      const mapping = Object.fromEntries(classNames.map(name => [name, `${prefix}_${name}`]))
      const contents = [
        `var css = ${JSON.stringify(css)};`,
        `var tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {`,
        `  const tag = document.createElement("style");`,
        `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_ID)};`,
        `  tag.dataset.pluginCss = tagId;`,
        `  tag.textContent = css;`,
        `  document.head.appendChild(tag);`,
        `}`,
        `module.exports = ${JSON.stringify(mapping)};`,
      ].join('\n')
      return { contents, loader: 'js' }
    })
  },
})

// 1. Type declarations for the published `types` entry.
step('tsc declaration-only → lib/types')
execFileSync(join(BIN, 'tsc'), ['-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'inherit' })

// 2. Host bundles: self-contained ESM (no external runtime imports).
step('esbuild host entry → lib/index.js')
await build({
  entryPoints: [join(ROOT, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(ROOT, 'lib/index.js'),
  logLevel: 'warning',
})
step('esbuild invariant companion → lib/invariant.js')
await build({
  entryPoints: [join(ROOT, 'src/invariant.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(ROOT, 'lib/invariant.js'),
  logLevel: 'warning',
})

// 3. Browser bundle in the DSH client-loader format.
step('esbuild client bundle → lib/client.js')
const tmp = join(ROOT, 'lib', '.client.cjs')
await build({
  entryPoints: [join(ROOT, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  outfile: tmp,
  external: ['react', 'react/jsx-runtime'],
  plugins: [cssModulePlugin()],
  logLevel: 'warning',
})
const body = readFileSync(tmp, 'utf8')
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PACKAGE_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\t"use strict";
${body}
\t\treturn module.exports;
\t}
});
`
writeFileSync(join(ROOT, 'lib/client.js'), wrapped)
rmSync(tmp, { force: true })

step('done')
