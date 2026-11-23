import Module from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { STATUS_SEPARATOR, describeState, type MoonsetChoice } from '../src/client/choice'
import { RESTORE_WINDOW_MS, WRITE_DEBOUNCE_MS } from '../src/client/durable'
import { apply } from '../src/client/index'
import { en, zh, type MoonsetLocaleKey } from '../src/client/locales'
import { GLOW_SCOPES, type GlowScope } from '../src/client/skin'
import {
  MoonsetSection,
  type MoonsetSectionFace,
  type MoonsetSectionProps,
  type MoonsetSectionView,
} from '../src/client/settings-section'

/**
 * M5.3 contract: the section's instant feedback, the follow-mode self-healing,
 * and the status line that makes both observable.
 *
 * Three behaviours are pinned here, and each one is the answer to a symptom a
 * real profile reported (0.1.x blockers):
 *
 *  1. **the click is instant AND survives a remount.** The section renders
 *     read() and re-reads on a change; the click moves the highlight before
 *     anything durable moved, and a remount (the Host re-derives its forms
 *     after a settings write) seeds from read() instead of resetting to a
 *     stale prop.
 *  2. **the view is fed by BOTH sources** — the durable store and
 *     theme/change — and a release unbinds both. The OS half matters even
 *     though it changes no stored value: the status line has to move when the
 *     scheme does.
 *  3. **follow mode repairs itself** on a theme/change: a layer that never got
 *     stacked is re-attached, and a built-in preference the settings echo
 *     pinned inside the local-write window is put back on system. Outside the
 *     window M5.1's mirror rule must stay exactly as it was.
 *
 * The component is really rendered: this repo carries no React test stack (and
 * adding one is out of scope), so `react` — which the client factory resolves
 * from the loader's module table — is provided here by a minimal two-hook
 * stand-in installed over Node's module loader. That is the same seam the
 * shipped bundle uses (require("react")), not a re-implementation of the
 * component.
 */

// ── in-memory service fakes ─────────────────────────────────────────────────

/** One in-memory SettingsForm, the shape configForms.get hands back. */
class FakeForm {
  /** Current accepted section. */
  section: { choice?: unknown }
  /** Monotonic revision (a replayed echo carries an older one). */
  revision: number
  /** Every set call, in order. */
  readonly sets: { field: string; value: unknown }[] = []
  private readonly listeners = new Set<() => void>()

  constructor(section: { choice?: unknown } = {}, revision = 1) {
    this.section = section
    this.revision = revision
  }

  getSnapshot(): {
    status: 'ready'
    value: { choice?: unknown }
    user: { choice?: unknown }
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
    for (const listener of [...this.listeners]) listener()
    return true
  }

  /** Deliver a snapshot the test controls (a late echo, another window). */
  deliver(section: { choice?: unknown }, revision: number): void {
    this.section = section
    this.revision = revision
    for (const listener of [...this.listeners]) listener()
  }
}

/** The theme runtime slice the plugin drives (M4 layer, preference, events). */
class FakeTheme {
  /** The runtime's memory preference (a theme id may live here). */
  preference = 'system'
  /** The scheme the OS resolves right now. */
  scheme: 'light' | 'dark' = 'light'
  /** Every setTheme argument, in order. */
  readonly setThemeCalls: string[] = []
  /** Layer sources currently stacked. */
  readonly layers: string[] = []
  /** overrideTokens calls that reached the runtime, refusals included. */
  overrideCalls = 0
  /** When positive, the next N overrideTokens calls throw (a refused layer). */
  failLayers = 0
  private readonly listeners = new Set<(snapshot: { preference: string }) => void>()
  private seq = 0

  on(name: string, listener: (snapshot: { preference: string }) => void): () => void {
    if (name !== 'theme/change') return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(): void {
    this.seq += 1
    const snapshot = { preference: this.preference, revision: this.seq }
    for (const listener of [...this.listeners]) listener(snapshot)
  }

  register(_definition: { id: string }): () => void {
    return () => {}
  }

  overrideTokens(source: string): () => void {
    this.overrideCalls += 1
    if (this.failLayers > 0) {
      this.failLayers -= 1
      throw new Error('token layer "' + source + '" was refused')
    }
    this.layers.push(source)
    this.publish()
    return () => {
      const index = this.layers.indexOf(source)
      if (index >= 0) this.layers.splice(index, 1)
      this.publish()
    }
  }

  getTheme(): { preference: string; active: { colorScheme: 'light' | 'dark' } } {
    return { preference: this.preference, active: { colorScheme: this.scheme } }
  }

  setTheme(id: string): void {
    this.setThemeCalls.push(id)
    this.preference = id
    this.publish()
  }

  /** The official Appearance row: the runtime reflects an official pick. */
  officialPick(id: string): void {
    this.preference = id
    this.publish()
  }

  /**
   * An OS colour-scheme flip, modelling the installed runtime EXACTLY: its
   * media listener publishes only while the preference is `system`
   * (dsh-client-ui-theme/lib/client.js:1670-1673). An unresolved scheme is
   * therefore not this plugin's bug to poll for.
   */
  flipOs(scheme: 'light' | 'dark'): void {
    this.scheme = scheme
    if (this.preference !== 'system') return
    this.publish()
  }
}

/** One captured slots.register call. */
interface SectionRegistration {
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

/** In-memory SlotRegistry: the members the section uses. */
class FakeSlots {
  readonly declared = new Set<string>(['settings.section'])
  readonly registrations: SectionRegistration[] = []

  inject(key: string, callback: () => (() => void) | void): () => void {
    if (!this.declared.has(key)) return () => {}
    const release = callback()
    return () => { release?.() }
  }

  register(options: SectionRegistration['options'], component: unknown): () => void {
    const entry: SectionRegistration = { options, component }
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
    on(name: string, listener: (snapshot: { preference: string }) => void): () => void {
      return theme.on(name, listener)
    },
  }

  return { ctx: context as unknown as ClientContext, theme, slots, locale, disposers }
}

/**
 * The injected face of the (single) section registration in a harness.
 * @param harness - the applied harness.
 * @returns the face the component receives.
 */
function sectionFace(harness: Harness): MoonsetSectionFace {
  const [entry] = harness.slots.registrations
  if (entry === undefined) throw new Error('the section was not registered')
  const inject = entry.options.inject
  if (typeof inject !== 'function') throw new Error('the section registered no inject face')
  return inject() as unknown as MoonsetSectionFace
}

/**
 * Unload the plugin the way the loader does: every effect disposer.
 * @param harness - the applied harness.
 */
function unload(harness: Harness): void {
  for (const dispose of harness.disposers) dispose()
}

// ── the loader module table, in miniature ───────────────────────────────────

/** One element produced by the stand-in createElement (never rendered). */
interface FakeElement {
  readonly type: string
  readonly props: Record<string, unknown>
  readonly children: readonly unknown[]
}

/** The mount currently rendering; the hooks need it (React's dispatcher). */
let currentMount: HookMount | undefined

/**
 * The two hooks the section calls, plus createElement.
 *
 * `useState` is React's lazy-free form: the initial value is evaluated on every
 * render and IGNORED after the first, which is exactly the semantics that make
 * `useState(read())` a re-seed on remount and nothing on a re-render.
 */
const fakeReact = {
  createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): FakeElement {
    return { type, props: props ?? {}, children }
  },
  useState<S>(initial: S): readonly [S, (next: S) => void] {
    return mountInFlight().useState(initial)
  },
  useEffect(effect: () => void | (() => void)): void {
    mountInFlight().useEffect(effect)
  },
}

/**
 * Fail loudly when a hook escapes a render pass: a silent no-op would let the
 * component's subscription disappear without a red test.
 * @returns the mount that is rendering.
 */
function mountInFlight(): HookMount {
  if (currentMount === undefined) throw new Error('a section hook ran outside a mount')
  return currentMount
}

/** One mounted section: hook state, effects, and their cleanups. */
class HookMount {
  private readonly state: unknown[] = []
  private readonly cleanups: (() => void)[] = []
  private pendingEffects: (() => void | (() => void))[] = []
  private cursor = 0
  private readonly component: (props: MoonsetSectionProps) => unknown
  private readonly props: MoonsetSectionProps

  constructor(component: (props: MoonsetSectionProps) => unknown, props: MoonsetSectionProps) {
    this.component = component
    this.props = props
  }

  /** First render plus its effects (React's mount commit). */
  mount(): unknown {
    const tree = this.pass()
    const effects = this.pendingEffects
    this.pendingEffects = []
    for (const effect of effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') this.cleanups.push(cleanup)
    }
    return tree
  }

  /** A re-render after a state change; effects do NOT re-run (their deps are []). */
  update(): unknown {
    return this.pass()
  }

  /** React's unmount: run the effect cleanups, newest first. */
  unmount(): void {
    const cleanups = [...this.cleanups].reverse()
    this.cleanups.length = 0
    for (const cleanup of cleanups) cleanup()
  }

  useState<S>(initial: S): readonly [S, (next: S) => void] {
    const at = this.cursor
    this.cursor += 1
    if (at >= this.state.length) this.state[at] = initial
    const set = (next: S): void => { this.state[at] = next }
    return [this.state[at] as S, set]
  }

  useEffect(effect: () => void | (() => void)): void {
    this.pendingEffects.push(effect)
  }

  private pass(): unknown {
    currentMount = this
    this.cursor = 0
    try {
      return this.component(this.props)
    } finally {
      currentMount = undefined
    }
  }
}

/**
 * Install the stand-in over Node's module loader.
 *
 * The client artifact resolves `react` from the loader's frozen module table
 * through its factory's `require`; under vitest that same call lands on Node's
 * require, so answering `react` here is the faithful stand-in for the table
 * entry — no dependency, no DOM, and the component itself is the real one.
 */
interface LoaderInternals {
  _load(request: string, parent: unknown, isMain: boolean): unknown
}

let restoreLoader: (() => void) | undefined

beforeAll(() => {
  const internals = Module as unknown as LoaderInternals
  const original = internals._load
  if (typeof original !== 'function') {
    throw new Error('this Node build exposes no Module._load, so the loader table cannot be stood in for')
  }
  internals._load = function patched(request: string, parent: unknown, isMain: boolean): unknown {
    if (request === 'react') return fakeReact
    return original.call(internals, request, parent, isMain)
  }
  restoreLoader = () => { internals._load = original }
})

afterAll(() => { restoreLoader?.() })

// ── reading the rendered tree (no DOM) ──────────────────────────────────────

/**
 * Narrow one child to an element.
 * @param value - one entry of a children array.
 * @returns whether it is an element.
 */
function isElement(value: unknown): value is FakeElement {
  return typeof value === 'object' && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { props?: unknown }).props === 'object'
    && Array.isArray((value as { children?: unknown }).children)
}

/**
 * Flatten one level of children (spread arrays included).
 * @param children - the children to flatten.
 * @returns the elements among them.
 */
function childrenOf(children: readonly unknown[]): FakeElement[] {
  const out: FakeElement[] = []
  for (const child of children) {
    if (Array.isArray(child)) {
      out.push(...childrenOf(child))
      continue
    }
    if (isElement(child)) out.push(child)
  }
  return out
}

/**
 * Every element in a rendered tree, depth first.
 * @param tree - the tree the component returned.
 * @returns the elements, in document order.
 */
function elementsUnder(tree: unknown): FakeElement[] {
  const queue = childrenOf([tree])
  const out: FakeElement[] = []
  while (queue.length > 0) {
    const node = queue.shift() as FakeElement
    out.push(node)
    queue.push(...childrenOf(node.children))
  }
  return out
}

/**
 * The text of one element (its first string child).
 * @param node - the element to read.
 * @returns the text, or undefined when it renders only elements.
 */
function textOf(node: FakeElement): string | undefined {
  return node.children.find((child): child is string => typeof child === 'string')
}

/**
 * The label of the button rendered as pressed.
 * @param tree - the rendered tree.
 * @returns the pressed button's text, or undefined when none is pressed.
 */
function pressedLabel(tree: unknown): string | undefined {
  const active = elementsUnder(tree).find((node) => node.type === 'button' && node.props['aria-pressed'] === true)
  return active === undefined ? undefined : textOf(active)
}

/**
 * Click one button by its label.
 * @param tree - the rendered tree.
 * @param label - the button's text.
 */
function press(tree: unknown, label: string): void {
  const button = elementsUnder(tree).find((node) => node.type === 'button' && textOf(node) === label)
  if (button === undefined) throw new Error('no button labelled ' + label)
  const onClick = button.props.onClick
  if (typeof onClick !== 'function') throw new Error('the button has no onClick')
  ;(onClick as () => void)()
}

/**
 * The rendered status line.
 * @param tree - the rendered tree.
 * @returns the line's text.
 */
function statusLine(tree: unknown): string {
  const line = elementsUnder(tree).find((node) => node.type === 'p' && node.props.role === 'status')
  if (line === undefined) throw new Error('the section rendered no status line')
  const text = textOf(line)
  if (text === undefined) throw new Error('the status line is not plain text')
  return text
}

/** The copy the stand-in host hands the section (the zh dictionaries). */
const LABELS: MoonsetSectionProps['labels'] = {
  title: zh['section.title'],
  description: zh['section.description'],
  options: [
    { value: 'light', label: zh['option.light'] },
    { value: 'dark', label: zh['option.dark'] },
    { value: 'follow', label: zh['option.follow'] },
  ],
  // M2: the glow block, built the way `sectionLabels` builds it — the scope
  // buttons are derived from GLOW_SCOPES, so an added scope shows up here too.
  glowTitle: zh['glow.title'],
  glowOn: zh['glow.on'],
  glowOff: zh['glow.off'],
  scopeTitle: zh['glow.scope.title'],
  scopeOptions: GLOW_SCOPES.map((scope) => ({
    value: scope,
    label: zh[`glow.scope.${scope}` as MoonsetLocaleKey],
  })),
  strengthTitle: zh['glow.strength'],
  hint: zh['glow.hint'],
}

/** The three M2 fields a view carries, at their contract defaults. */
const GLOW_FIELDS: Pick<MoonsetSectionView, 'glowScope' | 'glow' | 'glowStrength'> = {
  glowScope: 'all',
  glow: true,
  glowStrength: 100,
}

/**
 * Mount the real component over a controllable view + subscription.
 * @param spec - the view to read plus the callbacks to record (M2 adds three).
 * @returns the mount plus the listener set its subscription fills.
 */
function mountSection(spec: {
  readonly view: () => MoonsetSectionView
  readonly onPick?: (choice: MoonsetChoice) => void
  readonly onScope?: (scope: GlowScope) => void
  readonly onToggleGlow?: (next: boolean) => void
  readonly onStrength?: (next: number) => void
}): { mount: HookMount; listeners: Set<() => void> } {
  const listeners = new Set<() => void>()
  const props: MoonsetSectionProps = {
    onPick: spec.onPick ?? (() => {}),
    onScope: spec.onScope ?? (() => {}),
    onToggleGlow: spec.onToggleGlow ?? (() => {}),
    onStrength: spec.onStrength ?? (() => {}),
    labels: LABELS,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    read: spec.view,
  }
  return { mount: new HookMount(MoonsetSection, props), listeners }
}

// ── C: the status line is a pure function ───────────────────────────────────

describe('M5.3 describeState — 状态行是纯函数', () => {
  it('renders the four facts of a following section', () => {
    expect(STATUS_SEPARATOR).toBe(' · ')
    expect(describeState({ choice: 'follow', preference: 'system', scheme: 'dark', layerAttached: true }))
      .toBe('跟随系统 · 官方偏好 system · 当前方案 深色 · 覆盖层 已挂载')
  })

  it('prints a third-party preference verbatim and a detached layer as such', () => {
    expect(describeState({ choice: 'dark', preference: 'moonset-dark', scheme: 'dark', layerAttached: false }))
      .toBe('深色 · 官方偏好 moonset-dark · 当前方案 深色 · 覆盖层 未挂载')
  })

  it('renders off as ONE phrase, whatever the runtime holds', () => {
    for (const preference of ['system', 'light', 'dark', 'moonset-light']) {
      for (const scheme of ['light', 'dark'] as const) {
        for (const layerAttached of [true, false]) {
          expect(describeState({ choice: 'off', preference, scheme, layerAttached }))
            .toBe('未选择（官方主题）')
        }
      }
    }
  })

  it('localizes through the dictionaries: en renders the same facts, zh is the default', () => {
    const t = (key: MoonsetLocaleKey): string => en[key]
    expect(describeState({ choice: 'follow', preference: 'system', scheme: 'light', layerAttached: true, t }))
      .toBe('Follow system · Official preference system · Scheme light · Layer attached')
    expect(describeState({ choice: 'light', preference: 'moonset-light', scheme: 'light', layerAttached: false, t }))
      .toBe('Light · Official preference moonset-light · Scheme light · Layer detached')

    // Without a resolver the zh dictionary is used, phrase by phrase: no copy
    // is hard-coded in choice.ts.
    const line = describeState({ choice: 'light', preference: 'light', scheme: 'light', layerAttached: false })
    for (const phrase of [zh['status.official'], zh['status.scheme.light'], zh['status.layer.off']]) {
      expect(line).toContain(phrase)
    }
  })
})

// ── A: instant feedback, and a remount that cannot undo it ──────────────────

describe('M5.3 设置区即时反馈 — 乐观高亮与宿主重挂载', () => {
  it('moves the highlight on the click itself, and re-seeds from read() after a remount', () => {
    let view: MoonsetSectionView = { choice: 'light', status: 'mock', ...GLOW_FIELDS }
    const picks: string[] = []
    const { mount, listeners } = mountSection({
      view: () => view,
      onPick: (choice) => { picks.push(choice) },
    })
    const first = mount.mount()
    expect(pressedLabel(first)).toBe(zh['option.light'])

    // The click: the highlight moves in THIS render, before anything durable,
    // and read() has not moved yet — the view change is optimistic by design.
    press(first, zh['option.follow'])
    expect(picks).toEqual(['follow'])
    expect(view.choice).toBe('light')
    expect(pressedLabel(mount.update())).toBe(zh['option.follow'])

    // The Host stores the choice and REMOUNTS the section (a settings write
    // re-derives its scope forms). The new mount seeds from read().
    view = { choice: 'follow', status: 'mock', ...GLOW_FIELDS }
    const remount = mountSection({ view: () => view })
    expect(pressedLabel(remount.mount.mount())).toBe(zh['option.follow'])
    remount.mount.unmount()
    mount.unmount()
    expect(listeners.size).toBe(0)

    // And a STALE read seeds the old value again: the component keeps no
    // private copy that could outlive the remount (that copy was the M5 bug).
    view = { choice: 'light', status: 'mock', ...GLOW_FIELDS }
    const stale = mountSection({ view: () => view })
    expect(pressedLabel(stale.mount.mount())).toBe(zh['option.light'])
    stale.mount.unmount()
  })

  it('binds the view on mount and releases it on unmount, for both sources', () => {
    let view: MoonsetSectionView = { choice: 'off', status: 'A', ...GLOW_FIELDS }
    const { mount, listeners } = mountSection({ view: () => view })
    const tree = mount.mount()
    // The effect ran once, on mount.
    expect(listeners.size).toBe(1)
    expect(statusLine(tree)).toBe('A')

    // Either source — a durable change or a theme/change — pushes a re-read.
    view = { choice: 'follow', status: 'B', ...GLOW_FIELDS }
    for (const listener of [...listeners]) listener()
    expect(statusLine(mount.update())).toBe('B')

    // Unmount releases it: nothing is registered any more, so a later change
    // cannot reach the (now absent) section.
    mount.unmount()
    expect(listeners.size).toBe(0)
    view = { choice: 'off', status: 'C', ...GLOW_FIELDS }
    for (const listener of [...listeners]) listener()
    expect(statusLine(mount.update())).toBe('B')
  })

  it('feeds the injected subscription from the durable store AND from theme/change', () => {
    const form = new FakeForm({})
    const harness = makeContext({ forms: form })
    apply(harness.ctx)
    try {
      const face = sectionFace(harness)
      const seen: string[] = []
      const release = face.subscribe(() => { seen.push(face.read().choice + '|' + face.read().status) })

      // 1) the durable source: another window stores a choice.
      form.deliver({ choice: 'follow' }, form.revision + 1)
      expect(seen.length).toBeGreaterThan(0)
      expect(seen[seen.length - 1]).toContain('follow|')

      // 2) the theme/change source: an OS flip changes no stored value at all,
      // yet it must reach the section (the status line has to move).
      const before = seen.length
      harness.theme.flipOs('dark')
      expect(seen).toHaveLength(before + 1)
      expect(seen[seen.length - 1]).toContain(zh['status.scheme.dark'])

      // The release unbinds BOTH: neither source reaches the listener again.
      release()
      form.deliver({ choice: 'dark' }, form.revision + 1)
      harness.theme.flipOs('light')
      expect(seen).toHaveLength(before + 1)
    } finally {
      unload(harness)
    }
  })

  it('renders the injected status line and re-renders it when the OS scheme flips', () => {
    const form = new FakeForm({ choice: 'follow' })
    const harness = makeContext({ forms: form })
    apply(harness.ctx)
    try {
      const face = sectionFace(harness)
      const mount = new HookMount(MoonsetSection, face)
      const tree = mount.mount()
      expect(statusLine(tree)).toBe(face.read().status)
      expect(statusLine(tree)).toContain(zh['status.layer.on'])
      expect(statusLine(tree)).toContain(zh['status.official'] + ' system')

      harness.theme.flipOs('dark')
      expect(statusLine(mount.update())).toContain(zh['status.scheme.dark'])
      // Following writes nothing: the layer is what paints the other half.
      expect(harness.theme.setThemeCalls).toEqual([])
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      mount.unmount()
    } finally {
      unload(harness)
    }
  })
})

// ── B: follow-mode self-healing on theme/change ─────────────────────────────

describe('M5.3 跟随自愈 — 覆盖层与偏好各修一处', () => {
  it('B① re-attaches a follow layer that never got stacked, and says so once', async () => {
    const form = new FakeForm({ choice: 'follow' })
    const harness = makeContext({ forms: form })
    harness.theme.failLayers = 1
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      apply(harness.ctx)
      // The runtime refused the layer: nothing is stacked, and the status line
      // reports that instead of pretending the switch is on.
      expect(harness.theme.layers).toEqual([])
      expect(harness.theme.overrideCalls).toBe(1)
      const face = sectionFace(harness)
      expect(face.read().choice).toBe('follow')
      expect(face.read().status).toContain(zh['status.layer.off'])

      // The next publish (an OS flip, an adopt, any other write) repairs it.
      harness.theme.flipOs('dark')
      await Promise.resolve()

      expect(harness.theme.overrideCalls).toBe(2)
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      expect(face.read().status).toContain(zh['status.layer.on'])
      const repairs = warn.mock.calls.filter(([message]) => String(message).includes('re-attaching'))
      expect(repairs).toHaveLength(1)
      expect(String(repairs[0]?.[0])).toContain('[dsh-moonset]')
    } finally {
      warn.mockRestore()
      unload(harness)
    }
  })

  it('B② puts system back, deferred and once, when the echo pins a built-in inside the window', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      const face = sectionFace(harness)

      // A pick opens the local-write window (the write itself is queued).
      face.onPick('follow')
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      expect(harness.theme.setThemeCalls).toEqual([])

      // The settings echo lands: the runtime adopts the document's built-in.
      harness.theme.officialPick('dark')
      expect(harness.theme.setThemeCalls).toEqual([])   // not from the publish stack

      await Promise.resolve()
      expect(harness.theme.setThemeCalls).toEqual(['system'])
      expect(harness.theme.preference).toBe('system')
      // The repair is announced ONCE, so a support log shows why the write ran.
      expect(warn.mock.calls.filter(([message]) => String(message).includes('restoring'))).toHaveLength(1)

      // It did NOT hand the UI back: the stored choice stays, no mirror write.
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 2)
      expect(form.sets).toEqual([{ field: 'choice', value: 'follow' }])
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      expect(face.read().choice).toBe('follow')
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('B② outside the window still mirrors to off — the M5.1 behaviour is unchanged', async () => {
    vi.useFakeTimers()
    try {
      const form = new FakeForm({})
      const harness = makeContext({ forms: form })
      apply(harness.ctx)
      const face = sectionFace(harness)
      face.onPick('follow')
      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      // Well past the local-write window: a built-in is the USER's own pick.
      await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS + 1)

      harness.theme.officialPick('dark')
      await Promise.resolve()
      expect(harness.theme.setThemeCalls).toEqual([])   // never re-asserted
      expect(harness.theme.layers).toEqual([])          // layer released

      await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
      expect(form.sets).toEqual([
        { field: 'choice', value: 'follow' },
        { field: 'choice', value: 'off' },
      ])
      expect(face.read().choice).toBe('off')
    } finally {
      vi.useRealTimers()
    }
  })

  it('following really follows the OS while the preference stays system', () => {
    const form = new FakeForm({ choice: 'follow' })
    const harness = makeContext({ forms: form })
    apply(harness.ctx)
    try {
      const face = sectionFace(harness)
      const seen: string[] = []
      const release = face.subscribe(() => { seen.push(face.read().status) })
      expect(face.read().status).toContain(zh['status.scheme.light'])

      harness.theme.flipOs('dark')
      expect(seen).toHaveLength(1)
      expect(seen[0]).toContain(zh['status.scheme.dark'])
      // No write, no re-layer: the runtime's own publish carries the flip.
      expect(harness.theme.setThemeCalls).toEqual([])
      expect(harness.theme.layers).toEqual(['dsh-moonset'])
      expect(form.sets).toEqual([])

      release()
      harness.theme.flipOs('light')
      expect(seen).toHaveLength(1)
    } finally {
      unload(harness)
    }
  })
})

// ── M2: 地面范围 / 环境光晕 / 强度 ───────────────────────────────────────────

describe('M2 设置区 — 地面范围、光晕开关与强度', () => {
  /** The rendered slider (the only range input). */
  function slider(tree: unknown): FakeElement {
    const input = elementsUnder(tree).find((node) => node.type === 'input' && node.props.type === 'range')
    if (input === undefined) throw new Error('the section rendered no strength slider')
    return input
  }

  /** The three scope buttons, in document order. */
  function scopeButtons(tree: unknown): FakeElement[] {
    return elementsUnder(tree).filter((node) => node.type === 'button'
      && LABELS.scopeOptions.some((option) => textOf(node) === option.label))
  }

  it('renders the three scope buttons, the switch and the slider from read()', () => {
    const view: MoonsetSectionView = { choice: 'light', status: 'mock', glow: true, glowScope: 'main', glowStrength: 150 }
    const { mount } = mountSection({ view: () => view })
    const tree = mount.mount()
    try {
      // 地面范围: one button per GLOW_SCOPES value, the live one pressed.
      const buttons = scopeButtons(tree)
      expect(buttons.map((button) => textOf(button))).toEqual(LABELS.scopeOptions.map((option) => option.label))
      expect(buttons.map((button) => button.props['aria-pressed'])).toEqual([false, true, false])
      // 环境光晕: a pressed toggle carrying the ON word.
      const toggle = elementsUnder(tree).find((node) => node.type === 'button' && textOf(node) === LABELS.glowTitle + ' ' + LABELS.glowOn)
      expect(toggle).toBeDefined()
      expect(toggle?.props['aria-pressed']).toBe(true)
      // 强度: the range input, its bounds, and the live percentage beside it.
      expect(slider(tree).props).toMatchObject({ min: 0, max: 200, step: 10, value: 150 })
      const percent = elementsUnder(tree).find((node) => node.type === 'span' && textOf(node) === '150%')
      expect(percent).toBeDefined()
    } finally {
      mount.unmount()
    }
  })

  it('calls onScope / onToggleGlow / onStrength and moves its own view at once', () => {
    let view: MoonsetSectionView = { choice: 'light', status: 'mock', ...GLOW_FIELDS }
    const scopes: GlowScope[] = []
    const toggles: boolean[] = []
    const strengths: number[] = []
    const { mount } = mountSection({
      view: () => view,
      onScope: (scope) => { scopes.push(scope) },
      onToggleGlow: (next) => { toggles.push(next) },
      onStrength: (next) => { strengths.push(next) },
    })
    const tree = mount.mount()
    try {
      // A scope click: the handler sees the value, and the pressed state moves in
      // THIS render even though read() has not moved yet (the same optimism as
      // the theme buttons).
      press(tree, zh['glow.scope.conversation'])
      expect(scopes).toEqual(['conversation'])
      expect(view.glowScope).toBe('all')
      const pressedScopes = scopeButtons(mount.update())
        .filter((button) => button.props['aria-pressed'] === true)
        .map((button) => textOf(button))
      expect(pressedScopes).toEqual([zh['glow.scope.conversation']])

      // The glow toggle flips off and says so.
      press(tree, LABELS.glowTitle + ' ' + LABELS.glowOn)
      expect(toggles).toEqual([false])
      const off = elementsUnder(mount.update()).find((node) => node.type === 'button' && textOf(node) === LABELS.glowTitle + ' ' + LABELS.glowOff)
      expect(off).toBeDefined()
      expect(off?.props['aria-pressed']).toBe(false)

      // The slider hands the parsed number over (never a string).
      const onChange = slider(mount.update()).props.onChange
      if (typeof onChange !== 'function') throw new Error('the slider has no onChange')
      ;(onChange as (event: unknown) => void)({ currentTarget: { value: '150' } })
      expect(strengths).toEqual([150])
      expect(elementsUnder(mount.update()).some((node) => node.type === 'span' && textOf(node) === '150%')).toBe(true)
    } finally {
      mount.unmount()
    }
  })
})