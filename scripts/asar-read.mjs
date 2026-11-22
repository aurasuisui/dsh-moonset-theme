#!/usr/bin/env node
/**
 * Minimal, dependency-free reader for an Electron `app.asar` archive.
 *
 * Only what this repo needs is implemented: the directory header and one
 * random-access file read. Nothing is executed, nothing is written, and
 * unpacked/symlink entries are refused instead of guessed at (the stylesheet we
 * extract is a plain stored file).
 *
 * Layout, verified against the installed archive
 * (`...\Programs\DeepSeek Harness\resources\app.asar`, 209_083_008 B):
 *
 *   bytes  0..11    pickle framing: u32 4, u32 payload+4, u32 payload
 *   u32LE  @12      byte length of the header JSON
 *   bytes  16..     header JSON: { files: { name: { files } | { offset, size } } }
 *   bytes  16+pad.. file data; an entry's `offset` is relative to this base
 *
 * The padding matters. `Pickle#writeString` 4-byte-aligns the JSON, so the data
 * base is `16 + align4(headerBytes)`, NOT `16 + headerBytes`. Reading at the
 * unpadded offset shifts every file by up to 3 bytes; on the installed archive
 * that prepends `\n}\n` to the stylesheet and drops its last block, while
 * still parsing "successfully". `readIndex` therefore derives the base from the
 * archive's own framing (`12 + u32@8`) and cross-checks it against the aligned
 * length instead of trusting a single formula.
 *
 * Entry fields: `offset` is a decimal string, `size` a number.
 *
 * Archive resolution (`resolveAsarPath`): `DSH_ASAR` first, then the per-user
 * desktop install location. When nothing is found the thrown error lists every
 * path that was tried, so another machine can be pointed at its own archive
 * without reading this file.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PREAMBLE_BYTES = 16
/** u32 offset of the pickle payload size (header JSON + its padding). */
const PAYLOAD_SIZE_OFFSET = 8
/** u32 offset of the header JSON byte count. */
const HEADER_LENGTH_OFFSET = 12
/** Bytes before the pickle payload; the data area starts where the payload ends. */
const PAYLOAD_START = 12
/** A corrupt preamble must not turn into a huge allocation. */
const MAX_HEADER_BYTES = 64 * 1024 * 1024
/** Install-location tail shared by the desktop app on Windows. */
const INSTALL_SUFFIX = ['Programs', 'DeepSeek Harness', 'resources', 'app.asar']

const align4 = (value) => (value + 3) & ~3

/**
 * Ordered archive paths to try: `DSH_ASAR` first, then the per-user desktop
 * install location. De-duplicated because the override is often the default.
 */
export function asarCandidates() {
  const candidates = []
  const override = process.env.DSH_ASAR?.trim()
  if (override) candidates.push(override)
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    if (localAppData) candidates.push(join(localAppData, ...INSTALL_SUFFIX))
    candidates.push(join(homedir(), 'AppData', 'Local', ...INSTALL_SUFFIX))
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
  }
  return [...new Set(candidates)]
}

/**
 * Resolve the archive to read: an explicit path, else `DSH_ASAR`, else the
 * per-user install location. The error names every path that was tried.
 */
export function resolveAsarPath(explicitPath) {
  if (explicitPath) return assertArchive(explicitPath, [explicitPath])
  const tried = asarCandidates()
  for (const candidate of tried) {
    if (existsSync(candidate)) return assertArchive(candidate, tried)
  }
  const lines = ['could not find the DeepSeek Harness app.asar; tried:']
  if (tried.length === 0) lines.push('  (this platform has no default install location)')
  for (const candidate of tried) lines.push(`  - ${candidate}`)
  const override = process.env.DSH_ASAR?.trim()
  if (override) lines.push(`DSH_ASAR was set to "${override}", which does not exist`)
  lines.push('point DSH_ASAR at the archive instead, e.g. DSH_ASAR=/path/to/app.asar')
  throw new Error(lines.join('\n'))
}

/** Every stored file path in the archive, sorted. */
export function listFiles(options = {}) {
  return [...readIndex(resolveAsarPath(options.asarPath)).entries.keys()].sort()
}

/** Whether the archive stores a regular file at `entryPath`. */
export function hasFile(entryPath, options = {}) {
  return readIndex(resolveAsarPath(options.asarPath)).entries.has(normalizeEntryPath(entryPath))
}

/**
 * Read one stored file. Returns a Buffer, or a string when
 * `options.encoding` is given (`readFile(path, { encoding: 'utf8' })`).
 */
export function readFile(entryPath, options = {}) {
  const index = readIndex(resolveAsarPath(options.asarPath))
  const path = normalizeEntryPath(entryPath)
  const entry = index.entries.get(path)
  if (!entry) throw new Error(`no such file in ${index.asarPath}: ${path}${nearest(path, index)}`)
  if (entry.unpacked) throw new Error(`entry lives in app.asar.unpacked, not in the archive: ${path}`)
  if (entry.link) throw new Error(`entry is a symlink to ${entry.link}, not a regular file: ${path}`)
  if (!Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.size)) {
    throw new Error(`entry has no usable offset/size: ${path}`)
  }
  const bytes = Buffer.alloc(entry.size)
  if (entry.size > 0) {
    const fd = openSync(index.asarPath, 'r')
    try {
      readExactly(fd, bytes, index.dataOffset + entry.offset, `file ${path}`, index.asarPath)
    } finally {
      closeSync(fd)
    }
  }
  return options.encoding ? bytes.toString(options.encoding) : bytes
}

/** Parsed header + entry table for one archive, cached per path. */
const indexes = new Map()

function readIndex(asarPath) {
  const cached = indexes.get(asarPath)
  if (cached) return cached
  const archiveBytes = statSync(asarPath).size
  const fd = openSync(asarPath, 'r')
  try {
    const preamble = Buffer.alloc(PREAMBLE_BYTES)
    readExactly(fd, preamble, 0, 'preamble', asarPath)
    const payloadBytes = preamble.readUInt32LE(PAYLOAD_SIZE_OFFSET)
    const headerBytes = preamble.readUInt32LE(HEADER_LENGTH_OFFSET)
    if (headerBytes === 0 || headerBytes > MAX_HEADER_BYTES) {
      throw new Error(`implausible asar header length ${headerBytes}: ${asarPath}`)
    }
    if (payloadBytes < 4 + headerBytes) {
      throw new Error(`asar pickle payload (${payloadBytes} B) cannot hold the header (${headerBytes} B): ${asarPath}`)
    }
    const dataOffset = PAYLOAD_START + payloadBytes
    const alignedOffset = PREAMBLE_BYTES + align4(headerBytes)
    if (dataOffset !== alignedOffset) {
      process.stderr.write(
        `warning: asar data base ${dataOffset} != 4-byte-aligned ${alignedOffset}; ` +
          `using the archive's own framing\n`,
      )
    }
    if (dataOffset > archiveBytes) {
      throw new Error(`asar data base ${dataOffset} is past the end of the ${archiveBytes} B archive: ${asarPath}`)
    }
    const raw = Buffer.alloc(headerBytes)
    readExactly(fd, raw, PREAMBLE_BYTES, 'header', asarPath)
    let header
    try {
      header = JSON.parse(raw.toString('utf8'))
    } catch (error) {
      throw new Error(`asar header is not valid JSON (${error.message}): ${asarPath}`)
    }
    if (!header || typeof header !== 'object' || !header.files || typeof header.files !== 'object') {
      throw new Error(`asar header carries no file table: ${asarPath}`)
    }
    const entries = new Map()
    collect(header.files, '', entries)
    let maxEnd = 0
    for (const entry of entries.values()) {
      if (entry.unpacked || entry.link) continue
      if (Number.isSafeInteger(entry.offset) && Number.isSafeInteger(entry.size)) {
        maxEnd = Math.max(maxEnd, entry.offset + entry.size)
      }
    }
    if (dataOffset + maxEnd > archiveBytes) {
      throw new Error(
        `asar file table overruns the archive (needs ${dataOffset + maxEnd} B of ${archiveBytes} B): ${asarPath}`,
      )
    }
    const index = { asarPath, archiveBytes, dataOffset, entries }
    indexes.set(asarPath, index)
    return index
  } finally {
    closeSync(fd)
  }
}

function collect(node, prefix, entries) {
  for (const [name, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') throw new Error(`malformed asar entry: ${prefix}/${name}`)
    const path = `${prefix}/${name}`
    if (value.files && typeof value.files === 'object') {
      collect(value.files, path, entries)
      continue
    }
    const size = Number(value.size)
    const offset = Number(value.offset)
    entries.set(path, {
      path,
      size: Number.isSafeInteger(size) && size >= 0 ? size : Number.NaN,
      offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : Number.NaN,
      unpacked: value.unpacked === true,
      link: typeof value.link === 'string' ? value.link : null,
    })
  }
}

function readExactly(fd, buffer, position, what, asarPath) {
  let read = 0
  while (read < buffer.length) {
    const chunk = readSync(fd, buffer, read, buffer.length - read, position + read)
    if (chunk <= 0) {
      throw new Error(`short read on the asar ${what} (${read}/${buffer.length} B): ${asarPath}`)
    }
    read += chunk
  }
}

function normalizeEntryPath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError('asar entry path must be a non-empty string')
  }
  const normalized = input.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function nearest(path, index) {
  const leaf = path.slice(path.lastIndexOf('/') + 1)
  const matches = [...index.entries.keys()].filter((name) => name.endsWith(`/${leaf}`)).slice(0, 5)
  if (matches.length === 0) return ''
  return `\nentries with the same file name:\n${matches.map((name) => `  - ${name}`).join('\n')}`
}

function assertArchive(path, tried) {
  let stats
  try {
    stats = statSync(path)
  } catch {
    throw new Error(`app.asar is not readable: ${path}\ntried: ${tried.join(', ')}`)
  }
  if (stats.isDirectory()) {
    throw new Error(
      `app.asar resolves to a directory (Electron's asar layer is intercepting the path): ${path}\n` +
        'run this script with plain `node`, not inside Electron.',
    )
  }
  if (!stats.isFile()) throw new Error(`app.asar is not a regular file: ${path}`)
  if (stats.size < PREAMBLE_BYTES) {
    throw new Error(`app.asar is too small to hold a header: ${path} (${stats.size} B)`)
  }
  return path
}
