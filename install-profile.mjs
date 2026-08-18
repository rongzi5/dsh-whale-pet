#!/usr/bin/env node
/**
 * Plug-and-play installer for a dsh profile.
 *
 * Copies this repository's prebuilt package into
 * `$DSH_HOME/profiles/<profile>/plugins/ui-whale-pet`, adds it as a plain
 * profile dependency, links it into the profile's node_modules, and appends
 * the required `ui-whale-pet` Cordis row to the profile patch.
 *
 * Usage:
 *   node install-profile.mjs [profile]     # default profile: web
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const profileName = process.argv[2] ?? 'web'
const repoRoot = resolve(fileURLToPath(new URL('./', import.meta.url)))
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const pluginId = '@deepseek-ai/dsh-client-ui-whale-pet'

function fail(message) {
  console.error(`install-profile: ${message}`)
  process.exit(1)
}

for (const file of ['package.json', 'lib/index.js', 'lib/client.js']) {
  if (!existsSync(join(repoRoot, file))) fail(`prebuilt artifact missing: ${file}; rebuild from source first`)
}

const pluginDir = join(profileDir, 'plugins', 'ui-whale-pet')
if (resolve(repoRoot) === resolve(pluginDir)) {
  fail(`source directory is the active install target (${pluginDir}); run this installer from a separate source checkout`)
}
console.log(`install-profile: installing ${pluginId} into ${profileDir}`)

// 1. Copy the runnable package (package.json, lib/, docs, license).
rmSync(pluginDir, { recursive: true, force: true })
mkdirSync(pluginDir, { recursive: true })
for (const entry of ['package.json', 'lib', 'LICENSE', 'README.md', 'README.zh.md']) {
  const source = join(repoRoot, entry)
  if (existsSync(source)) cpSync(source, join(pluginDir, entry), { recursive: true })
}

// 2. Record the dependency in the profile manifest, preserving other plugins.
const manifestPath = join(profileDir, 'package.json')
let manifest
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (cause) {
    fail(`cannot parse ${manifestPath}: ${cause}`)
  }
} else {
  manifest = {
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }
}
manifest.dependencies ??= {}
manifest.dependencies[pluginId] = `link:${pluginDir}`

// Older installers could classify this client-injection package as a profile
// bundle. It has no bundle patch by design; remove that stale entry while
// preserving the user's actual bundle layers.
const bundles = manifest.dsh?.profile?.bundles
if (Array.isArray(bundles) && bundles.includes(pluginId)) {
  manifest.dsh.profile.bundles = bundles.filter((name) => name !== pluginId)
  console.warn(`install-profile: removed stale bundle entry for ${pluginId}`)
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// 3. Materialize the node_modules link Node resolution will use.
const scopedDir = join(profileDir, 'node_modules', '@deepseek-ai')
const linkPath = join(scopedDir, pluginId.split('/').at(-1))
mkdirSync(scopedDir, { recursive: true })
rmSync(linkPath, { recursive: true, force: true })
symlinkSync(relative(dirname(linkPath), pluginDir), linkPath, process.platform === 'win32' ? 'junction' : 'dir')

// 4. Add the Cordis row to the profile patch if it is not already present.
const patchPath = join(profileDir, 'cordis.patch.yml')
let patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n'
if (!patch.includes('id: ui-whale-pet')) {
  const row = '- insert:\n    - id: ui-whale-pet\n      name: \'@deepseek-ai/dsh-client-ui-whale-pet\'\n'
  if (/^[\s\S]*\[\s*\]\s*$/.test(patch)) {
    patch = patch.replace(/\[\s*\]/, row)
  } else {
    patch = `${patch.trimEnd()}\n\n- insert:\n    - id: ui-whale-pet\n      name: '@deepseek-ai/dsh-client-ui-whale-pet'\n`
  }
  writeFileSync(patchPath, patch)
}

console.log(`install-profile: done. Package copied to ${pluginDir}`)
console.log(`install-profile: restart \`dsh web\` and hard-refresh the browser to load the pet.`)
