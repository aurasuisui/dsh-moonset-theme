/**
 * Moonset theme definitions and the "follow system" token layer (M4).
 *
 * Pure logic: no DOM, no cordis import, and no runtime value from any
 * `@deepseek-ai/dsh-*` package — the theme service arrives as an argument
 * (injected through `ctx` by `apply`), and the only import from the official
 * theme package is erased `import type`.
 *
 * Two registered themes, not one theme with two palettes: `colorScheme` on a
 * {@link ThemeDefinition} is a single value, so light and dark have to be two
 * definitions (PLAN "九、已决" #1, D4). "Follow system" therefore cannot be a
 * theme: selecting it would pin the preference away from `system`, and the
 * host derives both `prefers-color-scheme` handling and the native window
 * chrome from that preference (docs/issue-36-follow-system.md §2). The
 * working mechanism is an `overrideTokens` layer that carries BOTH halves and
 * lets the runtime pick per active scheme (§3).
 */
import type { ThemeDefinition, ThemeRuntime, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import { MOONSET_DARK, MOONSET_LIGHT, type MoonsetTokenTable } from './palettes.ts'
import { tolerantDisposer, tolerantRegistration, type TolerantDisposer } from './registration-tolerance.ts'

/** One registrable theme id: fixed, `moonset-`-prefixed, and never shared (D3). */
export type MoonsetThemeId = 'moonset-light' | 'moonset-dark'

/** Identity of one of the two themes, including the label M5's settings row renders. */
export interface MoonsetThemeInfo {
  /** Registration id and `setTheme` argument. */
  readonly id: MoonsetThemeId
  /** Human-readable name for the Appearance row ("Moonset Light"). */
  readonly label: string
  /** Base palette the definition builds on (drives `body[data-ds-dark-theme]`). */
  readonly colorScheme: 'light' | 'dark'
}

/**
 * The two themes, light first (it is the plugin's default pick).
 * `satisfies` keeps the literal ids for {@link MoonsetThemeId} while checking
 * every row against the interface.
 */
export const MOONSET_THEMES = [
  { id: 'moonset-light', label: 'Moonset Light', colorScheme: 'light' },
  { id: 'moonset-dark', label: 'Moonset Dark', colorScheme: 'dark' },
] as const satisfies readonly MoonsetThemeInfo[]

/** The registrable ids, in registration order. */
export const MOONSET_THEME_IDS: readonly MoonsetThemeId[] = MOONSET_THEMES.map((theme) => theme.id)

/** One token table per id: the 228 `--dsw-*` values from the palette generator. */
const MOONSET_TOKENS: Readonly<Record<MoonsetThemeId, MoonsetTokenTable>> = {
  'moonset-light': MOONSET_LIGHT,
  'moonset-dark': MOONSET_DARK,
}

/**
 * Build the two registry entries.
 *
 * `tokens` is the generated table by reference on purpose: the runtime folds
 * the definitions into an immutable snapshot and never writes into them, and
 * a per-call 228-key copy would buy nothing.
 * @returns the light and dark definitions, in registration order.
 */
export function moonsetDefinitions(): ThemeDefinition[] {
  return MOONSET_THEMES.map((theme) => ({
    id: theme.id,
    colorScheme: theme.colorScheme,
    // Every id in MOONSET_THEMES has a table; the lookup is total by type.
    tokens: MOONSET_TOKENS[theme.id],
  }))
}

/**
 * The slice of the official `ThemeRuntime` this module drives. Structural on
 * purpose: the client bundle never imports the runtime (it is injected through
 * `ctx`), and tests pass a fake with exactly these members.
 */
export type MoonsetThemeService = Pick<ThemeRuntime, 'register' | 'overrideTokens'>

/**
 * Live registrations, one entry per theme-runtime instance. Keyed by the
 * service object so a second runtime (a test's fake, a reloaded host) is a
 * separate registration, while a repeat call against the SAME runtime is the
 * idempotent no-op `apply` needs on a re-activation.
 */
const registrations = new WeakMap<MoonsetThemeService, TolerantDisposer>()

/**
 * Register `moonset-light` and `moonset-dark` (D3: both ride
 * {@link tolerantRegistration}, so a peer owning an id costs a skip, never a
 * boot failure).
 *
 * Idempotent per runtime: while a registration is live, further calls return
 * the same disposer instead of re-registering (the runtime throws on a
 * duplicate id). Releasing the disposer clears the memo, so a later call
 * registers again — that is the unload/reload path. Two fibers of the same
 * plugin on one runtime therefore share ONE registration (and one release):
 * a duplicate install has one owner, which is what keeps the ids off the
 * "already registered" path in the first place.
 * @param theme - the injected theme service.
 * @returns one disposer releasing whichever registrations went through.
 */
export function registerMoonsetThemes(theme: MoonsetThemeService): TolerantDisposer {
  const live = registrations.get(theme)
  if (live) return live

  let skipped = false
  const releases: (() => void)[] = []
  // Per definition, not around the pair: a peer that took only `moonset-dark`
  // must still leave our `moonset-light` registered instead of dropping both.
  for (const definition of moonsetDefinitions()) {
    const registration = tolerantRegistration(() => theme.register(definition))
    skipped = registration.skipped || skipped
    releases.push(registration)
  }

  const disposer = tolerantDisposer(() => {
    registrations.delete(theme)
    for (const release of releases) release()
  }, skipped)
  registrations.set(theme, disposer)
  return disposer
}

/** Layer identity handed to `overrideTokens` (the plugin id, per the theme API contract). */
export const FOLLOW_LAYER_SOURCE = 'dsh-moonset'

/**
 * The follow-system layer's contents: every token exactly once, as a
 * `{ light, dark }` pair whose halves come from the matching table
 * (docs/issue-36-follow-system.md §5.4). A token present in only one table
 * falls back to that table's value for both halves — the runtime rejects a
 * half-filled pair, and one scheme going illegible is worse than one token
 * being scheme-invariant. Both tables currently carry the same 228 names;
 * `tests/theme.spec.ts` locks that so a divergence cannot pass silently.
 * @returns the 228-entry override dictionary (fresh object per call).
 */
export function moonsetFollowOverrides(): ThemeTokenOverrides {
  const overrides: ThemeTokenOverrides = {}
  for (const name of new Set([...Object.keys(MOONSET_LIGHT), ...Object.keys(MOONSET_DARK)])) {
    const light = MOONSET_LIGHT[name] ?? MOONSET_DARK[name]
    const dark = MOONSET_DARK[name] ?? MOONSET_LIGHT[name]
    overrides[name] = { light, dark }
  }
  return overrides
}

/**
 * The "follow system" switch. It never writes the theme preference: the
 * preference stays `system` and the OS decides which half of the layer is
 * live, which is what keeps `prefers-color-scheme` (and the native window
 * chrome derived from it) working (D4).
 *
 * Ownership: the caller owns the lifecycle. M5 calls `enable()` when the user
 * turns the switch on and `disable()` when they pick a concrete theme.
 */
export interface FollowSystemLayer {
  /**
   * Stack the layer over the active theme. Idempotent while stacked.
   *
   * MUST NOT be called from inside a `'theme/change'` dispatch: the runtime
   * publishes synchronously from `overrideTokens`, so rebuilding the layer in
   * a listener re-enters the publish it is answering (issue #36 constraint 2).
   * Calling it from application code — a settings-row click, the boot effect —
   * is fine, and a re-entrant call is ignored with a warning.
   */
  enable(): void
  /**
   * Release the layer, restoring whatever it covered. Idempotent. Same
   * re-entrancy rule as {@link FollowSystemLayer.enable}.
   */
  disable(): void
  /** Whether the layer is currently stacked (M5 renders the switch from this). */
  readonly enabled: boolean
}

/**
 * Create the follow-system layer for one theme service.
 * @param theme - the injected theme service.
 * @returns the switch, bound to no lifecycle of its own.
 */
export function createFollowLayer(theme: MoonsetThemeService): FollowSystemLayer {
  let layer: TolerantDisposer | undefined
  // Set while our own `overrideTokens`/release call is on the stack. Anything
  // re-entering during that window came from a synchronous publish and is
  // ignored rather than allowed to rebuild the layer mid-dispatch.
  let mutating = false

  const reentered = (action: 'enable' | 'disable'): boolean => {
    if (!mutating) return false
    console.warn(
      `[dsh-moonset] follow layer ${action}() ignored — called from inside a token-layer change; `
      + 'defer it to the caller (issue #36 constraint 2)',
    )
    return true
  }

  return {
    enable(): void {
      if (layer !== undefined || reentered('enable')) return
      mutating = true
      try {
        const pushed = tolerantRegistration(() => theme.overrideTokens(FOLLOW_LAYER_SOURCE, moonsetFollowOverrides()))
        // A skipped push leaves the layer unstacked so the next enable retries.
        if (!pushed.skipped) layer = pushed
      } finally {
        mutating = false
      }
    },
    disable(): void {
      const current = layer
      if (current === undefined || reentered('disable')) return
      // Cleared first: the disposer may publish synchronously, and a listener
      // observing `enabled` must already see the layer gone.
      layer = undefined
      mutating = true
      try {
        current()
      } finally {
        mutating = false
      }
    },
    get enabled(): boolean {
      return layer !== undefined
    },
  }
}
