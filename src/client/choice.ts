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
 *
 * M5.1 adds one more pure decision — {@link shouldMirrorOfficialPick} — because
 * the official Appearance row can move the runtime's preference while our
 * section still stores a Moonset choice, and the next boot would then undo the
 * user's own pick. It is a pure function of (preference, choice) with no
 * context, no `setTheme`, and no `ctx` access, so the table below is the whole
 * contract and the tests pin it without a host.
 */
import { zh, type MoonsetLocaleKey } from './locales.ts'
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

/**
 * The built-in preferences the official Appearance row can move the runtime to.
 *
 * `system` is handled separately below, because it is BOTH an official
 * preference and our own follow mode's end state.
 */
export const OFFICIAL_THEME_PICKS = ['light', 'dark'] as const

/**
 * Every preference the official Appearance row can put in the settings
 * document: the explicit pair plus "follow the OS".
 *
 * The Host's `isThemePreference` narrows the document to exactly these, which
 * is the fact M5.2 is built on: if a `theme/change` carries one of them while
 * our section stores a Moonset theme, either the user just acted or the
 * runtime just adopted the document over the preference we set.
 */
export const OFFICIAL_THEME_PREFERENCES = ['system', ...OFFICIAL_THEME_PICKS] as const

/**
 * Whether a `theme/change` preference is one of the built-ins.
 *
 * A third-party id — ours or a peer's — is never official, so a publish
 * carrying one can only be a theme application (ours included) and must not be
 * treated as the document adopting over us.
 * @param preference - the snapshot's preference (raw: a dirty or missing value
 * is simply "not official").
 * @returns true for `system` / `light` / `dark`.
 */
export function isOfficialThemePreference(preference: unknown): boolean {
  return (OFFICIAL_THEME_PREFERENCES as readonly unknown[]).includes(preference)
}

/**
 * Whether a `theme/change` preference means "the user just picked an OFFICIAL
 * theme", so the stored Moonset choice must be mirrored to `off`.
 *
 * Why mirror at all (M5 debt #1): a third-party id only lives in the runtime's
 * MEMORY preference, so our section is what remembers it — and a stored
 * `light` / `dark` / `follow` is re-applied at every boot. Left alone, the
 * official row would take effect for one session and then be overridden on the
 * next start. Seeing the preference become official while our section is live
 * therefore means "hand the UI back": store `off` (and let the caller release
 * the follow layer).
 *
 * Three cases, and the third is the subtle one:
 *
 *  - `light` / `dark` — the official row's explicit picks. Always mirror.
 *  - `system` while our choice is a CONCRETE Moonset theme — the official row's
 *    "follow the OS" pick. Mirror too: otherwise the next boot re-applies
 *    `moonset-light` over it, which is the same bug one row further left.
 *  - `system` while our choice IS `follow` — that value is what `applyChoice`
 *    itself writes (`setTheme('system')`), and the runtime publishes
 *    synchronously, so the listener sees it inside the same call. Mirroring
 *    here would make the follow switch delete itself the moment it is turned
 *    on, so this case is excluded BY CHOICE, not by a suppression window.
 *
 * Our own `setTheme('moonset-*')` calls never match: a third-party id is not
 * one of the built-in picks, which is why the id check is the guard that makes
 * self-published changes invisible to this rule.
 * @param preference - the `theme/change` snapshot's preference (raw, so a
 * third-party id, a missing field, or a dirty document value is simply "not
 * official").
 * @param choice - the choice the durable section currently holds.
 * @returns true when the caller must mirror the stored choice to `off`.
 */
export function shouldMirrorOfficialPick(preference: unknown, choice: MoonsetChoice): boolean {
  // `off` already means "no choice": there is nothing to mirror away.
  if (choice === 'off') return false
  // A third-party id — including our own `moonset-*` — is never official.
  if (!isOfficialThemePreference(preference)) return false
  // The official row's explicit light/dark pick.
  if ((OFFICIAL_THEME_PICKS as readonly unknown[]).includes(preference)) return true
  // `system` means different things depending on which side wrote it.
  return choice !== 'follow'
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
 * The registered theme id for a concrete choice.
 *
 * Exported for M5.2's re-assert, which has to name the theme without going
 * through the whole {@link applyChoice} step: re-asserting only restores the
 * preference the settings echo overwrote, it does not re-run the policy.
 * @param choice - a concrete (non-`off`/`follow`) choice.
 * @returns the registered theme id to hand to `setTheme`.
 */
export function moonsetThemeId(choice: 'light' | 'dark'): MoonsetThemeId {
  return choice === 'light' ? LIGHT_THEME_ID : DARK_THEME_ID
}

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
    deps.setTheme(moonsetThemeId(choice))
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

// ── M5.3: the status line ────────────────────────────────────────────────────
//
// The settings section renders ONE line describing the live state. It is not
// decoration: on the desktop shell the GUI window exposes no document to an
// outside observer (CDP answers with a single `dsh://host` target that has no
// DOM), so this line is the only place the plugin can SHOW what it believes —
// the stored choice, the runtime's preference, the resolved scheme, and
// whether the follow layer is actually stacked. That is why it is a pure
// function of exactly those four facts and nothing else: the tests pin the
// whole contract without a host, a renderer, or a DOM.

/** How the status line separates its four facts (punctuation, not copy). */
export const STATUS_SEPARATOR = ' · '

/**
 * The four facts the status line renders (M5.3).
 *
 * All four are read at render time by the plugin entry: the choice from the
 * durable store, the preference from the theme runtime, the scheme from the
 * runtime's resolved snapshot, and the layer from its own switch.
 */
export interface StateDescriptionInput {
  /** What this plugin stores — the highlighted button. */
  readonly choice: MoonsetChoice
  /** The runtime's live preference: `system`, a built-in, or a theme id. */
  readonly preference: string
  /** The scheme the presenter is painting right now. */
  readonly scheme: 'light' | 'dark'
  /** Whether the follow layer is stacked; only `follow` ever stacks it. */
  readonly layerAttached: boolean
  /**
   * Copy resolver for the three `status.*` labels. Optional so the line can be
   * produced without a locale service (a bare host, a unit test): the default
   * resolves through the `zh` dictionary, which is the key-set source of truth.
   */
  readonly t?: (key: MoonsetLocaleKey) => string
}

/** The zh dictionary as a translate function (the default {@link describeState} copy). */
const zhCopy = (key: MoonsetLocaleKey): string => zh[key]

/**
 * Compose the status line.
 *
 * `off` deliberately renders one short phrase instead of four facts: there is
 * no plugin state to report ("no choice made" IS the state), and the official
 * theme owns everything else.
 *
 * Other choices render all four facts, in this order:
 *
 *   `跟随系统 · 官方偏好 system · 当前方案 深色 · 覆盖层 已挂载`
 *
 * The preference is printed verbatim: it may be `system`, a built-in pick, or a
 * third-party id such as `moonset-dark`, and reading it is exactly what tells a
 * following user whether the runtime is still on `system` (the value follow
 * mode requires) or was pinned elsewhere.
 * @param input - the four live facts plus the optional copy resolver.
 * @returns the one-line status, already localized.
 */
export function describeState(input: StateDescriptionInput): string {
  const t = input.t ?? zhCopy
  // "No choice" is the whole story: the official theme and the official
  // preference are in charge, and a scheme/layer report would suggest this
  // plugin is doing something.
  if (input.choice === 'off') return t('status.off')
  const choiceLabel = t(
    input.choice === 'follow' ? 'option.follow' : input.choice === 'light' ? 'option.light' : 'option.dark',
  )
  return [
    choiceLabel,
    `${t('status.official')} ${input.preference}`,
    t(input.scheme === 'dark' ? 'status.scheme.dark' : 'status.scheme.light'),
    t(input.layerAttached ? 'status.layer.on' : 'status.layer.off'),
  ].join(STATUS_SEPARATOR)
}
