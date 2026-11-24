import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  MOONSET_CHOICES,
  MOONSET_SECTION_OPTIONS,
  applyChoice,
  resolveChoice,
  type ChoiceDeps,
} from '../src/client/choice'
import {
  MOONSET_ENTRY_ID,
  WRITE_DEBOUNCE_MS,
  createDurableChoice,
  createDurableGlow,
  type MoonsetSettingsSection,
} from '../src/client/durable'
import {
  DEFAULT_GLASS,
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLOW_HUE_DARK,
  DEFAULT_GLOW_HUE_LIGHT,
  DEFAULT_GLOW_SCOPE,
  DEFAULT_GLOW_STRENGTH_DARK,
  DEFAULT_GLOW_STRENGTH_LIGHT,
  GLASS_BLUR_MAX,
  GLASS_BLUR_MIN,
  GLOW_HUES,
  GLOW_SCOPES,
} from '../src/client/skin'
import { apply } from '../src/client/index'
import { MOONSET_LOCALE_NS, en, zh } from '../src/client/locales'
import { Config, MOONSET_ENTRY_ID as HOST_ENTRY_ID } from '../src/index'

/**
 * M5 contract: the settings section, its metadata, the choice controller, and
 * the plugin's own durable store.
 *
 * No component is rendered and no DOM is involved (the repo has no React test
 * stack — PLAN 九、已知债): the assertions drive the pure controller
 * (applyChoice), the durable facade over an in-memory ConfigForm, and the
 * registration options the section hands the slot registry.
 *
 * The fakes below are hand-written and deliberately small — each exposes only
 * what M5 calls plus its own scratch records, so a new dependency in the
 * production code shows up as a missing member here rather than passing
 * silently against an over-stuffed fake (the same stance as
 * tests/theme.spec.ts).
 */

/** One in-memory SettingsForm, the shape configForms.get hands back. */
class FakeForm {
  /** Current accepted section. */
  section: MoonsetSettingsSection
  /** Monotonic revision (the real form's fence; M5 does not read it). */
  revision = 1
  /** Every set call, in order. */
  readonly sets: { field: string; value: unknown }[] = []
  /** When set, set() rejects with it (transport failure). */
  failWith: Error | null = null
  private readonly listeners = new Set<() => void>()

  constructor(section: MoonsetSettingsSection = {}) {
    this.section = section
  }

  getSnapshot(): {
    status: 'ready'
    value: MoonsetSettingsSection
    user: MoonsetSettingsSection
    base: undefined
    revision: number
    writable: boolean
  } {
    return {
      status: 'ready',
      value: this.section,
      user: this.section,
      base: undefined,
      revision: this.revision,
      writable: true,
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<boolean> {
    this.sets.push({ field, value })
    if (this.failWith) throw this.failWith
    this.section = { ...this.section, [field]: value }
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
    return true
  }
}

/** One captured slots.register call. */
interface FakeRegistration {
  readonly name: string
  readonly options: FakeSectionOptions
  readonly component: unknown
}

/** The list-slot options the section registration carries. */
interface FakeSectionOptions {
  name: string
  id?: string
  order?: number
  label?: string | (() => string)
  locale?: string
  inject?: () => Record<string, unknown>
}

/** In-memory SlotRegistry: the members M5 uses plus its own ledger. */
class FakeSlots {
  /** Slot keys declared to this instance (the host declares on first render). */
  readonly declared = new Set<string>(['settings.section'])
  /** Live registrations, in registration order. */
  readonly registrations: FakeRegistration[] = []
  /** Every inject() key, whether it fired or waited. */
  readonly injectedKeys: string[] = []
  /** When set, register() throws it (a peer already owns the id, D3). */
  failRegister: Error | null = null

  inject(key: string, callback: () => (() => void) | void): () => void {
    this.injectedKeys.push(key)
    // The runtime runs the callback SYNCHRONOUSLY when the slot is declared.
    if (!this.declared.has(key)) return () => {}
    const release = callback()
    return () => { release?.() }
  }

  register(options: FakeSectionOptions, component: unknown): () => void {
    if (this.failRegister) throw this.failRegister
    if (!this.declared.has(options.name)) {
      throw new Error('slot "' + options.name + '" is not declared')
    }
    const entry: FakeRegistration = { name: options.name, options, component }
    this.registrations.push(entry)
    return () => {
      const index = this.registrations.indexOf(entry)
      if (index >= 0) this.registrations.splice(index, 1)
    }
  }
}

/** In-memory LocaleRuntime: registration plus the namespace binding. */
class FakeLocale {
  /** Live dictionaries by namespace. */
  readonly namespaces = new Map<string, Record<string, Record<string, string>>>()

  bind(ns: string): (key: string) => string {
    // Resolved at CALL time, like the real binding: the section binds before
    // the dictionaries register and must still see them once they do.
    return (key: string) => this.namespaces.get(ns)?.zh?.[key] ?? key
  }

  register(ns: string, dicts: Record<string, Record<string, string>>): () => void {
    this.namespaces.set(ns, dicts)
    return () => {
      if (this.namespaces.get(ns) === dicts) this.namespaces.delete(ns)
    }
  }
}

/** The theme runtime slice M5 drives (registration, layers, preference). */
class FakeTheme {
  /** The official preference (may hold a moonset-* id in memory). */
  preference = 'system'
  /** Every setTheme argument, in order. */
  readonly setThemeCalls: string[] = []
  /** Layer sources currently stacked. */
  readonly layers: string[] = []

  register(): () => void {
    return () => {}
  }

  overrideTokens(source: string): () => void {
    this.layers.push(source)
    return () => {
      const index = this.layers.indexOf(source)
      if (index >= 0) this.layers.splice(index, 1)
    }
  }

  getTheme(): { preference: string } {
    return { preference: this.preference }
  }

  setTheme(id: string): void {
    this.setThemeCalls.push(id)
    this.preference = id
  }
}

/** What one fake context hands a test. */
interface Harness {
  readonly ctx: ClientContext
  readonly theme: FakeTheme
  readonly slots: FakeSlots
  readonly locale: FakeLocale
  /** Every ctx.effect disposer, in registration order. */
  readonly disposers: (() => void)[]
  /** Effect labels, in registration order. */
  readonly effectLabels: string[]
  /** Dependency lists passed to ctx.inject. */
  readonly injections: string[][]
  /** Entry ids requested from configForms.get. */
  readonly requestedEntries: string[]
}

/**
 * Build a client context over the fakes.
 * @param options - a missing forms means "this host serves no configForms".
 * @returns the context plus its scratch records.
 */
function makeContext(options: { forms?: FakeForm } = {}): Harness {
  const theme = new FakeTheme()
  const slots = new FakeSlots()
  const locale = new FakeLocale()
  const disposers: (() => void)[] = []
  const effectLabels: string[] = []
  const injections: string[][] = []
  const requestedEntries: string[] = []

  const context = {
    theme,
    slots,
    locale,
    effect(execute: () => (() => void) | void, label?: string) {
      effectLabels.push(label ?? '')
      const dispose = execute()
      const release = () => { dispose?.() }
      disposers.push(release)
      return release
    },
    inject(deps: string[], callback: (formsCtx: unknown) => (() => void) | void) {
      injections.push([...deps])
      const forms = options.forms
      if (forms === undefined) return undefined
      const dispose = callback({
        configForms: {
          get: (entryId: string) => {
            requestedEntries.push(entryId)
            return forms
          },
        },
      })
      return { dispose: async () => { dispose?.() } }
    },
  }

  return {
    ctx: context as unknown as ClientContext,
    theme,
    slots,
    locale,
    disposers,
    effectLabels,
    injections,
    requestedEntries,
  }
}

/** The injected face of the (single) section registration in a harness. */
interface InjectedSection {
  choice: string
  onPick: (choice: string) => void
  labels: {
    title: string
    description: string
    options: { value: string; label: string }[]
  }
}

/**
 * Read the injected face of the section registration.
 * @param harness - the applied harness.
 * @returns the face the component receives.
 */
function sectionFace(harness: Harness): InjectedSection {
  const [entry] = harness.slots.registrations
  if (entry === undefined) throw new Error('the section was not registered')
  const inject = entry.options.inject
  if (typeof inject !== 'function') throw new Error('the section registered no inject face')
  return inject() as unknown as InjectedSection
}

/** Recording ChoiceDeps over a fake preference, with a call log. */
function makeDeps(startPreference = 'system'): {
  deps: ChoiceDeps
  calls: string[]
  setTheme: (id: string) => void
  enable: () => void
  disable: () => void
  preference: () => string
} {
  const calls: string[] = []
  const setThemeCalls: string[] = []
  let preference = startPreference
  const setTheme = (id: string): void => {
    calls.push('setTheme:' + id)
    setThemeCalls.push(id)
  }
  const enable = (): void => { calls.push('enable') }
  const disable = (): void => { calls.push('disable') }
  return {
    deps: {
      setTheme: (id: string) => {
        setTheme(id)
        preference = id
      },
      preference: () => preference,
      follow: { enable, disable },
    },
    calls,
    setTheme,
    enable,
    disable,
    preference: () => preference,
  }
}

describe('resolveChoice — one narrow point for a document value', () => {
  it('narrows unknown, empty and dirty values to off and keeps the four choices', () => {
    for (const raw of [undefined, null, '', ' ', 'dark ', 'Dark', 'moonset-dark', 'OFF', 0, false, {}, [], 1.5]) {
      expect(resolveChoice(raw)).toBe('off')
    }
    // The valid values are the schema's union, and round-trip untouched.
    expect(MOONSET_CHOICES).toEqual(['off', 'light', 'dark', 'follow'])
    for (const choice of MOONSET_CHOICES) expect(resolveChoice(choice)).toBe(choice)
    // The section offers three of them, in display order (off is the absence
    // of a choice, not a button — see choice.ts).
    expect(MOONSET_SECTION_OPTIONS.map((option) => option.value)).toEqual(['light', 'dark', 'follow'])
  })
})

describe('applyChoice — the pure apply step (D4)', () => {
  it('applies light and dark by releasing the follow layer first', () => {
    const light = makeDeps()
    applyChoice('light', light.deps)
    expect(light.calls).toEqual(['disable', 'setTheme:moonset-light'])
    expect(light.calls).not.toContain('enable')
    expect(light.preference()).toBe('moonset-light')

    const dark = makeDeps()
    applyChoice('dark', dark.deps)
    expect(dark.calls).toEqual(['disable', 'setTheme:moonset-dark'])
    expect(dark.calls).not.toContain('enable')
    expect(dark.preference()).toBe('moonset-dark')
  })

  it('follow ends on the system preference and stacks the layer once', () => {
    // The common path: the user was on one of our themes, so the memory
    // preference holds a third-party id that has to go back to system first.
    const fromTheme = makeDeps('moonset-dark')
    applyChoice('follow', fromTheme.deps)
    expect(fromTheme.calls).toEqual(['setTheme:system', 'enable'])
    expect(fromTheme.preference()).toBe('system')

    // An official light/dark preference pins the scheme, so choosing "follow"
    // has to reset it too — otherwise the OS half of the layer never activates.
    const fromOfficial = makeDeps('light')
    applyChoice('follow', fromOfficial.deps)
    expect(fromOfficial.calls).toEqual(['setTheme:system', 'enable'])
    expect(fromOfficial.preference()).toBe('system')

    // Already on system: no document write, just the layer.
    const alreadySystem = makeDeps('system')
    applyChoice('follow', alreadySystem.deps)
    expect(alreadySystem.calls).toEqual(['enable'])
    expect(alreadySystem.preference()).toBe('system')
  })

  it('off returns to the official theme without enabling the layer', () => {
    const off = makeDeps('moonset-light')
    applyChoice('off', off.deps)
    expect(off.calls).toEqual(['disable', 'setTheme:system'])
    expect(off.calls).not.toContain('enable')
    expect(off.preference()).toBe('system')
  })
})

describe('apply — the settings section (M5)', () => {
  it('registers settings.section with the moonset identity and three options', () => {
    const harness = makeContext()
    apply(harness.ctx)

    expect(harness.slots.injectedKeys).toEqual(['settings.section'])
    expect(harness.slots.registrations).toHaveLength(1)
    const [entry] = harness.slots.registrations
    const options = entry.options

    expect(options.name).toBe('settings.section')
    expect(typeof options.id).toBe('string')
    expect(String(options.id).startsWith('moonset')).toBe(true)
    expect(typeof options.order).toBe('number')
    expect(options.locale).toBe(MOONSET_LOCALE_NS)
    expect(MOONSET_LOCALE_NS).toBe('settings.moonset')

    // The label is a thunk: a language switch re-renders the nav row without
    // re-registering (the runtime resolves it per read).
    expect(typeof options.label).toBe('function')
    expect((options.label as () => string)()).toBe(zh['section.title'])

    // Three buttons, counted off the dictionaries rather than a magic number.
    const optionKeys = Object.keys(zh).filter((key) => key.startsWith('option.'))
    expect(optionKeys).toHaveLength(3)
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(zh['section.title'].length).toBeGreaterThan(0)
    expect(zh['section.description'].length).toBeGreaterThan(0)
    expect(en['section.title'].length).toBeGreaterThan(0)

    expect(typeof entry.component).toBe('function')
    const face = sectionFace(harness)
    expect(face.labels.options).toHaveLength(optionKeys.length)
    expect(face.labels.options.map((option) => option.value)).toEqual(['light', 'dark', 'follow'])
    expect(face.labels.options.map((option) => option.label)).toEqual([
      zh['option.light'],
      zh['option.dark'],
      zh['option.follow'],
    ])
    expect(face.labels.title).toBe(zh['section.title'])
    expect(face.labels.description).toBe(zh['section.description'])
    // Nothing stored yet: the section renders the fallback, never a guess.
    expect(face.choice).toBe('off')
  })

  it('registers the settings.moonset dictionaries for both built-in locales', () => {
    const harness = makeContext()
    apply(harness.ctx)

    expect([...harness.locale.namespaces.keys()]).toEqual(['settings.moonset'])
    const dicts = harness.locale.namespaces.get(MOONSET_LOCALE_NS)
    expect(dicts?.zh).toBe(zh)
    expect(dicts?.en).toBe(en)
    expect(Object.keys(zh).length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(en)).toHaveLength(Object.keys(zh).length)
  })

  it('persists a pick and applies it once, through the injected face', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      // Two stores, ONE entry: the theme choice and the M2 glow settings are
      // separate facades over the same projected form, so the entry id is
      // requested once per store.
      expect(harness.requestedEntries).toEqual([MOONSET_ENTRY_ID, MOONSET_ENTRY_ID])
      expect(MOONSET_ENTRY_ID).toBe('dsh-moonset')

      const face = sectionFace(harness)
      face.onPick('dark')
      // The pick is an intent: applied now, persisted when the window closes.
      expect(form.sets).toEqual([])
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
      expect(harness.theme.setThemeCalls).toEqual(['moonset-dark'])

      await Promise.resolve()
      expect(sectionFace(harness).choice).toBe('dark')

      // The follow pick drives the layer and leaves the preference on system.
      sectionFace(harness).onPick('follow')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toHaveLength(2)
      expect(form.sets[1]).toEqual({ field: 'choice', value: 'follow' })
      expect(harness.theme.setThemeCalls).toEqual(['moonset-dark', 'system'])
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a peer-owned section id instead of failing the boot (D3)', () => {
    const harness = makeContext()
    harness.slots.failRegister = new Error('list slot "settings.section" already has an entry with id "moonset"')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(() => { apply(harness.ctx) }).not.toThrow()
      expect(harness.slots.registrations).toEqual([])
      // "Already owned" is the expected outcome in a duplicate install, so the
      // tolerant wrapper stays quiet about it.
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('restores a stored choice on boot, and leaves a stored off alone', () => {
    const stored = makeContext({ forms: new FakeForm({ choice: 'dark' }) })
    apply(stored.ctx)
    expect(stored.theme.setThemeCalls).toEqual(['moonset-dark'])
    expect(stored.theme.getTheme().preference).toBe('moonset-dark')
    expect(stored.theme.layers).toEqual([])

    // off means "no choice made": re-applying it would overwrite the user's
    // official preference with system on every single boot.
    const untouched = makeContext({ forms: new FakeForm({}) })
    apply(untouched.ctx)
    expect(untouched.theme.setThemeCalls).toEqual([])
    expect(untouched.theme.layers).toEqual([])

    // A stored follow choice stacks the layer without writing the preference.
    const following = makeContext({ forms: new FakeForm({ choice: 'follow' }) })
    apply(following.ctx)
    expect(following.theme.setThemeCalls).toEqual([])
    expect(following.theme.layers).toEqual(['dsh-moonset'])
  })
})

describe('createDurableChoice — the plugin durable store (M5)', () => {
  it('writes the choice once, counts it, and reads the same value back', async () => {
    // M5.1 changes WHEN the write happens (300 ms queue), not what it is: the
    // assertions below are the M5 ones, observed after the window closes.
    vi.useFakeTimers()
    const form = new FakeForm({ choice: 'off' })
    const harness = makeContext({ forms: form })
    const durable = createDurableChoice(harness.ctx)
    const seen: string[] = []
    const unsubscribe = durable.subscribe(() => { seen.push(durable.read()) })

    try {
      expect(durable.read()).toBe('off')
      expect(harness.injections).toEqual([['configForms']])
      expect(harness.requestedEntries).toEqual([MOONSET_ENTRY_ID])

      durable.write('dark')
      // Queued, not written: no leading write, and the counter agrees.
      expect(durable.writes).toBe(0)
      expect(form.sets).toEqual([])
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(durable.writes).toBe(1)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
      await Promise.resolve()
      expect(durable.read()).toBe('dark')
      expect(seen).toEqual(['dark'])
      // The echo is the form's own change notification; M5.1's guard is what
      // keeps it from counting as another write.
      expect(durable.writes).toBe(1)
    } finally {
      unsubscribe()
      durable.dispose()
      vi.useRealTimers()
    }
  })

  it('reads off and warns instead of throwing when the host serves no configForms', () => {
    const harness = makeContext()
    const durable = createDurableChoice(harness.ctx)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(durable.read()).toBe('off')
      expect(() => { durable.write('follow') }).not.toThrow()
      expect(durable.writes).toBe(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('[dsh-moonset]')
      expect(String(warn.mock.calls[0][0])).toContain('not persisted')
      expect(durable.read()).toBe('off')
    } finally {
      warn.mockRestore()
      durable.dispose()
    }
  })

  it('swallows a rejected transport write instead of leaking an unhandled rejection', async () => {
    vi.useFakeTimers()
    const form = new FakeForm({ choice: 'off' })
    form.failWith = new Error('settings transport is gone')
    const harness = makeContext({ forms: form })
    const durable = createDurableChoice(harness.ctx)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      durable.write('light')
      // Queued: the failure can only surface when the write actually goes out.
      expect(durable.writes).toBe(0)
      expect(warn).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(durable.writes).toBe(1)
      await Promise.resolve()
      await Promise.resolve()
      // One failure, one warning — the queue must not amplify it either.
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('settings write failed')
      // The store keeps the last accepted value; nothing was reverted locally.
      expect(durable.read()).toBe('off')
    } finally {
      warn.mockRestore()
      durable.dispose()
      vi.useRealTimers()
    }
  })
})

describe('unload — the fiber disposers take everything down (M5)', () => {
  it('unregisters the section and the dictionaries and releases the layer', () => {
    const form = new FakeForm({ choice: 'follow' })
    const harness = makeContext({ forms: form })
    apply(harness.ctx)

    expect(harness.slots.registrations).toHaveLength(1)
    expect(harness.locale.namespaces.size).toBe(1)
    expect(harness.theme.layers).toEqual(['dsh-moonset'])

    for (const dispose of harness.disposers) dispose()

    expect(harness.slots.registrations).toEqual([])
    expect(harness.locale.namespaces.size).toBe(0)
    expect(harness.theme.layers).toEqual([])
    // Teardown never writes: the unload path is not a user change.
    expect(form.sets).toEqual([])
    // Releasing twice is a no-op, not a second cascade.
    expect(() => { for (const dispose of harness.disposers) dispose() }).not.toThrow()
    expect(harness.slots.registrations).toEqual([])
    expect(harness.locale.namespaces.size).toBe(0)
  })

  it('owns exactly the theme registration, the skin sheet and the three M5 effects', () => {
    const harness = makeContext()
    apply(harness.ctx)
    expect(harness.effectLabels).toEqual([
      'moonset: light/dark theme registrations',
      // 0.1.1: the skin's own effect, entered right after the registrations so
      // the sheet lives exactly as long as its plugin (P2).
      'moonset: skin sheet',
      'moonset: settings dictionaries',
      'moonset: settings choice',
      'moonset: settings section',
    ])
  })
})

describe('host settings contract — the Config the form is projected from', () => {
  it('declares one volatile choice field defaulting to off, and the same entry id', () => {
    // The host half cannot be imported by the client (it pulls schemastery), so
    // the entry id and the choice union are restated once on each side; these
    // assertions are what keeps the two copies honest.
    expect(MOONSET_ENTRY_ID).toBe(HOST_ENTRY_ID)
    expect(HOST_ENTRY_ID).toBe('dsh-moonset')

    const field = (Config as unknown as {
      dict: Record<string, {
        meta?: Record<string, unknown>
        list?: { value?: unknown }[]
      }>
    }).dict.choice
    expect(field).toBeDefined()
    expect(field.meta).toMatchObject({ default: 'off', volatile: true })

    // The union's accepted constants, read off the schema rather than restated:
    // a drifted host union would make the client's stored values unreadable.
    const values = (field.list ?? []).map((entry) => entry.value)
    expect(new Set(values)).toEqual(new Set(MOONSET_CHOICES))
  })

  it('declares the three M2 glow fields, volatile, with the shipped defaults', () => {
    // Same reasoning as the choice: checked against the schema's own AST, so a
    // host-side default drifting from the client's constants turns red here
    // instead of showing up as an unexpected first paint.
    const dict = (Config as unknown as {
      dict: Record<string, {
        meta?: Record<string, unknown>
        list?: { value?: unknown }[]
      }>
    }).dict

    expect(dict.glow.meta).toMatchObject({ default: true, volatile: true })
    expect(dict.glowScope.meta).toMatchObject({ default: DEFAULT_GLOW_SCOPE, volatile: true })
    // M6: the hue and the strength each carry a light and a dark field, with the
    // user's final per-scheme defaults (浅色 柔和 @90 / 深色 夜空蓝 @100).
    expect(dict.glowHueLight.meta).toMatchObject({ default: DEFAULT_GLOW_HUE_LIGHT, volatile: true })
    expect(dict.glowStrengthLight.meta).toMatchObject({
      default: DEFAULT_GLOW_STRENGTH_LIGHT,
      volatile: true,
    })
    expect(dict.glowHueDark.meta).toMatchObject({ default: DEFAULT_GLOW_HUE_DARK, volatile: true })
    expect(dict.glowStrengthDark.meta).toMatchObject({
      default: DEFAULT_GLOW_STRENGTH_DARK,
      volatile: true,
    })
    // 0.1.4 M1: the material's two fields are volatile too (same form, same
    // projection), and their defaults are the shipped ones: 玻璃默认开、12px.
    expect(dict.glass.meta).toMatchObject({ default: DEFAULT_GLASS, volatile: true })
    // ...and the slider's own bounds are the resolver's: the host restates the
    // numbers (it cannot import the client half), so this is the cross-check
    // that a moved ceiling cannot ship as a form that accepts what the skin
    // clamps.
    expect(dict.glassBlur.meta).toMatchObject({
      min: GLASS_BLUR_MIN,
      max: GLASS_BLUR_MAX,
      default: DEFAULT_GLASS_BLUR,
      volatile: true,
    })

    // The unions are the client's lists, in the same order: a document value
    // the client cannot read is exactly what this check prevents.
    expect((dict.glowScope.list ?? []).map((entry) => entry.value)).toEqual([...GLOW_SCOPES])
    expect((dict.glowHueLight.list ?? []).map((entry) => entry.value)).toEqual([...GLOW_HUES])
    expect((dict.glowHueDark.list ?? []).map((entry) => entry.value)).toEqual([...GLOW_HUES])
    // The two M4 hues the user found redundant are gone from the schema too.
    for (const removed of ['accentDark', 'accentSoftDark']) {
      expect((dict.glowHueLight.list ?? []).map((entry) => entry.value)).not.toContain(removed)
      expect((dict.glowHueDark.list ?? []).map((entry) => entry.value)).not.toContain(removed)
    }
  })
})

// ── M2/M6: the glow settings store ──────────────────────────────────────────

describe('createDurableGlow — the glow store (地面范围 / 开关 / 深浅两套色相+强度)', () => {
  /**
   * The defaults, spelled once so every assertion derives from them.
   *
   * 0.1.4 M1: the store also answers the material's two fields — same durable,
   * same flush; they are a separate switch from the ground, which is why the
   * flush below still writes only the fields a patch names.
   */
  const DEFAULTS = {
    glow: true,
    scope: DEFAULT_GLOW_SCOPE,
    hueLight: DEFAULT_GLOW_HUE_LIGHT,
    strengthLight: DEFAULT_GLOW_STRENGTH_LIGHT,
    hueDark: DEFAULT_GLOW_HUE_DARK,
    strengthDark: DEFAULT_GLOW_STRENGTH_DARK,
    glass: DEFAULT_GLASS,
    glassBlur: DEFAULT_GLASS_BLUR,
  }

  it('answers the shipped defaults before any form has spoken', () => {
    const harness = makeContext()
    const glow = createDurableGlow(harness.ctx)
    // M6's defaults: 浅色 柔和 @90, 深色 夜空蓝 @100.
    expect(glow.read()).toEqual(DEFAULTS)
    // A host with no form still lets the session switch: the value is answered
    // locally (it just cannot be persisted), and the failure is a WARNING at the
    // flush — never a throw, and never a diary of every pointer move.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      glow.write({ scope: 'conversation' })
      expect(glow.read().scope).toBe('conversation')
      expect(warn).not.toHaveBeenCalled()
      expect(() => { glow.dispose() }).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
      glow.dispose()
    }
  })

  it('reads a document that already carries the M6 fields and the M1 material', () => {
    const form = new FakeForm({
      glow: false,
      glowScope: 'main',
      glowHueLight: 'night',
      glowStrengthLight: 40,
      glowHueDark: 'accent',
      glowStrengthDark: 150,
      // 0.1.4 M1: the material's own pair, read from the same document.
      glass: false,
      glassBlur: 4,
    })
    const harness = makeContext({ forms: form })
    const glow = createDurableGlow(harness.ctx)
    try {
      expect(glow.read()).toEqual({
        glow: false,
        scope: 'main',
        hueLight: 'night',
        strengthLight: 40,
        hueDark: 'accent',
        strengthDark: 150,
        glass: false,
        glassBlur: 4,
      })
    } finally {
      glow.dispose()
    }
  })

  it('writes each field ONCE per burst, after the 300 ms window', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      const glow = createDurableGlow(harness.ctx)
      glow.write({ scope: 'conversation' })
      glow.write({ strengthLight: 10 })
      glow.write({ strengthLight: 180 })
      // The local answer is immediate (the sheet follows at 150 ms, the write at
      // 300 ms), and nothing has reached the document yet.
      expect(glow.read()).toEqual({ ...DEFAULTS, scope: 'conversation', strengthLight: 180 })
      expect(form.sets).toEqual([])
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([
        { field: 'glowScope', value: 'conversation' },
        { field: 'glowStrengthLight', value: 180 },
      ])
      // The echo confirms what was already answered.
      await Promise.resolve()
      expect(glow.read()).toEqual({ ...DEFAULTS, scope: 'conversation', strengthLight: 180 })
      expect(glow.writes).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lands the two schemes independently: four fields in one flush', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      const glow = createDurableGlow(harness.ctx)
      glow.write({ hueLight: 'night', strengthLight: 70 })
      glow.write({ hueDark: 'accent', strengthDark: 200 })
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([
        { field: 'glowHueLight', value: 'night' },
        { field: 'glowStrengthLight', value: 70 },
        { field: 'glowHueDark', value: 'accent' },
        { field: 'glowStrengthDark', value: 200 },
      ])
      expect(glow.read()).toEqual({
        glow: true,
        scope: DEFAULT_GLOW_SCOPE,
        hueLight: 'night',
        strengthLight: 70,
        hueDark: 'accent',
        strengthDark: 200,
        glass: DEFAULT_GLASS,
        glassBlur: DEFAULT_GLASS_BLUR,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('narrows a removed or unknown hue to that scheme default', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      const glow = createDurableGlow(harness.ctx)
      // M4's removed variants must never reach the document again.
      glow.write({ hueLight: 'accentSoftDark' as unknown as 'soft' })
      glow.write({ hueDark: 'nightBlue' as unknown as 'night' })
      expect(glow.read().hueLight).toBe(DEFAULT_GLOW_HUE_LIGHT)
      expect(glow.read().hueDark).toBe(DEFAULT_GLOW_HUE_DARK)
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([
        { field: 'glowHueLight', value: DEFAULT_GLOW_HUE_LIGHT },
        { field: 'glowHueDark', value: DEFAULT_GLOW_HUE_DARK },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back per scheme when the document carries only one side', () => {
    // A half-edited document (an older build, a partial write) must not drag the
    // OTHER scheme to the light default: each field answers its own scheme.
    const form = new FakeForm({ glowHueLight: 'night', glowStrengthLight: 30 })
    const harness = makeContext({ forms: form })
    const glow = createDurableGlow(harness.ctx)
    try {
      const read = glow.read()
      expect(read.hueLight).toBe('night')
      expect(read.strengthLight).toBe(30)
      // ...and the dark side keeps ITS defaults (夜空蓝 @100), not the light ones.
      expect(read.hueDark).toBe(DEFAULT_GLOW_HUE_DARK)
      expect(read.strengthDark).toBe(DEFAULT_GLOW_STRENGTH_DARK)
      expect(read.scope).toBe(DEFAULT_GLOW_SCOPE)
    } finally {
      glow.dispose()
    }
  })

  it('lands a pending change on dispose, so an unload cannot swallow an edit', () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      const glow = createDurableGlow(harness.ctx)
      glow.write({ scope: 'all' })
      expect(form.sets).toEqual([])
      glow.dispose()
      expect(form.sets).toEqual([{ field: 'glowScope', value: 'all' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('adopts a change another window wrote, and stops after the release', async () => {
    const form = new FakeForm({})
    const harness = makeContext({ forms: form })
    const glow = createDurableGlow(harness.ctx)
    try {
      const seen: string[] = []
      const release = glow.subscribe(() => { seen.push(glow.read().scope) })
      await form.set('glowScope', 'conversation')
      expect(glow.read().scope).toBe('conversation')
      expect(seen).toEqual(['conversation'])
      release()
      await form.set('glowScope', 'main')
      expect(seen).toEqual(['conversation'])
    } finally {
      glow.dispose()
    }
  })

  it("lands the material's two fields in one flush, once per burst", async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      const glow = createDurableGlow(harness.ctx)
      glow.write({ glass: false })
      glow.write({ glassBlur: 6 })
      glow.write({ glassBlur: 26 })
      // Optimistic: the read answers the last value before anything lands.
      expect(glow.read().glass).toBe(false)
      expect(glow.read().glassBlur).toBe(26)
      expect(form.sets).toEqual([])
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      // One write per FIELD, in panel order, and no ground field is touched:
      // the material is its own switch on the same form.
      expect(form.sets).toEqual([
        { field: 'glass', value: false },
        { field: 'glassBlur', value: 26 },
      ])
      expect(glow.writes).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("narrows a dirty radius into the slider's range and keeps an absent one at 12", () => {
    // A hand-edited or older document cannot push the blur outside the range
    // the control writes, and an absent field is the shipped default — never
    // 0, which would silently turn the material into a flat wash.
    const carried = createDurableGlow(makeContext({ forms: new FakeForm({ glassBlur: 999 }) }).ctx)
    try {
      expect(carried.read().glassBlur).toBe(GLASS_BLUR_MAX)
      // The switch itself: absent means ON (玻璃默认开).
      expect(carried.read().glass).toBe(DEFAULT_GLASS)
    } finally {
      carried.dispose()
    }
    const empty = createDurableGlow(makeContext({ forms: new FakeForm({}) }).ctx)
    try {
      expect(empty.read().glass).toBe(true)
      expect(empty.read().glassBlur).toBe(12)
      expect(DEFAULT_GLASS_BLUR).toBe(12)
    } finally {
      empty.dispose()
    }
  })
})
