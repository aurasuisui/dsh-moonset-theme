/**
 * The skin layer (0.1.1–0.1.2): ONE root attribute plus ONE injected stylesheet, and
 * nothing else in the document.
 *
 * Why a stylesheet at all is a decision, not a default (contract §一 P5): the
 * theme speaks tokens, and tokens ARE most of the skin. A handful of visual
 * surfaces cannot be reached by a `--dsw-*` value at all, and the text
 * selection is the first of them — the official design-platform stylesheets
 * carry no `::selection` rule (0.2.2-rc.5, 9 sheets, 0 hits), so the browser's
 * default blue is painted by the UA and no token can move it. Those surfaces are
 * the whitelist in `docs/architecture.md` §11; everything else stays on the
 * token side, where a theme switch carries it for free.
 *
 * The shape is fixed by P2, and the two halves are one contract:
 *
 *  1. `<html data-moonset-skin>` — the root attribute. It is both the "skin is
 *     on" signal and, for the rules that need it, the gate that keeps an
 *     orphaned sheet inert (`html[data-moonset-skin] ...`).
 *  2. `<style data-dsh-moonset-skin>` in `<head>` — a SINGLETON. Repeated
 *     mounts must not stack a second sheet (two sheets would fight over the same
 *     declaration order and the loser would depend on document order).
 *
 * Unload is the exact inverse, and it must be total: attribute off, sheet gone,
 * no residue. Everything here is idempotent for that reason — mounting twice is
 * one mount, unmounting twice is fine, and an unmount cleans up a duplicate
 * someone else leaked (nothing of ours may outlive the plugin).
 *
 * Performance (P1): this module registers no event listener, starts no
 * animation-frame loop and observes nothing. The only two moments it runs are
 * the plugin's activation and its teardown; the sheet itself is drawn by the
 * engine.
 *
 * DOM rule: every DOM write in the client half is one of ours. `boot-cleanup.ts`
 * removes the Host's first-paint sheet; this module adds one attribute and one
 * element, then removes exactly those. No host node is restructured, no layout
 * property is written, and no inline style is attached to any element.
 *
 * The sheet is not unconditional, though: it paints OUR accent, so it may only
 * exist while a Moonset theme does. {@link syncSkin} is the one place that
 * policy lives, and `index.ts` calls it from every path that learns a choice.
 */
import type { MoonsetChoice } from './choice.ts'

/**
 * The root attribute that gates the skin.
 *
 * Boolean-style: the NAME is the contract (that is what
 * `html[data-moonset-skin]` matches) and the value is the empty string, so a
 * future milestone can widen the gate without changing the selector.
 */
export const SKIN_ATTR = 'data-moonset-skin'

/**
 * The attribute marking the injected `<style>`.
 *
 * `data-dsh-moonset-skin` on purpose (P2): the `dsh-moonset` prefix keeps it
 * greppable in a DevTools copy of the head, and the `data-dsh-*` namespace is
 * what the boot sheet (`data-dsh-moonset-boot`) already uses, so a reader can
 * tell both sheets apart by prefix alone.
 */
export const SKIN_SHEET_ATTR = 'data-dsh-moonset-skin'

/**
 * The exact selector the sheet is found by: a `<style>` ELEMENT carrying our
 * attribute. Element type + attribute (not the attribute alone) so a peer that
 * reuses the name on another node is never touched.
 */
export const SKIN_SHEET_SELECTOR = `style[${SKIN_SHEET_ATTR}]`

/**
 * How much of the shell the ground is allowed to show through (M2 地面范围).
 *
 * The three scopes are NESTED on purpose — the user compares A/B/C on a real
 * machine, so each one is exactly the previous one plus a documented carrier
 * set (see `visibilityRules`):
 *
 *   conversation  A: the conversation column only;
 *   main          B: A plus the shell frame and the three columns;
 *   all           C: B plus the sidebar's own fill layer and the bottom cell.
 *
 * `main` is the default since M3 (the user compared A/B/C on a real machine and
 * B was the coherent one); `all` is what 0.1.2 M1.5 shipped and stays selectable
 * as the fully transparent mode.
 */
export const GLOW_SCOPES = ['conversation', 'main', 'all'] as const

/** One ground scope: see {@link GLOW_SCOPES}. */
export type GlowScope = (typeof GLOW_SCOPES)[number]

/**
 * The scope a profile that never touched the control uses.
 *
 * `main` since M3: on the user's real machine B is the coherent one — the shell
 * and the three columns show the ground, while the sidebar keeps
 * `--dsw-specific-sidebar-fill` and therefore keeps its own surface (C stays
 * selectable; it is the fully transparent comparison).
 */
export const DEFAULT_GLOW_SCOPE: GlowScope = 'main'

/** The strength floor the slider and the resolver share (0-200%). */
export const GLOW_STRENGTH_MIN = 0

/** The strength ceiling the slider and the resolver share (0-200%). */
export const GLOW_STRENGTH_MAX = 200

/** The strength a profile that never touched the control uses (100%). */
export const DEFAULT_GLOW_STRENGTH = 100

/**
 * The five glow hues the settings offer (M4's 光晕色相).
 *
 * One control for BOTH schemes: each option names a per-scheme token pair, so
 * "the same hue" means the same ladder step, not the same hex — light and dark
 * read different rungs of the same family (which is how the official static
 * ladder is designed to be used).
 */
export const GLOW_HUES = ['accent', 'accentDark', 'accentSoft', 'accentSoftDark', 'nightBlue'] as const

/** One glow hue: see {@link GLOW_HUES}. */
export type GlowHue = (typeof GLOW_HUES)[number]

/** The hue a profile that never touched the control uses. */
export const DEFAULT_GLOW_HUE: GlowHue = 'accent'

/**
 * One hue option: the token each scheme mixes from, and the alpha multiplier.
 *
 * The four accent forms are the colour card's: `accent` / `accentDark` are the
 * anchor rung in each scheme, `accentSoft` / `accentSoftDark` are the same two
 * at a fraction of the alpha (16% → 8.96% / 12%), and `nightBlue` swaps the
 * family for the official blue. The DEFAULT pair is exactly what 0.1.2 shipped
 * (light `deepseek-500`, dark `deepseek-400`), so adding the control cannot
 * change the look the user already approved.
 *
 * The multiplier is applied to the HUE layers only (moon halo, dark core / halo
 * / bottom reflection and both washes). The amber glint is a different role and
 * keeps its own 3% — the hue control must not move it.
 */
export const GLOW_HUE_AT_FULL: Readonly<Record<GlowHue, { light: string; dark: string; factor: number }>> = {
  accent: { light: '--dsw-static-deepseek-500', dark: '--dsw-static-deepseek-400', factor: 1 },
  accentDark: { light: '--dsw-static-deepseek-400', dark: '--dsw-static-deepseek-400', factor: 1 },
  accentSoft: { light: '--dsw-static-deepseek-500', dark: '--dsw-static-deepseek-400', factor: 0.56 },
  accentSoftDark: { light: '--dsw-static-deepseek-400', dark: '--dsw-static-deepseek-400', factor: 0.75 },
  nightBlue: { light: '--dsw-static-blue-500', dark: '--dsw-static-blue-500', factor: 1 },
}

/**
 * Narrow one raw hue value to a hue.
 *
 * Same contract as the other two resolvers: a value this version does not know
 * (an older document, a hand edit, a future option) falls back to the default
 * instead of painting something the user never chose.
 * @param raw - the stored `glowHue` field.
 * @returns the narrowed hue.
 */
export function resolveGlowHue(raw: unknown): GlowHue {
  return typeof raw === 'string' && (GLOW_HUES as readonly string[]).includes(raw)
    ? raw as GlowHue
    : DEFAULT_GLOW_HUE
}

/** Which colour scheme a ground rule is built for. */
export type GlowScheme = 'light' | 'dark'

/**
 * The full-strength alphas per scheme (percent), top layer first.
 *
 * LIGHT (M3, second pass): **16% indigo : 3% amber**, the amber ellipse closed
 * at 46% inside the bottom-right corner. The first pass used 16:6 and the user
 * still reported amber winning ("即使在 6% 也压过靛蓝") — a warm hue at the same
 * alpha reads brighter on a near-white canvas, so the RATIO has to carry the
 * hierarchy and the amber has to be a glint, not a light.
 *
 * DARK: ONE hue, three footprints. The user explicitly removed the violet layer
 * ("不要紫罗兰那层"), so the depth comes from `deepseek-400` at three sizes — a
 * small tight core (12%), the wide soft halo under it (20%) and a weak
 * reflection along the bottom edge (4%) — plus a 1% wash. Amber is NOT used in
 * dark: the bottom reflection already keeps that half from going dead black,
 * and adding a warm accent is exactly what the light-scheme feedback ruled out.
 */
export const GLOW_ALPHA_AT_FULL = {
  light: { moon: 16, warm: 3, wash: 1.5 },
  dark: { moon: 20, core: 12, floor: 4, wash: 1 },
} as const

/**
 * Narrow one raw scope value to a scope.
 *
 * The input crosses a document boundary (a settings echo, a hand-edited
 * document, an older version), so anything unrecognized falls back to the
 * default instead of painting an unexpected amount of the shell.
 * @param raw - the stored `glowScope` field.
 * @returns the narrowed scope.
 */
export function resolveGlowScope(raw: unknown): GlowScope {
  return typeof raw === 'string' && (GLOW_SCOPES as readonly string[]).includes(raw)
    ? raw as GlowScope
    : DEFAULT_GLOW_SCOPE
}

/**
 * Narrow one raw strength value into the slider's integer range.
 *
 * Deliberately forgiving: a missing field is the default, a numeric string is
 * accepted (a document round-trip can carry one), and NaN or an out-of-range
 * value is clamped rather than refused — the setting is cosmetic, so a broken
 * document must cost the glow's intensity, never the skin.
 * @param raw - the stored `glowStrength` field.
 * @returns an integer in [GLOW_STRENGTH_MIN, GLOW_STRENGTH_MAX].
 */
export function resolveGlowStrength(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_GLOW_STRENGTH
  return Math.min(GLOW_STRENGTH_MAX, Math.max(GLOW_STRENGTH_MIN, Math.round(value)))
}

/**
 * Format one percentage for the sheet: at most two decimals, no trailing zeros.
 *
 * The point of M2's arithmetic-in-JS decision is that the stylesheet carries
 * LITERAL percentages (`16%`, `8%`, `1.5%`) instead of a `calc()` expression,
 * so this is the only place a number becomes CSS text.
 * @param value - a percentage (0-200).
 * @returns the CSS percentage token.
 */
function percent(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `${rounded}%`
}

/** The LIGHT ground's alphas, already formatted as CSS percentages. */
export interface LightGlowAlphas {
  /** The indigo moon halo. */
  readonly moon: string
  /** The amber glint in the bottom-right corner. */
  readonly warm: string
  /** The low-contrast wash. */
  readonly wash: string
}

/** The DARK ground's alphas, already formatted as CSS percentages. */
export interface DarkGlowAlphas {
  /** The wide soft indigo halo. */
  readonly moon: string
  /** The small tight indigo core above it — the moon itself. */
  readonly core: string
  /** The weak indigo reflection along the bottom edge. */
  readonly floor: string
  /** The low-contrast wash (one stop thinner than light). */
  readonly wash: string
}

/**
 * The LIGHT alphas at one strength and hue, already formatted as percentages.
 *
 * Two factors, deliberately kept apart: the STRENGTH scales every layer, the
 * HUE multiplier scales only the hue layers (`moon`, `wash`) — the amber glint
 * keeps its own 3% because it is a different role, not a different hue.
 * @param strength - 0-200 (out-of-range input is resolved first, see
 *   {@link resolveGlowStrength}).
 * @param hue - the chosen hue (default {@link DEFAULT_GLOW_HUE}).
 * @returns the alphas in paint order: moon halo, amber glint, wash.
 */
export function glowAlphas(strength: number, hue: GlowHue = DEFAULT_GLOW_HUE): LightGlowAlphas {
  const strengthFactor = resolveGlowStrength(strength) / 100
  const hueFactor = strengthFactor * GLOW_HUE_AT_FULL[hue].factor
  const row = GLOW_ALPHA_AT_FULL.light
  return {
    moon: percent(row.moon * hueFactor),
    warm: percent(row.warm * strengthFactor),
    wash: percent(row.wash * hueFactor),
  }
}

/**
 * The DARK alphas at one strength and hue — one hue, three footprints.
 * @param strength - 0-200 (out-of-range input is resolved first).
 * @param hue - the chosen hue (default {@link DEFAULT_GLOW_HUE}).
 * @returns the alphas in paint order: core, halo, bottom reflection, wash.
 */
export function darkGlowAlphas(strength: number, hue: GlowHue = DEFAULT_GLOW_HUE): DarkGlowAlphas {
  const factor = (resolveGlowStrength(strength) / 100) * GLOW_HUE_AT_FULL[hue].factor
  const row = GLOW_ALPHA_AT_FULL.dark
  return {
    moon: percent(row.moon * factor),
    core: percent(row.core * factor),
    floor: percent(row.floor * factor),
    wash: percent(row.wash * factor),
  }
}

/**
 * Options accepted by {@link skinCss} — the whole of M2's user-facing surface.
 *
 * Every field defaults to the sheet 0.1.2 M1.5 shipped, so `skinCss()` stays
 * the contract's exact default sheet and each control can be pinned on its own.
 *
 * The ground (wash + two spots) and the carrier clear are ONE feature
 * ({@link visibilityRules}): `glow: false` drops both halves, which is what
 * makes "off" the pre-glow 0.1.1 sheet byte-for-byte instead of a zero-alpha
 * paint (alpha 0 still composites — 0.1.2 §一, D4).
 */
export interface SkinOptions {
  /** The 0.1.2 environment glow — wash, spots and the clear. Defaults on. */
  glow?: boolean
  /** Which carrier layers give up their background. Defaults to {@link DEFAULT_GLOW_SCOPE}. */
  scope?: GlowScope
  /** The glow strength in percent (0-200). Defaults to {@link DEFAULT_GLOW_STRENGTH}. */
  strength?: number
  /** The hue the ground mixes from. Defaults to {@link DEFAULT_GLOW_HUE}. */
  hue?: GlowHue
}

/**
 * The 0.1.2 ground segment — kept apart from the 0.1.1 rules so the M2 switch
 * can emit nothing at all instead of a zero-alpha rule.
 *
 * One `background`, layers top-first: the moon halo, the warm light, then the
 * wash; the final layer carries the canvas token as its colour (the shorthand
 * would otherwise reset `background-color` to transparent). Every colour is a
 * `color-mix()` of a static token with `transparent`, and the alpha is a
 * LITERAL percentage computed in JS from the user's strength ({@link
 * glowAlphas}) — no `calc()`, no custom-property hop, so the knob cannot die
 * on a property-invalidation boundary (0.1.2 D2). The sheet is rebuilt when the
 * control moves, which is the one place a rebuild is cheaper than a variable.
 *
 * M1.5 appends the second half: the VISIBILITY block. A `body` background is
 * the bottom of the paint order, and the host paints `--dsw-alias-bg-base` on
 * every shell layer between it and the conversation. The chain, read out of the
 * INSTALLED 0.2.2-rc.5 bundles (not inferred from class names — those are
 * hashed per build):
 *
 *   body
 *    > #root                     the React container — the shell mounts into it
 *                                (`getElementById('root')` in the web-frontend
 *                                bundle; the renderer's `mountApp` owns the root)
 *    > div[data-slot='root']     display:contents — RootOutlet's anchor
 *    > div.frame                 background: bg-base (sidebar-fill on Windows)
 *    > div.centerCol             background: bg-base when [data-windows-titlebar]
 *    > div.mainPanel             no background
 *    > div[data-slot='main']     display:contents — SlotOutlet's anchor
 *    > div.root                  background: bg-base   <- the conversation
 *
 * `html` and `#root` are audited transparent: no host sheet paints either (the
 * only `html` background rule is `[data-platform='darwin']`) and no shipped
 * bundle writes an inline one, so the `body` background propagates to the
 * canvas and M1's ground IS painted — before M1.5 it was simply covered by the
 * opaque carriers below. Clearing exactly those COLOURS is what lets it through
 * (user report on the installed build: "完全看不到光晕"); their images and
 * shadows stay, and no layout property is written (§11.4).
 *
 * Scope is a SETTING (M2 地面范围), and the three values are nested: the
 * judgement for what may be cleared is always "fills a column or the whole
 * screen", never "wraps a piece of content":
 *
 *   conversation  clears the conversation column only (its own containers and
 *                 the elected panel root); the sidebar, the shell frame and
 *                 the bottom cell keep their paint;
 *   main          adds the shell frame and the three columns — the frame,
 *                 .centerCol and .rightbarCol give up their background, while
 *                 the sidebar column keeps `--dsw-specific-sidebar-fill` and
 *                 therefore keeps its own surface;
 *   all           adds the sidebar's INNER fill layer (SidebarRoot's .root) and
 *                 the frame's bottom cell — the whole screen shows the ground;
 *
 * kept in every scope: cards, message bubbles, code blocks, the composer card,
 * menu popovers (they portal to `body`, outside `#root` entirely), the
 * rightbar's inner panes (terminal/file tree — content) and the drawer mask
 * (a scrim, not a carrier).
 *
 * The selectors do NOT count levels, on purpose. The anchors are emitted by the
 * RENDERER, not by ui-layout: `dsh-client-ui-renderer/lib/client.js` renders
 * `{"data-slot": slotKey}` in SlotOutlet, `{"data-slot": 'root'}` in
 * RootOutlet, both with `ANCHOR_STYLE = {display:'contents'}` — ui-layout only
 * calls `renderSlot('main', …)`, so grepping `data-slot` in THAT bundle finds
 * nothing and proves nothing. Because the anchors are `display: contents`,
 * the shell's depth is a renderer detail that can grow or lose a wrapper
 * without changing a single visible pixel; a selector counting child
 * combinators goes blind on the first such change, which is exactly the
 * invisible-ground failure this block fixes. Containment (plus two
 * `> div` roots, the anchors' direct children) is used instead:
 *
 *   :has([main, sidebar, rightbar])  every carrier that CONTAINS one of the
 *                                    three shell slots: the root anchor, the
 *                                    frame, the three columns, the main panel —
 *                                    i.e. the layers that paint bg-base or
 *                                    sidebar-fill;
 *   :has([data-composer-seat])       the conversation's own containers up to
 *                                    and including `.root` (ui-conversation
 *                                    renders the seat with that attribute), so
 *                                    `.root` is reached even if a wrapper ever
 *                                    appears between the anchor and it;
 *   :has(> [data-slot='shell.bottom'])  the frame's bottom cell (its second grid
 *                                    row), which also paints bg-base;
 *   [data-slot='main'] > div          the elected panel root: the conversation's
 *                                    `.root`, or a global panel's page —
 *                                    `[data-global-panel]` sits on the main panel
 *                                    only while a panel is open, so the flat
 *                                    anchor child is the stable spelling;
 *   [data-slot='sidebar'] > div       SidebarRoot's own root, the second layer
 *                                    that draws sidebar-fill.
 *
 * A descendant can never contain its own ancestor, so no card, message, code
 * block or field inside the panel is ever one of the `:has()` sets: the
 * clear stops at the carrier roots, and every host class name stays unused.
 */
/**
 * The carrier selectors each scope clears, in the sheet's fixed order.
 *
 * Written as three explicit lists instead of one list filtered at runtime: the
 * three sets are the user-facing contract (A/B/C), so a change to one of them
 * has to be visible in the diff as a change to that scope only.
 */
const VISIBILITY_SELECTORS: Readonly<Record<GlowScope, readonly string[]>> = {
  // A: the conversation column. `[data-composer-seat]` is the conversation's
  // own anchor (ui-conversation renders it on the composer seat), so `.root` is
  // reached without counting depths; the flat anchor child covers the elected
  // panel root (a global panel page included).
  conversation: [
    "html[data-moonset-skin] #root :has([data-composer-seat])",
    "html[data-moonset-skin] #root [data-slot='main'] > div",
  ],
  // B: A plus every carrier that CONTAINS one of the three shell slots — the
  // root anchor, the frame, the three columns and the main panel. The sidebar
  // column is cleared here on purpose: it is a column, not content, and B is
  // the scope where the sidebar still keeps its INNER fill (see C).
  main: [
    "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])",
    "html[data-moonset-skin] #root :has([data-composer-seat])",
    "html[data-moonset-skin] #root [data-slot='main'] > div",
  ],
  // C: B plus the sidebar's own fill layer (SidebarRoot's `.root`, the second
  // element that draws sidebar-fill) and the frame's bottom cell.
  all: [
    "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])",
    "html[data-moonset-skin] #root :has([data-composer-seat])",
    "html[data-moonset-skin] #root :has(> [data-slot='shell.bottom'])",
    "html[data-moonset-skin] #root [data-slot='main'] > div",
    "html[data-moonset-skin] #root [data-slot='sidebar'] > div",
  ],
}

/**
 * The ground half of the feature: ONE `background` per scheme.
 *
 * Light — three layers, indigo leading: the moon halo at the top edge, an amber
 * GLINT in the bottom-right corner (97%/97%, closed at 46%) and the low-contrast
 * 165° wash. M3's second pass took the amber from 6% to 3%: at 16:6 the user
 * still read amber as the subject ("琥珀还是太抢"), and a warm hue at equal alpha
 * is brighter on a near-white canvas, so the ratio is 16:3 and the ellipse is a
 * corner glint rather than a light.
 *
 * Dark — ONE hue, three footprints (user: 深色太单调, then 不要紫罗兰那层). The
 * depth comes from `deepseek-400` alone, at three sizes, in one declaration:
 *
 *   34%/2%    deepseek-400 12%  circle  26%   the moon CORE: small and tight
 *   50%/-6%   deepseek-400 20%  ellipse 70%   the HALO under it: wide and soft
 *   50%/104%  deepseek-400  4%  ellipse 55%   a weak reflection off the bottom
 *   160deg    deepseek-400  1%  linear  75%   the wash, one stop thinner
 *
 * The core is painted ABOVE the halo on purpose: the two alphas add where they
 * overlap, which is what makes the moon read as a body inside its own light
 * instead of one flat blob. Amber is not used in dark at all — the bottom
 * reflection keeps that half from going dead black, and a warm accent is
 * exactly what the light-scheme feedback ruled out.
 *
 * The alphas arrive pre-formatted from {@link glowAlphas} / {@link
 * darkGlowAlphas}, so this builder never does arithmetic and the sheet never
 * carries a `calc()`.
 * @param strength - 0-200; out-of-range input is resolved by the caller.
 * @returns the rules' lines (light first, then the dark override).
 */
function groundRules(strength: number, hue: GlowHue = DEFAULT_GLOW_HUE): readonly string[] {
  const form = GLOW_HUE_AT_FULL[hue]
  const light = glowAlphas(strength, hue)
  const dark = darkGlowAlphas(strength, hue)
  return [
    '/* 0.1.2 ground (light): canvas + wash + two spots in ONE declaration; the',
    '   strength is resolved in JS, so every alpha below is a LITERAL percentage. */',
    'html[data-moonset-skin] body {',
    '  background:',
    `    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(${form.light}) ${light.moon}, transparent) 0%, transparent 62%),`,
    `    radial-gradient(ellipse at 97% 97%, color-mix(in srgb, var(--dsw-static-amber-500) ${light.warm}, transparent) 0%, transparent 46%),`,
    `    linear-gradient(165deg, color-mix(in srgb, var(${form.light}) ${light.wash}, transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);`,
    '}',
    // The dark override. Same gating attribute, plus the host's own dark marker
    // (`body[data-ds-dark-theme]`, the official design-platform switch), so it
    // only ever applies to the dark scheme and outranks the light rule there.
    '/* 0.1.2 ground (dark): ONE indigo hue at three footprints (core, halo,',
    '   bottom reflection) plus a thinner wash — depth without a second colour. */',
    'html[data-moonset-skin] body[data-ds-dark-theme] {',
    '  background:',
    `    radial-gradient(circle at 34% 2%, color-mix(in srgb, var(${form.dark}) ${dark.core}, transparent) 0%, transparent 26%),`,
    `    radial-gradient(ellipse at 50% -6%, color-mix(in srgb, var(${form.dark}) ${dark.moon}, transparent) 0%, transparent 70%),`,
    `    radial-gradient(ellipse at 50% 104%, color-mix(in srgb, var(${form.dark}) ${dark.floor}, transparent) 0%, transparent 55%),`,
    `    linear-gradient(160deg, color-mix(in srgb, var(${form.dark}) ${dark.wash}, transparent) 0%, transparent 75%) var(--dsw-alias-bg-base);`,
    '}',
  ]
}

/**
 * The visibility half: clear the COLOUR of the carriers the scope names.
 *
 * `background-color` only — never the `background` shorthand, which would wipe
 * any image or shadow the host put on the same element — and no layout
 * property at all (§11.4). The scope is named in the comment so a DevTools
 * reader can tell which sheet they are looking at.
 *
 * The block ends with the M2 底部白带 entry. `[data-composer-seat]` is the very
 * element the conversation renders its composer seat on (ui-conversation:
 * `className={…composerSeat}` + `data-composer-seat`), and in the active phase
 * it paints `linear-gradient(180deg, bg-base 0%, transparent … )` — a mask that
 * fades the transcript out under the composer. Over the ground that mask reads
 * as a bright band across the bottom of the conversation (user report), so its
 * IMAGE is cleared. It cannot be a `background-color` clear (the band IS the
 * image) and `background: transparent` would also wipe the element's colour and
 * any other layer, so the one longhand is the narrowest possible fix. Nothing
 * moves: the seat keeps its size, position and children.
 * @param scope - the resolved scope.
 * @returns the rule's lines.
 */
function visibilityRules(scope: GlowScope): readonly string[] {
  const selectors = VISIBILITY_SELECTORS[scope]
  const last = selectors.length - 1
  return [
    `/* 0.1.2 visibility (scope: ${scope}): the host paints bg-base on these`,
    '   carriers; clear their COLOUR — cards, bubbles and menus keep theirs. */',
    ...selectors.map((selector, index) => (index === last ? `${selector} {` : `${selector},`)),
    '  background-color: transparent;',
    '}',
    // M2 底部白带: a SECOND entry, because this one clears an IMAGE.
    '/* 0.1.2 bottom band (M2): the composer seat\'s bg-base mask is an image. */',
    'html[data-moonset-skin] #root [data-composer-seat] {',
    '  background-image: none;',
    '}',
  ]
}

/**
 * The skin's rules, as text — a PURE function of its options only.
 *
 * Pure on purpose: the sheet's exact bytes are the contract the tests pin
 * (`tests/skin.spec.ts` compares them verbatim), so it must not depend on the
 * document, the clock, the palette or the scheme. Scheme-correctness comes from
 * the tokens the rules reference: `--dsw-static-deepseek-500` is the accent
 * anchor (light #4338CA, dark #818CF8), `--dsw-static-amber-500` is the moon
 * anchor (#F59E0B in both schemes) and `--dsw-alias-bg-base` is the canvas, so
 * every rule follows both schemes and every theme switch automatically.
 *
 * The rule mirrors the documentation site's `selection:bg-indigo-500/20`
 * `selection:text-indigo-700` pair: a 22% accent wash with the accent ITSELF as
 * the text colour (the first real-machine pass shipped ink text on a violet
 * wash and read as "grey-violet", not as the web). Measured contrast of the
 * selected text against that wash: light 5.25:1, dark 4.55:1 over `bg-base`
 * (both clear the 4.5:1 AA floor; `tests/skin.spec.ts` re-derives them from the
 * palette so a future anchor change cannot silently fail it).
 *
 * The second rule is the SELECTED-ITEM LABEL colour: the token work above gives
 * a selected row the violet wash, but the host still paints its text with
 * `--dsw-alias-label-primary` (ink), so the row reads "violet background, black
 * text". No token can carry this: the colour is declared on the container by
 * rules that cannot be re-pointed from a custom property, so it has to be a CSS
 * exception (the whitelist's second entry).
 *
 * That rule is keyed on STABLE ATTRIBUTES only — `aria-selected`,
 * `aria-current`, `data-active` — never on a host class name (those are hashed
 * per build). It is gated on our root attribute for two reasons: P2 says the
 * sheet is gated that way, and the gate is what makes it WIN. `html body
 * [data-active='true']` is (0,1,2) and loses to the host's
 * `.tab[data-active='true']` (0,2,0), which is exactly the plugins-tab label
 * the first real-machine pass left ink; `html[data-moonset-skin] body
 * [data-active='true']` is (0,2,2) and wins. No `!important`, no wildcard
 * subtree selector: muted children (timestamps, summaries) set their own colour
 * and keep it, so only the primary label turns violet. Measured contrast of the
 * accent label on the selected-row wash: light 6.45:1, dark 5.58:1.
 *
 * Two more seats ride the same idea:
 *
 *  - **pressed chips** (`[aria-pressed='true']`): the automation filter tabs
 *    spell "selected" as a pressed toggle. Accepted because in this UI pressed
 *    and selected are the same state; the rule therefore also colours pressed
 *    like/dislike buttons, which is the intended reading.
 *  - **the selected tab's underline** (`[data-active='true']::after`): the host
 *    draws it as a 2px ink bar, which would leave a black bar under violet text.
 *    The selector is NOT narrowed to `[role='tab']`: only the plugins tab renders
 *    an `::after` on a `data-active` element (audited in the installed sources —
 *    the retry disclosure arrow is `summary::after`, the badge and feedback
 *    buttons have no `::after`), so the broader selector is exact in practice.
 *
 * One seat remains out: `[aria-expanded='true']` (the automation page's selected
 * task row) is deliberately NOT whitelisted — "expanded" is not "selected" and
 * the same attribute sits on every menu trigger and disclosure, so colouring it
 * would repaint states the skin should not touch.
 *
 * The 0.1.2 GROUND is one more rule — the whitelist's third entry. It is a
 * single `background` on `body`, root-gated, three layers above the canvas
 * token: a low-contrast wash (`linear-gradient(165deg, accent 1.5% → transparent
 * 70%)`; the left-to-right spread at 1920×1080 is ~1.3/255 in light and
 * ~1.6/255 in dark, inside the contract's "<= 2/255" band) plus two
 * viewport-fixed spots — an indigo moon halo at top-centre (16%) and an amber
 * warm light at the bottom-right (10%). The hues are mixed from
 * `--dsw-static-deepseek-500` (accent) and `--dsw-static-amber-500` (moon);
 * no literal colour enters the sheet. The canvas token rides as the colour of
 * the final layer on purpose: a `background` shorthand resets
 * `background-color` to transparent, so the base has to be part of the same
 * declaration or the ground would go see-through.
 *
 * The strength factor (M2) is resolved in JS: `glowAlphas(strength)` multiplies
 * the three full-strength alphas and formats the result as a LITERAL percentage
 * (`16%`, `8%`, `32%`, `1.5%`), so the sheet carries no `calc()` and no
 * custom-property hop at all. That is the answer 0.1.2 D2 demanded — catppuccin
 * measured on Chromium that a value hidden behind an intermediate property does
 * not recompute when it changes, i.e. the knob "dies" — and it is also why the
 * sheet is REBUILT (debounced) when the slider moves instead of being re-pointed
 * through a variable. The ground and the carrier clear are one switchable
 * segment ({@link groundRules} + {@link visibilityRules}): `glow: false` drops
 * both, because alpha 0 would still composite (0.1.2 §一, D4).
 *
 * M1.5: a ground on `body` is only visible if nothing opaque paints over it,
 * and on the installed build every carrier surface does — `.frame`,
 * `.sidebarCol` + SidebarRoot's `.root` (sidebar-fill), `.centerCol` and
 * `.rightbarCol` on the caption/vibrancy shells, `.bottomRow`, the conversation
 * root and every global panel page root all carry a `background` (audited in
 * `AppFrame.module.css`, `SidebarRoot.module.css`,
 * `ConversationRoot.module.css`, `TaskManagerPage.module.css`). `html` and
 * `#root` are transparent (no host rule, no inline write), so the ground is
 * painted and was simply buried. The visibility block clears `background-color`
 * on exactly the carriers the user's SCOPE selects (A/B/C, see
 * {@link VISIBILITY_SELECTORS}) and stops there: the surfaces inside them
 * (cards, bubbles, code blocks, the composer card, menu popovers) keep their own
 * paint. The doc block above `groundRules` carries the audited chain, the bundle
 * evidence for the anchors, the exact cleared/kept lists per scope and why the
 * selectors do not count levels.
 *
 * It is the ONE place where §11.4's "no structural selector" gives way, and it
 * gives way for the reason this layer exists at all: those surfaces carry no
 * stable attribute — `data-global-panel` sits on the main panel only while a
 * global panel is open, and `.frame` / `.centerCol` / `.root` are hashed class
 * names. Structure (`#root`, the shell's fixed mount point in `index.html`)
 * plus the two renderer/app anchors (`[data-slot='main']`, and the conversation's
 * `[data-composer-seat]` as an independent second address) are the only stable
 * handles. No wildcard, no class name, no `!important`, no layout property —
 * and it rides the SAME switch as the ground: `glow: false` drops both halves,
 * so the 0.1.1 sheet is still returned byte-for-byte (D4).
 *
 * How the exception maps onto §一 P5's whitelist:
 *
 *   `::selection`  text selection — cannot be expressed as a token (see the
 *                   module doc above), so it is the FIRST whitelist entry;
 *   body ground     (0.1.2) wash + two fixed spots, also whitelisted;
 *   material faces  (0.1.3) `::before` planes, also whitelisted.
 *
 * The selector is `html body ::selection` (0,0,2) so it outranks a plain
 * `::selection` (0,0,1) from any third-party sheet that happens to set one; the
 * sheet is also appended after the host's sheets, so a same-specificity rule
 * still loses to ours.
 * @param options - the emit switches (M2): `glow` drops the whole 0.1.2
 *   segment, `scope` picks the carrier set, `strength` scales the three alphas.
 *   Omitted means "every layer on, scope all, 100%" — the sheet 0.1.2 shipped.
 * @returns the complete CSS text of the single skin sheet.
 */
export function skinCss(options: SkinOptions = {}): string {
  const rules = [
    '/* dsh-moonset[0.1.2]: skin — P5 whitelist (selection, selected-item text, ground) */',
    'html body ::selection {',
    '  background: color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent);',
    '  color: var(--dsw-static-deepseek-500);',
    '}',
    '/* selected items: stable attributes only, never a host class name. The root',
    '   attribute gate is what outranks the host (0,2,2 vs .tab[data-active] 0,2,0). */',
    "html[data-moonset-skin] body [aria-selected='true'],",
    "html[data-moonset-skin] body [aria-current='page'],",
    "html[data-moonset-skin] body [aria-current='true'],",
    "html[data-moonset-skin] body [data-active='true'],",
    "html[data-moonset-skin] body [aria-pressed='true'] {",
    '  color: var(--dsw-static-deepseek-500);',
    '}',
    '/* the host draws the selected tab underline as a 2px ink bar; keep it the',
    '   label colour. Only the plugins tab renders an ::after on such an element. */',
    "html[data-moonset-skin] body [data-active='true']::after {",
    '  background: var(--dsw-static-deepseek-500);',
    '}',
  ]
  if (options.glow !== false) {
    rules.push(...groundRules(options.strength ?? DEFAULT_GLOW_STRENGTH, options.hue ?? DEFAULT_GLOW_HUE))
    rules.push(...visibilityRules(options.scope ?? DEFAULT_GLOW_SCOPE))
  }
  return rules.join('\n')
}

/**
 * The style element this module builds. Declared structurally — this repo
 * carries no DOM implementation (PLAN §九 已知债), so the tests drive a
 * hand-written stub and a new requirement shows up as a missing member instead
 * of passing silently.
 */
export interface SkinSheetElement {
  /** Write one attribute (used once, to stamp {@link SKIN_SHEET_ATTR}). */
  setAttribute(name: string, value: string): void
  /** The sheet's rule text. */
  textContent: string
  /** Detach this element from its parent. */
  remove(): void
}

/**
 * The document surface the skin needs, and nothing more.
 *
 * `documentElement` is `<html>` (attribute only), `head` is the one place the
 * sheet is appended, and the two factories/query members map onto the real DOM
 * 1:1. `src/boot-cleanup.ts` declares its own, narrower surface for the same
 * reason: production passes the real `document` through a cast, and the tests
 * pass a stub.
 */
export interface SkinRoot {
  /** `<html>`: carries {@link SKIN_ATTR} while the skin is mounted. */
  documentElement: {
    setAttribute(name: string, value: string): void
    removeAttribute(name: string): void
  }
  /** `<head>`: the only node that ever receives the sheet. */
  head: {
    appendChild(node: SkinSheetElement): void
  }
  /** First element matching the selector, or `null` (singleton check + removal). */
  querySelector(selector: string): SkinSheetElement | null
  /** Build the sheet element; `'style'` is the only tag this module creates. */
  createElement(tagName: 'style'): SkinSheetElement
}

/**
 * Resolve the document to act on.
 * @param root - explicit surface (tests); omitted means the page's own document.
 * @returns the surface, or `undefined` outside a browser (a Node harness).
 */
function resolveRoot(root?: SkinRoot): SkinRoot | undefined {
  if (root !== undefined) return root
  return typeof document === 'undefined' ? undefined : document as unknown as SkinRoot
}

/**
 * Announce a refused DOM operation once, and carry on.
 *
 * The skin sits on the plugin's activation path, where a throw would take the
 * user's whole plugin set down; a document that refuses a write is a reason to
 * lose the skin, not the boot.
 * @param action - what was being done ("mount" / "unmount").
 * @param error - the thrown value.
 */
function reportFailure(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[dsh-moonset] could not ${action} the skin sheet — ${message}`)
}

/**
 * Mount the skin: root attribute on, sheet in the head. Idempotent.
 *
 * The order is attribute FIRST, then the singleton check: an already mounted
 * skin must still end up with the attribute set (it is the gate every future
 * rule reads), and the sheet is only built when the document does not carry one
 * already. Repeated mounts therefore converge to exactly one sheet (P2).
 * @param root - document surface; defaults to the page's own (see
 *   {@link resolveRoot}).
 * @param options - the M2 emit switches the sheet is built from.
 * @returns whether the document now carries the skin. `false` is the normal
 *   outcome in a non-browser harness, not a failure; the value is diagnostics
 *   only.
 */
export function mountSkin(root?: SkinRoot, options: SkinOptions = {}): boolean {
  const target = resolveRoot(root)
  if (target === undefined) return false
  try {
    target.documentElement.setAttribute(SKIN_ATTR, '')
    if (target.querySelector(SKIN_SHEET_SELECTOR) !== null) return true
    const sheet = target.createElement('style')
    sheet.setAttribute(SKIN_SHEET_ATTR, '')
    sheet.textContent = skinCss(options)
    target.head.appendChild(sheet)
    return true
  } catch (error) {
    reportFailure('mount', error)
    return false
  }
}

/**
 * Rebuild the sheet in place from new options — the M2 rebuild path.
 *
 * The sheet is a SINGLETON (P2), so a control change must not mount a second
 * one: this finds the existing element and replaces its rule text, which is one
 * style invalidation and no DOM churn. A document that carries no sheet yet is
 * mounted with the same options, so the two entry points converge.
 *
 * Callers debounce this (the plugin entry uses 150 ms): a slider drag emits a
 * change per step, and rebuilding per step would re-parse the whole sheet on
 * every pointer move.
 * @param options - the resolved M2 switches.
 * @param root - document surface; defaults to the page's own.
 * @returns whether a sheet is live afterwards (diagnostics only).
 */
export function updateSkin(options: SkinOptions = {}, root?: SkinRoot): boolean {
  const target = resolveRoot(root)
  if (target === undefined) return false
  try {
    const sheet = target.querySelector(SKIN_SHEET_SELECTOR)
    if (sheet === null) return mountSkin(target, options)
    sheet.textContent = skinCss(options)
    return true
  } catch (error) {
    reportFailure('update', error)
    return false
  }
}

/**
 * Unmount the skin: attribute off, every sheet of ours gone. Idempotent.
 *
 * The sheet loop is defensive: a mounted singleton cannot leak a second sheet,
 * but an unmount must still end with ZERO residue if one appeared (a second
 * copy of this plugin, a hot reload, a manual paste). The loop stops when the
 * query returns the element it just removed — that is also the guard against a
 * surface whose `remove()` does not detach.
 * @param root - document surface; defaults to the page's own.
 * @returns whether at least one sheet was removed (diagnostics only).
 */
export function unmountSkin(root?: SkinRoot): boolean {
  const target = resolveRoot(root)
  if (target === undefined) return false
  let removed = false
  try {
    target.documentElement.removeAttribute(SKIN_ATTR)
    let sheet = target.querySelector(SKIN_SHEET_SELECTOR)
    while (sheet !== null) {
      sheet.remove()
      removed = true
      const next = target.querySelector(SKIN_SHEET_SELECTOR)
      if (next === sheet) break
      sheet = next
    }
    return removed
  } catch (error) {
    reportFailure('unmount', error)
    return removed
  }
}

/**
 * Align the skin with the stored choice (0.1.1): `off` → off, anything else → on.
 *
 * Why the skin is choice-gated at all: the sheet paints OUR accent, and `off`
 * means "the user runs the official theme" — a Moonset-violet text selection on
 * top of the official palette is exactly the inconsistency this milestone is
 * supposed to remove, not install. `light` / `dark` / `follow` all paint a
 * Moonset palette (the last one through the follow layer), so the skin stays.
 *
 * This function owns the POLICY, not the moments. `index.ts` calls it from
 * every path that learns or changes the choice:
 *
 *  - the boot `restore()` — the first place a stored value is readable (a
 *    profile that stored `off` must not keep a sheet `apply()` mounted);
 *  - `pick()` — a click in our section;
 *  - the mirror path — the user picked an official theme in Appearance, so the
 *    choice is handed back as `off`.
 *
 * Both branches are idempotent ({@link mountSkin} / {@link unmountSkin} are), so
 * calling it with the same choice twice is free — which is what lets the boot
 * path call it without first asking whether the skin is on.
 * M2 adds the second half of the policy: a mounted sheet is REBUILT from the
 * current glow options, so a mode/strength change lands on the same singleton
 * instead of being ignored because a sheet already exists.
 * @param choice - the stored choice (a queued intent included).
 * @param root - document surface; defaults to the page's own.
 * @param options - the M2 emit switches (scope, strength, glow).
 * @returns whether the skin is ON after this call (diagnostics only).
 */
export function syncSkin(choice: MoonsetChoice, root?: SkinRoot, options: SkinOptions = {}): boolean {
  if (choice === 'off') {
    unmountSkin(root)
    return false
  }
  // Through `updateSkin`, not `mountSkin`: a sheet that is already mounted (the
  // one `apply()` created) must still pick up the stored M2 options, and a
  // profile whose section is never opened must end up on exactly the same
  // sheet as one that touched every control.
  return updateSkin(options, root)
}
