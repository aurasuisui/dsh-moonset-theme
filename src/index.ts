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
 * M6 adds the one piece of Host BEHAVIOR: a `webserver/index-inject` listener
 * that hands the persisted choice's palette to the index HTML, so the first
 * frame is already Moonset instead of the official canvas. `boot-palette.ts`
 * owns the rows and their verified contract notes; this module only wires them.
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { bootPaletteRows, type BootPaletteConfig } from './boot-palette.ts'

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

/**
 * The M2 ground scopes — restated for the same reason as {@link CHOICE_VALUES}.
 * `tests/settings.spec.ts` cross-checks this union against the client's
 * `GLOW_SCOPES`, so the two copies cannot drift into an unreadable document.
 */
const GLOW_SCOPE_VALUES = ['conversation', 'main', 'all'] as const

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
  // ── M2: the environment glow ──────────────────────────────────────────────
  // Three more volatile fields, projected into the same browser form. Their
  // defaults are the 0.1.2 M1.5 sheet, so a profile that never opens the
  // section keeps the look the user approved.
  glow: maybeVolatile(Schema.boolean().default(true)),
  // `main` (B) since M3: the user compared A/B/C on a real machine and B is the
  // coherent default — the shell and columns show the ground, the sidebar keeps
  // its own surface. `all` stays selectable as the fully transparent mode.
  glowScope: maybeVolatile(Schema.union([...GLOW_SCOPE_VALUES]).default('main')),
  glowStrength: maybeVolatile(Schema.number().min(0).max(200).default(100)),
})

/**
 * Hard dependency on the host webserver: the first-paint rows ride its index
 * render, so this Host half is not activated until `webServer` is live.
 * Declaring `inject` (rather than a one-shot `ctx.get` probe) makes the
 * listener deterministic no matter the mount order — Cordis activates the
 * plugin once the service appears. A headless profile has no webServer, so the
 * Host half simply stays waiting there; nothing else it does needs one.
 */
export const inject = ['webServer']

/**
 * Host plugin body: contribute the first-paint rows for the durable choice.
 *
 * The listener reads the volatile choice on EVERY index render, so a page load
 * always reflects the document as it stands then. It never throws and an empty
 * contribution is legal: an unusable config (no volatile ref on a legacy host,
 * `off`, or a value naming no choice) yields no rows and the page keeps the
 * official first frame (see `boot-palette.ts`).
 * @param ctx - Host cordis context (webServer is injected, see {@link inject}).
 * @param config - Loader-validated plugin config; its `choice` is a volatile ref
 *   on DSH >= 0.1.7 and the patch's static value on older hosts.
 */
export function apply(ctx: Context, config?: BootPaletteConfig): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push(...bootPaletteRows(config))
  })
}
