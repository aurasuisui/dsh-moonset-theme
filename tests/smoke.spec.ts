import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The slice of the manifest the host loader and the plugin bundle both read. */
interface PackageManifest {
  name: string
  version: string
  private?: boolean
  exports: Record<string, string>
  dsh: {
    bundle?: { patch?: string }
    client?: { inject?: string[]; platform?: string }
  }
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest

/** The bundle patch, read as text: the row's `name` must resolve to this package. */
const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/** The row `name` values this bundle's patch inserts (single or double quoted). */
const patchRowNames = [...patchText.matchAll(/^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map(
  (match) => match[1],
)

/** The module-loader id baked into the built client bundle. */
const clientBundleId = (() => {
  const first = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').slice(0, 400)
  return /id:\s*["']([^"']+)["']/.exec(first)?.[1]
})()

describe('package manifest', () => {
  it('declares the plugin identity', () => {
    expect(manifest.name).toBe('@aurasuisui/dsh-moonset-theme')
    expect(manifest.version).toBe('0.1.6')
  })

  it('is publishable', () => {
    // A private package can never be published; npm refuses it before upload.
    expect(manifest.private).toBeUndefined()
  })

  it('exports both halves and the manifest itself', () => {
    expect(manifest.exports['.']).toBe('./lib/index.js')
    expect(manifest.exports['./client']).toBe('./lib/client.js')
    expect(manifest.exports['./package.json']).toBe('./package.json')
  })

  it('declares the bundle patch and the web client half', () => {
    expect(manifest.dsh.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client?.platform).toBe('web')
    expect(manifest.dsh.client?.inject?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('published identity stays consistent', () => {
  // Three separate places spell this package's name, and each one fails at a
  // different moment: the loader cannot resolve a patch row whose name is not
  // installed, and dsh-client-modules throws
  // `bundle <url> loaded without registering "<name>"` when the built bundle's
  // id drifts from the package name. All three are cheap to assert here.
  it('the bundle patch inserts a row named exactly this package', () => {
    expect(patchRowNames).toEqual([manifest.name])
  })

  it('the built client bundle registers under exactly this package name', () => {
    expect(clientBundleId).toBe(manifest.name)
  })
})
