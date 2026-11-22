/**
 * Shared tsdown preset for DSH UI plugin client bundles: the single source of
 * truth for this package's build (a port of the DSH checkout's
 * `packages/client/tsdown.client.ts`, the same shape the Catppuccin reference
 * repo carries). Emits a closure-factory artifact: the bundle calls
 * window.__ModuleLoader__.load({id, factory}) and resolves externals through
 * the injected require (loader module table — cordis DI entities, no globals,
 * no import map).
 *
 * Deleted from the reference port (M1 scope: a colour plugin with no
 * stylesheet, no standalone page and no monorepo layout):
 *  - the CSS Modules inline pipeline (lightningcss + the NUL-prefixed virtual
 *    id plugin): this package ships no *.module.css and does not depend on
 *    lightningcss;
 *  - `mobileBundle()`: a self-contained standalone page bundle for a route
 *    this plugin does not have;
 *  - the `DSH_BUILD_FACE` host/client workspace split (`SKIP_WORKSPACE_BUILD`,
 *    `buildFace()`, `ClientBundleOptions.hostPhase`): this repo builds one
 *    face, not the monorepo's two passes;
 *  - `browserSourcePath()` / `sourcemapPathTransform`: it rebased emitted
 *    lib-relative sources onto `packages/<group>/<package>/src` URLs that only
 *    exist inside the DSH checkout;
 *  - the `./web-platform.ts` import: the platform table is inlined below.
 */
import type { UserConfig } from 'tsdown'

/**
 * Wire/type layers a client bundle may inline: browser-safe contract surfaces
 * with no runtime identity to share (no Symbol/instanceof/singleton state).
 * Everything else under @deepseek-ai/* is either a module-table entry
 * (external) or a leak the purity gate rejects.
 */
export const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * The module specifiers the shell shares into its frozen module table
 * (upstream `packages/client/web/src/platform.ts`, PLATFORM_MODULES; mirrored
 * here because this bundle is built outside the DSH monorepo). Re-verify on a
 * DSH minor bump.
 */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** Externals resolved from the loader module table: only the platform entries. */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/**
 * Build the tsdown config for one UI plugin package: the node-half lib build
 * plus the browser client bundle. A package-level tsdown.config.ts REPLACES the
 * root workspace layout, so the lib half must be restated here — dropping it
 * leaves the package without lib/index.js and the host Loader cannot import its
 * node half.
 * @param id - plugin id (package name), stamped into the __ModuleLoader__.load
 * handoff and onto the injected style tags.
 * @param libEntry - node-half entries.
 * @param options - lib overrides, extra Node-side externals.
 * @returns the node-half and the client-half configs, in build order.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): UserConfig[] {
  return [
    clientLibraryConfig(id, libEntry, options.lib, options.libExternal),
    clientConfig(id, 'src/client/index.ts'),
  ]
}

interface ClientBundleOptions {
  /** Overrides for the package's primary Node-side library config. */
  readonly lib?: UserConfig
  /** Extra Node-side externals (in addition to the default cordis entry). */
  readonly libExternal?: readonly (string | RegExp)[]
}

function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  overrides: UserConfig = {},
  extraExternal: readonly (string | RegExp)[] = [],
): UserConfig {
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The cordis framework resolves at runtime from the dsh profile tree, never
    // from this repo's install; its built declarations carry .ts-suffixed
    // relative imports rolldown cannot follow, so the import must stay
    // external (the same stance as the peer APIs above).
    external: ['@deepseek-ai/cordis', ...extraExternal],
    ...overrides,
  }
}

function clientConfig(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    // Browser bundle lands next to the node half (single lib/ artifact dir;
    // the entryFileNames pin keeps it exactly lib/client.js). clean must stay
    // off — a default clean would wipe the node-half output emitted above.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Types ship from lib/types (tsc); dts here would wrap the banner/footer
    // into .d.cts and break parsing.
    dts: false,
    // Plugin code is fetched outside Vite's module graph, so its own bundle
    // must carry the TS/TSX mapping consumed by browser profiling tools.
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    // Browser bundles inline node-idiom deps (zustand/immer read
    // process.env.NODE_ENV; zustand's esm build also probes
    // import.meta.env.MODE, which a CJS output cannot carry — rolldown flags
    // EMPTY_IMPORT_META). vite defined both on the seed path; tsdown inlining
    // needs the substitutions here or the factory throws ReferenceError at
    // boot / the build gate reds. Both keys honor the build's NODE_ENV so a
    // dev build keeps the dev-branch semantics; artifacts default to production.
    // The bare `import.meta.env` key is required alongside the precise MODE
    // key: zustand probes `import.meta.env ? import.meta.env.MODE : ...`, and
    // the truthiness probe would otherwise survive as an empty import.meta.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    // tsdown auto-externalizes package dependencies; anything NOT in the
    // loader module table must inline instead (wire/type layers, zod, clsx —
    // every non-shared dep). A require() the table cannot answer is a
    // guaranteed runtime throw, so the rule is the table list itself: no
    // opinion for table entries (external above wins), bundle everything else.
    noExternal: (specifier: string) => (CLIENT_EXTERNALS.includes(specifier) ? undefined : true),
    plugins: [{
      // Bundle purity gate (build-time mirror of the module-edge rules):
      // platform seed entries stay external, inline-safe wire layers inline,
      // and every other @deepseek-ai value import is a build error — a
      // cross-plugin value import either inlines a duplicate runtime instance
      // or requires a specifier the frozen module table cannot answer.
      // Cross-plugin collaboration goes through cordis services instead.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
        )
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // The loader evaluates the artifact as a factory closure, so the CJS
      // wrapper is synthesized by the banner/footer instead of shipping ESM.
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}
