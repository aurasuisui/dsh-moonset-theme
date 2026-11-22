import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { MOONSET_CLASSES, MOONSET_DARK, MOONSET_LIGHT } from '../src/client/palettes'

/**
 * M3 contract: the two Moonset tables must cover the installed 228-token
 * ladder exactly, be derived from themes/moonset-palette.json (no value may
 * fall back to an official one outside B1), and keep a readable contrast
 * hierarchy in both schemes.
 *
 * The contrast checks carry their own resolver: var(--dsw-static-...) is
 * expanded inside the same scheme's table, color-mix(in srgb, A x%, B) is
 * computed with the CSS rule (a missing percentage is 100% minus the other),
 * and hex / rgb() / rgba() / transparent / white are supported. That is enough
 * to read every token a contract touches, and it means the assertions describe
 * what the browser would actually paint rather than what the table says.
 */

const TOKENS_URL = new URL('../themes/dsw-tokens.json', import.meta.url)
const PALETTE_URL = new URL('../themes/moonset-palette.json', import.meta.url)
const MODULE_URL = new URL('../src/client/palettes.ts', import.meta.url)

const TOKEN_COUNT = 228
const STATIC_COUNT = 82

const ROLES = [
  'canvas', 'elevated', 'subtle',
  'inkPrimary', 'inkSecondary', 'inkMuted',
  'accent', 'accentUi', 'accentGlow',
  'borderHairline', 'borderStrong',
  'success', 'warning', 'danger', 'info', 'moon',
] as const

const SCHEMES = ['light', 'dark'] as const
type Scheme = (typeof SCHEMES)[number]

const TABLES: Record<Scheme, Record<string, string>> = {
  light: MOONSET_LIGHT,
  dark: MOONSET_DARK,
}

interface OfficialTable {
  light: Record<string, string>
  dark: Record<string, string>
}

const official = JSON.parse(readFileSync(TOKENS_URL, 'utf8')) as OfficialTable
const board = JSON.parse(readFileSync(PALETTE_URL, 'utf8')) as Record<Scheme, Record<string, string>>

/** hex / rgb() / rgba() / color-mix() / var(--dsw-...) — the four official shapes. */
const VALUE_SHAPE = /^(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|color-mix\(|var\(--)/

/* ------------------------------------------------------------------ *
 * classification (recomputed here from the spec, compared to the file) *
 * ------------------------------------------------------------------ */

type ValueClass = 'static' | 'expression' | 'neutralLiteral' | 'chromaLiteral' | 'unmapped'

const CLASS_FIELD: Record<ValueClass, 'static' | 'expression' | 'neutralLiteral' | 'chromaLiteral' | 'unmapped'> = {
  static: 'static',
  expression: 'expression',
  neutralLiteral: 'neutralLiteral',
  chromaLiteral: 'chromaLiteral',
  unmapped: 'unmapped',
}

const PURE_NEUTRAL = /^rgba?\(\s*(?:0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*(?:,\s*[0-9.]+\s*)?\)$/
const PURE_NEUTRAL_HEX = /^#(?:000|000000|fff|ffffff)$/i

function classifyValue(token: string, value: string): ValueClass {
  if (token.startsWith('--dsw-static-')) return 'static'
  if (/^var\(--dsw-[a-z0-9-]+\)$/.test(value)) return 'expression'
  if (value.startsWith('color-mix(')) return 'expression'
  if (PURE_NEUTRAL.test(value) || PURE_NEUTRAL_HEX.test(value) || value === 'transparent') {
    return 'neutralLiteral'
  }
  if (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\(/.test(value)) return 'chromaLiteral'
  return 'unmapped'
}

/* ------------------------------------------------------------------ *
 * colour resolver                                                     *
 * ------------------------------------------------------------------ */

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const NAMED: Record<string, Rgba> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
}

function parseColour(value: string): Rgba | null {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (hex !== null) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    }
  }
  const fn = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(value)
  if (fn !== null) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) }
  }
  const named = NAMED[value]
  return named === undefined ? null : { ...named }
}

function toneOf(part: string): { colour: string; pct: number | null } {
  const weighted = /^(.*?)\s+([0-9.]+)%$/.exec(part)
  if (weighted !== null) return { colour: weighted[1].trim(), pct: Number(weighted[2]) }
  return { colour: part.trim(), pct: null }
}

/** Resolve one token value to straight (non-premultiplied) sRGB. */
function resolveValue(value: string, table: Record<string, string>, depth = 0): Rgba {
  if (depth > 12) throw new Error('resolution is too deep: ' + value)
  const trimmed = value.trim()
  const reference = /^var\((--dsw-[a-z0-9-]+)\)$/.exec(trimmed)
  if (reference !== null) {
    const target = table[reference[1]]
    if (target === undefined) throw new Error('unresolved reference ' + reference[1] + ' in ' + trimmed)
    return resolveValue(target, table, depth + 1)
  }
  if (trimmed.startsWith('color-mix(')) {
    const inner = trimmed.slice('color-mix('.length, -1)
    const parts = inner.split(',').map((part) => part.trim())
    if (parts[0] !== 'in srgb') throw new Error('only color-mix(in srgb, ...) is resolvable: ' + trimmed)
    const first = toneOf(parts[1])
    const second = toneOf(parts[2])
    let shareA = first.pct
    let shareB = second.pct
    if (shareA === null && shareB === null) {
      shareA = 50
      shareB = 50
    } else if (shareA === null) {
      shareA = 100 - (shareB as number)
    } else if (shareB === null) {
      shareB = 100 - shareA
    }
    const a = resolveValue(first.colour, table, depth + 1)
    const b = resolveValue(second.colour, table, depth + 1)
    const t = (shareA as number) / 100
    return {
      r: a.r * t + b.r * (1 - t),
      g: a.g * t + b.g * (1 - t),
      b: a.b * t + b.b * (1 - t),
      a: a.a * t + b.a * (1 - t),
    }
  }
  const direct = parseColour(trimmed)
  if (direct !== null) return direct
  throw new Error('cannot resolve colour value: ' + trimmed)
}

/** Paint a possibly translucent colour over an opaque backdrop. */
function over(foreground: Rgba, backdrop: Rgba): Rgba {
  const alpha = foreground.a
  return {
    r: foreground.r * alpha + backdrop.r * (1 - alpha),
    g: foreground.g * alpha + backdrop.g * (1 - alpha),
    b: foreground.b * alpha + backdrop.b * (1 - alpha),
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

/** Contrast of one token painted over another token, translucency included. */
function contrastOn(table: Record<string, string>, token: string, baseToken: string): number {
  const base = resolveValue(table[baseToken], table)
  const painted = over(resolveValue(table[token], table), base)
  return contrastRatio(painted, base)
}

/* ------------------------------------------------------------------ *
 * generator access (dynamic specifier keeps this file free of a       *
 * typed .mjs import while still running the real generator)           *
 * ------------------------------------------------------------------ */

interface GeneratorModule {
  buildPalettes: () => {
    tables: Record<Scheme, Record<string, string>>
    classes: Record<Scheme, Record<string, number>>
  }
  renderModule: (built: unknown) => string
}

async function loadGenerator(): Promise<GeneratorModule> {
  const url = new URL('../scripts/generate-palettes.mjs', import.meta.url).href
  return (await import(/* @vite-ignore */ url)) as GeneratorModule
}

/* ------------------------------------------------------------------ *
 * tests                                                               *
 * ------------------------------------------------------------------ */

describe('moonset token tables', () => {
  it('covers exactly the official 228 keys in both schemes', () => {
    const lightKeys = Object.keys(MOONSET_LIGHT).sort()
    const darkKeys = Object.keys(MOONSET_DARK).sort()
    expect(lightKeys).toHaveLength(TOKEN_COUNT)
    expect(darkKeys).toHaveLength(TOKEN_COUNT)
    expect(lightKeys).toEqual(Object.keys(official.light).sort())
    expect(darkKeys).toEqual(Object.keys(official.dark).sort())
    expect(lightKeys).toEqual(darkKeys)
    expect(Object.keys(MOONSET_LIGHT)).toEqual(lightKeys)
    expect(Object.keys(MOONSET_DARK)).toEqual(darkKeys)
  })

  it('keeps every value non-empty and in a CSS colour shape', () => {
    for (const scheme of SCHEMES) {
      for (const [token, value] of Object.entries(TABLES[scheme])) {
        expect(value.length, scheme + ' ' + token).toBeGreaterThan(0)
        expect(VALUE_SHAPE.test(value), scheme + ' ' + token + ' = ' + value).toBe(true)
      }
    }
  })

  it('classifies every official value (A + B1 + B2 + B3 = 228, B4 = 0)', () => {
    for (const scheme of SCHEMES) {
      const counts: Record<ValueClass, number> = {
        static: 0, expression: 0, neutralLiteral: 0, chromaLiteral: 0, unmapped: 0,
      }
      for (const [token, value] of Object.entries(official[scheme])) {
        counts[classifyValue(token, value)] += 1
      }
      expect(MOONSET_CLASSES[scheme].static).toBe(counts[CLASS_FIELD.static])
      expect(MOONSET_CLASSES[scheme].expression).toBe(counts[CLASS_FIELD.expression])
      expect(MOONSET_CLASSES[scheme].neutralLiteral).toBe(counts[CLASS_FIELD.neutralLiteral])
      expect(MOONSET_CLASSES[scheme].chromaLiteral).toBe(counts[CLASS_FIELD.chromaLiteral])
      expect(MOONSET_CLASSES[scheme].unmapped).toBe(0)
      expect(counts.unmapped).toBe(0)
      expect(counts.static).toBe(STATIC_COUNT)
      expect(
        counts.static + counts.expression + counts.neutralLiteral + counts.chromaLiteral,
      ).toBe(TOKEN_COUNT)
    }
  })

  it('never falls back to an official value outside B1', () => {
    let checked = 0
    for (const scheme of SCHEMES) {
      for (const [token, value] of Object.entries(official[scheme])) {
        if (classifyValue(token, value) === 'expression') continue
        checked += 1
        expect(TABLES[scheme][token], scheme + ' ' + token).not.toBe(value)
      }
    }
    expect(checked).toBeGreaterThan(60)
  })

  it('replaces every chroma literal instead of keeping the official colour', () => {
    let checked = 0
    for (const scheme of SCHEMES) {
      for (const [token, value] of Object.entries(official[scheme])) {
        if (classifyValue(token, value) !== 'chromaLiteral') continue
        checked += 1
        const generated = TABLES[scheme][token]
        expect(generated, scheme + ' ' + token).not.toBe(value)
        expect(/^#[0-9A-F]{6}$|^rgba\(/.test(generated), scheme + ' ' + token + ' = ' + generated).toBe(true)
      }
    }
    expect(checked).toBe(
      MOONSET_CLASSES.light.chromaLiteral + MOONSET_CLASSES.dark.chromaLiteral,
    )
  })

  it('copies every var()/color-mix() expression verbatim so class A carries it', () => {
    let checked = 0
    for (const scheme of SCHEMES) {
      for (const [token, value] of Object.entries(official[scheme])) {
        if (classifyValue(token, value) !== 'expression') continue
        checked += 1
        expect(TABLES[scheme][token], scheme + ' ' + token).toBe(value)
      }
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('pins every family 500 rung to its board anchor colour', () => {
    const anchors: [string, string][] = [
      ['--dsw-static-blue-500', 'accentUi'],
      ['--dsw-static-deepseek-500', 'accent'],
      ['--dsw-static-green-500', 'success'],
      ['--dsw-static-amber-500', 'moon'],
      ['--dsw-static-red-500', 'danger'],
      ['--dsw-static-neutral-500', 'inkSecondary'],
      ['--dsw-static-neutral-bluish-500', 'inkMuted'],
    ]
    for (const scheme of SCHEMES) {
      for (const [token, role] of anchors) {
        expect(TABLES[scheme][token].toUpperCase(), scheme + ' ' + token).toBe(
          board[scheme][role].toUpperCase(),
        )
      }
    }
  })

  it('covers the 0.2.2 primitives (neutral-bluish-55/90/310, violet-400/600)', () => {
    const added = [
      '--dsw-static-neutral-bluish-55',
      '--dsw-static-neutral-bluish-90',
      '--dsw-static-neutral-bluish-310',
      '--dsw-static-violet-400',
      '--dsw-static-violet-600',
    ]
    for (const scheme of SCHEMES) {
      for (const token of added) {
        expect(TABLES[scheme][token], scheme + ' ' + token).toMatch(/^#[0-9A-F]{6}$/)
        expect(TABLES[scheme][token], scheme + ' ' + token).not.toBe(official[scheme][token])
      }
    }
  })

  it('gives the seven json-tree tokens explicit values (keyword and number kept apart)', () => {
    const suffixes = ['hover', 'icon', 'keyword', 'number', 'property', 'punctuation', 'string']
    for (const scheme of SCHEMES) {
      for (const suffix of suffixes) {
        const token = '--dsw-alias-json-tree-' + suffix
        expect(TABLES[scheme][token], scheme + ' ' + token).toBeTypeOf('string')
        expect(TABLES[scheme][token], scheme + ' ' + token).not.toBe(official[scheme][token])
      }
      expect(Object.keys(TABLES[scheme])).toContain('--dsw-alias-json-tree-keyword')
      expect(Object.keys(TABLES[scheme])).toContain('--dsw-alias-json-tree-number')
    }
  })

  it('resolves every var() reference inside its own scheme table', () => {
    for (const scheme of SCHEMES) {
      const table = TABLES[scheme]
      const references = new Set<string>()
      for (const [token, value] of Object.entries(table)) {
        for (const match of value.matchAll(/var\((--dsw-[a-z0-9-]+)\)/g)) {
          expect(table[match[1]], token + ' -> ' + match[1]).toBeTypeOf('string')
          references.add(match[1])
        }
      }
      expect(references.size).toBeGreaterThan(0)
    }
  })

  it('never generates the upstream-retired token', () => {
    for (const scheme of SCHEMES) {
      expect(TABLES[scheme]['--dsw-specific-sidebar-nav-item-hover']).toBeUndefined()
    }
  })

  it('keeps the label hierarchy monotonic in both schemes', () => {
    const order = [
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--dsw-alias-label-caption',
      '--dsw-alias-label-dimmed',
    ]
    for (const scheme of SCHEMES) {
      const table = TABLES[scheme]
      const ratios = order.map((token) => contrastOn(table, token, '--dsw-alias-bg-base'))
      for (let index = 1; index < ratios.length; index += 1) {
        expect(ratios[index - 1], scheme + ': ' + order[index - 1] + ' > ' + order[index]).toBeGreaterThan(ratios[index])
      }
      expect(ratios[0], scheme + ': primary label floor').toBeGreaterThanOrEqual(7)
    }
  })
})

describe('moonset source board', () => {
  it('shapes themes/moonset-palette.json as 16 hex roles per scheme', () => {
    expect(Object.keys(board).sort()).toEqual(['dark', 'light'])
    for (const scheme of SCHEMES) {
      expect(Object.keys(board[scheme]).sort()).toEqual([...ROLES].sort())
      for (const role of ROLES) {
        expect(board[scheme][role], scheme + '.' + role).toMatch(/^#[0-9A-Fa-f]{6}$/)
      }
    }
  })
})

describe('generated module', () => {
  it('ships pure data with the generator and both inputs named in its header', () => {
    const source = readFileSync(MODULE_URL, 'utf8').replace(/\r\n/g, '\n')
    expect(source).toContain('scripts/generate-palettes.mjs')
    expect(source).toContain('themes/moonset-palette.json')
    expect(source).toContain('themes/dsw-tokens.json')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\b(?:console|document|window|globalThis)\./)
    expect(source).not.toMatch(/^function\s|=>/m)
    expect(source.endsWith('\n')).toBe(true)
  })

  it('is reproducible from the two inputs (no hand edits, no timestamps)', async () => {
    const generator = await loadGenerator()
    const built = generator.buildPalettes()
    const committed = readFileSync(MODULE_URL, 'utf8').replace(/\r\n/g, '\n')
    expect(generator.renderModule(built)).toBe(committed)
    expect(built.tables.light).toEqual(MOONSET_LIGHT)
    expect(built.tables.dark).toEqual(MOONSET_DARK)
    expect(built.classes.light).toEqual(MOONSET_CLASSES.light)
    expect(built.classes.dark).toEqual(MOONSET_CLASSES.dark)
  })
})

/* ------------------------------------------------------------------ *
 * contrast contracts                                                  *
 * ------------------------------------------------------------------ */

interface Contract {
  what: string
  token: string
  base: string
  min?: number
  max?: number
}

/**
 * Readability floor of the theme, not of the reference palette: label-primary
 * has to be body-text readable (7:1), the secondary/tertiary rungs stay at AA
 * (4.5:1), status colours only need to read as colours (3:1), and border-l1 is
 * a hairline that must stay under 1.5:1 — a strong border would repaint the
 * whole UI.
 */
const CONTRACTS: Contract[] = [
  { what: 'label-primary on bg-base', token: '--dsw-alias-label-primary', base: '--dsw-alias-bg-base', min: 7 },
  { what: 'label-secondary on bg-base', token: '--dsw-alias-label-secondary', base: '--dsw-alias-bg-base', min: 4.5 },
  { what: 'label-tertiary on bg-base', token: '--dsw-alias-label-tertiary', base: '--dsw-alias-bg-base', min: 4.5 },
  { what: 'link on bg-base', token: '--dsw-alias-link', base: '--dsw-alias-bg-base', min: 4.5 },
  { what: 'state-success-primary on bg-base', token: '--dsw-alias-state-success-primary', base: '--dsw-alias-bg-base', min: 3 },
  { what: 'state-error-primary on bg-base', token: '--dsw-alias-state-error-primary', base: '--dsw-alias-bg-base', min: 3 },
  { what: 'state-business-primary on bg-base', token: '--dsw-alias-state-business-primary', base: '--dsw-alias-bg-base', min: 4.5 },
  { what: 'border-l1 stays a hairline', token: '--dsw-alias-border-l1', base: '--dsw-alias-bg-base', max: 1.5 },
  { what: 'toast label on toast material', token: '--dsw-alias-toast-label', base: '--dsw-alias-toast-bg', min: 4.5 },
  { what: 'document-preview label on its page', token: '--dsw-alias-label-document-preview', base: '--dsw-alias-bg-document-preview', min: 4.5 },
  { what: 'hovercard secondary label on its card', token: '--dsw-alias-hovercard-label-secondary', base: '--dsw-alias-hovercard-bg', min: 4.5 },
]

for (const scheme of SCHEMES) {
  describe(scheme + ' contrast contract', () => {
    const table = TABLES[scheme]
    for (const contract of CONTRACTS) {
      it(scheme + ': ' + contract.what, () => {
        const ratio = contrastOn(table, contract.token, contract.base)
        if (contract.max !== undefined) {
          expect(ratio, contract.token + ' over ' + contract.base + ' = ' + ratio.toFixed(2)).toBeLessThanOrEqual(contract.max)
        }
        if (contract.min !== undefined) {
          expect(ratio, contract.token + ' over ' + contract.base + ' = ' + ratio.toFixed(2)).toBeGreaterThanOrEqual(contract.min)
        }
      })
    }
  })
}
