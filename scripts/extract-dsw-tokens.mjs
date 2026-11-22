#!/usr/bin/env node
/**
 * Extract every official `--dsw-*` token from the installed DeepSeek Harness
 * stylesheet into `themes/dsw-tokens.json` — no network, no out-of-tree cache.
 *
 * Source of truth: the packaged copy of
 * `@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css` inside
 * `app.asar` (read by ./asar-read.mjs). The archive path is resolved once and
 * written into `meta.asarPath`; `DSH_ASAR` overrides it.
 *
 * The stylesheet declares the ladder in four rule blocks: `body` twice (the
 * static palette, then the alias + specific layers) and
 * `body[data-ds-dark-theme]` twice, mirroring both. The 2 + 2 layout check and
 * the line-level grammar are copied from the reference parser
 * (dsh-catppuccin-theme scripts/parse-dsh-tokens.cjs). Anything else aborts the
 * run and prints the selectors that were actually found — there is deliberately
 * no fallback branch, because a different layout means the ladder moved and a
 * human has to look at it before the token tables are regenerated.
 *
 * The two trailing `html[data-platform='darwin'] body` blocks are not parsed:
 * the regex is anchored on `body`, so they never match, and the tables stay
 * platform-agnostic (one value per scheme) — the same decision the reference
 * parser documents.
 *
 * Values are kept verbatim, `var(--dsw-…)` references unexpanded, so the
 * static layer under them still flows through in the generated themes.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasFile, readFile, resolveAsarPath } from './asar-read.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_FILE = join(REPO_ROOT, 'themes', 'dsw-tokens.json')

/** Both stylesheets the app ships; byte-identical in 0.2.2-rc.5. */
const STYLESHEET_CANDIDATES = [
  '/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css',
  '/lib/welcome/design-platform.css',
]
/** Manifest whose `version` names the archive this table came from. */
const MANIFEST_PATH = '/dsh/package.json'

const LIGHT_SELECTOR = 'body'
const DARK_SELECTOR = 'body[data-ds-dark-theme]'
/** 2 x body + 2 x body[data-ds-dark-theme]; nothing else is accepted. */
const EXPECTED_BLOCKS_PER_SCHEME = 2

/** Split the stylesheet into the top-level `body` / `body[data-ds-dark-theme]` blocks. */
function collectBlocks(text) {
  const blocks = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const open = line.match(/^(body(?:\[data-ds-dark-theme\])?)\s*\{/)
    if (open) {
      current = { selector: open[1], vars: new Map() }
      blocks.push(current)
      continue
    }
    if (current === null) continue
    if (/^\}/.test(line)) {
      current = null
      continue
    }
    const declaration = line.match(/^\s*(--[A-Za-z0-9-]+):\s*(.+?);\s*$/)
    if (declaration) current.vars.set(declaration[1], declaration[2])
  }
  return blocks
}

/** One scheme = its two blocks merged; `--dsw-*` only, keys sorted, values verbatim. */
function toTokenTable(blocks) {
  const merged = new Map()
  for (const block of blocks) for (const [name, value] of block.vars) merged.set(name, value)
  const ignored = [...merged.keys()].filter((name) => !name.startsWith('--dsw-')).sort()
  if (ignored.length > 0) {
    process.stderr.write(`note: ignoring ${ignored.length} non---dsw custom properties: ${ignored.join(', ')}\n`)
  }
  const table = {}
  for (const name of [...merged.keys()].sort()) {
    if (name.startsWith('--dsw-')) table[name] = merged.get(name)
  }
  return table
}

function main() {
  const asarPath = resolveAsarPath()

  let manifest
  try {
    manifest = JSON.parse(readFile(MANIFEST_PATH, { asarPath, encoding: 'utf8' }))
  } catch (error) {
    throw new Error(`cannot read ${MANIFEST_PATH} from the archive (${error.message})`)
  }
  const dshVersion = typeof manifest.version === 'string' ? manifest.version.trim() : ''
  if (dshVersion === '') throw new Error(`${MANIFEST_PATH} carries no version`)

  const stylesheetPath = STYLESHEET_CANDIDATES.find((candidate) => hasFile(candidate, { asarPath }))
  if (!stylesheetPath) {
    throw new Error(
      `no design-platform.css in the archive; tried:\n${STYLESHEET_CANDIDATES.map((p) => `  - ${p}`).join('\n')}`,
    )
  }
  const stylesheet = readFile(stylesheetPath, { asarPath })
  const text = stylesheet.toString('utf8')

  const blocks = collectBlocks(text)
  const lightBlocks = blocks.filter((block) => block.selector === LIGHT_SELECTOR)
  const darkBlocks = blocks.filter((block) => block.selector === DARK_SELECTOR)
  if (
    lightBlocks.length !== EXPECTED_BLOCKS_PER_SCHEME ||
    darkBlocks.length !== EXPECTED_BLOCKS_PER_SCHEME
  ) {
    const layout = blocks
      .map((block, index) => `  #${index + 1} ${block.selector} (${block.vars.size} declarations)`)
      .join('\n')
    console.error(
      `unexpected block layout: light=${lightBlocks.length} dark=${darkBlocks.length}` +
        ` (expected ${EXPECTED_BLOCKS_PER_SCHEME} + ${EXPECTED_BLOCKS_PER_SCHEME})\n` +
        `blocks found in ${stylesheetPath}:\n${layout || '  (none)'}`,
    )
    process.exit(1)
  }

  const light = toTokenTable(lightBlocks)
  const dark = toTokenTable(darkBlocks)
  const cssSha256 = createHash('sha256').update(stylesheet).digest('hex')

  const payload = {
    meta: {
      dshVersion,
      cssSha256,
      cssBytes: stylesheet.length,
      asarPath,
      cssPath: stylesheetPath,
      dshPackage: typeof manifest.name === 'string' ? manifest.name : '',
      extractedAt: new Date().toISOString(),
      counts: { light: Object.keys(light).length, dark: Object.keys(dark).length },
    },
    light,
    dark,
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`asar      : ${asarPath}`)
  console.log(`dsh       : ${dshVersion} (${payload.meta.dshPackage})`)
  console.log(`stylesheet: ${stylesheetPath} (${stylesheet.length} B)`)
  console.log(`sha256    : ${cssSha256}`)
  console.log(
    `blocks    : ${LIGHT_SELECTOR}=${lightBlocks.length} ${DARK_SELECTOR}=${darkBlocks.length}` +
      ` (${lightBlocks.map((b) => b.vars.size).join('+')} / ${darkBlocks.map((b) => b.vars.size).join('+')} declarations)`,
  )
  console.log(`counts    : light=${payload.meta.counts.light} dark=${payload.meta.counts.dark}`)
  console.log(`wrote     : ${relative(REPO_ROOT, OUT_FILE).replace(/\\/g, '/')}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
