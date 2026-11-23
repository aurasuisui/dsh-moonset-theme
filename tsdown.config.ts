import { clientBundle } from './tsdown.client.ts'

// The module-loader id must equal the package name verbatim: dsh-client-modules
// keys the boot graph by package name and throws
// `bundle <url> loaded without registering "<name>"` when the id drifts.
// Scoped names keep the scope ("@scope/name"), not the bare folder name.
export default clientBundle(
  '@aurasuisui/dsh-moonset-theme',
  ['src/index.ts'],
  {
    lib: {
      // 宿主侧会在运行时从 dsh 配置树解析 dsh-settings / schemastery / cordis，
      // 而非本地安装；保持外部（同 dsh-skins 的 stance）。注意 schemastery
      // 的包名是 @deepseek-ai/schemastery（0.5.0 起 host 半区真实值导入它来
      // 构造 settings schema，external 必须用全名否则会被打进 bundle）。
      external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-settings', '@deepseek-ai/schemastery'],
      // 发布 sourcemap（item KK）：用户报错的 stack trace 可读；配合 package.json
      // `files` 里的 "*.map" 一起发布。client 半区在 tsdown.client.ts 里本来就开。
      sourcemap: true,
    },
  },
)
