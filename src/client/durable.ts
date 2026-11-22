/**
 * The plugin's OWN durable choice (M5) — the reason the official theme
 * preference cannot do this job.
 *
 * `theme.setTheme(id)` writes the user-settings document only for `system` /
 * `light` / `dark`; a third-party id such as `moonset-light` lives in the
 * runtime's MEMORY preference, and `adopt()` overwrites that memory with the
 * document value on every echo. So a restart forgets any third-party theme.
 * The durable store for this plugin is therefore the settings form the Host
 * projects from its volatile `Config`, addressed by the profile ENTRY id:
 *
 *   `ctx.configForms.get('dsh-moonset')`  →  `{ choice }`  →  `form.set('choice', …)`
 *
 * Scope of this module (deliberately small, and deliberately DOM-free):
 * read, write, flush, notify, dispose, and the LOCAL-WRITE CLOCK. It never
 * touches styles, never calls `setTheme`, and never applies a policy —
 * `choice.ts` owns the policy and `index.ts` owns the wiring.
 *
 * **M5.1 — the echo race and the fast-switch guard.** Two mechanisms live down
 * here, below the policy, so `choice.ts` stays a pure function:
 *
 *  - **A write QUEUE (`WRITE_DEBOUNCE_MS`, last value wins).** A pick becomes
 *    an INTENT rather than an immediate write: three clicks inside one burst
 *    land as ONE settings write carrying the last value. {@link
 *    DurableChoice.flush} lands it early, and {@link DurableChoice.dispose}
 *    flushes before the form is released, so an unload can never swallow a
 *    click that has not reached the document yet.
 *  - **An INTENT WATERMARK.** While an intent is unlanded, {@link
 *    DurableChoice.read} answers with the INTENT — a document echo cannot
 *    become the local answer, hence cannot be re-applied over a newer pick.
 *    Once a snapshot has been accepted, any echo carrying a revision BELOW the
 *    accepted high-water mark is dropped as out of order.
 *
 * The invariant that keeps both honest: `write()` is called by user actions
 * and by the mirror rule in `index.ts` only; the echo path NEVER writes back,
 * so a late snapshot can only ever be ignored, never re-persisted.
 *
 * **M5.2 — the local-write clock.** The one echo this module cannot dismiss
 * with a watermark is the RUNTIME's own `adopt()` (`dsh-client-ui-theme`
 * subscribes to its settings scope in its constructor, `lib/client.js:1681`):
 * an accepted settings write makes it copy the document's built-in
 * `preference` over the third-party id we just set. `index.ts` answers that
 * with a re-assert, and it needs to know whether the built-in it just saw is an
 * echo: {@link DurableChoice.sinceLastWrite} answers that, and a QUEUED intent
 * counts — its echo is already on its way.
 *
 * Degradation is the pre-M5 status quo, never a crash: a host that serves no
 * `configForms` service (or no form for this entry) reports `off` and warns on
 * write, so the section still switches themes for the session — it just cannot
 * remember them.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { resolveChoice, type MoonsetChoice } from './choice.ts'

/**
 * The profile entry id — the `cordis.patch.yml` insert id, the plugin `name`,
 * and the argument of `configForms.get(...)`, all one string.
 *
 * Restated here rather than imported from `./index.ts` (the Host half): that
 * module imports schemastery at module scope, and pulling it into the browser
 * bundle would trip the client bundle-purity gate. `tests/settings.spec.ts`
 * cross-checks the two exports instead of trusting the copies.
 */
export const MOONSET_ENTRY_ID = 'dsh-moonset'

/**
 * How long one pick waits for the burst to end before it is persisted (M5.1).
 *
 * Long enough that a double click — or a click that corrects a misread row —
 * lands as a single write; short enough that a deliberate single pick is
 * durable inside the same interaction. Exported so the tests advance exactly
 * this window instead of restating a magic number.
 */
export const WRITE_DEBOUNCE_MS = 300

/**
 * How long after a LOCAL write an official-looking preference may still be the
 * echo of that write rather than a user action (M5.2).
 *
 * The official runtime adopts the settings document into its memory preference
 * on every settings write (`host.subscribe(() => this.adopt())`,
 * `dsh-client-ui-theme/lib/client.js:1681`), so our own `form.set('choice', …)`
 * can revert a third-party preference to the document's built-in value. Inside
 * this window the plugin re-asserts its theme instead of believing the change;
 * outside it, a built-in preference is a real user action again. Exported so
 * the tests advance exactly this window instead of restating a magic number.
 */
export const RESTORE_WINDOW_MS = 1500

/** The section the Host's volatile `Config` projects (client view: plain values). */
export interface MoonsetSettingsSection {
  /** One of `MoonsetChoice`'s values; unknown while the form is still loading. */
  choice?: unknown
}

/** The small durable surface the settings section and the boot path consume. */
export interface DurableChoice {
  /**
   * The user's CURRENT choice: a queued intent when one exists, otherwise the
   * last value the form told us. Never a value older than the local pick.
   */
  read(): MoonsetChoice
  /**
   * Record an intent and queue it for persistence (debounced, last value
   * wins). Never called by the echo path.
   */
  write(choice: MoonsetChoice): void
  /** Land a queued intent now instead of waiting for the window. Idempotent. */
  flush(): void
  /** Observe accepted snapshot changes and late bindings; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Flush, then release the form listener and the injection fiber. Safe twice. */
  dispose(): void
  /**
   * Epoch milliseconds of the most recent LOCAL write — the moment an intent
   * was queued or a queued intent reached the form — or 0 when nothing was
   * ever written (M5.2).
   */
  lastWriteAt(): number
  /**
   * Milliseconds since {@link lastWriteAt}; `Infinity` before the first local
   * write. A queued intent counts: the echo it provokes is already on its way.
   */
  sinceLastWrite(): number
  /** Writes that actually reached the form (diagnostics for the echo tests). */
  readonly writes: number
  /** The queued-but-unlanded intent, if any (the boot restore consults it). */
  readonly pendingLocal: MoonsetChoice | undefined
  /** Highest snapshot revision accepted as the document's answer (-1 = none). */
  readonly revision: number
}

/**
 * One line per failure, always prefixed, never thrown: this module is on the
 * client's boot path, where a throw takes the user's whole plugin set down.
 * @param what - the operation that failed.
 * @param error - the cause.
 */
function warn(what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[dsh-moonset] ${what} — ${message}`)
}

/**
 * Bind the Host-projected settings form for this plugin and expose it as a
 * read/write/flush/subscribe facade.
 *
 * The binding is late and optional: `ctx.inject(['configForms'], …)` fires once
 * the settings service is available (immediately on a composed host), and the
 * callback's returned disposer rides the caller's fiber. Until it fires, the
 * facade reports `off` — the same answer a profile with no stored section
 * gives, which is what the boot path treats as "leave the official theme
 * alone".
 * @param ctx - client root context.
 * @returns the durable facade, bound for the lifetime of the caller's fiber.
 */
export function createDurableChoice(ctx: ClientContext): DurableChoice {
  let form: ConfigForm<MoonsetSettingsSection> | undefined
  let releaseForm: (() => void) | undefined
  let fiber: ReturnType<ClientContext['inject']> | undefined
  let disposed = false
  let writes = 0

  /** Last value the FORM told us and we accepted — the document's own answer. */
  let confirmed: MoonsetChoice = 'off'
  /** Whether {@link confirmed} was seeded from a live snapshot. */
  let seeded = false
  /** An intent the user (or the mirror rule) expressed that has not landed. */
  let pendingLocal: MoonsetChoice | undefined
  /** The intent already handed to the form and not echoed yet (one write each). */
  let sent: MoonsetChoice | undefined
  /** Highest accepted namespace revision; echoes below it are out of order. */
  let watermark = -1
  /** The pending debounce handle (cleared by flush/dispose). */
  let timer: ReturnType<typeof setTimeout> | undefined
  /**
   * When this plugin last wrote (epoch ms, 0 = never). Stamped when an intent
   * is QUEUED and again when it LANDS, because the settings echo follows the
   * landing, not the click (M5.2).
   */
  let lastWriteAtMs = 0

  const listeners = new Set<() => void>()

  const notify = (): void => {
    // Copied: a listener may unsubscribe from inside the notification.
    for (const listener of [...listeners]) listener()
  }

  /** Read one snapshot, narrowed to the two facts the guard needs. */
  const snapshotOf = (
    current: ConfigForm<MoonsetSettingsSection>,
  ): { value: MoonsetChoice; revision: number } | undefined => {
    try {
      const snapshot: ConfigFormSnapshot<MoonsetSettingsSection> = current.getSnapshot()
      return {
        value: resolveChoice(snapshot.value?.choice),
        revision: typeof snapshot.revision === 'number' ? snapshot.revision : watermark,
      }
    } catch (error) {
      warn('could not read the settings form', error)
      return undefined
    }
  }

  /** Adopt the document's answer once, without ever overriding an intent. */
  const seed = (): void => {
    if (seeded || pendingLocal !== undefined) return
    const current = form
    if (current === undefined) return
    const snapshot = snapshotOf(current)
    if (snapshot === undefined) return
    confirmed = snapshot.value
    seeded = true
    if (snapshot.revision > watermark) watermark = snapshot.revision
  }

  /**
   * Decide what one snapshot echo may change.
   *
   * Three rules, in priority order:
   *  1. an unlanded intent outranks every echo — the only echo it accepts is
   *     the one carrying its own value (that is the intent landing);
   *  2. a revision below the accepted high-water mark is an out-of-order echo
   *     and is dropped;
   *  3. an echo equal to the accepted answer changes nothing (no write, no
   *     re-apply).
   * @param value - the echo's narrowed choice.
   * @param revision - the echo's namespace revision.
   * @returns whether the accepted answer changed (and listeners must re-read).
   */
  const adopt = (value: MoonsetChoice, revision: number): boolean => {
    if (pendingLocal !== undefined) {
      if (value !== pendingLocal) return false
      pendingLocal = undefined
      sent = undefined
      confirmed = value
      seeded = true
      if (revision > watermark) watermark = revision
      return true
    }
    if (seeded && revision < watermark) return false
    if (seeded && value === confirmed) {
      if (revision > watermark) watermark = revision
      return false
    }
    confirmed = value
    seeded = true
    if (revision > watermark) watermark = revision
    return true
  }

  const onFormChange = (): void => {
    if (disposed) return
    const current = form
    if (current === undefined) return
    const snapshot = snapshotOf(current)
    if (snapshot === undefined) return
    // A discarded echo is not a state change: notifying here would let the
    // boot restore re-read (and potentially re-apply) a value we just refused.
    if (adopt(snapshot.value, snapshot.revision)) notify()
  }

  /**
   * Land the queued intent now.
   *
   * Safe to call with nothing queued (a no-op) and safe to call after a form
   * write already started: the intent stays set until an echo — or the write's
   * own settlement — confirms it, so a second flush cannot double-write it.
   */
  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    const value = pendingLocal
    if (value === undefined) return
    // One intent, one write: a second flush (an unload that lands after the
    // window closed but before the document echoed) must not re-send it. The
    // marker clears on the echo or on the write's own settlement.
    if (value === sent) return
    const current = form
    if (current === undefined) {
      // Only reachable when the form unbinds between the queue and the flush.
      pendingLocal = undefined
      sent = undefined
      warn('could not persist the pending choice', new Error(`no settings form for "${MOONSET_ENTRY_ID}"`))
      return
    }
    writes += 1
    sent = value
    // Landing is the moment the echo is provoked: the adopt() it wakes runs
    // right after the form accepts the write (M5.2).
    lastWriteAtMs = Date.now()
    let result: Promise<boolean>
    try {
      result = current.set('choice', value)
    } catch (error) {
      pendingLocal = undefined
      sent = undefined
      warn('settings write failed', error)
      return
    }
    try {
      // Fire-and-forget by contract. A rejected transport write must not
      // surface as an unhandled rejection.
      void Promise.resolve(result).then(
        () => {
          // A form whose commit does not notify still has to settle the
          // intent, otherwise every later echo would look stale forever.
          if (pendingLocal !== value) return
          pendingLocal = undefined
          sent = undefined
          confirmed = value
          seeded = true
          const snapshot = current === form ? snapshotOf(current) : undefined
          if (snapshot !== undefined && snapshot.revision > watermark) watermark = snapshot.revision
        },
        (error: unknown) => {
          // The document refused it: drop the phantom intent so the next echo
          // is authoritative again. The theme stays applied for this session —
          // only the memory of it is lost.
          if (pendingLocal === value) pendingLocal = undefined
          // A refused write is no longer "in flight": a later form can retry it.
          if (sent === value) sent = undefined
          warn('settings write failed', error)
        },
      )
    } catch (error) {
      warn('settings write failed', error)
    }
  }

  const unbind = (): void => {
    const release = releaseForm
    releaseForm = undefined
    form = undefined
    // A rebind re-seeds from the new form; the high-water mark belongs to the
    // form that reported it.
    seeded = false
    confirmed = 'off'
    watermark = -1
    sent = undefined
    if (release === undefined) return
    try {
      release()
    } catch (error) {
      warn('could not unsubscribe from the settings form', error)
    }
  }

  const bind = (next: ConfigForm<MoonsetSettingsSection>): void => {
    unbind()
    form = next
    try {
      releaseForm = next.subscribe(onFormChange)
    } catch (error) {
      // A form whose subscribe is unavailable still reads and writes.
      warn('could not subscribe to the settings form', error)
    }
    seed()
    // A late binding IS a state change: readers that already rendered must
    // re-read (that is also what the boot restore listens for).
    notify()
  }

  if (typeof ctx.inject === 'function') {
    try {
      fiber = ctx.inject(['configForms'], (formsCtx) => {
        const forms = formsCtx.configForms
        if (forms === undefined || typeof forms.get !== 'function') return
        bind(forms.get<MoonsetSettingsSection>(MOONSET_ENTRY_ID))
        // Fiber lifetime: a service change that unloads this injection must
        // drop the listener with it.
        return () => { unbind() }
      })
    } catch (error) {
      warn('could not bind the settings form', error)
    }
  }

  return {
    read(): MoonsetChoice {
      // The intent is the newest thing we know: a document echo that has not
      // confirmed it yet must not become the local answer (M5.1).
      if (pendingLocal !== undefined) return pendingLocal
      seed()
      return seeded ? confirmed : 'off'
    },
    write(choice: MoonsetChoice): void {
      if (disposed) return
      const current = form
      if (current === undefined) {
        // Not a fault to recover from: the host serves no form for this entry,
        // so there is nowhere to persist. The theme still switches for this
        // session — warn once per attempt so the gap is visible in the console.
        console.warn(
          `[dsh-moonset] choice "${choice}" not persisted — no settings form for "${MOONSET_ENTRY_ID}" on this host`,
        )
        return
      }
      // Already queued, or already what the document says: no write, and no
      // window to open.
      if (choice === pendingLocal) return
      if (pendingLocal === undefined) {
        seed()
        if (seeded && choice === confirmed) return
      }
      pendingLocal = choice
      // A queued intent already counts as a local write: its echo can arrive
      // before the window below has any landed write to measure (M5.2).
      lastWriteAtMs = Date.now()
      if (timer !== undefined) clearTimeout(timer)
      const handle = setTimeout(() => {
        timer = undefined
        flush()
      }, WRITE_DEBOUNCE_MS) as ReturnType<typeof setTimeout> & { unref?: () => void }
      // A Node test runner would otherwise stay alive for a queued intent; the
      // browser's numeric handle has no unref, and this guard is what keeps one
      // bundle side from assuming the other's timer shape.
      if (typeof handle.unref === 'function') handle.unref()
      timer = handle
    },
    flush,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose(): void {
      if (disposed) return
      // BEFORE the form is released: an intent the user already expressed must
      // still land, or unloading the plugin would lose the click that caused
      // it (M5.1 "卸载时必须 flush").
      flush()
      disposed = true
      unbind()
      listeners.clear()
      const injection = fiber
      fiber = undefined
      if (injection === undefined) return
      try {
        void injection.dispose().catch(() => { /* teardown is best-effort */ })
      } catch (error) {
        warn('could not dispose the settings injection', error)
      }
    },
    lastWriteAt(): number {
      return lastWriteAtMs
    },
    sinceLastWrite(): number {
      return lastWriteAtMs === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastWriteAtMs
    },
    get writes(): number {
      return writes
    },
    get pendingLocal(): MoonsetChoice | undefined {
      return pendingLocal
    },
    get revision(): number {
      return watermark
    },
  }
}
