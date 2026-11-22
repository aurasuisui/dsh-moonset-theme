#!/usr/bin/env node
/**
 * Three-way token diff: frozen roster vs installed stylesheet vs retirements.
 *
 *   frozen    themes/baseline-tokens.json   190 names frozen at 0.2.0-rc.2;
 *                                           never trimmed, one key at a time
 *   installed themes/dsw-tokens.json        what the installed app.asar declares
 *   retired   themes/retired-tokens.json    names the upstream really deleted,
 *                                           each with its own evidence line
 *
 *   missing = frozen - installed - retired
 *   live    = distinct installed names (union of both schemes)
 *   added   = installed - frozen
 *
 * A frozen name that merely disappears from the installed stylesheet still
 * fails: the only way it is exempted is an explicit, hand-written retirement
 * entry. A retired name that reappears fails too. Nothing here trims the
 * roster or relaxes the predicate to make the diff green.
 *
 * Exit 1 when any of these holds:
 *   - missing > 0
 *   - meta.dshVersion is empty
 *   - either scheme holds fewer than 190 tokens
 *   - a retired name is present in the installed tables
 *   - a retired name is not part of the frozen roster
 *   - a roster or retirement entry is malformed
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKENS_FILE = join(REPO_ROOT, 'themes', 'dsw-tokens.json')
const BASELINE_FILE = join(REPO_ROOT, 'themes', 'baseline-tokens.json')
const RETIRED_FILE = join(REPO_ROOT, 'themes', 'retired-tokens.json')

/** The frozen roster size: 190 tokens per flavour in the reference repo. */
const FROZEN_MINIMUM = 190
const SCHEMES = ['light', 'dark']

/** Both rosters are JSON with leading `//` provenance lines (JSON has no comments). */
function parseJsonc(file) {
  return JSON.parse(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n'),
  )
}

function parseBaseline(file) {
  const roster = parseJsonc(file)
  if (!Array.isArray(roster)) throw new Error(`${file} must be a JSON array of --dsw-* names`)
  for (const name of roster) {
    if (typeof name !== 'string' || !name.startsWith('--dsw-')) {
      throw new Error(`${file} holds a non---dsw name: ${JSON.stringify(name)}`)
    }
  }
  if (new Set(roster).size !== roster.length) throw new Error(`${file} holds duplicate names`)
  return roster
}

function parseRetired(file) {
  const entries = parseJsonc(file)
  if (!Array.isArray(entries)) throw new Error(`${file} must be a JSON array of retirement entries`)
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error(`${file} holds a non-object entry`)
    for (const field of ['name', 'frozenIn', 'retiredIn', 'evidence']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        throw new Error(`${file}: entry ${JSON.stringify(entry.name ?? '?')} has an empty ${field}`)
      }
    }
    if (!entry.name.startsWith('--dsw-')) {
      throw new Error(`${file}: ${JSON.stringify(entry.name)} is not a --dsw-* name`)
    }
    if (!Array.isArray(entry.schemes) || entry.schemes.length === 0) {
      throw new Error(`${file}: ${entry.name} declares no schemes`)
    }
    for (const scheme of entry.schemes) {
      if (!SCHEMES.includes(scheme)) {
        throw new Error(`${file}: ${entry.name} declares an unknown scheme ${JSON.stringify(scheme)}`)
      }
    }
  }
  const names = entries.map((entry) => entry.name)
  if (new Set(names).size !== names.length) throw new Error(`${file} lists a name twice`)
  return entries
}

function main() {
  const table = JSON.parse(readFileSync(TOKENS_FILE, 'utf8'))
  const baseline = parseBaseline(BASELINE_FILE)
  const retired = parseRetired(RETIRED_FILE)

  const light = new Set(Object.keys(table.light ?? {}))
  const dark = new Set(Object.keys(table.dark ?? {}))
  const installed = new Set([...light, ...dark])
  const frozen = new Set(baseline)
  const retiredNames = new Set(retired.map((entry) => entry.name))

  // A frozen token must be declarable in BOTH schemes to be usable as a theme.
  const missing = baseline.filter(
    (name) =>
      !retiredNames.has(name) && (!light.has(name) || !dark.has(name)),
  )
  const added = [...installed].filter((name) => !frozen.has(name)).sort()

  const problems = []
  const meta = table.meta ?? {}
  const dshVersion = typeof meta.dshVersion === 'string' ? meta.dshVersion.trim() : ''
  if (dshVersion === '') problems.push('meta.dshVersion is empty')
  for (const scheme of SCHEMES) {
    const size = scheme === 'light' ? light.size : dark.size
    if (size < FROZEN_MINIMUM) problems.push(`${scheme} holds ${size} tokens (< ${FROZEN_MINIMUM})`)
  }
  for (const entry of retired) {
    const back = SCHEMES.filter((scheme) => (scheme === 'light' ? light : dark).has(entry.name))
    if (back.length > 0) {
      problems.push(`retired token is back in the installed ${back.join('+')} table: ${entry.name}`)
    }
    if (!frozen.has(entry.name)) {
      problems.push(`retired token is not part of the frozen roster: ${entry.name}`)
    }
  }

  console.log(
    `missing=${missing.length} retired=${retired.length} live=${installed.size} added=${added.length}`,
  )
  console.log(
    `baseline=${baseline.length} light=${light.size} dark=${dark.size} ` +
      `dshVersion=${dshVersion || '(empty)'} cssSha256=${meta.cssSha256 ?? '(missing)'}`,
  )

  if (missing.length > 0) {
    console.log('missing from the installed stylesheet (not retired):')
    for (const name of missing) {
      const where = [light.has(name) ? null : 'light', dark.has(name) ? null : 'dark']
        .filter(Boolean)
        .join('+')
      console.log(`  - ${name} (absent from ${where})`)
    }
  }
  if (retired.length > 0) {
    console.log('retired upstream (excluded from missing):')
    for (const entry of retired) {
      console.log(
        `  ~ ${entry.name} (frozen ${entry.frozenIn} -> retired ${entry.retiredIn}, ` +
          `${entry.schemes.join('+')})`,
      )
    }
  }
  if (added.length > 0) {
    console.log('added since the frozen roster:')
    for (const name of added) console.log(`  + ${name}`)
  }
  if (problems.length > 0) {
    console.log('problems:')
    for (const problem of problems) console.log(`  ! ${problem}`)
  }

  process.exit(missing.length > 0 || problems.length > 0 ? 1 : 0)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
