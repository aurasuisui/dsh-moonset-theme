/**
 * The Moonset settings section — a thin, render-only component (M5).
 *
 * **Why this file builds elements with `createElement` instead of JSX
 * literals.** This package ships no React dependency (M1 kept the dependency
 * list at zero, and M5's brief forbids adding one), so neither `react` nor
 * `@types/react` is part of this TypeScript program: a JSX literal would not
 * compile (`react/jsx-runtime` cannot be resolved). React itself IS available
 * at runtime — the client artifact is a factory whose `require` answers from
 * the loader's frozen module table, which carries `react` and
 * `react/jsx-runtime` — so the element factory and the one hook this component
 * needs are reached through that seam, and {@link ReactSurface} is the narrow,
 * hand-declared slice of React we actually call. `pnpm build` keeps the
 * reference as `require("react")` inside the factory, which is exactly the
 * module-table lookup.
 *
 * **Why it owns no decisions.** The choice, the persistence call, and the copy
 * all arrive as props ({@link MoonsetSectionProps} is the whole interface), so
 * the controller in `choice.ts` / `durable.ts` is what the unit tests pin —
 * this repo has no React test stack (PLAN 九、已知债), and the visual check is
 * M7's.
 *
 * **Styling is inline only.** No stylesheet, no CSS Modules pipeline (M1 debt
 * #2), and no DOM style writes: every colour is one of the host's own
 * `--dsw-*` tokens, so the section follows whichever theme is active — Moonset,
 * official, or a peer's. The plugin writes no DOM style of its own: only the
 * elements it renders carry a `style` attribute, never the document root.
 */
import type { MoonsetChoice } from './choice.ts'

/** One option the section renders: the value it applies and its localized label. */
export interface MoonsetOptionLabel {
  /** The choice this button applies. */
  readonly value: MoonsetChoice
  /** Localized button text. */
  readonly label: string
}

/** Every piece of copy the section renders (built from the locale binding). */
export interface MoonsetSectionLabels {
  /** Section heading. */
  readonly title: string
  /** One explanatory line under the buttons. */
  readonly description: string
  /** The buttons, in display order. */
  readonly options: readonly MoonsetOptionLabel[]
}

/** The three props this component takes — nothing else is wired to it. */
export interface MoonsetSectionProps {
  /** The durable choice as of this render (`off` = official theme). */
  readonly choice: MoonsetChoice
  /** Persist and apply one pick (owned by the plugin entry, not by this file). */
  readonly onPick: (choice: MoonsetChoice) => void
  /** Localized copy. */
  readonly labels: MoonsetSectionLabels
}

/** The slice of React this component calls (see the file header). */
interface ReactSurface {
  /** `React.createElement`: the element factory, typed structurally. */
  createElement(type: string, props: Record<string, unknown> | null, ...children: readonly unknown[]): unknown
  /** `React.useState`: the local optimistic highlight below. */
  useState<S>(initial: S): readonly [S, (next: S) => void]
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
 * Inline geometry and colour. The tokens are the host's: `brand-primary` /
 * `label-on-color` for the active button, the hairline border and secondary
 * label for the others, so the section reads correctly in every theme.
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
  border: '1px solid var(--dsw-alias-brand-primary)',
  background: 'var(--dsw-alias-brand-primary)',
  color: 'var(--dsw-alias-label-on-color)',
}
const DESCRIPTION_STYLE: Readonly<Record<string, string>> = {
  margin: '0',
  fontSize: '12px',
  lineHeight: '1.6',
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * Render the Moonset section: a heading, one button per choice, and one line of
 * explanation.
 *
 * The local `picked` state exists only so the click reads as instant: the
 * durable value re-seeds the highlight on the next mount, and nothing is
 * written to it until the injected `onPick` runs. It never re-implements the
 * controller (`applyChoice`), which is why no assertion in
 * `tests/settings.spec.ts` needs to render this file.
 * @param props - choice, pick callback, and localized copy.
 * @returns the section element tree.
 */
export function MoonsetSection({ choice, onPick, labels }: MoonsetSectionProps): unknown {
  const React = react()
  const [picked, setPicked] = React.useState<MoonsetSectionProps['choice'] | null>(null)
  const active = picked ?? choice

  const pick = (next: MoonsetSectionProps['choice']): void => {
    setPicked(next)
    onPick(next)
  }

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
          'aria-pressed': option.value === active,
          onClick: () => { pick(option.value) },
          style: option.value === active ? ACTIVE_BUTTON_STYLE : BUTTON_STYLE,
        },
        option.label,
      )),
    ),
    React.createElement('p', { style: DESCRIPTION_STYLE }, labels.description),
  )
}
