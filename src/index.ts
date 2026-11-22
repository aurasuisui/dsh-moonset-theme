/**
 * Host half of the Moonset theme plugin for the DeepSeek Harness web GUI.
 *
 * Scope today (M1): a loadable skeleton only — the cordis plugin identity and
 * an empty `apply`. The browser half (exports["./client"]) carries the themes;
 * this half stays inert until the first-paint injection lands (M6), which is
 * also when the settings `Config` schema (M5) appears here.
 *
 * `name` doubles as the cordis.patch.yml insert id, so the two must stay
 * identical: dsh plugin activation reports the row id on failure, and a drift
 * turns a readable log line into an anonymous one.
 */
export const name = 'dsh-moonset'

/** No host-side work yet (M6 adds the webserver/index-inject listener). */
export function apply(): void {}
