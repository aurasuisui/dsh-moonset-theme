/**
 * Browser half of the Moonset theme plugin — empty shell for M1.
 *
 * The artifact is emitted by tsdown.client.ts as a closure factory
 * (window.__ModuleLoader__.load) and receives the client-side cordis context
 * through `apply`; the loader owns its lifecycle (activate / unload).
 *
 * Later milestones fill this file in:
 *  - M4: register `moonset-light` / `moonset-dark` through the official
 *    ThemeRuntime (`theme.register`), and keep "follow system" on the
 *    `overrideTokens` layer so the stored preference stays `system`;
 *  - M5: the Appearance settings row (Light / Dark / System) plus its
 *    debounced, durable persistence through the settings seam;
 *  - M6 is host-side (first-paint token injection) and does not touch this
 *    entry.
 */
export function apply(): void {}
