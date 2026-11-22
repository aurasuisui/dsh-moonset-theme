// @vitest-environment node
/**
 * M6: the first-paint palette and its handover.
 *
 * Two halves meet here, so the cases are grouped by contract rather than by
 * file:
 *
 *  - the HOST rows (`src/boot-palette.ts`) — which choices paint, with which
 *    table, which SELECTORS (both are load-bearing against the official blocks)
 *    and why a value can never escape the `<style>` element it is concatenated
 *    into;
 *  - the CLIENT removal (`src/client/boot-cleanup.ts`) — the sheet must go the
 *    moment the theme owns the tokens, and its absence must never throw;
 *  - the WIRING (`src/index.ts`) — the `webServer` dependency and the one
 *    `webserver/index-inject` listener, driven through a hand-written stub.
 *
 * No DOM implementation is involved (this repo carries none — PLAN 九、已知债):
 * the removal takes a structural `querySelector` root, so the stub below can be
 * as small as the production call and a new DOM dependency would show up as a
 * missing member instead of passing silently.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  BOOT_SHEET_ATTR,
  bootPaletteRows,
  bootPaletteScript,
  bootSheet,
  followPaletteScript,
  type BootPaletteRow,
} from '../src/boot-palette'
import {
  BOOT_SHEET_ATTR as CLIENT_BOOT_SHEET_ATTR,
  BOOT_SHEET_SELECTOR,
  removeBootSheet,
} from '../src/client/boot-cleanup'
import { MOONSET_DARK, MOONSET_LIGHT } from '../src/client/palettes'
import { apply, inject } from '../src/index'

/** A volatile config ref: the shape DSH >= 0.1.7 hands `apply`. */
const ref = (value: unknown) => ({ get: () => value })

/**
 * The canvas declaration every block must end with.
 *
 * Restated as a literal on purpose: this is the declaration that turns the first
 * VISIBLE pixel from the official `#151517` into the flavour's colour, so the
 * test should fail if the production constant is ever reworded.
 */
const CANVAS = 'background-color:var(--dsw-alias-bg-base)'

/**
 * The selector lists the sheet is painted on. `html body` (0,0,2) wins against
 * the official `body` block; `html body[data-ds-dark-theme]` (0,1,2) is what
 * wins against the official DARK block, which sits at (0,1,1) and would
 * otherwise beat a bare `html body`.
 */
const FIXED_SELECTOR = 'html body,html body[data-ds-dark-theme]{'
const FOLLOW_LIGHT_SELECTOR = 'html body,html body:not([data-ds-dark-theme]){'
const FOLLOW_DARK_SELECTOR = 'html body,html body[data-ds-dark-theme]{'
const FOLLOW_MEDIA = '@media (prefers-color-scheme: dark)'

/** The declaration list one table must render to, in table order. */
function tableDeclarations(tokens: Record<string, string>): string[] {
  return Object.entries(tokens).map(([name, value]) => `${name}:${value}`)
}

/** What one full block must contain: the table's tokens, then the canvas. */
function expectedBlock(tokens: Record<string, string>): string[] {
  return [...tableDeclarations(tokens), CANVAS]
}

/**
 * The declarations inside the first block opened by `selector` at/after `from`.
 *
 * Parsing the block back out (instead of substring-matching values) is what
 * makes the assertions count TOKENS: a value that swallowed the block boundary
 * would change the split, not just a string.
 * @param html - the injected row's markup.
 * @param selector - the exact selector list plus its opening brace.
 * @param from - offset to start looking at.
 * @returns each `name:value` pair, in emitted order.
 */
function declarationsAt(html: string, selector: string, from = 0): string[] {
  const open = html.indexOf(selector, from)
  if (open < 0) throw new Error(`no "${selector}" block at/after offset ${from}`)
  const start = open + selector.length
  const end = html.indexOf('}', start)
  if (end < 0) throw new Error(`unterminated "${selector}" block`)
  const block = html.slice(start, end)
  return block === '' ? [] : block.split(';')
}

/** The markup of an expected `html` row (another kind is a test failure). */
function htmlOf(row: BootPaletteRow | undefined): string {
  if (row === undefined || row.kind !== 'html') {
    throw new Error(`expected a kind:"html" row, got ${JSON.stringify(row)?.slice(0, 120)}`)
  }
  return row.html
}

/** The text of an expected `script` row (another kind is a test failure). */
function scriptOf(row: BootPaletteRow | undefined): string {
  if (row === undefined || row.kind !== 'script') {
    throw new Error(`expected a kind:"script" row, got ${JSON.stringify(row)?.slice(0, 120)}`)
  }
  return row.text
}

/** The token count of a rendered block, canvas excluded. */
const tokenCount = (declarations: string[]): number =>
  declarations.filter((declaration) => declaration.startsWith('--dsw-')).length

describe('bootPaletteRows — fixed choices', () => {
  it('paints the light table on the double selector, canvas included, plus a light script', () => {
    const rows = bootPaletteRows({ choice: ref('light') })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'html', placement: 'head' })
    expect(rows[1]).toMatchObject({ kind: 'script', placement: 'body' })

    const html = htmlOf(rows[0])
    expect(html.startsWith(`<style ${BOOT_SHEET_ATTR}>`)).toBe(true)
    expect(html.endsWith('</style>')).toBe(true)
    // BOTH selectors, one declaration block: the attribute cannot flip the
    // sheet to the official table while it lives.
    expect(html).toContain(FIXED_SELECTOR)

    const declarations = declarationsAt(html, FIXED_SELECTOR)
    expect(tokenCount(declarations)).toBe(228)
    expect(declarations).toEqual(expectedBlock(MOONSET_LIGHT))
    // The canvas is LAST: it is the first visible pixel, and it must win inside
    // the block over any token that could have set the same property.
    expect(declarations.at(-1)).toBe(CANVAS)
    expect(declarations.filter((declaration) => declaration === CANVAS)).toHaveLength(1)

    // The body script makes the shell's attribute agree with what we painted.
    expect(scriptOf(rows[1])).toBe("(()=>{document.body.toggleAttribute('data-ds-dark-theme',false)})()")
  })

  it('paints the dark table the same way, with MOONSET_DARK values and a dark script', () => {
    const rows = bootPaletteRows({ choice: ref('dark') })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'html', placement: 'head' })
    expect(rows[1]).toMatchObject({ kind: 'script', placement: 'body' })

    const declarations = declarationsAt(htmlOf(rows[0]), FIXED_SELECTOR)
    expect(tokenCount(declarations)).toBe(228)
    expect(declarations).toEqual(expectedBlock(MOONSET_DARK))
    expect(declarations).not.toEqual(expectedBlock(MOONSET_LIGHT))

    expect(scriptOf(rows[1])).toBe("(()=>{document.body.toggleAttribute('data-ds-dark-theme',true)})()")
    // The script switches with the flavour — a fixed `true` would pin dark.
    expect(bootPaletteScript('light')).not.toBe(bootPaletteScript('dark'))
  })
})

describe('bootPaletteRows — everything that must NOT paint', () => {
  it('returns no rows without a usable choice: off, unknown, empty, or no value at all', () => {
    expect(bootPaletteRows(undefined)).toEqual([])
    expect(bootPaletteRows({})).toEqual([])
    expect(bootPaletteRows({ choice: ref('off') })).toEqual([])
    expect(bootPaletteRows({ choice: ref('') })).toEqual([])
    // A theme id is not a choice: the union is off / light / dark / follow.
    expect(bootPaletteRows({ choice: ref('moonset-dark') })).toEqual([])
    expect(bootPaletteRows({ choice: ref(undefined) })).toEqual([])
    expect(bootPaletteRows({ choice: ref(null) })).toEqual([])
    expect(bootPaletteRows({ choice: ref(42) })).toEqual([])
    // A getter that throws is "no value" — the Host must never fail a render.
    expect(bootPaletteRows({
      choice: { get() { throw new Error('settings document not loaded') } },
    })).toEqual([])
  })

  it('returns no rows on a legacy host, where the config field is not a volatile ref', () => {
    // Below DSH 0.1.7 the entry config is the profile patch's STATIC value, not
    // the settings document — painting it would fight the durable choice.
    expect(bootPaletteRows({ choice: 'light' })).toEqual([])
    expect(bootPaletteRows({ choice: 'dark' })).toEqual([])
    expect(bootPaletteRows({ choice: 'follow' })).toEqual([])
    // The same values DO paint once they arrive through a ref.
    expect(bootPaletteRows({ choice: ref('light') })).toHaveLength(2)
  })
})

describe('bootPaletteRows — follow the OS', () => {
  it('paints both halves with their own selector list, plus one matchMedia script', () => {
    const rows = bootPaletteRows({ choice: ref('follow') })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'html', placement: 'head' })
    expect(rows[1]).toMatchObject({ kind: 'script', placement: 'body' })

    const html = htmlOf(rows[0])
    expect(html.startsWith(`<style ${BOOT_SHEET_ATTR}>`)).toBe(true)

    // Light is the default block; the dark half must come AFTER it so it wins at
    // equal specificity, and it must be behind the media query, not the attribute.
    const lightAt = html.indexOf(FOLLOW_LIGHT_SELECTOR)
    const mediaAt = html.indexOf(FOLLOW_MEDIA)
    expect(lightAt).toBeGreaterThan(-1)
    expect(mediaAt).toBeGreaterThan(lightAt)
    expect(html.indexOf(FOLLOW_DARK_SELECTOR)).toBeGreaterThan(mediaAt)

    expect(declarationsAt(html, FOLLOW_LIGHT_SELECTOR)).toEqual(expectedBlock(MOONSET_LIGHT))
    expect(declarationsAt(html, FOLLOW_DARK_SELECTOR, mediaAt)).toEqual(expectedBlock(MOONSET_DARK))

    // The script is the reference implementation's: it only aligns the shell's
    // dark-variant attribute with the OS, and can never close its own element.
    const script = scriptOf(rows[1])
    expect(script).toBe(followPaletteScript())
    expect(script).toContain("toggleAttribute('data-ds-dark-theme'")
    expect(script).toContain("matchMedia('(prefers-color-scheme: dark)').matches")
    expect(script.toLowerCase()).not.toContain('</script')
  })
})

describe('the canvas declaration', () => {
  it('ends every painted block — both fixed schemes and both follow halves', () => {
    const lightHtml = htmlOf(bootPaletteRows({ choice: ref('light') })[0])
    const darkHtml = htmlOf(bootPaletteRows({ choice: ref('dark') })[0])
    const followHtml = htmlOf(bootPaletteRows({ choice: ref('follow') })[0])
    const mediaAt = followHtml.indexOf(FOLLOW_MEDIA)

    const blocks: [string, string[]][] = [
      ['light', declarationsAt(lightHtml, FIXED_SELECTOR)],
      ['dark', declarationsAt(darkHtml, FIXED_SELECTOR)],
      ['follow/light', declarationsAt(followHtml, FOLLOW_LIGHT_SELECTOR)],
      ['follow/dark', declarationsAt(followHtml, FOLLOW_DARK_SELECTOR, mediaAt)],
    ]
    for (const [label, declarations] of blocks) {
      // The label rides the compared strings, so a failure says which block.
      expect(`${label}:${declarations.at(-1)}`).toBe(`${label}:${CANVAS}`)
      expect(`${label}:${declarations.filter((entry) => entry === CANVAS).length}`).toBe(`${label}:1`)
      expect(`${label}:${tokenCount(declarations)}`).toBe(`${label}:228`)
      expect(`${label}:${declarations.length}`).toBe(`${label}:229`)
    }
  })
})

describe('bootPaletteRows — CSS safety', () => {
  it('drops an unsafe value, warns once, and keeps the other 227 tokens plus the canvas', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const tampered = { ...MOONSET_LIGHT, '--dsw-alias-bg-base': '}</style><script>x</script>' }
      const html = bootSheet(tampered)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('--dsw-alias-bg-base')

      const declarations = declarationsAt(html, FIXED_SELECTOR)
      expect(tokenCount(declarations)).toBe(227)
      expect(declarations).toEqual([
        ...Object.entries(MOONSET_LIGHT)
          .filter(([name]) => name !== '--dsw-alias-bg-base')
          .map(([name, value]) => `${name}:${value}`),
        CANVAS,
      ])

      // The element's own closing tag is the only one the row may contain: the
      // row contract is "html must not close the element early".
      const inner = html.slice(0, -'</style>'.length).toLowerCase()
      expect(inner).not.toContain('</style')
      expect(inner).not.toContain('<script')
    } finally {
      warn.mockRestore()
    }
  })
})

/** One stand-in for a `<style>` element; `remove()` is its only mutation. */
class FakeStyle {
  removed = false
  constructor(readonly attributes: Record<string, string>) {}
  remove(): void { this.removed = true }
}

/** A document stub: answers exactly our selector and keeps its own ledger. */
class FakeDocument {
  readonly queries: string[] = []
  constructor(private readonly elements: FakeStyle[]) {}
  querySelector(selector: string): FakeStyle | null {
    this.queries.push(selector)
    if (selector !== BOOT_SHEET_SELECTOR) return null
    return this.elements.find(
      (element) => element.attributes[BOOT_SHEET_ATTR] !== undefined && !element.removed,
    ) ?? null
  }
}

describe('removeBootSheet', () => {
  it('removes only our own sheet, tolerates a missing one, and is idempotent', () => {
    // The two halves restate the attribute (separate bundles); a drift here is a
    // silent "sheet never removed", so it is pinned rather than trusted.
    expect(CLIENT_BOOT_SHEET_ATTR).toBe(BOOT_SHEET_ATTR)
    expect(BOOT_SHEET_SELECTOR).toBe(`style[${BOOT_SHEET_ATTR}]`)

    const ours = new FakeStyle({ [BOOT_SHEET_ATTR]: '' })
    const peer = new FakeStyle({ class: 'some-peer-sheet' })
    const page = new FakeDocument([peer, ours])

    expect(removeBootSheet(page)).toBe(true)
    expect(ours.removed).toBe(true)
    // A <style> without our attribute is somebody else's and stays untouched.
    expect(peer.removed).toBe(false)
    expect(page.queries).toEqual([BOOT_SHEET_SELECTOR])

    // Idempotent: the page now has nothing to remove, and says so quietly.
    expect(() => removeBootSheet(page)).not.toThrow()
    expect(removeBootSheet(page)).toBe(false)
    // A page that never carried a sheet is a normal no-op too.
    expect(removeBootSheet(new FakeDocument([peer]))).toBe(false)
    // No document at all (this suite runs under node) — the boot path must not throw.
    expect(removeBootSheet()).toBe(false)
  })
})

/** The slice of a cordis host context M6 touches: `on` plus a manual emit. */
class FakeHostContext {
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  on(name: string, listener: (...args: unknown[]) => void): () => void {
    const list = this.listeners.get(name) ?? []
    list.push(listener)
    this.listeners.set(name, list)
    return () => {
      const at = list.indexOf(listener)
      if (at >= 0) list.splice(at, 1)
    }
  }

  emit(name: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(...args)
  }

  listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0
  }
}

describe('apply — the host listener', () => {
  it('declares the webServer dependency and pushes the durable choice into the table', () => {
    expect(inject).toEqual(['webServer'])

    const ctx = new FakeHostContext()
    apply(ctx as unknown as Context, { choice: ref('dark') })
    expect(ctx.listenerCount('webserver/index-inject')).toBe(1)

    const table: BootPaletteRow[] = []
    ctx.emit('webserver/index-inject', table)
    expect(table).toHaveLength(2)
    expect(table[0]).toMatchObject({ kind: 'html', placement: 'head' })
    expect(table[1]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(declarationsAt(htmlOf(table[0]), FIXED_SELECTOR)).toEqual(expectedBlock(MOONSET_DARK))
    expect(scriptOf(table[1])).toBe(bootPaletteScript('dark'))

    // `off` contributes nothing — and an empty table is a legal result, so the
    // render must not throw either way.
    const offCtx = new FakeHostContext()
    apply(offCtx as unknown as Context, { choice: ref('off') })
    const untouched: BootPaletteRow[] = []
    expect(() => offCtx.emit('webserver/index-inject', untouched)).not.toThrow()
    expect(untouched).toEqual([])
  })
})
