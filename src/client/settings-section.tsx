/**
 * The Moonset settings section — a thin, render-only component (M5 / M5.3).
 *
 * **Why this file builds elements with `createElement` instead of JSX
 * literals.** This package ships no React dependency (M1 kept the dependency
 * list at zero, and M5's brief forbids adding one), so neither `react` nor
 * `@types/react` is part of this TypeScript program: a JSX literal would not
 * compile (`react/jsx-runtime` cannot be resolved). React itself IS available
 * at runtime — the client artifact is a factory whose `require` answers from
 * the loader's frozen module table, which carries `react` and
 * `react/jsx-runtime` — so the element factory and the two hooks this
 * component needs are reached through that seam, and {@link ReactSurface} is
 * the narrow, hand-declared slice of React we actually call. `pnpm build` keeps
 * the reference as `require("react")` inside the factory, which is exactly the
 * module-table lookup.
 *
 * **Why it owns no decisions.** The choice, the persistence call, the copy, and
 * the live state all arrive through {@link MoonsetSectionProps}: the controller
 * in `choice.ts` / `durable.ts` is what the unit tests pin, this file only
 * renders. Every view it shows comes from `read()` — including the status line
 * (M5.3), which is `describeState`'s output and never a string composed here.
 *
 * **M5.3 — why there is no prop mirror any more.** M5 kept an optimistic
 * `useState` highlight seeded from the `choice` PROP. A settings write makes
 * the Host re-derive its scope forms and REMOUNT this section, and because the
 * write is queued for 300 ms (M5.1) the remount can arrive before the document
 * moved: the local highlight resets to the old prop and the click looks
 * ignored ("点了跟随系统，设置区不跳"). The durable store already answers with
 * the queued intent, so the component now seeds from `read()` (the same answer
 * a remount gets) and re-reads on every change instead of keeping a second
 * copy of the truth. The click still moves the highlight SYNCHRONOUSLY and
 * optimistically — the store cannot possibly have the new value yet — and the
 * subscription then corrects the view.
 *
 * **Styling is inline only.** No stylesheet, no CSS Modules pipeline (M1 debt
 * #2), and no DOM style writes: every colour is one of the host's own
 * `--dsw-*` tokens, so the section follows whichever theme is active — Moonset,
 * official, or a peer's. The plugin writes no DOM style of its own: only the
 * elements it renders carry a `style` attribute, never the document root.
 */
import type { MoonsetChoice } from './choice.ts'
import { GLOW_STRENGTH_MAX, GLOW_STRENGTH_MIN, type GlowHue, type GlowScope } from './skin.ts'

/** One option the section renders: the value it applies and its localized label. */
export interface MoonsetOptionLabel {
  /** The choice this button applies. */
  readonly value: MoonsetChoice
  /** Localized button text. */
  readonly label: string
}

/** One 地面范围 button (M2): the scope it applies and its localized label. */
export interface MoonsetScopeLabel {
  /** The scope this button applies. */
  readonly value: GlowScope
  /** Localized button text. */
  readonly label: string
}

/** One 光晕色相 button (M4): the hue it applies and its localized label. */
export interface MoonsetHueLabel {
  /** The hue this button applies. */
  readonly value: GlowHue
  /** Localized button text. */
  readonly label: string
}

/** Every piece of copy the section renders (built from the locale binding). */
export interface MoonsetSectionLabels {
  /** Section heading. */
  readonly title: string
  /** One explanatory line under the theme buttons. */
  readonly description: string
  /** The theme buttons, in display order. */
  readonly options: readonly MoonsetOptionLabel[]
  /** M2: the glow block's own heading (the switch rides its button text). */
  readonly glowTitle: string
  /** M2: the switch's ON word. */
  readonly glowOn: string
  /** M2: the switch's OFF word. */
  readonly glowOff: string
  /** M2: the ground-scope row heading. */
  readonly scopeTitle: string
  /** M2: the three 地面范围 buttons, in display order. */
  readonly scopeOptions: readonly MoonsetScopeLabel[]
  /** M2: the strength row's label (the value is appended as a percentage). */
  readonly strengthTitle: string
  /** M6: the LIGHT ground group's heading. */
  readonly lightTitle: string
  /** M6: the DARK ground group's heading. */
  readonly darkTitle: string
  /** M6: the three hue buttons (shared by both groups), in display order. */
  readonly hueOptions: readonly MoonsetHueLabel[]
  /** M2: one line explaining what the scope changes. */
  readonly hint: string
}

/**
 * One render's worth of state (M5.3): the choice to highlight and the status
 * line to print. Produced by the plugin entry's `read()`, so a remount, a
 * durable change, and an OS flip all resolve through the same answer.
 */
export interface MoonsetSectionView {
  /** The durable choice as of this read (`off` = official theme). */
  readonly choice: MoonsetChoice
  /** `describeState`'s one-line summary of the live state. */
  readonly status: string
  /** M2: the ground scope the carrier clear uses. */
  readonly glowScope: GlowScope
  /** M2: whether the environment glow is on. */
  readonly glow: boolean
  /** M6: the LIGHT ground's strength in percent (0-200). */
  readonly glowStrengthLight: number
  /** M6: the LIGHT ground's hue. */
  readonly glowHueLight: GlowHue
  /** M6: the DARK ground's strength in percent (0-200). */
  readonly glowStrengthDark: number
  /** M6: the DARK ground's hue. */
  readonly glowHueDark: GlowHue
}

/** The props this component takes — nothing else is wired to it. */
export interface MoonsetSectionProps {
  /** Persist and apply one pick (owned by the plugin entry, not by this file). */
  readonly onPick: (choice: MoonsetChoice) => void
  /** M2: persist one 地面范围 pick. */
  readonly onScope: (scope: GlowScope) => void
  /** M2: flip the environment glow. */
  readonly onToggleGlow: (next: boolean) => void
  /** M6: the LIGHT ground's hue pick. */
  readonly onHueLight: (hue: GlowHue) => void
  /** M6: the LIGHT ground's strength (0-200). */
  readonly onStrengthLight: (next: number) => void
  /** M6: the DARK ground's hue pick. */
  readonly onHueDark: (hue: GlowHue) => void
  /** M6: the DARK ground's strength (0-200). */
  readonly onStrengthDark: (next: number) => void
  /** Localized copy. */
  readonly labels: MoonsetSectionLabels
  /**
   * Observe every state change the view draws: a durable change (a pick
   * landing, a late form binding) AND `theme/change` (the OS flipping while
   * following changes no stored value, but it moves the scheme and the live
   * half of the layer). Returns the release that unbinds both.
   */
  readonly subscribe: (listener: () => void) => () => void
  /** Read the current view: the choice to highlight and the status line. */
  readonly read: () => MoonsetSectionView
}

/**
 * The face the slot registration hands the section (M5.3).
 *
 * `choice` is a live alias of `read().choice`, kept because the injected face
 * carried it in M5 and the tests read it directly. A getter, not a field, so it
 * can never disagree with `read()` — the M5.3 bug was exactly such a second
 * copy going stale.
 */
export interface MoonsetSectionFace extends MoonsetSectionProps {
  /** The durable choice right now (`read().choice`, read live). */
  readonly choice: MoonsetChoice
}

/** The slice of React this component calls (see the file header). */
interface ReactSurface {
  /** `React.createElement`: the element factory, typed structurally. */
  createElement(type: string, props: Record<string, unknown> | null, ...children: readonly unknown[]): unknown
  /** `React.useState`: the view seeded from `read()` plus the optimistic click. */
  useState<S>(initial: S): readonly [S, (next: S) => void]
  /** `React.useEffect`: the one subscription, released on unmount. */
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

/** Cached surface: resolved once, on the first render. */
let reactSurface: ReactSurface | undefined

/**
 * Resolve React on FIRST RENDER, not at module evaluation.
 *
 * React is reached through the client factory's `require` (the loader module
 * table), not through a package dependency; `@types/node` types `require`,
 * which is why this call type-checks without React types. Lazy on purpose: this
 * module is also imported by environments that carry no React at all (the unit
 * tests, a Node-side tool reading the plugin's exports). The host always has
 * it — `react` is a platform module of the frozen loader table — so the call
 * cannot fail there, and a bare import elsewhere no longer crashes on a module
 * that is never rendered.
 * @returns the narrow React surface this component calls.
 */
function react(): ReactSurface {
  reactSurface ??= require('react') as ReactSurface
  return reactSurface
}

/**
 * Inline geometry and colour. The tokens are the host's: the accent for the
 * active button, the hairline border and the secondary label for the others, so
 * the section reads correctly in every theme.
 *
 * **0.1.3 M1 (G1) — why the active fill is not `brand-primary`.** The shipped
 * 0.1.2 pair was `--dsw-alias-brand-primary` as the fill and
 * `--dsw-alias-label-on-color` as the text. `brand-primary` is the scheme's
 * INK, not a brand accent: `var(--dsw-static-neutral-bluish-1000)` in light
 * (`#10131C`) but `var(--dsw-static-neutral-bluish-50)` in dark
 * (`#E8EBF2`, near-white), while the label alias is near-white in BOTH
 * (`#FAFAFC` / `#EEF0F7`). Dark therefore painted white on white — measured
 * **1.05:1**, the user's 「白底白字」; light measured 17.8:1 and hid the fault.
 * A fill is an ACCENT seat (the skin layer's rule for selection is the same), so
 * it comes from the accent ladder.
 *
 * Which rung is not free: one pair of declarations has to clear AA (>= 4.5:1)
 * in BOTH schemes, and the ladder moves per scheme (light `-500` is `#4338CA`,
 * dark `-500` is `#818CF8` — the dark ladder is lighter throughout). Measured
 * on the shipped palettes:
 *
 *   `-600` + `label-on-color` (white): 9.47:1 light / 3.68:1 dark  -> below AA
 *   `-500` + `label-on-color`:          7.58:1 light / 2.62:1 dark  -> below AA
 *   `-400` + `neutral-bluish-1000`:     4.63:1 light / 8.07:1 dark  -> shipped
 *
 * The text token is the neutral ladder's DARKEST rung on purpose: the neutral
 * 00..1000 direction is constant across schemes (class A in the generator), so
 * `neutral-bluish-1000` is `#10131C` light / `#08090E` dark — dark in BOTH —
 * where every `label-*` alias flips with the scheme and would reintroduce the
 * bug. `-400` is the accent rung that still carries dark text: it resolves per
 * scheme (`#7A72D9` / `#959EF8`), which is the same "one declaration, two
 * schemes" trick the skin sheet uses. Both tokens are host-owned, so a theme
 * switch or a peer theme carries the button with it — on the OFFICIAL table the
 * pair is `#7AAAFF` on `#0F1115` = 8.12:1 — and no literal colour is written
 * here (P5). `tests/live.spec.ts` re-measures all of this from the palettes.
 *
 * **M1.5 — the strength slider rides the same rung.** Its `accentColor` was the
 * same `brand-primary` ink, so in the dark scheme the range input painted a
 * near-white track and thumb instead of the accent. Same fix, same token: the
 * slider is part of the active/accent seat family, not a neutral one.
 */
const CONTAINER_STYLE: Readonly<Record<string, string>> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '4px 0',
}
const TITLE_STYLE: Readonly<Record<string, string>> = {
  fontSize: '13px',
  fontWeight: '600',
  color: 'var(--dsw-alias-label-primary)',
}
const ROW_STYLE: Readonly<Record<string, string>> = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
}
const BUTTON_STYLE: Readonly<Record<string, string>> = {
  appearance: 'none',
  cursor: 'pointer',
  padding: '6px 14px',
  borderRadius: '8px',
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: '13px',
  lineHeight: '1.4',
}
const ACTIVE_BUTTON_STYLE: Readonly<Record<string, string>> = {
  ...BUTTON_STYLE,
  border: '1px solid var(--dsw-static-deepseek-400)',
  background: 'var(--dsw-static-deepseek-400)',
  color: 'var(--dsw-static-neutral-bluish-1000)',
}
const STATUS_STYLE: Readonly<Record<string, string>> = {
  margin: '0',
  fontSize: '11px',
  lineHeight: '1.6',
  color: 'var(--dsw-alias-label-tertiary)',
  // The line is a diagnostic, not decoration: it may be long, and a settings
  // column is narrow, so it wraps instead of forcing the panel wider.
  overflowWrap: 'anywhere',
}
const DESCRIPTION_STYLE: Readonly<Record<string, string>> = {
  margin: '0',
  fontSize: '12px',
  lineHeight: '1.6',
  color: 'var(--dsw-alias-label-tertiary)',
}
// ── M2: the glow block ──────────────────────────────────────────────────────
// A hairline separates the theme buttons from the ground controls: they are
// two different kinds of setting, and the section is one column.
const GLOW_BLOCK_STYLE: Readonly<Record<string, string>> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  paddingTop: '10px',
  borderTop: '1px solid var(--dsw-alias-border-l1)',
}
const ROW_LABEL_STYLE: Readonly<Record<string, string>> = {
  fontSize: '12px',
  lineHeight: '1.4',
  color: 'var(--dsw-alias-label-secondary)',
}
const STRENGTH_ROW_STYLE: Readonly<Record<string, string>> = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
}
const SLIDER_STYLE: Readonly<Record<string, string>> = {
  flex: '1',
  minWidth: '80px',
  accentColor: 'var(--dsw-static-deepseek-400)',
}
const VALUE_STYLE: Readonly<Record<string, string>> = {
  fontSize: '12px',
  minWidth: '44px',
  textAlign: 'right',
  color: 'var(--dsw-alias-label-secondary)',
}
// M6: one bordered block per ground (浅色 / 深色), so the two independent
// pairs read as two rows of controls rather than six loose buttons.
const GROUP_STYLE: Readonly<Record<string, string>> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  paddingTop: '8px',
  borderTop: '1px dashed var(--dsw-alias-border-l1)',
}
const GROUP_TITLE_STYLE: Readonly<Record<string, string>> = {
  fontSize: '12px',
  fontWeight: '500',
  lineHeight: '1.4',
  color: 'var(--dsw-alias-label-primary)',
}
const HINT_STYLE: Readonly<Record<string, string>> = {
  margin: '0',
  fontSize: '11px',
  lineHeight: '1.6',
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * Render the Moonset section: a heading, one button per choice, the status
 * line, and one line of explanation.
 *
 * The highlight is `view.choice` — the optimistic click the user just made,
 * or `read()`'s answer on a remount. It never re-implements the controller
 * (`applyChoice`), which is why no assertion in `tests/settings.spec.ts` needs
 * to render this file; the behavioural cases live in `tests/live.spec.ts`,
 * which supplies a minimal React.
 * @param props - the injected face: pick callback, copy, the view, and its
 *   subscription.
 * @returns the section element tree.
 */
export function MoonsetSection({
  onPick,
  onScope,
  onToggleGlow,
  onHueLight,
  onStrengthLight,
  onHueDark,
  onStrengthDark,
  labels,
  subscribe,
  read,
}: MoonsetSectionProps): unknown {
  const React = react()
  // Seeded from `read()`, never from a prop mirror: the durable store already
  // answers with a QUEUED intent (M5.1), so a remount caused by the settings
  // write cannot land on an older value than the click.
  const [view, setView] = React.useState<MoonsetSectionView>(read())
  // One subscription, both sources (durable + theme/change), released when the
  // Host unmounts the section — otherwise every settings open/close would leak
  // a listener into the plugin's view set.
  React.useEffect(() => subscribe(() => { setView(read()) }), [])

  /**
   * Move the highlight on the click itself, then let the plugin apply it.
   * The status keeps its previous text for this render; `onPick` publishes a
   * `theme/change` synchronously, and the subscription replaces it with the
   * real one in the same tick.
   * @param next - the choice the clicked button stands for.
   */
  const pick = (next: MoonsetChoice): void => {
    setView({ ...read(), choice: next })
    onPick(next)
  }

  /**
   * M2: the same optimistic shape for the three glow controls.
   *
   * Each one moves its own field in THIS render (the store cannot have the new
   * value yet) and hands the change to the plugin entry, which persists it
   * (300 ms debounce) and schedules the sheet rebuild (150 ms).
   */
  const pickScope = (next: GlowScope): void => {
    setView({ ...read(), glowScope: next })
    onScope(next)
  }

  const toggleGlow = (): void => {
    const next = !read().glow
    setView({ ...read(), glow: next })
    onToggleGlow(next)
  }

  /**
   * M6: one ground group's two controls, each optimistic like the scope row.
   *
   * The light and dark grounds are independent (the user's final call is 柔和 @90
   * in light and 夜空蓝 @100 in dark), so each group writes only its own pair of
   * fields and the patch shape stays a partial view.
   */
  const pickHueLight = (next: GlowHue): void => {
    setView({ ...read(), glowHueLight: next })
    onHueLight(next)
  }

  const pickHueDark = (next: GlowHue): void => {
    setView({ ...read(), glowHueDark: next })
    onHueDark(next)
  }

  /**
   * Read one slider's own value and hand it over.
   *
   * The element is reached structurally: this file carries no DOM types (no
   * `lib.dom` in the client program — see the header), and the value is the only
   * thing the handler needs.
   * @param event - the input's change event.
   * @param apply - the setter for the group that owns the slider.
   */
  const readSlider = (event: unknown): number | undefined => {
    const value = (event as { currentTarget?: { value?: unknown } }).currentTarget?.value
    const next = Number(value)
    return Number.isFinite(next) ? next : undefined
  }

  const setStrengthLight = (next: number): void => {
    setView({ ...read(), glowStrengthLight: next })
    onStrengthLight(next)
  }

  const setStrengthDark = (next: number): void => {
    setView({ ...read(), glowStrengthDark: next })
    onStrengthDark(next)
  }

  /**
   * One ground group: heading, the shared three hue buttons, a slider + value.
   * @param spec - the group's own copy, hue, strength and the two callbacks.
   * @returns the rendered group.
   */
  const groundGroup = (spec: {
    readonly title: string
    readonly hue: GlowHue
    readonly strength: number
    readonly onPick: (hue: GlowHue) => void
    readonly onStrength: (next: number) => void
  }): unknown => React.createElement(
    'div',
    { style: GROUP_STYLE },
    React.createElement('div', { style: GROUP_TITLE_STYLE }, spec.title),
    React.createElement(
      'div',
      { style: ROW_STYLE, role: 'group', 'aria-label': spec.title },
      ...labels.hueOptions.map((option) => React.createElement(
        'button',
        {
          key: option.value,
          type: 'button',
          'aria-pressed': option.value === spec.hue,
          onClick: () => { spec.onPick(option.value) },
          style: option.value === spec.hue ? ACTIVE_BUTTON_STYLE : BUTTON_STYLE,
        },
        option.label,
      )),
    ),
    React.createElement(
      'div',
      { style: STRENGTH_ROW_STYLE },
      React.createElement('span', { style: ROW_LABEL_STYLE }, labels.strengthTitle),
      React.createElement('input', {
        type: 'range',
        min: GLOW_STRENGTH_MIN,
        max: GLOW_STRENGTH_MAX,
        step: 10,
        value: spec.strength,
        'aria-label': spec.title + ' ' + labels.strengthTitle,
        onChange: (event: unknown) => {
          const next = readSlider(event)
          if (next !== undefined) spec.onStrength(next)
        },
        style: SLIDER_STYLE,
      }),
      React.createElement('span', { style: VALUE_STYLE }, `${spec.strength}%`),
    ),
  )



  return React.createElement(
    'div',
    { style: CONTAINER_STYLE },
    React.createElement('div', { style: TITLE_STYLE }, labels.title),
    React.createElement(
      'div',
      { style: ROW_STYLE, role: 'group', 'aria-label': labels.title },
      ...labels.options.map((option) => React.createElement(
        'button',
        {
          key: option.value,
          type: 'button',
          'aria-pressed': option.value === view.choice,
          onClick: () => { pick(option.value) },
          style: option.value === view.choice ? ACTIVE_BUTTON_STYLE : BUTTON_STYLE,
        },
        option.label,
      )),
    ),
    // role=status: a live region, so the line is announced when it changes
    // without stealing focus from the button the user just pressed.
    React.createElement('p', { style: STATUS_STYLE, role: 'status' }, view.status),
    React.createElement('p', { style: DESCRIPTION_STYLE }, labels.description),
    // ── M2: the environment glow ────────────────────────────────────────────
    React.createElement(
      'div',
      { style: GLOW_BLOCK_STYLE },
      React.createElement(
        'div',
        { style: ROW_STYLE },
        React.createElement(
          'button',
          {
            type: 'button',
            'aria-pressed': view.glow,
            onClick: () => { toggleGlow() },
            style: view.glow ? ACTIVE_BUTTON_STYLE : BUTTON_STYLE,
          },
          `${labels.glowTitle} ${view.glow ? labels.glowOn : labels.glowOff}`,
        ),
      ),
      React.createElement('div', { style: ROW_LABEL_STYLE }, labels.scopeTitle),
      React.createElement(
        'div',
        { style: ROW_STYLE, role: 'group', 'aria-label': labels.scopeTitle },
        ...labels.scopeOptions.map((option) => React.createElement(
          'button',
          {
            key: option.value,
            type: 'button',
            'aria-pressed': option.value === view.glowScope,
            onClick: () => { pickScope(option.value) },
            style: option.value === view.glowScope ? ACTIVE_BUTTON_STYLE : BUTTON_STYLE,
          },
          option.label,
        )),
      ),
      // ── M6: the two grounds, each with its own hue and strength ─────────────
      groundGroup({
        title: labels.lightTitle,
        hue: view.glowHueLight,
        strength: view.glowStrengthLight,
        onPick: (hue) => { pickHueLight(hue) },
        onStrength: (next) => { setStrengthLight(next) },
      }),
      groundGroup({
        title: labels.darkTitle,
        hue: view.glowHueDark,
        strength: view.glowStrengthDark,
        onPick: (hue) => { pickHueDark(hue) },
        onStrength: (next) => { setStrengthDark(next) },
      }),
      React.createElement('p', { style: HINT_STYLE }, labels.hint),
    ),
  )
}
