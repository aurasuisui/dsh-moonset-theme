// @vitest-environment node
/**
 * 0.1.1 skin layer: one root attribute, one injected sheet, and the exact rules.
 *
 * The cases are grouped by contract rather than by function:
 *
 *  - MOUNT — `<html data-moonset-skin>` and exactly ONE
 *    `<style data-dsh-moonset-skin>` in the head (P2: a second sheet would fight
 *    the first, and the winner would depend on document order);
 *  - THE SHEET — the CSS text is the contract: byte-for-byte, inside the
 *    whitelist budget (<= 20 lines, no layout properties), and every colour
 *    comes from a `--dsw-*` token rather than a literal (P5);
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
 *  - TOKENS — the colours the rule reads are the palette's own accent, i.e. the
 *    sheet follows the theme instead of duplicating it.
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

/**
 * The complete sheet, restated here verbatim.
 *
 * A literal on purpose: this string IS the whitelist entry, so the test has to
 * fail when the production rule is reworded, re-scoped or grows a declaration.
 */
const EXPECTED_CSS = [
  '/* dsh-moonset[0.1.1]: skin — P5 whitelist (selection + selected-item text) */',
  'html body ::selection {',
  '  background: color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent);',
  '  color: var(--dsw-static-deepseek-500);',
  '}',
  '/* selected items: stable attributes only, never a host class name. The root',
  '   attribute gate is what outranks the host (0,2,2 vs .tab[data-active] 0,2,0). */',
  "html[data-moonset-skin] body [aria-selected='true'],",
  "html[data-moonset-skin] body [aria-current='page'],",
  "html[data-moonset-skin] body [aria-current='true'],",
  "html[data-moonset-skin] body [data-active='true'] {",
  '  color: var(--dsw-static-deepseek-500);',
  '}',
].join('\n')


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

  it('stays inside the whitelist budget: <= 20 lines, two rules, no layout', () => {
    const css = skinCss()
    const lines = css.split('\n')

    expect(lines.length).toBeLessThanOrEqual(20)
    // Exactly two blocks: text selection, and the selected-item label colour.
    expect(lines.filter((line) => line === 'html body ::selection {')).toHaveLength(1)
    expect(css.match(/\{/g)).toHaveLength(2)
    expect(css.match(/\}/g)).toHaveLength(2)
    // The selected-item block is the second whitelist entry: <= 12 lines.
    const selectedStart = css.indexOf("html[data-moonset-skin] body [aria-selected")
    expect(selectedStart).toBeGreaterThan(-1)
    expect(css.slice(selectedStart).split('\n').length).toBeLessThanOrEqual(12)
    // No layout, no structure, no conditional animation: this sheet paints.
    expect(css).not.toMatch(/@media|@supports|!important|animation|transition/)
    expect(css).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow)\s*:/)
  })

  it('takes every colour from a token and writes no literal', () => {
    const css = skinCss()

    // Every declaration reads the ONE accent token: the wash and the text are
    // the same colour at different opacities (documentation-site semantics),
    // and the selected-item label reuses it.
    const tokens = css.match(/var\(--dsw-[a-z0-9-]+\)/g) ?? []
    expect(new Set(tokens)).toEqual(new Set([`var(${ACCENT})`]))
    expect(tokens).toHaveLength(3)
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
    // The four hook attributes the real UI actually renders (verified against
    // the installed sources: workspace rows aria-selected, SettingsRoot
    // aria-current='true', main sidebar aria-current='page', plugin tabs
    // aria-selected + data-active). Root-gated (P2), which is also what beats
    // the host's own selected-tab colour rule.
    const selectors = [...css.matchAll(/html\[data-moonset-skin\] body \[[^\]]+\]/g)].map((m) => m[0])
    expect(selectors).toEqual([
      "html[data-moonset-skin] body [aria-selected='true']",
      "html[data-moonset-skin] body [aria-current='page']",
      "html[data-moonset-skin] body [aria-current='true']",
      "html[data-moonset-skin] body [data-active='true']",
    ])
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // No class-name hacks, no wildcard subtree selector, no !important.
    expect(rules).not.toMatch(/\[class|\*=|!important/)
    expect(rules).not.toContain('*')
    // The rule colours the container and lets the label inherit; muted
    // children (timestamps, summaries) set their own colour and keep it.
    const block = /\[data-active='true'\] \{([\s\S]*?)\}/.exec(rules)
    expect(block).not.toBeNull()
    expect(block![1]).toContain(`color: var(${ACCENT});`)
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

