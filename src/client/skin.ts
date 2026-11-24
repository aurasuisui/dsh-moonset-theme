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
 * removes the Host's first-paint sheet; this module adds two root attributes, one
 * inline CUSTOM PROPERTY on `<html>` (0.1.4 glass: the blur radius, see
 * {@link GLASS_BLUR_TOKEN}) and one element, then removes exactly those. No host
 * node is restructured, no layout property is written, and nothing but that one
 * custom property is ever attached to an element's inline style (architecture
 * §11.2 lists the write routes).
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
 * The root attribute that gates the 0.1.4 glass material (M1: the input card).
 *
 * A SECOND boolean-style attribute next to {@link SKIN_ATTR}, on purpose: the
 * material has its own switch (user requirement: 默认开、可关), and the skin's
 * own gate must not imply it — with glass off the 0.1.4 sheet still paints the
 * selection, the ground and the step rows. `mountSkin` attaches both; "glass
 * off" simply leaves this one off, so the material rules in the sheet are dead
 * text rather than a second sheet (P2).
 */
export const GLASS_ATTR = 'data-moonset-glass'

/**
 * The inline custom property carrying the glass blur radius, in px.
 *
 * Written on `<html>` by {@link applyGlassBlur} — the ONE inline style write
 * this plugin makes — because the radius is a knob, not a rule: the sheet names
 * the property and `backdrop-filter` reads it, so moving the slider re-points a
 * value instead of re-parsing the whole sheet. Measured on Chromium (headless,
 * the same engine the desktop shell runs): a `backdrop-filter: blur(var(…))`
 * that reads this property DOES re-render when the property moves — the flat
 * 12px card band sharpens back into stripes at 0px and melts at 24px — so the
 * 0.1.2 D2 "dead knob" failure does not reproduce for this property (that one
 * was a token hop inside the `background` shorthand).
 */
export const GLASS_BLUR_TOKEN = '--dsh-moonset-glass-blur'

/** The blur radius the control and the resolver share, in px. */
export const GLASS_BLUR_MIN = 0

/** The blur ceiling the control and the resolver share, in px. */
export const GLASS_BLUR_MAX = 30

/** The step the settings slider moves in, in px. */
export const GLASS_BLUR_STEP = 2

/**
 * The blur radius a profile that never touched the control uses (12px).
 *
 * The plan's fixed pair: material base at 62% of the canvas and a 12px blur —
 * chosen so the input card reads as glass over the ground without turning the
 * transcript behind it into mud.
 */
export const DEFAULT_GLASS_BLUR = 12

/** Whether the material is on for a profile that never touched the switch. */
export const DEFAULT_GLASS = true

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

/** The strength floor the sliders and the resolver share (0-200%). */
export const GLOW_STRENGTH_MIN = 0

/** The strength ceiling the sliders and the resolver share (0-200%). */
export const GLOW_STRENGTH_MAX = 200

/**
 * The strength the LIGHT ground starts on (90% — the user's final pick).
 */
export const DEFAULT_GLOW_STRENGTH_LIGHT = 90

/** The strength the DARK ground starts on (100% — the user's final pick). */
export const DEFAULT_GLOW_STRENGTH_DARK = 100

/**
 * The three glow hues (M6 — M4's five collapsed to three).
 *
 * The user compared the forms on a real machine and the two "dark" variants
 * produced the same pixels as their light siblings (`accentDark` / `accentSoftDark`
 * changed the ladder step, which this palette renders almost identically), so
 * they were removed instead of shipped as buttons that do nothing visible. What
 * is left is the three that DO differ: the accent, its soft form, and the night
 * blue the skin owns.
 *
 * Each hue names a per-scheme token pair, so "the same hue" means the same
 * family, not the same hex: light and dark read different rungs of it.
 */
export const GLOW_HUES = ['accent', 'soft', 'night'] as const

/** One glow hue: see {@link GLOW_HUES}. */
export type GlowHue = (typeof GLOW_HUES)[number]

/** The hue the LIGHT ground starts on (柔和 — the user's final pick). */
export const DEFAULT_GLOW_HUE_LIGHT: GlowHue = 'soft'

/** The hue the DARK ground starts on (夜空蓝 — the user's final pick). */
export const DEFAULT_GLOW_HUE_DARK: GlowHue = 'night'

/**
 * The skin-owned night-blue anchor — the sheet's ONLY literal colour.
 *
 * Why a literal at all: the 228-key table has no usable blue. Every `blue-*`
 * rung is remapped onto this palette's indigo ladder (`blue-500` = `#4F46E5`
 * light / `#818CF8` dark, `blue-600` = `#413BB9` / `#6B74CE` — all indigo), the
 * `deepseek-*` family is the accent itself, `violet-400` is purple, and there is
 * no `sky`/`cyan` family in the table AT ALL. The user's 夜空蓝 therefore had to
 * come from the skin layer (0.1.2 §11.3's fifth whitelist class, "hue anchor").
 *
 * It is declared TWICE in the sheet (light on `html[data-moonset-skin]`, dark on
 * the host's `body[data-ds-dark-theme]` marker) and read by the `night` hue
 * alone. `tests/skin.spec.ts` is the guard: apart from those two declarations
 * the sheet may not contain a single `#` literal.
 */
export const NIGHT_BLUE_TOKEN = '--dsh-moonset-night'

/** The night-blue anchor in the light scheme (the official brand blue). */
export const NIGHT_BLUE_LIGHT = '#2563EB'

/** The night-blue anchor in the dark scheme (the same hue, lightened for it). */
export const NIGHT_BLUE_DARK = '#60A5FA'

/**
 * One hue option: the token each scheme mixes from, and the alpha multiplier.
 *
 * `accent` is the palette's own anchor rung; `soft` is the SAME tokens at 0.56
 * of the alpha (16% → 8.96%); `night` is the skin's own anchor (above) — the
 * 228-key table has no usable blue.
 *
 * The multiplier is applied to the HUE layers only (light moon + wash, dark
 * core / halo / bottom reflection / wash). The amber glint is a different role
 * and keeps its own 3% — the hue control must not move it.
 */
export const GLOW_HUE_AT_FULL: Readonly<Record<GlowHue, { light: string; dark: string; factor: number }>> = {
  accent: { light: '--dsw-static-deepseek-500', dark: '--dsw-static-deepseek-400', factor: 1 },
  soft: { light: '--dsw-static-deepseek-500', dark: '--dsw-static-deepseek-400', factor: 0.56 },
  night: { light: NIGHT_BLUE_TOKEN, dark: NIGHT_BLUE_TOKEN, factor: 1 },
}

/**
 * Narrow one raw hue value to a hue.
 *
 * Same contract as the other resolvers: a value this version does not know (an
 * older document that still stores `accentDark`, a hand edit, a future option)
 * falls back to the caller's default instead of painting something the user
 * never chose.
 * @param raw - the stored `glowHueLight` / `glowHueDark` field.
 * @param fallback - the default for the scheme being read (light `soft`, dark
 *   `night`).
 * @returns the narrowed hue.
 */
export function resolveGlowHue(raw: unknown, fallback: GlowHue = DEFAULT_GLOW_HUE_LIGHT): GlowHue {
  return typeof raw === 'string' && (GLOW_HUES as readonly string[]).includes(raw)
    ? raw as GlowHue
    : fallback
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
 * @param raw - the stored `glowStrengthLight` / `glowStrengthDark` field.
 * @param fallback - the default for the scheme being read (light 90, dark 100).
 * @returns an integer in [GLOW_STRENGTH_MIN, GLOW_STRENGTH_MAX].
 */
export function resolveGlowStrength(raw: unknown, fallback: number = DEFAULT_GLOW_STRENGTH_LIGHT): number {
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(GLOW_STRENGTH_MAX, Math.max(GLOW_STRENGTH_MIN, Math.round(value)))
}

/**
 * Narrow one raw glass switch to a boolean.
 *
 * Same forgiving contract as the other resolvers: anything that is not a
 * boolean (a missing field while the form is still loading, a hand-edited
 * document) answers the default — the material is cosmetic, so a broken
 * document must never cost the skin.
 * @param raw - the stored `glass` field.
 * @returns whether the material is on.
 */
export function resolveGlass(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_GLASS
}

/**
 * Narrow one raw blur radius into the slider's integer range.
 *
 * Forgiving on purpose (a numeric string is accepted, NaN or an out-of-range
 * value is clamped): the material is cosmetic, so a broken document must cost
 * the blur, never the skin.
 * @param raw - the stored `glassBlur` field.
 * @param fallback - the default for a value this version cannot read (12).
 * @returns an integer in [GLASS_BLUR_MIN, GLASS_BLUR_MAX].
 */
export function resolveGlassBlur(raw: unknown, fallback: number = DEFAULT_GLASS_BLUR): number {
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(GLASS_BLUR_MAX, Math.max(GLASS_BLUR_MIN, Math.round(value)))
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
 * @param hue - the light ground's hue (default {@link DEFAULT_GLOW_HUE_LIGHT}).
 * @returns the alphas in paint order: moon halo, amber glint, wash.
 */
export function glowAlphas(strength: number, hue: GlowHue = DEFAULT_GLOW_HUE_LIGHT): LightGlowAlphas {
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
 * @param hue - the dark ground's hue (default {@link DEFAULT_GLOW_HUE_DARK}).
 * @returns the alphas in paint order: core, halo, bottom reflection, wash.
 */
export function darkGlowAlphas(strength: number, hue: GlowHue = DEFAULT_GLOW_HUE_DARK): DarkGlowAlphas {
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
  /** The LIGHT ground's hue. Defaults to {@link DEFAULT_GLOW_HUE_LIGHT}. */
  hueLight?: GlowHue
  /** The LIGHT ground's strength in percent (0-200). Defaults to {@link DEFAULT_GLOW_STRENGTH_LIGHT}. */
  strengthLight?: number
  /** The DARK ground's hue. Defaults to {@link DEFAULT_GLOW_HUE_DARK}. */
  hueDark?: GlowHue
  /** The DARK ground's strength in percent (0-200). Defaults to {@link DEFAULT_GLOW_STRENGTH_DARK}. */
  strengthDark?: number
  /**
   * The 0.1.4 glass material (M1: the input card). Defaults ON.
   *
   * `false` drops the material rules from the sheet AND leaves
   * {@link GLASS_ATTR} off the root, so the face paints its host colour again
   * (the pre-0.1.4 screen). Independent of `glow`: a profile may keep the
   * material with the ground off (nothing shows through, but the switch state
   * is the user's).
   */
  glass?: boolean
  /**
   * The blur radius in px (0-30), written to {@link GLASS_BLUR_TOKEN} on
   * `<html>`. Defaults to {@link DEFAULT_GLASS_BLUR}.
   *
   * NOT part of the sheet text: {@link skinCss} names the custom property, and
   * this value is what the property is set to, so the sheet's bytes are the
   * same at every radius (which is what keeps the weekly slider from
   * re-parsing it — and what makes the verbatim assertion radius-independent).
   */
  glassBlur?: number
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
 * M6 splits the pair: the light rule uses `hueLight × strengthLight`, the dark
 * rule `hueDark × strengthDark` — two independent controls, because the user's
 * final colour call is different in each scheme (浅色 柔和 @90 / 深色 夜空蓝 @100).
 * @param hueLight - the light ground's hue.
 * @param strengthLight - the light ground's strength (0-200).
 * @param hueDark - the dark ground's hue.
 * @param strengthDark - the dark ground's strength (0-200).
 * @returns the rules' lines (light first, then the dark override).
 */
function groundRules(
  hueLight: GlowHue,
  strengthLight: number,
  hueDark: GlowHue,
  strengthDark: number,
): readonly string[] {
  const lightForm = GLOW_HUE_AT_FULL[hueLight]
  const darkForm = GLOW_HUE_AT_FULL[hueDark]
  const light = glowAlphas(strengthLight, hueLight)
  const dark = darkGlowAlphas(strengthDark, hueDark)
  return [
    // M5: the ONE literal colour the sheet owns (see NIGHT_BLUE_TOKEN). It is
    // declared here, inside the switchable ground segment, so `glow: false` takes
    // it — and the `night` hue that reads it — with it.
    '/* 0.1.2 hue anchor (M5): the 228-key table carries no usable blue, so the',
    '   skin owns exactly ONE literal colour, read by the `night` hue. */',
    'html[data-moonset-skin] {',
    `  ${NIGHT_BLUE_TOKEN}: ${NIGHT_BLUE_LIGHT};`,
    '}',
    'html[data-moonset-skin] body[data-ds-dark-theme] {',
    `  ${NIGHT_BLUE_TOKEN}: ${NIGHT_BLUE_DARK};`,
    '}',
    '/* 0.1.2 ground (light): canvas + wash + two spots in ONE declaration; the',
    '   strength is resolved in JS, so every alpha below is a LITERAL percentage. */',
    'html[data-moonset-skin] body {',
    '  background:',
    `    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(${lightForm.light}) ${light.moon}, transparent) 0%, transparent 62%),`,
    `    radial-gradient(ellipse at 97% 97%, color-mix(in srgb, var(--dsw-static-amber-500) ${light.warm}, transparent) 0%, transparent 46%),`,
    `    linear-gradient(165deg, color-mix(in srgb, var(${lightForm.light}) ${light.wash}, transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);`,
    '}',
    // The dark override. Same gating attribute, plus the host's own dark marker
    // (`body[data-ds-dark-theme]`, the official design-platform switch), so it
    // only ever applies to the dark scheme and outranks the light rule there.
    '/* 0.1.2 ground (dark): ONE indigo hue at three footprints (core, halo,',
    '   bottom reflection) plus a thinner wash — depth without a second colour. */',
    'html[data-moonset-skin] body[data-ds-dark-theme] {',
    '  background:',
    `    radial-gradient(circle at 34% 2%, color-mix(in srgb, var(${darkForm.dark}) ${dark.core}, transparent) 0%, transparent 26%),`,
    `    radial-gradient(ellipse at 50% -6%, color-mix(in srgb, var(${darkForm.dark}) ${dark.moon}, transparent) 0%, transparent 70%),`,
    `    radial-gradient(ellipse at 50% 104%, color-mix(in srgb, var(${darkForm.dark}) ${dark.floor}, transparent) 0%, transparent 55%),`,
    `    linear-gradient(160deg, color-mix(in srgb, var(${darkForm.dark}) ${dark.wash}, transparent) 0%, transparent 75%) var(--dsw-alias-bg-base);`,
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
 * The 0.1.4 material: FOUR faces, ONE recipe (M1 input card, M2 sidebar + top
 * bar, M3 conversation header).
 *
 * Every face is addressed by a STABLE hook, never by a host class name (those
 * are hashed per build) and never by counting more than one hop:
 *
 *   input card  `[data-composer-card]` — the node the installed InputBar renders
 *               with that attribute (InputBar.tsx:462), whose class paints
 *               `--dsw-specific-input-major` (InputBar.module.css:71);
 *   sidebar     `#root [data-slot='sidebar'] > div` — the renderer's slot anchor
 *               is `display: contents`, so its child IS SidebarRoot's `.root`,
 *               the element painting `--dsw-specific-sidebar-fill`
 *               (SidebarRoot.module.css:19);
 *   header      `#root [data-slot='conversation.header'] > header` — the header
 *               slot anchor (ConversationMainPanel.tsx:39) is `display: contents`,
 *               so its child is ConversationHeader's `<header>` — the element
 *               carrying `data-window-drag` and the 0.5px `border-bottom`
 *               (ConversationHeader.tsx:18 / ConversationRoot.module.css:23-31).
 *               A slot-key anchor rather than `[data-window-drag]`: the sidebar
 *               uses the same drag marker on two of its own rows, so the marker
 *               alone is not unique to this face;
 *   top bar     `#root [data-slot='root'] > div::before` — the root slot anchor's
 *               child is AppFrame's `.frame`; on Windows the shell stamps
 *               `html[data-windows-titlebar]` and the frame paints its caption
 *               strip as `::before` (AppFrame.module.css:40-47, `sidebar-fill`,
 *               the window drag region). Gated on that attribute, so the rule is
 *               inert on macOS — where the strip does not exist and an
 *               unconditional `::before` would paint a band over the whole frame.
 *
 * WHAT EACH FACE HAS BEHIND IT (this decides how visible the material can be):
 *   input card — the transcript, so the blur has text and bubbles to melt;
 *   sidebar     — the ground only;
 *   header      — the ground only. The host header is NOT sticky and the
 *                 transcript scrolls inside `.body`, BELOW it (`.scrollBody {
 *                 overflow-y: auto }`, ConversationRoot.module.css:485-494;
 *                 `.root[data-phase='active'] .header { flex: none }` at :451-453;
 *                 measured: the first message starts 18px below the header). So
 *                 the header glass shows the halo/ground behind it — it can not
 *                 show blurred messages, because nothing renders behind it;
 *   top bar     — the ground (the halo core sits near it in dark).
 *
 * The shape is fixed by P6: a face paints nothing (`background: transparent`
 * clears its host fill) and the material sits on the face's own `::before`, so
 * the blur samples what is BEHIND the face instead of its own paint.
 * `z-index: -1` is what puts the plane behind the face's content — measured on
 * Chromium: without it the pseudo-element paints in the positioned layer, above
 * the in-flow text, and its `backdrop-filter` blurs the face's own content away.
 * `isolation: isolate` keeps that negative plane inside the face's stacking
 * context, so it can never fall behind an opaque ancestor (the composer seat
 * still paints its bg-base mask band when the ground is off).
 *
 * The caption strip is the one face that is ALREADY a `::before`: it is a leaf
 * paint surface with no content of its own, so the material goes on it directly
 * (geometry stays the host's: `inset`, `height` and the drag region are not
 * touched here).
 *
 * ONE material, shared verbatim by the planes and the strip (`material` below is
 * emitted twice): the canvas at 62% plus a 10% near-white top highlight
 * (`--dsw-static-neutral-bluish-00`) — a token, not the plan's
 * `rgba(255,255,255,0.10)`, so P5's "every colour from a token" rule holds (the
 * sheet's only literals stay the two night anchors). Two faces deviate on
 * purpose, and only in the way the user's dark-scheme report demanded:
 *
 *  - SIDEBAR: its own base. `--dsw-specific-sidebar-fill` is `#F4F4F7` light /
 *    `#15171F` dark, i.e. within a few units of "62% canvas over the ground"
 *    (measured on/off: Δ5.4 light, Δ7.6 dark), so the shared material was
 *    invisible there — the user's 「深色下侧栏看不出区别」. The glass base is
 *    `--dsw-alias-bg-module-platform` (12% accent over the canvas) at 72%, which
 *    measures Δ10.4 light / Δ11.7 dark — a tinted panel in both schemes, still
 *    a token mix, and the blur is unchanged;
 *  - HEADER: keeps the host's 0.5px `border-bottom` (nothing here writes
 *    `border`) and adds the material's own bottom edge on the plane, because a
 *    1px line under a 62%-opaque plane would be muted to invisibility. The line
 *    is `--dsw-alias-border-l3`, the same token the host border uses.
 *
 * What this block may NOT touch: layout — `position` (the `::before`'s
 * containing block) is the one exception the milestone budget bought, and
 * `isolation` is paint-only. No size, margin, padding or overflow is written;
 * every face keeps its box, its radius (`border-radius: inherit`) and its host
 * shadow.
 * @returns the rule lines (five rules: the planes, the sidebar base, the header
 *   edge, the strip, the faces).
 */
function glassRules(): readonly string[] {
  /** The input card (M1): the host's own stable attribute. */
  const card = 'html[data-moonset-skin][data-moonset-glass] [data-composer-card]'
  /** The sidebar column's inner root (M2): the slot anchor's only child. */
  const sidebar = "html[data-moonset-skin][data-moonset-glass] #root [data-slot='sidebar'] > div"
  /** The conversation header (M3): the header slot anchor's only child. */
  const header = "html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header"
  /** The Windows caption strip (M2): the frame's existing ::before. */
  const strip = "html[data-windows-titlebar][data-moonset-skin][data-moonset-glass] #root [data-slot='root'] > div::before"
  /** The material itself — the SAME three declarations on every face. */
  const material = [
    '  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);',
    '  backdrop-filter: blur(var(--dsh-moonset-glass-blur)) saturate(1.15);',
    '  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent);',
  ]
  return [
    '/* 0.1.4 glass (M1 card, M2 sidebar + top bar, M3 header): ONE material on',
    '   four planes. P6: the face paints nothing and the material sits on its',
    '   ::before, so the blur samples what is BEHIND the face; z-index -1 plus',
    '   isolation keeps the plane behind the face content. The top bar is the',
    '   Windows caption strip, which is already the frame ::before. */',
    `${card}::before,`,
    `${sidebar}::before,`,
    `${header}::before {`,
    "  content: ''; position: absolute; inset: 0; z-index: -1;",
    '  border-radius: inherit; pointer-events: none;',
    ...material,
    '}',
    '/* M3: the sidebar base is tinted and denser — its host fill sits within a',
    '   few units of the shared material, so the shared one measured invisible',
    '   (Δ5.4 light / Δ7.6 dark); this reads Δ10.4 / Δ11.7. Same blur. */',
    `${sidebar}::before {`,
    '  background: color-mix(in srgb, var(--dsw-alias-bg-module-platform) 72%, transparent);',
    '}',
    '/* M3: the header keeps the host 0.5px border-bottom and adds the material',
    '   edge on the plane (a line under a 62% plane would be muted away). */',
    `${header}::before {`,
    '  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent), inset 0 -1px 0 var(--dsw-alias-border-l3);',
    '}',
    `${strip} {`,
    ...material,
    '}',
    `${card},`,
    `${sidebar},`,
    `${header} {`,
    '  position: relative; isolation: isolate; background: transparent;',
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
 * subtree sweep: muted children (timestamps, summaries) set their own colour
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
 * The 0.1.3 M2 block is the whitelist's step-row entry: the four STEP ROW
 * implementations the installed client renders (the generic tool row
 * `ToolRow`, the bash row, the reasoning row and the generic command card)
 * all publish the SAME two stable hooks — the row root carries
 * `[data-variant][data-state]`, and the "`·`" between the tool name and its
 * arguments is `[data-shimmer-decoration]` — while the tool name and the
 * arguments/path cells themselves carry only hashed class names. The rule
 * therefore addresses the two cells RELATIVELY to that dot: the element whose
 * next sibling is the dot is the name (`:has(+ …)`), the sibling after it is
 * the arguments (`+ *`). The one universal selector in the sheet is that
 * sibling position, not a sweep: it cannot escape the row, and the expanded body
 * is a SIBLING of the disclosure row, so it is outside the rule by construction.
 *
 * The HUE is per KIND of step (0.1.3 M2b): the class rules set two custom
 * properties on the row (`--dsh-moonset-step-name` / `-args`) and the two cell
 * rules read them, so adding a class is one more declaration block instead of
 * two more cell rules. Classes: shell `[data-variant='bash']` green, files
 * (`read` / `write` / `edit`) blue-violet, `search` amber, `think` violet;
 * `code` and `others` fall back to the accent, which is ALSO the unknown-tool
 * colour because it is the property's fallback value. Every hue is a
 * `color-mix(in srgb, <family> N%, <label token>)`: the label tokens flip with
 * the scheme, so ONE declaration darkens the hue on light and lightens it on
 * dark (the same trick the active button uses, 0.1.3 M1). 65% for the name,
 * 25% for the arguments: the on-device pass found 40% left the arguments reading
 * as the same colour as the name, so the pair now differs by at least 30 RGB
 * units (measured minimum 30.2, files/light) while the arguments keep a visible
 * tint of their class (>= 15.5 RGB units away from a plain label). Measured on
 * the canvas, light / dark — name first, arguments second: shell 6.48 / 11.32
 * and 7.09 / 9.20, files 6.71 / 10.03 and 7.02 / 8.86, search 7.61 / 9.93 and
 * 7.53 / 8.76, reasoning 5.06 / 8.25 and 6.27 / 8.19 — every cell clears AA in
 * both schemes.
 *
 * The mono face is `--ds-font-family-code` (the theme layer's code stack, the
 * same one the host's own diff totals read). A FAILED step (non-zero exit or a
 * terminating signal) wins over its class: name, arguments and the exit capsule
 * (`[data-tone]`) all take `--dsw-alias-state-error-primary` — 6.41:1 / 8.10:1
 * on the canvas, 5.28 / 6.93 on the capsule's own background — and that rule
 * sits LAST so a later class cannot out-order it. COLOUR ONLY: the on-device
 * pass rejected the 500 weight the first cut added, so the failed line is not
 * bold and no rule in the sheet writes `font-weight`.
 *
 * A SUCCESS capsule does not
 * exist in this build: the exit badge renders only while `terminalFailed()` is
 * true (`dsh-client-ui-tool/…/terminal-card-model.ts:96-112`;
 * `ExitCodeBadge.tsx:12` hard-codes `tone="neutral"`), so nothing is painted for
 * the success case (§11.7 records the gap).
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
 *   step rows       (0.1.3 M2) the two terminal-coloured cells of a step row,
 *                   also whitelisted;
 *   material faces  (0.1.4 M1) `::before` planes, also whitelisted.
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
    '/* dsh-moonset[0.1.4]: skin — P5 whitelist (selection, item text, ground, step',
    '   rows, material) */',
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
    '/* 0.1.3 M2: a step row reads as a terminal line, and each KIND of step carries',
    '   its own hue (shell green, file blue-violet, search amber, reasoning violet;',
    '   code and unknown tools keep the accent). Host hooks: [data-variant] on the',
    '   row, [data-shimmer-decoration] the dot before the arguments. */',
    "html[data-moonset-skin] body [data-variant][data-state] :has(+ [data-shimmer-decoration]) {",
    '  color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500));',
    '  font-family: var(--ds-font-family-code);',
    '}',
    "html[data-moonset-skin] body [data-variant][data-state] [data-shimmer-decoration] + * {",
    '  color: var(--dsh-moonset-step-args, var(--dsw-alias-label-secondary));',
    '  font-family: var(--ds-font-family-code);',
    '}',
    "html[data-moonset-skin] body [data-variant='bash'] {",
    '  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-green-500) 65%, var(--dsw-alias-label-primary));',
    '  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-green-500) 25%, var(--dsw-alias-label-secondary));',
    '}',
    "html[data-moonset-skin] body [data-variant='read'],",
    "html[data-moonset-skin] body [data-variant='write'],",
    "html[data-moonset-skin] body [data-variant='edit'] {",
    '  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-deepseek-400) 65%, var(--dsw-alias-label-primary));',
    '  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-deepseek-400) 25%, var(--dsw-alias-label-secondary));',
    '}',
    "html[data-moonset-skin] body [data-variant='search'] {",
    '  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-amber-600) 65%, var(--dsw-alias-label-primary));',
    '  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-amber-600) 25%, var(--dsw-alias-label-secondary));',
    '}',
    "html[data-moonset-skin] body [data-variant='think'] {",
    '  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-violet-400) 65%, var(--dsw-alias-label-primary));',
    '  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-violet-400) 25%, var(--dsw-alias-label-secondary));',
    '}',
    '/* failed step (exit != 0 / signal): the class hue loses to the error colour. */',
    "html[data-moonset-skin] body [data-variant][data-state='error'] :has(+ [data-shimmer-decoration]),",
    "html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] + *,",
    "html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] ~ [data-tone] {",
    '  color: var(--dsw-alias-state-error-primary);',
    '}',
  ]
  if (options.glow !== false) {
    rules.push(...groundRules(
      options.hueLight ?? DEFAULT_GLOW_HUE_LIGHT,
      options.strengthLight ?? DEFAULT_GLOW_STRENGTH_LIGHT,
      options.hueDark ?? DEFAULT_GLOW_HUE_DARK,
      options.strengthDark ?? DEFAULT_GLOW_STRENGTH_DARK,
    ))
    rules.push(...visibilityRules(options.scope ?? DEFAULT_GLOW_SCOPE))
  }
  // 0.1.4 M1: the material is its OWN switch (GLASS_ATTR), not part of the
  // ground segment — "glow off, glass on" is a legal state (the plan's §一).
  if (options.glass !== false) rules.push(...glassRules())
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
    /**
     * `<html>`'s inline style — the ONE element-level style write this plugin
     * makes (0.1.4): {@link GLASS_BLUR_TOKEN}, the glass blur radius. Declared
     * structurally like the rest of this surface, because the repo carries no
     * DOM implementation and the tests drive a stub.
     */
    style: {
      /** Write one custom property (`--x`, `12px`). */
      setProperty(name: string, value: string): void
      /** Remove one custom property — part of the zero-residue teardown. */
      removeProperty(name: string): void
    }
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
 * Align the material's TWO DOM facts with the options: the root attribute and
 * the blur radius.
 *
 * The attribute is the gate; the radius is the knob. Both live outside the sheet
 * on purpose (P2 + the 0.1.2 D2 lesson): the sheet names `var(--…-blur)`, so a
 * slider drag changes a VALUE on `<html>` instead of re-parsing the whole sheet,
 * and the verbatim sheet assertion stays radius-independent. "Glass off" removes
 * both, which is what makes the switch total rather than a zero-radius no-op.
 * @param root - document surface.
 * @param options - the emit switches (`glass`, `glassBlur`).
 */
function applyGlass(root: SkinRoot, options: SkinOptions): void {
  if (options.glass === false) {
    root.documentElement.removeAttribute(GLASS_ATTR)
    root.documentElement.style.removeProperty(GLASS_BLUR_TOKEN)
    return
  }
  root.documentElement.setAttribute(GLASS_ATTR, '')
  root.documentElement.style.setProperty(GLASS_BLUR_TOKEN, `${resolveGlassBlur(options.glassBlur)}px`)
}

/**
 * Mount the skin: root attribute on, sheet in the head. Idempotent.
 *
 * The order is attribute FIRST, then the material's two facts, then the
 * singleton check: an already mounted skin must still end up with the attribute
 * set (it is the gate every future rule reads), and the sheet is only built when
 * the document does not carry one already. Repeated mounts therefore converge
 * to exactly one sheet (P2).
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
    // Before the singleton check: an already mounted sheet must still pick up
    // the material's switch and radius (a re-mount is a state correction, not
    // only a first paint).
    applyGlass(target, options)
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
    // The material rides the same call: its gate and radius are DOM facts, the
    // sheet only names them. Order matters for the radius — the property exists
    // before the text that reads it can be parsed.
    applyGlass(target, options)
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
    // Zero residue: the material's gate and the inline radius go with the sheet.
    target.documentElement.removeAttribute(GLASS_ATTR)
    target.documentElement.style.removeProperty(GLASS_BLUR_TOKEN)
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
