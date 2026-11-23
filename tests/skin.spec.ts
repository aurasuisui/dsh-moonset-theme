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
 *  - UNMOUNT — attribute off, sheet gone, ZERO residue, idempotent both ways;
 *  - WIRING — `apply()` mounts, the fiber teardown unmounts (`ctx.effect`), so
 *    the skin cannot outlive its plugin;
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
import { apply } from '../src/client/index'
import { MOONSET_DARK, MOONSET_LIGHT, MOONSET_TOKEN_OVERRIDES } from '../src/client/palettes'
import {
  SKIN_ATTR,
  SKIN_SHEET_ATTR,
  SKIN_SHEET_SELECTOR,
  mountSkin,
  skinCss,
  unmountSkin,
  type SkinRoot,
  type SkinSheetElement,
} from '../src/client/skin'

const BOARD_URL = new URL('../themes/moonset-palette.json', import.meta.url)
const board = JSON.parse(readFileSync(BOARD_URL, 'utf8')) as Record<'light' | 'dark', Record<string, string>>

/** The accent the skin draws from: the static token the palette anchors `accent` to. */
const ACCENT = '--dsw-static-deepseek-500'
/** The body-label rung the selection text uses. */
const LABEL = '--dsw-alias-label-primary'

/**
 * The complete sheet, restated here verbatim.
 *
 * A literal on purpose: this string IS the whitelist entry, so the test has to
 * fail when the production rule is reworded, re-scoped or grows a declaration.
 */
const EXPECTED_CSS = [
  '/* dsh-moonset[0.1.1]: skin layer — P5 whitelist, ::selection only */',
  'html body ::selection {',
  '  background: color-mix(in srgb, var(--dsw-static-deepseek-500) 28%, transparent);',
  '  color: var(--dsw-alias-label-primary);',
  '}',
].join('\n')

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

  it('stays inside the whitelist budget: <= 20 lines, one rule, no layout', () => {
    const css = skinCss()
    const lines = css.split('\n')

    expect(lines.length).toBeLessThanOrEqual(20)
    // One selector, one rule: the only block is the selection rule.
    expect(lines.filter((line) => line === 'html body ::selection {')).toHaveLength(1)
    expect(css.match(/\{/g)).toHaveLength(1)
    expect(css.match(/\}/g)).toHaveLength(1)
    // No layout, no structure, no conditional animation: this sheet paints.
    expect(css).not.toMatch(/@media|@supports|!important|animation|transition/)
    expect(css).not.toMatch(/\b(?:display|position|grid|flex|width|height|margin|padding|overflow)\s*:/)
  })

  it('takes every colour from a token and writes no literal', () => {
    const css = skinCss()

    // The tokens the rule reads, in order: the accent, then the label rung.
    expect(css.match(/var\(--dsw-[a-z0-9-]+\)/g)).toEqual([`var(${ACCENT})`, `var(${LABEL})`])
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
    // And the label rung exists in both tables (the selection text is a token).
    expect(MOONSET_LIGHT[LABEL]).toBeTypeOf('string')
    expect(MOONSET_DARK[LABEL]).toBeTypeOf('string')
  })

  it('pairs with the token half: the selected row is an accent wash', () => {
    // The skin is the exception for what tokens cannot do; the selected row is
    // a TOKEN delta (generator TOKEN_OVERRIDES), so the two never overlap.
    const active = '--dsw-specific-sidebar-nav-item-active'
    const accent = '--dsw-specific-sidebar-nav-item-active-accent'
    expect(MOONSET_TOKEN_OVERRIDES).toContain(active)
    expect(MOONSET_TOKEN_OVERRIDES).toContain(accent)
    for (const table of [MOONSET_LIGHT, MOONSET_DARK]) {
      expect(table[active]).toContain(`var(${ACCENT})`)
      expect(table[active]).toContain('10%')
      expect(table[active]).toContain('--dsw-alias-bg-base')
      expect(table[accent]).toBe(`var(${ACCENT})`)
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
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
