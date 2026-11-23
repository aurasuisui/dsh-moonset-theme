/**
 * The skin layer (0.1.1): ONE root attribute plus ONE injected stylesheet, and
 * nothing else in the document.
 *
 * Why a stylesheet at all is a decision, not a default (contract §一 P5): the
 * theme speaks tokens, and tokens ARE most of the skin. A handful of visual
 * surfaces cannot be reached by a `--dsw-*` value at all, and the text
 * selection is the first of them — the official design-platform stylesheets
 * carry no `::selection` rule (0.2.2-rc.5, 9 sheets, 0 hits), so the browser's
 * default blue is painted by the UA and no token can move it. Those surfaces are
 * the whitelist in `docs/architecture.md` §11; everything else stays on the
 * token side, where a theme switch carries it for free.
 *
 * The shape is fixed by P2, and the two halves are one contract:
 *
 *  1. `<html data-moonset-skin>` — the root attribute. It is both the "skin is
 *     on" signal and, for the rules that need it, the gate that keeps an
 *     orphaned sheet inert (`html[data-moonset-skin] ...`).
 *  2. `<style data-dsh-moonset-skin>` in `<head>` — a SINGLETON. Repeated
 *     mounts must not stack a second sheet (two sheets would fight over the same
 *     declaration order and the loser would depend on document order).
 *
 * Unload is the exact inverse, and it must be total: attribute off, sheet gone,
 * no residue. Everything here is idempotent for that reason — mounting twice is
 * one mount, unmounting twice is fine, and an unmount cleans up a duplicate
 * someone else leaked (nothing of ours may outlive the plugin).
 *
 * Performance (P1): this module registers no event listener, starts no
 * animation-frame loop and observes nothing. The only two moments it runs are
 * the plugin's activation and its teardown; the sheet itself is drawn by the
 * engine.
 *
 * DOM rule: every DOM write in the client half is one of ours. `boot-cleanup.ts`
 * removes the Host's first-paint sheet; this module adds one attribute and one
 * element, then removes exactly those. No host node is restructured, no layout
 * property is written, and no inline style is attached to any element.
 *
 * The sheet is not unconditional, though: it paints OUR accent, so it may only
 * exist while a Moonset theme does. {@link syncSkin} is the one place that
 * policy lives, and `index.ts` calls it from every path that learns a choice.
 */
import type { MoonsetChoice } from './choice.ts'

/**
 * The root attribute that gates the skin.
 *
 * Boolean-style: the NAME is the contract (that is what
 * `html[data-moonset-skin]` matches) and the value is the empty string, so a
 * future milestone can widen the gate without changing the selector.
 */
export const SKIN_ATTR = 'data-moonset-skin'

/**
 * The attribute marking the injected `<style>`.
 *
 * `data-dsh-moonset-skin` on purpose (P2): the `dsh-moonset` prefix keeps it
 * greppable in a DevTools copy of the head, and the `data-dsh-*` namespace is
 * what the boot sheet (`data-dsh-moonset-boot`) already uses, so a reader can
 * tell both sheets apart by prefix alone.
 */
export const SKIN_SHEET_ATTR = 'data-dsh-moonset-skin'

/**
 * The exact selector the sheet is found by: a `<style>` ELEMENT carrying our
 * attribute. Element type + attribute (not the attribute alone) so a peer that
 * reuses the name on another node is never touched.
 */
export const SKIN_SHEET_SELECTOR = `style[${SKIN_SHEET_ATTR}]`

/**
 * The skin's rules, as text — a PURE function of nothing.
 *
 * Pure on purpose: the sheet's exact bytes are the contract the tests pin
 * (`tests/skin.spec.ts` compares them verbatim), so it must not depend on the
 * document, the clock, the palette or the scheme. Scheme-correctness comes from
 * the token the rule references: `--dsw-static-deepseek-500` is the accent
 * anchor (light #4338CA, dark #818CF8), so one rule follows both schemes and
 * every theme switch automatically.
 *
 * The rule mirrors the documentation site's `selection:bg-indigo-500/20`
 * `selection:text-indigo-700` pair: a 22% accent wash with the accent ITSELF as
 * the text colour (the first real-machine pass shipped ink text on a violet
 * wash and read as "grey-violet", not as the web). Measured contrast of the
 * selected text against that wash: light 5.25:1, dark 4.55:1 over `bg-base`
 * (both clear the 4.5:1 AA floor; `tests/skin.spec.ts` re-derives them from the
 * palette so a future anchor change cannot silently fail it).
 *
 * How the exception maps onto §一 P5's whitelist:
 *
 *   `::selection`  text selection — cannot be expressed as a token (see the
 *                   module doc above), so it is the FIRST whitelist entry;
 *   body wash       (0.1.2) surface gradient, also whitelisted;
 *   material faces  (0.1.3) `::before` planes, also whitelisted.
 *
 * The selector is `html body ::selection` (0,0,2) so it outranks a plain
 * `::selection` (0,0,1) from any third-party sheet that happens to set one; the
 * sheet is also appended after the host's sheets, so a same-specificity rule
 * still loses to ours.
 * @returns the complete CSS text of the single skin sheet.
 */
export function skinCss(): string {
  return [
    '/* dsh-moonset[0.1.1]: skin layer — P5 whitelist, ::selection only */',
    'html body ::selection {',
    '  background: color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent);',
    '  color: var(--dsw-static-deepseek-500);',
    '}',
  ].join('\n')
}

/**
 * The style element this module builds. Declared structurally — this repo
 * carries no DOM implementation (PLAN §九 已知债), so the tests drive a
 * hand-written stub and a new requirement shows up as a missing member instead
 * of passing silently.
 */
export interface SkinSheetElement {
  /** Write one attribute (used once, to stamp {@link SKIN_SHEET_ATTR}). */
  setAttribute(name: string, value: string): void
  /** The sheet's rule text. */
  textContent: string
  /** Detach this element from its parent. */
  remove(): void
}

/**
 * The document surface the skin needs, and nothing more.
 *
 * `documentElement` is `<html>` (attribute only), `head` is the one place the
 * sheet is appended, and the two factories/query members map onto the real DOM
 * 1:1. `src/boot-cleanup.ts` declares its own, narrower surface for the same
 * reason: production passes the real `document` through a cast, and the tests
 * pass a stub.
 */
export interface SkinRoot {
  /** `<html>`: carries {@link SKIN_ATTR} while the skin is mounted. */
  documentElement: {
    setAttribute(name: string, value: string): void
    removeAttribute(name: string): void
  }
  /** `<head>`: the only node that ever receives the sheet. */
  head: {
    appendChild(node: SkinSheetElement): void
  }
  /** First element matching the selector, or `null` (singleton check + removal). */
  querySelector(selector: string): SkinSheetElement | null
  /** Build the sheet element; `'style'` is the only tag this module creates. */
  createElement(tagName: 'style'): SkinSheetElement
}

/**
 * Resolve the document to act on.
 * @param root - explicit surface (tests); omitted means the page's own document.
 * @returns the surface, or `undefined` outside a browser (a Node harness).
 */
function resolveRoot(root?: SkinRoot): SkinRoot | undefined {
  if (root !== undefined) return root
  return typeof document === 'undefined' ? undefined : document as unknown as SkinRoot
}

/**
 * Announce a refused DOM operation once, and carry on.
 *
 * The skin sits on the plugin's activation path, where a throw would take the
 * user's whole plugin set down; a document that refuses a write is a reason to
 * lose the skin, not the boot.
 * @param action - what was being done ("mount" / "unmount").
 * @param error - the thrown value.
 */
function reportFailure(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[dsh-moonset] could not ${action} the skin sheet — ${message}`)
}

/**
 * Mount the skin: root attribute on, sheet in the head. Idempotent.
 *
 * The order is attribute FIRST, then the singleton check: an already mounted
 * skin must still end up with the attribute set (it is the gate every future
 * rule reads), and the sheet is only built when the document does not carry one
 * already. Repeated mounts therefore converge to exactly one sheet (P2).
 * @param root - document surface; defaults to the page's own (see
 *   {@link resolveRoot}).
 * @returns whether the document now carries the skin. `false` is the normal
 *   outcome in a non-browser harness, not a failure; the value is diagnostics
 *   only.
 */
export function mountSkin(root?: SkinRoot): boolean {
  const target = resolveRoot(root)
  if (target === undefined) return false
  try {
    target.documentElement.setAttribute(SKIN_ATTR, '')
    if (target.querySelector(SKIN_SHEET_SELECTOR) !== null) return true
    const sheet = target.createElement('style')
    sheet.setAttribute(SKIN_SHEET_ATTR, '')
    sheet.textContent = skinCss()
    target.head.appendChild(sheet)
    return true
  } catch (error) {
    reportFailure('mount', error)
    return false
  }
}

/**
 * Unmount the skin: attribute off, every sheet of ours gone. Idempotent.
 *
 * The sheet loop is defensive: a mounted singleton cannot leak a second sheet,
 * but an unmount must still end with ZERO residue if one appeared (a second
 * copy of this plugin, a hot reload, a manual paste). The loop stops when the
 * query returns the element it just removed — that is also the guard against a
 * surface whose `remove()` does not detach.
 * @param root - document surface; defaults to the page's own.
 * @returns whether at least one sheet was removed (diagnostics only).
 */
export function unmountSkin(root?: SkinRoot): boolean {
  const target = resolveRoot(root)
  if (target === undefined) return false
  let removed = false
  try {
    target.documentElement.removeAttribute(SKIN_ATTR)
    let sheet = target.querySelector(SKIN_SHEET_SELECTOR)
    while (sheet !== null) {
      sheet.remove()
      removed = true
      const next = target.querySelector(SKIN_SHEET_SELECTOR)
      if (next === sheet) break
      sheet = next
    }
    return removed
  } catch (error) {
    reportFailure('unmount', error)
    return removed
  }
}

/**
 * Align the skin with the stored choice (0.1.1): `off` → off, anything else → on.
 *
 * Why the skin is choice-gated at all: the sheet paints OUR accent, and `off`
 * means "the user runs the official theme" — a Moonset-violet text selection on
 * top of the official palette is exactly the inconsistency this milestone is
 * supposed to remove, not install. `light` / `dark` / `follow` all paint a
 * Moonset palette (the last one through the follow layer), so the skin stays.
 *
 * This function owns the POLICY, not the moments. `index.ts` calls it from
 * every path that learns or changes the choice:
 *
 *  - the boot `restore()` — the first place a stored value is readable (a
 *    profile that stored `off` must not keep a sheet `apply()` mounted);
 *  - `pick()` — a click in our section;
 *  - the mirror path — the user picked an official theme in Appearance, so the
 *    choice is handed back as `off`.
 *
 * Both branches are idempotent ({@link mountSkin} / {@link unmountSkin} are), so
 * calling it with the same choice twice is free — which is what lets the boot
 * path call it without first asking whether the skin is on.
 * @param choice - the stored choice (a queued intent included).
 * @param root - document surface; defaults to the page's own.
 * @returns whether the skin is ON after this call (diagnostics only).
 */
export function syncSkin(choice: MoonsetChoice, root?: SkinRoot): boolean {
  if (choice === 'off') {
    unmountSkin(root)
    return false
  }
  return mountSkin(root)
}
