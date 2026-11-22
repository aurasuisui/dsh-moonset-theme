/**
 * Client half of the first-paint sheet (M6): take the Host-injected `<style>`
 * back out once the theme it painted for has actually taken over.
 *
 * The sheet the Host injects (`src/boot-palette.ts`) is a HEAD `<style>` whose
 * selector (`html body`, 0,0,2) outranks the official `body` token block
 * (0,0,1). That is what makes it win before the Client runs — and exactly why it
 * must NOT survive the handover: left in the document it would pin all 228
 * tokens and defeat every later theme switch, including the user picking an
 * official theme from the Appearance row.
 *
 * Boundary (M5's DOM rule still holds): this module's ONLY mutation is removing
 * that one element. It never writes an inline `style` attribute on the `html`
 * element, on `body`, or on any other node — the tokens belong to the theme
 * runtime and its presenters, not to a plugin.
 *
 * Everything here is deliberately total: no sheet present, no `document` at all
 * (a non-browser harness), or a twice-run handover all end as a quiet no-op. The
 * call sits on the Client's boot path, where a throw would take the user's whole
 * plugin set down.
 */

/**
 * Attribute marking the injected `<style>`.
 *
 * Restated from `src/boot-palette.ts` instead of imported: the Host and Client
 * halves are separate bundles, and importing the Host module here would inline
 * its row builders (and both 12 KB palette tables) into `lib/client.js` for one
 * attribute name. `tests/boot.spec.ts` cross-checks the two literals, so a drift
 * cannot pass unnoticed.
 */
export const BOOT_SHEET_ATTR = 'data-dsh-moonset-boot'

/**
 * The exact selector the removal uses: a `<style>` ELEMENT carrying our
 * attribute. Attribute + element type (not the attribute alone) so a peer that
 * happens to use the same attribute on something else is never touched.
 */
export const BOOT_SHEET_SELECTOR = `style[${BOOT_SHEET_ATTR}]`

/**
 * The document surface this module needs. Declared structurally so the handover
 * can be exercised without a DOM implementation (this repo carries none — PLAN
 * 九、已知债), and so nothing else on `Document` is reachable from here.
 */
export interface BootSheetRoot {
  /** Find the first element matching `selector`, or `null`. */
  querySelector(selector: string): { remove(): void } | null
}

/**
 * Remove the Host-injected boot sheet, if this page still carries it.
 *
 * Idempotent by construction: after a successful removal the next call finds
 * nothing. Called from the boot restore and from a user pick (the theme actually
 * takes over in both), and from the choice effect's teardown so unloading the
 * plugin cannot leave a sheet pinned behind it.
 * @param root - document to clean; defaults to the page's own `document`.
 * @returns whether a sheet was found and removed (diagnostics only — callers
 *   ignore it, and `false` is a normal outcome, not a failure).
 */
export function removeBootSheet(root?: BootSheetRoot): boolean {
  const target = root ?? (typeof document === 'undefined' ? undefined : document as unknown as BootSheetRoot)
  if (target === undefined) return false
  try {
    const sheet = target.querySelector(BOOT_SHEET_SELECTOR)
    if (sheet === null) return false
    sheet.remove()
    return true
  } catch (error) {
    // An embedder that refuses the query is not a reason to fail the handover.
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[dsh-moonset] could not remove the boot sheet — ${message}`)
    return false
  }
}
