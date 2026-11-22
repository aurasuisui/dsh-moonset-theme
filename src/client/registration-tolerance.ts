/**
 * Fault-tolerant registration for this plugin's boot-critical wiring (D3).
 *
 * Client and Host share one failure shape: an entry whose `apply()` throws is
 * marked `failed`, the assembly aborts the whole boot (`web boot: N entries
 * did not activate`), and the official desktop's crash rescue then runs
 * `disableAllPlugins()` — taking EVERY third-party plugin down with it. The
 * realistic trigger is a peer plugin already owning what we are about to
 * register (a second copy of this plugin, another theme pack that took a
 * `moonset-*` id), and the right answer to "someone else already did this" is
 * to skip OUR copy — never to fail the boot.
 *
 * Known "already owned" shapes are skipped quietly: the peer's registration
 * stands. Anything else is logged and skipped too — no registration in a
 * colour plugin is worth the user's whole plugin set. (To restore fail-fast
 * for a class of errors, `throw error` in the warn branch; every call site
 * routes through here on purpose.)
 */

/**
 * The "another party already owns this" messages the runtimes throw:
 *  - `theme "…" is already registered` (dsh-client-ui-theme register)
 *  - `locale "ja" is already registered` / `locale namespace "…" already has locale "…"`
 *  - `list slot "…" already has an entry with id "…"` (dsh-client-ui-slots)
 *  - `webserver: duplicate exact route "…"` (dsh-host-webserver)
 * Kept ahead of the first real collision so a future call site's shape is
 * already covered rather than silently downgraded to a warning.
 */
const ALREADY_OWNED = /already (?:registered|has locale|has an entry)|duplicate .*route/u

/**
 * A disposer that also reports whether the work behind it really happened.
 * Callable like any other disposer (so it drops straight into `ctx.effect`),
 * with the skip flag hanging off it instead of a second return channel.
 */
export interface TolerantDisposer {
  /** Release the registration; a no-op when it was skipped, and safe to call twice. */
  (): void
  /** True when the guarded call threw and degraded to a no-op disposer. */
  readonly skipped: boolean
}

/**
 * Run one registration call, degrading any failure to a no-op disposer.
 *
 * Never throws: this function is on the client's boot path, and a throw here
 * fails the whole entry (see the file header).
 * @param run - the registration call, returning its disposer (if any).
 * @returns the real disposer, or a no-op one when the registration was skipped.
 */
export function tolerantRegistration(run: () => (() => void) | void): TolerantDisposer {
  let release: () => void = () => {}
  let skipped = false
  try {
    // A registration that returns nothing still gets a working disposer.
    release = run() ?? release
  } catch (error) {
    skipped = true
    const message = error instanceof Error ? error.message : String(error)
    // Quiet for the "already owned" shapes: a peer's registration is the
    // intended outcome, not a fault, and a warning per duplicate would spam
    // every boot of a duplicate install.
    if (!ALREADY_OWNED.test(message)) {
      console.warn(`[dsh-moonset] registration skipped — ${message}`)
    }
  }
  return tolerantDisposer(release, skipped)
}

/**
 * Wrap a hand-composed disposer in the {@link TolerantDisposer} shape so a
 * caller that fans one registration out into several (one theme per id, tied
 * behind a single release) reports the aggregate skip flag the same way.
 * @param release - the composed disposer.
 * @param skipped - whether any part of it was skipped.
 * @returns an idempotent disposer carrying `skipped`.
 */
export function tolerantDisposer(release: () => void, skipped: boolean): TolerantDisposer {
  let released = false
  const dispose = (): void => {
    if (released) return
    released = true
    release()
  }
  Object.defineProperty(dispose, 'skipped', { value: skipped, enumerable: true })
  return dispose as TolerantDisposer
}
