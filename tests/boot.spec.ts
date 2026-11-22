// @vitest-environment node
/**
 * M6: the first-paint palette and its handover.
 *
 * Two halves meet here, so the cases are grouped by contract rather than by
 * file:
 *
 *  - the HOST rows (`src/boot-palette.ts`) — which choices paint, with which
 *    table, and why a value can never escape the `<style>` element it is
 *    concatenated into;
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

/** The declaration list one table must render to, in table order. */
function tableDeclarations(tokens: Record<string, string>): string[] {
  return Object.entries(tokens).map(([name, value]) => `${name}:${value}`)
}

/**
 * The declarations inside the first `html body{…}` block at or after `from`.
 *
 * Parsing the block back out (instead of substring-matching values) is what
 * makes the assertions count TOKENS: a value that swallowed the block boundary
 * would change the split, not just a string.
 * @param html - the injected row's markup.
 * @param from - offset to start looking at (0 = the first block).
 * @returns each `name:value` pair, in emitted order.
 */
function declarationsAt(html: string, from: number): string[] {
  const marker = 'html body{'
  const open = html.indexOf(marker, from)
  if (open < 0) throw new Error(`no "${marker}" block at/after offset ${from}`)
  const start = open + marker.length
  const end = html.indexOf('}', start)
  if (end < 0) throw new Error('unterminated "html body{…}" block')
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

describe('bootPaletteRows — fixed choices', () => {
  it('paints the light table as exactly one head html row carrying the boot attribute', () => {
    const rows = bootPaletteRows({ choice: ref('light') })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'html', placement: 'head' })

    const html = htmlOf(rows[0])
    expect(html.startsWith(`<style ${BOOT_SHEET_ATTR}>`)).toBe(true)
    expect(html.endsWith('</style>')).toBe(true)
    // The selector is the load-bearing part: (0,0,2) against the official
    // `body` token block (0,0,1), which the Client installs LATER in the page.
    expect(html).toContain('html body{')

    const declarations = declarationsAt(html, 0)
    expect(declarations).toHaveLength(228)
    expect(declarations).toEqual(tableDeclarations(MOONSET_LIGHT))
  })

  it('paints the dark table the same way, with values taken from MOONSET_DARK', () => {
    const rows = bootPaletteRows({ choice: ref('dark') })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'html', placement: 'head' })

    const declarations = declarationsAt(htmlOf(rows[0]), 0)
    expect(declarations).toHaveLength(228)
    expect(declarations).toEqual(tableDeclarations(MOONSET_DARK))
    // The two tables are genuinely different: a mix-up cannot pass both cases.
    expect(declarations).not.toEqual(tableDeclarations(MOONSET_LIGHT))
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
    expect(bootPaletteRows({ choice: ref('light') })).toHaveLength(1)
  })
})

describe('bootPaletteRows — follow the OS', () => {
  it('paints both halves, the dark one behind a media query, plus one body script', () => {
    const rows = bootPaletteRows({ choice: ref('follow') })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'html', placement: 'head' })
    expect(rows[1]).toMatchObject({ kind: 'script', placement: 'body' })

    const html = htmlOf(rows[0])
    expect(html.startsWith(`<style ${BOOT_SHEET_ATTR}>`)).toBe(true)

    // Light is the default block; the dark half must come AFTER it so it wins at
    // equal specificity, and it must be behind the media query, not the attribute.
    const lightAt = html.indexOf('html body{')
    const mediaAt = html.indexOf('@media (prefers-color-scheme: dark)')
    expect(lightAt).toBeGreaterThan(-1)
    expect(mediaAt).toBeGreaterThan(lightAt)
    expect(declarationsAt(html, 0)).toEqual(tableDeclarations(MOONSET_LIGHT))
    expect(declarationsAt(html, mediaAt)).toEqual(tableDeclarations(MOONSET_DARK))

    // The script is the reference implementation's: it only aligns the shell's
    // dark-variant attribute with the OS, and can never close its own element.
    const script = scriptOf(rows[1])
    expect(script).toBe(followPaletteScript())
    expect(script).toContain("toggleAttribute('data-ds-dark-theme'")
    expect(script).toContain("matchMedia('(prefers-color-scheme: dark)').matches")
    expect(script.toLowerCase()).not.toContain('</script')
  })
})

describe('bootPaletteRows — CSS safety', () => {
  it('drops an unsafe value, warns once, and keeps the other 227 declarations', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const tampered = { ...MOONSET_LIGHT, '--dsw-alias-bg-base': '}</style><script>x</script>' }
      const html = bootSheet(tampered)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('--dsw-alias-bg-base')

      const declarations = declarationsAt(html, 0)
      expect(declarations).toHaveLength(227)
      expect(declarations).toEqual(
        Object.entries(MOONSET_LIGHT)
          .filter(([name]) => name !== '--dsw-alias-bg-base')
          .map(([name, value]) => `${name}:${value}`),
      )

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
    expect(table).toHaveLength(1)
    expect(table[0]).toMatchObject({ kind: 'html', placement: 'head' })
    expect(declarationsAt(htmlOf(table[0]), 0)).toEqual(tableDeclarations(MOONSET_DARK))

    // `off` contributes nothing — and an empty table is a legal result, so the
    // render must not throw either way.
    const offCtx = new FakeHostContext()
    apply(offCtx as unknown as Context, { choice: ref('off') })
    const untouched: BootPaletteRow[] = []
    expect(() => offCtx.emit('webserver/index-inject', untouched)).not.toThrow()
    expect(untouched).toEqual([])
  })
})
