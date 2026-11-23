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
 *  4. the settings section (M5) — `settings.section`, three buttons;
 *  5. the skin layer (0.1.1) — the root attribute plus ONE injected stylesheet
 *     (`skin.ts`), mounted after the registrations and torn down by the same
 *     `ctx.effect`, so "plugin active" and "skin present" are exactly one
 *     interval and no sheet can outlive its owner (P2). It installs no listener
 *     and no loop (P1); what may enter that sheet is the P5 whitelist.
 *
 * Nothing here switches the theme preference on its own initiative: a boot
 * restore only re-applies a choice the user already MADE (a stored `off` is
 * left alone), and a pick applies because the user clicked (D4).
 *
 * The echo guards themselves live in `durable.ts` (M5.1): a pick becomes a
 * queued INTENT, `read()` answers with the intent until the document confirms
 * it, and a snapshot below the accepted revision watermark is dropped. This
 * file adds the three things that need a context:
 *
 *  - the boot restore is `pendingLocal`-aware, so a late echo cannot drive (or
 *    undo) the apply;
 *  - `theme/change` is mirrored through {@link shouldMirrorOfficialPick}: an
 *    OFFICIAL light/dark/system pick while our section is live stores `off` and
 *    releases the follow layer, which is what stops the next boot from undoing
 *    the user's own choice;
 *  - (M5.2) a `theme/change` that collapses the preference back to a BUILT-IN
 *    value shortly after OUR OWN write is the runtime's `adopt()` echoing that
 *    write, and is answered by a deferred re-assert instead of being believed —
 *    the root cause is spelled out in `wireSettings`.
 *
 * M5.3 answers the two symptoms a real profile hit, and adds the surface that
 * makes the next report diagnosable:
 *
 *  - **the section has ONE source of truth.** It seeds from `read()` and
 *    re-reads on a change instead of mirroring the `choice` prop in local
 *    state: a settings write makes the Host re-derive its scope forms and
 *    REMOUNT the section, and since the write is queued for 300 ms (M5.1) that
 *    remount can beat the document — with a prop mirror the click looked
 *    ignored ("点了跟随系统，设置区不跳").
 *  - **follow mode heals itself.** A `theme/change` while the stored choice is
 *    `follow` repairs the two states that make following a silent no-op: a
 *    layer that is not stacked, and a built-in preference the settings echo
 *    pinned (the runtime re-publishes an OS flip only while the preference is
 *    `system`, `dsh-client-ui-theme/lib/client.js:1671`).
 *  - **the section shows its own state.** One status line renders the stored
 *    choice, the runtime preference, the resolved scheme, and whether the layer
 *    is attached (`describeState`, in `choice.ts`). On the desktop shell the
 *    GUI window exposes no document to an outside observer, so that line is the
 *    plugin's only visible diagnostic.
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
  describeState,
  isOfficialThemePreference,
  moonsetThemeId,
  shouldMirrorOfficialPick,
  type ChoiceDeps,
  type MoonsetChoice,
} from './choice.ts'
import {
  MOONSET_ENTRY_ID,
  RESTORE_WINDOW_MS,
  createDurableChoice,
  createDurableGlow,
} from './durable.ts'
import type { DurableGlow } from './durable.ts'
import { MOONSET_LOCALE_NS, en, zh, type MoonsetLocaleKey } from './locales.ts'
import {
  MoonsetSection,
  type MoonsetSectionFace,
  type MoonsetSectionLabels,
  type MoonsetSectionView,
} from './settings-section.tsx'
import { GLOW_HUES, GLOW_SCOPES, mountSkin, syncSkin, unmountSkin, updateSkin } from './skin.ts'
import type { GlowHue, GlowScope, SkinOptions } from './skin.ts'
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
  STATUS_SEPARATOR,
  applyChoice,
  describeState,
  isOfficialThemePreference,
  resolveChoice,
  shouldMirrorOfficialPick,
} from './choice.ts'
export type { ChoiceDeps, MoonsetChoice, MoonsetSectionOption } from './choice.ts'
export { MOONSET_ENTRY_ID, createDurableChoice, createDurableGlow } from './durable.ts'
export type { DurableChoice, DurableGlow, MoonsetGlow, MoonsetSettingsSection } from './durable.ts'
export { MOONSET_LOCALE_NS, en, zh } from './locales.ts'
export type { MoonsetLocaleKey } from './locales.ts'
export { MoonsetSection } from './settings-section.tsx'
export type {
  MoonsetHueLabel,
  MoonsetOptionLabel,
  MoonsetScopeLabel,
  MoonsetSectionFace,
  MoonsetSectionLabels,
  MoonsetSectionProps,
  MoonsetSectionView,
} from './settings-section.tsx'
export {
  DEFAULT_GLOW_HUE_DARK,
  DEFAULT_GLOW_HUE_LIGHT,
  DEFAULT_GLOW_SCOPE,
  DEFAULT_GLOW_STRENGTH_DARK,
  DEFAULT_GLOW_STRENGTH_LIGHT,
  GLOW_ALPHA_AT_FULL,
  GLOW_HUES,
  GLOW_HUE_AT_FULL,
  GLOW_SCOPES,
  GLOW_STRENGTH_MAX,
  GLOW_STRENGTH_MIN,
  SKIN_ATTR,
  SKIN_SHEET_ATTR,
  SKIN_SHEET_SELECTOR,
  darkGlowAlphas,
  glowAlphas,
  mountSkin,
  resolveGlowHue,
  resolveGlowScope,
  resolveGlowStrength,
  skinCss,
  syncSkin,
  unmountSkin,
  updateSkin,
} from './skin.ts'
export type { GlowHue, GlowScope, SkinOptions, SkinRoot, SkinSheetElement } from './skin.ts'

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
 * How many consecutive re-asserts the plugin is willing to make before it
 * stops fighting the settings echo (M5.2).
 *
 * The re-assert exists to answer ONE overwrite; a runaway loop against
 * `adopt()` would be a worse bug than the flash it fixes, so the counter is
 * capped and the give-up is announced once. Exported so the tests drive exactly
 * this many rounds instead of restating a magic number.
 */
export const REASSERT_LIMIT = 3

/**
 * How long a control change waits before the sheet is rebuilt (M2).
 *
 * The durable write is debounced at {@link WRITE_DEBOUNCE_MS} (300 ms) because
 * it crosses into the settings document; the sheet is local paint, so it can
 * follow a quarter-second sooner — long enough that a slider drag emits ONE
 * rebuild, short enough that the knob feels attached. Exported so the tests
 * advance exactly this window.
 */
export const SKIN_REBUILD_MS = 150

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
    // M2 地面范围 / 环境光晕 / 强度: three more controls. The scope buttons are
    // DERIVED from GLOW_SCOPES so a fourth scope would be a type error, not a
    // missing button.
    glowTitle: t('glow.title'),
    glowOn: t('glow.on'),
    glowOff: t('glow.off'),
    scopeTitle: t('glow.scope.title'),
    scopeOptions: GLOW_SCOPES.map((scope) => ({
      value: scope,
      label: t(scope === 'conversation' ? 'glow.scope.conversation' : scope === 'main' ? 'glow.scope.main' : 'glow.scope.all'),
    })),
    strengthTitle: t('glow.strength'),
    // M6 光晕: two groups (light / dark), each with the three surviving hues.
    // The buttons are derived from GLOW_HUES, so a fourth hue would be a type
    // error, not a missing button.
    hueOptions: GLOW_HUES.map((hue) => ({
      value: hue,
      label: t(hue === 'accent' ? 'glow.hue.accent' : hue === 'soft' ? 'glow.hue.soft' : 'glow.hue.night'),
    })),
    lightTitle: t('glow.light.title'),
    darkTitle: t('glow.dark.title'),
    hint: t('glow.hint'),
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
  // 0.1.1 skin layer (P1/P2): one root attribute plus one sheet, entered and
  // left with the fiber. It starts ON so the first paint after activation has
  // the selection colour even before a settings form binds; the three paths
  // that learn a stored choice (restore / pick / the official-pick mirror) call
  // `syncSkin` and turn it OFF again for `off`, so "official theme, Moonset
  // sheet" cannot outlive the first readable snapshot. Mount/unmount are
  // idempotent and total; a document that refuses the write loses the skin,
  // never the boot (see skin.ts).
  ctx.effect(() => {
    mountSkin()
    return () => {
      unmountSkin()
    }
  }, 'moonset: skin sheet')
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
  const glow = createDurableGlow(ctx)

  // ── M2: the glow → sheet bridge ────────────────────────────────────────────
  //
  // Two clocks, on purpose: the durable write lands at 300 ms (the settings
  // document is the slow half), the sheet rebuild at 150 ms (it is local
  // paint). Both are DEBOUNCED — a slider drag emits a change per step, and
  // rebuilding the sheet on every step would re-parse it on each pointer move.
  /** The options the sheet is built from, read live from the durable store. */
  const skinOptions = (): SkinOptions => {
    const current = glow.read()
    return {
      glow: current.glow,
      scope: current.scope,
      hueLight: current.hueLight,
      strengthLight: current.strengthLight,
      hueDark: current.hueDark,
      strengthDark: current.strengthDark,
    }
  }
  /** The pending sheet rebuild (cleared by the teardown). */
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Rebuild the ONE skin sheet after a control change, debounced.
   *
   * Idempotent and total: a plugin that is unloading must not rebuild, and a
   * document that refuses the write loses the update, never the session.
   */
  const scheduleSkinRebuild = (): void => {
    if (!active) return
    // The choice still gates the sheet (0.1.1): with `off` the user runs the
    // official theme, so a glow control must NOT bring a Moonset sheet back.
    if (durable.read() === 'off') return
    if (rebuildTimer !== undefined) clearTimeout(rebuildTimer)
    const handle = setTimeout(() => {
      rebuildTimer = undefined
      // Re-checked: a pick that landed inside the window owns the page now.
      if (!active || durable.read() === 'off') return
      updateSkin(skinOptions())
    }, SKIN_REBUILD_MS) as ReturnType<typeof setTimeout> & { unref?: () => void }
    if (typeof handle.unref === 'function') handle.unref()
    rebuildTimer = handle
  }

  /** Persist one 地面范围 pick (the sheet follows through the rebuild). */
  const setScope = (scope: GlowScope): void => {
    glow.write({ scope })
    scheduleSkinRebuild()
    notifyView()
  }

  /** Flip the environment glow. `false` drops the whole 0.1.2 segment. */
  const setGlowOn = (next: boolean): void => {
    glow.write({ glow: next })
    scheduleSkinRebuild()
    notifyView()
  }

  /** M6: the LIGHT ground's controls (its own hue and strength). */
  const setHueLight = (hue: GlowHue): void => {
    glow.write({ hueLight: hue })
    scheduleSkinRebuild()
    notifyView()
  }

  const setStrengthLight = (next: number): void => {
    glow.write({ strengthLight: next })
    scheduleSkinRebuild()
    notifyView()
  }

  /** M6: the DARK ground's controls. */
  const setHueDark = (hue: GlowHue): void => {
    glow.write({ hueDark: hue })
    scheduleSkinRebuild()
    notifyView()
  }

  const setStrengthDark = (next: number): void => {
    glow.write({ strengthDark: next })
    scheduleSkinRebuild()
    notifyView()
  }
  const deps: ChoiceDeps = {
    setTheme: (id: string) => { ctx.theme.setTheme(id) },
    preference: () => ctx.theme.getTheme().preference,
    follow,
  }

  // ── M5.3: the section's view channel ─────────────────────────────────────
  //
  // The section renders `read()` and nothing else, and it re-reads whenever
  // THIS channel fires. Two sources feed it, because the view draws two
  // different things:
  //
  //  - the DURABLE store (a pick landing, a late form binding, the mirror rule
  //    storing `off`) — the choice half of the line;
  //  - `theme/change` — the scheme half. An OS flip while following changes no
  //    stored value at all, so without this source the status line would sit
  //    frozen on the scheme that was live when the section mounted, and the
  //    section's own status would LIE about the thing it exists to explain.
  //
  // One set holds the listeners: a section unmount removes exactly one entry
  // plus its durable subscription (see `subscribe`), and the plugin's unload
  // clears the set outright.
  /** Live section listeners, fed by both sources. */
  const viewListeners = new Set<() => void>()

  /** Notify every live section (the `theme/change` half of the channel). */
  const notifyView = (): void => {
    // Copied: a listener may release itself from inside the notification (an
    // unmount that races the publish).
    for (const listener of [...viewListeners]) listener()
  }

  /**
   * Subscribe one renderer to every change the view draws.
   *
   * The returned release unbinds BOTH sources for this listener: the durable
   * subscription it created, and the `theme/change` path (the listener is out
   * of the set, so the plugin's own publish no longer reaches it).
   * @param listener - called after a durable change OR a `theme/change`.
   * @returns the release.
   */
  const subscribe = (listener: () => void): (() => void) => {
    viewListeners.add(listener)
    const releaseDurable = durable.subscribe(listener)
    return () => {
      viewListeners.delete(listener)
      releaseDurable()
    }
  }

  // ── M5.2: the settings echo ───────────────────────────────────────────────
  //
  // ROOT CAUSE, measured rather than guessed. The official `ThemeRuntime`
  // subscribes to its OWN settings scope inside its constructor:
  //
  //   ctx.effect(() => host.subscribe(() => { this.adopt() }),
  //              'ui-theme: settings scope adoption')
  //   @deepseek-ai/dsh-client-ui-theme/lib/client.js:1681
  //
  // and `adopt()` (same file, 1787) copies the document's `preference` into the
  // runtime's MEMORY preference whenever the two differ. That document field is
  // narrowed by `isThemePreference` to `system` / `light` / `dark`, so a
  // third-party id such as `moonset-light` can never be stored there. The Host
  // re-derives every scope form after ANY accepted settings write, so our own
  // `form.set('choice', …)` wakes that subscription — and the runtime overwrites
  // the preference we just set. On screen the theme flashes and snaps back.
  //
  // The answer is an ASSERTION, not a write: inside a short window after a
  // local write, a built-in preference is the echo of that write, so put the
  // theme back with `setTheme(ourId)`. It MUST be deferred — calling it inside
  // the publish stack would be answered by the very `adopt()` that produced the
  // publish (the same reason catppuccin's `scheduleRestore` is a microtask).
  // Outside the window the preference is the user's own, and M5.1's mirror rule
  // stands. A third-party id needs no answer at all, which is why the gate is
  // "is this preference built-in?".
  //
  // The cap exists because a re-assert and an adopt() could in principle feed
  // each other: three rounds, then the plugin stops and says so once.
  /** Whether a re-assert is already queued for this tick (echoes merge). */
  let reassertScheduled = false
  /** Re-asserts made in the current burst (reset by a user pick). */
  let reasserts = 0
  /** Set once the cap is hit: the plugin stops answering the echo. */
  let reassertStopped = false
  /** The give-up warning is announced once per burst. */
  let reassertAnnounced = false
  /** Cleared by the fiber's teardown: a queued re-assert must not run after unload. */
  let active = true

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
    // 0.1.1: the skin follows the choice. `off` means the official theme is in
    // use — our accent has no business painting its text selection — while
    // every other choice paints a Moonset palette and keeps the sheet. This is
    // the FIRST moment a stored choice is readable, so the sheet `apply()`
    // mounted is corrected here before anything renders otherwise.
    syncSkin(choice, undefined, skinOptions())
    // `off` has no theme to apply (and the Host injected no first-paint sheet
    // for it), so the early return keeps this path to exactly one responsibility.
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
    // A fresh pick starts a new burst: the re-assert cap is per fight, not per
    // session, and the user acting is exactly the signal that the old fight was
    // worth giving up on.
    reasserts = 0
    reassertStopped = false
    reassertAnnounced = false
    // M5.3: the same reset for the follow-mode repairs. The user acting is also
    // the signal that the old repair fight is worth giving up on.
    repairs = 0
    repairStopped = false
    repairAnnounced = false
    durable.write(choice)
    // 0.1.1: same alignment as the boot restore — a click on "off" takes the
    // sheet off, every other click keeps (or re-mounts) it.
    syncSkin(choice, undefined, skinOptions())
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
   */
  const mirrorOfficialPick = (): void => {
    durable.write('off')
    // 0.1.1: the user just chose an official theme, so the Moonset sheet must go
    // with our theme — third and last place the skin follows the choice.
    syncSkin('off', undefined, skinOptions())
    follow.disable()
  }

  /**
   * Put our theme back after the runtime adopted over it (M5.2).
   *
   * Deferred by a MICROTASK, never called synchronously: the caller is a
   * `theme/change` listener running inside `adopt()` → `publish()`, and a
   * synchronous `setTheme` there lands in the middle of the dispatch that is
   * already rewriting the preference. One microtask later the stack is gone and
   * the call sticks (catppuccin's `scheduleRestore` uses the same boundary).
   *
   * Merged and capped: any number of echoes inside one tick produce ONE call,
   * and {@link REASSERT_LIMIT} rounds end the fight with a single warning — an
   * endless re-assert/adopt loop would be a worse bug than the flash.
   * @param choice - the concrete choice whose theme must be re-asserted.
   */
  const scheduleReassert = (choice: 'light' | 'dark'): void => {
    if (!active || reassertScheduled || reassertStopped) return
    if (reasserts >= REASSERT_LIMIT) {
      reassertStopped = true
      if (!reassertAnnounced) {
        reassertAnnounced = true
        console.warn(
          `[dsh-moonset] stopped re-asserting "${moonsetThemeId(choice)}" after ${REASSERT_LIMIT} attempts — `
          + 'the settings echo keeps overwriting the preference (M5.2: see the adopt() note above)',
        )
      }
      return
    }
    reassertScheduled = true
    queueMicrotask(() => {
      reassertScheduled = false
      if (!active || reassertStopped) return
      reasserts += 1
      // Only the preference: a concrete choice already has the follow layer
      // released, and re-running applyChoice here would re-publish a layer
      // change on every single echo.
      deps.setTheme(moonsetThemeId(choice))
    })
  }

  // ── M5.3: follow-mode self-healing ────────────────────────────────────────
  //
  // Two repairs, both answering a `theme/change` while the stored choice is
  // `follow`. Each one fixes a state in which "follow system" is a silent
  // no-op — the second symptom a real profile reported ("切操作系统的深浅模式，
  // 主题不跟随"):
  //
  //  ① THE LAYER IS NOT STACKED. `overrideTokens` can be refused (a peer owns
  //    the source, a re-entrant call, a rejected token table) and a refused
  //    layer paints nothing: the preference then resolves `system` to the
  //    OFFICIAL palette, and the OS can flip forever without Moonset moving.
  //    Re-enable it.
  //  ② THE PREFERENCE WAS PINNED TO A BUILT-IN inside the local-write window.
  //    That value is the settings echo (adopt()) of our own write, and it pins
  //    the scheme twice over: follow mode means `system`, and the runtime only
  //    re-publishes an OS flip while the preference is `system`
  //    (`dsh-client-ui-theme/lib/client.js:1671`, the `media` change listener).
  //    Put `system` back.
  //
  // Both are DEFERRED by a microtask and merged, exactly like M5.2's re-assert
  // and for the same two reasons: they run from inside a `theme/change`
  // dispatch, where a synchronous `overrideTokens` re-enters the publish it is
  // answering (issue #36 constraint 2) and a synchronous `setTheme` lands in
  // the middle of adopt()'s own dispatch. The cap is the echo fight's, for the
  // same reason: a repair that a publish immediately undoes would be worse than
  // the state it repairs, so three rounds and the plugin stops and says so
  // ONCE. The status line then shows the truth (未挂载) instead of pretending.
  //
  // A repair that finds nothing to do (the layer is attached again, the
  // preference is already `system`) is a no-op: it does not consume the cap and
  // does not warn — which is what keeps our OWN `enable()`/`setTheme()` calls
  // (they publish synchronously from inside their own stack) from logging a
  // repair that never happened.
  /**
   * Repairs already queued for this tick, by kind.
   *
   * Per KIND, not one flag for both: the two repairs answer different states,
   * and one of them is routinely queued by our OWN attach (the layer's
   * `overrideTokens` publishes before it hands back its disposer, so the
   * publish listener sees `enabled === false` once). A single flag would let
   * that no-op shadow a real repair queued in the same tick — measured, not
   * theorised: it swallowed B② on the first run of the M5.3 suite.
   */
  const repairQueued = new Set<'reattach' | 'restore'>()
  /** Repairs made in the current burst (reset by a user pick). */
  let repairs = 0
  /** Set once the cap is hit: the plugin stops repairing until the next pick. */
  let repairStopped = false
  /** The diagnostic warning is announced once per burst. */
  let repairAnnounced = false

  /**
   * Queue one deferred repair, merged per kind and capped.
   *
   * The repair runs one microtask later, re-checks that the choice is still
   * `follow` (it may have moved on while the repair waited), and only then
   * acts. A repair that reports nothing to do is dropped silently — which is
   * also why a kind is merged rather than deduplicated into a boolean.
   * @param kind - `reattach` or `restore`; echoes of one kind merge, the other
   *   kind still gets its turn.
   * @param run - performs the repair; returns whether it actually changed
   *   something (a no-op must not consume the cap or warn).
   * @param complaint - the one-line diagnostic logged when a repair fires, and
   *   again (with the cap) when the plugin gives up.
   */
  const scheduleRepair = (kind: 'reattach' | 'restore', run: () => boolean, complaint: string): void => {
    if (!active || repairQueued.has(kind) || repairStopped) return
    if (repairs >= REASSERT_LIMIT) {
      repairStopped = true
      if (!repairAnnounced) {
        repairAnnounced = true
        console.warn(
          `[dsh-moonset] stopped repairing follow mode after ${REASSERT_LIMIT} attempts — ${complaint}`,
        )
      }
      return
    }
    repairQueued.add(kind)
    queueMicrotask(() => {
      repairQueued.delete(kind)
      if (!active || repairStopped) return
      // The choice is the gate, re-read here: a pick that landed between the
      // schedule and this tick owns the state now.
      if (durable.read() !== 'follow') return
      if (!run()) return
      repairs += 1
      if (!repairAnnounced) {
        repairAnnounced = true
        console.warn(`[dsh-moonset] ${complaint}`)
      }
    })
  }

  /**
   * ① Re-stack the follow layer when it is missing.
   *
   * `follow.enable()` is deliberately NOT wrapped in a try/catch: the layer's
   * own `tolerantRegistration` already degrades a refusal to
   * `enabled === false` (D3), and that is exactly what the status line reports
   * as 未挂载. Swallowing it here as well would hide the one fact the user (and
   * the next bug report) needs.
   */
  const scheduleFollowReattach = (): void => scheduleRepair('reattach', () => {
    if (follow.enabled) return false
    follow.enable()
    return follow.enabled
  }, 'the follow layer was not attached while the choice is "follow" — re-attaching it (M5.3)')

  /** ② Put the `system` preference back after the settings echo pinned it. */
  const scheduleSystemRestore = (): void => scheduleRepair('restore', () => {
    if (deps.preference() === 'system') return false
    deps.setTheme('system')
    return true
  }, 'restoring the "system" preference — the settings echo had pinned it (M5.3)')

  /**
   * Decide what one `theme/change` means for the stored choice (M5.1 + M5.2).
   *
   * Table, by what the section stores:
   *
   *  - `off` — nothing: there is no choice to defend or hand back.
   *  - `follow` — mirror only an EXPLICIT official `light` / `dark`, and an
   *    explicit pick inside the local-write window is the echo instead, so it
   *    is repaired to `system` (M5.3 ②). A `system` publish is follow mode's
   *    own end state (or an adopt() of the document) and is never mirrored. A
   *    publish also re-attaches a missing layer (M5.3 ①).
   *  - `light` / `dark` — a third-party id (ours or a peer's) needs no answer;
   *    a BUILT-IN preference inside the local-write window is the echo of our
   *    own write and is re-asserted, while one outside it is the user's own
   *    Appearance pick and is mirrored to `off` (M5.1).
   * @param snapshot - the `theme/change` payload (only its preference is read).
   */
  const handleThemeChange = (snapshot: { preference: string }): void => {
    const preference = snapshot.preference
    // M5.3: every publish refreshes the status line — an OS flip included,
    // because it changes no stored value at all. Notified BEFORE any branch can
    // return, so the section's line also tracks `off` and the concrete themes.
    notifyView()
    const choice = durable.read()
    if (choice === 'off') return
    if (choice === 'follow') {
      // ① a layer that is not stacked paints nothing, so "follow" would be a
      // no-op and the OS could flip forever without Moonset moving.
      if (!follow.enabled) scheduleFollowReattach()
      if (shouldMirrorOfficialPick(preference, choice)) {
        // ② a built-in `light`/`dark` INSIDE the local-write window is the
        // settings echo of our own write, not an official pick: it pins the
        // scheme (and the runtime then stops publishing OS flips — the second
        // reported symptom), so follow mode gets `system` back. Outside the
        // window it is the user's own Appearance pick, and M5.1's mirror stands.
        // A `system` echo needs no branch at all: it IS follow mode's target,
        // which is why `shouldMirrorOfficialPick` answers false for it — the
        // repair below additionally re-checks the live preference before
        // writing, so a preference that is already back on `system` costs no
        // `setTheme` call.
        if (durable.sinceLastWrite() <= RESTORE_WINDOW_MS) {
          scheduleSystemRestore()
          return
        }
        mirrorOfficialPick()
      }
      return
    }
    // A built-in preference is the only value adopt() can write back, so it is
    // the only one that can be the echo this milestone answers.
    if (!isOfficialThemePreference(preference)) return
    if (durable.sinceLastWrite() <= RESTORE_WINDOW_MS) {
      scheduleReassert(choice)
      return
    }
    mirrorOfficialPick()
  }

  // The locale service already types this binding to the merged dictionary
  // union; SectionTranslate only narrows it to the keys this section reads.
  const t: SectionTranslate = locale.bind(LOCALE_NS)

  /**
   * The scheme the presenter is painting right now — the status line's third
   * fact.
   *
   * Read structurally instead of through `ThemeSnapshot`'s type: a composed
   * host always carries `active.colorScheme`, while a bare harness may hand
   * back a stub snapshot without it, and the settings page must render either
   * way (M5 "硬约束" 2 — the boot path never throws). A missing snapshot costs a
   * label, never the panel.
   * @returns `dark` only when the resolved snapshot says so.
   */
  const schemeNow = (): 'light' | 'dark' => {
    const snapshot = ctx.theme.getTheme() as
      | { readonly active?: { readonly colorScheme?: string } }
      | undefined
    return snapshot?.active?.colorScheme === 'dark' ? 'dark' : 'light'
  }

  /**
   * The section's whole view (M5.3): the choice to highlight and the status line
   * that explains the live state.
   *
   * `read()` is the section's ONLY input, which is what makes a remount safe:
   * the durable store answers with a queued intent (M5.1), so the remount a
   * settings write causes can no longer land on an older value than the click.
   * The line itself is composed HERE, not in the component, so every fact it
   * prints is read at render time from the service that owns it.
   * @returns the current view.
   */
  const read = (): MoonsetSectionView => {
    const choice = durable.read()
    // M2: the section also owns the glow controls, so the same read answers
    // them — one view, one subscription, no second source of truth.
    const current = glow.read()
    return {
      choice,
      status: describeState({
        choice,
        preference: deps.preference(),
        scheme: schemeNow(),
        layerAttached: follow.enabled,
        t,
      }),
      glowScope: current.scope,
      glow: current.glow,
      glowHueLight: current.hueLight,
      glowStrengthLight: current.strengthLight,
      glowHueDark: current.hueDark,
      glowStrengthDark: current.strengthDark,
    }
  }

  // The face the section receives. `choice` rides along as a live GETTER so the
  // face's M5 shape (and every test that reads it directly) keeps working while
  // there is exactly one answer: `read()`.
  const injected = (): MoonsetSectionFace => ({
    onPick: pick,
    onScope: setScope,
    onToggleGlow: setGlowOn,
    onHueLight: setHueLight,
    onStrengthLight: setStrengthLight,
    onHueDark: setHueDark,
    onStrengthDark: setStrengthDark,
    labels: sectionLabels(t),
    subscribe,
    read,
    get choice(): MoonsetChoice {
      return read().choice
    },
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
    // M2: the glow store is the second writer into the same view channel. Its
    // changes are BOTH a sheet rebuild and a section re-render, so it feeds the
    // same set — no separate effect, no second lifetime to forget.
    const unsubscribeGlow = glow.subscribe(() => {
      scheduleSkinRebuild()
      notifyView()
    })
    // `theme/change` is the ONLY continuous view of the official preference
    // (the host publishes it synchronously from `setTheme` / `adopt`), so the
    // mirror rule rides it. Rides this effect rather than a new one: the
    // listener and the choice it guards have exactly one lifetime. Guarded for
    // a context that carries no event bus (a bare unit-test stub), where the
    // boot path must still not throw (M5 "硬约束" 2).
    const releaseTheme = typeof ctx.on === 'function'
      ? ctx.on('theme/change', (snapshot: { preference: string }) => { handleThemeChange(snapshot) })
      : undefined
    restore()
    return () => {
      // A re-assert queued for this tick must not fire into an unloaded plugin.
      active = false
      // A queued sheet rebuild must not run into an unloaded plugin either.
      if (rebuildTimer !== undefined) {
        clearTimeout(rebuildTimer)
        rebuildTimer = undefined
      }
      unsubscribe()
      unsubscribeGlow()
      // No section survives the unload: dropping the set is what keeps a
      // queued `theme/change` from re-rendering an unmounted panel.
      viewListeners.clear()
      releaseTheme?.()
      follow.disable()
      durable.dispose()
      glow.dispose()
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
