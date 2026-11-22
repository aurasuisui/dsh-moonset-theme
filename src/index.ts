/**
 * Host half of the Moonset theme plugin for the DeepSeek Harness web GUI.
 *
 * Two things live here, and only two:
 *
 *  - **the plugin identity**: `name` doubles as the cordis.patch.yml insert id,
 *    so the two must stay identical — dsh plugin activation reports the row id
 *    on failure, and a drift turns a readable log line into an anonymous one.
 *  - **the durable settings contract**: `Config`. From DSH 0.1.7 a plugin no
 *    longer registers a settings namespace; it declares a schema whose
 *    VOLATILE fields the settings service projects into a form named by the
 *    ACTIVE PROFILE ENTRY id ({@link MOONSET_ENTRY_ID}). The client half is the
 *    only reader (`ctx.configForms.get(MOONSET_ENTRY_ID)`), and it is also the
 *    only writer: the Host never reads the value itself.
 *
 * Why the choice cannot ride the official theme preference: `setTheme(id)`
 * writes the user-settings document only for `system` / `light` / `dark`. A
 * third-party id lives in the runtime's MEMORY preference, and `adopt()`
 * overwrites that memory with the document value on every echo — so the
 * official seam cannot remember `moonset-light` across a restart. This field
 * is what remembers it instead (PLAN 九、已决 #4): the browser half restores it
 * at boot and re-applies it on every pick.
 *
 * First-paint injection is M6 and lands here as a listener; until then the
 * Host half stays inert.
 */
import Schema from '@deepseek-ai/schemastery'

/**
 * The profile entry id the settings form is keyed by — the `insert` row id in
 * `cordis.patch.yml`, the plugin `name`, and the client's
 * `ctx.configForms.get(...)` argument, all one string.
 */
export const MOONSET_ENTRY_ID = 'dsh-moonset'

/** Plugin identity; must stay equal to {@link MOONSET_ENTRY_ID} and the patch row id. */
export const name = 'dsh-moonset'

/**
 * The durable choices. Deliberately a plain literal list rather than a shared
 * import: the client half cannot import this module (it pulls schemastery),
 * so `tests/settings.spec.ts` cross-checks the two copies instead.
 */
const CHOICE_VALUES = ['off', 'light', 'dark', 'follow'] as const

/** The subset of a schemastery node this module probes. */
interface VolatileCapable {
  volatile?: () => unknown
}

/**
 * Mark a schema node volatile when the running schemastery supports it.
 *
 * `.volatile()` exists only from schemastery **3.18.3**, and this module is
 * loaded with the HOST's copy of schemastery (it stays external in the lib
 * build). An unconditional call would throw at module-evaluation time on an
 * older host — turning "plugin pending" into "plugin failed to load", which
 * takes the whole web boot down. Guarded, the call is a no-op there, which is
 * exactly the pre-0.1.7 status quo: no entry-level form exists on such a host.
 * @param node - freshly built schema node (never reused across schemas; the
 * call mutates the node's meta in place).
 * @returns the same node, marked volatile when the capability exists.
 */
export function maybeVolatile<T extends object>(node: T): T {
  const capable = node as VolatileCapable
  return typeof capable.volatile === 'function' ? capable.volatile() as T : node
}

/**
 * The plugin's durable settings form: ONE volatile field carrying the user's
 * Moonset choice.
 *
 * `off` is the default and means "no choice yet": the client reads a
 * non-default value as a real choice, leaves the official theme in charge when
 * it sees `off`, and never writes the document on its own. Keeping the field
 * volatile (rather than a plain field) is what makes the settings service
 * project it into the browser form at all.
 */
export const Config = Schema.object({
  choice: maybeVolatile(Schema.union([...CHOICE_VALUES]).default('off')),
})

/** Host-side work: nothing yet (M6 adds the webserver/index-inject listener). */
export function apply(): void {}
