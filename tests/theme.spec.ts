import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ThemeDefinition, ThemeTokenModes, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index'
import { MOONSET_DARK, MOONSET_LIGHT } from '../src/client/palettes'
import {
  FOLLOW_LAYER_SOURCE,
  MOONSET_THEMES,
  MOONSET_THEME_IDS,
  createFollowLayer,
  moonsetDefinitions,
  moonsetFollowOverrides,
  registerMoonsetThemes,
  type MoonsetThemeService,
} from '../src/client/themes'

/**
 * M4 contract: two registered themes plus a token-level "follow system" layer.
 *
 * The fake below is a hand-written stand-in for the official `ThemeRuntime`
 * (no jsdom, no host): it reproduces the three behaviours the contract rests on
 * — a duplicate id throws, an override value must carry both scheme halves,
 * and a disposer removes exactly what its call added — and it records the one
 * call M4 must never make (`setTheme`).
 */

/** One live registration held by the fake runtime. */
interface FakeRegistration {
  definition: ThemeDefinition
}

/** One live override layer held by the fake runtime. */
interface FakeLayer {
  source: string
  tokens: ThemeTokenOverrides
}

/** Drop `entry` from `list` if it is still there (disposer bodies). */
function remove<T>(list: T[], entry: T): void {
  const index = list.indexOf(entry)
  if (index >= 0) list.splice(index, 1)
}

/**
 * In-memory `ThemeRuntime` with the members this plugin drives.
 *
 * Deliberately small: it exposes only what M4 calls plus its own scratch
 * records, so a new dependency on the real runtime shows up as a type error
 * rather than passing silently against an over-stuffed fake.
 */
class FakeTheme implements MoonsetThemeService {
  /** Accepted registrations, in order; a disposed one leaves the list. */
  readonly registrations: FakeRegistration[] = []
  /** Stacked token layers, in order; a released one leaves the list. */
  readonly layers: FakeLayer[] = []
  /** The persisted preference — M4 has to leave it on `system` (D4). */
  preference = 'system'
  /** Every `setTheme` call; M4 must record zero (D4 / issue #36). */
  readonly setThemeCalls: string[] = []
  /** When set, `register` throws it for every definition (peer owns both ids). */
  failRegister: Error | null = null
  /** When set, `register` throws "already registered" for exactly this id. */
  failRegisterFor: string | null = null
  /** Runs synchronously from `overrideTokens`, standing in for publish(). */
  onTokenOverride: (() => void) | null = null
  /** Runs synchronously from a layer disposer, standing in for publish(). */
  onLayerDispose: (() => void) | null = null

  register(definition: ThemeDefinition): () => void {
    if (this.failRegister) throw this.failRegister
    if (this.failRegisterFor === definition.id) {
      throw new Error(`theme "${definition.id}" is already registered`)
    }
    if (this.registrations.some((entry) => entry.definition.id === definition.id)) {
      throw new Error(`theme "${definition.id}" is already registered`)
    }
    const entry: FakeRegistration = { definition }
    this.registrations.push(entry)
    return () => {
      remove(this.registrations, entry)
    }
  }

  overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void {
    // The runtime validates at this boundary and rejects a half-filled pair.
    for (const [name, value] of Object.entries(tokens)) {
      const modes = value as Partial<ThemeTokenModes> | string
      if (typeof modes !== 'object' || typeof modes.light !== 'string' || typeof modes.dark !== 'string') {
        throw new TypeError(`override token "${name}" needs both light and dark values`)
      }
    }
    // Re-overriding a source replaces that source's whole layer (runtime rule).
    for (let index = this.layers.length - 1; index >= 0; index -= 1) {
      if (this.layers[index].source === source) this.layers.splice(index, 1)
    }
    const layer: FakeLayer = { source, tokens }
    this.layers.push(layer)
    this.onTokenOverride?.()
    return () => {
      remove(this.layers, layer)
      this.onLayerDispose?.()
    }
  }

  /** Only the field under test (the preference) is modelled. */
  getTheme(): { preference: string } {
    return { preference: this.preference }
  }

  setTheme(id: string): void {
    this.setThemeCalls.push(id)
    this.preference = id
  }
}

describe('registerMoonsetThemes — the two Moonset themes (D3)', () => {
  it('registers exactly moonset-light and moonset-dark, 228 tokens each', () => {
    const theme = new FakeTheme()
    registerMoonsetThemes(theme)

    const definitions = theme.registrations.map((entry) => entry.definition)
    expect(definitions.map((definition) => definition.id)).toEqual(['moonset-light', 'moonset-dark'])
    expect(definitions.map((definition) => definition.colorScheme)).toEqual(['light', 'dark'])
    for (const definition of definitions) {
      expect(Object.keys(definition.tokens)).toHaveLength(228)
    }
    // Each definition carries its own palette, not the other scheme's.
    expect(definitions[0].tokens['--dsw-alias-bg-base']).toBe(MOONSET_LIGHT['--dsw-alias-bg-base'])
    expect(definitions[1].tokens['--dsw-alias-bg-base']).toBe(MOONSET_DARK['--dsw-alias-bg-base'])
    expect(definitions[0].tokens['--dsw-alias-bg-base'])
      .not.toBe(definitions[1].tokens['--dsw-alias-bg-base'])

    // D3: every id is namespaced, so a peer's ids cannot collide by accident.
    expect(MOONSET_THEME_IDS.filter((id) => !id.startsWith('moonset-'))).toEqual([])
    // The labels are what M5 renders; they belong to the theme identity here.
    expect(MOONSET_THEMES.map((theme) => theme.label)).toEqual(['Moonset Light', 'Moonset Dark'])
    expect(moonsetDefinitions().map((definition) => definition.id)).toEqual(['moonset-light', 'moonset-dark'])
  })

  it('is idempotent while live and registers again after the disposer releases', () => {
    const theme = new FakeTheme()
    const first = registerMoonsetThemes(theme)
    const second = registerMoonsetThemes(theme)

    // Same runtime, same live registration: the second call hands back the
    // first disposer instead of re-registering (the runtime throws on a dup id).
    expect(second).toBe(first)
    expect(first.skipped).toBe(false)
    expect(theme.registrations).toHaveLength(2)

    first()
    expect(theme.registrations).toEqual([])
    second() // releasing twice is a no-op
    expect(theme.registrations).toEqual([])

    const again = registerMoonsetThemes(theme)
    expect(again).not.toBe(first)
    expect(theme.registrations.map((entry) => entry.definition.id)).toEqual(['moonset-light', 'moonset-dark'])
    again()
    expect(theme.registrations).toEqual([])
  })

  it('skips instead of throwing when the ids are already owned (D3)', () => {
    const theme = new FakeTheme()
    theme.failRegister = new Error('theme "moonset-light" is already registered')

    const registration = registerMoonsetThemes(theme)

    expect(registration.skipped).toBe(true)
    expect(theme.registrations).toEqual([])
    expect(() => registration()).not.toThrow()
  })

  it('keeps the id it can register when only its sibling is taken', () => {
    const theme = new FakeTheme()
    theme.failRegisterFor = 'moonset-dark'

    const registration = registerMoonsetThemes(theme)

    expect(registration.skipped).toBe(true)
    expect(theme.registrations.map((entry) => entry.definition.id)).toEqual(['moonset-light'])
    registration()
    expect(theme.registrations).toEqual([])
  })

  it('warns but still skips an unexpected registration failure', () => {
    const theme = new FakeTheme()
    theme.failRegister = new Error('transport is gone')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const registration = registerMoonsetThemes(theme)
      expect(registration.skipped).toBe(true)
      expect(theme.registrations).toEqual([])
      // One line per failed definition, all prefixed with the plugin id.
      expect(warn).toHaveBeenCalledTimes(2)
      for (const [message] of warn.mock.calls) {
        expect(String(message)).toContain('[dsh-moonset]')
        expect(String(message)).toContain('transport is gone')
      }
    } finally {
      warn.mockRestore()
    }
  })
})

describe('createFollowLayer — follow system without touching the preference (D4)', () => {
  it('pushes one dsh-moonset layer with both halves of all 228 tokens', () => {
    const theme = new FakeTheme()
    const layer = createFollowLayer(theme)
    layer.enable()

    expect(theme.layers).toHaveLength(1)
    const [pushed] = theme.layers
    expect(pushed.source).toBe(FOLLOW_LAYER_SOURCE)
    expect(pushed.source).toBe('dsh-moonset')

    const names = Object.keys(pushed.tokens)
    expect(names).toHaveLength(228)
    // Every key, both halves, each from the table of the matching scheme.
    for (const name of names) {
      expect(pushed.tokens[name]).toEqual({ light: MOONSET_LIGHT[name], dark: MOONSET_DARK[name] })
    }
    // The two tables must cover the same names, or the union would hide a gap.
    expect(Object.keys(MOONSET_LIGHT).sort()).toEqual(Object.keys(MOONSET_DARK).sort())

    // Sampled keys (the loop above is the exhaustive check): a token that
    // genuinely differs per scheme must not get the same half twice.
    for (const name of ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-alias-json-tree-keyword']) {
      expect(pushed.tokens[name].light).toBe(MOONSET_LIGHT[name])
      expect(pushed.tokens[name].dark).toBe(MOONSET_DARK[name])
      expect(pushed.tokens[name].light).not.toBe(pushed.tokens[name].dark)
    }
    layer.disable()
  })

  it('stacks once, is idempotent while enabled, and releases on disable', () => {
    const theme = new FakeTheme()
    const layer = createFollowLayer(theme)

    expect(layer.enabled).toBe(false)
    layer.enable()
    layer.enable()
    expect(theme.layers).toHaveLength(1)
    expect(layer.enabled).toBe(true)
    expect(Object.keys(theme.layers[0].tokens)).toHaveLength(228)

    layer.disable()
    expect(theme.layers).toEqual([])
    expect(layer.enabled).toBe(false)
    layer.disable() // releasing twice is a no-op
    expect(theme.layers).toEqual([])

    layer.enable() // and it can be stacked again
    expect(theme.layers).toHaveLength(1)
    layer.disable()
  })

  it('ignores layer changes that re-enter from inside a layer change (issue #36 #2)', () => {
    const theme = new FakeTheme()
    const layer = createFollowLayer(theme)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // A synchronous publish listener that reacts to its own event: re-entering
      // here would recurse (same-source replace on every publish).
      theme.onTokenOverride = () => {
        layer.disable()
        layer.enable()
      }
      expect(() => layer.enable()).not.toThrow()
      expect(theme.layers).toHaveLength(1)
      expect(layer.enabled).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('issue #36 constraint 2')

      // And the removal side: the layer is already cleared when the disposer
      // runs, so a listener that re-enables during teardown is ignored too.
      theme.onTokenOverride = null
      theme.onLayerDispose = () => {
        layer.enable()
      }
      expect(() => layer.disable()).not.toThrow()
      expect(theme.layers).toEqual([])
      expect(layer.enabled).toBe(false)
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      theme.onTokenOverride = null
      theme.onLayerDispose = null
      warn.mockRestore()
    }
  })

  it('never calls setTheme and leaves the preference on system', () => {
    const theme = new FakeTheme()
    const registration = registerMoonsetThemes(theme)
    const layer = createFollowLayer(theme)

    layer.enable()
    layer.disable()
    layer.enable()
    registration()
    layer.disable()

    expect(theme.setThemeCalls).toEqual([])
    expect(theme.getTheme().preference).toBe('system')
  })

  it('leaves neither registrations nor layers behind after unload', () => {
    const theme = new FakeTheme()
    const registration = registerMoonsetThemes(theme)
    const layer = createFollowLayer(theme)

    layer.enable()
    expect(theme.registrations).toHaveLength(2)
    expect(theme.layers).toHaveLength(1)

    registration()
    layer.disable()

    expect(theme.registrations).toEqual([])
    expect(theme.layers).toEqual([])
  })

  it('builds the layer dictionary from both tables, no half-filled pairs', () => {
    const overrides = moonsetFollowOverrides()

    expect(Object.keys(overrides)).toHaveLength(228)
    for (const [name, modes] of Object.entries(overrides)) {
      expect(Object.keys(modes).sort()).toEqual(['dark', 'light'])
      expect(modes.light).toBe(MOONSET_LIGHT[name])
      expect(modes.dark).toBe(MOONSET_DARK[name])
    }
  })
})

describe('apply — the boot path never throws (D3)', () => {
  it('registers both themes through ctx.effect and releases them on unload', () => {
    const theme = new FakeTheme()
    const labels: string[] = []
    const disposers: (() => void)[] = []
    const ctx = {
      theme,
      effect(execute: () => () => void, label?: string) {
        labels.push(label ?? '')
        const dispose = execute()
        disposers.push(dispose)
        return dispose
      },
    } as unknown as ClientContext

    apply(ctx)

    expect(theme.registrations.map((entry) => entry.definition.id)).toEqual(['moonset-light', 'moonset-dark'])
    expect(labels).toEqual(['moonset: light/dark theme registrations'])

    for (const dispose of disposers) dispose()
    expect(theme.registrations).toEqual([])
  })

  it('does not throw when the theme service rejects both ids', () => {
    const theme = new FakeTheme()
    theme.failRegister = new Error('theme "moonset-light" is already registered')
    const ctx = {
      theme,
      effect(execute: () => () => void) {
        return execute()
      },
    } as unknown as ClientContext

    expect(() => apply(ctx)).not.toThrow()
    expect(theme.registrations).toEqual([])
  })
})
