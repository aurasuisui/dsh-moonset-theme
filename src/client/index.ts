/**
 * Browser half of the Moonset theme plugin — M4 themes plus the M5 settings
 * section and its own durable choice.
 *
 * The artifact is emitted by tsdown.client.ts as a closure factory
 * (window.__ModuleLoader__.load) and receives the client-side cordis context
 * through `apply`; the loader owns its lifecycle (activate / unload). Every
 * `@deepseek-ai/*` import here is `import type` — the runtime values (the
 * theme, slot, and locale services included) arrive through `ctx`, which is
 * also why the browser bundle keeps its module-table purity.
 *
 * What `apply` wires, in order:
 *
 *  1. the two theme registrations (M4) — through `tolerantRegistration` (D3),
 *     so a peer owning an id costs a skip, never the user's whole plugin set;
 *  2. the settings dictionaries (M5) — one namespace, zh + en;
 *  3. the choice controller (M5) — durable form + boot restore + follow layer;
 *  4. the settings section (M5) — `settings.section`, three buttons.
 *
 * Nothing here switches the theme preference on its own initiative: a boot
 * restore only re-applies a choice the user already MADE (a stored `off` is
 * left alone), and a pick applies because the user clicked (D4).
 *
 * The echo guards themselves live in `durable.ts` (M5.1): a pick becomes a
 * queued INTENT, `read()` answers with the intent until the document confirms
 * it, and a snapshot below the accepted revision watermark is dropped. This
 * file adds the two things that need a context:
 *
 *  - the boot restore is `pendingLocal`-aware, so a late echo cannot drive (or
 *    undo) the apply;
 *  - `theme/change` is mirrored through {@link shouldMirrorOfficialPick}: an
 *    OFFICIAL light/dark/system pick while our section is live stores `off` and
 *    releases the follow layer, which is what stops the next boot from undoing
 *    the user's own choice.
 *
 * First-paint injection is host-side (M6, `../boot-palette.ts`); what THIS half
 * owns is the handover: the injected sheet is removed the moment the choice
 * actually takes over (`boot-cleanup.ts`), because a sheet left behind outranks
 * the official token blocks and would pin every token (and the canvas colour)
 * against later switches.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { removeBootSheet } from './boot-cleanup.ts'
import {
  MOONSET_SECTION_OPTIONS,
  applyChoice,
  shouldMirrorOfficialPick,
  type ChoiceDeps,
  type MoonsetChoice,
} from './choice.ts'
import { MOONSET_ENTRY_ID, createDurableChoice } from './durable.ts'
import { MOONSET_LOCALE_NS, en, zh, type MoonsetLocaleKey } from './locales.ts'
import { MoonsetSection, type MoonsetSectionLabels } from './settings-section.tsx'
import { createFollowLayer, registerMoonsetThemes } from './themes.ts'
import { tolerantRegistration } from './registration-tolerance.ts'

// Re-exported so a consumer (or a test) reaches the plugin's surface through
// its own entry rather than through sibling modules.
export {
  FOLLOW_LAYER_SOURCE,
  MOONSET_THEMES,
  MOONSET_THEME_IDS,
  createFollowLayer,
  moonsetDefinitions,
  moonsetFollowOverrides,
  registerMoonsetThemes,
} from './themes.ts'
export type {
  FollowSystemLayer,
  MoonsetThemeId,
  MoonsetThemeInfo,
  MoonsetThemeService,
} from './themes.ts'
export { tolerantDisposer, tolerantRegistration } from './registration-tolerance.ts'
export type { TolerantDisposer } from './registration-tolerance.ts'
export { BOOT_SHEET_ATTR, BOOT_SHEET_SELECTOR, removeBootSheet } from './boot-cleanup.ts'
export type { BootSheetRoot } from './boot-cleanup.ts'
export {
  MOONSET_CHOICES,
  MOONSET_SECTION_OPTIONS,
  OFFICIAL_THEME_PICKS,
  applyChoice,
  resolveChoice,
  shouldMirrorOfficialPick,
} from './choice.ts'
export type { ChoiceDeps, MoonsetChoice, MoonsetSectionOption } from './choice.ts'
export { MOONSET_ENTRY_ID, createDurableChoice } from './durable.ts'
export type { DurableChoice, MoonsetSettingsSection } from './durable.ts'
export { MOONSET_LOCALE_NS, en, zh } from './locales.ts'
export type { MoonsetLocaleKey } from './locales.ts'
export { MoonsetSection } from './settings-section.tsx'
export type { MoonsetOptionLabel, MoonsetSectionLabels, MoonsetSectionProps } from './settings-section.tsx'

/** The locale namespace as a literal type (interface keys cannot be computed). */
type MoonsetNamespace = 'settings.moonset'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Moonset settings section's copy. */
    'settings.moonset': MoonsetLocaleKey
  }
}

/**
 * Compile-time tie between the exported constant and the declared namespace:
 * the interface key above cannot be a computed name, so a drift between the two
 * literals would otherwise be silent until a raw key showed up on screen.
 */
const LOCALE_NS: MoonsetNamespace = MOONSET_LOCALE_NS

/** The translate function the section's copy is built from. */
type SectionTranslate = (key: MoonsetLocaleKey) => string

/** Required services: theme runtime, slot registry, and locale registry. */
export const inject = ['theme', 'slots', 'locale']

/**
 * Build the section's copy from the namespace binding.
 *
 * Called per render through the injected face, so switching the interface
 * language re-localizes the section without re-registering it.
 * @param t - namespace-bound translate function.
 * @returns the three labels the component takes.
 */
function sectionLabels(t: SectionTranslate): MoonsetSectionLabels {
  return {
    title: t('section.title'),
    description: t('section.description'),
    options: MOONSET_SECTION_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.localeKey),
    })),
  }
}

/**
 * Client plugin body: register both themes, then wire the settings surface.
 * @param ctx - client cordis context (the theme, slot, and locale services are
 * injected via `dsh.client.inject` and declared in {@link inject}).
 */
export function apply(ctx: ClientContext): void {
  // Registration is the only boot-critical step in M4's half, and it rides
  // `registerMoonsetThemes` → `tolerantRegistration` (D3): a duplicate id — a
  // second copy of this plugin, or a peer that already claimed the id — is
  // skipped instead of throwing, because a throwing `apply` aborts the whole
  // web boot and takes the user's other plugins down with it. The effect gives
  // the registrations the fiber's lifetime, so unloading the plugin releases
  // them and a re-activation registers them again.
  ctx.effect(() => registerMoonsetThemes(ctx.theme), 'moonset: light/dark theme registrations')
  wireSettings(ctx)
}

/**
 * Wire the M5 settings surface: dictionaries, the durable choice controller,
 * and the section registration.
 *
 * Skipped entirely when the context carries no slot/locale service: a bare
 * unit-test stub (or a pre-assembly harness) has no settings surface to wire,
 * and the boot path must never throw (M5 "硬约束" 2). On a real client both
 * services are guaranteed by {@link inject}.
 * @param ctx - client cordis context.
 */
function wireSettings(ctx: ClientContext): void {
  const slots: SlotRegistry | undefined = ctx.slots
  const locale: LocaleRuntime | undefined = ctx.locale
  if (slots === undefined || locale === undefined) return

  const follow = createFollowLayer(ctx.theme)
  const durable = createDurableChoice(ctx)
  const deps: ChoiceDeps = {
    setTheme: (id: string) => { ctx.theme.setTheme(id) },
    preference: () => ctx.theme.getTheme().preference,
    follow,
  }

  // Boot restore. The durable choice is the only place a third-party theme id
  // survives a restart (PLAN 九、已决 #4), so every start re-applies it — and
  // so does the LATE bind of an async settings form, which is why this runs
  // from a subscription as well as once up front.
  //
  // `off` is NOT re-applied: it means "no choice made", and re-applying it
  // would overwrite the user's official preference with `system` on every boot
  // (M5's scope is restore, not repair). The restore happens at most once, from
  // the first readable non-`off` value; a user pick supersedes it.
  let restored = false
  const restore = (): void => {
    if (restored) return
    // M5.1: an intent the user expressed outranks every snapshot. An echo that
    // arrives while the pick is still queued must not drive this apply — the
    // pick already applied locally, and re-applying the document's older value
    // is exactly the rollback this milestone exists to prevent.
    if (durable.pendingLocal !== undefined) return
    const choice = durable.read()
    // `off` has no sheet to remove (the Host injects none for it), so the early
    // return keeps this path to exactly one responsibility.
    if (choice === 'off') return
    restored = true
    applyChoice(choice, deps)
    // M6 handover: the theme now owns the tokens. Leaving the pre-paint sheet in
    // the document would keep its double-selector block ahead of the official
    // token tables and pin every token (canvas included) against later switches.
    removeBootSheet()
  }

  const pick = (choice: MoonsetChoice): void => {
    // Persist first (best effort), then apply: a host without a settings form
    // still switches themes for this session, it just forgets on restart. The
    // write is an INTENT (M5.1): it lands 300 ms later, or on unload, and until
    // then `read()` keeps answering with it.
    restored = true
    durable.write(choice)
    applyChoice(choice, deps)
    // Same handover as the boot restore: a pick can be the FIRST apply on a page
    // whose restore never ran (no settings form bound yet, or a pending intent
    // outranking the snapshot), and the sheet must not outlive that either.
    removeBootSheet()
  }

  /**
   * Mirror an OFFICIAL pick back into `off` (M5.1, closes M5 debt #1).
   *
   * The official Appearance row moves the runtime's preference to a built-in
   * value; our section still stores a Moonset choice, and the boot restore
   * would re-apply it on the next start — undoing the user's own pick. Seeing
   * that transition while our choice is live therefore means "hand the UI
   * back": persist `off` and release the follow layer.
   *
   * Deliberately NOT `applyChoice('off', deps)`: that ends in
   * `setTheme('system')` and would overwrite the very preference the user just
   * chose (an official `dark` would flip back to `system`).
   *
   * {@link shouldMirrorOfficialPick} owns the whole decision, including the two
   * cases that must NOT mirror: our own `setTheme('moonset-*')` (a third-party
   * id is never built-in) and the `system` value follow mode writes itself.
   * @param snapshot - the `theme/change` payload (only its preference is read).
   */
  const mirrorOfficialPick = (snapshot: { preference: string }): void => {
    if (!shouldMirrorOfficialPick(snapshot.preference, durable.read())) return
    durable.write('off')
    follow.disable()
  }

  // The locale service already types this binding to the merged dictionary
  // union; SectionTranslate only narrows it to the keys this section reads.
  const t: SectionTranslate = locale.bind(LOCALE_NS)
  const injected = (): { choice: MoonsetChoice; onPick: (choice: MoonsetChoice) => void; labels: MoonsetSectionLabels } => ({
    choice: durable.read(),
    onPick: pick,
    labels: sectionLabels(t),
  })

  // Dictionaries first: the labels resolve through them at render time.
  ctx.effect(
    () => tolerantRegistration(() => locale.register(LOCALE_NS, { zh, en })),
    'moonset: settings dictionaries',
  )

  // The choice controller: form binding, boot restore, follow layer. One
  // effect so the unload path is one place — the layer must be released with
  // the plugin (the theme runtime does not own it, M4's `createFollowLayer`
  // hands the lifecycle to the caller).
  ctx.effect(() => {
    const unsubscribe = durable.subscribe(restore)
    // `theme/change` is the ONLY continuous view of the official preference
    // (the host publishes it synchronously from `setTheme` / `adopt`), so the
    // mirror rule rides it. Rides this effect rather than a new one: the
    // listener and the choice it guards have exactly one lifetime. Guarded for
    // a context that carries no event bus (a bare unit-test stub), where the
    // boot path must still not throw (M5 "硬约束" 2).
    const releaseTheme = typeof ctx.on === 'function'
      ? ctx.on('theme/change', (snapshot: { preference: string }) => { mirrorOfficialPick(snapshot) })
      : undefined
    restore()
    return () => {
      unsubscribe()
      releaseTheme?.()
      follow.disable()
      durable.dispose()
      // Unloading must not leave our sheet behind: after this the plugin paints
      // nothing, so a lingering sheet would pin a palette with no owner.
      removeBootSheet()
    }
  }, 'moonset: settings choice')

  // The section itself. `tolerantRegistration` because with `settings.section`
  // already declared this callback runs SYNCHRONOUSLY, so a duplicate install
  // (same section id) would otherwise throw straight through `apply` (D3);
  // the label is a THUNK, so a language switch re-renders the nav row without a
  // re-registration. `order: 40` keeps the official sections and the peer
  // theme's page ahead of ours.
  ctx.effect(
    () => slots.inject('settings.section', () => tolerantRegistration(() => slots.register({
      name: 'settings.section',
      id: 'moonset',
      order: 40,
      label: () => t('section.title'),
      locale: LOCALE_NS,
      inject: injected,
    }, MoonsetSection))),
    'moonset: settings section',
  )
}
