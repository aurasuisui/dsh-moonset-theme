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
import { apply } from '../src/client/index'
import { MOONSET_DARK, MOONSET_LIGHT, MOONSET_TOKEN_OVERRIDES } from '../src/client/palettes'
import {
  SKIN_ATTR,
  SKIN_SHEET_ATTR,
  SKIN_SHEET_SELECTOR,
  mountSkin,
  skinCss,
  syncSkin,
  unmountSkin,
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

/** The 0.1.2 ground segment, restated verbatim. */
const EXPECTED_GLOW_CSS = [
  '/* 0.1.2 ground: canvas + wash + two fixed spots in ONE declaration. The',
  '   strength factor is inlined in each color-mix (`calc(N% * 1)` = 100% here):',
  '   a custom-property hop would not recompute on Chromium (0.1.2 D2). */',
  'html[data-moonset-skin] body {',
  '  background:',
  '    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--dsw-static-deepseek-500) calc(16% * 1), transparent) 0%, transparent 62%),',
  '    radial-gradient(ellipse at 92% 88%, color-mix(in srgb, var(--dsw-static-amber-500) calc(10% * 1), transparent) 0%, transparent 60%),',
  '    linear-gradient(165deg, color-mix(in srgb, var(--dsw-static-deepseek-500) calc(1.5% * 1), transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);',
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

  it('stays inside the whitelist budget: <= 40 lines, four rules, no layout', () => {
    const css = skinCss()
    const lines = css.split('\n')

    expect(lines.length).toBeLessThanOrEqual(40)
    // Four blocks: text selection, the selected-item label colour, the selected
    // tab's underline, the 0.1.2 ground.
    expect(lines.filter((line) => line === 'html body ::selection {')).toHaveLength(1)
    expect(css.match(/\{/g)).toHaveLength(4)
    expect(css.match(/\}/g)).toHaveLength(4)
    // Every additive block stays well inside the 12-line entry budget.
    const selectedStart = css.indexOf("html[data-moonset-skin] body [aria-selected")
    const underlineStart = css.indexOf("html[data-moonset-skin] body [data-active='true']::after")
    const underlineEnd = css.indexOf('}', underlineStart) + 1
    const groundStart = css.indexOf('html[data-moonset-skin] body {')
    expect(selectedStart).toBeGreaterThan(-1)
    expect(underlineStart).toBeGreaterThan(selectedStart)
    expect(groundStart).toBeGreaterThan(underlineStart)
    expect(css.slice(selectedStart, underlineStart).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(underlineStart, underlineEnd).split('\n').length).toBeLessThanOrEqual(12)
    expect(css.slice(groundStart).split('\n').length).toBeLessThanOrEqual(12)
    // No layout, no structure, no conditional animation: this sheet paints.
    expect(css).not.toMatch(/@media|@supports|!important|animation|transition/)
    expect(css).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow)\s*:/)
  })

  it('takes every colour from a token and writes no literal', () => {
    const css = skinCss()

    // Every declaration reads a `--dsw-*` token: the accent at several
    // opacities, the moon anchor for the warm light, and the canvas under the
    // ground. Nothing is duplicated as a literal.
    const tokens = css.match(/var\(--dsw-[a-z0-9-]+\)/g) ?? []
    expect(new Set(tokens)).toEqual(new Set([`var(${ACCENT})`, `var(${MOON})`, `var(${CANVAS})`]))
    // accent x6 (selection bg/text, label, underline, halo, wash) + moon + canvas.
    expect(tokens).toHaveLength(8)
    // Nothing opaque: no hex, no rgb()/hsl() literal anywhere in the sheet.
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
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

  it('paints the ground from tokens only, root-gated, strength inlined', () => {
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

    // Colours are tokens mixed with transparent — and the alpha carries the
    // strength factor INLINE. No literal colour, no intermediate custom
    // property (a property hop is what breaks the M2 knob — D2).
    expect(declarations).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(declarations).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    expect(declarations).not.toMatch(/--[a-z0-9-]+\s*:/)
    expect(declarations).not.toContain('dsh-moonset-glow-strength')
    const mixes = [
      ...declarations.matchAll(
        /color-mix\(in srgb, var\((--dsw-static-[a-z0-9-]+)\) calc\(([\d.]+)% \* 1\), transparent\)/g,
      ),
    ]
    expect(mixes.map((match) => [match[1], Number(match[2])])).toEqual([
      [ACCENT, 16],
      [MOON, 10],
      [ACCENT, 1.5],
    ])
    expect(declarations.match(/calc\([\d.]+% \* 1\)/g)).toHaveLength(3)
  })

  it('carries BOTH spots: indigo moon halo top-centre, amber warm light bottom-right', () => {
    const spots = [
      ...skinCss().matchAll(
        /radial-gradient\(ellipse at (\d+)% (-?\d+)%, color-mix\(in srgb, var\((--dsw-static-[a-z0-9-]+)\) calc\(([\d.]+)% \* 1\), transparent\) 0%, transparent (\d+)%\)/g,
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
    // Top-centre (-10% pulls the halo off the top edge) and the 92%/88% corner.
    expect(spot(spots[0])).toEqual({ x: 50, y: -10, token: ACCENT, alpha: 16, fade: 62 })
    expect(spot(spots[1])).toEqual({ x: 92, y: 88, token: MOON, alpha: 10, fade: 60 })
    // Both hues are the board's own anchors in each scheme: no second colour
    // source, and the warm light is exactly the palette's `moon` role.
    expect(MOONSET_LIGHT[MOON]).toBe(board.light.moon.toUpperCase())
    expect(MOONSET_DARK[MOON]).toBe(board.dark.moon.toUpperCase())
    expect(MOONSET_LIGHT[ACCENT]).toBe(board.light.accent.toUpperCase())
    expect(MOONSET_DARK[ACCENT]).toBe(board.dark.accent.toUpperCase())
  })

  it('keeps the wash inside the <= 2/255 horizontal band at 1920x1080', () => {
    const css = skinCss()
    // A 165deg CSS gradient spans L = W·|sin θ| + H·|cos θ|; moving horizontally
    // by dx shifts the gradient position by dx·|sin θ| / L. The wash starts at
    // `alpha` and dies at `fade`, so left vs right edge differ by
    // alpha · (W·sin θ / L) / fade. The colour deltas are the palette's own.
    const wash =
      /linear-gradient\(165deg, color-mix\(in srgb, var\((--dsw-[a-z0-9-]+)\) calc\(([\d.]+)% \* 1\), transparent\) 0%, transparent (\d+)%\)/.exec(
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

  it('stays ONE root-gated sheet inside the 40-line budget (P2)', () => {
    const css = skinCss()
    const lines = css.split('\n')
    expect(lines.length).toBeLessThanOrEqual(40)
    // 0.1.1's 19 lines + the 9-line ground segment.
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

