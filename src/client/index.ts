/**
 * Browser half of the Moonset theme plugin — M4: the two themes plus the
 * "follow system" layer.
 *
 * The artifact is emitted by tsdown.client.ts as a closure factory
 * (window.__ModuleLoader__.load) and receives the client-side cordis context
 * through `apply`; the loader owns its lifecycle (activate / unload). Every
 * `@deepseek-ai/*` import here is `import type` — the runtime values
 * (the theme service included) arrive through `ctx`, which is also why the
 * browser bundle keeps its module-table purity.
 *
 * M4 registers `moonset-light` / `moonset-dark` and ships the follow-system
 * layer; the Appearance row and its durable preference are M5, and the
 * first-paint injection is host-side (M6), so this entry stays thin.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { registerMoonsetThemes } from './themes.ts'

// The M5 surface: the settings row needs the ids and labels to render the
// three choices, `createFollowLayer` to drive "follow system", and
// `moonsetFollowOverrides` to inspect what the layer pushes. Re-exported here
// so the row imports the plugin's own entry rather than a sibling module.
export {
  FOLLOW_LAYER_SOURCE,
  MOONSET_THEMES,
  MOONSET_THEME_IDS,
  createFollowLayer,
  moonsetDefinitions,
  moonsetFollowOverrides,
  registerMoonsetThemes,
} from './themes.ts'
export type {
  FollowSystemLayer,
  MoonsetThemeId,
  MoonsetThemeInfo,
  MoonsetThemeService,
} from './themes.ts'
export { tolerantDisposer, tolerantRegistration } from './registration-tolerance.ts'
export type { TolerantDisposer } from './registration-tolerance.ts'

/**
 * Client plugin body: register both themes, and hand back their disposer.
 *
 * Registration is the only boot-critical step here, and it rides
 * `registerMoonsetThemes` → `tolerantRegistration` (D3): a duplicate id — a
 * second copy of this plugin, or a peer that already claimed the id — is
 * skipped instead of throwing, because a throwing `apply` aborts the whole web
 * boot and takes the user's other plugins down with it. The effect also gives
 * the registrations the fiber's lifetime, so unloading the plugin releases
 * them and a re-activation registers them again.
 *
 * Nothing here switches the theme preference: selecting a theme (or
 * "follow system") is the settings row's job in M5, and `setTheme` must never
 * be called on the plugin's own initiative (D4).
 * @param ctx - client cordis context (the theme service is injected via
 * `dsh.client.inject`, so `ctx.theme` is resolved before this runs).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => registerMoonsetThemes(ctx.theme), 'moonset: light/dark theme registrations')
}
