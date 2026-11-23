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
  DEFAULT_GLOW_HUE,
  DEFAULT_GLOW_SCOPE,
  DEFAULT_GLOW_STRENGTH,
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
  resolveGlowHue,
  resolveGlowScope,
  resolveGlowStrength,
  skinCss,
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
 * The 0.1.1 half of the sheet, restated verbatim.
 *
 * A literal on purpose: this string IS the whitelist entry, so the test has to
 * fail when the production rule is reworded, re-scoped or grows a declaration.
 * 0.1.2 appends the ground segment below; splitting the halves lets the
 * switch-off case assert the pre-glow sheet returns byte-for-byte.
 */
const EXPECTED_BASE_CSS = [
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
].join('\n')

/** The 0.1.2 ground segment (night anchor + light + the dark override), verbatim. */
const EXPECTED_GLOW_CSS = [
  '/* 0.1.2 hue anchor (M5): the 228-key table carries no usable blue, so the',
  '   skin owns exactly ONE literal colour, used by the nightBlue option. */',
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
  '    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--dsw-static-deepseek-500) 16%, transparent) 0%, transparent 62%),',
  '    radial-gradient(ellipse at 97% 97%, color-mix(in srgb, var(--dsw-static-amber-500) 3%, transparent) 0%, transparent 46%),',
  '    linear-gradient(165deg, color-mix(in srgb, var(--dsw-static-deepseek-500) 1.5%, transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);',
  '}',
  '/* 0.1.2 ground (dark): ONE indigo hue at three footprints (core, halo,',
  '   bottom reflection) plus a thinner wash — depth without a second colour. */',
  'html[data-moonset-skin] body[data-ds-dark-theme] {',
  '  background:',
  '    radial-gradient(circle at 34% 2%, color-mix(in srgb, var(--dsw-static-deepseek-400) 12%, transparent) 0%, transparent 26%),',
  '    radial-gradient(ellipse at 50% -6%, color-mix(in srgb, var(--dsw-static-deepseek-400) 20%, transparent) 0%, transparent 70%),',
  '    radial-gradient(ellipse at 50% 104%, color-mix(in srgb, var(--dsw-static-deepseek-400) 4%, transparent) 0%, transparent 55%),',
  '    linear-gradient(160deg, color-mix(in srgb, var(--dsw-static-deepseek-400) 1%, transparent) 0%, transparent 75%) var(--dsw-alias-bg-base);',
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

/** The complete 0.1.2 sheet: the 0.1.1 rules plus the ground. */
const EXPECTED_CSS = EXPECTED_BASE_CSS + '\n' + EXPECTED_GLOW_CSS


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
  /** Every element ever created or appended (attached and detached). */
  readonly sheets: StubSheet[] = []
  readonly documentElement = {
    setAttribute: (name: string, value: string): void => {
      this.attributes.set(name, value)
    },
    removeAttribute: (name: string): void => {
      this.attributes.delete(name)
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

  it('stays inside the whitelist budget: <= 60 lines, seven rules, no layout', () => {
    const css = skinCss()
    const lines = css.split('\n')

    // 60 since M3 (the dark composition) — the night anchor pairs add two more
    // rules without coming close to the ceiling.
    expect(lines.length).toBeLessThanOrEqual(60)
    // Nine blocks: text selection, the selected-item label colour, the selected
    // tab's underline, the night anchor (light), the night anchor (dark), the
    // light ground, the DARK ground override, the visibility clear, and the M2
    // bottom-band entry (an image, not a colour).
    expect(lines.filter((line) => line === 'html body ::selection {')).toHaveLength(1)
    expect(css.match(/\{/g)).toHaveLength(9)
    expect(css.match(/\}/g)).toHaveLength(9)
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
    expect(selectedStart).toBeGreaterThan(-1)
    expect(underlineStart).toBeGreaterThan(selectedStart)
    expect(anchorStart).toBeGreaterThan(underlineEnd)
    expect(groundStart).toBeGreaterThan(anchorStart)
    expect(darkStart).toBeGreaterThan(groundStart)
    expect(clearStart).toBeGreaterThan(darkStart)
    expect(bandStart).toBeGreaterThan(clearStart)
    expect(css.slice(selectedStart, underlineStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(underlineStart, underlineEnd).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(anchorStart, groundStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(groundStart, darkStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(darkStart, clearStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(clearStart, bandStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(bandStart).split('\n').length).toBeLessThanOrEqual(12)
    // No layout, no structure, no conditional animation: this sheet paints.
    expect(css).not.toMatch(/@media|@supports|!important|animation|transition/)
    expect(css).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow)\s*:/)
  })

  it('takes every colour from a token — except the ONE night anchor (M5)', () => {
    const css = skinCss()

    // Every declaration reads a `--dsw-*` token or the skin's own `--dsh-moonset-`
    // one: the accent at several opacities, the moon anchor for the light glint,
    // the darker indigo for the dark composition, and the canvas under both
    // grounds. The night anchor is the single exception, and it is a
    // `var(--dsh-moonset-night)` reference — not a hex — everywhere it is used.
    const tokens = css.match(/var\(--dsw-[a-z0-9-]+\)/g) ?? []
    expect(new Set(tokens)).toEqual(new Set([
      `var(${ACCENT})`,
      `var(${MOON})`,
      `var(${CANVAS})`,
      'var(--dsw-static-deepseek-400)',
    ]))
    // 0.1.1 rules: accent x4 (selection bg + text, label, underline). Light:
    // accent halo + amber glint + accent wash + canvas. Dark: four deepseek-400
    // layers + canvas.
    expect(tokens).toHaveLength(13)
    // The anchor is DECLARED in every sheet (it is a custom property, unused by
    // the other four hues) and REFERENCED only by the nightBlue ground.
    expect(css).toContain('--dsh-moonset-night: #2563EB;')
    expect(skinCss({ hue: 'nightBlue' })).toContain('var(--dsh-moonset-night)')
    expect(skinCss({ hue: 'accent' })).not.toContain('var(--dsh-moonset-night)')
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
    // No class-name hacks, no wildcard selector, no !important. The `*` in the
    // ground's calc() products is arithmetic, not a selector, so only selector
    // text (everything outside a declaration block) is checked for it.
    const selectorText = rules.replace(/\{[^}]*\}/g, '')
    expect(selectorText).not.toMatch(/\[class|\*=/)
    expect(selectorText).not.toContain('*')
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
    const css = skinCss()
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
    expect(declarations).not.toContain('calc(')
  })

  it('carries BOTH spots: indigo moon halo top-centre, amber warm light bottom-right', () => {
    // The LIGHT block only: the dark override is its own composition (asserted
    // separately below), and mixing the two would count four radials.
    const css = skinCss()
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

  it('gives the DARK scheme its own ground: ONE indigo hue, three footprints', () => {
    const css = skinCss()
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
    // Both schemes ride the same switch: off is the 0.1.1 sheet.
    expect(skinCss({ glow: false })).not.toContain('data-ds-dark-theme')
    // ...and the same strength factor (the dark rows scale too).
    expect(skinCss({ strength: 200 })).toContain('var(--dsw-static-deepseek-400) 40%, transparent')
  })

  it('keeps indigo in charge at every strength: the light ratio never drops below 5:1', () => {
    // The M3 contract in one assertion: whatever the slider does, the amber is a
    // fraction of the indigo (16:3 at 100% ≈ 5.3:1). The first pass shipped
    // 16:6 and the user still read the amber as the subject — a warm hue at the
    // same alpha is brighter on a near-white canvas, so the RATIO is the knob.
    for (const strength of [GLOW_STRENGTH_MIN, 50, 100, 150, GLOW_STRENGTH_MAX]) {
      const alphas = glowAlphas(strength)
      const moon = Number(alphas.moon.replace('%', ''))
      const warm = Number(alphas.warm.replace('%', ''))
      if (moon === 0) {
        expect(warm).toBe(0)
        continue
      }
      expect(moon / warm).toBeGreaterThanOrEqual(5)
    }
    // ...and the geometry says the same thing: the amber ellipse dies at 46%
    // while the moon halo runs to 62%, so it cannot reach the middle of the
    // canvas even at full strength.
    const css = skinCss()
    const light = css.slice(css.indexOf('html[data-moonset-skin] body {'), css.indexOf('/* 0.1.2 ground (dark)'))
    const fades = [...light.matchAll(/0%, transparent (\d+)%\)/g)].map((match) => Number(match[1]))
    expect(fades).toEqual([62, 46, 70])
  })

  it('keeps the DARK composition monochrome: one hue, three footprints', () => {
    // The violet layer was removed on the user's second pass ("不要紫罗兰那层"),
    // so a second indigo step in the dark block is a regression, not a style
    // choice. This test is the guard: only deepseek-400 (and the canvas).
    const css = skinCss()
    const groundAt = css.indexOf('/* 0.1.2 ground (dark)')
    const start = css.indexOf('html[data-moonset-skin] body[data-ds-dark-theme] {', groundAt)
    const dark = css.slice(start, css.indexOf('}', start) + 1)
    expect(dark).not.toContain('amber')
    expect(dark).not.toContain('deepseek-500')
    expect(dark).not.toContain('deepseek-600')
    // Core brighter than halo, halo wider than core: that is the layering.
    expect(darkGlowAlphas(100).core).toBe('12%')
    expect(darkGlowAlphas(100).moon).toBe('20%')
    expect(Number(darkGlowAlphas(100).core.replace('%', '')))
      .toBeLessThan(Number(darkGlowAlphas(100).moon.replace('%', '')))
    expect(dark).toContain('circle at 34% 2%')
    expect(dark).toContain('ellipse at 50% -6%')
    expect(dark).toContain('ellipse at 50% 104%')
  })

  it('drops BOTH grounds — light and dark — when the switch is off', () => {
    // The switch is not a strength: `glow: false` must leave no dark rule, no
    // layer and no scope behind, at any strength (0.1.2 D4's pre-glow screen).
    for (const strength of [GLOW_STRENGTH_MIN, 100, GLOW_STRENGTH_MAX]) {
      const off = skinCss({ glow: false, strength })
      expect(off).toBe(EXPECTED_BASE_CSS)
      expect(off).not.toContain('data-ds-dark-theme')
      expect(off).not.toContain('radial-gradient')
      expect(off).not.toContain('linear-gradient')
    }
  })

  it('keeps the wash inside the <= 2/255 horizontal band at 1920x1080', () => {
    const css = skinCss()
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
    // 60 since M3: the dark scheme is its own four-layer composition.
    expect(lines.length).toBeLessThanOrEqual(60)
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
    // (0.1.2 §一), and D4's bar is a pre-glow screenshot.
    const off = skinCss({ glow: false })
    expect(off).toBe(EXPECTED_BASE_CSS)
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
    expect(off).not.toContain('#root')
    expect(off).toBe(EXPECTED_BASE_CSS)
  })
})

/* ------------------------------------------------------------------ *
 * M2: 地面范围 (A/B/C) and the strength knob                            *
 * ------------------------------------------------------------------ */

describe('skinCss — M2 地面范围 (A/B/C) 与强度', () => {
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
  function visibilityOf(scope: GlowScope): { selectors: string[]; lines: string[] } {
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
    return { selectors, lines: raw.split('\n') }
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
    // C: B plus the sidebar root and the bottom cell — every carrier the M1.5
    // sheet cleared.
    expect(all).toEqual([
      "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])",
      "html[data-moonset-skin] #root :has([data-composer-seat])",
      "html[data-moonset-skin] #root :has(> [data-slot='shell.bottom'])",
      "html[data-moonset-skin] #root [data-slot='main'] > div",
      "html[data-moonset-skin] #root [data-slot='sidebar'] > div",
    ])
    // The nesting the buttons promise: every A selector is in B, every B
    // selector is in C.
    for (const selector of conversation) expect(main).toContain(selector)
    for (const selector of main) expect(all).toContain(selector)
    // And each sheet NAMES its scope, so a DevTools copy is self-describing.
    for (const scope of GLOW_SCOPES) expect(skinCss({ scope })).toContain('scope: ' + scope + ')')
  })

  it('keeps every sheet inside the 60-line budget, for every scope', () => {
    for (const scope of GLOW_SCOPES) {
      const lines = skinCss({ scope }).split('\n')
      // 60 since M3: the dark scheme is its own four-layer composition.
      expect(lines.length).toBeLessThanOrEqual(60)
      expect(lines.length).toBeGreaterThan(19)
    }
    // The default sheet is B at 100% since M3: on the user's real machine B was
    // the coherent one (C stays selectable as the fully transparent mode).
    expect(skinCss()).toBe(skinCss({ scope: 'main', strength: 100 }))
    expect(DEFAULT_GLOW_SCOPE).toBe('main')
    expect(DEFAULT_GLOW_STRENGTH).toBe(100)
    expect(visibilityOf('main').selectors).toHaveLength(3)
  })

  it('scales the alphas in JS per scheme: 0 / 50 / 100 / 150 / 200 → literals', () => {
    // The table the slider promises, derived from ONE source of truth. LIGHT is
    // the M3 rebalance (indigo 16% : amber 6%), DARK is the four-layer
    // composition (moon 18%, violet 10%, warm 6%, wash 1%).
    expect(glowAlphas(0)).toEqual({ moon: '0%', warm: '0%', wash: '0%' })
    expect(glowAlphas(50)).toEqual({ moon: '8%', warm: '1.5%', wash: '0.75%' })
    expect(glowAlphas(100)).toEqual({ moon: '16%', warm: '3%', wash: '1.5%' })
    expect(glowAlphas(150)).toEqual({ moon: '24%', warm: '4.5%', wash: '2.25%' })
    expect(glowAlphas(200)).toEqual({ moon: '32%', warm: '6%', wash: '3%' })
    // DARK is one hue at three footprints (core / halo / bottom reflection) and
    // a thinner wash — no amber, no second colour (user: 不要紫罗兰那层).
    expect(darkGlowAlphas(0)).toEqual({ moon: '0%', core: '0%', floor: '0%', wash: '0%' })
    expect(darkGlowAlphas(50)).toEqual({ moon: '10%', core: '6%', floor: '2%', wash: '0.5%' })
    expect(darkGlowAlphas(100)).toEqual({ moon: '20%', core: '12%', floor: '4%', wash: '1%' })
    expect(darkGlowAlphas(150)).toEqual({ moon: '30%', core: '18%', floor: '6%', wash: '1.5%' })
    expect(darkGlowAlphas(200)).toEqual({ moon: '40%', core: '24%', floor: '8%', wash: '2%' })
    // The full-strength rows are exactly what skin.ts multiplies.
    const light = glowAlphas(100)
    expect(light).toEqual({
      moon: GLOW_ALPHA_AT_FULL.light.moon + '%',
      warm: GLOW_ALPHA_AT_FULL.light.warm + '%',
      wash: GLOW_ALPHA_AT_FULL.light.wash + '%',
    })
    const dark = darkGlowAlphas(100)
    expect(dark).toEqual({
      moon: GLOW_ALPHA_AT_FULL.dark.moon + '%',
      core: GLOW_ALPHA_AT_FULL.dark.core + '%',
      floor: GLOW_ALPHA_AT_FULL.dark.floor + '%',
      wash: GLOW_ALPHA_AT_FULL.dark.wash + '%',
    })
    // The emitted sheet carries those literals — and never a calc().
    const doubled = skinCss({ strength: 200 })
    expect(doubled).toContain('var(--dsw-static-deepseek-500) 32%, transparent')
    expect(doubled).toContain('var(--dsw-static-amber-500) 6%, transparent')
    expect(doubled).toContain('var(--dsw-static-deepseek-500) 3%, transparent')
    expect(doubled).toContain('var(--dsw-static-deepseek-400) 24%, transparent')
    expect(doubled).toContain('var(--dsw-static-deepseek-400) 40%, transparent')
    expect(doubled).toContain('var(--dsw-static-deepseek-400) 8%, transparent')
    expect(doubled).toContain('var(--dsw-static-deepseek-400) 2%, transparent')
    expect(withoutComments(doubled)).not.toContain('calc(')
    // Strength 0 leaves the canvas layer and nothing else, still literal.
    const zero = skinCss({ strength: 0 })
    expect(zero).toContain('color-mix(in srgb, var(--dsw-static-deepseek-500) 0%, transparent)')
    expect(withoutComments(zero)).not.toContain('calc(')
    for (const scope of GLOW_SCOPES) {
      expect(withoutComments(skinCss({ scope }))).not.toContain('calc(')
      expect(withoutComments(skinCss({ scope, strength: 200 }))).not.toContain('calc(')
    }
  })

  it('clamps an out-of-range or unusable strength instead of refusing the skin', () => {
    expect(resolveGlowStrength(undefined)).toBe(DEFAULT_GLOW_STRENGTH)
    expect(resolveGlowStrength(Number.NaN)).toBe(DEFAULT_GLOW_STRENGTH)
    expect(resolveGlowStrength(-40)).toBe(GLOW_STRENGTH_MIN)
    expect(resolveGlowStrength(1e6)).toBe(GLOW_STRENGTH_MAX)
    expect(resolveGlowStrength('150')).toBe(150)
    expect(resolveGlowStrength(149.6)).toBe(150)
    // Same for the scope: anything unrecognized falls back to the default.
    expect(resolveGlowScope(undefined)).toBe(DEFAULT_GLOW_SCOPE)
    expect(resolveGlowScope('sidebar')).toBe(DEFAULT_GLOW_SCOPE)
    expect(resolveGlowScope('conversation')).toBe('conversation')
  })

  it('drops BOTH halves of the 0.1.2 segment when the switch is off, in every scope', () => {
    // Off is the pre-glow 0.1.1 sheet byte-for-byte: no ground, no clear, no
    // remnant of the scope or the strength (0.1.2 D4).
    for (const scope of GLOW_SCOPES) {
      for (const strength of [0, 100, 200]) {
        expect(skinCss({ glow: false, scope, strength })).toBe(EXPECTED_BASE_CSS)
      }
    }
    expect(skinCss({ glow: true })).toBe(EXPECTED_CSS)
  })

  it('clears the composer seat\'s mask band by its IMAGE only (M2 底部白带)', () => {
    // `[data-composer-seat]` is the element the conversation paints its seat on;
    // in the active phase it carries a `bg-base` mask gradient, which over the
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
    // ONE declaration, and it is the image longhand: a `background` shorthand
    // here would also wipe the element's colour and any shadow the host adds.
    expect(declarations).toEqual(['background-image: none'])
    // It is not a carrier entry: no colour clear on the seat itself.
    expect(rule).not.toContain('background-color')
    // The band belongs to the glow segment, so the switch takes it with it.
    expect(skinCss({ glow: false })).not.toContain('bottom band')
    expect(skinCss({ glow: false })).not.toContain('background-image')
    // ...and every scope carries it (the band is inside the conversation).
    for (const scope of GLOW_SCOPES) expect(skinCss({ scope })).toContain('bottom band (M2)')
  })

  it('rebuilds the ONE sheet in place when the options move (updateSkin)', () => {
    const doc = new StubDocument()
    mountSkin(doc)
    expect(doc.attached()).toHaveLength(1)
    const before = doc.attached()[0].textContent
    expect(updateSkin({ scope: 'conversation', strength: 50 }, doc)).toBe(true)
    // Still a singleton, and the rule text moved to the new options.
    expect(doc.attached()).toHaveLength(1)
    const after = doc.attached()[0].textContent
    expect(after).not.toBe(before)
    expect(after).toBe(skinCss({ scope: 'conversation', strength: 50 }))
    expect(after).toContain('scope: conversation)')
    expect(after).toContain('8%, transparent')
    // A document with no sheet yet is mounted by the same call (convergence).
    const fresh = new StubDocument()
    expect(updateSkin({ scope: 'main' }, fresh)).toBe(true)
    expect(fresh.attached()).toHaveLength(1)
    expect(fresh.attached()[0].textContent).toBe(skinCss({ scope: 'main' }))
  })
})

/* ------------------------------------------------------------------ *
 * M4: 光晕色相 (five hues, one shared control)                        *
 * ------------------------------------------------------------------ */

describe('skinCss — M4 光晕色相', () => {
  /** The light ground rule of one sheet (the dark override starts after it). */
  function lightGround(sheet: string): string {
    return sheet.slice(sheet.indexOf('html[data-moonset-skin] body {'), sheet.indexOf('/* 0.1.2 ground (dark)'))
  }

  /** The dark GROUND rule of one sheet (the night anchor rule comes first). */
  function darkGround(sheet: string): string {
    const groundAt = sheet.indexOf('/* 0.1.2 ground (dark)')
    const start = sheet.indexOf('html[data-moonset-skin] body[data-ds-dark-theme] {', groundAt)
    return sheet.slice(start, sheet.indexOf('}', start) + 1)
  }

  it('offers five hues and lets each one repaint the indigo family only', () => {
    expect(GLOW_HUES).toEqual(['accent', 'accentDark', 'accentSoft', 'accentSoftDark', 'nightBlue'])
    for (const hue of GLOW_HUES) {
      const form = GLOW_HUE_AT_FULL[hue]
      const sheet = skinCss({ hue })
      const light = lightGround(sheet)
      const dark = darkGround(sheet)
      // LIGHT: the moon halo and the wash take this hue's light token; the amber
      // glint keeps its own token and its own 3% — the hue control must not move
      // it, because amber is a different role, not a different hue.
      expect(light).toContain(`var(${form.light})`)
      expect(light).toContain('var(--dsw-static-amber-500) 3%, transparent')
      // DARK: all THREE indigo footprints plus the wash use this hue's dark token
      // — one hue, three sizes, whatever the user picked.
      expect(dark).toContain(`var(${form.dark})`)
      expect(dark).not.toContain('amber')
      // No literal colour may enter through the table: the only hexes in any
      // sheet are the night anchor's two declarations (M5's whitelist).
      const hexes = [...sheet.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0])
      expect(hexes).toEqual(['#2563EB', '#60A5FA'])
      expect(sheet.split('\n').length).toBeLessThanOrEqual(60)
    }
    // The two "soft" forms are the SAME tokens at a fraction of the alpha.
    expect(GLOW_HUE_AT_FULL.accentSoft.light).toBe(GLOW_HUE_AT_FULL.accent.light)
    expect(GLOW_HUE_AT_FULL.accentSoftDark.light).toBe(GLOW_HUE_AT_FULL.accentDark.light)
    expect(GLOW_HUE_AT_FULL.accentSoft.factor).toBe(0.56)
    expect(GLOW_HUE_AT_FULL.accentSoftDark.factor).toBe(0.75)
  })

  it('multiplies strength AND the hue factor, then formats a literal percentage', () => {
    // The combined table: strength (0-200) × hue factor (1 / 1 / 0.56 / 0.75 / 1)
    // × the full-strength row. Every number is produced in JS, so the sheet only
    // ever carries literals — never a calc() and never a var() hop.
    const moonAt = (strength: number, hue: GlowHue): string => glowAlphas(strength, hue).moon
    for (const strength of [0, 50, 100, 150, 200]) {
      expect(moonAt(strength, 'accent')).toBe(`${(16 * strength) / 100}%`)
      expect(moonAt(strength, 'nightBlue')).toBe(`${(16 * strength) / 100}%`)
      expect(moonAt(strength, 'accentSoft')).toBe(`${Math.round(16 * strength * 0.56) / 100}%`)
      expect(moonAt(strength, 'accentSoftDark')).toBe(`${Math.round(16 * strength * 0.75) / 100}%`)
      // The amber is NOT scaled by the hue: it is the same 3% at every hue.
      for (const hue of GLOW_HUES) {
        expect(glowAlphas(strength, hue).warm).toBe(`${(3 * strength) / 100}%`)
      }
    }
    // The card's own numbers, spelled out: accentSoft @100% = 8.96% (≈9%), @50% =
    // 4.48% (≈4.5%); accentSoftDark @100% = 12%.
    expect(glowAlphas(100, 'accentSoft').moon).toBe('8.96%')
    expect(glowAlphas(50, 'accentSoft').moon).toBe('4.48%')
    expect(glowAlphas(100, 'accentSoftDark')).toEqual({ moon: '12%', warm: '3%', wash: '1.13%' })
    // DARK scales the same way (core / halo / bottom reflection / wash).
    expect(darkGlowAlphas(100, 'accentSoft')).toEqual({ moon: '11.2%', core: '6.72%', floor: '2.24%', wash: '0.56%' })
    expect(darkGlowAlphas(100, 'accentSoftDark')).toEqual({ moon: '15%', core: '9%', floor: '3%', wash: '0.75%' })
    // ...and the emitted sheet carries those literals.
    expect(skinCss({ hue: 'accentSoft', strength: 100 })).toContain('deepseek-500) 8.96%, transparent')
    expect(skinCss({ hue: 'accentSoftDark', strength: 200 })).toContain('deepseek-400) 24%, transparent')
  })

  it('owns the night-blue anchor: declared twice, read by nightBlue only', () => {
    // The 228-key table has no usable blue (every `blue-*` rung is remapped onto
    // this palette's indigo): the skin therefore owns ONE literal colour and
    // registers it in §11.3. It is declared for both schemes and consumed by the
    // `nightBlue` ground alone.
    const sheet = skinCss({ hue: 'nightBlue' })
    const light = lightGround(sheet)
    const dark = darkGround(sheet)
    expect(light).toContain(`var(${NIGHT_BLUE_TOKEN})`)
    expect(dark).toContain(`var(${NIGHT_BLUE_TOKEN})`)
    // One declaration per scheme, and the dark one hangs off the host marker so
    // it can only win in dark mode.
    expect(sheet).toContain('html[data-moonset-skin] {\n  --dsh-moonset-night: #2563EB;\n}')
    expect(sheet).toContain('html[data-moonset-skin] body[data-ds-dark-theme] {\n  --dsh-moonset-night: #60A5FA;\n}')
    // The hex is NEVER used directly in a gradient: every use is the variable.
    expect(light).not.toContain('#2563EB')
    expect(dark).not.toContain('#60A5FA')
    // The other four hues declare the anchor but never read it.
    for (const hue of GLOW_HUES) {
      if (hue === 'nightBlue') continue
      const other = skinCss({ hue })
      expect(lightGround(other)).not.toContain(`var(${NIGHT_BLUE_TOKEN})`)
      expect(darkGround(other)).not.toContain(`var(${NIGHT_BLUE_TOKEN})`)
    }
  })

  it('ships the night anchor inside the switchable segment, in every scope', () => {
    // The anchor lives in the ground segment, so `glow: false` takes it (and the
    // nightBlue option it serves) with it — the pre-glow sheet stays literal-free.
    const off = skinCss({ glow: false })
    expect(off).not.toContain(NIGHT_BLUE_TOKEN)
    expect(off).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    for (const scope of GLOW_SCOPES) {
      const sheet = skinCss({ scope })
      expect(sheet).toContain('--dsh-moonset-night: #2563EB;')
      expect(sheet).toContain('--dsh-moonset-night: #60A5FA;')
    }
  })

  it('defaults to accent and leaves the 0.1.2 sheet byte-identical', () => {
    // The control starts on the form the user already approved: `accent` is the
    // M3 pair (light deepseek-500 / dark deepseek-400), so adding the selector
    // cannot change a pixel before the user touches it.
    expect(DEFAULT_GLOW_HUE).toBe('accent')
    expect(skinCss()).toBe(skinCss({ hue: 'accent' }))
    expect(skinCss({ hue: 'accent' })).toBe(EXPECTED_CSS)
    expect(GLOW_HUE_AT_FULL.accent).toEqual({
      light: '--dsw-static-deepseek-500',
      dark: '--dsw-static-deepseek-400',
      factor: 1,
    })
    // A value this version does not know falls back to the default, exactly like
    // the scope and the strength (a hand-edited document must not repaint).
    expect(resolveGlowHue(undefined)).toBe(DEFAULT_GLOW_HUE)
    expect(resolveGlowHue('violet')).toBe(DEFAULT_GLOW_HUE)
    expect(resolveGlowHue(null)).toBe(DEFAULT_GLOW_HUE)
    expect(resolveGlowHue('nightBlue')).toBe('nightBlue')
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
        onStrength(next: number): void
      }
      face.onScope('conversation')
      // Debounced: a fast drag must not re-parse the sheet per step.
      expect(sheetText()).toContain('scope: main)')
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS)
      expect(sheetText()).toContain('scope: conversation)')
      // The strength lands as a literal alpha, and the switch drops the segment.
      face.onStrength(200)
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS)
      expect(sheetText()).toContain('32%, transparent')
      face.onToggleGlow(false)
      await vi.advanceTimersByTimeAsync(SKIN_REBUILD_MS)
      expect(sheetText()).not.toContain('radial-gradient')
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

