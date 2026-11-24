// @vitest-environment node
/**
 * 0.1.1–0.1.2 skin layer: one root attribute, one injected sheet, and the exact rules.
 *
 * The cases are grouped by contract rather than by function:
 *
 *  - MOUNT — `<html data-moonset-skin>` and exactly ONE
 *    `<style data-dsh-moonset-skin>` in the head (P2: a second sheet would fight
 *    the first, and the winner would depend on document order);
 *  - THE SHEET — the CSS text is the contract: byte-for-byte, inside the
 *    whitelist budget (<= 40 lines, no layout properties), and every colour
 *    comes from a `--dsw-*` token rather than a literal (P5);
 *  - GROUND — the 0.1.2 wash + two viewport-fixed spots: root-gated, token-only,
 *    both radial layers at their contract alphas, the strength factor inlined,
 *    and the WHOLE rule absent when the (M2) switch says off;
 *  - VISIBILITY — M1.5: the host's opaque layers in front of the ground (the
 *    frame, the centre column, the conversation root) get
 *    `background-color: transparent`, addressed by CONTAINMENT on two
 *    independent anchors — the renderer's `[data-slot='main']` and the
 *    conversation's `[data-composer-seat]` — never by counting depth;
 *  - SELECTED ITEMS — the selected row's LABEL is the accent, hooked on the four
 *    stable attributes the real UI renders (never a host class name), root-
 *    gated so it outranks the host's own selected-tab colour, and readable on
 *    the violet wash in both schemes;
 *  - UNMOUNT — attribute off, sheet gone, ZERO residue, idempotent both ways;
 *  - WIRING — `apply()` mounts, the fiber teardown unmounts (`ctx.effect`), so
 *    the skin cannot outlive its plugin;
 *  - CHOICE — the sheet is not unconditional: `off` (the official theme) takes it
 *    off from all three paths that learn a choice (boot restore, our section's
 *    pick, the official-Appearance mirror);
 *  - TOKENS — the colours the rules read are the palette's own accent / moon /
 *    canvas anchors, i.e. the sheet follows the theme instead of duplicating it.
 *
 * No DOM implementation is involved (this repo carries none — PLAN §九 已知债):
 * `skin.ts` is written against a structural surface, and the stub below models
 * the three behaviours the contract rests on — attribute writes, one appendable
 * head, and a query that only finds attached elements carrying our attribute.
 * `document` is stubbed globally for the wiring case only, and unstubbed after.
 */
import { readFileSync } from 'node:fs'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { BOOT_SHEET_SELECTOR } from '../src/client/boot-cleanup'
import { SKIN_REBUILD_MS, apply } from '../src/client/index'
import { MOONSET_DARK, MOONSET_LIGHT, MOONSET_TOKEN_OVERRIDES } from '../src/client/palettes'
import {
  DEFAULT_GLASS,
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLOW_HUE_DARK,
  DEFAULT_GLOW_HUE_LIGHT,
  DEFAULT_GLOW_SCOPE,
  DEFAULT_GLOW_STRENGTH_DARK,
  DEFAULT_GLOW_STRENGTH_LIGHT,
  GLASS_ATTR,
  GLASS_BLUR_MAX,
  GLASS_BLUR_MIN,
  GLASS_BLUR_STEP,
  GLASS_BLUR_TOKEN,
  DEFAULT_HEADER_HEIGHT,
  HEADER_HEIGHT_TOKEN,
  HEADER_HOOK,
  GLOW_ALPHA_AT_FULL,
  GLOW_HUES,
  GLOW_HUE_AT_FULL,
  GLOW_SCOPES,
  GLOW_STRENGTH_MAX,
  GLOW_STRENGTH_MIN,
  SKIN_ATTR,
  SKIN_SHEET_ATTR,
  NIGHT_BLUE_TOKEN,
  SKIN_SHEET_SELECTOR,
  darkGlowAlphas,
  glowAlphas,
  mountSkin,
  resolveGlass,
  resolveGlassBlur,
  resolveGlowHue,
  resolveGlowScope,
  resolveGlowStrength,
  scheduleHeaderMeasure,
  skinCss,
  syncHeaderHeight,
  syncSkin,
  unmountSkin,
  updateSkin,
  type GlowHue,
  type GlowScope,
  type SkinRoot,
  type SkinSheetElement,
} from '../src/client/skin'

const BOARD_URL = new URL('../themes/moonset-palette.json', import.meta.url)
const board = JSON.parse(readFileSync(BOARD_URL, 'utf8')) as Record<'light' | 'dark', Record<string, string>>

/** The accent the skin draws from: the static token the palette anchors `accent` to. */
const ACCENT = '--dsw-static-deepseek-500'

/** The moon anchor: the amber the 0.1.2 warm light is mixed from. */
const MOON = '--dsw-static-amber-500'

/** The canvas: the base colour under the gradient layers. */
const CANVAS = '--dsw-alias-bg-base'

/**
 * The sheet's line budget: 60 through 0.1.2, 75 for the first 0.1.3 M2 pass,
 * 95 for the per-class pass (M2b), **130 for the 0.1.4 material (three faces)**,
 * **155 for 0.1.5** — three colour entries cost 11 lines (141 → 152 default,
 * 143 → 154 at scope C, which is the widest sheet).
 *
 * The step-row entry is the first whitelist class that addresses TWO cells of a
 * host row, a per-kind hue for each of them, and their failed state: four class
 * declaration blocks plus seven rules (measured 55 → 93). 0.1.4 M1 bought the
 * input card's material (13 lines); M2 grows it to three faces by SHARING the
 * material declarations (measured 104 → 114, i.e. +10 lines for the sidebar and
 * the Windows caption strip). The architecture doc §11.5 carries the same number.
 */
const SHEET_BUDGET = 155

/**
 * Rule blocks in the default sheet: nine through 0.1.2, sixteen since 0.1.3 M2b
 * (two cell rules, four class blocks and the failed-step rule on top of the
 * nine the 0.1.2 sheet shipped), twenty-one since 0.1.4 M3: the material's
 * plane rule (card + sidebar + header), the sidebar's own base, the header's
 * edge, the caption strip's material, and the faces' clear — all five inside
 * the one switchable segment. Twenty-six since 0.1.5: the three colour entries
 * (turn-changes card, context-injection row, light-scheme failure red).
 */
const SHEET_RULES = 26

/**
 * The 0.1.1 + 0.1.3 half of the sheet, restated verbatim.
 *
 * A literal on purpose: this string IS the whitelist entry, so the test has to
 * fail when the production rule is reworded, re-scoped or grows a declaration.
 * 0.1.2 appends the ground segment below; splitting the halves lets the
 * switch-off case assert the pre-glow sheet returns byte-for-byte. 0.1.3 M2
 * appends the step-row colours to THIS half: they ride the same switch, so the
 * pre-glow sheet still carries them.
 */
const EXPECTED_BASE_CSS = [
  "/* dsh-moonset[0.1.4]: skin — P5 whitelist (selection, item text, ground, step",
  "   rows, material) */",
  "html body ::selection {",
  "  background: color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent);",
  "  color: var(--dsw-static-deepseek-500);",
  "}",
  "/* selected items: stable attributes only, never a host class name. The root",
  "   attribute gate is what outranks the host (0,2,2 vs .tab[data-active] 0,2,0). */",
  "html[data-moonset-skin] body [aria-selected='true'],",
  "html[data-moonset-skin] body [aria-current='page'],",
  "html[data-moonset-skin] body [aria-current='true'],",
  "html[data-moonset-skin] body [data-active='true'],",
  "html[data-moonset-skin] body [aria-pressed='true'] {",
  "  color: var(--dsw-static-deepseek-500);",
  "}",
  "/* the host draws the selected tab underline as a 2px ink bar; keep it the",
  "   label colour. Only the plugins tab renders an ::after on such an element. */",
  "html[data-moonset-skin] body [data-active='true']::after {",
  "  background: var(--dsw-static-deepseek-500);",
  "}",
  "/* 0.1.3 M2: a step row reads as a terminal line, and each KIND of step carries",
  "   its own hue (shell green, file blue-violet, search amber, reasoning violet;",
  "   code and unknown tools keep the accent). Host hooks: [data-variant] on the",
  "   row, [data-shimmer-decoration] the dot before the arguments. */",
  "html[data-moonset-skin] body [data-variant][data-state] :has(+ [data-shimmer-decoration]) {",
  "  color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500));",
  "  font-family: var(--ds-font-family-code);",
  "}",
  "html[data-moonset-skin] body [data-variant][data-state] [data-shimmer-decoration] + * {",
  "  color: var(--dsh-moonset-step-args, var(--dsw-alias-label-secondary));",
  "  font-family: var(--ds-font-family-code);",
  "}",
  "html[data-moonset-skin] body [data-variant='bash'] {",
  "  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-green-500) 65%, var(--dsw-alias-label-primary));",
  "  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-green-500) 25%, var(--dsw-alias-label-secondary));",
  "}",
  "html[data-moonset-skin] body [data-variant='read'],",
  "html[data-moonset-skin] body [data-variant='write'],",
  "html[data-moonset-skin] body [data-variant='edit'] {",
  "  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-deepseek-400) 65%, var(--dsw-alias-label-primary));",
  "  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-deepseek-400) 25%, var(--dsw-alias-label-secondary));",
  "}",
  "html[data-moonset-skin] body [data-variant='search'] {",
  "  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-amber-600) 65%, var(--dsw-alias-label-primary));",
  "  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-amber-600) 25%, var(--dsw-alias-label-secondary));",
  "}",
  "html[data-moonset-skin] body [data-variant='think'] {",
  "  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-violet-400) 65%, var(--dsw-alias-label-primary));",
  "  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-violet-400) 25%, var(--dsw-alias-label-secondary));",
  "}",
  "/* failed step (exit != 0 / signal): the class hue loses to the error colour. */",
  "html[data-moonset-skin] body [data-variant][data-state='error'] :has(+ [data-shimmer-decoration]),",
  "html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] + *,",
  "html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] ~ [data-tone] {",
  "  color: var(--dsh-moonset-error, var(--dsw-alias-state-error-primary));",
  "}",
].join('\n')

/** The 0.1.2 segment (night anchor + light ground + dark override), verbatim. */
const EXPECTED_GLOW_CSS = [
  '/* 0.1.2 hue anchor (M5): the 228-key table carries no usable blue, so the',
  '   skin owns exactly ONE literal colour, read by the `night` hue. */',
  'html[data-moonset-skin] {',
  '  --dsh-moonset-night: #2563EB;',
  '}',
  'html[data-moonset-skin] body[data-ds-dark-theme] {',
  '  --dsh-moonset-night: #60A5FA;',
  '}',
  '/* 0.1.2 ground (light): canvas + wash + two spots in ONE declaration; the',
  '   strength is resolved in JS, so every alpha below is a LITERAL percentage. */',
  'html[data-moonset-skin] body {',
  '  background:',
  '    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--dsw-static-deepseek-500) 8.06%, transparent) 0%, transparent 62%),',
  '    radial-gradient(ellipse at 97% 97%, color-mix(in srgb, var(--dsw-static-amber-500) 2.7%, transparent) 0%, transparent 46%),',
  '    linear-gradient(165deg, color-mix(in srgb, var(--dsw-static-deepseek-500) 0.76%, transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);',
  '}',
  '/* 0.1.2 ground (dark): ONE indigo hue at three footprints (core, halo,',
  '   bottom reflection) plus a thinner wash — depth without a second colour. */',
  'html[data-moonset-skin] body[data-ds-dark-theme] {',
  '  background:',
  '    radial-gradient(circle at 34% 2%, color-mix(in srgb, var(--dsh-moonset-night) 12%, transparent) 0%, transparent 26%),',
  '    radial-gradient(ellipse at 50% -6%, color-mix(in srgb, var(--dsh-moonset-night) 20%, transparent) 0%, transparent 70%),',
  '    radial-gradient(ellipse at 50% 104%, color-mix(in srgb, var(--dsh-moonset-night) 4%, transparent) 0%, transparent 55%),',
  '    linear-gradient(160deg, color-mix(in srgb, var(--dsh-moonset-night) 1%, transparent) 0%, transparent 75%) var(--dsw-alias-bg-base);',
  '}',
  '/* 0.1.2 visibility (scope: main): the host paints bg-base on these',
  '   carriers; clear their COLOUR — cards, bubbles and menus keep theirs. */',
  "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar']),",
  'html[data-moonset-skin] #root :has([data-composer-seat]),',
  "html[data-moonset-skin] #root [data-slot='main'] > div {",
  '  background-color: transparent;',
  '}',
  "/* 0.1.2 bottom band (M2): the composer seat's bg-base mask is an image. */",
  'html[data-moonset-skin] #root [data-composer-seat] {',
  '  background-image: none;',
  '}',
].join('\n')

/**
 * The 0.1.4 material segment (FOUR faces, ONE recipe), verbatim.
 *
 * M1 shipped the input card, M2 the sidebar column and the Windows caption
 * strip, M3 the conversation header. `background` / `backdrop-filter` /
 * `box-shadow` stay the SAME TEXT on the planes and the strip; two faces
 * deviate on purpose and ONLY where the real-machine report demanded it (the
 * sidebar's base, the header's bottom edge) — the parity case below reads both
 * back out of the sheet, so a silent third deviation fails.
 */
const EXPECTED_GLASS_CSS = [
  '/* 0.1.4 glass (M1 card, M2 top bar, M3 header; the sidebar left in M6): ONE',
  '   material on three planes. P6: the face paints nothing and the material sits',
  '   on its ::before, so the blur samples what is BEHIND the face; z-index -1',
  '   plus isolation keeps it behind the face content. The top bar is the Windows',
  '   caption strip, which is already the frame ::before. */',
  'html[data-moonset-skin][data-moonset-glass] [data-composer-card]::before,',
  "html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header::before {",
  "  content: ''; position: absolute; inset: 0; z-index: -1;",
  '  border-radius: inherit; pointer-events: none;',
  '  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);',
  '  backdrop-filter: blur(var(--dsh-moonset-glass-blur)) saturate(1.15);',
  '  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent);',
  '}',
  '/* M3: the header keeps the host 0.5px border-bottom and adds the material',
  '   edge on the plane (a line under a 62% plane would be muted away). */',
  "html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header::before {",
  '  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent), inset 0 -1px 0 var(--dsw-alias-border-l3);',
  '}',
  "html[data-windows-titlebar][data-moonset-skin][data-moonset-glass] #root [data-slot='root'] > div::before {",
  '  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);',
  '  backdrop-filter: blur(var(--dsh-moonset-glass-blur)) saturate(1.15);',
  '  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent);',
  '}',
  'html[data-moonset-skin][data-moonset-glass] [data-composer-card],',
  "html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header {",
  '  position: relative; isolation: isolate; background: transparent;',
  '}',
  '/* M4: the header FLOATS over the transcript (the Catppuccin recipe): the',
  '   scroll body slides up behind the glass and its padding starts the content',
  '   below it, so messages scroll UNDER the header and stay visibly blurred',
  '   instead of hard-clipping. --dsh-moonset-header-h is MEASURED by JS',
  '   (bounded retries) into html.style; 76px is the host min-height fallback.',
  '   z-index 8 clears the in-scroller chrome (banner 6, compaction + rail 7)',
  '   and stays under the composer seat (9). */',
  "html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-slot='conversation.header'] > header {",
  '  z-index: 8;',
  '}',
  "html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-conversation-scroll] {",
  '  position: relative; z-index: 0;',
  '  margin-top: calc(-1 * var(--dsh-moonset-header-h, 76px));',
  '  padding-top: calc(var(--dsh-moonset-header-h, 76px) + 12px);',
  '}',
  "/* M5/0.1.5 G1: the banner pins below the header. Chromium resolves a sticky",
  "   offset against the scroller's CONTENT box, so the float's padding (header-h",
  '   + 12) rides along: `top: H` landed at header-bottom + 12 + H (measured 88px',
  '   at H=76). Give the 12px air back — `top: -12px` — and the gap is 0. */',
  "html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-conversation-scroll] :has(> [data-code-block-banner]) {",
  '  top: -12px;',
  '}',
].join('\n')

/**
 * The 0.1.5 colour segment, verbatim — appended LAST, after the material.
 *
 * Three rules, all colour-only: the turn-changes card (0.1.5 G2), the
 * context-injection row (G3) and the LIGHT failure red (G4). They are their own
 * segment because they ride no switch: "glow off" and "glass off" both keep them.
 */
const EXPECTED_COLOUR_CSS = [
  '/* 0.1.5 G2/G3/G4: three colour-only entries — the turn-changes card, the',
  '   context-injection row and the LIGHT failure red. No layout property. */',
  'html[data-moonset-skin] body [data-changed-files] {',
  '  background-color: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); --changes-fill: var(--dsw-alias-bg-layer-2);',
  '}',
  "html[data-moonset-skin] body [data-disclosure-row]:has([data-context-source], [data-context-summary]) {",
  '  color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500));',
  '}',
  'html[data-moonset-skin] body:not([data-ds-dark-theme]) {',
  '  --dsh-moonset-error: color-mix(in srgb, var(--dsw-alias-state-error-primary) 70%, var(--dsw-alias-label-primary));',
  '}',
].join('\n')

/** The complete 0.1.5 sheet: base, ground, material, then the colour entries. */
const EXPECTED_CSS = EXPECTED_BASE_CSS + '\n' + EXPECTED_GLOW_CSS + '\n' + EXPECTED_GLASS_CSS + '\n' + EXPECTED_COLOUR_CSS

/** The LIGHT ground rule of one sheet (the night anchor and the dark rule follow). */
function lightGroundRule(sheet: string): string {
  const start = sheet.indexOf('html[data-moonset-skin] body {')
  return sheet.slice(start, sheet.indexOf('}', start) + 1)
}

/** The DARK ground rule of one sheet (the night anchor rule comes first). */
function darkGroundRule(sheet: string): string {
  const groundAt = sheet.indexOf('/* 0.1.2 ground (dark)')
  const start = sheet.indexOf('html[data-moonset-skin] body[data-ds-dark-theme] {', groundAt)
  return sheet.slice(start, sheet.indexOf('}', start) + 1)
}

/**
 * The percentage format `skin.ts` emits: at most two decimals, no trailing zeros.
 *
 * Restated here so the matrix test derives its expectations from the ARITHMETIC
 * rather than from a second copy of the numbers (a drifted formatter would fail
 * every cell instead of passing on a coincidence).
 * @param value - a percentage.
 * @returns the CSS percentage token.
 */
function percentOf(value: number): string {
  return String(Math.round(value * 100) / 100) + '%'
}


/* ------------------------------------------------------------------ *
 * a tiny colour helper for the selection contrast (light + dark)      *
 * ------------------------------------------------------------------ */

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Follow `var(--dsw-…)` hops inside one scheme table to a leaf value. */
function resolveToken(table: Record<string, string>, token: string): string {
  let value = table[token]
  for (let hop = 0; hop < 8; hop += 1) {
    if (value === undefined) throw new Error('missing token ' + token)
    const ref = /^var\((--dsw-[a-z0-9-]+)\)$/.exec(value.trim())
    if (ref === null) return value
    value = table[ref[1]]
  }
  throw new Error('var() resolution is too deep for ' + token)
}

/** `#RRGGBB` → opaque sRGB (the selection tokens all resolve to hex). */
function rgbOf(value: string): Rgba {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (hex === null) throw new Error('not a hex colour: ' + value)
  return {
    r: parseInt(hex[1].slice(0, 2), 16),
    g: parseInt(hex[1].slice(2, 4), 16),
    b: parseInt(hex[1].slice(4, 6), 16),
    a: 1,
  }
}

/** Paint one translucent colour over an opaque one. */
function over(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

function luminance(colour: Rgba): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b)
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const first = luminance(a)
  const second = luminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/** `var(--dsw-…)` / `color-mix(in srgb, …)` / hex → sRGB (CSS premultiplied mix). */
function colourOf(table: Record<string, string>, value: string, depth = 0): Rgba {
  if (depth > 8) throw new Error('colour resolution is too deep: ' + value)
  const trimmed = value.trim()
  const ref = /^var\((--dsw-[a-z0-9-]+)\)$/.exec(trimmed)
  if (ref !== null) {
    const target = table[ref[1]]
    if (target === undefined) throw new Error('missing token ' + ref[1])
    return colourOf(table, target, depth + 1)
  }
  if (trimmed.startsWith('color-mix(')) {
    const parts = trimmed.slice('color-mix('.length, -1).split(',').map((part) => part.trim())
    if (parts[0] !== 'in srgb') throw new Error('only color-mix(in srgb, …) is resolvable: ' + trimmed)
    const toneOf = (part: string): { colour: string; share: number | null } => {
      const weighted = /^(.*?)\s+([0-9.]+)%$/.exec(part)
      return weighted === null
        ? { colour: part.trim(), share: null }
        : { colour: weighted[1].trim(), share: Number(weighted[2]) }
    }
    const first = toneOf(parts[1])
    const second = toneOf(parts[2])
    let shareFirst = first.share
    let shareSecond = second.share
    if (shareFirst === null && shareSecond === null) { shareFirst = 50; shareSecond = 50 }
    else if (shareFirst === null) shareFirst = 100 - (shareSecond as number)
    else if (shareSecond === null) shareSecond = 100 - shareFirst
    const a = colourOf(table, first.colour, depth + 1)
    const b = colourOf(table, second.colour, depth + 1)
    const wa = (shareFirst as number) / 100
    const wb = (shareSecond as number) / 100
    const alpha = wa * a.a + wb * b.a
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
    return {
      r: (wa * a.r * a.a + wb * b.r * b.a) / alpha,
      g: (wa * a.g * a.a + wb * b.g * b.a) / alpha,
      b: (wa * a.b * a.a + wb * b.b * b.a) / alpha,
      a: alpha,
    }
  }
  return rgbOf(trimmed)
}

/* ------------------------------------------------------------------ *
 * stub document                                                       *
 * ------------------------------------------------------------------ */

/** One `<style>` element. `remove()` detaches it; the node itself survives. */
class StubSheet implements SkinSheetElement {
  readonly attributes = new Map<string, string>()
  textContent = ''
  attached = true
  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  remove(): void {
    this.attached = false
  }
}

/**
 * The document surface, with the smallest faithful behaviour set: a detached
 * element is still owned by the document (a real DOM keeps the node alive too),
 * so `querySelector` has to filter on the attached flag AND on our attribute.
 */
class StubDocument implements SkinRoot {
  readonly attributes = new Map<string, string>()
  /**
   * `<html>`'s inline CUSTOM PROPERTIES (0.1.4): the ONE element-level style
   * write the plugin makes, the glass blur radius.
   */
  readonly inlineStyle = new Map<string, string>()
  /** Every element ever created or appended (attached and detached). */
  readonly sheets: StubSheet[] = []
  /**
   * What the conversation header reports for the M4 float offset. `undefined`
   * models the real first paint: the plugin activates before React renders the
   * conversation, so the measurement has nothing to read yet.
   */
  headerRectHeight: number | undefined = undefined
  readonly documentElement = {
    setAttribute: (name: string, value: string): void => {
      this.attributes.set(name, value)
    },
    removeAttribute: (name: string): void => {
      this.attributes.delete(name)
    },
    style: {
      setProperty: (name: string, value: string): void => {
        this.inlineStyle.set(name, value)
      },
      removeProperty: (name: string): void => {
        this.inlineStyle.delete(name)
      },
    },
  }
  readonly head = {
    appendChild: (node: SkinSheetElement): void => {
      this.sheets.push(node as StubSheet)
    },
  }

  createElement(tagName: 'style'): SkinSheetElement {
    return new StubSheet(tagName)
  }

  querySelector(selector: string): SkinSheetElement | null {
    // The boot sheet is a different channel (boot-cleanup.ts) that runs on the
    // same document; this stub never carries one.
    if (selector === BOOT_SHEET_SELECTOR) return null
    // The M4 float measures the conversation header through the same surface
    // the sheet addresses, so the stub answers it with a box of its own.
    if (selector === HEADER_HOOK || selector === '#root ' + HEADER_HOOK) {
      const height = this.headerRectHeight
      if (height === undefined) return null
      return { getBoundingClientRect: () => ({ height }) } as unknown as SkinSheetElement
    }
    if (selector !== SKIN_SHEET_SELECTOR) throw new Error('unexpected selector: ' + selector)
    const match = this.sheets.find(
      (sheet) => sheet.attached && sheet.tagName === 'style' && sheet.attributes.has(SKIN_SHEET_ATTR),
    )
    return match ?? null
  }

  /** Live sheets only — the figure every residue assertion uses. */
  attached(): StubSheet[] {
    return this.sheets.filter((sheet) => sheet.attached)
  }
}

/* ------------------------------------------------------------------ *
 * mount                                                               *
 * ------------------------------------------------------------------ */

describe('mountSkin — root attribute + singleton sheet', () => {
  it('stamps the root attribute and appends exactly one sheet carrying the CSS', () => {
    const doc = new StubDocument()

    expect(mountSkin(doc)).toBe(true)

    expect(doc.attributes.get(SKIN_ATTR)).toBe('')
    expect(doc.attached()).toHaveLength(1)
    const sheet = doc.attached()[0]
    expect(sheet.tagName).toBe('style')
    expect(sheet.attributes.has(SKIN_SHEET_ATTR)).toBe(true)
    expect(sheet.textContent).toBe(EXPECTED_CSS)
  })

  it('is a singleton: a second mount keeps exactly one sheet (P2)', () => {
    const doc = new StubDocument()

    expect(mountSkin(doc)).toBe(true)
    expect(mountSkin(doc)).toBe(true)

    expect(doc.sheets).toHaveLength(1)
    expect(doc.attached()).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * the sheet                                                           *
 * ------------------------------------------------------------------ */

describe('skinCss — the whitelisted rules', () => {
  it('is the exact sheet the contract registers (verbatim)', () => {
    expect(skinCss()).toBe(EXPECTED_CSS)
  })

  it('stays inside the whitelist budget: <= 155 lines, twenty-six rules, no layout', () => {
    const css = skinCss()
    const lines = css.split('\n')

    // 95 since 0.1.3 M2b (the per-class step-row colours: two cell rules, four
    // class blocks and the failed-step rule); 75 for the first M2 pass, 60 through
    // 0.1.2. The ceiling is the whitelist's, not the milestone's, so a new block
    // has to buy its lines HERE before it ships.
    expect(lines.length).toBeLessThanOrEqual(SHEET_BUDGET)
    // Twelve blocks: text selection, the selected-item label colour, the selected
    // tab's underline, the step-row name, its arguments, the failed step, the
    // night anchor (light), the night anchor (dark), the light ground, the DARK
    // ground override, the visibility clear, and the M2 bottom-band entry (an
    // image, not a colour). 0.1.5 appends three more (card / context row / light
    // failure red), counted by SHEET_RULES.
    expect(lines.filter((line) => line === 'html body ::selection {')).toHaveLength(1)
    expect(css.match(/\{/g)).toHaveLength(SHEET_RULES)
    expect(css.match(/\}/g)).toHaveLength(SHEET_RULES)
    // Every additive block stays well inside the 12-line entry budget. The two
    // grounds and the visibility clear are blocks of ONE switchable segment, so
    // the budget is measured per block, not per segment.
    const selectedStart = css.indexOf("html[data-moonset-skin] body [aria-selected")
    const underlineStart = css.indexOf("html[data-moonset-skin] body [data-active='true']::after")
    const underlineEnd = css.indexOf('}', underlineStart) + 1
    const anchorStart = css.indexOf('/* 0.1.2 hue anchor (M5)')
    const groundStart = css.indexOf('html[data-moonset-skin] body {')
    const darkStart = css.indexOf('/* 0.1.2 ground (dark)')
    const clearStart = css.indexOf('html[data-moonset-skin] #root :has(')
    const bandStart = css.indexOf('/* 0.1.2 bottom band (M2)')
    // 0.1.4 M1: the material is its own segment (it is the only entry that may
    // write a position, so keeping it in one place is what makes the layout check
    // below decidable); 0.1.5's three colour entries follow it, so the material
    // segment is measured up to THEIR comment.
    const glassStart = css.indexOf('/* 0.1.4 glass')
    const colourStart = css.indexOf('/* 0.1.5 G2/G3/G4')
    // 0.1.3 M2 sits between the selected-item rules and the ground: it is text
    // colouring, not a paint layer, so it rides the 0.1.1 half of the sheet.
    const stepStart = css.indexOf('/* 0.1.3 M2')
    const stepEnd = css.indexOf('}', css.indexOf('~ [data-tone]')) + 1
    expect(selectedStart).toBeGreaterThan(-1)
    expect(underlineStart).toBeGreaterThan(selectedStart)
    expect(stepStart).toBeGreaterThan(underlineEnd)
    expect(anchorStart).toBeGreaterThan(stepEnd)
    expect(groundStart).toBeGreaterThan(anchorStart)
    expect(darkStart).toBeGreaterThan(groundStart)
    expect(clearStart).toBeGreaterThan(darkStart)
    expect(bandStart).toBeGreaterThan(clearStart)
    expect(glassStart).toBeGreaterThan(bandStart)
    expect(colourStart).toBeGreaterThan(glassStart)
    expect(css.slice(selectedStart, underlineStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(underlineStart, underlineEnd).split('\n').length).toBeLessThanOrEqual(12)
    // The step-row entry: two cell rules, four class declaration blocks and the
    // failed-step rule, plus the comment that carries the hook evidence. The
    // per-class pass (M2b) is the reason its own ceiling is 40.
    expect(css.slice(stepStart, stepEnd).split('\n').length).toBeLessThanOrEqual(40)
    expect(css.slice(anchorStart, groundStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(groundStart, darkStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(darkStart, clearStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(clearStart, bandStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(bandStart, glassStart).split('\n').length).toBeLessThanOrEqual(12)
    // The material's two rules: 13 lines, the ceiling the 115 budget bought.
    // Three faces + the float + the banner offset: 49 lines measured (planes + the
    // header edge + the strip + the faces + the float pair + the banner rule; the
    // sidebar face and its scheme-split base left with M6).
    expect(css.slice(glassStart, colourStart).split('\n').length).toBeLessThanOrEqual(60)
    // 0.1.5's segment: three colour entries, 11 lines measured, inside the same
    // 12-line entry budget as every other additive block.
    expect(css.slice(colourStart).split('\n').length).toBeLessThanOrEqual(12)
    // No layout, no structure, no conditional animation: this sheet paints.
    expect(css).not.toMatch(/@media|@supports|!important|animation|transition/)
    // ...with ONE documented exception (0.1.4 M1): the material's ::before needs
    // a positioned host and a full-bleed inset. Everything before that segment
    // is still layout-free, and inside it the exception is ENUMERATED, so it
    // cannot quietly grow a width/margin/overflow.
    expect(css.slice(0, glassStart)).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow)\s*:/)
    // ...and the 0.1.5 segment is colour-only too, back to the strict rule.
    expect(css.slice(colourStart)).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow)\s*:/)
    // Comments are stripped first: the G1 note SPELLS the bug (it quotes `top: H`),
    // and the order list below counts declarations, not prose.
    const material = css.slice(glassStart, colourStart).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(material.match(/\b(?:display|grid|flex|width|height|margin|padding|overflow)\s*:/g) ?? []).toEqual([])
    // Order is the segment's own, declaration by declaration: the planes rule
    // (`position: absolute; inset: 0; z-index: -1`), the faces rule
    // (`position: relative`), then the M4 float (`z-index: 8` on the header, the
    // shifted scroll body's `margin-top`/`padding-top`). Anything else — a
    // width, a display, an overflow — still fails the assertion above.
    expect(material.match(/\b(?:position|inset|z-index|margin-top|padding-top|top)\s*:/g) ?? []).toEqual([
      // the planes rule, then the faces rule, then the float pair, then the banner
      'position:', 'inset:', 'z-index:',
      'position:',
      'z-index:',
      'position:', 'z-index:', 'margin-top:', 'padding-top:',
      'top:',
    ])
    // The float's two lengths are ONE formula: the padding cancels the margin and
    // leaves 12px of breathing, so a wrong measured height can only change how
    // much transcript shows THROUGH the glass — never where the content starts.
    const margin = /margin-top: calc\(-1 \* var\((--dsh-moonset-header-h), (\d+)px\)\)/.exec(material)
    const padding = /padding-top: calc\(var\(--dsh-moonset-header-h, (\d+)px\) \+ 12px\)/.exec(material)
    expect(margin).not.toBeNull()
    expect(padding).not.toBeNull()
    expect(margin![1]).toBe('--dsh-moonset-header-h')
    expect(margin![2]).toBe(padding![1])
  })

  it('takes every colour from a token — except the ONE night anchor (M5)', () => {
    const css = skinCss()

    // Every declaration reads a `--dsw-*` token or the skin's own `--dsh-moonset-`
    // one: the accent at several opacities, the moon anchor for the light glint,
    // the night anchor for the dark composition, and the canvas under both
    // grounds. The night anchor is the single exception, and it is a
    // `var(--dsh-moonset-night)` reference — not a hex — everywhere it is used.
    const tokens = css.match(/var\(--dsw-[a-z0-9-]+\)/g) ?? []
    expect(new Set(tokens)).toEqual(new Set([
      `var(${ACCENT})`,
      `var(${MOON})`,
      `var(${CANVAS})`,
      // 0.1.3 M2: the step-row cell defaults and the failed-step line — the
      // label/state aliases follow the scheme without a literal.
      'var(--dsw-alias-label-secondary)',
      'var(--dsw-alias-state-error-primary)',
      // 0.1.3 M2b: the per-kind hue families, each mixed toward a label token
      // (label-primary is the name's, label-secondary the arguments').
      'var(--dsw-alias-label-primary)',
      'var(--dsw-static-deepseek-400)',
      'var(--dsw-static-green-500)',
      'var(--dsw-static-amber-600)',
      'var(--dsw-static-violet-400)',
      // 0.1.4 M1: the material's edge highlight — the palette's own near-white
      // (#FAFAFC light / #EEF0F7 dark), not the plan's rgba(255,255,255,.10)
      // literal: same pixel, and P5's "no literal colour" rule survives.
      'var(--dsw-static-neutral-bluish-00)',
      // 0.1.4 M3: the header's material edge — the SAME token the host border
      // uses. (M6 dropped the sidebar face, and with it the tinted base that was
      // its only reader.)
      'var(--dsw-alias-border-l3)',
      // 0.1.5 G2: the turn-changes card's new surface and edge. `border-l2` is the
      // rung the host already uses for the multi-file variant.
      'var(--dsw-alias-bg-layer-2)',
      'var(--dsw-alias-border-l2)',
    ]))
    // 0.1.1 rules: accent x4 (selection bg + text, label, underline). Light
    // ground (soft): accent halo + amber glint + accent wash + canvas. Dark
    // ground (night): one canvas. 0.1.3 M2b: the step-row name default is the
    // accent again, each class mixes its family twice (name + arguments) toward
    // label-primary / label-secondary, the arguments default is a label alias,
    // and the failed step is one state alias. 0.1.4 M1: the material adds the
    // canvas under its plane and the near-white on its top edge. 0.1.5 adds two
    // for the card (background + edge), one for the context row's accent
    // fallback, and two for the light-scheme failure mix (error + label ink):
    // 34 -> 40. The night anchor refs are counted separately.
    expect(tokens).toHaveLength(40)
    // The mono face is the theme layer's code stack — the ONE non-`--dsw-`
    // token the sheet reads (a font, not a colour, so P5's colour rule is moot).
    expect(new Set(css.match(/var\(--ds-[a-z0-9-]+\)/g) ?? [])).toEqual(new Set(['var(--ds-font-family-code)']))
    expect(css.match(/var\(--dsh-moonset-night\)/g) ?? []).toHaveLength(4)
    // The anchor is DECLARED in every sheet (it is a custom property, unused by
    // the other hues) and REFERENCED only by a ground whose hue is `night`.
    expect(css).toContain('--dsh-moonset-night: #2563EB;')
    expect(skinCss({ hueDark: 'accent' })).not.toContain('var(--dsh-moonset-night)')
    expect(skinCss({ hueLight: 'night' }).match(/var\(--dsh-moonset-night\)/g) ?? []).toHaveLength(6)
    expect(skinCss({ hueDark: 'night' }).match(/var\(--dsh-moonset-night\)/g) ?? []).toHaveLength(4)
    // THE WHITELIST (M5): the sheet may carry exactly TWO hex literals — the two
    // declarations of the night anchor, one per scheme, and nothing else.
    const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0])
    expect(hexes).toEqual(['#2563EB', '#60A5FA'])
    expect(css).toContain('--dsh-moonset-night: #2563EB;')
    expect(css).toContain('--dsh-moonset-night: #60A5FA;')
    // Nothing opaque beyond those two: no rgb()/hsl() literal anywhere.
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/)
  })

  it('draws its accent from the palette (accent anchor, same in both schemes)', () => {
    const accentToken = skinCss().includes(`var(${ACCENT})`)
    expect(accentToken).toBe(true)
    // The token IS the board's accent in each scheme: no second colour source.
    expect(MOONSET_LIGHT[ACCENT]).toBe(board.light.accent.toUpperCase())
    expect(MOONSET_DARK[ACCENT]).toBe(board.dark.accent.toUpperCase())
  })

  it('pairs with the token half: every selected/active seat is an accent wash', () => {
    // The skin is the exception for what tokens cannot do; the selected seats
    // are TOKEN deltas (generator TOKEN_OVERRIDES), so the two never overlap.
    // The first real-machine pass fixed only the settings sidebar; these are
    // the seats it missed (14 + 7 + 2 + 2 hits + the outline).
    const seats = [
      '--dsw-alias-interactive-bg-hover',
      '--dsw-alias-interactive-bg-active',
      '--dsw-alias-bg-module-platform',
      '--dsw-alias-button-ghost-active-fill',
      '--dsw-alias-border-selected',
      '--dsw-specific-sidebar-nav-item-active',
      '--dsw-specific-sidebar-nav-item-active-accent',
    ]
    expect(MOONSET_TOKEN_OVERRIDES).toHaveLength(seats.length)
    for (const token of seats) {
      expect(MOONSET_TOKEN_OVERRIDES).toContain(token)
      for (const table of [MOONSET_LIGHT, MOONSET_DARK]) {
        expect(table[token], token).toContain(`var(${ACCENT})`)
      }
    }
    const active = '--dsw-specific-sidebar-nav-item-active'
    expect(MOONSET_LIGHT[active]).toContain('10%')
    expect(MOONSET_LIGHT[active]).toContain('--dsw-alias-bg-base')
    expect(MOONSET_LIGHT['--dsw-specific-sidebar-nav-item-active-accent']).toBe(`var(${ACCENT})`)
  })
  it('keeps the selected TEXT readable on the selection wash (AA >= 4.5:1)', () => {
    const css = skinCss()
    // Read the shipped rule instead of restating it: a changed alpha or a
    // changed text token has to be re-measured, not just re-formatted.
    const wash = /var\((--dsw-[a-z0-9-]+)\) (\d+)%, transparent/.exec(css)
    const text = /^\s*color: var\((--dsw-[a-z0-9-]+)\);/m.exec(css)
    expect(wash, 'selection background must be an accent wash').not.toBeNull()
    expect(text, 'selection text must be a token').not.toBeNull()
    const alpha = Number(wash![2]) / 100
    const ratios: Record<string, number> = {}
    for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
      const accent = rgbOf(resolveToken(table, wash![1]))
      const textColour = rgbOf(resolveToken(table, text![1]))
      const canvas = rgbOf(resolveToken(table, '--dsw-alias-bg-base'))
      const painted = over({ ...accent, a: alpha }, canvas)
      ratios[scheme] = contrastRatio(textColour, painted)
      // Measured: light 5.25:1, dark 4.55:1 at the shipped 22%.
      expect(
        ratios[scheme],
        scheme + ' selection text on the wash = ' + ratios[scheme].toFixed(2) + ':1',
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('mirrors the documentation-site pair: a 22% accent wash + accent text', () => {
    // selection:bg-indigo-500/20 selection:text-indigo-700 — one accent at two
    // opacities, not an ink label on a violet wash (the first real-machine pass
    // and its 'grey-violet' verdict).
    const css = skinCss()
    const wash = /var\((--dsw-[a-z0-9-]+)\) (\d+)%, transparent/.exec(css)
    const text = /^\s*color: var\((--dsw-[a-z0-9-]+)\);/m.exec(css)
    if (wash === null || text === null) throw new Error('unexpected sheet: ' + css)
    expect(wash[1]).toBe(ACCENT)
    expect(text[1]).toBe(ACCENT)
    // A wash, not a surface: the alpha stays in the documentation-site band.
    const alpha = Number(wash[2])
    expect(alpha).toBeGreaterThanOrEqual(18)
    expect(alpha).toBeLessThanOrEqual(24)
  })
  it('paints the selected-item LABEL with the accent, on stable attributes only', () => {
    const css = skinCss()
    // The five hook attributes the real UI actually renders (verified against
    // the installed sources: workspace rows aria-selected, SettingsRoot
    // aria-current='true', main sidebar aria-current='page', plugin tabs
    // aria-selected + data-active, automation filter chips aria-pressed).
    // Root-gated (P2), which is also what beats the host's own selected-tab
    // colour rule.
    const colourStart = css.indexOf("html[data-moonset-skin] body [aria-selected")
    const colourBlock = css.slice(colourStart, css.indexOf('}', colourStart) + 1)
    const selectors = [...colourBlock.matchAll(/html\[data-moonset-skin\] body \[[^\]]+\]/g)].map((m) => m[0])
    expect(selectors).toEqual([
      "html[data-moonset-skin] body [aria-selected='true']",
      "html[data-moonset-skin] body [aria-current='page']",
      "html[data-moonset-skin] body [aria-current='true']",
      "html[data-moonset-skin] body [data-active='true']",
      "html[data-moonset-skin] body [aria-pressed='true']",
    ])
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // No class-name hacks, no !important, and exactly TWO universal selectors —
    // both are 0.1.3 M2's `[data-shimmer-decoration] + *`, i.e. "the cell
    // right after the separator dot" (the idle rule, and the failed-step rule that
    // reuses the same cell). That is a single-sibling position inside a step row,
    // not a subtree sweep — every other selector stays attribute-anchored. Only
    // selector text (everything outside a declaration block) is checked.
    const selectorText = rules.replace(/\{[^}]*\}/g, '')
    expect(selectorText).not.toMatch(/\[class|\*=/)
    expect(selectorText.match(/\*/g) ?? []).toHaveLength(2)
    expect(selectorText).toContain('[data-shimmer-decoration] + *')
    expect(rules).not.toContain('!important')
    // The rule colours the container and lets the label inherit; muted
    // children (timestamps, summaries) set their own colour and keep it.
    expect(colourBlock).toContain(`color: var(${ACCENT});`)
  })

  it('keeps the selected-item LABEL readable on the selected-row wash (AA >= 4.5:1)', () => {
    // The wash is the token this milestone overrides; the label is the accent,
    // and the pair has to clear AA on both schemes (measured 6.45 / 5.58).
    for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
      const wash = colourOf(table, table['--dsw-alias-interactive-bg-hover'])
      const canvas = colourOf(table, table['--dsw-alias-bg-base'])
      const painted = over(wash, canvas)
      const label = colourOf(table, table[ACCENT])
      const ratio = contrastRatio(label, painted)
      expect(
        ratio,
        scheme + ' selected label on the row wash = ' + ratio.toFixed(2) + ':1',
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('covers pressed chips and the selected-tab underline, both root-gated', () => {
    const css = skinCss()
    // Pressed chip (automation filter tabs): the SAME root-gated colour block,
    // so "pressed" is one more "selected" spelling. Accepted trade-off:
    // pressed like/dislike buttons take the accent too, which is the intent.
    const colourStart = css.indexOf("html[data-moonset-skin] body [aria-selected")
    const colourBlock = css.slice(colourStart, css.indexOf('}', colourStart) + 1)
    expect(colourBlock).toContain("html[data-moonset-skin] body [aria-pressed='true']")
    expect(colourBlock).toContain(`color: var(${ACCENT});`)

    // The selected tab's underline: the host draws it as a 2px ink bar
    // (.tab[data-active='true']::after), so it follows the label colour.
    // Audited: only the plugins tab renders an ::after on a data-active element
    // (the retry arrow is summary::after; badge/feedback buttons have none), so
    // the selector does not need narrowing to [role='tab'].
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules.match(/::after/g)).toHaveLength(1)
    const underline = /html\[data-moonset-skin\] body \[data-active='true'\]::after \{([\s\S]*?)\}/.exec(rules)
    expect(underline).not.toBeNull()
    expect(underline![1]).toContain(`background: var(${ACCENT});`)
  })

  it('the underline rule paints only the bar, never its size or position', () => {
    const underline = /html\[data-moonset-skin\] body \[data-active='true'\]::after \{([\s\S]*?)\}/.exec(skinCss())
    if (underline === null) throw new Error('missing the selected-tab underline rule')
    const declarations = underline[1].split(';').map((entry) => entry.trim()).filter(Boolean)
    // Ours is the colour only; the bar's 2px size and placement stay host-owned
    // (11.4: the sheet may not change layout).
    expect(declarations).toEqual([`background: var(${ACCENT})`])
  })
})

/* ------------------------------------------------------------------ *
 * the 0.1.2 ground                                                    *
 * ------------------------------------------------------------------ */

describe('skinCss — the 0.1.2 ground (wash + two fixed spots)', () => {
  /** The ground block: the only root-gated `body { … }` rule in the sheet. */
  const GROUND_RULE = /html\[data-moonset-skin\] body \{\n([\s\S]*?)\n\}/

  it('paints the ground from tokens only, root-gated, alpha as a literal percentage', () => {
    // The LIGHT rule with its numbers pinned by explicit options (M6 defaults are
    // soft @ 90, which would make this a test of the default rather than of the
    // shape).
    const css = skinCss({ hueLight: 'accent', strengthLight: 100 })
    // Exactly one ground block, and it is the root-gated body rule (P2's gate).
    expect(css.match(/html\[data-moonset-skin\] body \{/g)).toHaveLength(1)
    const block = GROUND_RULE.exec(css)
    expect(block).not.toBeNull()
    const declarations = block![1]

    // Three layers, top-first: the two spots above the wash.
    expect(declarations.match(/(?:radial|linear)-gradient\(/g)).toEqual([
      'radial-gradient(',
      'radial-gradient(',
      'linear-gradient(',
    ])
    // The canvas token rides the LAST layer: a background shorthand resets
    // background-color, so the base has to be in the same declaration.
    expect(declarations).toContain('var(--dsw-alias-bg-base)')

    // Colours are tokens mixed with transparent — and M2's strength lands as a
    // LITERAL percentage computed in JS. No literal colour, no `calc()`, no
    // intermediate custom property (a property hop is what breaks the knob — D2).
    expect(declarations).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(declarations).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    expect(declarations).not.toMatch(/--[a-z0-9-]+\s*:/)
    expect(declarations).not.toContain('dsh-moonset-glow-strength')
    const mixes = [
      ...declarations.matchAll(
        /color-mix\(in srgb, var\((--dsw-static-[a-z0-9-]+)\) ([\d.]+)%, transparent\)/g,
      ),
    ]
    // M3 rebalance, second pass: indigo 16% : amber 3% (≈5.3:1). The amber was
    // 10%, then 6%, and the user still read it as the subject ("即使 6% 也压过
    // 靛蓝") — a warm hue at equal alpha is brighter on a near-white canvas.
    expect(mixes.map((match) => [match[1], Number(match[2])])).toEqual([
      [ACCENT, 16],
      [MOON, 3],
      [ACCENT, 1.5],
    ])
    // ...and the three alphas are exactly the light 100% row from skin.ts.
    expect(mixes.map((match) => Number(match[2]))).toEqual([
      GLOW_ALPHA_AT_FULL.light.moon,
      GLOW_ALPHA_AT_FULL.light.warm,
      GLOW_ALPHA_AT_FULL.light.wash,
    ])
    // The GROUND rule carries no calc() — its alphas are literal percentages
    // resolved in JS. (The 0.1.4 float rule does use calc(); that is asserted
    // on its own in the material block below.)
    expect(declarations).not.toContain('calc(')
  })

  it('carries BOTH spots: indigo moon halo top-centre, amber warm light bottom-right', () => {
    // The LIGHT block only: the dark override is its own composition (asserted
    // separately below), and mixing the two would count four radials.
    const css = skinCss({ hueLight: 'accent', strengthLight: 100 })
    const light = css.slice(css.indexOf('html[data-moonset-skin] body {'), css.indexOf('/* 0.1.2 ground (dark)'))
    const spots = [
      ...light.matchAll(
        /radial-gradient\(ellipse at (\d+)% (-?\d+)%, color-mix\(in srgb, var\((--dsw-static-[a-z0-9-]+)\) ([\d.]+)%, transparent\) 0%, transparent (\d+)%\)/g,
      ),
    ]
    expect(spots).toHaveLength(2)
    const spot = (match: RegExpMatchArray): Record<string, unknown> => ({
      x: Number(match[1]),
      y: Number(match[2]),
      token: match[3],
      alpha: Number(match[4]),
      fade: Number(match[5]),
    })
    // Top-centre (-10% pulls the halo off the top edge) and the M3 corner: the
    // warm light sits at 97%/97% and closes at 46%, so it is a glint in one
    // corner of the canvas rather than a wash across the lower half.
    expect(spot(spots[0])).toEqual({ x: 50, y: -10, token: ACCENT, alpha: 16, fade: 62 })
    expect(spot(spots[1])).toEqual({ x: 97, y: 97, token: MOON, alpha: 3, fade: 46 })
    // Both hues are the board's own anchors in each scheme: no second colour
    // source, and the warm light is exactly the palette's `moon` role.
    expect(MOONSET_LIGHT[MOON]).toBe(board.light.moon.toUpperCase())
    expect(MOONSET_DARK[MOON]).toBe(board.dark.moon.toUpperCase())
    expect(MOONSET_LIGHT[ACCENT]).toBe(board.light.accent.toUpperCase())
    expect(MOONSET_DARK[ACCENT]).toBe(board.dark.accent.toUpperCase())
  })

  it('gives the DARK scheme its own ground: ONE hue, three footprints', () => {
    // Explicit `accent` for the dark ground: the default is `night`, whose shape
    // is asserted in the M6 describe.
    const css = skinCss({ hueDark: 'accent', strengthDark: 100 })
    // A second ground rule, gated on our root attribute AND the host's own dark
    // marker (`body[data-ds-dark-theme]`, the official design-platform switch),
    // so it only applies to the dark scheme and outranks the light rule there.
    // The marker now appears in TWO rules (this one and the night anchor above),
    // so the slice starts from the ground comment.
    const groundAt = css.indexOf('/* 0.1.2 ground (dark)')
    const start = css.indexOf('html[data-moonset-skin] body[data-ds-dark-theme] {', groundAt)
    expect(start).toBeGreaterThan(groundAt)
    const end = css.indexOf('}', start) + 1
    const dark = css.slice(start, end)
    // Four layers, top-first: the tight core, the wide halo under it, the
    // bottom reflection, and the wash.
    expect(dark.match(/(?:radial|linear)-gradient\(/g)).toEqual([
      'radial-gradient(',
      'radial-gradient(',
      'radial-gradient(',
      'linear-gradient(',
    ])
    // ONE hue: every coloured layer is `deepseek-400`. The user removed the
    // violet pass ("不要紫罗兰那层"), so a second token here is a regression —
    // this is the assertion that keeps the dark ground monochrome.
    const tokens = new Set([...dark.matchAll(/var\((--dsw-[a-z0-9-]+)\)/g)].map((match) => match[1]))
    expect(tokens).toEqual(new Set(['--dsw-static-deepseek-400', '--dsw-alias-bg-base']))
    expect(dark).not.toContain('amber')
    expect(dark).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(dark).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    // The composition: a small tight CORE left of centre at the top edge, the
    // wide soft HALO under it, a weak REFLECTION off the bottom, thinner wash.
    expect(dark).toContain('circle at 34% 2%, color-mix(in srgb, var(--dsw-static-deepseek-400) 12%, transparent) 0%, transparent 26%')
    expect(dark).toContain('ellipse at 50% -6%, color-mix(in srgb, var(--dsw-static-deepseek-400) 20%, transparent) 0%, transparent 70%')
    expect(dark).toContain('ellipse at 50% 104%, color-mix(in srgb, var(--dsw-static-deepseek-400) 4%, transparent) 0%, transparent 55%')
    expect(dark).toContain('linear-gradient(160deg, color-mix(in srgb, var(--dsw-static-deepseek-400) 1%, transparent) 0%, transparent 75%)')
    // Both schemes ride the same switch: with the material off too, the sheet is
    // the 0.1.1 one. 0.1.5's light-only gate spells the SAME attribute inside a
    // `:not()`, so the assertion names the DARK rule, not the bare token.
    const bothOff = skinCss({ glow: false, glass: false })
    expect(bothOff).not.toContain('body[data-ds-dark-theme] {')
    expect(bothOff).toContain('body:not([data-ds-dark-theme])')
    // ...and the same strength factor (the dark rows scale too).
    expect(skinCss({ hueDark: 'accent', strengthDark: 200 })).toContain('var(--dsw-static-deepseek-400) 40%, transparent')
  })

  it('keeps indigo in charge: the amber never approaches the light hue', () => {
    // The M3 contract, carried into M6's per-scheme hues: whatever the hue and
    // the strength, the amber glint is a fraction of the hue layer. `accent` /
    // `night` are 16:3 (≈5.3:1); `soft` halves only the hue side, so its floor is
    // ≈3:1 — still the glint, never the subject (the user's 橙黄喧宾夺主 report).
    for (const hue of GLOW_HUES) {
      const floor = hue === 'soft' ? 2.5 : 5
      for (const strength of [GLOW_STRENGTH_MIN, 50, 100, 150, GLOW_STRENGTH_MAX]) {
        const alphas = glowAlphas(strength, hue)
        const moon = Number(alphas.moon.replace('%', ''))
        const warm = Number(alphas.warm.replace('%', ''))
        if (moon === 0) {
          expect(warm).toBe(0)
          continue
        }
        expect(moon / warm).toBeGreaterThanOrEqual(floor)
      }
    }
    // ...and the geometry says the same thing: the amber ellipse dies at 46%
    // while the moon halo runs to 62%, so it cannot reach the middle of the
    // canvas even at full strength.
    const css = skinCss()
    const light = css.slice(css.indexOf('html[data-moonset-skin] body {'), css.indexOf('/* 0.1.2 ground (dark)'))
    const fades = [...light.matchAll(/0%, transparent (\d+)%\)/g)].map((match) => Number(match[1]))
    expect(fades).toEqual([62, 46, 70])
  })

  it('keeps the DARK composition monochrome at EVERY hue: one colour, three footprints', () => {
    // The violet layer was removed on the user's second pass ("不要紫罗兰那层"),
    // and M6's hue switch must not reintroduce a second colour: whatever the
    // user picks, the dark ground reads exactly ONE coloured token plus the
    // canvas, and the amber never appears in it.
    for (const hue of GLOW_HUES) {
      const dark = darkGroundRule(skinCss({ hueDark: hue }))
      // `--dsh-moonset-*` counts too: the `night` hue's token is the skin anchor.
      const tokens = new Set([...dark.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]))
      expect(tokens.size, hue).toBe(2)
      expect(tokens).toContain('--dsw-alias-bg-base')
      expect(dark).not.toContain('amber')
      // Core brighter than halo, halo wider than core: that is the layering.
      expect(Number(darkGlowAlphas(100, hue).core.replace('%', '')))
        .toBeLessThan(Number(darkGlowAlphas(100, hue).moon.replace('%', '')))
      expect(dark).toContain('circle at 34% 2%')
      expect(dark).toContain('ellipse at 50% -6%')
      expect(dark).toContain('ellipse at 50% 104%')
    }
  })

  it('drops BOTH grounds — light and dark — when the switch is off', () => {
    // The switch is not a strength: `glow: false` must leave no dark rule, no
    // layer and no scope behind, at any strength (0.1.2 D4's pre-glow screen).
    // 0.1.4: the MATERIAL is its own switch (GLASS_ATTR), so "pre-glow" is the
    // base half plus the material segment — the pre-GLASS sheet needs BOTH off.
    for (const strength of [GLOW_STRENGTH_MIN, 100, GLOW_STRENGTH_MAX]) {
      const off = skinCss({ glow: false, strengthLight: strength, strengthDark: strength })
      expect(off).toBe(EXPECTED_BASE_CSS + '\n' + EXPECTED_GLASS_CSS + '\n' + EXPECTED_COLOUR_CSS)
      expect(skinCss({ glow: false, glass: false, strengthLight: strength, strengthDark: strength }))
        .toBe(EXPECTED_BASE_CSS + '\n' + EXPECTED_COLOUR_CSS)
      // The dark marker survives in the MATERIAL segment (the dark-only sidebar
      // base); what must be gone is the ground's dark rule.
      expect(off).not.toContain('--dsh-moonset-night')
      expect(off).not.toContain('radial-gradient')
      expect(off).not.toContain('linear-gradient')
    }
  })

  it('keeps the wash inside the <= 2/255 horizontal band at 1920x1080', () => {
    const css = skinCss({ hueLight: 'accent', strengthLight: 100 })
    // A 165deg CSS gradient spans L = W·|sin θ| + H·|cos θ|; moving horizontally
    // by dx shifts the gradient position by dx·|sin θ| / L. The wash starts at
    // `alpha` and dies at `fade`, so left vs right edge differ by
    // alpha · (W·sin θ / L) / fade. The colour deltas are the palette's own.
    const wash =
      /linear-gradient\(165deg, color-mix\(in srgb, var\((--dsw-[a-z0-9-]+)\) ([\d.]+)%, transparent\) 0%, transparent (\d+)%\)/.exec(
        css,
      )
    expect(wash).not.toBeNull()
    const alpha = Number(wash![2]) / 100
    const fade = Number(wash![3]) / 100
    const width = 1920
    const height = 1080
    const angle = (165 * Math.PI) / 180
    const horizontal = width * Math.abs(Math.sin(angle))
    const span = horizontal + height * Math.abs(Math.cos(angle))
    const positionShift = horizontal / span
    for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
      const glow = rgbOf(resolveToken(table, wash![1]))
      const canvas = rgbOf(resolveToken(table, CANVAS))
      const deltaAlpha = (alpha * positionShift) / fade
      const delta =
        Math.max(
          Math.abs(glow.r - canvas.r),
          Math.abs(glow.g - canvas.g),
          Math.abs(glow.b - canvas.b),
        ) * deltaAlpha
      expect(
        delta,
        scheme + ' wash left/right spread = ' + delta.toFixed(2) + '/255',
      ).toBeLessThanOrEqual(2)
    }
  })

  it('stays ONE root-gated sheet inside the 60-line budget (P2)', () => {
    const css = skinCss()
    const lines = css.split('\n')
    // 75 since 0.1.3 M2 (SHEET_BUDGET); the dark scheme is its own four-layer
    // composition on top of the 0.1.1 half.
    expect(lines.length).toBeLessThanOrEqual(SHEET_BUDGET)
    // 0.1.1's 19 lines + the light and dark ground segments.
    expect(lines.length).toBeGreaterThan(19)
    // Mounting still yields exactly ONE <style>, carrying exactly this CSS.
    const doc = new StubDocument()
    mountSkin(doc)
    expect(doc.attached()).toHaveLength(1)
    expect(doc.attached()[0].textContent).toBe(css)
    // The ground is behind the root attribute, never a bare `body` rule.
    expect(css).toMatch(/^html\[data-moonset-skin\] body \{$/m)
    expect(css).not.toMatch(/^body \{$/m)
  })

  it('drops the WHOLE ground rule when the M2 switch is off (never alpha 0)', () => {
    // Off means the rule does not exist: alpha 0 would still composite
    // (0.1.2 §一), and D4's bar is a pre-glow screenshot. 0.1.4: the material
    // segment survives (its own switch), so the pre-GLOW sheet is base+material
    // and only "both off" returns the 0.1.1/0.1.3 sheet byte-for-byte.
    const off = skinCss({ glow: false })
    expect(off).toBe(EXPECTED_BASE_CSS + '\n' + EXPECTED_GLASS_CSS + '\n' + EXPECTED_COLOUR_CSS)
    expect(skinCss({ glow: false, glass: false })).toBe(EXPECTED_BASE_CSS + '\n' + EXPECTED_COLOUR_CSS)
    expect(off).not.toContain('radial-gradient')
    expect(off).not.toContain('linear-gradient')
    expect(off).not.toMatch(/html\[data-moonset-skin\] body \{/)
    // On is the default and is still the full contract sheet.
    expect(skinCss({ glow: true })).toBe(EXPECTED_CSS)
  })
})

/* ------------------------------------------------------------------ *
 * the 0.1.2 visibility (the layers in FRONT of the ground)            *
 * ------------------------------------------------------------------ */

describe('skinCss — the 0.1.2 visibility (host layers cleared to the panel root)', () => {
  /**
   * The visibility block, read the way the engine reads it: from the first
   * `#root` selector to its closing brace.
   */
  function clearRule(scope: GlowScope = 'all'): { selectors: string[]; declarations: string[]; raw: string } {
    const css = skinCss({ scope })
    const start = css.indexOf('html[data-moonset-skin] #root :has(')
    if (start === -1) throw new Error('the sheet carries no visibility block:\n' + css)
    const open = css.indexOf('{', start)
    const close = css.indexOf('}', open)
    const raw = css.slice(start, close + 1)
    const declarations = raw
      .slice(raw.indexOf('{') + 1, -1)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
    // Split the selector list on TOP-LEVEL commas only: a :has(a, b) argument
    // list carries commas of its own and must stay one selector.
    const selectors: string[] = []
    let depth = 0
    let current = ''
    for (const character of raw.slice(0, raw.indexOf('{'))) {
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      if (character === ',' && depth === 0) {
        if (current.trim() !== '') selectors.push(current.trim())
        current = ''
        continue
      }
      current += character
    }
    if (current.trim() !== '') selectors.push(current.trim())
    return { selectors, declarations, raw }
  }

  it('clears EXACTLY the shell chain above the main slot and the panel root, root-gated', () => {
    const { selectors } = clearRule()
    // Verbatim: every shell container that CONTAINS the main slot (the
    // display:contents root anchor, .frame, .centerCol, .mainPanel), every
    // container of the conversation's composer seat (which reaches .root even if
    // the panel entry gains a wrapper), and the elected panel root itself.
    // No host class name (every one is hashed per build), no wildcard, no
    // attribute-substring hack.
    expect(selectors).toEqual([
      "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])",
      "html[data-moonset-skin] #root :has([data-composer-seat])",
      "html[data-moonset-skin] #root :has(> [data-slot='shell.bottom'])",
      "html[data-moonset-skin] #root [data-slot='main'] > div",
      "html[data-moonset-skin] #root [data-slot='sidebar'] > div",
    ])
    // P2: the root attribute gates every selector, so an orphaned sheet is inert.
    for (const selector of selectors) expect(selector.startsWith('html[data-moonset-skin] ')).toBe(true)
    // Only structure (#root) and the renderer's documented seam (data-slot); no
    // class name, no !important. The gate is also what wins: (1,2,1) / (1,3,1)
    // against the host's own .frame / .centerCol / .root (0,1,0), and (0,2,0)
    // for [data-windows-titlebar] .centerCol.
    // No class name may appear. Quoted attribute values are stripped first:
    // `[data-slot='shell.bottom']` legitimately contains a dot.
    expect(selectors.join(' ').replace(/'[^']*'/g, "''")).not.toContain('.')
    expect(skinCss()).not.toContain('!important')
  })

  it('addresses the carriers by CONTAINMENT, so a shell-depth change cannot blind it', () => {
    const { selectors } = clearRule()
    // The audited chain, from the INSTALLED 0.2.2-rc.5 bundles:
    //   body > #root                      (the shell's React container)
    //        > div[data-slot='root']      display:contents — RootOutlet's anchor
    //        > div.frame > div.centerCol  the two layers that paint bg-base
    //        > div.mainPanel              no background
    //        > div[data-slot='main']      display:contents — SlotOutlet's anchor
    //        > div.root                   background: bg-base — the conversation
    // The anchors are emitted by the RENDERER (`dsh-client-ui-renderer`, which
    // renders {"data-slot": slotKey} / {"data-slot": 'root'} with
    // ANCHOR_STYLE = {display:'contents'}), NOT by ui-layout — that package only
    // calls renderSlot('main', …), so a `data-slot` grep there finds nothing and
    // proves nothing. Both anchors are display:contents, so their number is a
    // renderer detail: a selector counting child combinators goes blind on the
    // first wrapper change, which is exactly the invisible-ground failure this
    // milestone fixes. Containment cannot drift that way.
    const hops = (selector: string): number => selector.split('>').length - 1
    // The carrier set, by containment: everything that CONTAINS one of the three
    // shell slots (root anchor, frame, the three columns, the panel), everything
    // that contains the conversation's composer seat (the conversation root and
    // its containers), and the frame's slot-holding bottom cell.
    expect(hops(selectors[0])).toBe(0)
    expect(selectors[0]).toContain("[data-slot='sidebar']")
    expect(selectors[0]).toContain("[data-slot='rightbar']")
    // The second anchor is INSIDE the conversation (`data-composer-seat` is
    // rendered by ui-conversation on the composer seat), so its ancestor set
    // reaches `.root` without assuming where `.root` sits relative to the main
    // anchor. A descendant can never contain its own ancestor, so no card,
    // message body, code block or field can match any of the :has() selectors.
    expect(hops(selectors[1])).toBe(0)
    expect(selectors[1].endsWith(':has([data-composer-seat])')).toBe(true)
    // The bottom cell paints bg-base too; its slot anchor is its DIRECT child.
    expect(selectors[2]).toBe("html[data-moonset-skin] #root :has(> [data-slot='shell.bottom'])")
    // Two carrier roots are the anchors' DIRECT children: one hop, nothing deeper.
    expect(hops(selectors[3])).toBe(1)
    expect(selectors[3].endsWith('> div')).toBe(true)
    expect(selectors[3]).toContain("[data-slot='main']")
    expect(hops(selectors[4])).toBe(1)
    expect(selectors[4].endsWith('> div')).toBe(true)
    expect(selectors[4]).toContain("[data-slot='sidebar']")
  })

  it('clears the COLOUR only, and rides the same switch as the ground', () => {
    const { declarations, raw } = clearRule()
    // One declaration, the LONGHAND: a background shorthand would wipe every
    // other layer the host put on the same element (an image, a shadow), and a
    // layout property here would be the §11.4 regression.
    expect(declarations).toEqual(['background-color: transparent'])
    expect(raw).not.toMatch(/^\s*background:/m)
    expect(declarations.some((declaration) => /^(?:display|position|grid|flex|width|height|margin|padding|overflow)/.test(declaration))).toBe(false)
    // Off means the whole segment disappears — the clear must not outlive the
    // ground it exists to reveal (0.1.1 parity, D4).
    const off = skinCss({ glow: false })
    expect(off).not.toContain('background-color: transparent')
    // The ground's carrier selectors are gone. (`#root` itself still appears in
    // the 0.1.4 material segment — its two extra faces hang off slot anchors —
    // which is why this checks the visibility spelling, not the substring.)
    expect(off).not.toContain("#root :has([data-slot='main']")
    // 0.1.4: the material is a different switch; with it off as well this is
    // the pre-glow sheet byte-for-byte.
    expect(off).toBe(EXPECTED_BASE_CSS + '\n' + EXPECTED_GLASS_CSS + '\n' + EXPECTED_COLOUR_CSS)
    expect(skinCss({ glow: false, glass: false })).toBe(EXPECTED_BASE_CSS + '\n' + EXPECTED_COLOUR_CSS)
  })
})

/* ------------------------------------------------------------------ *
 * M2 地面范围 (A/B/C)                                                 *
 * ------------------------------------------------------------------ */

describe('skinCss — M2 地面范围 (A/B/C)', () => {
  /**
   * The sheet without its comments.
   *
   * The rule text mentions `calc()` in prose (it explains why there is none),
   * so a whole-sheet search has to look at declarations only.
   * @param css - the sheet text.
   * @returns the same text with every comment removed.
   */
  function withoutComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '')
  }

  /** The visibility block of one scope, parsed the way the engine reads it. */
  function visibilityOf(scope: GlowScope): { selectors: string[] } {
    const css = skinCss({ scope })
    const start = css.indexOf('/* 0.1.2 visibility')
    const open = css.indexOf('{', start)
    const close = css.indexOf('}', open)
    const raw = css.slice(start, close + 1)
    const selectorText = raw.slice(raw.indexOf('*/') + 2, raw.indexOf('{'))
    // Top-level commas only: a :has(a, b) argument list carries its own.
    const selectors: string[] = []
    let depth = 0
    let current = ''
    for (const character of selectorText) {
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      if (character === ',' && depth === 0) {
        if (current.trim() !== '') selectors.push(current.trim())
        current = ''
        continue
      }
      current += character
    }
    if (current.trim() !== '') selectors.push(current.trim())
    return { selectors }
  }

  it('nests the three scopes: conversation ⊂ main ⊂ all', () => {
    const conversation = visibilityOf('conversation').selectors
    const main = visibilityOf('main').selectors
    const all = visibilityOf('all').selectors
    // A: the conversation column only — its own anchor plus the elected panel
    // root. No shell, no sidebar, no bottom cell.
    expect(conversation).toEqual([
      "html[data-moonset-skin] #root :has([data-composer-seat])",
      "html[data-moonset-skin] #root [data-slot='main'] > div",
    ])
    // B: A plus the carriers that CONTAIN the three shell slots — and NOT the
    // sidebar's inner fill layer, so the sidebar keeps its own surface.
    expect(main).toEqual([
      "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])",
      "html[data-moonset-skin] #root :has([data-composer-seat])",
      "html[data-moonset-skin] #root [data-slot='main'] > div",
    ])
    // C: B plus the sidebar root and the bottom cell.
    expect(all).toEqual([
      "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])",
      "html[data-moonset-skin] #root :has([data-composer-seat])",
      "html[data-moonset-skin] #root :has(> [data-slot='shell.bottom'])",
      "html[data-moonset-skin] #root [data-slot='main'] > div",
      "html[data-moonset-skin] #root [data-slot='sidebar'] > div",
    ])
    // The nesting the buttons promise: every A selector is in B, every B in C.
    for (const selector of conversation) expect(main).toContain(selector)
    for (const selector of main) expect(all).toContain(selector)
    // And each sheet NAMES its scope, so a DevTools copy is self-describing.
    for (const scope of GLOW_SCOPES) expect(skinCss({ scope })).toContain('scope: ' + scope + ')')
  })

  it('keeps every sheet inside the 60-line budget, for every scope', () => {
    for (const scope of GLOW_SCOPES) {
      const lines = skinCss({ scope }).split('\n')
      expect(lines.length).toBeLessThanOrEqual(SHEET_BUDGET)
      expect(lines.length).toBeGreaterThan(19)
      // No calc() in the GROUND/VISIBILITY half (the alpha arithmetic is JS); the
      // material's float rule is the one legitimate calc(), and it is not part of
      // the scope switch.
      const sheetForScope = skinCss({ scope })
      const head = sheetForScope.slice(0, sheetForScope.indexOf('/* 0.1.4 glass'))
      expect(withoutComments(head)).not.toContain('calc(')
    }
    // The default sheet is B — the user's verdict after comparing A/B/C.
    expect(skinCss()).toBe(skinCss({ scope: 'main' }))
    expect(DEFAULT_GLOW_SCOPE).toBe('main')
    expect(visibilityOf('main').selectors).toHaveLength(3)
  })

  it('clears the composer seat mask band by its IMAGE only', () => {
    // `[data-composer-seat]` is the element the conversation paints its seat on;
    // in the active phase it carries a bg-base mask gradient, which over the
    // ground reads as a bright band across the bottom of the column. The fix is
    // the NARROWEST one available: the image goes, the element keeps everything
    // else (its colour is already transparent, and nothing moves).
    const css = skinCss()
    const start = css.indexOf('/* 0.1.2 bottom band (M2)')
    expect(start).toBeGreaterThan(-1)
    const end = css.indexOf('}', start) + 1
    const rule = css.slice(start, end)
    expect(rule).toContain("html[data-moonset-skin] #root [data-composer-seat] {")
    const declarations = rule.slice(rule.indexOf('{') + 1, -1).split(';').map((part) => part.trim()).filter(Boolean)
    expect(declarations).toEqual(['background-image: none'])
    expect(rule).not.toContain('background-color')
    // The band belongs to the glow segment, so the switch takes it with it.
    expect(skinCss({ glow: false })).not.toContain('bottom band')
    for (const scope of GLOW_SCOPES) expect(skinCss({ scope })).toContain('bottom band (M2)')
  })

  it('rebuilds the ONE sheet in place when the options move (updateSkin)', () => {
    const doc = new StubDocument()
    mountSkin(doc)
    expect(doc.attached()).toHaveLength(1)
    const before = doc.attached()[0].textContent
    expect(updateSkin({ scope: 'conversation', strengthLight: 50, hueLight: 'accent' }, doc)).toBe(true)
    // Still a singleton, and the rule text moved to the new options.
    expect(doc.attached()).toHaveLength(1)
    const after = doc.attached()[0].textContent
    expect(after).not.toBe(before)
    expect(after).toBe(skinCss({ scope: 'conversation', strengthLight: 50, hueLight: 'accent' }))
    expect(after).toContain('scope: conversation)')
    expect(after).toContain('8%, transparent')
    // A document with no sheet yet is mounted by the same call (convergence).
    const fresh = new StubDocument()
    expect(updateSkin({ scope: 'all' }, fresh)).toBe(true)
    expect(fresh.attached()).toHaveLength(1)
    expect(fresh.attached()[0].textContent).toBe(skinCss({ scope: 'all' }))
  })
})

/* ------------------------------------------------------------------ *
 * M6: 深/浅两套光晕（色相 × 强度）                                     *
 * ------------------------------------------------------------------ */

describe('skinCss — M6 深/浅两套光晕', () => {
  it('ships the final defaults: light 柔和 @90, dark 夜空蓝 @100', () => {
    // The point of the split: the user's best form differs per scheme, so the
    // defaults do too, and `skinCss()` must emit exactly that.
    expect(DEFAULT_GLOW_HUE_LIGHT).toBe('soft')
    expect(DEFAULT_GLOW_STRENGTH_LIGHT).toBe(90)
    expect(DEFAULT_GLOW_HUE_DARK).toBe('night')
    expect(DEFAULT_GLOW_STRENGTH_DARK).toBe(100)
    const css = skinCss()
    // light: soft @ 90% → 16 × 0.9 × 0.56 = 8.064 → 8.06%; amber 3 × 0.9 = 2.7%.
    expect(lightGroundRule(css)).toContain('var(--dsw-static-deepseek-500) 8.06%')
    expect(lightGroundRule(css)).toContain('var(--dsw-static-amber-500) 2.7%')
    // dark: night @ 100% → the anchor at its full alphas.
    expect(darkGroundRule(css)).toContain('var(--dsh-moonset-night) 20%')
    expect(darkGroundRule(css)).toContain('var(--dsh-moonset-night) 12%')
  })

  it('offers three hues and repaints only the hue layers', () => {
    expect(GLOW_HUES).toEqual(['accent', 'soft', 'night'])
    for (const hue of GLOW_HUES) {
      const light = lightGroundRule(skinCss({ hueLight: hue, strengthLight: 100 }))
      const dark = darkGroundRule(skinCss({ hueDark: hue, strengthDark: 100 }))
      const token = GLOW_HUE_AT_FULL[hue]
      expect(light).toContain('var(' + token.light + ')')
      expect(dark).toContain('var(' + token.dark + ')')
      // The amber glint is a different ROLE: the hue never moves it.
      expect(light).toContain('var(--dsw-static-amber-500) 3%')
      expect(dark).not.toContain('amber')
    }
    // `soft` is the SAME tokens at 0.56; `night` is the skin anchor.
    expect(GLOW_HUE_AT_FULL.soft.light).toBe(GLOW_HUE_AT_FULL.accent.light)
    expect(GLOW_HUE_AT_FULL.soft.dark).toBe(GLOW_HUE_AT_FULL.accent.dark)
    expect(GLOW_HUE_AT_FULL.soft.factor).toBe(0.56)
    expect(GLOW_HUE_AT_FULL.night.light).toBe(NIGHT_BLUE_TOKEN)
    expect(GLOW_HUE_AT_FULL.night.dark).toBe(NIGHT_BLUE_TOKEN)
  })

  it('scales the full 3 hues × 2 schemes × 5 strengths matrix in JS', () => {
    // Every cell is `full-strength alpha × strength/100 × hue factor`, formatted
    // as a literal percentage: no calc(), no var() hop, nothing computed by CSS.
    const strengths = [0, 50, 100, 150, 200]
    for (const hue of GLOW_HUES) {
      const factor = GLOW_HUE_AT_FULL[hue].factor
      for (const strength of strengths) {
        const light = glowAlphas(strength, hue)
        const dark = darkGlowAlphas(strength, hue)
        const s = strength / 100
        // LIGHT: hue + wash scale with strength AND hue; amber only with strength.
        expect(light.moon).toBe(percentOf(16 * s * factor))
        expect(light.wash).toBe(percentOf(1.5 * s * factor))
        expect(light.warm).toBe(percentOf(3 * s))
        // DARK: all three footprints and the wash scale with strength AND hue.
        expect(dark.moon).toBe(percentOf(20 * s * factor))
        expect(dark.core).toBe(percentOf(12 * s * factor))
        expect(dark.floor).toBe(percentOf(4 * s * factor))
        expect(dark.wash).toBe(percentOf(1 * s * factor))
      }
    }
    // The named cells the user will actually see at the defaults.
    expect(glowAlphas(90, 'soft')).toEqual({ moon: '8.06%', warm: '2.7%', wash: '0.76%' })
    expect(darkGlowAlphas(100, 'night')).toEqual({ moon: '20%', core: '12%', floor: '4%', wash: '1%' })
    expect(glowAlphas(200, 'soft').moon).toBe('17.92%')
    // ...and the emitted sheets carry those literals, never a calc().
    const sheet = skinCss({ hueLight: 'soft', strengthLight: 200, hueDark: 'soft', strengthDark: 200 })
    expect(lightGroundRule(sheet)).toContain('deepseek-500) 17.92%')
    expect(darkGroundRule(sheet)).toContain('deepseek-400) 22.4%')
    // Same split as above: the hue matrix moves the GROUND only.
    const groundHalf = sheet.slice(0, sheet.indexOf('/* 0.1.4 glass'))
    expect(groundHalf.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('calc(')
  })

  it('no longer accepts the two removed hues, anywhere', () => {
    // M4 shipped five; the two "dark" variants were visually identical to their
    // light siblings, so M6 removed them. Nothing may resurrect them: not the
    // union, not the table, not a resolved value.
    for (const removed of ['accentDark', 'accentSoftDark', 'accentSoft', 'nightBlue']) {
      expect(GLOW_HUES as readonly string[]).not.toContain(removed)
      expect(Object.keys(GLOW_HUE_AT_FULL)).not.toContain(removed)
      expect(resolveGlowHue(removed)).toBe(DEFAULT_GLOW_HUE_LIGHT)
      expect(resolveGlowHue(removed, 'night')).toBe('night')
    }
  })

  it('clamps strength per scheme and falls back to that scheme default', () => {
    expect(resolveGlowStrength(undefined, DEFAULT_GLOW_STRENGTH_LIGHT)).toBe(90)
    expect(resolveGlowStrength(undefined, DEFAULT_GLOW_STRENGTH_DARK)).toBe(100)
    expect(resolveGlowStrength(undefined)).toBe(90)
    expect(resolveGlowStrength(Number.NaN, 100)).toBe(100)
    expect(resolveGlowStrength(-40)).toBe(GLOW_STRENGTH_MIN)
    expect(resolveGlowStrength(1e6)).toBe(GLOW_STRENGTH_MAX)
    expect(resolveGlowStrength('150')).toBe(150)
    expect(resolveGlowStrength(149.6)).toBe(150)
    expect(resolveGlowHue(undefined)).toBe('soft')
    expect(resolveGlowHue(undefined, 'night')).toBe('night')
    expect(resolveGlowHue('sidebar')).toBe('soft')
    expect(resolveGlowHue('night')).toBe('night')
  })

  it('keeps the two grounds independent: one pair never moves the other', () => {
    const base0 = skinCss()
    const lightMoved = skinCss({ hueLight: 'night', strengthLight: 40 })
    const darkMoved = skinCss({ hueDark: 'soft', strengthDark: 180 })
    // Moving the LIGHT pair leaves the dark rule byte-identical.
    expect(darkGroundRule(lightMoved)).toBe(darkGroundRule(base0))
    expect(lightGroundRule(lightMoved)).not.toBe(lightGroundRule(base0))
    // ...and the other way round.
    expect(lightGroundRule(darkMoved)).toBe(lightGroundRule(base0))
    expect(darkGroundRule(darkMoved)).not.toBe(darkGroundRule(base0))
    // The anchor declarations belong to neither pair, so they never move.
    expect(lightMoved).toContain('--dsh-moonset-night: #2563EB;')
    expect(darkMoved).toContain('--dsh-moonset-night: #60A5FA;')
  })

  it('never lets one ground read the other scheme hue', () => {
    // A deliberately crossed configuration: light = night blue, dark = accent.
    const css = skinCss({ hueLight: 'night', hueDark: 'accent' })
    const light = lightGroundRule(css)
    const dark = darkGroundRule(css)
    expect(light).toContain('var(' + NIGHT_BLUE_TOKEN + ')')
    expect(light).not.toContain('deepseek-500')
    expect(dark).toContain('var(--dsw-static-deepseek-400)')
    expect(dark).not.toContain(NIGHT_BLUE_TOKEN)
  })

  it('writes the same line count for every hue: only token names change', () => {
    // The hue control is a repaint, not a re-layout of the sheet: 3 hues × 2
    // schemes must all emit the same shape, so the budget cannot drift per hue.
    const reference = skinCss().split('\n').length
    for (const hue of GLOW_HUES) {
      const sheet = skinCss({ hueLight: hue, hueDark: hue })
      expect(sheet.split('\n').length, hue).toBe(reference)
      expect(sheet.match(/\{/g)).toHaveLength(SHEET_RULES)
    }
  })

  it('drops the night anchor with the switch, in every scope', () => {
    for (const scope of GLOW_SCOPES) {
      const off = skinCss({ glow: false, scope })
      expect(off).not.toContain(NIGHT_BLUE_TOKEN)
      expect(off).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
  it('owns the night anchor: declared twice, read only by the `night` hue', () => {
    const css = skinCss()
    // One declaration per scheme, and the dark one hangs off the host marker so
    // it can only win in dark mode.
    expect(css).toContain('html[data-moonset-skin] {\n  --dsh-moonset-night: #2563EB;\n}')
    expect(css).toContain('html[data-moonset-skin] body[data-ds-dark-theme] {\n  --dsh-moonset-night: #60A5FA;\n}')
    // The hex is NEVER used directly in a gradient: the ground reads the variable.
    const nightDark = darkGroundRule(css)
    expect(nightDark).toContain('var(' + NIGHT_BLUE_TOKEN + ')')
    expect(nightDark).not.toContain('#60A5FA')
    // A ground whose hue is not `night` never reads it.
    for (const hue of ['accent', 'soft'] as const) {
      expect(lightGroundRule(skinCss({ hueLight: hue }))).not.toContain(NIGHT_BLUE_TOKEN)
      expect(darkGroundRule(skinCss({ hueDark: hue }))).not.toContain(NIGHT_BLUE_TOKEN)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 0.1.3 M2 — step rows: one hue per kind of step                      *
 * ------------------------------------------------------------------ */

/**
 * The whitelist's step-row entry, audited against the INSTALLED sources rather
 * than guessed: the four step-row implementations the client renders publish the
 * same hooks — `[data-variant][data-state]` on the row root and
 * `[data-shimmer-decoration]` on the dot between the name and its arguments — and
 * no hook at all on the two cells themselves. Hence the relative selectors
 * (`:has(+ …)` / `+ *`), and hence the two custom properties a class
 * publishes on the row: one declaration block per class, two cell rules that read it.
 *
 * `data-variant` is the CLOSED set the client can emit (ToolRowVariant plus the
 * chat row's own `think`), so the fallback is structural: `code` and `others`
 * declare no hues and land on the cell rules' fallback values — which is also what
 * an unknown `data-tool` gets, because classifyTool() always resolves one of the
 * eight variants.
 */
describe('skinCss — 0.1.3 M2 工作步骤行（终端配色）', () => {
  /** Every class the M2 block ships: its row variant, a test label and its family token. */
  const CLASSES: readonly { variant: string; label: string; family: string }[] = [
    { variant: 'bash', label: 'shell / 运行命令', family: '--dsw-static-green-500' },
    { variant: 'read', label: 'files / 读取', family: '--dsw-static-deepseek-400' },
    { variant: 'write', label: 'files / 写入', family: '--dsw-static-deepseek-400' },
    { variant: 'edit', label: 'files / 编辑', family: '--dsw-static-deepseek-400' },
    { variant: 'search', label: 'search / 搜索', family: '--dsw-static-amber-600' },
    { variant: 'think', label: 'reasoning / 思考', family: '--dsw-static-violet-400' },
  ]

  /** The M2 segment of the sheet, comments included. */
  function stepSegment(): string {
    const css = skinCss()
    const start = css.indexOf('/* 0.1.3 M2')
    const end = css.indexOf('/* 0.1.2 hue anchor')
    if (start === -1 || end === -1) throw new Error('the step-row segment is missing')
    return css.slice(start, end)
  }

  /** The M2 rules with comments stripped: selectors + declarations, in order. */
  function stepRules(): { selectors: string[]; declarations: string[] }[] {
    const text = stepSegment().replace(/\/\*[\s\S]*?\*\//g, '')
    return [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
      selectors: match[1].split(',').map((part) => part.trim()).filter(Boolean),
      declarations: match[2].split(';').map((part) => part.trim()).filter(Boolean),
    }))
  }

  /** Every step-row selector, flattened. */
  function stepSelectors(): string[] {
    const out: string[] = []
    for (const rule of stepRules()) out.push(...rule.selectors)
    return out
  }

  /** The class block that declares the hues for one data-variant value. */
  function classRule(variant: string): { selectors: string[]; declarations: string[] } {
    const needle = "[data-variant='" + variant + "']"
    const rule = stepRules().find((entry) => entry.selectors.some((selector) => selector.includes(needle)))
    if (rule === undefined) throw new Error('no class block for data-variant=' + variant)
    return rule
  }

  /** One custom property's value inside one rule. */
  function hueOf(rule: { selectors: string[]; declarations: string[] }, property: string): string {
    const prefix = property + ': '
    const declaration = rule.declarations.find((entry) => entry.startsWith(prefix))
    if (declaration === undefined) throw new Error('no ' + property + ' in ' + JSON.stringify(rule.selectors))
    return declaration.slice(prefix.length)
  }

  it('keys both cells on the row and on the dot, and paints them from two custom properties', () => {
    const rules = stepRules()
    // Two cell rules + four class blocks + the failed-step rule.
    expect(rules).toHaveLength(7)
    for (const selector of stepSelectors()) {
      // Root-gated (P2), and anchored either on the ROW (the two cell rules and
      // the failed-step rule) or on a class block's data-variant value.
      expect(selector.startsWith('html[data-moonset-skin] body ')).toBe(true)
      expect(
        selector.includes('[data-variant][data-state') || selector.includes("[data-variant='"),
        selector,
      ).toBe(true)
    }
    const name = rules[0]
    const args = rules[1]
    if (name === undefined || args === undefined) throw new Error('the two cell rules are missing')
    // The tool name is the cell BEFORE the dot; the arguments are the cell AFTER it.
    expect(name.selectors).toEqual([
      'html[data-moonset-skin] body [data-variant][data-state] :has(+ [data-shimmer-decoration])',
    ])
    expect(name.declarations).toEqual([
      'color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500))',
      'font-family: var(--ds-font-family-code)',
    ])
    expect(args.selectors).toEqual([
      'html[data-moonset-skin] body [data-variant][data-state] [data-shimmer-decoration] + *',
    ])
    expect(args.declarations).toEqual([
      'color: var(--dsh-moonset-step-args, var(--dsw-alias-label-secondary))',
      'font-family: var(--ds-font-family-code)',
    ])
  })

  it('gives every KIND of step its own hue, declared on the row as two custom properties', () => {
    for (const entry of CLASSES) {
      const rule = classRule(entry.variant)
      // Exactly the two hues, nothing else: the block declares a class, it does not paint.
      expect(rule.declarations).toHaveLength(2)
      expect(hueOf(rule, '--dsh-moonset-step-name')).toBe(
        'color-mix(in srgb, var(' + entry.family + ') 65%, var(--dsw-alias-label-primary))',
      )
      expect(hueOf(rule, '--dsh-moonset-step-args')).toBe(
        'color-mix(in srgb, var(' + entry.family + ') 25%, var(--dsw-alias-label-secondary))',
      )
    }
  })

  it('mixes each class hue from a family token and a label token, never a literal', () => {
    for (const entry of CLASSES) {
      const rule = classRule(entry.variant)
      for (const property of ['--dsh-moonset-step-name', '--dsh-moonset-step-args']) {
        const value = hueOf(rule, property)
        // The family names the KIND; the label token makes the mix follow the scheme.
        expect(value, property).toContain('var(' + entry.family + ')')
        expect(value, property).toMatch(/var\(--dsw-alias-label-(?:primary|secondary)\)/)
        expect(value, property).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        expect(value, property).not.toMatch(/\b(?:rgba?|hsla?)\(/)
      }
    }
  })

  it('keeps the class families distinct, and the arguments dimmer than the name', () => {
    const families = new Set(CLASSES.map((entry) => entry.family))
    // shell / files / search / reasoning: four families, no two classes share one.
    expect(families.size).toBe(4)
    for (const entry of CLASSES) {
      const rule = classRule(entry.variant)
      const nameShare = / (\d+)%/.exec(hueOf(rule, '--dsh-moonset-step-name'))
      const argsShare = / (\d+)%/.exec(hueOf(rule, '--dsh-moonset-step-args'))
      expect(nameShare).not.toBeNull()
      expect(argsShare).not.toBeNull()
      // The arguments sit one step dimmer: less family colour, more label colour.
      expect(Number(argsShare?.[1])).toBeLessThan(Number(nameShare?.[1]))
    }
  })

  it('falls back to the accent and the secondary label for code and unknown tools', () => {
    // code / others declare no hues on purpose: the class list is closed and
    // classifyTool() resolves every unknown wire name into one of the eight
    // variants, so the fallback IS the unknown-tool colour.
    const declared = stepRules().flatMap((rule) => rule.selectors).join(' ')
    expect(declared).not.toContain("[data-variant='code']")
    expect(declared).not.toContain("[data-variant='others']")
    const rules = stepRules()
    expect(rules[0]?.declarations[0]).toContain('var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500))')
    expect(rules[1]?.declarations[0]).toContain('var(--dsh-moonset-step-args, var(--dsw-alias-label-secondary))')
  })

  it('covers every data-variant the installed client can emit', () => {
    // ToolRowVariant (tool-call-model.ts:17) plus the chat rows' own think
    // (ReasoningRow.tsx:89) and others (GenericCommandCard.tsx:55) — eight values,
    // each either a declared class or the explicit fallback.
    const emitted = ['search', 'read', 'bash', 'write', 'edit', 'code', 'others', 'think']
    const declared = new Set(CLASSES.map((entry) => entry.variant))
    for (const variant of emitted) {
      const covered = declared.has(variant) || variant === 'code' || variant === 'others'
      expect(covered, variant + ' must be a class or the fallback').toBe(true)
    }
    expect(declared.size + 2).toBe(emitted.length)
  })

  it('lets a failed step win over its class hue, both cells and the capsule', () => {
    const failed = stepRules()[6]
    if (failed === undefined) throw new Error('the failed-step rule is missing')
    expect(failed.selectors).toEqual([
      "html[data-moonset-skin] body [data-variant][data-state='error'] :has(+ [data-shimmer-decoration])",
      "html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] + *",
      "html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] ~ [data-tone]",
    ])
    // Colour only: the on-device pass rejected the 500 weight the first cut added.
    // 0.1.5 G4 routes the colour through the per-scheme property, with the host
    // token as the fallback (so the dark scheme keeps it byte-for-byte).
    expect(failed.declarations).toEqual([
      'color: var(--dsh-moonset-error, var(--dsw-alias-state-error-primary))',
    ])
  })

  it('puts the failed-step rule last, so no later class can out-order it', () => {
    const rules = stepRules()
    const last = rules[rules.length - 1]
    expect(last?.selectors.join(' ')).toContain("[data-state='error']")
    // Every class block sits BEFORE it (custom properties are inherited, so the
    // error rule only has to win on color — being last makes that unconditional).
    for (const entry of CLASSES) {
      const needle = "[data-variant='" + entry.variant + "']"
      const index = rules.findIndex((rule) => rule.selectors.some((selector) => selector.includes(needle)))
      expect(index, entry.variant).toBeGreaterThan(-1)
      expect(index, entry.variant).toBeLessThan(rules.length - 1)
    }
  })

  it('declares the custom properties only on class rows, never on :root', () => {
    const css = skinCss()
    const stepProperties = (css.match(/--dsh-moonset-step-(?:name|args)\s*:/g) ?? []).length
    // read / write / edit share one block, so 4 class blocks carry 8 declarations.
    expect(stepProperties).toBe(8)
    for (const rule of stepRules()) {
      for (const declaration of rule.declarations) {
        if (!declaration.startsWith('--dsh-moonset-step-')) continue
        expect(rule.selectors.every((selector) => selector.includes("[data-variant='"))).toBe(true)
      }
    }
    const rootStart = css.indexOf('html[data-moonset-skin] {')
    const rootRule = css.slice(rootStart, css.indexOf('}', rootStart) + 1)
    expect(rootRule).not.toContain('--dsh-moonset-step-')
  })

  it('never leaves the step row: no prose, no expanded body, no host class name', () => {
    for (const selector of stepSelectors()) {
      // A class selector would be a per-build hash; none is allowed anywhere.
      expect(selector).not.toContain('.')
      // The expanded body is a SIBLING of the disclosure row, and the prose
      // renderers (p / pre / code / blockquote) never sit inside a step row.
      for (const forbidden of ['pre', 'code', 'blockquote', '::', '[data-error]', '[data-disclosure-row]']) {
        expect(selector, selector).not.toContain(forbidden)
      }
    }
    // The STEP ROW's only wildcards are that sibling-after-the-dot cell, twice
    // (the idle rule and the re-used failed-step selector).
    const whole = skinCss()
    const beforeMaterial = whole.slice(0, whole.indexOf('/* 0.1.4 glass')).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(beforeMaterial.split('*').length - 1).toBe(2)
    expect(whole.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('[class')
  })

  it('keeps every name/arguments pair AA-readable on the canvas (light + dark)', () => {
    for (const entry of CLASSES) {
      const rule = classRule(entry.variant)
      const pairs: [string, string][] = [
        ['name', hueOf(rule, '--dsh-moonset-step-name')],
        ['arguments', hueOf(rule, '--dsh-moonset-step-args')],
      ]
      for (const [role, value] of pairs) {
        for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
          const canvas = colourOf(table, table['--dsw-alias-bg-base'])
          const ratio = contrastRatio(colourOf(table, value), canvas)
          // Measured (name, then arguments): shell 6.48/11.32 and 7.09/9.20,
          // files 6.71/10.03 and 7.02/8.86, search 7.61/9.93 and 7.53/8.76,
          // reasoning 5.06/8.25 and 6.27/8.19.
          expect(
            ratio,
            scheme + ' ' + entry.label + ' ' + role + ' = ' + ratio.toFixed(2) + ':1',
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('keeps the name and its arguments visibly apart inside one row', () => {
    // The on-device complaint after the first M2b pass was "the arguments read as
    // the same colour as the name" (40% of the family left files/light only 14.3
    // sRGB units away). The pair now has to clear 20 units, or a 1.5 contrast step.
    for (const entry of CLASSES) {
      const rule = classRule(entry.variant)
      for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
        const name = colourOf(table, hueOf(rule, '--dsh-moonset-step-name'))
        const args = colourOf(table, hueOf(rule, '--dsh-moonset-step-args'))
        const canvas = colourOf(table, table['--dsw-alias-bg-base'])
        const rgb = Math.sqrt((name.r - args.r) ** 2 + (name.g - args.g) ** 2 + (name.b - args.b) ** 2)
        const step = Math.abs(contrastRatio(name, canvas) - contrastRatio(args, canvas))
        // Measured at 25%: shell 46.7/43.1, files 30.2/37.4, search 58.7/60.5,
        // reasoning 43.9/33.2 sRGB units (light/dark) — the minimum is 30.2.
        expect(
          rgb >= 20 || step >= 1.5,
          scheme + ' ' + entry.label + ' rgb distance=' + rgb.toFixed(1) + ', contrast step=' + step.toFixed(2),
        ).toBe(true)
        // ...while the arguments still carry a visible tint of their class: a
        // plain label-secondary would mean "the content has no colour".
        const plain = colourOf(table, table['--dsw-alias-label-secondary'])
        const tint = Math.sqrt((args.r - plain.r) ** 2 + (args.g - plain.g) ** 2 + (args.b - plain.b) ** 2)
        expect(tint, scheme + ' ' + entry.label + ' tint=' + tint.toFixed(1)).toBeGreaterThan(10)
      }
    }
  })

  it('keeps the fallback pair AA-readable too (accent name, secondary arguments)', () => {
    for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
      const canvas = colourOf(table, table['--dsw-alias-bg-base'])
      const roles: [string, string][] = [
        ['name', ACCENT],
        ['arguments', '--dsw-alias-label-secondary'],
      ]
      for (const [role, token] of roles) {
        const ratio = contrastRatio(colourOf(table, table[token]), canvas)
        expect(ratio, scheme + ' fallback ' + role + ' = ' + ratio.toFixed(2) + ':1').toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the failed line readable on the canvas and on the capsule', () => {
    for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
      const error = colourOf(table, table['--dsw-alias-state-error-primary'])
      const canvas = colourOf(table, table['--dsw-alias-bg-base'])
      const capsule = colourOf(table, table['--dsw-alias-bg-module-platform'])
      const onCanvas = contrastRatio(error, canvas)
      const onCapsule = contrastRatio(error, capsule)
      expect(onCanvas, scheme + ' failed step = ' + onCanvas.toFixed(2) + ':1').toBeGreaterThanOrEqual(4.5)
      expect(onCapsule, scheme + ' exit capsule = ' + onCapsule.toFixed(2) + ':1').toBeGreaterThanOrEqual(4.5)
    }
  })

  it('sets the mono face through the theme layer, and nothing else', () => {
    const css = skinCss()
    const families = [...css.matchAll(/font-family: ([^;]+);/g)].map((match) => match[1].trim())
    // Exactly the two cell rules, both reading the theme layer's code stack
    // (declared on :root by ui-theme's base.css) — no literal font stack.
    expect(families).toEqual(['var(--ds-font-family-code)', 'var(--ds-font-family-code)'])
    expect(css.split('monospace').length - 1).toBe(0)
  })

  it('stays inside its own segment budget: <= 40 lines, no imperative CSS', () => {
    const segment = stepSegment()
    expect(segment.split('\n').length).toBeLessThanOrEqual(40)
    expect(segment).not.toMatch(/@media|@supports|!important|animation|transition/)
    // No layout property: a class only publishes hue variables.
    expect(segment).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow)\s*:/)
  })

  it('paints nothing for a successful exit: this build renders no success capsule', () => {
    // The exit capsule only exists while terminalFailed() is true and it is always
    // tone="neutral" (ExitCodeBadge.tsx:12, terminal-card-model.ts:107-112), so a
    // zero exit has no element to colour; the only success signal is
    // [data-state='ok'] on the WHOLE row, and painting every settled step would
    // colour the entire trajectory.
    const css = skinCss()
    expect(css).not.toContain('state-success-primary')
    expect(css).not.toContain("[data-state='ok']")
  })
})
/* ------------------------------------------------------------------ *
 * unmount                                                             *
 * ------------------------------------------------------------------ */

describe('unmountSkin — zero residue, idempotent', () => {
  it('removes the attribute and the sheet, and a second call is a quiet no-op', () => {
    const doc = new StubDocument()
    mountSkin(doc)

    expect(unmountSkin(doc)).toBe(true)
    expect(doc.attributes.size).toBe(0)
    expect(doc.attached()).toHaveLength(0)

    expect(unmountSkin(doc)).toBe(false)
    expect(doc.attributes.size).toBe(0)
    expect(doc.attached()).toHaveLength(0)
  })

  it('leaves no residue across a mount/unmount/mount cycle', () => {
    const doc = new StubDocument()

    mountSkin(doc)
    unmountSkin(doc)
    mountSkin(doc)

    expect(doc.attributes.get(SKIN_ATTR)).toBe('')
    expect(doc.attached()).toHaveLength(1)
  })

  it('cleans up a duplicate sheet that appeared behind its back', () => {
    const doc = new StubDocument()
    mountSkin(doc)
    // A second copy of the plugin, a hot reload, or a pasted element.
    const leaked = doc.createElement('style')
    leaked.setAttribute(SKIN_SHEET_ATTR, '')
    leaked.textContent = skinCss()
    doc.head.appendChild(leaked)
    expect(doc.attached()).toHaveLength(2)

    unmountSkin(doc)

    expect(doc.attributes.size).toBe(0)
    expect(doc.attached()).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * wiring                                                              *
 * ------------------------------------------------------------------ */

/** Minimal cordis context: the registration service and `ctx.effect`. */
interface StubContext {
  theme: { register(definition: { id: string }): () => void }
  effect(execute: () => void | (() => void), label?: string): void
}

/**
 * Apply the plugin for real, without a browser: a stub theme service is enough
 * (the settings half is skipped when `slots`/`locale` are absent), and
 * `document` is the stub above.
 */
function applyWithStubDocument(): { doc: StubDocument; disposers: (() => void)[] } {
  const doc = new StubDocument()
  vi.stubGlobal('document', doc)
  const disposers: (() => void)[] = []
  const ctx: StubContext = {
    theme: { register: () => () => {} },
    effect(execute) {
      const dispose = execute()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  }
  apply(ctx as unknown as ClientContext)
  return { doc, disposers }
}

describe('apply — the skin belongs to the fiber', () => {
  it('mounts the skin on activation and removes it on unload', () => {
    const { doc, disposers } = applyWithStubDocument()
    try {
      expect(doc.attributes.get(SKIN_ATTR)).toBe('')
      expect(doc.attached()).toHaveLength(1)

      // Reverse order, the way a fiber releases its effects.
      for (const dispose of [...disposers].reverse()) dispose()

      expect(doc.attributes.size).toBe(0)
      expect(doc.attached()).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('is a quiet no-op outside a browser (no document at all)', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(mountSkin()).toBe(false)
      expect(unmountSkin()).toBe(false)
      expect(syncSkin('light')).toBe(false)
      expect(syncSkin('off')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
/* ------------------------------------------------------------------ *
 * syncSkin — the skin follows the choice (0.1.1)                      *
 * ------------------------------------------------------------------ */

describe('syncSkin — the skin follows the choice', () => {
  it('leaves the document alone while the choice is off', () => {
    const doc = new StubDocument()

    expect(syncSkin('off', doc)).toBe(false)
    expect(doc.attributes.size).toBe(0)
    expect(doc.attached()).toHaveLength(0)
  })

  it('takes a mounted sheet off when the choice becomes off', () => {
    const doc = new StubDocument()
    expect(syncSkin('light', doc)).toBe(true)
    expect(doc.attached()).toHaveLength(1)

    expect(syncSkin('off', doc)).toBe(false)
    expect(doc.attributes.size).toBe(0)
    expect(doc.attached()).toHaveLength(0)
  })

  it('re-mounts on the way back from off, and stays a singleton', () => {
    const doc = new StubDocument()

    syncSkin('light', doc)
    syncSkin('off', doc)
    expect(syncSkin('dark', doc)).toBe(true)
    expect(syncSkin('follow', doc)).toBe(true)

    expect(doc.attributes.get(SKIN_ATTR)).toBe('')
    expect(doc.attached()).toHaveLength(1)
    expect(doc.sheets).toHaveLength(2) // one detached by the off step, one live
  })
})

/* ------------------------------------------------------------------ *
 * wiring: the three paths that learn a choice                         *
 * ------------------------------------------------------------------ */

/**
 * One in-memory settings form (the shape `configForms.get` hands back).
 *
 * Reduced copy of the fake in `tests/settings.spec.ts`: only the members this
 * file needs, so a new requirement in `durable.ts` shows up as a missing
 * member here instead of passing silently against an over-stuffed fake.
 */
class FakeForm {
  section: { choice?: unknown }
  revision = 1
  /** Every set call, in order (the mirror / pick writes land here). */
  readonly sets: { field: string; value: unknown }[] = []
  private readonly listeners = new Set<() => void>()

  constructor(section: { choice?: unknown } = {}) {
    this.section = section
  }

  getSnapshot(): { value: { choice?: unknown }; revision: number } {
    return { value: this.section, revision: this.revision }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<boolean> {
    this.sets.push({ field, value })
    this.section = { ...this.section, [field]: value }
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
    return true
  }
}

/** What one reduced-context apply hands a test. */
interface Wiring {
  readonly doc: StubDocument
  readonly form: FakeForm
  readonly disposers: (() => void)[]
  /** The section face `apply()` registered; `onPick` is a user click. */
  face(): { onPick(choice: string): void }
  /** Publish a `theme/change` the way the official runtime would. */
  emitThemeChange(preference: string): void
}

/**
 * Apply the plugin with a stored choice and a real settings form binding.
 *
 * This is the smallest context that reaches the three choice paths: the theme
 * runtime, the slot registry, the locale registry, `configForms` (durable.ts
 * binds its form through `ctx.inject`) and `ctx.on('theme/change')`.
 * @param choice - the choice the stored settings section carries on boot.
 * @returns the stub document, the form, and the two drivers.
 */
function applyWithStoredChoice(choice: string): Wiring {
  const doc = new StubDocument()
  vi.stubGlobal('document', doc)
  const form = new FakeForm({ choice })
  const disposers: (() => void)[] = []
  const sections: { inject?: () => unknown }[] = []
  const themeChange: ((snapshot: { preference: string }) => void)[] = []
  const theme = {
    preference: 'system',
    register: () => () => {},
    overrideTokens: () => () => {},
    getTheme: () => ({ preference: theme.preference }),
    setTheme(id: string): void { theme.preference = id },
  }
  const ctx = {
    theme,
    slots: {
      inject(_key: string, callback: () => (() => void) | void): () => void {
        const release = callback()
        return () => { release?.() }
      },
      register(options: { inject?: () => unknown }): () => void {
        sections.push(options)
        return () => {}
      },
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string): string => key,
    },
    effect(execute: () => (() => void) | void): () => void {
      const dispose = execute()
      const release = (): void => { dispose?.() }
      disposers.push(release)
      return release
    },
    inject(_deps: string[], callback: (formsCtx: unknown) => (() => void) | void) {
      const release = callback({ configForms: { get: () => form } })
      return { dispose: async () => { release?.() } }
    },
    on(_event: string, handler: (snapshot: { preference: string }) => void): () => void {
      themeChange.push(handler)
      return () => {}
    },
  }
  apply(ctx as unknown as ClientContext)
  return {
    doc,
    form,
    disposers,
    face(): { onPick(choice: string): void } {
      const options = sections[0]
      const face = typeof options?.inject === 'function' ? options.inject() : undefined
      return face as { onPick(choice: string): void }
    },
    emitThemeChange(preference: string): void {
      for (const handler of [...themeChange]) handler({ preference })
    },
  }
}

describe('apply — the skin follows the stored choice', () => {
  it('keeps the sheet on for a stored light choice', () => {
    const wiring = applyWithStoredChoice('light')
    try {
      expect(wiring.doc.attributes.get(SKIN_ATTR)).toBe('')
      expect(wiring.doc.attached()).toHaveLength(1)
    } finally {
      for (const dispose of [...wiring.disposers].reverse()) dispose()
      vi.unstubAllGlobals()
    }
  })

  it('takes the sheet off when the STORED choice is off', () => {
    // apply() mounts for the first paint; the boot restore corrects it in the
    // same activation call, so a profile on the official theme never keeps it.
    const wiring = applyWithStoredChoice('off')
    try {
      expect(wiring.doc.attributes.size).toBe(0)
      expect(wiring.doc.attached()).toHaveLength(0)
    } finally {
      for (const dispose of [...wiring.disposers].reverse()) dispose()
      vi.unstubAllGlobals()
    }
  })

  it('takes the sheet off when the user picks off in our section', () => {
    const wiring = applyWithStoredChoice('light')
    try {
      expect(wiring.doc.attached()).toHaveLength(1)

      wiring.face().onPick('off')
      expect(wiring.doc.attributes.size).toBe(0)
      expect(wiring.doc.attached()).toHaveLength(0)

      // The unload flush is what lands the debounced write (M5.1).
      for (const dispose of [...wiring.disposers].reverse()) dispose()
      expect(wiring.form.sets).toEqual([{ field: 'choice', value: 'off' }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the sheet off when the stored choice is off, whatever the controls say', async () => {
    // The 0.1.1 gate still wins: `off` means the official theme owns the page, so
    // a glow control must not bring a Moonset sheet back (the skin is choice-
    // gated, and the rebuild path is a fifth way to mount it).
    vi.useFakeTimers()
    try {
      const wiring = applyWithStoredChoice('off')
      expect(wiring.doc.attached()).toHaveLength(0)
      const face = wiring.face() as unknown as { onScope(scope: string): void }
      face.onScope('conversation')
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS * 2)
      expect(wiring.doc.attached()).toHaveLength(0)
      for (const dispose of [...wiring.disposers].reverse()) dispose()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('rebuilds the ONE sheet when the M2 glow controls move (150 ms debounce)', async () => {
    vi.useFakeTimers()
    try {
      const wiring = applyWithStoredChoice('light')
      const sheetText = (): string => {
        const live = wiring.doc.attached()
        expect(live).toHaveLength(1)
        return live[0].textContent
      }
      // The boot restore built the sheet from the stored (default) glow options —
      // scope `main` since M3.
      expect(sheetText()).toContain('scope: main)')
      const face = wiring.face() as unknown as {
        onScope(scope: string): void
        onToggleGlow(next: boolean): void
        onStrengthLight(next: number): void
        onHueLight(hue: string): void
        onStrengthDark(next: number): void
        onHueDark(hue: string): void
      }
      face.onScope('conversation')
      // Debounced: a fast drag must not re-parse the sheet per step.
      expect(sheetText()).toContain('scope: main)')
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS)
      expect(sheetText()).toContain('scope: conversation)')
      // M6: the LIGHT pair moves its own rule — a literal alpha from 16 × 2 × 0.56.
      face.onStrengthLight(200)
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS)
      expect(sheetText()).toContain('deepseek-500) 17.92%, transparent')
      // ...and the DARK pair its own, independently.
      face.onHueDark('accent')
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS)
      expect(sheetText()).toContain('deepseek-400) 20%, transparent')
      // The switch drops the whole segment (both grounds and the anchor).
      face.onToggleGlow(false)
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS)
      expect(sheetText()).not.toContain('radial-gradient')
      expect(sheetText()).not.toContain(NIGHT_BLUE_TOKEN)
      // Still exactly one sheet, and the durable write is a separate clock.
      expect(wiring.doc.attached()).toHaveLength(1)
      for (const dispose of [...wiring.disposers].reverse()) dispose()
      expect(wiring.doc.attached()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('takes the sheet off when the user picks an official theme in Appearance', () => {
    const wiring = applyWithStoredChoice('light')
    try {
      expect(wiring.doc.attached()).toHaveLength(1)

      // An explicit official pick with no local write on the clock is the
      // user's own action, and M5.1's mirror hands the UI back as `off`.
      wiring.emitThemeChange('dark')
      expect(wiring.doc.attributes.size).toBe(0)
      expect(wiring.doc.attached()).toHaveLength(0)

      for (const dispose of [...wiring.disposers].reverse()) dispose()
      expect(wiring.form.sets).toEqual([{ field: 'choice', value: 'off' }])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})



/* ------------------------------------------------------------------ *
 * 0.1.4 玻璃材质（三面：输入卡 / 侧栏 / 顶栏）                        *
 * ------------------------------------------------------------------ */

describe('0.1.4 玻璃材质 — 三面共用一份材质', () => {
  /** The material segment of one sheet (its comment up to the 0.1.5 colour one). */
  function materialSegment(css: string): string {
    const start = css.indexOf('/* 0.1.4 glass')
    const end = css.indexOf('/* 0.1.5 G2/G3/G4')
    if (start === -1 || end === -1) throw new Error('the sheet carries no material segment:\n' + css)
    return css.slice(start, end).replace(/\n$/, '')
  }

  it('paints the material on the card`s OWN ::before, on the host`s stable attribute', () => {
    const css = skinCss()
    // Verbatim: this segment IS the whitelist entry, so a reworded selector, a
    // moved declaration or a third rule has to fail here.
    expect(materialSegment(css)).toBe(EXPECTED_GLASS_CSS)
    // The card is addressed by the attribute the installed UI renders —
    // `data-composer-card` (ui-conversation `InputBar.tsx:462`), on the very
    // node whose hashed class carries
    // `background: var(--dsw-specific-input-major)` (`InputBar.module.css:71`).
    // So the D2 fallback (`the seat`s first wrapper div, depth <= 2`) is NOT
    // needed: one stable attribute, no depth counting.
    expect(css).toContain('[data-composer-card]')
    expect(css).not.toContain('composerSeat >')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const selectorText = rules.replace(/\{[^}]*\}/g, '')
    expect(selectorText).not.toMatch(/\[class|\*=/)
    // Two planes — the card's and the sidebar's — plus the caption strip (which
    // IS the host's own ::before), and no ::after of ours (the host owns the
    // trigger outline).
    expect(rules.match(/::before/g)).toHaveLength(4)
    expect(rules.match(/::after/g)).toHaveLength(1)
  })

  it('clears each face`s own fill and draws nothing else on it (P6)', () => {
    const css = skinCss()
    // The FACES rule (card + sidebar root + header), all cleared. (The caption
    // strip needs no clear of this kind: it paints nothing but its own ::before,
    // which the material rule below repaints.)
    const facesAt = css.indexOf("[data-composer-card],\nhtml[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header {")
    expect(facesAt).toBeGreaterThan(-1)
    const facesBody = css.slice(css.indexOf('{', facesAt) + 1, css.indexOf('}', facesAt))
    const declarations = facesBody.split(';').map((part) => part.trim()).filter(Boolean)
    // Exactly the three the recipe needs: a positioned host for the plane, a
    // stacking context that keeps it inside the face, and the host fill cleared
    // so the plane is the only paint. The hosts` shadows are NOT touched.
    expect(declarations).toEqual([
      'position: relative',
      'isolation: isolate',
      'background: transparent',
    ])
    // The PLANES rule covers the card AND the sidebar, and carries the geometry
    // plus the material. Slice from its first selector to its closing brace.
    const planeStart = css.indexOf('html[data-moonset-skin][data-moonset-glass] [data-composer-card]::before,')
    expect(planeStart).toBeGreaterThan(-1)
    const plane = css.slice(planeStart, css.indexOf('}', planeStart) + 1)
    const planeDeclarations = plane.slice(plane.indexOf('{') + 1, -1).split(';').map((part) => part.trim()).filter(Boolean)
    // Full-bleed, radius inherited, no hit testing, and BEHIND the card`s
    // content. The z-index is not decoration: measured on Chromium, a plane
    // without it paints in the positioned layer and its backdrop-filter blurs
    // the card`s own draft text away.
    expect(planeDeclarations).toContain("content: ''")
    expect(planeDeclarations).toContain('position: absolute')
    expect(planeDeclarations).toContain('inset: 0')
    expect(planeDeclarations).toContain('z-index: -1')
    expect(planeDeclarations).toContain('border-radius: inherit')
    expect(planeDeclarations).toContain('pointer-events: none')
    // No layout beyond the positioning declarations: the card keeps its box,
    // radius and host shadow.
    expect(planeDeclarations.some((entry) => /^(?:width|height|margin|padding|overflow|display)/.test(entry))).toBe(false)
    expect(css).not.toMatch(/box-shadow:\s*none/)
  })

  it('mixes the material base and its edge from tokens, never from a literal', () => {
    const material = materialSegment(skinCss())
    // The material base is the canvas at 62% (方案自适应), and the top edge is
    // the palette`s own near-white at 10% — the plan sketched
    // `rgba(255,255,255,0.10)`, and this is the same pixel by token.
    expect(material).toContain('color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent)')
    expect(material).toContain('color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent)')
    expect(material).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(material).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    // ...and "near-white" really holds in BOTH schemes, so the highlight cannot
    // turn into a dark line in the dark palette.
    for (const [scheme, table] of [['light', MOONSET_LIGHT], ['dark', MOONSET_DARK]] as const) {
      const edge = rgbOf(resolveToken(table, '--dsw-static-neutral-bluish-00'))
      expect(Math.min(edge.r, edge.g, edge.b), scheme + ' edge highlight must be near-white').toBeGreaterThan(200)
    }
  })

  it('takes the radius from the inline property, so the sheet never carries it', () => {
    const reference = skinCss()
    expect(reference).toContain('backdrop-filter: blur(var(--dsh-moonset-glass-blur)) saturate(1.15)')
    // Every radius produces the SAME bytes: the knob re-points a value instead
    // of re-parsing the rules (that is also why the verbatim assertion above is
    // radius-independent).
    for (const radius of [GLASS_BLUR_MIN, 4, DEFAULT_GLASS_BLUR, GLASS_BLUR_MAX]) {
      expect(skinCss({ glassBlur: radius })).toBe(reference)
    }
    expect(reference).not.toMatch(/blur\(\d/)
    // ...and the value lands on <html> as a px length.
    const doc = new StubDocument()
    mountSkin(doc)
    expect(doc.inlineStyle.get(GLASS_BLUR_TOKEN)).toBe(DEFAULT_GLASS_BLUR + 'px')
  })

  it('resolves a dirty radius into 0-30, and falls back to the shipped default', () => {
    expect(resolveGlassBlur(undefined)).toBe(DEFAULT_GLASS_BLUR)
    expect(resolveGlassBlur('8')).toBe(8)
    expect(resolveGlassBlur(-4)).toBe(GLASS_BLUR_MIN)
    expect(resolveGlassBlur(999)).toBe(GLASS_BLUR_MAX)
    expect(resolveGlassBlur(7.6)).toBe(8)
    expect(resolveGlassBlur(Number.NaN)).toBe(DEFAULT_GLASS_BLUR)
    // The switch: a missing or non-boolean value is the default, which is ON.
    expect(resolveGlass(undefined)).toBe(true)
    expect(resolveGlass(false)).toBe(false)
    expect(DEFAULT_GLASS).toBe(true)
    expect([GLASS_BLUR_MIN, GLASS_BLUR_MAX, GLASS_BLUR_STEP]).toEqual([0, 30, 2])
  })

  it('drops both rules when the material switch is off — and rides its OWN switch', () => {
    const off = skinCss({ glass: false })
    expect(off).toBe(EXPECTED_BASE_CSS + '\n' + EXPECTED_GLOW_CSS + '\n' + EXPECTED_COLOUR_CSS)
    expect(off).not.toContain('data-moonset-glass')
    expect(off).not.toContain('backdrop-filter')
    expect(off).not.toContain('::before')
    // Independent of the ground in both directions: "glow off" keeps the
    // material, "glass off" keeps the ground (契约 §一 P7 + §八 已决 2).
    expect(skinCss({ glow: false })).toContain('[data-composer-card]::before')
    expect(skinCss({ glass: false })).toContain('radial-gradient')
  })

  it('mounts the gate and the radius together, moves both, and removes both', () => {
    const doc = new StubDocument()
    mountSkin(doc)
    expect(doc.attributes.get(GLASS_ATTR)).toBe('')
    expect(doc.inlineStyle.get(GLASS_BLUR_TOKEN)).toBe('12px')

    // A slider move re-points the property; the gate stays.
    updateSkin({ glassBlur: 4 }, doc)
    expect(doc.inlineStyle.get(GLASS_BLUR_TOKEN)).toBe('4px')
    expect(doc.attributes.get(GLASS_ATTR)).toBe('')

    // The switch removes BOTH facts but leaves the sheet alive: the selection,
    // the ground and the step rows are not the material`s business.
    updateSkin({ glass: false }, doc)
    expect(doc.attributes.has(GLASS_ATTR)).toBe(false)
    expect(doc.inlineStyle.has(GLASS_BLUR_TOKEN)).toBe(false)
    expect(doc.attached()).toHaveLength(1)

    updateSkin({ glass: true, glassBlur: 8 }, doc)
    expect(doc.attributes.get(GLASS_ATTR)).toBe('')
    expect(doc.inlineStyle.get(GLASS_BLUR_TOKEN)).toBe('8px')

    // Zero residue: the unload takes the attribute and the inline property.
    unmountSkin(doc)
    expect(doc.attributes.size).toBe(0)
    expect(doc.inlineStyle.size).toBe(0)
    expect(doc.attached()).toHaveLength(0)
  })

  it('takes the material off with the sheet when the choice is off', () => {
    const doc = new StubDocument()
    syncSkin('light', doc)
    expect(doc.attributes.get(SKIN_ATTR)).toBe('')
    expect(doc.attributes.get(GLASS_ATTR)).toBe('')
    expect(doc.inlineStyle.get(GLASS_BLUR_TOKEN)).toBe('12px')
    // The official theme brings no Moonset material either: one `off` clears
    // the sheet, the gate and the radius together.
    syncSkin('off', doc)
    expect(doc.attributes.size).toBe(0)
    expect(doc.inlineStyle.size).toBe(0)
    expect(doc.attached()).toHaveLength(0)
  })

  /* ── 0.1.4 M2: the two extra faces ─────────────────────────────────────── */

  it('gates the top bar on the Windows caption attribute', () => {
    const css = skinCss()
    // `data-windows-titlebar` is stamped by the desktop shell only on win32
    // (`lib/preload-app.cjs` syncWindowsAppearance), and there the caption strip
    // IS the frame's ::before (AppFrame.module.css:40-47). The gate is what keeps
    // macOS honest: no strip exists there, so an ungated ::before would paint a
    // band across the whole frame instead of decorating one.
    expect(css.match(/\[data-windows-titlebar\]/g) ?? []).toHaveLength(1)
    expect(css).toContain("html[data-windows-titlebar][data-moonset-skin][data-moonset-glass] #root [data-slot='root'] > div::before")
    // The strip rule carries the MATERIAL ONLY: geometry (`inset`, `height`, the
    // drag region) stays the host's, or the strip would cover the whole frame.
    const at = css.indexOf('[data-windows-titlebar]')
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    expect(body).not.toContain('inset:')
    expect(body).not.toContain('position:')
    expect(body).not.toContain('content:')
    expect(body).not.toContain('height:')
  })

  it('carries the SAME material on every face (one recipe, three selectors)', () => {
    const css = skinCss()
    // Parsed out of the SHIPPED sheet rather than restated, so a face that drifts
    // (a different alpha, a different token, a dropped highlight) fails here.
    const materialOf = (selector: string): string[] => {
      const at = css.indexOf(selector)
      if (at < 0) throw new Error('missing rule: ' + selector)
      const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
      return body.split(';').map((part) => part.trim()).filter(Boolean)
        .filter((entry) => /^(?:background|backdrop-filter|box-shadow):/.test(entry))
    }
    const planes = materialOf('html[data-moonset-skin][data-moonset-glass] [data-composer-card]::before,')
    const strip = materialOf("html[data-windows-titlebar][data-moonset-skin][data-moonset-glass] #root [data-slot='root'] > div::before")
    expect(planes).toHaveLength(3)
    // Verbatim equality between the card/sidebar plane and the caption strip.
    expect(strip).toEqual(planes)
  })

  it('addresses each face by a stable hook, one `>` hop at most', () => {
    const css = skinCss()
    // The card: its own attribute, no ancestor to walk.
    expect(css).toContain('[data-composer-card]')
    // The sidebar is NOT a face any more (M6, user decision 「侧栏先不做玻璃材质」):
    // the material segment never names its node, so the host keeps painting
    // --dsw-specific-sidebar-fill exactly as shipped.
    expect(css.slice(css.indexOf('/* 0.1.4 glass'))).not.toContain("data-slot='sidebar'")
    // The caption strip: the root anchor's child is the frame, its ::before the strip.
    expect(css).toContain("#root [data-slot='root'] > div::before")
    // The header (M3): the header slot anchor is display:contents too, so its
    // child is ConversationHeader's `<header>` — one hop from the ANCHOR, and the
    // anchor is a slot KEY (a contract name), not a hashed class. (`[data-window-drag]`
    // would have been ambiguous: the sidebar puts the same marker on two rows.)
    expect(css).toContain("#root [data-slot='conversation.header'] > header")
    // Still no hashed class name, no !important, no conditional at-rule.
    const selectorText = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^}]*\}/g, '')
    expect(selectorText).not.toMatch(/\[\s*class/)
    expect(css).not.toContain('!important')
    expect(css).not.toMatch(/@media|@supports/)
  })

  it('paints the conversation header like the card, and keeps the host border', () => {
    const css = skinCss()
    const header = "html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header"
    // The header is a FULL face: its plane is in the shared rule (so its
    // background / backdrop-filter / top highlight are byte-identical to the
    // card's), and it is cleared exactly like the others.
    const planes = css.slice(css.indexOf("${card}::before,".replace('${card}', '[data-composer-card]')))
    expect(planes).toBeTruthy()
    expect(css).toContain(header + '::before {')
    expect(css).toContain(header + ' {')
    const hosts = css.slice(css.indexOf(header + ' {'), css.indexOf('}', css.indexOf(header + ' {')) + 1)
    expect(hosts).toContain('background: transparent')
    // The host's 0.5px border-bottom is NOT touched: nothing here writes a
    // border (and nothing writes width/height/margin/padding either).
    expect(css).not.toMatch(/\bborder(?:-bottom)?\s*:/)
    expect(css).not.toMatch(/\b(?:width|height|margin|padding|overflow)\s*:/)
  })

  it('draws the header\'s own bottom edge on the PLANE, not under it', () => {
    const css = skinCss()
    // The header's plane appears TWICE (the shared rule and this override), so the
    // edge rule is found from the override's own comment.
    const marker = css.indexOf('/* M3: the header keeps')
    expect(marker).toBeGreaterThan(-1)
    const edge = css.slice(css.indexOf('::before {', marker))
    const rule = edge.slice(0, edge.indexOf('}') + 1)
    // A 1px line under a 62%-opaque plane would be muted to nothing, so the
    // edge belongs to the plane — and it must keep the shared top highlight.
    expect(rule).toContain('inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent)')
    expect(rule).toContain('inset 0 -1px 0 var(--dsw-alias-border-l3)')
    // The token the host border uses, so the two lines cannot drift apart.
    expect(rule).toContain('--dsw-alias-border-l3')
  })

  it('leaves the sidebar out of the material entirely (M6)', () => {
    const css = skinCss()
    const segment = css.slice(css.indexOf('/* 0.1.4 glass'))
    // No plane on the sidebar, no host clear, no scheme-split base, no tint.
    expect(segment).not.toContain("data-slot='sidebar'")
    expect(segment).not.toContain('bg-module-platform')
    expect(css).not.toContain('body[data-ds-dark-theme] #root [data-slot=\'sidebar\']')
    expect(css).not.toContain('body[data-ds-light-theme]')
    // The ONE sidebar mention left in the whole sheet is the C-scope GROUND clear
    // (an opt-in comparison mode from 0.1.2/M2, not the material): it must sit in
    // the visibility block, before the material segment.
    const mentions = [...css.matchAll(/data-slot='sidebar'/g)].map((match) => match.index ?? -1)
    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toBeLessThan(css.indexOf('/* 0.1.4 glass'))
    // ...and that clear is gated on the `all` scope, so the default sheet never
    // touches the sidebar's fill.
    expect(skinCss({ scope: 'main' })).not.toContain("#root [data-slot='sidebar'] > div")
    expect(skinCss({ scope: 'all' })).toContain("#root [data-slot='sidebar'] > div")
  })

  it('keeps every face on the same blur, whatever its base', () => {
    const css = skinCss()
    // The blur is the ONE thing no face may vary: it is the switch's knob, and
    // a per-face radius would make the three surfaces read as different
    // materials.
    expect(css.match(/backdrop-filter: blur\(var\(--dsh-moonset-glass-blur\)\) saturate\(1\.15\)/g) ?? []).toHaveLength(2)
    // Two EMISSION sites (the planes rule + the strip); the sidebar and the
    // header inherit the planes rule's value.
    const materials = [...css.matchAll(/backdrop-filter:\s*blur\((var\([^)]*\))\)/g)].map((m) => m[1])
    expect(new Set(materials)).toEqual(new Set(['var(--dsh-moonset-glass-blur)']))
  })

  /* ── 0.1.4 M4: the header floats, and the float is MEASURED ─────────────── */

  it('floats the transcript behind the header, and cancels the shift with padding', () => {
    const css = skinCss()
    const at = css.indexOf("[data-phase='active'] [data-conversation-scroll] {")
    expect(at).toBeGreaterThan(-1)
    const rule = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    const declarations = rule.split(';').map((part) => part.trim()).filter(Boolean)
    // Four declarations: an explicit low stacking slot for the shifted scroll body
    // (so the header above it is unambiguous — M5's click fix), then the recipe —
    // pull the body up by the header's height, push the CONTENT back down by the
    // same height plus air.
    expect(declarations).toHaveLength(4)
    expect(declarations[0]).toBe('position: relative')
    expect(declarations[1]).toBe('z-index: 0')
    expect(declarations[2]).toBe('margin-top: calc(-1 * var(--dsh-moonset-header-h, 76px))')
    expect(declarations[3]).toBe('padding-top: calc(var(--dsh-moonset-header-h, 76px) + 12px)')
    // The guard: the shift is gated on our two root attributes AND the active
    // phase, so hero/blank/settling screens keep the host's flow untouched.
    expect(css).toContain("html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-conversation-scroll] {")
    // The header is lifted out of the flow's paint order, not out of the layout:
    // one declaration, and it is `z-index` (no position/transform/size).
    // NB: `[data-phase='active']` must come BEFORE the `#root`-rooted header hook —
    // the M4 build had them inverted, so the rule never matched the real DOM and the
    // header never floated (M5's five symptoms). The regression guard is below.
    const headerAt = css.indexOf("html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-slot='conversation.header'] > header {")
    expect(headerAt).toBeGreaterThan(-1)
    const headerRule = css.slice(css.indexOf('{', headerAt) + 1, css.indexOf('}', headerAt))
    expect(headerRule.trim()).toBe('z-index: 8;')
  })

  it('measures the header height and republishes it as the float offset', () => {
    const doc = new StubDocument()
    // Nothing rendered yet: no property, nothing invented.
    expect(syncHeaderHeight(doc)).toBe(false)
    expect(doc.inlineStyle.has(HEADER_HEIGHT_TOKEN)).toBe(false)
    // The host lands a 76px header; the next measurement publishes it.
    doc.headerRectHeight = 76
    expect(syncHeaderHeight(doc)).toBe(true)
    expect(doc.inlineStyle.get(HEADER_HEIGHT_TOKEN)).toBe('76px')
    // A header that grows (tabs wrap on a narrow column) republished, rounded.
    doc.headerRectHeight = 96.4
    expect(syncHeaderHeight(doc)).toBe(true)
    expect(doc.inlineStyle.get(HEADER_HEIGHT_TOKEN)).toBe('96px')
    // A zero-height or absent header is NOT a measurement.
    doc.headerRectHeight = 0
    expect(syncHeaderHeight(doc)).toBe(false)
    expect(doc.inlineStyle.get(HEADER_HEIGHT_TOKEN)).toBe('96px')
    // The fallback the sheet carries meanwhile is the host's own min-height.
    expect(DEFAULT_HEADER_HEIGHT).toBe(76)
    expect(skinCss()).toContain(`var(--dsh-moonset-header-h, ${DEFAULT_HEADER_HEIGHT}px)`)
  })

  it('retries the measurement a bounded number of times, and stops on teardown', async () => {
    vi.useFakeTimers()
    try {
      const doc = new StubDocument()
      // The plugin activates before the conversation exists: the ladder runs.
      const cancel = scheduleHeaderMeasure(doc)
      expect(doc.inlineStyle.has(HEADER_HEIGHT_TOKEN)).toBe(false)
      // The host renders between attempts; the next tick measures and STOPS.
      doc.headerRectHeight = 84
      await vi.advanceTimersByTimeAsync(250)
      expect(doc.inlineStyle.get(HEADER_HEIGHT_TOKEN)).toBe('84px')
      // ...and nothing keeps firing afterwards (no clock, no observer).
      doc.headerRectHeight = 120
      await vi.advanceTimersByTimeAsync(10_000)
      expect(doc.inlineStyle.get(HEADER_HEIGHT_TOKEN)).toBe('84px')
      cancel()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a teardown before the header exists leaves no timer and no property', async () => {
    vi.useFakeTimers()
    try {
      const doc = new StubDocument()
      const cancel = scheduleHeaderMeasure(doc)
      cancel()
      doc.headerRectHeight = 90
      await vi.advanceTimersByTimeAsync(10_000)
      // The cancelled ladder never runs: the sheet keeps its fallback.
      expect(doc.inlineStyle.has(HEADER_HEIGHT_TOKEN)).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes the measured offset away with the material', () => {
    const doc = new StubDocument()
    doc.headerRectHeight = 76
    mountSkin(doc)
    expect(doc.inlineStyle.get(HEADER_HEIGHT_TOKEN)).toBe('76px')
    // Glass off: the scroll body returns to the host's flow — no residue.
    updateSkin({ glass: false }, doc)
    expect(doc.inlineStyle.has(HEADER_HEIGHT_TOKEN)).toBe(false)
    // ...and the same on the way out.
    updateSkin({ glass: true }, doc)
    expect(doc.inlineStyle.get(HEADER_HEIGHT_TOKEN)).toBe('76px')
    unmountSkin(doc)
    expect(doc.inlineStyle.size).toBe(0)
  })

  it('never puts #root AFTER the phase gate (the M4 selector inversion)', () => {
    const css = skinCss()
    // M4 shipped `[data-phase='active'] #root [data-slot='conversation.header'] > header`.
    // `#root` is the React container, i.e. an ANCESTOR of the phase element, so that
    // selector matched nothing: the header never got its z-index, the transcript
    // painted over it (clicks dead), and the plane was pushed behind the text (no
    // veil, no blur). This guard makes the inversion impossible to reintroduce:
    // inside any selector, the `#root` token must come BEFORE the phase gate.
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .flatMap((chunk) => chunk.split('{')[0].split(','))
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0)
    for (const selector of selectors) {
      const phase = selector.indexOf("[data-phase='active']")
      if (phase === -1) continue
      const root = selector.indexOf('#root')
      if (root !== -1) expect(root, selector).toBeLessThan(phase)
    }
    // ...and the three phase-gated rules really are spelled the working way.
    const gate = 'html[data-moonset-skin][data-moonset-glass]'
    expect(css).toContain(`${gate} [data-phase='active'] [data-slot='conversation.header'] > header {`)
    expect(css).toContain(`${gate} [data-phase='active'] [data-conversation-scroll] {`)
    expect(css).toContain(`${gate} [data-phase='active'] [data-conversation-scroll] :has(> [data-code-block-banner]) {`)
    // The header face itself (no phase gate) keeps its #root-rooted hook.
    expect(css).toContain(`${gate} #root [data-slot='conversation.header'] > header {`)
  })

  it('parks the code block banner ON the header edge — the air, negated', () => {
    const css = skinCss()
    // The host paints the banner wrapper `position: sticky; top: 0` inside the
    // scrollport (`._bannerWrap_kjs70_24{position:sticky;top:0;z-index:6}`, read
    // out of the shipped frontend bundle) and reaches it with
    // `:has(> [data-code-block-banner])` — the attribute the banner itself carries
    // (the same shape the host's own compaction offset uses,
    // MessageItem.module.css:81), so it is the host's contract, not a class guess.
    const at = css.indexOf(':has(> [data-code-block-banner])')
    expect(at).toBeGreaterThan(-1)
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    // G1 (0.1.5): the pin is the float's AIR, negated. Measured on a Chromium
    // fixture that reproduces this chain (76px host header + the float + the host
    // code block), the rule is  gap = air + top :
    //   before (top: H)      gap = 12 + 76 = 88px
    //   top: 0               gap = 12px
    //   top: calc(H - 12px)  gap = H = 76px
    //   top: -12px           gap = 0px   <- shipped
    // ...and H drops out of the formula, so a stale measurement cannot move the
    // banner (the same fixture at H=96 with a 76px header also measures 0px).
    const padding = /padding-top: calc\(var\(--dsh-moonset-header-h, (\d+)px\) \+ (\d+)px\)/.exec(css)
    expect(padding).not.toBeNull()
    const air = Number(padding![2])
    expect(air).toBe(12)
    expect(body.trim()).toBe('top: -' + air + 'px;')
    // No `[class*=` and no wildcard sweep: outside comments the sheet has three
    // asterisks — the two step-row sibling cells and the float's `calc(-1 * ...)`.
    expect(css).not.toContain('[class')
    const rulesOnly = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rulesOnly.match(/\*/g) ?? []).toHaveLength(3)
  })

  it('puts backdrop-filter on leaf planes only — never on a host container', () => {
    // P6's whole point: the filter belongs to a plane with no content of its own.
    // Landing it on a container (or on the ground rule) would make that container
    // a backdrop root for everything inside it, and blur the content it owns.
    const css = skinCss().replace(/\/\*[\s\S]*?\*\//g, '')
    const filtered = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map(([, selector, body]) => ({ selector: selector.trim(), body }))
      .filter(({ body }) => body.includes('backdrop-filter'))
    expect(filtered).toHaveLength(2)
    for (const { selector } of filtered) {
      expect(selector.endsWith('::before')).toBe(true)
      expect(selector).toContain('[data-moonset-glass]')
    }
  })
})

/* ------------------------------------------------------------------ *
 * 0.1.5 三处色彩条目（G2 卡片 / G3 上下文行 / G4 浅色失败红）          *
 * ------------------------------------------------------------------ */

describe('skinCss — 0.1.5 色彩条目', () => {
  /**
   * Split a selector list on its TOP-LEVEL commas. The G3 selector carries a
   * comma inside `:has(…)`, so a plain split would cut it in half.
   */
  function splitSelectors(text: string): string[] {
    const out: string[] = []
    let depth = 0
    let buffer = ''
    for (const character of text) {
      if (character === '(') depth += 1
      else if (character === ')') depth -= 1
      if (character === ',' && depth === 0) {
        out.push(buffer.trim())
        buffer = ''
        continue
      }
      buffer += character
    }
    if (buffer.trim().length > 0) out.push(buffer.trim())
    return out.filter(Boolean)
  }

  /** The 0.1.5 segment of a sheet, comments stripped: selectors + declarations. */
  function colourRules(css: string = skinCss()): { selectors: string[]; declarations: string[] }[] {
    const start = css.indexOf('/* 0.1.5 G2/G3/G4')
    if (start === -1) throw new Error('the sheet carries no 0.1.5 segment:\n' + css)
    const text = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, '')
    return [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
      selectors: splitSelectors(match[1]),
      declarations: match[2].split(';').map((part) => part.trim()).filter(Boolean),
    }))
  }

  /** One custom property's value inside one rule. */
  function declared(rule: { declarations: string[] }, property: string): string {
    const prefix = property + ': '
    const hit = rule.declarations.find((entry) => entry.startsWith(prefix))
    if (hit === undefined) throw new Error('no ' + property + ' in ' + JSON.stringify(rule))
    return hit.slice(prefix.length)
  }

  it('0.1.5 G2: paints the turn-changes card as ONE bluish surface, card-scoped', () => {
    const css = skinCss()
    const card = colourRules(css).find((rule) => rule.selectors.some((selector) => selector.includes('[data-changed-files]')))
    if (card === undefined) throw new Error('no [data-changed-files] rule')
    // The card is addressed by the attribute ChangedFiles.tsx:69 renders on its
    // root; behind it the host paints
    // `.card{--changes-fill: var(--dsw-alias-card-fill); …; background: var(--dsw-alias-bg-layer-1)}`
    // (ChangedFiles.module.css:2 — same text in the shipped deliverables bundle).
    expect(card.selectors).toEqual(['html[data-moonset-skin] body [data-changed-files]'])
    // Three declarations, and NOT one of them is the `background` shorthand: the
    // host radius and its overflow stay untouched.
    expect(card.declarations).toEqual([
      'background-color: var(--dsw-alias-bg-layer-2)',
      'border-color: var(--dsw-alias-border-l2)',
      '--changes-fill: var(--dsw-alias-bg-layer-2)',
    ])
    // D3: the layer re-point is CARD-SCOPED. The layer tokens appear nowhere else
    // in the sheet — no `:root`/`body` override, so no other card, popover or menu
    // changes with it.
    for (const match of css.matchAll(/--dsw-alias-bg-layer-[12]/g)) {
      const index = match.index ?? -1
      expect(css.slice(css.lastIndexOf('}', index) + 1, index)).toContain('[data-changed-files]')
    }
    expect(css.match(/--dsw-alias-bg-layer-[12]/g) ?? []).toHaveLength(2)
    // Both tokens exist in BOTH schemes (a typo would paint nothing at all), and
    // the dark surface is not the one it replaces: the card moved off the neutral
    // grey header (card-fill) onto the bluish layer family.
    for (const token of ['--dsw-alias-bg-layer-2', '--dsw-alias-border-l2']) {
      expect(MOONSET_LIGHT[token], token).toBeDefined()
      expect(MOONSET_DARK[token], token).toBeDefined()
    }
    expect(MOONSET_DARK['--dsw-alias-bg-layer-2']).not.toBe(MOONSET_DARK['--dsw-alias-card-fill'])
    expect(MOONSET_DARK['--dsw-alias-bg-layer-2']).not.toBe(MOONSET_DARK['--dsw-alias-bg-layer-1'])
  })

  it('0.1.5 G3: gives the context-injection row the step-row hue, and only that row', () => {
    const css = skinCss()
    const row = colourRules(css).find((rule) => rule.selectors.some((selector) => selector.includes('[data-disclosure-row]')))
    if (row === undefined) throw new Error('no [data-disclosure-row] rule')
    // The row root carries no `data-variant` (ContextInjectionRow.tsx:51 is a plain
    // DisclosureRow), so the 0.1.3 class rules cannot reach it. Its only stable
    // hooks are the two the collapsed content publishes:
    //   [data-context-source]   ContextInjectionRow.tsx:69
    //   [data-context-summary]  ContextInjectionRow.tsx:73
    expect(row.selectors).toEqual([
      'html[data-moonset-skin] body [data-disclosure-row]:has([data-context-source], [data-context-summary])',
    ])
    // SAME mechanism as the step rows: one colour, the SAME custom property, the
    // same accent fallback. The title inherits it (TextShimmer's root and text are
    // `color: inherit` in the shipped sheet), while .source / .summary / .chevron
    // set their own label colours.
    expect(row.declarations).toEqual([
      'color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500))',
    ])
    // 正文 untouched: nothing addresses the expanded body, and neither collapsed
    // cell is painted (that would out-rank the host's own tertiary label).
    expect(css).not.toContain('[data-context-injection-body]')
    expect(css).not.toContain('[data-context-source] {')
    expect(css).not.toContain('[data-context-summary] {')
    // Failure priority unchanged: the row rule sets an INHERITED colour, so an
    // explicit `color` on a cell (the failed-step rule) still wins.
    const failedAt = css.indexOf("[data-variant][data-state='error']")
    expect(failedAt).toBeGreaterThan(-1)
    expect(css.slice(failedAt)).toContain('color: var(--dsh-moonset-error, var(--dsw-alias-state-error-primary))')
  })

  it('0.1.5 G4: mutes the light failure red and leaves the dark scheme byte-for-byte', () => {
    const css = skinCss()
    const gate = colourRules(css).find((rule) => rule.selectors.some((selector) => selector.includes(':not([data-ds-dark-theme])')))
    if (gate === undefined) throw new Error('no light-only gate rule')
    expect(gate.selectors).toEqual(['html[data-moonset-skin] body:not([data-ds-dark-theme])'])
    const mix = declared(gate, '--dsh-moonset-error')
    // The step hues' own recipe, one scheme down: 70% of the error token, 30% of
    // the label ink. Only the LIGHT scheme declares it; dark reads the fallback.
    expect(mix).toBe(
      'color-mix(in srgb, var(--dsw-alias-state-error-primary) 70%, var(--dsw-alias-label-primary))',
    )
    const lightMix = colourOf(MOONSET_LIGHT, mix)
    const asHex = (colour: Rgba): string => '#' + [colour.r, colour.g, colour.b]
      .map((channel) => Math.round(channel).toString(16).padStart(2, '0').toUpperCase()).join('')
    // #B31B3E -> #821934: 9.43:1 on the canvas, 7.77:1 on the exit capsule's own
    // violet fill (measured, and re-derived below).
    expect(asHex(lightMix)).toBe('#821934')
    const canvasRatio: Record<string, number> = {}
    const capsuleRatio: Record<string, number> = {}
    for (const [scheme, table, colour] of [
      ['light', MOONSET_LIGHT, lightMix],
      ['dark', MOONSET_DARK, colourOf(MOONSET_DARK, MOONSET_DARK['--dsw-alias-state-error-primary'])],
    ] as const) {
      const canvas = colourOf(table, table['--dsw-alias-bg-base'])
      const capsule = colourOf(table, table['--dsw-alias-bg-module-platform'])
      canvasRatio[scheme] = contrastRatio(colour, canvas)
      capsuleRatio[scheme] = contrastRatio(colour, capsule)
      expect(
        canvasRatio[scheme],
        scheme + ' failed step on the canvas = ' + canvasRatio[scheme].toFixed(2) + ':1',
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        capsuleRatio[scheme],
        scheme + ' exit capsule fill = ' + capsuleRatio[scheme].toFixed(2) + ':1',
      ).toBeGreaterThanOrEqual(4.5)
    }
    // The light colour moved (mixing toward the ink can only DARKEN it — that is
    // the muting); the dark one is the 0.1.4 value bit for bit.
    const before = contrastRatio(
      colourOf(MOONSET_LIGHT, MOONSET_LIGHT['--dsw-alias-state-error-primary']),
      colourOf(MOONSET_LIGHT, MOONSET_LIGHT['--dsw-alias-bg-base']),
    )
    expect(before).toBeCloseTo(6.41, 2)
    expect(canvasRatio['light']).toBeCloseTo(9.43, 2)
    expect(capsuleRatio['light']).toBeCloseTo(7.77, 2)
    expect(canvasRatio['dark']).toBeCloseTo(8.10, 2)
    expect(capsuleRatio['dark']).toBeCloseTo(6.93, 2)
    // Why NOT a paler red (D2): the palette's lighter reds cannot hold AA on the
    // capsule's own fill — red-400 is below 4.5 on the canvas, and a canvas mix at
    // 82% is 4.78:1 on the canvas but 3.94:1 ON THE CAPSULE.
    const lighter = colourOf(MOONSET_LIGHT, MOONSET_LIGHT['--dsw-static-red-400'])
    expect(contrastRatio(lighter, colourOf(MOONSET_LIGHT, MOONSET_LIGHT['--dsw-alias-bg-base']))).toBeLessThan(4.5)
    const paler = colourOf(MOONSET_LIGHT, 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 82%, var(--dsw-alias-bg-base))')
    expect(contrastRatio(paler, colourOf(MOONSET_LIGHT, MOONSET_LIGHT['--dsw-alias-bg-module-platform']))).toBeLessThan(4.5)
  })

  it('0.1.5: the three entries ride no switch and write no layout', () => {
    const reference = colourRules()
    expect(reference).toHaveLength(3)
    // Every switch combination carries the block, byte for byte.
    for (const options of [{ glow: false }, { glass: false }, { glow: false, glass: false }, { scope: 'all' as const }]) {
      expect(colourRules(skinCss(options)), JSON.stringify(options)).toEqual(reference)
    }
    // Colour-only: no layout property, no literal colour, no imperative CSS.
    const css = skinCss()
    const segment = css.slice(css.indexOf('/* 0.1.5 G2/G3/G4'))
    expect(segment).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow|inset|z-index|top)\s*:/)
    expect(segment).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(segment).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    expect(segment).not.toContain('!important')
    expect(segment).not.toMatch(/\[class|\*=/)
    // Root-gated like every other rule (P2), and no host class name anywhere.
    for (const rule of reference) {
      for (const selector of rule.selectors) expect(selector.startsWith('html[data-moonset-skin]')).toBe(true)
      for (const declaration of rule.declarations) expect(declaration).not.toContain('.')
    }
  })
})
