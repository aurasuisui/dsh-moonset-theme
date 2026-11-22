/**
 * The user's Moonset choice, and the pure step that applies it (M5).
 *
 * Two responsibilities, both free of module-scope state:
 *
 *  - {@link resolveChoice} narrows anything the durable section can hand back
 *    (a value from an older version, a hand-edited document, `undefined` while
 *    the form is still loading) into a {@link MoonsetChoice}, defaulting to
 *    `off`;
 *  - {@link applyChoice} drives the theme service and the follow layer. The
 *    services arrive as ARGUMENTS — this module never reads a cordis context —
 *    which is what lets `tests/settings.spec.ts` pin the call order without a
 *    host (M5 "硬约束" 3).
 *
 * `off` is not a theme: it means "hand the UI back to the official theme",
 * spelled as `setTheme('system')` plus a released layer. It is also the state a
 * profile that never picked anything is in, which is why the boot path
 * deliberately does NOT re-apply it (that would overwrite the user's official
 * preference with `system` on every start).
 */
import type { MoonsetLocaleKey } from './locales.ts'
import { MOONSET_THEME_IDS, type FollowSystemLayer, type MoonsetThemeId } from './themes.ts'

/** What the plugin remembers: a concrete theme, the follow layer, or nothing. */
export type MoonsetChoice = 'off' | 'light' | 'dark' | 'follow'

/** Every accepted value — the durable schema's union, client side. */
export const MOONSET_CHOICES: readonly MoonsetChoice[] = ['off', 'light', 'dark', 'follow']

/** One option the settings section offers: the value it sets and its copy key. */
export interface MoonsetSectionOption {
  /** The choice this button applies. */
  readonly value: MoonsetChoice
  /** Dictionary key of its label. */
  readonly localeKey: MoonsetLocaleKey
}

/**
 * The three choices the section renders, in display order.
 *
 * `off` is deliberately not one of them: it is the ABSENCE of a choice (the
 * state a fresh profile is already in), not an action, and M5's brief fixes the
 * section at three buttons. Returning to an official theme goes through the
 * official Appearance row; a fourth "official" button would be a section
 * change, and `off` is here so that a stored value can still say it.
 */
export const MOONSET_SECTION_OPTIONS: readonly MoonsetSectionOption[] = [
  { value: 'light', localeKey: 'option.light' },
  { value: 'dark', localeKey: 'option.dark' },
  { value: 'follow', localeKey: 'option.follow' },
]

/**
 * Narrow one raw section value to a choice.
 *
 * The input crosses a document boundary, so it is `unknown` on purpose:
 * anything unrecognized (missing field, pre-release value, hand-edited JSON)
 * becomes `off`, the state that leaves the official theme alone.
 * @param raw - the section's `choice` field.
 * @returns the narrowed choice.
 */
export function resolveChoice(raw: unknown): MoonsetChoice {
  return typeof raw === 'string' && (MOONSET_CHOICES as readonly string[]).includes(raw)
    ? raw as MoonsetChoice
    : 'off'
}

/** The services one apply drives, all injected so the function stays pure. */
export interface ChoiceDeps {
  /** Write the official preference: `system`, or a registered theme id. */
  readonly setTheme: (id: string) => void
  /** Read the current official preference (the value BEFORE this call). */
  readonly preference: () => string
  /** The M4 follow-system layer switch. */
  readonly follow: Pick<FollowSystemLayer, 'enable' | 'disable'>
}

/**
 * Choice → registered theme id, read off the shared theme table instead of
 * restating the ids. `MOONSET_THEMES` is declared light-first and
 * `tests/theme.spec.ts` pins that order, so the two indices cannot drift
 * silently; `tests/settings.spec.ts` pins the resulting ids as well.
 */
const LIGHT_THEME_ID: MoonsetThemeId = MOONSET_THEME_IDS[0]
const DARK_THEME_ID: MoonsetThemeId = MOONSET_THEME_IDS[1]

/**
 * Apply one choice to the live theme runtime.
 *
 * The two mechanisms are mutually exclusive by design (D4): a concrete Moonset
 * theme must have the follow layer RELEASED first (otherwise the layer keeps
 * re-painting the tokens the theme just set), and "follow system" must leave
 * the preference on `system` — any other value pins the scheme in the theme
 * runtime and the OS-chosen half of the layer never becomes live.
 *
 * Follow mode therefore also resets a preference the user may have set from the
 * official Appearance row (`light` / `dark`): those would pin the scheme, and
 * choosing "follow" has to mean `system` — which is exactly M5's exit assertion
 * "最终 preference 必须 = system".
 * @param choice - the narrowed durable choice.
 * @param deps - the injected services this call drives.
 */
export function applyChoice(choice: MoonsetChoice, deps: ChoiceDeps): void {
  if (choice === 'light' || choice === 'dark') {
    // Release first: the layer covers the very tokens the theme is about to set.
    deps.follow.disable()
    deps.setTheme(choice === 'light' ? LIGHT_THEME_ID : DARK_THEME_ID)
    return
  }
  if (choice === 'follow') {
    // Order matters: the layer composes over the ACTIVE theme, so the
    // preference has to read `system` before the layer is stacked.
    if (deps.preference() !== 'system') deps.setTheme('system')
    deps.follow.enable()
    return
  }
  // `off`: official theme, official preference, no layer.
  deps.follow.disable()
  deps.setTheme('system')
}
