#!/usr/bin/env node
/**
 * M7 — coexistence acceptance in a FAKE HOST.
 *
 * Loads the two REAL build artifacts (this repo's lib/client.js and the
 * Catppuccin plugin's lib/client.js, the latter READ-ONLY) into ONE shared fake
 * host and proves they can live in the same page:
 *
 *   - 6 registered theme ids (4 "catppuccin-*" + moonset-light/moonset-dark);
 *   - a second apply() of either side does not throw and does not grow the
 *     registry (the tolerance path really runs: duplicates throw and are
 *     swallowed by the bundles' own tolerantRegistration);
 *   - six setTheme() calls, each followed by theme/change and a preference
 *     that follows;
 *   - the two overrideTokens layers (ours "dsh-moonset", theirs
 *     "@nonamelego/dsh-catppuccin") do not remove each other;
 *   - releasing only Moonset leaves the four Catppuccin ids and their layer;
 *   - the module table of both artifacts holds nothing unexpected
 *     (react, react/*, @deepseek-ai/* only).
 *
 * The checks drive the REAL surfaces the settings rows use — Catppuccin's
 * settings.section injection (flavor.select, flavor.setFollowSystem) and
 * Moonset's section injection (onPick) — never an internal symbol.
 *
 * Anti-cheat notes (read before editing):
 *   - theme.register REALLY throws on a duplicate id, theme.setTheme REALLY
 *     throws on an unregistered id, slots.register / locale.register REALLY
 *     throw on duplicates. A fake that answered "undefined" would make every
 *     "6 ids" / "tolerant" claim here vacuous.
 *   - A missing platform global is NOT smoothed over: factory/apply throws
 *     propagate to the caller, which prints the error name and exits 1.
 *
 * Usage:
 *   node scripts/coexist-check.mjs [--catppuccin <path to lib/client.js>]
 *
 * Exit codes: 0 = all checks pass, 1 = a check failed (or an artifact threw),
 * 2 = usage / artifact not found.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OURS_ARTIFACT = join(REPO_ROOT, 'lib', 'client.js')
const DEFAULT_PEER_ARTIFACT = join(REPO_ROOT, '..', 'dsh-catppuccin-theme', 'lib', 'client.js')

/** Our follow-layer identity (src/client/themes.ts -> FOLLOW_LAYER_SOURCE). */
const OURS_LAYER_SOURCE = 'dsh-moonset'
/** Our two ids; the peer's four are read off whatever it registers. */
const OUR_THEME_IDS = ['moonset-light', 'moonset-dark']
/** The four flavours the peer documents; used to name what is expected, never seeded. */
const PEER_THEME_IDS = [
  'catppuccin-latte',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
]
/** The platform modules the frozen loader table legitimately serves. */
const PLATFORM_MODULE = /^(?:react(?:\/.*)?|@deepseek-ai\/.*)$/u
/** Built-ins the runtime always carries; they are not plugin registrations. */
const BUILTIN_THEME_IDS = ['light', 'dark']

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Parse --catppuccin <path> (also --catppuccin=<path>). */
function parseArgs(argv) {
  let peer = DEFAULT_PEER_ARTIFACT
  let explicit = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--catppuccin') {
      const value = argv[i + 1]
      if (value === undefined) usageError('--catppuccin needs a path')
      peer = isAbsolute(value) ? value : resolve(process.cwd(), value)
      explicit = true
      i += 1
      continue
    }
    if (arg.startsWith('--catppuccin=')) {
      const value = arg.slice('--catppuccin='.length)
      if (value === '') usageError('--catppuccin needs a path')
      peer = isAbsolute(value) ? value : resolve(process.cwd(), value)
      explicit = true
      continue
    }
    usageError('unknown argument ' + JSON.stringify(arg))
  }
  return { peer, explicit }
}

function printUsage() {
  console.log('usage: node scripts/coexist-check.mjs [--catppuccin <path to catppuccin lib/client.js>]')
  console.log('  default: ' + DEFAULT_PEER_ARTIFACT)
}

function usageError(message) {
  console.error('coexist-check: ' + message)
  printUsage()
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** One line, never a stack: the report columns stay readable. */
function describe(error) {
  if (error instanceof Error) return error.name + ': ' + error.message
  return String(error)
}

/** Drain the microtask queue and one macrotask tick. */
function flush() {
  return new Promise((settle) => setImmediate(settle))
}

/** Assertion helper whose message becomes the report line. */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function includesAll(actual, expected) {
  return expected.every((value) => actual.includes(value))
}

/** Assert that a call throws an Error whose message matches. */
function assertThrows(run, pattern, what) {
  let thrown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  if (thrown === undefined) throw new Error(what + ' did not throw — the fake host would be lying')
  if (!(thrown instanceof Error) || !pattern.test(thrown.message)) {
    throw new Error(what + ' threw the wrong error: ' + describe(thrown))
  }
  return thrown
}

function groupBy(items, keyOf) {
  const map = {}
  for (const item of items) {
    const key = keyOf(item)
    if (map[key] === undefined) map[key] = []
    map[key].push(item)
  }
  return map
}

// ---------------------------------------------------------------------------
// Fake browser: document / localStorage / timers / fetch
// ---------------------------------------------------------------------------

/**
 * A page shaped like the one the two artifacts really run in.
 *
 * Only the surface the artifacts touch is modelled; every MUTATION is recorded
 * with the harness phase that caused it, which is what lets the report say
 * "no DOM writes while switching themes" instead of asserting it.
 */
function createBrowser() {
  const writes = []
  const reads = []
  const state = { phase: 'boot' }

  const recordWrite = (op, detail) => {
    writes.push({ phase: state.phase, op, detail })
  }

  const createNode = (tagName) => {
    const attributes = new Map()
    const styleProps = new Map()
    const children = []
    const dataset = {}
    const syncDataset = (name, value) => {
      if (!name.startsWith('data-')) return
      const key = name.slice(5).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())
      if (value === undefined) delete dataset[key]
      else dataset[key] = value
    }
    const node = {
      tagName: String(tagName).toUpperCase(),
      children,
      attributes,
      dataset,
      textContent: '',
      style: {
        setProperty(name, value) {
          recordWrite('style.setProperty', name)
          styleProps.set(name, String(value))
        },
        removeProperty(name) {
          recordWrite('style.removeProperty', name)
          styleProps.delete(name)
        },
        getPropertyValue(name) {
          return styleProps.has(name) ? styleProps.get(name) : ''
        },
        set cssText(value) {
          recordWrite('style.cssText', '')
          styleProps.set('cssText', String(value))
        },
        get cssText() {
          return styleProps.get('cssText') ?? ''
        },
      },
      setAttribute(name, value) {
        recordWrite('setAttribute', name)
        attributes.set(name, String(value))
        syncDataset(name, String(value))
      },
      getAttribute(name) {
        return attributes.has(name) ? attributes.get(name) : null
      },
      hasAttribute(name) {
        return attributes.has(name)
      },
      removeAttribute(name) {
        recordWrite('removeAttribute', name)
        attributes.delete(name)
        syncDataset(name, undefined)
      },
      toggleAttribute(name, force) {
        const next = force === undefined ? !attributes.has(name) : Boolean(force)
        if (next) node.setAttribute(name, '')
        else node.removeAttribute(name)
        return next
      },
      appendChild(child) {
        recordWrite('appendChild', node.tagName.toLowerCase())
        children.push(child)
        return child
      },
      append(...nodes) {
        for (const child of nodes) node.appendChild(child)
      },
      remove() {
        recordWrite('remove', node.tagName.toLowerCase())
      },
      querySelector() {
        return null
      },
      querySelectorAll() {
        return []
      },
    }
    return node
  }

  const html = createNode('html')
  const head = createNode('head')
  const body = createNode('body')

  const document = {
    documentElement: html,
    head,
    body,
    querySelector(selector) {
      reads.push({ phase: state.phase, op: 'querySelector', detail: selector })
      return null
    },
    querySelectorAll(selector) {
      reads.push({ phase: state.phase, op: 'querySelectorAll', detail: selector })
      return []
    },
    createElement(tagName) {
      return createNode(tagName)
    },
    getElementById() {
      return null
    },
    addEventListener() {},
    removeEventListener() {},
  }

  const storage = new Map()
  const localStorage = {
    get length() {
      return storage.size
    },
    key(index) {
      const keys = [...storage.keys()]
      return index < keys.length ? keys[index] : null
    },
    getItem(key) {
      const name = String(key)
      return storage.has(name) ? storage.get(name) : null
    },
    setItem(key, value) {
      storage.set(String(key), String(value))
    },
    removeItem(key) {
      storage.delete(String(key))
    },
    clear() {
      storage.clear()
    },
  }

  const timers = new Set()
  const track = (handle) => {
    if (handle !== null && typeof handle === 'object' && typeof handle.unref === 'function') handle.unref()
    timers.add(handle)
    return handle
  }

  const fetchCalls = []
  const windowListeners = new Map()
  const globals = { document, localStorage }
  const saved = new Map()

  return {
    document,
    localStorage,
    head,
    html,
    body,
    state,
    writes,
    reads,
    fetchCalls,
    storage,
    windowListeners,
    /** A fresh window object: one per artifact, so each captures its own spec. */
    createWindowStub(captures) {
      return {
        __ModuleLoader__: {
          load(spec) {
            captures.push(spec)
          },
        },
        document,
        localStorage,
        location: { href: 'http://fake.invalid/' },
        navigator: { clipboard: { writeText: async () => {} } },
        matchMedia(query) {
          return {
            media: query,
            matches: false,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
          }
        },
        addEventListener(type, handler) {
          const set = windowListeners.get(type) ?? new Set()
          set.add(handler)
          windowListeners.set(type, set)
        },
        removeEventListener(type, handler) {
          windowListeners.get(type)?.delete(handler)
        },
        setTimeout(handler, delay, ...args) {
          return track(setTimeout(handler, delay, ...args))
        },
        clearTimeout(handle) {
          clearTimeout(handle)
        },
        setInterval(handler, delay, ...args) {
          return track(setInterval(handler, delay, ...args))
        },
        clearInterval(handle) {
          clearInterval(handle)
        },
        fetch(url) {
          // Hard rule: this harness never reaches the network.
          fetchCalls.push(String(url))
          return Promise.reject(new Error('coexist-check: network disabled'))
        },
      }
    },
    /** Install document / localStorage as real globals for the bundle eval. */
    installGlobals() {
      for (const [key, value] of Object.entries(globals)) {
        saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
      }
    },
    uninstallGlobals() {
      for (const [key, descriptor] of saved) {
        if (descriptor === undefined) delete globalThis[key]
        else Object.defineProperty(globalThis, key, descriptor)
      }
      saved.clear()
      for (const handle of timers) {
        clearTimeout(handle)
        clearInterval(handle)
      }
      timers.clear()
    },
    /** Mutations recorded while a given phase was active. */
    writesDuring(phase) {
      return writes.filter((entry) => entry.phase === phase)
    },
  }
}

// ---------------------------------------------------------------------------
// Platform modules: react + jsx runtime + an empty proxy for anything else
// ---------------------------------------------------------------------------

/** The react surface the artifacts render with (the rows are never mounted). */
function createReact() {
  const Fragment = Symbol.for('react.fragment')
  const createElement = (type, props, ...children) => ({
    $$typeof: 'react.element',
    type,
    props: props ?? {},
    children: children.flat(Infinity),
  })
  return {
    Fragment,
    createElement,
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useReducer(_reducer, initial) {
      return [initial, () => {}]
    },
    useMemo(factory) {
      return factory()
    },
    useCallback(callback) {
      return callback
    },
    useEffect() {},
    useLayoutEffect() {},
    useRef(value) {
      return { current: value }
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
    useId() {
      return 'stable-id'
    },
    useContext() {
      return undefined
    },
    createContext(defaultValue) {
      return { $$typeof: 'react.context', Provider: 'Provider', Consumer: 'Consumer', defaultValue }
    },
    memo(component) {
      return component
    },
    forwardRef(render) {
      return render
    },
    Children: {
      map(children, callback) {
        return (Array.isArray(children) ? children : []).map(callback)
      },
    },
  }
}

/**
 * An inexhaustible stand-in for a platform module we do not model.
 *
 * Every property is itself a callable stub, so an artifact touching
 * primitives.Button or foo.bar() at module scope cannot crash the harness —
 * and the ids stay listed in the report. then is deliberately absent so the
 * proxy is never mistaken for a thenable.
 */
function createEmptyModule(id) {
  const make = (name) => {
    const cache = new Map()
    const target = function emptyModuleStub() {
      return make(name + '()')
    }
    return new Proxy(target, {
      get(_target, property) {
        if (property === 'then') return undefined
        if (property === Symbol.toStringTag) return 'EmptyModule(' + id + ')'
        if (typeof property === 'symbol') return undefined
        if (!cache.has(property)) cache.set(property, make(name + '.' + property))
        return cache.get(property)
      },
      apply() {
        return make(name + '()')
      },
      construct() {
        return {}
      },
    })
  }
  return make(id)
}

function createJsxRuntime(react) {
  const create = (type, props, key) => ({
    $$typeof: 'react.element',
    type,
    key: key ?? null,
    props: props ?? {},
  })
  return { Fragment: react.Fragment, jsx: create, jsxs: create, jsxDEV: create }
}

// ---------------------------------------------------------------------------
// Fake host services
// ---------------------------------------------------------------------------

/** A synchronous event bus with the cordis on() contract (returns a disposer). */
function createEventBus() {
  const listeners = new Map()
  return {
    on(event, handler) {
      const set = listeners.get(event) ?? new Set()
      set.add(handler)
      listeners.set(event, set)
      return () => {
        set.delete(handler)
      }
    },
    emit(event, payload) {
      const set = listeners.get(event)
      if (set === undefined) return 0
      for (const handler of [...set]) handler(payload)
      return set.size
    },
    count(event) {
      return listeners.get(event)?.size ?? 0
    },
  }
}

/**
 * The ThemeRuntime contract the artifacts depend on, restated from the real
 * 0.2.1 source: duplicate id throws, unregistered setTheme throws, override
 * layers are keyed by source (re-registering a source replaces it, and only
 * the newest disposer may remove it), every accepted change publishes an
 * immutable snapshot on theme/change.
 */
class FakeThemeRuntime {
  constructor(events, rejections) {
    this.events = events
    this.rejections = rejections
    this.themes = BUILTIN_THEME_IDS.map((id) => ({
      id,
      colorScheme: id === 'dark' ? 'dark' : 'light',
      tokens: {},
      builtin: true,
    }))
    this.preference = 'system'
    this.mediaMatchesDark = false
    this.revision = 0
    this.overrides = new Map()
    this.overrideSeq = 0
    this.log = []
    this.snapshot = this.buildSnapshot()
  }

  getTheme() {
    return this.snapshot
  }

  register(definition) {
    if (definition === null || typeof definition !== 'object') {
      throw new Error('theme register: definition must be an object')
    }
    if (definition.id === 'system') {
      throw new Error('"system" is a preference, not a registrable theme id')
    }
    if (typeof definition.id !== 'string' || definition.id === '') {
      throw new Error('theme register: definition.id must be a non-empty string')
    }
    if (definition.colorScheme !== 'light' && definition.colorScheme !== 'dark') {
      throw new Error('theme "' + definition.id + '": colorScheme must be "light" or "dark"')
    }
    if (definition.tokens === null || typeof definition.tokens !== 'object') {
      throw new Error('theme "' + definition.id + '": tokens must be an object')
    }
    if (this.themes.some((theme) => theme.id === definition.id)) {
      const message = 'theme "' + definition.id + '" is already registered'
      this.rejections.push({ service: 'theme', method: 'register', message })
      throw new Error(message)
    }
    this.themes = [...this.themes, definition]
    this.log.push({ op: 'register', id: definition.id, tokens: Object.keys(definition.tokens).length })
    this.publish()
    return () => {
      if (!this.themes.some((theme) => theme.id === definition.id)) return
      this.themes = this.themes.filter((theme) => theme.id !== definition.id)
      if (this.preference === definition.id) this.preference = 'system'
      this.log.push({ op: 'unregister', id: definition.id })
      this.publish()
    }
  }

  overrideTokens(source, tokens) {
    if (typeof source !== 'string' || source === '') {
      throw new Error('overrideTokens: source must be a non-empty string')
    }
    const validated = {}
    for (const [name, value] of Object.entries(tokens ?? {})) {
      if (value === null || typeof value !== 'object' || typeof value.light !== 'string' || typeof value.dark !== 'string') {
        const message = 'overrideTokens("' + source + '") received a malformed value for ' + name
        this.rejections.push({ service: 'theme', method: 'overrideTokens', message })
        throw new Error('overrideTokens("' + source + '"): ' + name + ' must be a { light, dark } pair of strings')
      }
      validated[name] = { light: value.light, dark: value.dark }
    }
    const layer = { seq: this.overrideSeq++, tokens: validated }
    this.overrides.set(source, layer)
    this.log.push({ op: 'overrideTokens', source, tokens: Object.keys(validated).length })
    this.publish()
    return () => {
      if (this.overrides.get(source) !== layer) return
      this.overrides.delete(source)
      this.log.push({ op: 'releaseTokens', source })
      this.publish()
    }
  }

  setTheme(id) {
    if (id !== 'system' && !this.themes.some((theme) => theme.id === id)) {
      const message = 'theme "' + id + '" is not registered'
      this.rejections.push({ service: 'theme', method: 'setTheme', message })
      throw new Error(message)
    }
    if (this.preference === id) return
    this.preference = id
    this.log.push({ op: 'setTheme', id })
    this.publish()
  }

  /** Registered plugin ids (built-ins excluded). */
  registeredIds() {
    return this.themes.filter((theme) => theme.builtin !== true).map((theme) => theme.id)
  }

  buildSnapshot() {
    const resolved = this.preference === 'system'
      ? (this.mediaMatchesDark ? 'dark' : 'light')
      : this.preference
    const base = this.themes.find((theme) => theme.id === resolved)
    if (base === undefined) throw new Error('theme registry lost "' + resolved + '"')
    const tokens = { ...base.tokens }
    const layers = [...this.overrides.values()].sort((left, right) => left.seq - right.seq)
    for (const layer of layers) {
      for (const [name, modes] of Object.entries(layer.tokens)) tokens[name] = modes[base.colorScheme]
    }
    return {
      preference: this.preference,
      active: { id: base.id, colorScheme: base.colorScheme, tokens },
      themes: [...this.themes],
      revision: this.revision,
    }
  }

  publish() {
    this.revision += 1
    this.snapshot = this.buildSnapshot()
    this.events.emit('theme/change', this.snapshot)
  }
}

/**
 * Slot registry: inject(name, cb) runs the callback synchronously for a
 * declared slot (the shape the real registry has once settings.section
 * exists), register throws on a duplicate entry id/key.
 */
function createSlots(rejections) {
  const declared = new Set(['settings.section', 'plugins.bundle.config'])
  const registry = new Map()
  const slotMap = (name) => {
    if (!registry.has(name)) registry.set(name, new Map())
    return registry.get(name)
  }
  return {
    injectAll: [],
    inject(name, callback) {
      const entry = { name, ran: false, dispose: () => {} }
      if (!declared.has(name)) return () => {}
      const result = callback()
      entry.ran = true
      entry.dispose = typeof result === 'function' ? result : () => {}
      this.injectAll.push(entry)
      return () => {
        entry.dispose()
      }
    },
    register(slotEntry, component) {
      if (slotEntry === null || typeof slotEntry !== 'object') {
        throw new Error('slots.register: entry must be an object')
      }
      const name = slotEntry.name
      if (typeof name !== 'string') throw new Error('slots.register: entry.name must be a string')
      const identity = slotEntry.id ?? slotEntry.key
      if (typeof identity !== 'string') {
        throw new Error('slots.register("' + name + '"): entry.id or entry.key must be a string')
      }
      const slot = slotMap(name)
      if (slot.has(identity)) {
        const message = 'list slot "' + name + '" already has an entry with id "' + identity + '"'
        rejections.push({ service: 'slots', method: 'register', message })
        throw new Error(message)
      }
      const record = { name, identity, entry: slotEntry, component }
      slot.set(identity, record)
      return () => {
        if (slot.get(identity) === record) slot.delete(identity)
      }
    },
    find(name, identity) {
      return registry.get(name)?.get(identity)
    },
    entries(name) {
      return [...(registry.get(name)?.values() ?? [])]
    },
    names() {
      return [...registry.keys()].sort()
    },
  }
}

/** Locale registry: duplicate namespace/locale and duplicate language both throw. */
function createLocale(rejections) {
  const dictionaries = new Map()
  const languages = new Map([['en', { id: 'en', label: 'English' }]])
  const listeners = new Set()
  const state = { active: 'en' }
  const notify = () => {
    for (const listener of [...listeners]) listener(state)
  }
  const register = (namespace, first, second) => {
    const language = typeof first === 'string' ? first : 'en'
    const dictionary = typeof first === 'string' ? second : first
    if (typeof namespace !== 'string' || namespace === '') {
      throw new Error('locale.register: namespace must be a string')
    }
    if (!dictionaries.has(namespace)) dictionaries.set(namespace, new Map())
    const byLanguage = dictionaries.get(namespace)
    if (byLanguage.has(language)) {
      const message = 'locale namespace "' + namespace + '" already has locale "' + language + '"'
      rejections.push({ service: 'locale', method: 'register', message })
      throw new Error(message)
    }
    byLanguage.set(language, dictionary)
    notify()
    return () => {
      byLanguage.delete(language)
    }
  }
  return {
    state,
    register,
    addLanguage(language) {
      const id = language?.id
      if (typeof id !== 'string') throw new Error('locale.addLanguage: language.id must be a string')
      if (languages.has(id)) {
        const message = 'locale "' + id + '" is already registered'
        rejections.push({ service: 'locale', method: 'addLanguage', message })
        throw new Error(message)
      }
      languages.set(id, language)
      notify()
      return () => {
        languages.delete(id)
      }
    },
    languages() {
      return [...languages.keys()]
    },
    namespaces() {
      // A namespace whose last locale was released is gone, not "still there".
      return [...dictionaries.keys()].filter((namespace) => dictionaries.get(namespace).size > 0).sort()
    },
    bind(namespace) {
      return (key) => {
        const dictionary = dictionaries.get(namespace)?.get(state.active)
        const value = dictionary?.[key]
        return typeof value === 'string' ? value : namespace + '.' + key
      }
    },
    getLocale() {
      return { active: state.active, languages: [...languages.keys()] }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * configForms service: one form per entry id. The snapshot starts with NO
 * stored section (value undefined — the real "this profile has nothing yet"
 * shape), and set/mutate publish a new pinned revision.
 */
function createConfigForms() {
  const forms = new Map()
  const createForm = (entryId) => {
    const state = { value: undefined, revision: 0 }
    const listeners = new Set()
    const notify = () => {
      for (const listener of [...listeners]) listener()
    }
    const commit = (next) => {
      state.value = next
      state.revision += 1
      notify()
    }
    const applyOps = (ops) => {
      const next = state.value === undefined ? {} : { ...state.value }
      for (const op of ops ?? []) {
        if (op?.op !== 'set' || !Array.isArray(op.path)) continue
        const [field] = op.path
        next[field] = op.value
      }
      commit(next)
    }
    return {
      entryId,
      getSnapshot() {
        return {
          status: 'ready',
          mode: 'device',
          revision: state.revision,
          value: state.value,
          user: undefined,
          writable: true,
        }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      set(field, value) {
        const next = state.value === undefined ? {} : { ...state.value }
        next[field] = value
        commit(next)
        return Promise.resolve(true)
      },
      mutate(ops) {
        applyOps(ops)
        return Promise.resolve(true)
      },
    }
  }
  return {
    get(entryId) {
      if (!forms.has(entryId)) forms.set(entryId, createForm(entryId))
      return forms.get(entryId)
    },
    whileServed(_entryIds, callback) {
      const result = callback()
      return () => {
        if (typeof result === 'function') result()
      }
    },
    entries() {
      return [...forms.keys()].sort()
    },
  }
}

/** One shared host: the services both artifacts receive through ctx. */
function createHost(browser) {
  const rejections = []
  const events = createEventBus()
  const theme = new FakeThemeRuntime(events, rejections)
  const slots = createSlots(rejections)
  const locale = createLocale(rejections)
  const configForms = createConfigForms()
  const services = { theme, slots, locale, configForms }
  const react = createReact()
  const jsxRuntime = createJsxRuntime(react)
  const externals = new Map()

  return {
    browser,
    events,
    theme,
    slots,
    locale,
    configForms,
    services,
    rejections,
    /** Every fiber this host has started, in order (reporting only). */
    installations: [],
    /** The frozen loader table: react + the jsx runtime; everything else is a stub. */
    require(id) {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return jsxRuntime
      if (!externals.has(id)) externals.set(id, createEmptyModule(id))
      return externals.get(id)
    },
    externals() {
      return [...externals.keys()].sort()
    },
  }
}

// ---------------------------------------------------------------------------
// Loading the real artifacts into the fake host
// ---------------------------------------------------------------------------

/** Evaluate one artifact and capture its window.__ModuleLoader__.load spec. */
function loadArtifact(file, browser) {
  const code = readFileSync(file, 'utf8')
  const captures = []
  const windowStub = browser.createWindowStub(captures)
  // eslint-disable-next-line no-new-func -- the artifact IS a script for the loader
  new Function('window', code)(windowStub)
  if (captures.length !== 1) {
    throw new Error(file + ': expected exactly one window.__ModuleLoader__.load call, saw ' + captures.length)
  }
  const spec = captures[0]
  if (spec === null || typeof spec !== 'object' || typeof spec.factory !== 'function') {
    throw new Error(file + ': the captured spec has no factory')
  }
  return { file, id: spec.id, factory: spec.factory, bytes: Buffer.byteLength(code) }
}

/**
 * Install one artifact: run factory(require), then apply(ctx).
 *
 * Every ctx.effect the artifact registers is recorded under this install, so
 * "unload only Moonset" can release exactly that fiber's work.
 */
function installArtifact(artifact, host, label) {
  const record = {
    label,
    id: artifact.id,
    file: artifact.file,
    requests: [],
    effects: [],
    injections: [],
    exports: undefined,
    ctx: undefined,
  }
  const requireStub = (id) => {
    if (typeof id !== 'string') throw new Error(label + ': require() called with a non-string id')
    record.requests.push(id)
    return host.require(id)
  }
  host.browser.state.phase = 'factory'
  const exports = artifact.factory(requireStub)
  if (exports === null || typeof exports !== 'object') {
    throw new Error(label + ': factory returned ' + (exports === null ? 'null' : typeof exports) + ', expected module.exports')
  }
  if (typeof exports.apply !== 'function') {
    throw new Error(label + ': module.exports.apply is not a function')
  }
  record.exports = exports
  return applyAgain(record, host, label)
}

/**
 * Call apply() on an ALREADY LOADED module instance with a fresh fiber.
 *
 * This is the realistic re-activation shape (the loader keeps one module per
 * id), and it is where this plugin's per-runtime memo shows: the second fiber
 * reuses the first fiber's registration instead of colliding with it.
 */
function applyAgain(record, host, label) {
  const again = {
    label,
    id: record.id,
    file: record.file,
    // The module table belongs to the MODULE, so every fiber of one instance
    // reports the same request set (a re-apply does not re-run the factory).
    requests: record.requests,
    effects: [],
    injections: [],
    exports: record.exports,
    ctx: undefined,
  }
  const ctx = createContext(host, again)
  again.ctx = ctx
  host.installations.push(again)
  host.browser.state.phase = 'apply'
  record.exports.apply(ctx)
  return again
}

/** The per-fiber context facade: services + the lifecycle sinks. */
function createContext(host, record) {
  const ctx = {
    // Both artifacts read the services differently: ours off ctx.theme, the
    // peer off ctx.get('theme'). A real cordis context offers both.
    theme: host.services.theme,
    slots: host.services.slots,
    locale: host.services.locale,
    configForms: host.services.configForms,
    effect(run, label) {
      const result = run()
      const dispose = typeof result === 'function' ? result : () => {}
      record.effects.push({ label: String(label ?? '(unlabelled)'), dispose })
      return dispose
    },
    inject(deps, callback) {
      const names = Array.isArray(deps) ? deps : []
      const available = names.every((name) => host.services[name] !== undefined)
      record.injections.push({ deps: names, fired: available })
      let dispose = () => {}
      if (available) {
        const scoped = { ...ctx }
        for (const name of names) scoped[name] = host.services[name]
        const result = callback(scoped)
        if (typeof result === 'function') dispose = result
      }
      let disposed = false
      return {
        async dispose() {
          if (disposed) return
          disposed = true
          dispose()
        },
      }
    },
    get(name) {
      return host.services[name]
    },
    on(event, handler) {
      return host.events.on(event, handler)
    },
    emit(event, payload) {
      return host.events.emit(event, payload)
    },
  }
  return ctx
}

/** Release one fiber: every ctx.effect disposer, newest first. */
function unloadArtifact(record) {
  const released = []
  for (const effect of [...record.effects].reverse()) {
    effect.dispose()
    released.push(effect.label)
  }
  record.effects.length = 0
  return released
}

// ---------------------------------------------------------------------------
// Report plumbing
// ---------------------------------------------------------------------------

function createReporter() {
  const results = []
  return {
    results,
    async check(index, title, run) {
      try {
        const detail = await run()
        results.push({ index, title, ok: true, detail })
        console.log('PASS  ' + index + '. ' + title)
        for (const line of String(detail ?? '').split('\n')) if (line !== '') console.log('        ' + line)
      } catch (error) {
        results.push({ index, title, ok: false, detail: describe(error) })
        console.log('FAIL  ' + index + '. ' + title)
        console.log('        ' + describe(error))
      }
    },
    passed() {
      return results.filter((result) => result.ok).length
    },
    failed() {
      return results.filter((result) => !result.ok)
    },
  }
}

/** A labelled block of plain text (observations, inventories). */
function block(title, lines) {
  console.log('')
  console.log(title)
  for (const line of lines) console.log('  ' + line)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { peer: peerPath, explicit } = parseArgs(process.argv.slice(2))

  if (!existsSync(OURS_ARTIFACT)) {
    console.error('coexist-check: our artifact is missing: ' + OURS_ARTIFACT)
    console.error('  run pnpm build first (the check drives the BUILT bundle, not src/).')
    process.exit(2)
  }
  if (!existsSync(peerPath)) {
    console.error('coexist-check: catppuccin artifact not found: ' + peerPath)
    console.error('  pass one explicitly: node scripts/coexist-check.mjs --catppuccin <path to dsh-catppuccin-theme/lib/client.js>')
    process.exit(2)
  }

  console.log('M7 共存验收（假宿主）— 两个真实构建产物同装')
  console.log('  ours:       ' + OURS_ARTIFACT)
  console.log('  catppuccin: ' + peerPath + (explicit ? '' : '  (默认同级目录)'))

  const browser = createBrowser()
  console.log('  require（静态扫描）：ours ' + describeStaticRequires(readFileSync(OURS_ARTIFACT, 'utf8'))
    + ' | catppuccin ' + describeStaticRequires(readFileSync(peerPath, 'utf8')))
  console.log('')

  browser.installGlobals()
  const consoleLog = captureConsole()

  try {
    browser.state.phase = 'load'
    const oursArtifact = loadArtifact(OURS_ARTIFACT, browser)
    const peerArtifact = loadArtifact(peerPath, browser)
    const host = createHost(browser)
    const reporter = createReporter()

    // --- setup: install both REAL artifacts into the SAME host -------------
    browser.state.phase = 'apply'
    const ours = installArtifact(oursArtifact, host, 'moonset')
    const peer = installArtifact(peerArtifact, host, 'catppuccin')

    const shared = {
      ourSection: undefined,
      ourProps: undefined,
      peerSection: undefined,
      peerFlavor: undefined,
      peerSource: undefined,
      oursAgain: undefined,
      oursCopy: undefined,
      peerAgain: undefined,
      peerCopy: undefined,
      drift: undefined,
    }

    // --- 1 ----------------------------------------------------------------
    await reporter.check(1, '双产物 apply 成功，注册表恰好 6 个插件 id（4 catppuccin-* + 2 moonset-*）', () => {
      // Catppuccin registers themes LAZILY (item JJ in its own source: only the
      // active flavour is registered, the rest on first selection). Driving its
      // own settings row is the documented way to put the other three in the
      // registry; nothing here touches its internals.
      shared.peerSection = host.slots.find('settings.section', 'catppuccin')
      assert(shared.peerSection !== undefined, 'catppuccin did not register its settings.section row')
      shared.peerFlavor = shared.peerSection.entry.inject().flavor
      const selected = []
      for (const id of PEER_THEME_IDS) {
        shared.peerFlavor.select(id)
        selected.push(id)
      }

      // Our row renders through the lazy require(react); render it once so the
      // module table in check 6 is the real one (and prove the 3 buttons).
      shared.ourSection = host.slots.find('settings.section', 'moonset')
      assert(shared.ourSection !== undefined, 'moonset did not register its settings.section row')
      shared.ourProps = shared.ourSection.entry.inject()
      const ourButtons = collectButtons(shared.ourSection.component(shared.ourProps))

      // Host-semantics probe BEFORE any count is trusted: this fake must be able
      // to MAKE registration fail, otherwise "6 ids" proves nothing at all.
      assertThrows(
        () => host.theme.register({ id: OUR_THEME_IDS[0], colorScheme: 'light', tokens: {} }),
        /already registered/u,
        'theme.register(duplicate id)',
      )
      assertThrows(
        () => host.theme.setTheme('moonset-not-a-theme'),
        /is not registered/u,
        'theme.setTheme(unregistered id)',
      )
      assertThrows(
        () => host.slots.register({ name: 'settings.section', id: 'catppuccin' }),
        /already has an entry/u,
        'slots.register(duplicate id)',
      )

      const ids = host.theme.registeredIds()
      assert(ids.length === 6, 'registry holds ' + ids.length + ' plugin ids, expected 6: ' + ids.join(', '))
      assert(includesAll(ids, OUR_THEME_IDS), 'missing our ids in registry: ' + ids.join(', '))
      assert(includesAll(ids, PEER_THEME_IDS), 'missing peer ids in registry: ' + ids.join(', '))
      const peers = ids.filter((id) => !OUR_THEME_IDS.includes(id))
      assert(peers.length === 4 && peers.every((id) => id.startsWith('catppuccin-')), 'peer ids are not the four catppuccin-*: ' + peers.join(', '))
      assert(ourButtons.length === 3, 'our settings row rendered ' + ourButtons.length + ' buttons, expected 3')
      return [
        'registry = 6 plugin ids: ' + ids.slice().sort().join(', '),
        '宿主语义探针：theme.register(重复 id) 抛 "already registered"、theme.setTheme(未注册 id) 抛 "is not registered"、slots.register(重复 id) 抛 "already has an entry" —— 「6 个 id」不是空口径',
        'built-ins present but not counted: ' + BUILTIN_THEME_IDS.join(', ') + ' (snapshot carries ' + host.theme.themes.length + ' definitions)',
        'catppuccin 惰性注册路径：其 settings.section 的 flavor.select() 依次选中 ' + selected.join(' → ') + '（该产物自己的注册入口，非内部符号）',
        'ours: settings.section 已注册；渲染其组件得到 ' + ourButtons.length + ' 个 button（' + ourButtons.map((button) => button.label).join(' / ') + '）',
      ].join('\n')
    })

    // --- 2 ----------------------------------------------------------------
    await reporter.check(2, '两边各自再 apply 一次：不抛错，注册表仍是 6（tolerant 生效）', async () => {
      const before = host.rejections.length
      // (a) same module instance, second fiber — the realistic re-activation.
      shared.oursAgain = applyAgain(ours, host, 'moonset(apply#2)')
      shared.peerAgain = applyAgain(peer, host, 'catppuccin(apply#2)')
      const afterAgain = host.theme.registeredIds()
      assert(afterAgain.length === 6, 'registry changed after the second apply: ' + afterAgain.join(', '))
      // (b) a SECOND COPY of the package: factory re-evaluated, so the module's
      // own memo is empty and every registration really collides. This is the
      // D3 trigger ("another copy of the same plugin is installed").
      browser.state.phase = 'reapply'
      // Park the preference away from the peer's stored flavour: a re-applied
      // fiber then has to walk the register-a-flavour path.
      host.theme.setTheme('system')
      shared.oursCopy = installArtifact(oursArtifact, host, 'moonset#copy')
      shared.peerCopy = installArtifact(peerArtifact, host, 'catppuccin#copy')
      await flush()
      const ids = host.theme.registeredIds()
      assert(ids.length === 6, 'registry grew/shrank to ' + ids.length + ': ' + ids.join(', '))
      assert(includesAll(ids, [...OUR_THEME_IDS, ...PEER_THEME_IDS]), 'registry contents changed: ' + ids.join(', '))
      const swallowed = host.rejections.slice(before)
      const themeCollisions = swallowed.filter((entry) => entry.service === 'theme' && entry.method === 'register')
      assert(
        themeCollisions.length >= OUR_THEME_IDS.length,
        're-apply never reached the duplicate-id path (' + themeCollisions.length + ' theme collisions) — tolerance was not exercised',
      )
      const grouped = groupBy(swallowed, (entry) => entry.service + '.' + entry.method)
      const lines = Object.entries(grouped).map(([key, list]) => {
        const messages = [...new Set(list.map((entry) => entry.message))]
        const shown = messages.length <= 2 ? messages.join('；') : messages[0] + '；…（' + messages.length + ' 种键）'
        return '  ' + key + ' ×' + list.length + ' — ' + shown
      })
      return [
        '(a) 同一模块实例再 apply 一次：registry 仍 ' + afterAgain.length + '（本插件的 runtime 记忆化生效，PLAN 债 #4）',
        '(b) 再装一份（factory 重新求值，模拟同一包装了两份）：registry 仍 ' + ids.length + ': ' + ids.slice().sort().join(', '),
        '宿主按真实语义抛出的重复注册 ' + swallowed.length + ' 条，全部被两边 tolerantRegistration 吞掉、apply 未抛：',
        ...(lines.length === 0 ? ['  （无重复被触发）'] : lines),
      ].join('\n')
    })

    // --- 3 ----------------------------------------------------------------
    await reporter.check(3, '6 个主题逐个 setTheme：preference 跟随，且每次都触发 theme/change', () => {
      const order = [...OUR_THEME_IDS, ...PEER_THEME_IDS]
      host.theme.setTheme('system')
      const rows = []
      for (const id of order) {
        let events = 0
        const off = host.events.on('theme/change', () => {
          events += 1
        })
        browser.state.phase = 'switch'
        const before = host.theme.getTheme().preference
        host.theme.setTheme(id)
        off()
        const after = host.theme.getTheme().preference
        assert(after === id, 'setTheme("' + id + '") from "' + before + '" left preference "' + after + '"')
        assert(events >= 1, 'setTheme("' + id + '") published no theme/change')
        rows.push(id + ' ← ' + before + '（theme/change ×' + events + '）')
      }
      browser.state.phase = 'observe'
      return [
        ...rows,
        '判定口径：PLAN M7 原文「6 个主题逐个切换后 preference 跟随」= setTheme 的同步语义（runtime 同步 publish）',
        'microtask 之后的漂移单列在「观测」一节，未藏起来',
      ].join('\n')
    })

    // --- 4 ----------------------------------------------------------------
    await reporter.check(4, '跟随层互不误删：撤我们的层不删它的层，反之亦然', () => {
      browser.state.phase = 'layers'
      const revisionBefore = host.theme.getTheme().revision
      shared.peerFlavor.setFollowSystem(true)
      shared.ourProps.onPick('follow')
      const layered = [...host.theme.overrides.keys()]
      assert(host.theme.overrides.has(OURS_LAYER_SOURCE), 'our layer missing after follow: ' + layered.join(', '))
      const peerSources = layered.filter((source) => source !== OURS_LAYER_SOURCE)
      assert(peerSources.length === 1, 'expected exactly one peer layer, saw ' + layered.join(', '))
      const peerSource = peerSources[0]
      shared.peerSource = peerSource

      shared.ourProps.onPick('light')
      assert(!host.theme.overrides.has(OURS_LAYER_SOURCE), 'our layer survived the light pick')
      assert(host.theme.overrides.has(peerSource), 'removing our layer also removed the peer layer (' + peerSource + ')')

      shared.ourProps.onPick('follow')
      assert(host.theme.overrides.has(OURS_LAYER_SOURCE) && host.theme.overrides.has(peerSource), 'layers did not stack again')

      shared.peerFlavor.setFollowSystem(false)
      assert(!host.theme.overrides.has(peerSource), 'peer layer survived setFollowSystem(false)')
      assert(host.theme.overrides.has(OURS_LAYER_SOURCE), 'removing the peer layer also removed ours')

      shared.peerFlavor.setFollowSystem(true)
      assert(host.theme.overrides.has(OURS_LAYER_SOURCE) && host.theme.overrides.has(peerSource), 'layers not both stacked before check 5')
      const stack = [...host.theme.overrides.entries()].map(([source, layer]) => source + '@' + layer.seq)
      return [
        '我们的层 source = ' + OURS_LAYER_SOURCE + '（' + Object.keys(host.theme.overrides.get(OURS_LAYER_SOURCE).tokens).length + ' 条 {light,dark} 对）',
        '它的层 source = ' + peerSource + '（' + Object.keys(host.theme.overrides.get(peerSource).tokens).length + ' 条）',
        '栈序（seq）：' + stack.join(' < '),
        '两个 disposer 都只按自己的 source 删除（真实 runtime 语义：layer 身份比较，撤旧不撤新）',
        '快照 revision：' + revisionBefore + ' → ' + host.theme.getTheme().revision,
      ].join('\n')
    })

    // --- drift probe: does the peer undo a Moonset pick? -------------------
    // Not one of the six checks: it MEASURES the peer's restore policy so the
    // report cannot pretend the two plugins never disagree.
    shared.drift = await probePeerRestore(host, shared, browser)

    // --- 5 ----------------------------------------------------------------
    await reporter.check(5, '只释放 moonset 的 effect（卸载我们）→ 注册表剩 4 个 catppuccin，它的层仍在', () => {
      browser.state.phase = 'unload'
      const peerSource = shared.peerSource
      assert(peerSource !== undefined, 'peer layer is missing before unload')
      const revisionBefore = host.theme.getTheme().revision
      const released = unloadArtifact(ours)
      const releasedAgain = unloadArtifact(shared.oursAgain)
      const releasedCopy = unloadArtifact(shared.oursCopy)
      const ids = host.theme.registeredIds()
      assert(ids.length === 4, 'registry holds ' + ids.length + ' after unload, expected 4: ' + ids.join(', '))
      assert(ids.every((id) => id.startsWith('catppuccin-')), 'non-catppuccin id survived: ' + ids.join(', '))
      assert(host.theme.overrides.has(peerSource), 'peer layer was removed by our unload (' + peerSource + ')')
      assert(!host.theme.overrides.has(OURS_LAYER_SOURCE), 'our layer survived our unload')
      browser.state.phase = 'observe'
      return [
        '释放的 effect（' + released.length + '）：' + released.join(' | '),
        '第二 fiber（apply#2）释放 ' + releasedAgain.length + ' 个：其 theme 注册与首份共享同一 disposer，已 no-op（PLAN 债 #4 的现场记录）',
        '第二份拷贝（factory 重新求值）释放 ' + releasedCopy.length + ' 个：其 registrations 当初全部 skipped',
        'registry = 4: ' + ids.slice().sort().join(', '),
        'peer layer ' + peerSource + ' 仍在（seq ' + host.theme.overrides.get(peerSource).seq + '）',
        '我们卸载时 follow.disable() 只撤了 dsh-moonset 的层；revision ' + revisionBefore + ' → ' + host.theme.getTheme().revision,
      ].join('\n')
    })

    // --- 6 ----------------------------------------------------------------
    await reporter.check(6, 'require 请求集合只含 react* / @deepseek-ai/*（列出全部请求过的模块）', () => {
      const records = [ours, peer, shared.oursAgain, shared.peerAgain, shared.oursCopy, shared.peerCopy].filter(Boolean)
      const unexpected = []
      const lines = []
      for (const record of records) {
        const requests = [...new Set(record.requests)].sort()
        const bad = requests.filter((id) => !PLATFORM_MODULE.test(id))
        unexpected.push(...bad)
        lines.push(record.label + '：' + (requests.length === 0 ? '(无)' : requests.join(', ')))
      }
      assert(unexpected.length === 0, 'unexpected module ids requested: ' + [...new Set(unexpected)].join(', '))
      return [
        ...lines,
        '宿主以空 Proxy 兜底的模块：' + (host.externals().length === 0 ? '(无)' : host.externals().join(', ')),
        'ours 的 react 是惰性 require（首次渲染 settings.section 才取，所以 moonset#copy 显示「无」：它的 section 注册因重复被 skip，没有可渲染的入口）',
        'catppuccin 在 factory 里就取 react / react/jsx-runtime / ui-primitives；三者都在 @deepseek-ai/* 或 react 允许集内',
      ].join('\n')
    })

    // --- observations (not pass/fail) -------------------------------------
    const settled = await observeSettled(host)
    printObservations({ host, browser, consoleLog, settled, drift: shared.drift })

    const total = reporter.results.length
    const passed = reporter.passed()
    const failed = reporter.failed()
    console.log('')
    console.log('结果：' + passed + '/' + total + ' PASS' + (failed.length === 0 ? '' : '，FAIL ' + failed.map((result) => result.index).join(', ')))
    process.exitCode = failed.length === 0 ? 0 : 1

    // Release the peer too so its timers/listeners do not outlive the run.
    unloadArtifact(peer)
    unloadArtifact(shared.peerAgain)
    unloadArtifact(shared.peerCopy)
  } finally {
    consoleLog.restore()
    browser.uninstallGlobals()
  }
}

function describeStaticRequires(source) {
  const ids = new Set()
  for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/gu)) ids.add(match[1])
  return ids.size === 0 ? '(none)' : [...ids].sort().join(', ')
}

function collectButtons(tree) {
  const found = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.type === 'button') found.push({ label: flattenText(node.children) })
    walk(node.children)
  }
  walk(tree)
  return found
}

function flattenText(children) {
  const parts = []
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node === 'object') walk(node.children)
  }
  walk(children)
  return parts.join('')
}

/**
 * Measure what Catppuccin's restore guard does to a Moonset pick.
 *
 * Its source only lets an EXPLICIT built-in pick (light/dark) win
 * (builtinPickWins + liveBuiltinPick); a third-party id is not a built-in, so
 * the peer re-asserts its own persisted flavour one microtask later. This is
 * recorded as an OBSERVATION — the six mandated checks are the synchronous
 * ones PLAN M7 asks for — but it must never be hidden from the operator.
 */
async function probePeerRestore(host, shared, browser) {
  const result = {
    stored: browser.storage.get('dsh.catppuccin.flavor'),
    picked: 'moonset-dark',
    before: undefined,
    immediate: undefined,
    settled: undefined,
    error: undefined,
  }
  try {
    // Follow mode off: measure the FLAVOUR restore path, not the follow one.
    shared.peerFlavor.setFollowSystem(false)
    result.before = host.theme.getTheme().preference
    host.theme.setTheme(result.picked)
    result.immediate = host.theme.getTheme().preference
    await flush()
    await flush()
    result.settled = host.theme.getTheme().preference
  } catch (error) {
    result.error = describe(error)
  } finally {
    // Leave both layers stacked: that is the state check 5 starts from.
    try {
      shared.ourProps.onPick('follow')
      shared.peerFlavor.setFollowSystem(true)
    } catch (error) {
      result.error = result.error ?? describe(error)
    }
  }
  return result
}

/** Read the preference once every queued microtask has run. */
async function observeSettled(host) {
  const before = host.theme.getTheme().preference
  await flush()
  await flush()
  const after = host.theme.getTheme().preference
  return { before, after }
}

function captureConsole() {
  const saved = { warn: console.warn, error: console.error }
  const warnings = []
  const errors = []
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  console.error = (...args) => errors.push(args.map(String).join(' '))
  return {
    warnings,
    errors,
    restore() {
      console.warn = saved.warn
      console.error = saved.error
    },
  }
}

function printObservations({ host, browser, consoleLog, settled, drift }) {
  const switchWrites = browser.writesDuring('switch')
  const driftLine = drift === undefined || drift.error !== undefined
    ? '漂移探针失败：' + (drift?.error ?? '未运行')
    : '存了 ' + JSON.stringify(drift.stored) + ' 时 setTheme(' + JSON.stringify(drift.picked) + ')：同步 ' + drift.immediate
      + ' → settle 后 ' + drift.settled
      + (drift.immediate === drift.settled ? '（未被改回）' : '（被 catppuccin 的 restore guard 改回它自己存的 flavor —— M7 的 6 条检查不覆盖此行为，见交付报告的「发现」）')
  block('观测（不计入 6 条检查，但属于 M7 现场证据）', [
    'setTheme 期间的 DOM 写：' + switchWrites.length + ' 条'
      + (switchWrites.length === 0 ? '（两边都没碰 DOM）' : ' ← ' + describeWrites(switchWrites)),
    '全流程 DOM 写：' + browser.writes.length + ' 条（按阶段：' + describePhases(browser.writes) + '）；DOM 读：' + browser.reads.length + ' 条',
    'document.body.dataset.dshGlass = ' + JSON.stringify(browser.body.dataset.dshGlass)
      + '；html/body 上的 data-dsh-glass* 属性：' + describeGlassAttributes(browser),
    driftLine,
    '最终 settled preference：' + settled.before + ' → ' + settled.after,
    'console.warn ' + consoleLog.warnings.length + ' 条 / console.error ' + consoleLog.errors.length + ' 条' + describeMessages(consoleLog),
    'fetch 调用：' + browser.fetchCalls.length + ' 次' + (browser.fetchCalls.length === 0 ? '（零联网）' : '：' + browser.fetchCalls.join(', ')),
    'theme 注册表：' + host.theme.themes.map((theme) => theme.id + (theme.builtin === true ? '(builtin)' : '(' + Object.keys(theme.tokens).length + ' tokens)')).join(', '),
    'slots 注册项：' + (host.slots.names().map((name) => name + '[' + host.slots.entries(name).map((entry) => entry.identity).join('+') + ']').join(', ') || '(无)'),
    'locale 命名空间：' + host.locale.namespaces().join(', ') + '；语言：' + host.locale.languages().join(', '),
    'configForms 条目：' + (host.configForms.entries().join(', ') || '(无)'),
    '本地存储键：' + ([...browser.storage.keys()].sort().join(', ') || '(空)'),
    'window storage 监听器：' + (browser.windowListeners.get('storage')?.size ?? 0) + ' 个',
    'ctx.inject 记录：' + describeInjections(host),
    'theme 运行时调用计数：' + describeThemeLog(host.theme.log),
  ])
  console.log('')
  console.log('  说明：')
  console.log('    - 「6 个 id」不含 runtime 自带的 light/dark 两枚内置主题；内置主题只用于解析 system。')
  console.log('    - catppuccin 只注册当前 flavor（其源码 item JJ 的惰性策略），四条是经它自己的设置行选中得到的。')
  console.log('    - 第 3 条按 PLAN 的同步口径判定；settled 漂移单列在上面的观测里，未藏起来。')
}

function describeThemeLog(log) {
  const counts = new Map()
  for (const entry of log) counts.set(entry.op, (counts.get(entry.op) ?? 0) + 1)
  if (counts.size === 0) return '(无)'
  return [...counts.entries()].map(([op, count]) => op + ' ×' + count).join(', ')
}

function describeInjections(host) {
  const lines = []
  for (const record of host.installations ?? []) {
    if (record.injections.length === 0) continue
    lines.push(record.label + ' [' + record.injections.map((entry) => entry.deps.join('+') + (entry.fired ? '→fired' : '→absent')).join(', ') + ']')
  }
  return lines.length === 0 ? '(无)' : lines.join(' | ')
}

function describeWrites(writes) {
  return writes.map((entry) => entry.op + ':' + entry.detail).join(', ')
}

function describePhases(writes) {
  const phases = new Map()
  for (const entry of writes) phases.set(entry.phase, (phases.get(entry.phase) ?? 0) + 1)
  return [...phases.entries()].map(([phase, count]) => phase + ':' + count).join(', ')
}

function describeGlassAttributes(browser) {
  const names = [...browser.html.attributes.keys(), ...browser.body.attributes.keys()].filter((name) => name.startsWith('data-dsh-glass'))
  return names.length === 0 ? '无' : names.join(', ')
}

function describeMessages(consoleLog) {
  const all = [...consoleLog.warnings, ...consoleLog.errors]
  if (all.length === 0) return ''
  const unique = [...new Set(all)]
  return '：' + unique.slice(0, 4).join(' ⏎ ') + (unique.length > 4 ? ' …(+' + (unique.length - 4) + ')' : '')
}

main().catch((error) => {
  console.error('')
  console.error('coexist-check: 运行失败（未吞异常）')
  console.error('  ' + describe(error))
  if (error !== null && typeof error === 'object' && error.cause !== undefined) {
    console.error('  cause: ' + describe(error.cause))
  }
  if (error instanceof ReferenceError) {
    console.error('  这通常意味着产物需要某个平台全局（document/localStorage/…）而假宿主没提供：补宿主，不要 try/catch 吞掉。')
  }
  if (error instanceof Error && typeof error.stack === 'string') {
    console.error(error.stack.split('\n').slice(0, 6).map((line) => '  ' + line).join('\n'))
  }
  process.exit(1)
})
