import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  MOONSET_CHOICES,
  OFFICIAL_THEME_PICKS,
  isOfficialThemePreference,
  shouldMirrorOfficialPick,
} from '../src/client/choice'
import { RESTORE_WINDOW_MS, WRITE_DEBOUNCE_MS, createDurableChoice } from '../src/client/durable'
import { REASSERT_LIMIT, apply } from '../src/client/index'

/**
 * M5.1 contract: the echo race, the fast-switch queue, and the official-pick
 * mirror.
 *
 * Every assertion here is behavioural — it goes through `apply()` and the
 * injected section face, never through the durable module's internals — because
 * what M5.1 promises is a visible outcome:
 *
 *  1. a late snapshot cannot revert a newer local pick (and cannot replay it);
 *  2. three clicks inside one burst are ONE settings write of the last value;
 *  3. unloading lands a still-queued intent instead of dropping it;
 *  4. an official light/dark/system pick is mirrored to `off` and releases the
 *     follow layer, while our own `setTheme('moonset-*')` is never mistaken for
 *     one;
 *  5. an echo equal to the local choice writes nothing and re-applies nothing;
 *  6. (M5.2) a write echo that reverts the runtime preference to a BUILT-IN
 *     value is answered by a deferred re-assert, while an official pick made
 *     outside the local-write window is still mirrored to `off`.
 *
 * The theme fake publishes `theme/change` synchronously from `setTheme` and
 * from `overrideTokens` / its disposer, which is what the installed runtime
 * does (PLAN 九、已决 #5); the re-entrancy that creates is part of what these
 * cases exercise, not a simplification.
 *
 * The fake ALSO models the official runtime's `adopt()` (M5.2). The runtime's
 * constructor subscribes to its own settings scope —
 * `ctx.effect(() => host.subscribe(() => this.adopt()))`,
 * `@deepseek-ai/dsh-client-ui-theme/lib/client.js:1681` — and `adopt()`
 * overwrites the MEMORY preference with the document's `preference`, which the
 * Host's schema narrows to `system` / `light` / `dark`. Every accepted
 * settings write re-derives every scope form, so a write to OUR section runs
 * `adopt()` too and clobbers a third-party id. Without this layer the old
 * suite could not see the bug at all — which is why the fake grows it here.
 */

/** The two fields the official runtime adopts out of its own settings scope. */
interface ThemeDocumentValue {
  /** A built-in preference: the Host's schema never stores a third-party id. */
  readonly preference: string
  /** The font state `adopt()` copies alongside the preference. */
  readonly fontScale: string
}

/**
 * The Host settings document the theme plugin OWNS (`preference` + the font
 * choices `adopt()` also copies).
 *
 * One document serves the whole client: our entry form and the theme plugin's
 * own scope are two views over it, which is why a write to OUR section wakes
 * ITS subscription (M5.2).
 */
class FakeThemeDocument {
  /** The accepted document value. */
  value: ThemeDocumentValue = { preference: 'system', fontScale: 'base' }
  /** Monotonic revision of the document. */
  revision = 0
  private readonly listeners = new Set<() => void>()

  getSnapshot(): { value: ThemeDocumentValue; revision: number } {
    return { value: this.value, revision: this.revision }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The official Appearance row's write: the document moves, nobody is told yet. */
  setPreference(preference: string): void {
    this.value = { ...this.value, preference }
    this.revision += 1
  }

  /**
   * The Host's broadcast after ANY accepted settings write, ours included:
   * `settings/document-updated` → describe → every scope form re-derives →
   * `host.subscribe` runs. This is the notification `adopt()` rides.
   * @param patch - fields the same update also changes.
   */
  touch(patch: Partial<ThemeDocumentValue> = {}): void {
    this.value = { ...this.value, ...patch }
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
  }
}

/** One in-memory SettingsForm, the shape `configForms.get` hands back. */
class FakeForm {
  /** Current accepted section. */
  section: Record<string, unknown>
  /** Monotonic revision, or an explicitly older one for a replayed echo. */
  revision: number
  /** Every set call, in order. */
  readonly sets: { field: string; value: unknown }[] = []
  /** Whether a commit publishes its echo synchronously (the Host does, but not always within the same tick). */
  echoOnSet = true
  /**
   * The client's one settings document, shared with the theme plugin's scope.
   * {@link makeContext} wires it; a commit to this form bumps it (M5.2).
   */
  document: FakeThemeDocument | undefined
  private readonly listeners = new Set<() => void>()

  constructor(section: Record<string, unknown> = {}, revision = 1) {
    this.section = section
    this.revision = revision
  }

  getSnapshot(): {
    status: 'ready'
    value: Record<string, unknown>
    user: Record<string, unknown>
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
    this.section = { ...this.section, [field]: value }
    this.revision += 1
    // The commit publishes its own echo, like the Host's accepted section does
    // — unless this test keeps the commit in flight (echoOnSet = false).
    if (this.echoOnSet) this.deliver(this.section, this.revision)
    // ...and the document broadcast follows either way. This is the half that
    // runs the theme runtime's adopt() over a write to OUR namespace (M5.2).
    this.document?.touch()
    return true
  }

  /**
   * Deliver a document echo — including a REPLAYED one, which is why the
   * revision is an argument: a late echo carries the revision it was made at,
   * not the one the document is on now.
   */
  deliver(section: Record<string, unknown>, revision: number): void {
    this.section = section
    this.revision = revision
    for (const listener of [...this.listeners]) listener()
  }
}

/** The `theme/change` payload the mirror rule reads. */
interface ThemeChangeLike {
  readonly preference: string
  readonly revision: number
}

/** The theme runtime slice M4 + M5.1 + M5.2 drive. */
class FakeTheme {
  /** The official preference (may hold a moonset-* id in memory). */
  preference = 'system'
  /** Every setTheme argument, in order. */
  readonly setThemeCalls: string[] = []
  /** Registered theme ids. */
  readonly registered: string[] = []
  /** Layer sources currently stacked. */
  readonly layers: string[] = []
  /** Every published snapshot, in order. */
  readonly publishes: ThemeChangeLike[] = []
  /**
   * What `adopt()` overwrote the memory preference WITH, one entry per
   * adoption that actually changed it: the evidence that the echo happened
   * before the re-assert answered it (M5.2).
   */
  readonly adoptOverwrites: string[] = []
  /** The theme's adopted font state — the real `adopt()` copies this too. */
  fontScale = 'base'
  /** This runtime's OWN settings scope, the document it adopts from. */
  readonly document: FakeThemeDocument
  private readonly listeners = new Set<(snapshot: ThemeChangeLike) => void>()
  private seq = 0

  constructor(document = new FakeThemeDocument()) {
    this.document = document
    // Exactly the official runtime's constructor (client.js:1681): the scope
    // subscription is installed WITH the runtime, not by its owner, so it is
    // live before any settings section exists.
    this.document.subscribe(() => { this.adopt() })
  }

  /**
   * The official `adopt()` (client.js:1787): copy the document's durable
   * preference (and font state) into memory, publishing only when something
   * moved. It runs on EVERY settings write, so a write to our own section is
   * enough to clobber a third-party preference — the M5.2 bug.
   */
  adopt(): void {
    const section = this.document.getSnapshot().value
    if (this.preference === section.preference && this.fontScale === section.fontScale) return
    this.adoptOverwrites.push(section.preference)
    this.preference = section.preference
    this.fontScale = section.fontScale
    this.publish()
  }

  /** `ctx.on` ends up here: one listener set for `theme/change`. */
  on(name: string, listener: (snapshot: ThemeChangeLike) => void): () => void {
    if (name !== 'theme/change') return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** How many `theme/change` listeners the plugin currently holds. */
  get listenerCount(): number {
    return this.listeners.size
  }

  /** Publish synchronously, like the runtime's `publish()`. */
  publish(): void {
    this.seq += 1
    const snapshot: ThemeChangeLike = { preference: this.preference, revision: this.seq }
    this.publishes.push(snapshot)
    for (const listener of [...this.listeners]) listener(snapshot)
  }

  register(definition: { id: string }): () => void {
    this.registered.push(definition.id)
    return () => {
      const index = this.registered.indexOf(definition.id)
      if (index >= 0) this.registered.splice(index, 1)
    }
  }

  overrideTokens(source: string, _tokens?: unknown): () => void {
    this.layers.push(source)
    // The real runtime publishes from overrideTokens itself (已决 #5).
    this.publish()
    return () => {
      const index = this.layers.indexOf(source)
      if (index >= 0) this.layers.splice(index, 1)
      // ... and from the layer's disposer, which is the re-entrant half.
      this.publish()
    }
  }

  getTheme(): { preference: string } {
    return { preference: this.preference }
  }

  setTheme(id: string): void {
    this.setThemeCalls.push(id)
    this.preference = id
    // Built-in ids are written through the settings scope; a third-party id is
    // memory-only (which is why the plugin keeps its own section at all).
    if (id === 'system' || id === 'light' || id === 'dark') this.document.setPreference(id)
    this.publish()
  }

  /**
   * What the OFFICIAL Appearance row does: the document takes the value and
   * the runtime reflects it — no `setTheme` call of ours involved.
   */
  officialPick(id: string): void {
    this.preference = id
    // The row writes the document too; without that the next adopt() would
    // undo the pick it just made (the fake would invent a bug of its own).
    this.document.setPreference(id)
    this.publish()
  }
}

/** One captured slots.register call. */
interface SectionRegistration {
  readonly name: string
  readonly options: {
    name: string
    id?: string
    order?: number
    label?: string | (() => string)
    locale?: string
    inject?: () => Record<string, unknown>
  }
  readonly component: unknown
}

/** In-memory SlotRegistry: the members M5 uses. */
class FakeSlots {
  readonly declared = new Set<string>(['settings.section'])
  readonly registrations: SectionRegistration[] = []

  inject(key: string, callback: () => (() => void) | void): () => void {
    if (!this.declared.has(key)) return () => {}
    const release = callback()
    return () => { release?.() }
  }

  register(options: SectionRegistration['options'], component: unknown): () => void {
    const entry: SectionRegistration = { name: options.name, options, component }
    this.registrations.push(entry)
    return () => {
      const index = this.registrations.indexOf(entry)
      if (index >= 0) this.registrations.splice(index, 1)
    }
  }
}

/** In-memory LocaleRuntime: registration plus the namespace binding. */
class FakeLocale {
  readonly namespaces = new Map<string, Record<string, Record<string, string>>>()

  bind(ns: string): (key: string) => string {
    return (key: string) => this.namespaces.get(ns)?.zh?.[key] ?? key
  }

  register(ns: string, dicts: Record<string, Record<string, string>>): () => void {
    this.namespaces.set(ns, dicts)
    return () => {
      if (this.namespaces.get(ns) === dicts) this.namespaces.delete(ns)
    }
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
  // ONE settings document for the whole client, like the Host's: the entry
  // form and the theme plugin's own scope are views over it, which is what
  // lets a write to our section wake its adopt() (M5.2).
  if (options.forms !== undefined) options.forms.document = theme.document

  const context = {
    theme,
    slots,
    locale,
    effect(execute: () => (() => void) | void): () => void {
      const dispose = execute()
      const release = (): void => { dispose?.() }
      disposers.push(release)
      return release
    },
    inject(_deps: string[], callback: (formsCtx: unknown) => (() => void) | void) {
      const forms = options.forms
      if (forms === undefined) return undefined
      const dispose = callback({ configForms: { get: () => forms } })
      return { dispose: async () => { dispose?.() } }
    },
    on(name: string, listener: (snapshot: ThemeChangeLike) => void): () => void {
      return theme.on(name, listener)
    },
  }

  return { ctx: context as unknown as ClientContext, theme, slots, locale, disposers }
}

/** The injected face of the (single) section registration in a harness. */
interface InjectedSection {
  choice: string
  onPick: (choice: string) => void
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

/**
 * Unload the plugin exactly the way the loader does: every effect disposer.
 * @param harness - the applied harness.
 */
function unload(harness: Harness): void {
  for (const dispose of harness.disposers) dispose()
}

describe('M5.1 迟到回声 — a late snapshot never reverts a newer local pick', () => {
  it('keeps the local pick when the boot snapshot arrives late, and drops it again below the watermark', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'light' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      // Boot: the document says light, so the section applied it once.
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light'])

      // The user picks dark; the write is still queued (no leading write).
      sectionFace(harness).onPick('dark')
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light', 'moonset-dark'])
      expect(sectionFace(harness).choice).toBe('dark')

      // A snapshot from BEFORE the pick is delivered late.
      form.deliver({ choice: 'light' }, 1)

      // The pick stands: no revert in what the section shows, no replay.
      expect(sectionFace(harness).choice).toBe('dark')
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light', 'moonset-dark'])
      expect(form.sets).toEqual([])

      // It still lands, once, with the local value.
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
      expect(sectionFace(harness).choice).toBe('dark')

      // The same stale snapshot after the write landed: rejected by the
      // revision high-water mark instead (revision 1 < accepted 2).
      form.deliver({ choice: 'light' }, 1)
      expect(sectionFace(harness).choice).toBe('dark')
      // The fake now models adopt() (M5.2): the LANDED write reverted the
      // preference to the document's `system`, and the re-assert put our theme
      // back. That is one deferred call on top of the two explicit applies, and
      // it is the behaviour M5.2 exists for rather than an extra write.
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light', 'moonset-dark', 'moonset-dark'])
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 2)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('adopts an echo that is genuinely newer, so the guard is not a blanket mute', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      sectionFace(harness).onPick('dark')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])

      // Another window changed the section: the revision moved FORWARD, so the
      // echo is authoritative and the section shows it.
      form.deliver({ choice: 'follow' }, form.revision + 1)
      expect(sectionFace(harness).choice).toBe('follow')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('M5.1 快速切换 — one write per burst', () => {
  it('coalesces three clicks inside one burst into a single write of the last value', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      const face = sectionFace(harness)
      face.onPick('light')
      face.onPick('dark')
      face.onPick('follow')
      // The UI reacts per click...
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light', 'moonset-dark', 'system'])
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      // ...but nothing has been persisted yet.
      expect(form.sets).toEqual([])

      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      // Exactly ONE write, carrying the LAST value.
      expect(form.sets).toEqual([{ field: 'choice', value: 'follow' }])

      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 4)
      expect(form.sets).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never writes on the leading edge: zero writes synchronously, exactly one after the window', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      sectionFace(harness).onPick('dark')
      expect(form.sets).toEqual([])

      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS - 1)
      expect(form.sets).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
      expect(form.sets).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not re-send an intent when unload follows the window but the echo is still in flight', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      // A real Host commit is asynchronous: the echo has NOT arrived yet when
      // the plugin unloads below.
      form.echoOnSet = false
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      sectionFace(harness).onPick('dark')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])

      unload(harness)
      // One intent, one write: the unload must not send the same value again.
      expect(form.sets).toHaveLength(1)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes a still-queued intent when the plugin unloads', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      sectionFace(harness).onPick('dark')
      expect(form.sets).toEqual([])

      unload(harness)
      // The unload itself landed the queued intent...
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])

      // ...and exactly once: the cancelled timer cannot fire a second write.
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 4)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
      expect(form.sets).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('M5.1 官方选择镜像 — an official pick is handed back to the official theme', () => {
  it('releases the follow layer and stores off when the user picks the official dark theme', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'follow' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      expect(harness.theme.setThemeCalls).toEqual([])

      // The official Appearance row: the runtime adopts the document value.
      harness.theme.officialPick('dark')

      expect(harness.theme.layers).toEqual([])          // follow layer released
      expect(harness.theme.setThemeCalls).toEqual([])   // never rewrites the preference

      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([{ field: 'choice', value: 'off' }])

      // A second publish of the same official preference mirrors nothing.
      harness.theme.officialPick('dark')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([{ field: 'choice', value: 'off' }])
      expect(form.sets).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('mirrors the official "follow the OS" pick while a concrete Moonset theme is stored', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'light' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light'])

      // Official Appearance → "System": preference becomes system, ours does not.
      harness.theme.officialPick('system')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)

      expect(form.sets).toEqual([{ field: 'choice', value: 'off' }])
      // The mirror must NOT re-write the preference (that is the M5 restore
      // path, and here it would overwrite the pick the user just made).
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light'])
      expect(harness.theme.layers).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves follow alone when theme/change carries the system value follow wrote itself', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'follow' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      expect(harness.theme.setThemeCalls).toEqual([])

      harness.theme.officialPick('system')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 2)

      expect(form.sets).toEqual([])
      expect(harness.theme.layers).toEqual(['dsh-moonset'])   // follow survives
      expect(harness.theme.setThemeCalls).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('never mistakes our own setTheme("moonset-*") publish for an official pick', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'light' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      // The boot restore published plan "moonset-light" synchronously, so the
      // mirror listener really ran on it.
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light'])
      expect(harness.theme.publishes.some((s) => s.preference === 'moonset-light')).toBe(true)

      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 2)
      expect(form.sets).toEqual([])                     // no mirror write

      // Same story for a pick made from OUR section.
      sectionFace(harness).onPick('dark')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([{ field: 'choice', value: 'dark' }])
      expect(harness.theme.layers).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('M5.1 同值回声与卸载 — nothing to write, nothing left behind', () => {
  it('writes nothing and re-applies nothing when the echo matches the local choice', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'dark' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      expect(harness.theme.setThemeCalls).toEqual(['moonset-dark'])
      const publishes = harness.theme.publishes.length

      form.deliver({ choice: 'dark' }, 2)
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 2)

      expect(form.sets).toEqual([])
      expect(harness.theme.setThemeCalls).toEqual(['moonset-dark'])
      // The echo was seen (the store notified), but it triggered no re-apply.
      expect(harness.theme.publishes.length).toBe(publishes)
    } finally {
      vi.useRealTimers()
    }
  })

  it('unloads with zero residue: the theme listener is gone and a later publish writes nothing', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'light' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      expect(harness.theme.listenerCount).toBe(1)

      unload(harness)
      // The question/effect disposer released the subscription (M5.1 硬约束:
      // every subscription is releasable).
      expect(harness.theme.listenerCount).toBe(0)

      const calls = harness.theme.setThemeCalls.length
      harness.theme.officialPick('dark')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 2)

      expect(form.sets).toEqual([])
      expect(harness.theme.setThemeCalls).toHaveLength(calls)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('M5.2 再断言 — a write echo cannot keep our preference down', () => {
  it('re-asserts the picked theme after the echo reverts the preference to system', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      sectionFace(harness).onPick('light')
      expect(harness.theme.preference).toBe('moonset-light')

      // The write lands one window later; the Host broadcast runs adopt(), which
      // overwrites the memory preference with the document's `system`.
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      await Promise.resolve()

      // The revert REALLY happened — and the re-assert answered it, deferred.
      expect(harness.theme.adoptOverwrites).toEqual(['system'])
      expect(harness.theme.publishes.map((snapshot) => snapshot.preference)).toEqual([
        'moonset-light',   // the pick applied
        'system',          // adopt() clobbering it
        'moonset-light',   // the re-assert
      ])
      expect(harness.theme.preference).toBe('moonset-light')
      expect(sectionFace(harness).choice).toBe('light')
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers the re-assert out of the publish stack and merges echoes inside one tick', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      sectionFace(harness).onPick('dark')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      await Promise.resolve()
      expect(harness.theme.preference).toBe('moonset-dark')

      // The pick plus the first echo's re-assert.
      const settled = harness.theme.setThemeCalls.length
      expect(settled).toBe(2)

      // Two echoes inside ONE tick, each carrying a built-in preference exactly
      // as adopt()'s publish does.
      harness.theme.officialPick('system')
      harness.theme.officialPick('system')

      // Nothing ran inside the publish stack: the re-assert is not synchronous.
      expect(harness.theme.setThemeCalls).toHaveLength(settled)

      // ...and one tick produces exactly ONE call, not one per echo.
      await Promise.resolve()
      expect(harness.theme.setThemeCalls.slice(settled)).toEqual(['moonset-dark'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('mirrors an official light pick made OUTSIDE the local-write window, and never re-asserts', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)

      sectionFace(harness).onPick('light')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      await Promise.resolve()
      expect(harness.theme.preference).toBe('moonset-light')
      const afterEcho = harness.theme.setThemeCalls.length
      expect(afterEcho).toBe(2)

      // Past the window there is no echo to answer any more, so a built-in
      // preference can only be the user's own action in Appearance.
      await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS + 1)

      harness.theme.officialPick('light')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      await Promise.resolve()

      // The M5.1 mirror ran: the section hands the UI back to the official theme.
      expect(form.sets).toEqual([
        { field: 'choice', value: 'light' },
        { field: 'choice', value: 'off' },
      ])
      // ...and nothing re-asserted our theme over the user's own pick.
      expect(harness.theme.setThemeCalls).toHaveLength(afterEcho)
      expect(harness.theme.preference).toBe('light')
    } finally {
      vi.useRealTimers()
    }
  })

  it('never re-asserts (nor mirrors) once the stored choice is off', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'light' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      expect(harness.theme.setThemeCalls).toEqual(['moonset-light'])

      // Another window hands the section back to off.
      form.deliver({ choice: 'off' }, form.revision + 1)
      expect(sectionFace(harness).choice).toBe('off')

      const settled = harness.theme.setThemeCalls.length

      // The runtime adopts the document (system) and publishes it.
      harness.theme.document.touch()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)

      expect(harness.theme.setThemeCalls).toHaveLength(settled)
      expect(form.sets).toEqual([])                     // no mirror write either
      expect(harness.theme.preference).toBe('system')   // and no fight over it
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves follow mode alone when adopt() republishes the system it already holds', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'follow' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      expect(harness.theme.setThemeCalls).toEqual([])

      // A document change the theme does not own (another window's font pick):
      // adopt() republishes the SAME system preference.
      harness.theme.document.touch({ fontScale: 'large' })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)

      expect(harness.theme.publishes.some((snapshot) => snapshot.preference === 'system')).toBe(true)
      expect(harness.theme.setThemeCalls).toEqual([])          // no re-assert
      expect(form.sets).toEqual([])                            // no mirror to off
      expect(harness.theme.layers).toEqual(['dsh-moonset'])    // follow survives
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops re-asserting after the cap, warns once, and leaves the official theme in place', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      sectionFace(harness).onPick('light')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      await Promise.resolve()
      // The pick, plus the first echo's re-assert.
      expect(harness.theme.setThemeCalls).toHaveLength(2)

      // One echo per round: the runtime republishes a built-in preference while
      // our local write is still inside the window.
      for (let round = 0; round < 6; round += 1) {
        harness.theme.officialPick('system')
        await Promise.resolve()
      }

      // Three re-asserts, then the plugin stops fighting the echo instead of
      // looping with adopt() forever.
      expect(harness.theme.setThemeCalls).toHaveLength(1 + REASSERT_LIMIT)
      const complaints = warn.mock.calls.filter(([message]) => String(message).includes('re-assert'))
      expect(complaints).toHaveLength(1)
      expect(String(complaints[0]?.[0])).toContain('[dsh-moonset]')
      // The section still stores the pick (the next boot restores it) and the
      // runtime is left on the official value rather than being fought over.
      expect(form.sets).toEqual([{ field: 'choice', value: 'light' }])
      expect(harness.theme.preference).toBe('system')
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('counts a queued intent — not just a landed write — as the last local write', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({ choice: 'off' }, 1)
      const harness = makeContext({ forms: form })
      const durable = createDurableChoice(harness.ctx)
      try {
        expect(durable.sinceLastWrite()).toBe(Number.POSITIVE_INFINITY)
        durable.write('dark')
        // Still queued, and already a local write for the window's purpose.
        expect(durable.sinceLastWrite()).toBe(0)
        await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
        // Landing refreshes the clock: the echo follows the write, not the click.
        expect(durable.sinceLastWrite()).toBe(0)
        await vi.advanceTimersByTimeAsync(1000)
        expect(durable.sinceLastWrite()).toBe(1000)
        await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS)
        expect(durable.sinceLastWrite() > RESTORE_WINDOW_MS).toBe(true)
      } finally {
        durable.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('isOfficialThemePreference — the built-in preference gate', () => {
  it('accepts exactly system/light/dark and nothing a theme id could collide with', () => {
    for (const preference of ['system', ...OFFICIAL_THEME_PICKS]) {
      expect(isOfficialThemePreference(preference)).toBe(true)
    }
    for (const foreign of ['moonset-light', 'moonset-dark', 'catppuccin-mocha', 'Dark', 'LIGHT', '', undefined, null, 0, {}, []]) {
      expect(isOfficialThemePreference(foreign)).toBe(false)
    }
  })
})

describe('shouldMirrorOfficialPick — the pure mirror rule', () => {
  it('mirrors built-in picks and an official system pick, and nothing else', () => {
    for (const choice of ['light', 'dark'] as const) {
      for (const pick of OFFICIAL_THEME_PICKS) {
        expect(shouldMirrorOfficialPick(pick, choice)).toBe(true)
      }
      // Official "follow the OS" while a CONCRETE Moonset theme is stored.
      expect(shouldMirrorOfficialPick('system', choice)).toBe(true)
      for (const foreign of ['moonset-light', 'moonset-dark', 'catppuccin-mocha', 'Dark', 'LIGHT', '', undefined, null, 0, {}, []]) {
        expect(shouldMirrorOfficialPick(foreign, choice)).toBe(false)
      }
    }

    // follow's own end state IS system: mirroring it would turn the mode off
    // the instant it was turned on.
    expect(shouldMirrorOfficialPick('system', 'follow')).toBe(false)
    for (const pick of OFFICIAL_THEME_PICKS) {
      expect(shouldMirrorOfficialPick(pick, 'follow')).toBe(true)
    }

    // off is "no choice": there is nothing to hand back.
    for (const choice of MOONSET_CHOICES.filter((value) => value === 'off')) {
      for (const pick of ['light', 'dark', 'system', 'moonset-light']) {
        expect(shouldMirrorOfficialPick(pick, choice)).toBe(false)
      }
    }
  })
})
