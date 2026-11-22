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
 * read, write, notify, dispose. It never touches styles, never calls
 * `setTheme`, and never applies a policy — `choice.ts` owns the policy and
 * `index.ts` owns the wiring. The echo race (a late document echo reverting a
 * newer local pick) is M5.1's job; {@link DurableChoice.writes} already counts
 * what would let that milestone assert on it.
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

/** The section the Host's volatile `Config` projects (client view: plain values). */
export interface MoonsetSettingsSection {
  /** One of `MoonsetChoice`'s values; unknown while the form is still loading. */
  choice?: unknown
}

/** The small durable surface the settings section and the boot path consume. */
export interface DurableChoice {
  /** Last accepted choice, or `off` while no form is bound / nothing is stored. */
  read(): MoonsetChoice
  /** Persist one choice (fire-and-forget; a missing form warns and keeps going). */
  write(choice: MoonsetChoice): void
  /** Observe snapshot changes and late bindings; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Release the form listener and the injection fiber. Safe to call twice. */
  dispose(): void
  /** Writes that reached the form (diagnostics for M5.1's echo assertions). */
  readonly writes: number
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
 * read/write/subscribe facade.
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
  const listeners = new Set<() => void>()

  const notify = (): void => {
    // Copied: a listener may unsubscribe from inside the notification.
    for (const listener of [...listeners]) listener()
  }

  const unbind = (): void => {
    const release = releaseForm
    releaseForm = undefined
    form = undefined
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
      releaseForm = next.subscribe(notify)
    } catch (error) {
      // A form whose subscribe is unavailable still reads and writes.
      warn('could not subscribe to the settings form', error)
    }
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
      const current = form
      if (current === undefined) return 'off'
      try {
        const snapshot: ConfigFormSnapshot<MoonsetSettingsSection> = current.getSnapshot()
        return resolveChoice(snapshot.value?.choice)
      } catch (error) {
        warn('could not read the settings form', error)
        return 'off'
      }
    },
    write(choice: MoonsetChoice): void {
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
      writes += 1
      try {
        // Fire-and-forget by contract; the echo guard is M5.1. A rejected
        // transport write must not surface as an unhandled rejection.
        void Promise.resolve(current.set('choice', choice)).catch((error: unknown) => {
          warn('settings write failed', error)
        })
      } catch (error) {
        warn('settings write failed', error)
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose(): void {
      if (disposed) return
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
    get writes(): number {
      return writes
    },
  }
}
