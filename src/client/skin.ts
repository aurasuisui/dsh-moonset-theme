/**
 * The skin layer (0.1.1–0.1.2): ONE root attribute plus ONE injected stylesheet, and
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
 * Options accepted by {@link skinCss}.
 *
 * The signature is the seam for 0.1.2's user-facing switch (M2): the ground
 * rule is already one independent segment, so "off" can remove the whole
 * `background` instead of writing alpha 0 (which still composites — 0.1.2 §一).
 */
export interface SkinOptions {
  /** The 0.1.2 environment glow — the wash and both fixed spots. Defaults on. */
  glow?: boolean
}

/**
 * The 0.1.2 ground segment — kept apart from the 0.1.1 rules so the M2 switch
 * can emit nothing at all instead of a zero-alpha rule.
 *
 * One `background`, layers top-first: the moon halo, the warm light, then the
 * wash; the final layer carries the canvas token as its colour (the shorthand
 * would otherwise reset `background-color` to transparent). Every colour is a
 * `color-mix()` of a static token with `transparent`, and the alpha product is
 * inlined (`calc(N% * 1)`), never routed through an intermediate custom
 * property — see {@link skinCss} for the Chromium evidence behind that rule
 * (0.1.2 D2).
 *
 * M1.5 appends the second half: the VISIBILITY block. A `body` background is
 * the bottom of the paint order, and the host paints `--dsw-alias-bg-base` on
 * every shell layer between it and the conversation. The chain, read out of the
 * INSTALLED 0.2.2-rc.5 bundles (not inferred from class names — those are
 * hashed per build):
 *
 *   body
 *    > #root                     the React container — the shell mounts into it
 *                                (`getElementById('root')` in the web-frontend
 *                                bundle; the renderer's `mountApp` owns the root)
 *    > div[data-slot='root']     display:contents — RootOutlet's anchor
 *    > div.frame                 background: bg-base (sidebar-fill on Windows)
 *    > div.centerCol             background: bg-base when [data-windows-titlebar]
 *    > div.mainPanel             no background
 *    > div[data-slot='main']     display:contents — SlotOutlet's anchor
 *    > div.root                  background: bg-base   <- the conversation
 *
 * `html` and `#root` are audited transparent: no host sheet paints either (the
 * only `html` background rule is `[data-platform='darwin']`) and no shipped
 * bundle writes an inline one, so the `body` background propagates to the
 * canvas and M1's ground IS painted — before M1.5 it was simply covered by the
 * opaque carriers below. Clearing exactly those COLOURS is what lets it through
 * (user report on the installed build: "完全看不到光晕"); their images and
 * shadows stay, and no layout property is written (§11.4).
 *
 * Scope (the "plan C" decision): EVERY carrier surface — the shell chain, the
 * three columns, the sidebar's own fill layer and every panel page root — not
 * only the conversation column. The judgement is "fills a column or the whole
 * screen", never "wraps a piece of content":
 *
 *   cleared:  div[data-slot='root'], .frame, .sidebarCol, .centerCol,
 *             .rightbarCol (darwin only), .bottomRow, .mainPanel, .root of the
 *             conversation, SidebarRoot's .root (a second sidebar-fill layer,
 *             audited in SidebarRoot.module.css) and a global panel page root;
 *   kept:     cards, message bubbles, code blocks, the composer card, menu
 *             popovers (they portal to `body`, outside `#root` entirely), and
 *             the rightbar's inner panes (terminal/file tree — content).
 *
 * The selectors do NOT count levels, on purpose. The anchors are emitted by the
 * RENDERER, not by ui-layout: `dsh-client-ui-renderer/lib/client.js` renders
 * `{"data-slot": slotKey}` in SlotOutlet, `{"data-slot": 'root'}` in
 * RootOutlet, both with `ANCHOR_STYLE = {display:'contents'}` — ui-layout only
 * calls `renderSlot('main', …)`, so grepping `data-slot` in THAT bundle finds
 * nothing and proves nothing. Because the anchors are `display: contents`,
 * the shell's depth is a renderer detail that can grow or lose a wrapper
 * without changing a single visible pixel; a selector counting child
 * combinators goes blind on the first such change, which is exactly the
 * invisible-ground failure this block fixes. Containment (plus two
 * `> div` roots, the anchors' direct children) is used instead:
 *
 *   :has([main, sidebar, rightbar])  every carrier that CONTAINS one of the
 *                                    three shell slots: the root anchor, the
 *                                    frame, the three columns, the main panel —
 *                                    i.e. the layers that paint bg-base or
 *                                    sidebar-fill;
 *   :has([data-composer-seat])       the conversation's own containers up to
 *                                    and including `.root` (ui-conversation
 *                                    renders the seat with that attribute), so
 *                                    `.root` is reached even if a wrapper ever
 *                                    appears between the anchor and it;
 *   :has(> [data-slot='shell.bottom'])  the frame's bottom cell (its second grid
 *                                    row), which also paints bg-base;
 *   [data-slot='main'] > div          the elected panel root: the conversation's
 *                                    `.root`, or a global panel's page —
 *                                    `[data-global-panel]` sits on the main panel
 *                                    only while a panel is open, so the flat
 *                                    anchor child is the stable spelling;
 *   [data-slot='sidebar'] > div       SidebarRoot's own root, the second layer
 *                                    that draws sidebar-fill.
 *
 * A descendant can never contain its own ancestor, so no card, message, code
 * block or field inside the panel is ever one of the `:has()` sets: the
 * clear stops at the carrier roots, and every host class name stays unused.
 */
const GLOW_RULES: readonly string[] = [
  '/* 0.1.2 ground: canvas + wash + two fixed spots in ONE declaration. The',
  '   strength factor is inlined in each color-mix (`calc(N% * 1)` = 100% here):',
  '   a custom-property hop would not recompute on Chromium (0.1.2 D2). */',
  'html[data-moonset-skin] body {',
  '  background:',
  '    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--dsw-static-deepseek-500) calc(16% * 1), transparent) 0%, transparent 62%),',
  '    radial-gradient(ellipse at 92% 88%, color-mix(in srgb, var(--dsw-static-amber-500) calc(10% * 1), transparent) 0%, transparent 60%),',
  '    linear-gradient(165deg, color-mix(in srgb, var(--dsw-static-deepseek-500) calc(1.5% * 1), transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);',
  '}',
  '/* 0.1.2 visibility (plan C, all-transparent): the host paints bg-base on the',
  '   shell chain, the columns and every panel root, and the sidebar draws',
  "   sidebar-fill; clear the COLOUR of exactly those carriers — cards, bubbles,",
  '   the composer and menus keep their own paint, no layout property is written. */',
  "html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar']),",
  "html[data-moonset-skin] #root :has([data-composer-seat]),",
  "html[data-moonset-skin] #root :has(> [data-slot='shell.bottom']),",
  "html[data-moonset-skin] #root [data-slot='main'] > div,",
  "html[data-moonset-skin] #root [data-slot='sidebar'] > div {",
  '  background-color: transparent;',
  '}',
]

/**
 * The skin's rules, as text — a PURE function of its options only.
 *
 * Pure on purpose: the sheet's exact bytes are the contract the tests pin
 * (`tests/skin.spec.ts` compares them verbatim), so it must not depend on the
 * document, the clock, the palette or the scheme. Scheme-correctness comes from
 * the tokens the rules reference: `--dsw-static-deepseek-500` is the accent
 * anchor (light #4338CA, dark #818CF8), `--dsw-static-amber-500` is the moon
 * anchor (#F59E0B in both schemes) and `--dsw-alias-bg-base` is the canvas, so
 * every rule follows both schemes and every theme switch automatically.
 *
 * The rule mirrors the documentation site's `selection:bg-indigo-500/20`
 * `selection:text-indigo-700` pair: a 22% accent wash with the accent ITSELF as
 * the text colour (the first real-machine pass shipped ink text on a violet
 * wash and read as "grey-violet", not as the web). Measured contrast of the
 * selected text against that wash: light 5.25:1, dark 4.55:1 over `bg-base`
 * (both clear the 4.5:1 AA floor; `tests/skin.spec.ts` re-derives them from the
 * palette so a future anchor change cannot silently fail it).
 *
 * The second rule is the SELECTED-ITEM LABEL colour: the token work above gives
 * a selected row the violet wash, but the host still paints its text with
 * `--dsw-alias-label-primary` (ink), so the row reads "violet background, black
 * text". No token can carry this: the colour is declared on the container by
 * rules that cannot be re-pointed from a custom property, so it has to be a CSS
 * exception (the whitelist's second entry).
 *
 * That rule is keyed on STABLE ATTRIBUTES only — `aria-selected`,
 * `aria-current`, `data-active` — never on a host class name (those are hashed
 * per build). It is gated on our root attribute for two reasons: P2 says the
 * sheet is gated that way, and the gate is what makes it WIN. `html body
 * [data-active='true']` is (0,1,2) and loses to the host's
 * `.tab[data-active='true']` (0,2,0), which is exactly the plugins-tab label
 * the first real-machine pass left ink; `html[data-moonset-skin] body
 * [data-active='true']` is (0,2,2) and wins. No `!important`, no wildcard
 * subtree selector: muted children (timestamps, summaries) set their own colour
 * and keep it, so only the primary label turns violet. Measured contrast of the
 * accent label on the selected-row wash: light 6.45:1, dark 5.58:1.
 *
 * Two more seats ride the same idea:
 *
 *  - **pressed chips** (`[aria-pressed='true']`): the automation filter tabs
 *    spell "selected" as a pressed toggle. Accepted because in this UI pressed
 *    and selected are the same state; the rule therefore also colours pressed
 *    like/dislike buttons, which is the intended reading.
 *  - **the selected tab's underline** (`[data-active='true']::after`): the host
 *    draws it as a 2px ink bar, which would leave a black bar under violet text.
 *    The selector is NOT narrowed to `[role='tab']`: only the plugins tab renders
 *    an `::after` on a `data-active` element (audited in the installed sources —
 *    the retry disclosure arrow is `summary::after`, the badge and feedback
 *    buttons have no `::after`), so the broader selector is exact in practice.
 *
 * One seat remains out: `[aria-expanded='true']` (the automation page's selected
 * task row) is deliberately NOT whitelisted — "expanded" is not "selected" and
 * the same attribute sits on every menu trigger and disclosure, so colouring it
 * would repaint states the skin should not touch.
 *
 * The 0.1.2 GROUND is one more rule — the whitelist's third entry. It is a
 * single `background` on `body`, root-gated, three layers above the canvas
 * token: a low-contrast wash (`linear-gradient(165deg, accent 1.5% → transparent
 * 70%)`; the left-to-right spread at 1920×1080 is ~1.3/255 in light and
 * ~1.6/255 in dark, inside the contract's "<= 2/255" band) plus two
 * viewport-fixed spots — an indigo moon halo at top-centre (16%) and an amber
 * warm light at the bottom-right (10%). The hues are mixed from
 * `--dsw-static-deepseek-500` (accent) and `--dsw-static-amber-500` (moon);
 * no literal colour enters the sheet. The canvas token rides as the colour of
 * the final layer on purpose: a `background` shorthand resets
 * `background-color` to transparent, so the base has to be part of the same
 * declaration or the ground would go see-through.
 *
 * The strength factor lives INSIDE each `color-mix()` percentage as
 * `calc(16% * 1)` — 1 is M1's constant 100%, and M2 substitutes the user value
 * (`var(--dsh-moonset-glow-strength, 1)`) in exactly that seat. It is inlined
 * instead of being pre-computed into an intermediate custom property because
 * catppuccin measured on Chromium that such a hop does not recompute when the
 * property changes, i.e. the knob "dies" (0.1.2 D2). The ground also lives in
 * its own segment ({@link GLOW_RULES}) so the M2 switch can drop the WHOLE
 * rule — alpha 0 would still composite (0.1.2 §一).
 *
 * M1.5: a ground on `body` is only visible if nothing opaque paints over it,
 * and on the installed build every carrier surface does — `.frame`,
 * `.sidebarCol` + SidebarRoot's `.root` (sidebar-fill), `.centerCol` and
 * `.rightbarCol` on the caption/vibrancy shells, `.bottomRow`, the conversation
 * root and every global panel page root all carry a `background` (audited in
 * `AppFrame.module.css`, `SidebarRoot.module.css`,
 * `ConversationRoot.module.css`, `TaskManagerPage.module.css`). `html` and
 * `#root` are transparent (no host rule, no inline write), so the ground is
 * painted and was simply buried. The visibility block clears `background-color`
 * on exactly those carriers — the whole screen, in the user's "plan C" decision
 * — and stops there: the surfaces inside them (cards, bubbles, code blocks, the
 * composer card, menu popovers) keep their own paint — {@link GLOW_RULES}
 * carries the audited chain, the bundle evidence for the anchors, the exact
 * cleared/kept lists and why the selectors do not count levels.
 *
 * It is the ONE place where §11.4's "no structural selector" gives way, and it
 * gives way for the reason this layer exists at all: those surfaces carry no
 * stable attribute — `data-global-panel` sits on the main panel only while a
 * global panel is open, and `.frame` / `.centerCol` / `.root` are hashed class
 * names. Structure (`#root`, the shell's fixed mount point in `index.html`)
 * plus the two renderer/app anchors (`[data-slot='main']`, and the conversation's
 * `[data-composer-seat]` as an independent second address) are the only stable
 * handles. No wildcard, no class name, no `!important`, no layout property —
 * and it rides the SAME switch as the ground: `glow: false` drops both halves,
 * so the 0.1.1 sheet is still returned byte-for-byte (D4).
 *
 * How the exception maps onto §一 P5's whitelist:
 *
 *   `::selection`  text selection — cannot be expressed as a token (see the
 *                   module doc above), so it is the FIRST whitelist entry;
 *   body ground     (0.1.2) wash + two fixed spots, also whitelisted;
 *   material faces  (0.1.3) `::before` planes, also whitelisted.
 *
 * The selector is `html body ::selection` (0,0,2) so it outranks a plain
 * `::selection` (0,0,1) from any third-party sheet that happens to set one; the
 * sheet is also appended after the host's sheets, so a same-specificity rule
 * still loses to ours.
 * @param options - the emit switches; omitted means every 0.1.2 layer is on
 *   (the default 100% look). Only the ground segment is switchable so far.
 * @returns the complete CSS text of the single skin sheet.
 */
export function skinCss(options: SkinOptions = {}): string {
  const rules = [
    '/* dsh-moonset[0.1.2]: skin — P5 whitelist (selection, selected-item text, ground) */',
    'html body ::selection {',
    '  background: color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent);',
    '  color: var(--dsw-static-deepseek-500);',
    '}',
    '/* selected items: stable attributes only, never a host class name. The root',
    '   attribute gate is what outranks the host (0,2,2 vs .tab[data-active] 0,2,0). */',
    "html[data-moonset-skin] body [aria-selected='true'],",
    "html[data-moonset-skin] body [aria-current='page'],",
    "html[data-moonset-skin] body [aria-current='true'],",
    "html[data-moonset-skin] body [data-active='true'],",
    "html[data-moonset-skin] body [aria-pressed='true'] {",
    '  color: var(--dsw-static-deepseek-500);',
    '}',
    '/* the host draws the selected tab underline as a 2px ink bar; keep it the',
    '   label colour. Only the plugins tab renders an ::after on such an element. */',
    "html[data-moonset-skin] body [data-active='true']::after {",
    '  background: var(--dsw-static-deepseek-500);',
    '}',
  ]
  if (options.glow !== false) rules.push(...GLOW_RULES)
  return rules.join('\n')
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
