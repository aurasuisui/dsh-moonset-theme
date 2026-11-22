import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Contract for the M2 forensic chain: `themes/dsw-tokens.json` must carry the
 * official `--dsw-*` ladder extracted from the installed app.asar, and
 * `themes/baseline-tokens.json` must still hold the frozen 190-name roster
 * (trimming it to make a diff green is forbidden by the milestone contract).
 */

interface TokenTable {
  meta: {
    dshVersion: string
    cssSha256: string
    cssBytes: number
    asarPath: string
    cssPath?: string
    dshPackage?: string
    extractedAt: string
    counts: { light: number; dark: number }
  }
  light: Record<string, string>
  dark: Record<string, string>
}

/** One explicit upstream retirement recorded in themes/retired-tokens.json. */
interface RetiredToken {
  name: string
  frozenIn: string
  retiredIn: string
  evidence: string
  schemes: string[]
}

/** 190 tokens per flavour in the reference repo (dsh-catppuccin-theme@0.7.5). */
const FROZEN_TOKEN_COUNT = 190

/** Every official value is a hex colour, rgb()/rgba(), color-mix() or a var() reference. */
const VALUE_SHAPE = /^(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|color-mix\(|var\(--)/
const SHA256_HEX = /^[0-9a-f]{64}$/
const DSH_VERSION = /^0\.\d+\.\d+/

const TOKENS_URL = new URL('../themes/dsw-tokens.json', import.meta.url)
const BASELINE_URL = new URL('../themes/baseline-tokens.json', import.meta.url)
const RETIRED_URL = new URL('../themes/retired-tokens.json', import.meta.url)

/** Both rosters carry `//` provenance lines; JSON itself has no comments. */
function readJsonc<T>(url: URL): T {
  return JSON.parse(
    readFileSync(url, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n'),
  ) as T
}

const table = JSON.parse(readFileSync(TOKENS_URL, 'utf8')) as TokenTable
const baseline = readJsonc<string[]>(BASELINE_URL)
const retired = readJsonc<RetiredToken[]>(RETIRED_URL)

const schemes: [string, Record<string, string>][] = [
  ['light', table.light],
  ['dark', table.dark],
]

describe('official --dsw-* token table', () => {
  it('covers at least the frozen 190 tokens in both schemes', () => {
    for (const [, tokens] of schemes) {
      expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(FROZEN_TOKEN_COUNT)
    }
    expect(table.meta.counts.light).toBe(Object.keys(table.light).length)
    expect(table.meta.counts.dark).toBe(Object.keys(table.dark).length)
  })

  it('names only unique --dsw-* tokens', () => {
    for (const [, tokens] of schemes) {
      const names = Object.keys(tokens)
      expect(new Set(names).size).toBe(names.length)
      expect(names.filter((name) => !name.startsWith('--dsw-'))).toEqual([])
    }
  })

  it('keeps every value in a shape the official stylesheet uses', () => {
    for (const [, tokens] of schemes) {
      const offShape = Object.entries(tokens).filter(([, value]) => !VALUE_SHAPE.test(value))
      expect(offShape).toEqual([])
    }
  })

  it('anchors the table to a css digest and a dsh version', () => {
    expect(table.meta.cssSha256).toMatch(SHA256_HEX)
    expect(table.meta.dshVersion).toMatch(DSH_VERSION)
    expect(table.meta.cssBytes).toBeGreaterThan(0)
    expect(table.meta.asarPath.length).toBeGreaterThan(0)
    expect(table.meta.extractedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps the frozen roster intact at 190 sorted names', () => {
    expect(baseline).toHaveLength(FROZEN_TOKEN_COUNT)
    expect(new Set(baseline).size).toBe(FROZEN_TOKEN_COUNT)
    expect([...baseline].sort()).toEqual(baseline)
    expect(baseline.filter((name) => !name.startsWith('--dsw-'))).toEqual([])
  })

  it('retires every recorded token out of the installed tables', () => {
    for (const entry of retired) {
      expect(table.light[entry.name]).toBeUndefined()
      expect(table.dark[entry.name]).toBeUndefined()
    }
  })

  it('only retires names the frozen roster still holds', () => {
    const frozen = new Set(baseline)
    expect(retired.filter((entry) => !frozen.has(entry.name))).toEqual([])
  })
})
