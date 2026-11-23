#!/usr/bin/env node
/**
 * Generate src/client/palettes.ts — the Moonset (月落) token tables for the
 * DeepSeek Harness web GUI.
 *
 * Inputs (both tracked, both local — this script never reaches the network):
 *   themes/moonset-palette.json   16-role Moonset source board, light + dark
 *   themes/dsw-tokens.json        official --dsw-* table, 228 keys × light/dark
 *
 * Output:
 *   src/client/palettes.ts        MOONSET_LIGHT / MOONSET_DARK, 228 keys each,
 *                                 plus the per-scheme classification counts
 *
 * The run is deterministic: keys are emitted in alphabetical order, colours are
 * flattened to literals, and nothing time- or machine-dependent is written, so
 * two consecutive runs produce a byte-identical file (PLAN.md D7).
 *
 * DERIVATION MODEL
 * ----------------
 * Every official value falls into exactly one class (see classify()):
 *
 *   A   --dsw-static-* primitives (82 keys). The official static ladder runs
 *       from 00 (lightest) to 1000 (darkest) and is read from opposite ends by
 *       the light and the dark alias layer (light bg-base = bluish-00, dark
 *       bg-base = bluish-950). Each family is therefore mapped onto its own
 *       ramp: step 500 is the family anchor (the board colour itself), steps
 *       below 500 lean toward the scheme's light end, steps above 500 toward
 *       its dark end. In light that means 00 = canvas and 1000 = ink; in dark
 *       the same 00..1000 direction is kept but the two endpoints swap roles
 *       (00 = inkPrimary, 1000 = canvas) because the dark alias layer reads the
 *       same steps from the other side. Monotonic in every family: a larger
 *       step always moves toward ink in light and toward canvas in dark.
 *
 *   B1  var(--dsw-static-*) / var(--dsw-alias-*) / color-mix() expressions
 *       (109 light / 110 dark). Copied verbatim: the referenced static is in
 *       our table, so the expression resolves through class A automatically.
 *
 *   B2  pure neutral literals — rgba(0,0,0,a), rgba(255,255,255,a), #000,
 *       #fff, transparent (14 light / 16 dark). Alpha is preserved; the literal
 *       is tinted with the scheme's own overlay endpoints (NEUTRAL_ENDPOINTS).
 *
 *   B3  chroma literals (23 light / 20 dark). Each one is listed explicitly in
 *       CHROMA_LITERALS below — nothing is inferred from a token name, and the
 *       seven --dsw-alias-json-tree-* entries are spelled out one by one.
 *
 *   B4  anything else. The generator refuses to write a file: it prints the key
 *       and the raw value and exits 1. There is no silent pass-through.
 *
 * 0.1.1 adds one more exit beside B4: a token whose OFFICIAL value is a B1
 * expression may still be emitted with OUR value, listed explicitly in
 * TOKEN_OVERRIDES. That is the token half of the skin layer (the selected
 * sidebar row), and the counts keep describing the OFFICIAL class so the audit
 * stays comparable. Nothing is inferred from a token name here either.
 *
 * Re-run after editing the palette or the position tables:
 *   node scripts/generate-palettes.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const PALETTE_FILE = join(ROOT, 'themes', 'moonset-palette.json')
export const TOKENS_FILE = join(ROOT, 'themes', 'dsw-tokens.json')
export const OUTPUT_FILE = join(ROOT, 'src', 'client', 'palettes.ts')

/** The 16 board roles, in the order PLAN.md appendix A lists them. */
export const ROLES = [
  'canvas', 'elevated', 'subtle',
  'inkPrimary', 'inkSecondary', 'inkMuted',
  'accent', 'accentUi', 'accentGlow',
  'borderHairline', 'borderStrong',
  'success', 'warning', 'danger', 'info', 'moon',
]

export const SCHEMES = ['light', 'dark']

/* ------------------------------------------------------------------ *
 * colour helpers (sRGB — the same arithmetic CSS performs for         *
 * color-mix(in srgb, ...); values are flattened to literals on the    *
 * way out so the generated file stays readable and testable)          *
 * ------------------------------------------------------------------ */

function parseHex(hex, where) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (m === null) throw new Error(where + ': expected #RRGGBB, got ' + JSON.stringify(hex))
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  }
}

function hexOf(color) {
  return '#' + [color.r, color.g, color.b]
    .map(function (v) { return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0') })
    .join('')
    .toUpperCase()
}

function mixRgb(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

function rgbaOf(color, alpha) {
  return 'rgba(' + Math.round(color.r) + ', ' + Math.round(color.g) + ', ' + Math.round(color.b) + ', ' + alpha + ')'
}

/* ------------------------------------------------------------------ *
 * ladder model                                                        *
 * ------------------------------------------------------------------ */

/**
 * Where a step sits on the family's mix axis:
 *   -1 = the scheme's light endpoint, 0 = the family anchor (step 500),
 *   +1 = the scheme's dark endpoint.
 * A larger step always moves toward ink in light and toward canvas in dark;
 * step 500 is the anchor colour itself in both schemes.
 *
 * The two neutral families share this table: their ramps differ by anchor
 * (inkSecondary for the recessed 'neutral' family, inkMuted for the page/text
 * 'neutral-bluish' family) rather than by position.
 */
export const NEUTRAL_POSITIONS = {
  '00': -1, '50': -0.955, '55': -0.95, '60': -0.945, '75': -0.93,
  '90': -0.9, '100': -0.87, '150': -0.8, '200': -0.72, '250': -0.62,
  '300': -0.52, '310': -0.5, '400': -0.3, '450': -0.13,
  '500': 0,
  '550': 0.07, '600': 0.25, '700': 0.47, '750': 0.57, '800': 0.67,
  '850': 0.77, '875': 0.82, '900': 0.87, '950': 0.93, '1000': 1,
}

/**
 * Chroma families need a different spread per scheme. In light the low steps
 * are pale washes (chip backgrounds: state-business-tertiary, code-diff tints)
 * so they have to stay close to the surface; in dark the very same low steps
 * are read as *labels* (link = deepseek-400, state-success-primary = green-500),
 * so they only get a light lift instead of a wash. The high steps invert the
 * same way: light uses them as deep readable labels (blue-900 on the hero
 * badge), dark as tinted surfaces (deepseek-800 behind the business chip).
 */
export const CHROMA_POSITIONS = {
  light: {
    '50': -0.94, '50p': -0.93, '55': -0.925, '60': -0.92, '75': -0.92,
    '90': -0.905, '100': -0.9, '150': -0.85, '200': -0.78, '250': -0.7,
    '300': -0.58, '310': -0.56, '400': -0.3, '450': -0.13,
    '500': 0,
    '550': 0.1, '600': 0.22, '700': 0.44, '750': 0.55, '800': 0.66,
    '850': 0.76, '875': 0.81, '900': 0.84, '950': 0.9, '1000': 1,
  },
  dark: {
    '50': -0.6, '50p': -0.58, '55': -0.57, '60': -0.56, '75': -0.56,
    '90': -0.54, '100': -0.52, '150': -0.46, '200': -0.4, '250': -0.35,
    '300': -0.3, '310': -0.29, '400': -0.18, '450': -0.09,
    '500': 0,
    '550': 0.08, '600': 0.18, '700': 0.34, '750': 0.44, '800': 0.6,
    '850': 0.7, '875': 0.75, '900': 0.8, '950': 0.86, '1000': 1,
  },
}

/**
 * Each --dsw-static-* family, its anchor role and its position table.
 * 'overrides' pins a single step that upstream deliberately diverges from its
 * own family: amber-500 is the moonlight colour (--dsw-alias-state-warn-primary
 * and every moon halo read it), not a second warning step.
 */
export const FAMILIES = {
  blue: { anchor: 'accentUi', chroma: true },
  deepseek: { anchor: 'accent', chroma: true },
  violet: { anchor: 'accentGlow', chroma: true },
  green: { anchor: 'success', chroma: true },
  amber: { anchor: 'warning', chroma: true, overrides: { '500': 'moon' } },
  red: { anchor: 'danger', chroma: true },
  neutral: { anchor: 'inkSecondary', chroma: false },
  'neutral-bluish': { anchor: 'inkMuted', chroma: false },
}

/** Longest prefix first: 'neutral-bluish-' must win over 'neutral-'. */
const FAMILY_PREFIXES = ['neutral-bluish', 'deepseek', 'neutral', 'violet', 'green', 'amber', 'red', 'blue']

/**
 * Which role sits at each end of the ramp, per scheme.
 * light: 00 = canvas (surfaces) ... 1000 = inkPrimary (text)
 * dark:  00 = inkPrimary (text)  ... 1000 = canvas (surfaces)
 * Both read light to dark, which is why the official alias expressions port
 * across unchanged.
 */
export const ENDPOINTS = {
  light: { light: 'canvas', dark: 'inkPrimary' },
  dark: { light: 'inkPrimary', dark: 'canvas' },
}

/**
 * B2 overlay endpoints. The official values are pure black / pure white at an
 * alpha, i.e. "press the surface down" / "lift it". Mojset never ships pure
 * black or white, so each literal is tinted with the *scheme's own* end of the
 * ramp: black becomes the ink end, white becomes the canvas end. In light that
 * is literally inkPrimary / canvas as the brief asks; in dark the two roles sit
 * at the other end of the same ramp (ink is the light one there), so the same
 * rule keeps dark hairlines and hover washes visible instead of painting
 * canvas-on-canvas.
 */
export const NEUTRAL_ENDPOINTS = {
  light: { black: 'inkPrimary', white: 'canvas' },
  dark: { black: 'canvas', white: 'inkPrimary' },
}

/* ------------------------------------------------------------------ *
 * inputs                                                              *
 * ------------------------------------------------------------------ */

function loadPalette() {
  const board = JSON.parse(readFileSync(PALETTE_FILE, 'utf8'))
  for (const scheme of SCHEMES) {
    const roles = board[scheme]
    if (roles === undefined || typeof roles !== 'object') {
      throw new Error('themes/moonset-palette.json: missing the "' + scheme + '" group')
    }
    const missing = ROLES.filter(function (role) { return typeof roles[role] !== 'string' })
    if (missing.length > 0) {
      throw new Error('themes/moonset-palette.json: ' + scheme + ' is missing ' + missing.join(', '))
    }
    const extra = Object.keys(roles).filter(function (role) { return ROLES.indexOf(role) === -1 })
    if (extra.length > 0) {
      throw new Error('themes/moonset-palette.json: ' + scheme + ' has unknown roles ' + extra.join(', '))
    }
    for (const role of ROLES) parseHex(roles[role], 'themes/moonset-palette.json ' + scheme + '.' + role)
  }
  return board
}

function loadOfficial() {
  const table = JSON.parse(readFileSync(TOKENS_FILE, 'utf8'))
  for (const scheme of SCHEMES) {
    if (table[scheme] === undefined) throw new Error('themes/dsw-tokens.json: missing "' + scheme + '"')
  }
  const lightKeys = Object.keys(table.light).sort()
  const darkKeys = Object.keys(table.dark).sort()
  if (lightKeys.length !== darkKeys.length || lightKeys.some(function (key, i) { return key !== darkKeys[i] })) {
    throw new Error('themes/dsw-tokens.json: light and dark key sets differ')
  }
  return { light: table.light, dark: table.dark, keys: lightKeys }
}

/* ------------------------------------------------------------------ *
 * class A — the static ladder                                         *
 * ------------------------------------------------------------------ */

function splitAlpha(token) {
  const m = /-a([0-9]{2})$/.exec(token)
  if (m === null) return { step: token, alpha: null }
  return { step: token.slice(0, m.index), alpha: Number(m[1]) / 100 }
}

function splitFamily(name) {
  const prefix = FAMILY_PREFIXES.find(function (family) { return name.indexOf(family + '-') === 0 })
  if (prefix === undefined) throw new Error('--dsw-static-' + name + ': unknown static family')
  const rawStep = name.slice(prefix.length + 1)
  return { family: prefix, step: rawStep.replace(/-delete$/, '') }
}

function ladderColor(scheme, family, step, palette) {
  const plan = FAMILIES[family]
  if (plan === undefined) throw new Error('static family "' + family + '" has no plan')
  const positions = plan.chroma ? CHROMA_POSITIONS[scheme] : NEUTRAL_POSITIONS
  const position = positions[step]
  if (position === undefined) {
    throw new Error('no ladder position for ' + family + '-' + step + ' in the ' + scheme + ' plan')
  }
  const pinned = plan.overrides === undefined ? undefined : plan.overrides[step]
  const anchor = palette[pinned === undefined ? plan.anchor : pinned]
  if (position === 0) return anchor
  if (position < 0) {
    return mixRgb(palette[ENDPOINTS[scheme].light], anchor, 1 + position)
  }
  return mixRgb(anchor, palette[ENDPOINTS[scheme].dark], position)
}

function staticValue(scheme, token, palette) {
  const split = splitAlpha(token)
  const family = splitFamily(split.step)
  const color = ladderColor(scheme, family.family, family.step, palette)
  return split.alpha === null ? hexOf(color) : rgbaOf(color, split.alpha)
}

/* ------------------------------------------------------------------ *
 * class B3 — chroma literals, spelled out one by one                  *
 * ------------------------------------------------------------------ */

/**
 * Every official value that is a *chroma literal* is replaced here. The map is
 * keyed by the full token name and holds the per-scheme replacement; a token
 * that is a literal in only one scheme (menu-surface-fill, bg-mask-drop, the
 * brand pin) lists only that scheme. Nothing is derived from the token name, so
 * a new literal upstream fails the run instead of quietly keeping DSH's colour.
 *
 * The seven --dsw-alias-json-tree-* entries are individually listed on purpose:
 * keyword and number share the official value but are separate tokens, and
 * collapsing them would make a later upstream change invisible.
 */
export const CHROMA_LITERALS = {
  /* brand pin: the only light-scheme brand literal (dark uses deepseek-450) */
  '--dsw-alias-brand-primary-new-colorprimary-new-color': {
    light: function (p) { return hexOf(p.accent) },
  },
  /* menu material (translucent: the official alpha is kept) */
  '--dsw-menu-surface-fill': {
    light: function (p) { return rgbaOf(p.elevated, 0.7) },
    dark: function (p) { return rgbaOf(p.elevated, 0.64) },
  },
  '--dsw-alias-menu-group-header-fill': {
    light: function (p) { return rgbaOf(p.subtle, 0.94) },
    dark: function (p) { return rgbaOf(p.elevated, 0.94) },
  },
  /* the drop mask is a coloured literal only in dark (light is pure white) */
  '--dsw-alias-bg-mask-drop': {
    dark: function (p) { return rgbaOf(p.elevated, 0.7) },
  },
  /* floating tool-bar buttons: one mid tone per scheme, as upstream does */
  '--dsw-alias-button-tool-bar-fill': {
    light: function (p) { return rgbaOf(p.inkMuted, 0.5) },
    dark: function (p) { return rgbaOf(p.inkMuted, 0.5) },
  },
  '--dsw-alias-button-tool-bar-hover': {
    light: function (p) { return rgbaOf(p.inkMuted, 0.6) },
    dark: function (p) { return rgbaOf(p.inkMuted, 0.6) },
  },
  '--dsw-alias-button-tool-bar-fill-invisible': {
    light: function (p) { return rgbaOf(p.borderStrong, 0.36) },
    dark: function (p) { return rgbaOf(p.canvas, 0.36) },
  },
  /*
   * NOTE (0.1.1): --dsw-alias-interactive-bg-hover / -active are NOT listed
   * here any more. They are the main "selected / active row" seat in the app
   * (14 + 7 hits in the installed CSS), so the skin replaces them through
   * TOKEN_OVERRIDES below instead of with an ink wash. One owner per token.
   */
  '--dsw-alias-interactive-bg-hover-accent': {
    light: function (p) { return rgbaOf(p.borderHairline, 0.14) },
  },
  '--dsw-alias-interactive-bg-hover-danger': {
    light: function (p) { return rgbaOf(p.danger, 0.05) },
    dark: function (p) { return rgbaOf(p.danger, 0.15) },
  },
  /* file-diff washes: one tint source, and the line stays deeper than the gutter */
  '--dsw-alias-file-diff-added-bg': {
    light: function (p) { return hexOf(mixRgb(p.canvas, p.success, 0.1)) },
    dark: function (p) { return hexOf(mixRgb(p.canvas, p.success, 0.16)) },
  },
  '--dsw-alias-file-diff-added-gutter': {
    light: function (p) { return hexOf(mixRgb(p.canvas, p.success, 0.05)) },
    dark: function (p) { return hexOf(mixRgb(p.canvas, p.success, 0.09)) },
  },
  '--dsw-alias-file-diff-added-marker': {
    light: function (p) { return hexOf(p.success) },
    dark: function (p) { return hexOf(p.success) },
  },
  '--dsw-alias-file-diff-deleted-bg': {
    light: function (p) { return hexOf(mixRgb(p.canvas, p.danger, 0.1)) },
    dark: function (p) { return hexOf(mixRgb(p.canvas, p.danger, 0.16)) },
  },
  '--dsw-alias-file-diff-deleted-gutter': {
    light: function (p) { return hexOf(mixRgb(p.canvas, p.danger, 0.05)) },
    dark: function (p) { return hexOf(mixRgb(p.canvas, p.danger, 0.09)) },
  },
  '--dsw-alias-file-diff-deleted-marker': {
    light: function (p) { return hexOf(p.danger) },
    dark: function (p) { return hexOf(p.danger) },
  },
  /* JSON tree syntax colours — one entry per token, keyword != number */
  '--dsw-alias-json-tree-hover': {
    light: function (p) { return rgbaOf(p.inkSecondary, 0.04) },
    dark: function (p) { return rgbaOf(p.inkPrimary, 0.05) },
  },
  '--dsw-alias-json-tree-icon': {
    light: function (p) { return hexOf(p.inkMuted) },
    dark: function (p) { return hexOf(p.inkSecondary) },
  },
  '--dsw-alias-json-tree-keyword': {
    light: function (p) { return hexOf(p.info) },
    dark: function (p) { return hexOf(p.info) },
  },
  '--dsw-alias-json-tree-number': {
    light: function (p) { return hexOf(p.info) },
    dark: function (p) { return hexOf(p.info) },
  },
  '--dsw-alias-json-tree-property': {
    light: function (p) { return hexOf(p.accentGlow) },
    dark: function (p) { return hexOf(p.accentGlow) },
  },
  '--dsw-alias-json-tree-punctuation': {
    light: function (p) { return hexOf(p.inkPrimary) },
    dark: function (p) { return hexOf(p.inkPrimary) },
  },
  '--dsw-alias-json-tree-string': {
    light: function (p) { return hexOf(p.danger) },
    dark: function (p) { return hexOf(p.danger) },
  },
}

/* ------------------------------------------------------------------ *
 * class B1 exceptions — deliberate token deltas (0.1.1)               *
 * ------------------------------------------------------------------ */

/**
 * Tokens whose emitted value is NOT the official one, whatever class the
 * official value falls into.
 *
 * 0.1.1 is the first consumer, and its first real-machine pass is why there are
 * seven entries instead of two. Upstream paints every "selected / active" seat
 * with a NEUTRAL rung, so a skin that asks for a pale-violet wash with violet
 * text cannot ride the neutral ladder at all:
 *
 *   sidebar nav item (1 hit)   selected ROW, settings sidebar
 *   interactive-bg-hover (14)  main seat: .rowActive, .badge[data-active],
 *                              automation tabs, conversation rows
 *   interactive-bg-active (7)  pressed state
 *   bg-module-platform (2)     .cardActive / .selected surfaces
 *   button-ghost-active-fill   selected clock/date-picker cell
 *   border-selected            the selected outline
 *   nav-item-active-accent     the selected row's label colour
 *
 * Every replacement is a CSS expression built from tokens already in this same
 * table, which keeps it scheme-correct without a second source of truth:
 *
 *   --dsw-static-deepseek-500   the accent anchor (light #4338CA, dark #818CF8)
 *   --dsw-alias-bg-base         the canvas the alias layer reads
 *
 * Two of them (interactive-bg-hover / -active) are B3 in light and B2 in dark
 * upstream (a rgba() wash), so this table may override B1, B2 and B3 keys. The
 * class COUNTS still describe the OFFICIAL value, which is why they do not move
 * when an override lands.
 *
 * Rules enforced by validateOverrides() below (the run fails, never guesses):
 *   - the key exists in themes/dsw-tokens.json and is NOT a --dsw-static-*
 *     primitive (the ladder owns those, a delta there would repaint the app);
 *   - the key has no CHROMA_LITERALS entry (one owner per token);
 *   - the value is var(--dsw-...) / color-mix(in srgb, ...) only;
 *   - every var() it references exists in the same table;
 *   - the value actually differs from the official one.
 */
export const TOKEN_OVERRIDES = {
  /* ── the main seat: hover / pressed washes (14 + 7 hits) ──────────────────
   *
   * Upstream: light rgba(38,49,72,.06/.10), dark rgba(255,255,255,.08/.14) —
   * i.e. an ink/white overlay. The skin's "selected row" is this token in the
   * conversation list, the badge/tab states and the automation rows, so it
   * carries the accent wash instead. Two steps (10% hover, 16% pressed) keep a
   * visible difference between hover and press, and both stay light enough to
   * read the label on top.
   */
  '--dsw-alias-interactive-bg-hover':
    'color-mix(in srgb, var(--dsw-static-deepseek-500) 10%, var(--dsw-alias-bg-base))',
  '--dsw-alias-interactive-bg-active':
    'color-mix(in srgb, var(--dsw-static-deepseek-500) 16%, var(--dsw-alias-bg-base))',
  /* ── selected surfaces (.cardActive / .selected, 2 hits) ──────────────────
   *
   * A SURFACE token, so it is opaque on purpose: 12% accent over the canvas.
   */
  '--dsw-alias-bg-module-platform':
    'color-mix(in srgb, var(--dsw-static-deepseek-500) 12%, var(--dsw-alias-bg-base))',
  /* ── selected cell fill (ghost button active, 2 hits) ─────────────────────
   *
   * 18% is the "chip" step: solid enough to read as a fill, still a wash under
   * the accent label.
   */
  '--dsw-alias-button-ghost-active-fill':
    'color-mix(in srgb, var(--dsw-static-deepseek-500) 18%, var(--dsw-alias-bg-base))',
  /* ── the selected OUTLINE ─────────────────────────────────────────────────
   *
   * Translucent like the official border, so it sits on any surface.
   */
  '--dsw-alias-border-selected':
    'color-mix(in srgb, var(--dsw-static-deepseek-500) 40%, transparent)',
  /* ── the selected sidebar row + its label (settings sidebar, 1 hit) ───────
   *
   * The row is a 10% accent wash over the canvas; its label and icon are the
   * accent used AS TEXT (violet on pale violet instead of the neutral rung).
   */
  '--dsw-specific-sidebar-nav-item-active':
    'color-mix(in srgb, var(--dsw-static-deepseek-500) 10%, var(--dsw-alias-bg-base))',
  '--dsw-specific-sidebar-nav-item-active-accent':
    'var(--dsw-static-deepseek-500)',
}

/** The shape an override value may take: one var() reference or one color-mix(). */
const OVERRIDE_VALUE = /^(?:var\(--dsw-[a-z0-9-]+\)|color-mix\(in srgb, [\s\S]+\))$/

/**
 * Reject an override the table cannot honour. Called once per run from
 * buildPalettes(); a bad entry aborts the run instead of emitting a value no
 * reviewer would see.
 * @param officialKeys - the official token names (the complete 228-key list).
 */
export function validateOverrides(officialKeys) {
  const known = new Set(officialKeys)
  for (const token of Object.keys(TOKEN_OVERRIDES)) {
    const value = TOKEN_OVERRIDES[token]
    if (!known.has(token)) {
      throw new Error('TOKEN_OVERRIDES entry ' + token + ' is not in themes/dsw-tokens.json')
    }
    if (token.indexOf('--dsw-static-') === 0) {
      throw new Error('TOKEN_OVERRIDES entry ' + token + ' replaces a --dsw-static-* primitive; the ladder owns those')
    }
    if (CHROMA_LITERALS[token] !== undefined) {
      throw new Error('TOKEN_OVERRIDES entry ' + token + ' also has a CHROMA_LITERALS entry: one owner per token')
    }
    if (OVERRIDE_VALUE.test(value) === false) {
      throw new Error('TOKEN_OVERRIDES entry ' + token + ' must be var(--dsw-...) or color-mix(in srgb, ...): ' + value)
    }
    for (const reference of value.matchAll(/var\((--dsw-[a-z0-9-]+)\)/g)) {
      if (known.has(reference[1]) === false) {
        throw new Error('TOKEN_OVERRIDES entry ' + token + ' references a token that is not in the table: ' + reference[1])
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * classification                                                      *
 * ------------------------------------------------------------------ */

const VAR_REF = /^var\(--dsw-[a-z0-9-]+\)$/
const COLOR_MIX = /^color-mix\(in srgb,[\s\S]*\)$/
const PURE_NEUTRAL = /^rgba?\(\s*(?:0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*(?:,\s*[0-9.]+\s*)?\)$/

/**
 * Classify one official value for one scheme. '--dsw-static-*' keys are class A
 * by name; anything else is B1 when it is a var()/color-mix() expression, B2
 * when it is a pure neutral literal, B3 when it is any other colour literal,
 * and B4 otherwise (which aborts the run — see buildPalettes()).
 */
export function classify(token, value) {
  if (token.indexOf('--dsw-static-') === 0) return 'static'
  if (VAR_REF.test(value)) return 'expression'
  if (COLOR_MIX.test(value)) {
    if (value.indexOf('var(--dsw-') === -1) {
      throw new Error(token + ': color-mix() without a var(--dsw-...) reference: ' + value)
    }
    return 'expression'
  }
  if (PURE_NEUTRAL.test(value)) return 'neutralLiteral'
  if (value === 'transparent') return 'neutralLiteral'
  if (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\(/.test(value)) return 'chromaLiteral'
  return 'unmapped'
}

function neutralLiteralValue(scheme, value, palette) {
  if (value === 'transparent') return 'rgba(0, 0, 0, 0)'
  const rgb = /^rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(value)
  let isBlack
  let alpha = 1
  if (rgb !== null) {
    isBlack = rgb[1] === '0' && rgb[2] === '0' && rgb[3] === '0'
    alpha = rgb[4] === undefined ? 1 : Number(rgb[4])
  } else if (value === '#000' || value === '#000000') {
    isBlack = true
  } else if (value === '#fff' || value === '#ffffff') {
    isBlack = false
  } else {
    throw new Error('not a neutral literal: ' + value)
  }
  const role = NEUTRAL_ENDPOINTS[scheme][isBlack ? 'black' : 'white']
  return rgbaOf(palette[role], alpha)
}

/* ------------------------------------------------------------------ *
 * build                                                               *
 * ------------------------------------------------------------------ */

/**
 * Build both token tables plus the per-scheme classification counts.
 * Returns { tables: { light, dark }, classes: { light, dark } }.
 * Throws (caller exits 1) on class B4, on a missing B3 entry, on a B3 entry no
 * scheme consumed, and on a size mismatch.
 */
export function buildPalettes() {
  const board = loadPalette()
  const official = loadOfficial()
  // Fail before any work: an override the table cannot honour is a contract
  // break, not a warning.
  validateOverrides(official.keys)
  const palette = {}
  for (const scheme of SCHEMES) {
    const parsed = {}
    for (const role of ROLES) parsed[role] = parseHex(board[scheme][role], scheme + '.' + role)
    palette[scheme] = parsed
  }

  const usedLiterals = new Set()
  const tables = { light: {}, dark: {} }
  const classes = {
    light: { static: 0, expression: 0, neutralLiteral: 0, chromaLiteral: 0, unmapped: 0 },
    dark: { static: 0, expression: 0, neutralLiteral: 0, chromaLiteral: 0, unmapped: 0 },
  }
  const unmapped = []
  const usedOverrides = new Set()

  for (const scheme of SCHEMES) {
    for (const token of official.keys) {
      const value = official[scheme][token]
      const kind = classify(token, value)
      if (Object.prototype.hasOwnProperty.call(TOKEN_OVERRIDES, token)) {
        // 0.1.1 exception: our value replaces the official one, while the count
        // still records the OFFICIAL class (see TOKEN_OVERRIDES). B1, B2 and B3
        // keys are all fair game; a static primitive never is (validated).
        if (kind === 'static' || kind === 'unmapped') {
          throw new Error('TOKEN_OVERRIDES entry ' + token + ' cannot target class ' + kind)
        }
        const replacement = TOKEN_OVERRIDES[token]
        if (replacement === value) {
          throw new Error('TOKEN_OVERRIDES entry ' + token + ' is identical to the official value: nothing to override')
        }
        tables[scheme][token] = replacement
        classes[scheme][kind] += 1
        usedOverrides.add(token)
        continue
      }
      if (kind === 'static') {
        tables[scheme][token] = staticValue(scheme, token.slice('--dsw-static-'.length), palette[scheme])
      } else if (kind === 'expression') {
        tables[scheme][token] = value
      } else if (kind === 'neutralLiteral') {
        tables[scheme][token] = neutralLiteralValue(scheme, value, palette[scheme])
      } else if (kind === 'chromaLiteral') {
        const entry = CHROMA_LITERALS[token]
        const replacement = entry === undefined ? undefined : entry[scheme]
        if (replacement === undefined) {
          unmapped.push({ scheme: scheme, token: token, value: value, reason: 'chroma literal with no CHROMA_LITERALS entry' })
          continue
        }
        tables[scheme][token] = replacement(palette[scheme])
        usedLiterals.add(token)
      } else {
        unmapped.push({ scheme: scheme, token: token, value: value, reason: 'matches none of A/B1/B2/B3' })
        continue
      }
      classes[scheme][kind] += 1
    }
  }

  if (unmapped.length > 0) {
    const lines = unmapped.map(function (row) {
      return '  [' + row.scheme + '] ' + row.token + ' = ' + row.value + '  (' + row.reason + ')'
    })
    throw new Error('unclassifiable values — refusing to write:\n' + lines.join('\n'))
  }

  const stale = Object.keys(CHROMA_LITERALS).filter(function (token) { return usedLiterals.has(token) === false })
  if (stale.length > 0) {
    throw new Error('CHROMA_LITERALS has entries no scheme consumed: ' + stale.join(', '))
  }

  const unusedOverrides = Object.keys(TOKEN_OVERRIDES).filter(function (token) { return usedOverrides.has(token) === false })
  if (unusedOverrides.length > 0) {
    throw new Error('TOKEN_OVERRIDES has entries no scheme consumed: ' + unusedOverrides.join(', '))
  }

  for (const scheme of SCHEMES) {
    const count = Object.keys(tables[scheme]).length
    if (count !== official.keys.length) {
      throw new Error(scheme + ' table holds ' + count + ' tokens, expected ' + official.keys.length)
    }
    const own = Object.keys(tables[scheme])
    const sorted = own.slice().sort()
    if (own.some(function (token, i) { return token !== sorted[i] })) {
      throw new Error(scheme + ' table is not in alphabetical order')
    }
  }

  return { tables: tables, classes: classes }
}

/* ------------------------------------------------------------------ *
 * emit                                                                *
 * ------------------------------------------------------------------ */

const HEADER = [
  '/**',
  ' * AUTO-GENERATED by scripts/generate-palettes.mjs — do not edit by hand.',
  ' *',
  ' * Inputs:',
  ' *   themes/moonset-palette.json   16-role Moonset source board (light + dark)',
  ' *   themes/dsw-tokens.json        official --dsw-* values, 228 keys x light/dark',
  ' *',
  ' * Every official value is classified once per scheme and handled by one rule:',
  ' *',
  ' *   A    --dsw-static-* primitives (82): rebuilt from the family ladders.',
  ' *        Step 500 is the family anchor colour itself; steps below it lean',
  ' *        toward the scheme light end, steps above it toward the dark end.',
  ' *        The 00..1000 direction is constant, so the official alias layer',
  ' *        (light reads the light end, dark the dark end) keeps working.',
  ' *   B1   var()/color-mix() expressions: copied verbatim - the static they',
  ' *        reference is in this same table, so they follow class A.',
  ' *   B2   pure neutral literals: alpha kept, tinted with the scheme own',
  ' *        ink/canvas end (NEUTRAL_ENDPOINTS in the generator).',
  ' *   B3   chroma literals: replaced through the explicit CHROMA_LITERALS table.',
  ' *   B4   anything else: the generator exits 1 instead of writing a file.',
  ' *',
  ' * TOKEN_OVERRIDES (0.1.1) replaces a handful of selected/active tokens whose',
  ' * official values ride the neutral ladder; its keys may be B1, B2 or B3. The',
  ' * class counts below still describe the OFFICIAL value, so they do not move',
  ' * when an override lands. The overridden names are exported as',
  ' * MOONSET_TOKEN_OVERRIDES.',
  ' *',
  ' * The tables are pure data: no imports, no side effects, no timestamps.',
  ' */',
].join('\n')

function quote(value) {
  return "'" + value.split('\\').join('\\\\').split("'").join("\\'") + "'"
}

export function renderModule(built) {
  const tables = built.tables
  const classes = built.classes
  const lines = [HEADER, '']
  lines.push("export type MoonsetScheme = 'light' | 'dark'")
  lines.push('')
  lines.push('/** One token dictionary: --dsw-* name -> CSS colour value. */')
  lines.push('export type MoonsetTokenTable = Record<string, string>')
  lines.push('')
  lines.push('/** How every official value in one scheme was handled (see the header). */')
  lines.push('export interface MoonsetTokenClasses {')
  lines.push('  /** A: --dsw-static-* primitives rebuilt from the family ladders. */')
  lines.push('  static: number')
  lines.push('  /** B1: official var()/color-mix() expressions copied verbatim (overrides excepted). */')
  lines.push('  expression: number')
  lines.push('  /** B2: pure neutral literals, alpha kept and tinted with ink/canvas. */')
  lines.push('  neutralLiteral: number')
  lines.push('  /** B3: chroma literals replaced through the explicit map. */')
  lines.push('  chromaLiteral: number')
  lines.push('  /** B4: unclassified. Must stay 0 - the generator refuses to emit. */')
  lines.push('  unmapped: number')
  lines.push('}')
  for (const scheme of SCHEMES) {
    const name = scheme === 'light' ? 'MOONSET_LIGHT' : 'MOONSET_DARK'
    const label = scheme === 'light' ? 'Moonset light' : 'Moonset dark'
    lines.push('')
    lines.push('/** ' + label + ' — 228 --dsw-* tokens, alphabetical. */')
    lines.push('export const ' + name + ': MoonsetTokenTable = {')
    for (const token of Object.keys(tables[scheme])) {
      lines.push('  ' + quote(token) + ': ' + quote(tables[scheme][token]) + ',')
    }
    lines.push('}')
  }
  lines.push('')
  lines.push('/**')
  lines.push(' * Tokens whose value is a deliberate Moonset delta, not the official value.')
  lines.push(' *')
  lines.push(' * Every other token is the official value copied verbatim (B1) or rebuilt')
  lines.push(' * from the palette (A/B2/B3); these few are replaced on purpose, and the')
  lines.push(' * reasons live beside TOKEN_OVERRIDES in the generator. 0.1.1: the')
  lines.push(' * selected/active seats (rows, pressed states, selected surfaces, the')
  lines.push(' * selected outline and the settings-sidebar row + label).')
  lines.push(' */')
  lines.push('export const MOONSET_TOKEN_OVERRIDES: readonly string[] = [')
  for (const token of Object.keys(TOKEN_OVERRIDES).sort()) lines.push('  ' + quote(token) + ',')
  lines.push(']')
  lines.push('')
  lines.push('/** Per-scheme class counts (A + B1 + B2 + B3 = 228, B4 = 0). */')
  lines.push('export const MOONSET_CLASSES: Record<MoonsetScheme, MoonsetTokenClasses> = {')
  for (const scheme of SCHEMES) {
    const c = classes[scheme]
    lines.push('  ' + scheme + ': {')
    lines.push('    static: ' + c.static + ',')
    lines.push('    expression: ' + c.expression + ',')
    lines.push('    neutralLiteral: ' + c.neutralLiteral + ',')
    lines.push('    chromaLiteral: ' + c.chromaLiteral + ',')
    lines.push('    unmapped: ' + c.unmapped + ',')
    lines.push('  },')
  }
  lines.push('}')
  return lines.join('\n') + '\n'
}

/* ------------------------------------------------------------------ *
 * main                                                                *
 * ------------------------------------------------------------------ */

export function report(built) {
  const classes = built.classes
  const tables = built.tables
  const out = []
  for (const scheme of SCHEMES) {
    const c = classes[scheme]
    const total = c.static + c.expression + c.neutralLiteral + c.chromaLiteral + c.unmapped
    out.push(
      '  ' + scheme.padEnd(5) +
      ' A=' + c.static +
      ' B1=' + c.expression +
      ' B2=' + c.neutralLiteral +
      ' B3=' + c.chromaLiteral +
      ' B4=' + c.unmapped +
      '  total=' + total +
      '  keys=' + Object.keys(tables[scheme]).length,
    )
  }
  const overrides = Object.keys(TOKEN_OVERRIDES).sort()
  out.push('  overrides B1=' + overrides.length + (overrides.length === 0 ? '' : ': ' + overrides.join(', ')))
  return out.join('\n')
}

export function main() {
  const built = buildPalettes()
  const source = renderModule(built)
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  writeFileSync(OUTPUT_FILE, source)
  console.log('generate-palettes: read ' + PALETTE_FILE + ' + ' + TOKENS_FILE)
  console.log(report(built))
  console.log('wrote ' + OUTPUT_FILE + ' (' + source.length + ' bytes)')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error('generate-palettes: ' + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}
