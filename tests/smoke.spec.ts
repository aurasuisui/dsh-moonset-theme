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

describe('package manifest', () => {
  it('declares the plugin identity', () => {
    expect(manifest.name).toBe('dsh-moonset-theme')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.private).toBe(true)
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
