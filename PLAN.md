# dsh-moonset-theme 计划（0.1.0）

> **目标**：在 `Anything/dsh-moonset-theme` 交付一个只做配色的 DSH 主题插件——向官方 ThemeRuntime 注册
> `moonset-light` / `moonset-dark` 两个主题，覆盖安装态 0.2.2-rc.1 的全部 `--dsw-*` 颜色 token，
> 并能与 `@nonamelego/dsh-catppuccin@0.7.5` 同装共存（同宿主范围、同设置行、同跟随系统行为）。
> **非目标**：不做玻璃材质层（glass）、不做 TUI 主题同步、不做更新检查路由、不复制 catppuccin 的三层状态机、
> 不改参考仓库任何文件、不发布 npm、不打 tag、不合并任何分支。
> **时点**：基线取证于 2026-11-22；参考仓库 HEAD `d8e314d`（= 0.7.6-beta.0），`v0.7.5` = `b9b6c5e`。

**版本判定**：MINOR 起步 `0.1.0`（首个可用版本）；此后缺陷走 PATCH `0.1.x`，不开 MAJOR。

**三条待确认假设**（用户未明说，按最保守假设写死；推翻任一条要重排里程碑）：
- **A1 落点**：新仓库与参考仓库**并列** = `C:\Users\aurasui\Desktop\Anything\dsh-moonset-theme`，参考仓库只读。
- **A2 身份**：包名 `dsh-moonset-theme`（private，不上 npm）；插件 id `dsh-moonset`；主题 id `moonset-light` / `moonset-dark`。
- **A3 "兼容 catppuccin 0.7.5" 的口径**：同装共存（不抢 theme id / 设置命名空间 / 全局属性）+ 同宿主范围
  （`engines.dsh >= 0.1.7-rc.1`、devDep 钉 `0.2.1-rc.2`）+ 行为对等（Appearance 设置行、跟随系统、首帧预注入）。

## 一、范围与版本

| 改动 | 性质 | 依据 |
|---|---|---|
| 新仓库骨架（package.json / tsdown / vitest / cordis.patch） | 新建 | 参考仓库 `package.json`、`tsdown.config.ts`、`cordis.patch.yml` |
| `--dsw-*` token 取证脚本（从安装态 app.asar 提取） | 新建 | 参考仓库 `scripts/parse-dsh-tokens.cjs`；其外盘缓存已不存在（见 D1） |
| moonset 调色板生成器（16 色源 → 190 token × 2 模式） | 新建 | 参考仓库 `scripts/generate-palettes.mjs` 的 plan/mix 模型 |
| 双主题注册 + 跟随系统 | 新建 | `dsh-client-ui-theme` 的 `ThemeDefinition`/`overrideTokens`；参考 `docs/issue-36-follow-system.md` |
| Appearance 设置行 + 持久化 | 新建 | 参考 `src/client/CatppuccinRow.tsx`、`src/state.ts` |
| 首帧预注入 | 新建 | 参考 `src/boot-palette.ts`、`docs/issue-30-first-paint-flash.md` |
| 玻璃 / TUI / 更新检查 | **不做** | 见非目标 |

## 二、依据

### 2.1 基线

| 项 | 实测值 | 复核方式 |
|---|---|---|
| 参考仓库工作树 | `d8e314d`（main，干净） | `git -C <ref> rev-parse HEAD` |
| 参考仓库 typecheck | exit 0 | `pnpm typecheck` |
| 参考仓库测试 | 457 passed / 24 files | `pnpm test` |
| 工具链 | pnpm 11.22.0 / node v24.15.0（参考仓库因 `packageManager: pnpm@10.33.3` 会切到 10.33.3，别把它当本机版本） | `pnpm -v`、`node -v` |
| token oracle（桌面壳 runtime） | `0.2.2-rc.5`（`@deepseek-ai/dsh-desktop-runtime`，token 样式表的唯一来源） | `node scripts/extract-dsw-tokens.mjs` 读 app.asar 内 `/dsh/package.json` |
| npm 全局 CLI | `0.2.2-rc.1`（树里没有任何 `design-platform.css`，**不能**当 oracle） | `dsh --version` + 全盘搜该文件 0 命中 |
| 官方 token 样式表 | `design-platform.css` 29861 B（app.asar 内） | `node scripts/extract-dsw-tokens.mjs` 打印 sha256 |
| 参考仓库 token 规模 | 190 token/风味，4 风味（冻结于 0.2.0-rc.2） | `grep -c "\"--dsw-" src/client/palettes.ts` |
| 安装态 token 规模 | **228 键 × 2 方案**；样式表内 237 个唯一名，差额 9 个是 macOS `darwin` 专用层 | `node -e` 读 `themes/dsw-tokens.json` + `Select-String` 数 darwin 块 |
| 上游退场 | 190 名单里 `--dsw-specific-sidebar-nav-item-hover` 在 0.2.2-rc.5 **已删除**（全库 0 命中，正对照 `-active` 20 命中） | 带正对照的子串扫描 |
| ThemeRuntime token 目录 | 403 个 `--dsw-*` 名（含 font/radius） | `node -e "…exportInspectTokens…"`（M2 旁证） |
| 外盘缓存 | `D:\Vibe-Coding\.cache\dsh-ref` **不存在** | `Test-Path` |

### 2.2 现状 / 缺口

| # | 要求 | 现状 | 依据 |
|---|---|---|---|
| G1 | 新仓库可构建可测 | 目录不存在 | `Test-Path Anything/dsh-moonset-theme` → False |
| G2 | token 清单可离线重建 | 参考仓库依赖外盘缓存，缓存已丢 | `generate-palettes.mjs:46` + 基线最后一行 |
| G3 | 双主题注册 | 无 | — |
| G4 | 与 catppuccin 共存 | 未验证；两者都会 `theme.register` 与写设置 | `src/client/index.ts:541`、`src/index.ts:apply` |
| G5 | 跟随系统不钉死 scheme | 参考实现存在，新仓库未移植 | `docs/issue-36-follow-system.md` |
| G6 | 首帧不闪官方色 | 参考实现存在，新仓库未移植 | `src/boot-palette.ts` |

### 2.3 缺陷或风险台账

| ID | 现象与位置 | 关闭条件（可验证） |
|---|---|---|
| **D1** | 参考仓库重生成依赖 `D:\Vibe-Coding\.cache\dsh-ref`，本机不存在 ⇒ `pnpm gen:palettes` 必 ENOENT | 新仓库 `grep -R "Vibe-Coding" src scripts` 命中 0，且 `node scripts/extract-dsw-tokens.mjs` exit 0 |
| **D2** | 190 名单冻结于 0.2.0-rc.2（`UPSTREAM_PIN 639ed01`），安装态是 0.2.2-rc.5：新增 39、**上游删了 1**（`--dsw-specific-sidebar-nav-item-hover`） | `node scripts/verify-tokens.mjs` 输出 `missing=0` 且 `retired=1 live=228`；`missing` 的口径 = 冻结名单 − 安装态 − **显式退役名单**，退役名单之外的任何缺失仍 exit 1 |
| **D3** | 与 catppuccin 抢 theme id ⇒ `theme.register` 抛错 ⇒ boot 半途失败（issue #23 形态） | `tests/theme.spec.ts` 断言所有 id 以 `moonset-` 开头；真机 Appearance 同时列出 6 项 |
| **D4** | 单主题表达不了双端；`setTheme(风味)` 会钉死 `prefers-color-scheme` | `tests/theme.spec.ts` 断言跟随时偏好仍为 `system` 且层由 `overrideTokens` 提供 |
| **D5** | 首帧先画官方深色（issue #30 形态） | `tests/boot.spec.ts` 断言注入行数 = 190 |
| **D6** | catppuccin 的 `[data-dsh-glass]` 若在 moonset 主题下仍挂着，会串材质 | M7 脚本断言 `document.body.dataset.dshGlass` 为 undefined |
| **D7** | 生成器非幂等 ⇒ 每次提交都产生假 diff | 连续两次 `node scripts/generate-palettes.mjs` 后 `certutil -hashfile` 两次相同 |
| **D8** | 设置回声回滚本地选择（issue #31 形态） | `tests/settings.spec.ts` 的"迟到的文档回声"用例全绿 |

**M3 判定时的三条口径确认（2026-11-22）**：
- **B1 扩到「表达式照抄」**：官方有 7 条 `var(--dsw-alias-…)` 与 1 条引用 alias 的 `color-mix`，按字面会落进 B4。
  接受把 B1 定义为「任何引用同表内 token 的表达式照抄」，因为引用对象都在同一张表里、可被 `tests/palettes.spec.ts` 的解析用例证伪（现 0 悬空）。
- **B2 在暗色下端点对调**：白→`inkPrimary`、黑→`canvas`。若照字面（白→canvas），暗色 `border-l1..l4`、`bg-skeleton`、`interactive-bg-hover` 会画成 canvas 叠 canvas 而消失——这是设计意图，不是偏离。
- **"不落回官方值"的判定按 B3 执行**：B1 逐字照抄是规则本身；`--dsw-static-amber-500` 与官方同为 `#F59E0B` 是因为源板 `moon` 就是那个琥珀色，字符串不同、属 A 类，不算回落。

## 三、里程碑与出口条件

| # | 里程碑 | 内容 | 出口条件（全部满足） |
|---|---|---|---|
| **M1** | 骨架与门禁 | package.json（exports 三项、`dsh.bundle.patch`、`dsh.client.inject/platform`）、tsconfig×2、tsdown.config.ts、tsdown.client.ts、vitest.config.ts、cordis.patch.yml、.gitignore、LICENSE、README 骨架；`src/index.ts`（`export const name` + 空 `apply`；`Config` 顺延到 M5）、`src/client/index.ts`（空 apply）；首个实现 commit（基线 commit = `8d85c4b` 的 PLAN.md） | `pnpm install` exit 0；`pnpm typecheck` exit 0；`pnpm test` exit 0 且 Tests ≥ 1；`pnpm build` 后 `lib/index.js` 与 `lib/client.js` 存在；`node -e "const p=require('./package.json');…"` 打印 exports/dsh 四项均非空 |
| **M2** | token 取证 | `scripts/extract-dsw-tokens.mjs`：从 `app.asar` 解出 `design-platform.css`，切出 light（`body`）与 dark（`[data-ds-dark-theme]`）两块，产出 `themes/dsw-tokens.json` + `meta{dshVersion,cssSha256,counts}`；`scripts/verify-tokens.mjs` 做**三方对差**（冻结 190 / 安装态 228 / 显式退役 1）；`themes/retired-tokens.json` 记录每个退役键及其证据 | `node scripts/extract-dsw-tokens.mjs` exit 0 且 `counts=228/228`；`node scripts/verify-tokens.mjs` exit 0 且打印 `missing=0 retired=1 live=228`；`pnpm test -- tests/tokens.spec.ts` 全绿（含「退役键确实不在安装态」「退役键 ⊆ 冻结名单」两条）；`meta.cssSha256` 与审计独立复算值相同 |
| **M3** | 调色板生成 | `themes/moonset-palette.json`（附录 A 的 16 色 × 2 模式，人工可编辑的唯一源）；`scripts/generate-palettes.mjs` 按家族 mix 阶梯产出 `src/client/palettes.ts`（`MOONSET_LIGHT`/`MOONSET_DARK`，各 **228** 键；7 个 `--dsw-alias-json-tree-*` 是字面 hex、须单独处理；≥10 条对比度契约写进测试 | 连跑两次 `node scripts/generate-palettes.mjs` 后 `certutil -hashfile src/client/palettes.ts SHA256` 两次输出相同；`pnpm test -- tests/palettes.spec.ts` 全绿且该文件断言数 ≥10 |
| **M4** | 双主题注册 + 跟随系统 | client 半区：`tolerantRegistration` 包住 `theme.register({id:'moonset-light'…})` 与 `moonset-dark`；跟随系统走 `theme.overrideTokens('moonset-follow',{token:{light,dark}})`，偏好留 `system` | `pnpm test -- tests/theme.spec.ts` 全绿（含 4 条：注册两个 id、重复注册不抛、dispose 后可重注册、跟随层 light/dark 各自取值） |
| **M5** | 设置行 + 自带持久化 | Appearance 内的 moonset 组（Light / Dark / 跟随系统）；host 侧 `Config` 的 volatile 字段存**插件自己的选择**（官方主题文档只认 `system/light/dark`，第三方 id 根本写不进去）；启动时读 section 并重新 apply（`setTheme(id)` 或 follower 层） | `pnpm test -- tests/settings.spec.ts` 全绿（≥6 条：渲染 3 项、点击分别调 `setTheme`/`enable`、section 写入、启动 re-apply、section 缺失回落 `system`、卸载后零写入）；`Select-String src/client -Pattern 'html.style|body.style'` 命中 0（token 由 Presenter 内联写，插件不碰 DOM 样式） |
| **M5.1** | 回声与快速切换守卫 | `adopt()` 会用官方文档值覆盖内存偏好 ⇒ 插件需 pendingLocal + revision 高水位：迟到的回声不得回滚更新的本地选择；连续点击按 300ms 防抖合成一次写入 | `pnpm test -- tests/settings.spec.ts` 含「迟到的文档回声」「连续快速切换 3 次」两条用例；**变异自检**：删掉 pendingLocal 判断或以文档值无条件覆盖，必须变红并贴证据 |
| **M6** | 首帧预注入 | host 半区 `ctx.on('webserver/index-inject')` + `bootPaletteRows(config)`，把持久主题的 token 表塞进 index HTML | `pnpm test -- tests/boot.spec.ts` 全绿（含 3 条：注入行数 = 228、volatile 取值来自文档、无 webserver 时静默） |
| **M7** | 共存验收（真机） | 把 moonset 以 `link:` 装进 `web` profile（与已装 catppuccin 0.7.5 并存），启动、切主题、截图；跑完卸载 link | 启动日志 `entry(s) did not activate` 命中 0；Appearance 列出 moonset 2 项 + catppuccin 4 项；切换脚本 6 次后 `theme.revision` 单调递增且 console error 数 0；`assets/previews/` 下 2 张 PNG 均 > 100KB |
| **M8** | 文档与结账 | README（安装/切换/兼容矩阵/截图）、CHANGELOG `0.1.0`、`docs/palette.md`（色卡 + 与官方 token 的对照）、看板置 ✅ | `pnpm typecheck` 与 `pnpm test` 与 `pnpm build` 三条 exit 0；README 命中"安装""切换""兼容"三节；CHANGELOG 命中 `## 0.1.0` 一行 |

> 判定点：每个里程碑做完，执行者停下报「待审核」并交四件真实输出；审核者独立复跑出口条件后才置 ✅。

## 四、进度看板

| 里程碑 | 状态 | 证据 |
|---|---|---|
| **M1** | ✅ | commit `67d7ece`；审计自跑：`pnpm install`/`typecheck`/`typecheck:tests`/`test`(3 passed)/`build` 全 exit 0，`lib/index.js`+`lib/client.js` 存在且 `node --check` 通过，manifest 四项非空；`git diff --stat b1ec8cc..HEAD` = 15 files，`PLAN.md` 改动 0 行，参考仓库 `git status` 0 行、HEAD 仍 `d8e314d` |
| **M2** | ✅ | commit `40bb92a`；审计自跑：`extract` 0（228/228，cssSha256 `3234f31876…`）、`verify` **0** → `missing=0 retired=1 live=228 added=39`、`pnpm test` **10 passed/2 files**、两条 typecheck 0；**审计者自己做变异**：`retired=[]` → exit 1 `missing=1`、假退役（真实 token）→ exit 1、幽灵退役（不在冻结名单）→ exit 1、还原后 sha256 逐字节一致 `bd1d951b…`；`e8bed9f..HEAD` 只动 7 个文件，`PLAN.md`/`src`/`package.json` 0 行 |
| **M3** | ✅ | commit `85e9650`；审计自跑：连跑两次生成器 sha256 均 `49423383…` 且工作树干净、`pnpm test` **47 passed/3 files**、两条 typecheck 0；**审计者自写解析器复核**：两表各 228 键且键集合相同、分类独立重算 = 82/109/14/23/0 与 82/110/16/20/0、B3 与官方原值重合 **0** 条、仅 B1 逐字照抄（109/110）、var 引用 55/45 条悬空 0、退役 token 未生成；**22 条对比度全部用第三方实现复算一致**（label-primary 17.80/15.81、border-l1 1.08/1.14 等）；`45b13bb..HEAD` 仅 4 个文件，受保护文件 0 行 |
| **M4** | ✅ | commit `75c292d`；审计自跑：`pnpm test` **60 passed/4 files**、两条 typecheck 0、`pnpm build` 0（`lib/client.js` 38.41 kB）、产物 grep 两个 id 命中 9 处、`src/client/*.ts` 里 `setTheme(` **0** 命中、产物里 `@deepseek-ai/` **0** 命中（无运行时外部导入）；核对官方 runtime 源码：重复 id 的报错原文是 `theme "…" is already registered`（tolerance 正则命中），`overrideTokens` 在返回前同步 `publish()`（重入守卫因此必要而非装饰）；`3e1b227..HEAD` 4 files，受保护文件 0 行 |
| **M5** | ⬜ | — |
| **M5.1** | ⬜ | — |
| **M6** | ⬜ | — |
| **M7** | ⬜ | — |
| **M8** | ⬜ | — |

## 五、执行与审核规则

- 一次只派一个里程碑；执行者只报「待审核」，四件必报：验证命令原样输出 / 测试计数 / commit 列表 / 做法与偏离。
- 审核者**自己复跑**出口条件，不接受执行者自述；并查 `git diff --stat` 边界与测试断言是否被放宽。
- 不可逆动作（发布 / tag / 合并 / 删除 / 强推 / 改动用户已装插件）必须人类口令；**M7 会写用户 web profile，动手前单独确认**。
- 契约文件（PLAN.md 的看板与台账）只有审核者能改。

## 六、砍尾顺序

**不可砍**：M1、M2、M3、M4、M7（A3 的兼容口径就是 M7）。
**可砍**（按序，砍了要在看板留痕）：
1. M6 首帧预注入（最坏是首屏闪一次官方色，用户可接受度另议）
2. M5 降级为只读展示（设置行只显示当前主题，不做切换）
3. M8 的 `docs/palette.md`（README 保留）
4. M7 的截图产出（保留启动日志与清单断言）

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| asar 头格式随 Electron 版本变 | M2 的解析器只依赖固定 16 字节头 + JSON，失败时退化为"直接扫二进制找 `--dsw-static-amber-100` 起点"；两种都失败就停下来问人 |
| 190 名单不含 0.2.2 新增 token | M2 的 verify 输出 `added` 列表，按 D2 关闭条件处理；新增 token 的值由生成器的家族规则兜底 |
| moonset 自身 `--ink-muted` 4.22:1 不达 AA | 映射到 `alias-label-secondary/tertiary` 时提亮到 ≥4.5:1，并在生成器注释 + CHANGELOG 记录为**有意偏离**（沿用参考仓库规则 1/3） |
| 两插件同装后 CSS 层叠加 | 只写 `--dsw-*` 别名层，不写 `--dsh-*` 与任何 `data-` 全局钩子；M7 用 body 属性断言兜底 |
| 真机验证改坏用户环境 | M7 只做 `link:` 添加与移除，全程记录命令；失败回滚 = `dsh plugin remove` |
| 计划范围膨胀 | 砍尾清单已排序；任何计划外改动先停下来问人 |

## 八、文档落点

| 改动 | 唯一落点 | 联动 |
|---|---|---|
| 安装与切换 | `README.md` | cordis.patch.yml 的 id、package.json 的 name |
| 兼容矩阵（DSH 0.2.1-rc.2 / 0.2.2-rc.1、catppuccin 0.7.5） | `README.md` 表格 | `package.json` 的 `dsh.compatibility` |
| 色卡与 token 对照 | `docs/palette.md` | `themes/moonset-palette.json`、`themes/dsw-tokens.json` |
| 变更记录 | `CHANGELOG.md` | 版本号 |
| 进度与判定 | `PLAN.md` 的看板与台账 | 本文件 |

## 九、已决与已知债

**已决**
1. **双主题而非单主题双色**：`ThemeDefinition.colorScheme` 是单值（`dsh-client-ui-theme/lib/types/client/index.d.ts`），
   双端只能靠两套定义；"跟随系统"另走 `overrideTokens` 层（参考 `docs/issue-36-follow-system.md` 的结论）。
2. **token 取证改走安装态 app.asar**，不复用外盘缓存：缓存不在仓库里、已丢过一次，且换了上游 tag 在 diff 里与"改配色"无法区分；
   新做法把 `dshVersion` 与 `sha256` 写进产物当审计锚点（替代参考仓库的 `--pin` 约定）。
3. **主题 id 一律 `moonset-` 前缀**，设置命名空间、locale 命名空间同理，不与 catppuccin 争位（D3）。
4. **第三方主题 id 写不进官方偏好文档（2026-11-22 读 runtime 源码确认）**：`setTheme(id)` 只有当 `id ∈ {system,light,dark}` 时才
   写设置文档（`if (isThemePreference(id)) this.write(...)`），第三方 id 只活在**内存偏好**里；而 `adopt()` 每次回声都会用文档值
   覆盖内存偏好 ⇒ **只靠官方 seam 记不住 Catppuccin/Moonset 这类主题**。这解释了 M5 为什么要自带 section、
   M6 为什么必须做首帧注入，也解释了参考仓库 `state.ts` 那 33KB 存在的原因。
5. **`overrideTokens` 同步派发**：它的 disposer 与写入都会在返回前 `publish()`，所以跟随层的重建/销毁必须离开
   `theme/change` 派发（M4 已用 `mutating` 窗口实现并写进 JSDoc）。
6. **不移植玻璃层**：材质是 catppuccin 的独立子系统（`glass.module.css` 131KB + 一身 `[data-dsh-glass]` 钩子），
   移植它会把"配色插件"变成"皮肤插件"，且与新配色无语义关系。
7. **M2 契约决策：冻结名单 / 安装态 / 退役 三方分开（2026-11-22，审核时定）**。M2 在 `missing=1` 处按派单硬规矩停下，
   这是对的：那个键确实被上游删了（0.2.0-rc.2 → 0.2.2-rc.5），不是解析漏。三条路里选**第二条并加守卫**：
   `themes/baseline-tokens.json`（190，冻结、永不修剪）+ `themes/retired-tokens.json`（显式退役，逐条带证据）+
   安装态现表（228）。`missing = 冻结 − 安装态 − 退役`，只有**登记过的**退场才豁免；
   退役名单没有条目、却从安装态消失的键照样 exit 1，所以「悄悄删 token」仍然红，只是「上游删了」可以被记账。
8. **token oracle 只有一份**：桌面壳 `app.asar` 里的 `design-platform.css`（runtime 0.2.2-rc.5）。
   `dsh --version` 报的 0.2.2-rc.1 是 npm 全局 CLI，树里根本没有这个样式表——两者不能混作基线。
9. **M1 契约更正（2026-11-22，审核时改）**：M1 原写 `src/index.ts` 含 `Config`，实际按派单把 `Config` 顺延到 M5——
   设置 schema 的字段只有 M5 的持久化需求能定义，提前写只会是空壳；此处以"契约服从最小可验收"修订，
   派单与契约自此一致（M5 出口条件已含设置落盘用例）。

**已知债**
- 桌面壳（Electron，`profiles/desktop`）未验；本计划只覆盖 web profile。
- 参考仓库 0.7.5 的测试基线不是本次实测值（本次实测的是 HEAD `d8e314d` = 457 tests）；0.7.5 tag 上的计数未单独跑。
- TUI 主题（`~/.dsh-tui/themes/`）不做：`dsh-tui` 只读目录、无注册 API，属于另一条发布面。
- npm 发布不在本次范围，任何 `npm publish` / `git push --tags` 须人类口令。
- 与 catppuccin 的 CSS 同时生效时"谁的 `--dsw-*` 赢"由内联样式顺序决定，M7 只做功能够用的验证，不做像素级 A/B。
- **M1 带出的四条债**（不影响 M1 判定，但后续里程碑必须处理）：
  1. `dsh.client.inject` 目前 4 条（缺 `dsh-client-connection` / `dsh-api-remotes`）——M5 若用到远端设置失效通知需补回，否则 M7 可能出现 `entry(s) did not activate`。
  2. `tsdown.client.ts` 已删掉参考仓库的 CSS Modules 内联管线（`lightningcss`）——M5 的设置行要么用内联样式，要么把管线与依赖加回来，二选一要在 M5 派单里写死。
  3. 没有 `prepare` 脚本：M7 用 `link:` 装进 web profile 之前必须先跑 `pnpm build`，否则装进去的包没有 `lib/`。
  4. 仓库无 `.gitattributes`（本机 `core.autocrlf=true`）：行尾会在检出时漂成 CRLF，需要时单独加 `* text=auto eol=lf`。
- **M2 带出的三条债**：
  1. 样式表 237 个唯一名里有 9 个只出现在 `html[data-platform='darwin'] body` 的 macOS 振动层，按参考仓库同一口径**不进双方案表**；
     对齐 macOS 观感需要单独一层，M7 在 macOS 上不验这一项。
  2. `--dsw-alias-json-tree-*` 7 个 token 在官方表里是**字面 hex**（不走 `var()`），参考仓库的 `aliasLiteralOverrides` 也没收它们；
     M3 必须显式给出这 7 个值，否则会落回官方深/浅色，与 moonset 的中性色不一致。
  3. `meta.dshVersion` 记录的是**桌面壳 runtime**版本（0.2.2-rc.5），不是 npm CLI 的 0.2.2-rc.1；README/CHANGELOG 引用版本时要说清是哪一个。
- **M2 收口时新增的四条债**：
  1. `scripts/extract-dsw-tokens.mjs` **非幂等**：`meta.extractedAt` 每次重写都会让 `themes/dsw-tokens.json` 变脏。
     审计跑过 extract 后必须 `git checkout -- themes/dsw-tokens.json`；M8 的门禁不把该文件纳入"工作树干净"检查。
  2. `verify` 首行的 `live` 是 light∪dark 的并集，两端分叉（light≠dark）在首行看不出来——
     M3 的测试必须断言两份表的**键集合完全相同**，把这个盲点补上。
  3. 0.2.2 新增的 5 个 static 原语（`neutral-bluish-55/90/310`、`violet-400/600`）被 8 个新 alias 引用，
     M3 的家族规则必须覆盖它们，否则那 8 个 alias 会落回官方色。
  4. 7 个 `--dsw-alias-json-tree-*` 是字面值且 **keyword 与 number 同值**（`#1c00cf` / `#99c8ff`），
     M3 需显式给值——不能靠"按 token 名推断语义"的规则漏掉其中一个。
- **M3 带出的四条债**：
  1. 暗色 overlay 的 α 沿用官方值（0.06–0.24），未按暗色观感调大；M7 真机若觉得描边/悬停偏弱，调的是 B3 表里的 α，不是锚点色。
  2. 浅色 `--dsw-menu-surface-fill` 为 `rgba(255,255,255,.7)`（源板 `elevated` 就是纯白），与官方 `rgba(252,253,254,.7)` 有 2–3 级差；属源板语义，不修。
  3. `state-warn-primary` 压在 `state-warn-tertiary` 上仅 1.86:1（上游 1.95:1）：warn 是指示色不是文字，未写入契约。
  4. `palettes.ts` 与 `themes/` 在 `core.autocrlf=true` 下会出现「幻影 M」（内容相同、行尾不同）。测试已做行尾归一化（CRLF 检出下 37 条全绿）；根治要等 M8 的 `.gitattributes`。
- **M4 带出的四条债**：
  1. 跟随层 source 定名 `dsh-moonset`（= 插件 id），契约里原写 `moonset-follow`；**以代码为准**，M5 的断言按 `dsh-moonset`。
  2. 官方注册表**不存 label**：Appearance 不认第三方 id 时会显示裸 id，M5 必须用 `MOONSET_THEMES.label` 自渲染。
  3. 宿主 runtime 的 ui-theme（0.2.2-rc.5）高于本地 devDep（0.2.1-rc.2）；`overrideTokens` 签名一致但高版本侧只有文档兜底，
     M7 真机要记录 `typeof theme.overrideTokens === 'function'` 的探测结果。
  4. 同一 runtime 上两个 fiber（重复安装）共享一份注册与一次释放，不是引用计数：第二份卸载会让主题消失到下次激活。先不做计数，M7 记录行为。

## 附录 A：moonset 源色板（本计划的输入）

| 角色 | Light | Dark | 备注 |
|---|---|---|---|
| canvas | `#FAFAFC` | `#08090E` | 底色 |
| elevated | `#FFFFFF` | `#10121B` | 卡片/面板 |
| subtle | `#F2F4F8` | `#151824` | 代码块/引用 |
| ink-primary | `#10131C` | `#EEF0F7` | 正文 |
| ink-secondary | `#4A5166` | `#A1A8BE` | 次要 |
| ink-muted | `#70788F` | `#6F7791` | ⚠ 4.22 / 4.47，映射时提亮 |
| accent | `#4338CA` | `#818CF8` | indigo-700 / indigo-400 |
| accent-ui | `#4F46E5` | `#818CF8` | indigo-600，UI 链接 |
| accent-glow | `#6366F1` | `#6366F1` | 光斑/光束 |
| border-hairline | `rgba(15,23,42,.08)` | `rgba(255,255,255,.08)` | 发丝线 |
| border-strong | `rgba(15,23,42,.14)` | `rgba(255,255,255,.15)` | 强描边 |
| success | `#059669` | `#34D399` | emerald-600 / 400 |
| warning | `#D97706` | `#FBBF24` | amber-600 / 400 |
| danger | `#E11D48` | `#FB7185` | rose-600 / 400 |
| info | `#0284C7` | `#38BDF8` | sky-600 / 400 |
| moon | `#F59E0B` | `#F59E0B` | 琥珀月光，仅用于光晕/渐变尾 |
