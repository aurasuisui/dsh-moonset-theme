/**
 * First-paint palette: the persisted Moonset token table injected into the index
 * HTML so the FIRST frame is already Moonset (M6, the issue-#30 shape).
 *
 * Why this exists. The official `dsh-client-ui-theme` Host half contributes two
 * boot rows through `webserver/index-inject`: a head `<style>` painting
 * `body{background-color:#151517}` (or `#fff`) plus `color-scheme`, and a body
 * script that installs `data-ds-theme-source` / `data-ds-dark-theme` from the
 * DURABLE built-in preference. Those two decide the colour of everything BEFORE
 * any script runs. Our two flavours can only be `theme.register()`ed and
 * `setTheme()`d by the Client bundle, i.e. strictly after first paint — so a
 * Moonset user sees the official canvas flash first. This module paints the same
 * document canvas with the flavour's own table, and the Client removes the sheet
 * the moment the choice actually takes over (`src/client/boot-cleanup.ts`): it
 * must not outlive that point, because a leftover sheet outranks the official
 * `body` block and would pin every token against later theme switches.
 *
 * Contract notes (re-verified against the sources shipped in the installed
 * 0.2.2-rc.5 desktop archive, not just against the reference repo):
 *  - Rows are plain JSON (`IndexInjection`, `dsh-host-webserver/src/injections.ts`):
 *    `{ kind: 'style', text }`, `{ kind: 'script', placement, text }`,
 *    `{ kind: 'html', placement, html }` (plus `global` / `script-src` /
 *    `script-preload`, which this module does not use). This module uses
 *    `html` for the sheet so it can carry an identifying attribute the Client
 *    can query — a `style` row renders without attributes.
 *  - `renderIndexInjections` places head rows immediately after the opening
 *    `<head>` tag and body rows immediately after the opening `<body>` tag,
 *    each group in TABLE order. Our rows therefore land BEFORE the official
 *    `<link rel="stylesheet">` elements, so document order does NOT favour us;
 *    the sheet selector is `html body` (0,0,2), which beats the official
 *    `body` (0,0,1) token block that the Client bundle installs later. Do not
 *    rely on row order.
 *  - The official theme registers its own listener with
 *    `ctx.on('webserver/index-inject', …, { prepend: true })` (cordis
 *    `EventOptions.prepend`), so its two rows are pushed before ours. That is
 *    the only sense in which "we come last" — see the previous note for why the
 *    cascade, not the order, is what makes the sheet win.
 *  - The served index carries no CSP header (no `Content-Security-Policy`
 *    anywhere in `dsh-host-webserver`), so inline style/script is allowed —
 *    exactly what the official theme relies on.
 *  - The rows are emitted only where the Host can READ the durable choice: the
 *    config field must be a volatile ref (`Config.choice.get()` on DSH >= 0.1.7).
 *    On the legacy seam the entry config is the profile patch's STATIC value,
 *    not the settings document, so injecting from it would paint the wrong
 *    palette — such hosts get no rows at all.
 *
 * What this module deliberately does NOT emit (the milestone pins the row shape
 * to the 228-token table alone; see M6's report for the consequences):
 * `color-scheme`, the canvas `background-color` the reference sheet carries, and
 * a fixed-scheme body script for the non-follow choices.
 */
import type {} from '@deepseek-ai/cordis'
import { MOONSET_DARK, MOONSET_LIGHT, type MoonsetTokenTable } from './client/palettes.ts'

/**
 * Attribute marking the injected `<style>` so the Client can find it.
 *
 * The Client half restates this literal (`src/client/boot-cleanup.ts`) rather
 * than importing this module: the two halves are separate bundles, and pulling
 * the host row builders (and both 12 KB tables) into `lib/client.js` for one
 * attribute name would be the wrong trade. `tests/boot.spec.ts` cross-checks the
 * two copies so a drift cannot pass.
 */
export const BOOT_SHEET_ATTR = 'data-dsh-moonset-boot'

/**
 * One index-injection row, structurally typed.
 *
 * The host package (`@deepseek-ai/dsh-host-webserver`) is NOT a dependency of
 * this plugin — the event is emitted by the host — so the shape is declared
 * here. It mirrors the installed host's `IndexInjection` union; anything this
 * plugin does not use (`global`, `script-src`, `script-preload`) is omitted on
 * purpose.
 */
export type BootPaletteRow =
  | { kind: 'style'; text: string }
  | { kind: 'script'; placement: 'head' | 'body'; text: string }
  | { kind: 'html'; placement: 'head' | 'body'; html: string }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The host webserver's structured index-injection table: listeners push
     * their current rows on every index render and every worker boot-payload
     * request, so a row's data is read fresh at emit time. The host passes a
     * second `peer` argument; this plugin states only the table it uses.
     */
    'webserver/index-inject'(table: BootPaletteRow[]): void
  }
}

/**
 * The config fields this module reads, in BOTH shapes they arrive in: a volatile
 * ref (`{ get() }`) on DSH >= 0.1.7, a plain value on older hosts (where the
 * value is the patch's static default, not the durable choice).
 */
export interface BootPaletteConfig {
  /** The user's durable Moonset choice (`off` / `light` / `dark` / `follow`). */
  readonly choice?: unknown
}

/**
 * Read a volatile config ref; `undefined` when the field is NOT a ref.
 *
 * Returning `undefined` for plain values is the legacy-host gate described in
 * the module header: a plain `choice` is the profile patch's default, so
 * painting it would fight the durable document. A getter that throws is treated
 * the same way — the Host half must never fail the page render.
 * @param value - the raw config field.
 * @returns the current value, or `undefined` when there is no usable ref.
 */
function readVolatile(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  const getter = (value as { get?: unknown }).get
  if (typeof getter !== 'function') return undefined
  try {
    return (getter as () => unknown).call(value)
  } catch {
    return undefined
  }
}

/**
 * Characters that can end the declaration, the declaration block or the
 * `<style>` element itself.
 *
 * Values are CSS expressions, so everything else stays allowed:
 * `color-mix(…)`, `var(…)`, `rgba(…)`, spaces, commas, quotes, slashes. The
 * guard is the reference implementation's `cssSafeOverrides` rule, applied here
 * to a table we generate ourselves: a palette value can never contain one of
 * these today (228/228 clean, pinned by the test), so a drop means a future
 * hand-edit went wrong — hence the warning rather than a silent skip.
 */
const UNSAFE_CSS_VALUE = /[<>\\{};\u0000-\u001f]/u

/** A CSS custom-property name; the only keys the sheet may declare. */
const TOKEN_NAME = /^--[A-Za-z0-9_-]+$/u

/**
 * One line per dropped declaration, always prefixed, never thrown: this runs
 * inside the page render path, where a throw would take the whole index down.
 * @param name - the token that was dropped.
 * @param reason - why it could not be embedded.
 */
function warnDropped(name: string, reason: string): void {
  console.warn(`[dsh-moonset] boot sheet: dropped "${name}" — ${reason}`)
}

/**
 * Render one token table as a CSS declaration list (`name:value;…`, no trailing
 * semicolon). Order follows the table, so the output is byte-stable.
 * @param tokens - the `--dsw-*` table to embed.
 * @returns the declarations safe to concatenate into a `{…}` block.
 */
export function declarationText(tokens: MoonsetTokenTable): string {
  const declarations: string[] = []
  for (const [name, value] of Object.entries(tokens)) {
    if (!TOKEN_NAME.test(name)) {
      warnDropped(name, 'not a CSS custom-property name')
      continue
    }
    if (typeof value !== 'string') {
      warnDropped(name, 'value is not a string')
      continue
    }
    if (UNSAFE_CSS_VALUE.test(value)) {
      warnDropped(name, "value could escape the declaration or the style element")
      continue
    }
    declarations.push(`${name}:${value}`)
  }
  return declarations.join(';')
}

/**
 * The pre-paint sheet for one fixed choice (carries {@link BOOT_SHEET_ATTR}).
 *
 * `html body` (0,0,2) is load-bearing: the official token table is a `body`
 * block (0,0,1) installed by the Client bundle AFTER this sheet, so a plain
 * `body` selector here would lose on order alone.
 * @param tokens - the table of the persisted choice.
 * @returns a complete `<style>…</style>` fragment for a `kind: 'html'` row.
 */
export function bootSheet(tokens: MoonsetTokenTable): string {
  return `<style ${BOOT_SHEET_ATTR}>html body{${declarationText(tokens)}}</style>`
}

/**
 * The pre-paint sheet for FOLLOW mode: the light half is the default block and
 * the dark half sits behind `prefers-color-scheme`.
 *
 * A media query works here and NOT in the Client: this sheet is plain CSS
 * evaluated by the renderer before any script decides a preference, so it tracks
 * the OS by itself. The Client cannot do the same — which is exactly why follow
 * mode keeps the runtime preference on `system` and stacks a token layer (M4).
 * The dark block is emitted AFTER the light one so it wins at equal specificity.
 * @param light - the light table.
 * @param dark - the dark table.
 * @returns a complete `<style>…</style>` fragment for a `kind: 'html'` row.
 */
export function followSheet(light: MoonsetTokenTable, dark: MoonsetTokenTable): string {
  return `<style ${BOOT_SHEET_ATTR}>`
    + `html body{${declarationText(light)}}`
    + `@media (prefers-color-scheme: dark){html body{${declarationText(dark)}}}`
    + '</style>'
}

/**
 * The body script for follow mode: align `data-ds-dark-theme` with the OS
 * instead of a fixed scheme, so the attribute-keyed rules (ours and the host's)
 * are right on the first frame. Same text as the reference implementation: it
 * touches NOTHING else — `data-ds-theme-source` and the font variables stay the
 * official script's business.
 * @returns the script text for a `kind: 'script'` row.
 */
export function followPaletteScript(): string {
  return "(()=>{document.body.toggleAttribute('data-ds-dark-theme',matchMedia('(prefers-color-scheme: dark)').matches)})()"
}

/**
 * The boot rows for the current Host state.
 *
 * Empty — deliberately — in every case where the Host cannot prove what the user
 * chose: no config at all, no volatile ref (legacy seam, see the module header),
 * `off` (`no choice made`, so the official first frame is the correct one), and
 * any value that names no choice (a hand-edited document, a pre-release value).
 * An empty array is a legal result, never an error.
 * @param config - the plugin config the Loader hands `apply`.
 * @returns rows to `push` into the `webserver/index-inject` table.
 */
export function bootPaletteRows(config: BootPaletteConfig | undefined): BootPaletteRow[] {
  const choice = readVolatile(config?.choice)
  if (typeof choice !== 'string') return []
  if (choice === 'light') return [{ kind: 'html', placement: 'head', html: bootSheet(MOONSET_LIGHT) }]
  if (choice === 'dark') return [{ kind: 'html', placement: 'head', html: bootSheet(MOONSET_DARK) }]
  if (choice === 'follow') {
    return [
      { kind: 'html', placement: 'head', html: followSheet(MOONSET_LIGHT, MOONSET_DARK) },
      { kind: 'script', placement: 'body', text: followPaletteScript() },
    ]
  }
  return []
}
