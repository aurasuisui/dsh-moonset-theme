# 架构

这是 Moonset 0.1.0 的机制说明：两半区各做什么、228 个 `--dsw-*` 键从哪里来、
主题怎么注册、选择怎么记住、首帧怎么画，以及 **M5.2 的 adopt/再断言**——这一节是
最容易踩的坑，改动前请先读完。

数字与结论的复核方式写在每节末尾的「证据」里；调色板细节见 [palette.md](palette.md)，
与 catppuccin 的事实记录见 [compatibility.md](compatibility.md)。

- [1. 两半区与数据流](#1-两半区与数据流)
- [2. 清单与装配](#2-清单与装配)
- [3. 228 个 token 从哪里来](#3-228-个-token-从哪里来)
- [4. `theme.register`：两个主题定义](#4-themeregister两个主题定义)
- [5. `overrideTokens`：跟随系统层](#5-overridetokens跟随系统层)
- [6. 自带设置区与持久化](#6-自带设置区与持久化)
- [7. 首帧注入与撤表](#7-首帧注入与撤表)
- [8. M5.2：adopt() 回声与再断言（必读）](#8-m52adopt-回声与再断言必读)
- [9. 卸载与重载](#9-卸载与重载)
- [10. 复核命令](#10-复核命令)
- [11. CSS 注入白名单（P5 例外登记）](#11-css-注入白名单p5-例外登记)

## 1. 两半区与数据流

一个 DSH 插件可以有两半，本仓库两半都用上了：

| 半区 | 入口 | 产物 | 运行位置 | 职责 |
|---|---|---|---|---|
| Host（node 侧） | `src/index.ts` | `lib/index.js` | dsh 的插件加载器 | 声明 `Config`、监听 `webserver/index-inject`、把持久化的选择画进首帧 |
| Client（浏览器侧） | `src/client/index.ts` | `lib/client.js` | 页面里的模块表（`window.__ModuleLoader__`） | 注册两个主题与跟随层、设置区、读取 / 写入自己的选择 |

Client 产物是闭包工厂（`window.__ModuleLoader__.load({id, factory})`），
`@deepseek-ai/*` 与 `react*` 一律不打包，运行时由宿主的冻结模块表提供
（`tsdown.client.ts` 的 `PLATFORM_MODULES`：`react`、`react/jsx-runtime`、
`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、
`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、
`dsh-client-ui-dockkit`）。所以 `src/client/**` 里对 `@deepseek-ai/*` 的引用
必须全是 `import type`，值一律从 `ctx` 拿。

数据流（从左到右单向，没有任何一步联网）：

```text
安装态桌面壳 app.asar
  └─ /dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css
        │  scripts/extract-dsw-tokens.mjs（只读 asar，切 body / body[data-ds-dark-theme] 四块）
        ▼
themes/dsw-tokens.json          228 键 × light/dark + meta{dshVersion, cssSha256, cssBytes, …}
themes/moonset-palette.json     16 个角色 × light/dark（人工可编辑的唯一色源）
themes/baseline-tokens.json     冻结的 190 名单（0.2.0-rc.2，永不修剪）
themes/retired-tokens.json      上游已删的 1 个键（逐条带证据）
        │  scripts/generate-palettes.mjs（A/B1/B2/B3 分类 → 生成）
        ▼
src/client/palettes.ts          MOONSET_LIGHT / MOONSET_DARK 各 228 键（自动生成，勿手改）
        │  src/client/themes.ts / choice.ts / durable.ts（注册、跟随层、持久化）
        ▼
lib/client.js（页面）           theme.register ×2、overrideTokens 跟随层、settings.section
          + src/boot-palette.ts（Host）→ webserver/index-inject → 首帧 <style> + <body> script
```

**证据**：`pwd` 为仓库根时执行 `pnpm build`，产物大小 `lib/index.js` 39.13 kB
（gzip 8.85 kB）、`lib/client.js` 71.01 kB（gzip 18.68 kB）；模块外部化见
[`tsdown.client.ts`](../tsdown.client.ts) 的 `PLATFORM_MODULES`。

## 2. 清单与装配

`package.json` 里真正被宿主读取的四个字段：

- `name` = `@aurasuisui/dsh-moonset-theme`；`version` = `0.1.0`；已发布到 npm
  （`publishConfig.access = public`，`prepack` 构建）。`name` 是**装载契约**：
  `dsh-client-modules` 以包名为键匹配 `__ModuleLoader__` 的注册 id，
  `tests/smoke.spec.ts` 断言 `lib/client.js` 里的 id 与 `package.json` 的 `name` 一致。
- `dsh.bundle.patch` = `./cordis.patch.yml`：一个 `insert` 行，
  `id: dsh-moonset` / `name: '@aurasuisui/dsh-moonset-theme'`。**`id` 是插件的
  profile 条目 id，与包名解耦**；`name` 必须是可解析的包 specifier（宿主拿它去
  profile 的 `node_modules` 里找），所以它跟着包名走。
- `dsh.client.inject`：客户端半区需要的四个包（ui-renderer、locale、ui-theme、
  ui-settings）；少一个就可能在启动日志里看到 `entry(s) did not activate`
  （见 [backlog-v0.2.md](backlog-v0.2.md) 的 `dsh.client.inject` 条目）。
- `dsh.client.platform` = `web`；`exports` 三项（`.` / `./client` / `./package.json`）。

同一字符串 `dsh-moonset` 在四个地方出现，必须一致：
`src/index.ts` 的 `name` 与 `MOONSET_ENTRY_ID`、`cordis.patch.yml` 的 row id、
`src/client/durable.ts` 的 `MOONSET_ENTRY_ID`（客户端不能 import 主机模块，
两份字面量由 `tests/settings.spec.ts` 交叉断言）。
漂移的实际代价是：插件加载器用 row id 报告失败，id 一歪，日志就从可读变成匿名。

**证据**：`package.json`、[`cordis.patch.yml`](../cordis.patch.yml)、`tests/settings.spec.ts` 的
「declares one volatile choice field defaulting to off, and the same entry id」。

## 3. 228 个 token 从哪里来

**口径先说清**：0.1.0 覆盖的是**安装态桌面壳**里的那张表，不是 npm 全局 CLI 的。
两者版本号不同，不能混用（npm CLI `0.2.2-rc.1` 的树里没有 `design-platform.css`）。

1. **取证**（`scripts/extract-dsw-tokens.mjs`）：用 `scripts/asar-read.mjs` 只读打开
   `app.asar`，取出 `design-platform.css`；它只接受「2 × `body` + 2 ×
   `body[data-ds-dark-theme]`」的块布局，其它布局直接报错退出（没有兜底分支）。
   `html[data-platform='darwin'] body` 的 macOS 振动层**不解析**（正则锚定
   `body`，结构上不会命中），所以表是平台无关的一值一方案。
   输出 `themes/dsw-tokens.json`，`meta` 写死审计锚点：
   `dshVersion: 0.2.2-rc.5`、`cssSha256: 3234f318769ea5065013793d58d98b235948486789d69ea16e850bd3713babcc`、
   `cssBytes: 29861`、`asarPath`、`cssPath`、`counts: {light:228, dark:228}`。
   样式表里共 **237** 个唯一 `--dsw-*` 名，进双方案表的是 **228** 个；
   差额 9 个只出现在 darwin 块。
2. **三方对差**（`scripts/verify-tokens.mjs`）：冻结 190 / 安装态 228 / 显式退役 1。
   `missing = 冻结 − 安装态 − 退役`，只有登记过的退场才豁免；退役键没有条目却从
   安装态消失，照样 exit 1。当前输出 `missing=0 retired=1 live=228 added=39`。
   `live` 是 light ∪ dark 的并集，两端是否分叉看不出来——所以测试另外断言两份表
   **键集合完全相同**。
3. **生成**（`scripts/generate-palettes.mjs`）：官方 228 个值每个恰好落进一类：
   A（`--dsw-static-*` 原语，82）/ B1（`var()`/`color-mix()` 表达式照抄，109 light、
   110 dark）/ B2（纯中性字面量，14/16）/ B3（有彩字面量，23/20），B4 必须 0——
   出现 B4 时生成器**拒绝写文件**并 exit 1。输出 `src/client/palettes.ts`，纯数据、
   按字母序、无时间戳，两次运行逐字节相同。

0.1.1 起生成器多了一个**显式覆盖表** `TOKEN_OVERRIDES`：官方值是 B1 表达式、但
我们要换值的 token（当前两个：选中行底色与强调色）在那里逐条列出，**计数仍按官方值
所属的类统计**（所以 A=82 / B1=109,110 不变），换过的名字导出成
`MOONSET_TOKEN_OVERRIDES` 供测试引用。未知键、`--dsw-static-*` 键、与
`CHROMA_LITERALS` 撞车、值里引用了表外 token 的条目，生成器直接 exit 1——不猜、
不兜底。

一条容易误解的规则：B1「表达式照抄」不是回落到官方色。被引用的 static 就在同一张表
里，解析后自然跟随 A；7 个 `--dsw-alias-json-tree-*` 是字面量，被**逐个**列进
`CHROMA_LITERALS`（keyword 与 number 同值也要分开列）。`--dsw-static-amber-500`
与官方同为 `#F59E0B` 是因为源板 `moon` 就是这个琥珀色（字符串也就相同），
属 A 类，不是 B3 回落。

**证据**：`node scripts/extract-dsw-tokens.mjs`、`node scripts/verify-tokens.mjs`、
`node scripts/generate-palettes.mjs`；分类计数的实测值见 [palette.md](palette.md)。

## 4. `theme.register`：两个主题定义

```ts
theme.register({ id: 'moonset-light', colorScheme: 'light', tokens: MOONSET_LIGHT }) // 228 键
theme.register({ id: 'moonset-dark',  colorScheme: 'dark',  tokens: MOONSET_DARK  }) // 228 键
```

为什么是**两个**主题而不是一个主题两种颜色：`ThemeDefinition.colorScheme` 是单值
（`dsh-client-ui-theme/lib/types/client/index.d.ts`），浅深只能两套定义。
「跟随系统」因此也不能是一个主题，只能是一个 token 层（§5）。

注册走 `tolerantRegistration`（`src/client/registration-tolerance.ts`）：官方 runtime
对重复 id 抛 `theme "…" is already registered`，而 `apply()` 抛错会让整条 web boot
失败。于是「这个 id 已被别人占着」被降级成**跳过我们的那一个**，而不是拖垮用户的
插件集；形如 `already (?:registered|has locale|has an entry)|duplicate .*route` 的
错误静默跳过，其它错误仍打一条 `[dsh-moonset] registration skipped` 警告后跳过。

注册按 runtime 记忆化（`WeakMap<MoonsetThemeService, TolerantDisposer>`）：
同一个 runtime 再调一次返回同一个 disposer，不重复注册；释放后清掉记忆，
重新激活会再注册。因此**重复安装的两份 fiber 共享一次注册、一次释放**——
第二份的卸载是 no-op（这也是 [backlog-v0.2.md](backlog-v0.2.md) 里「引用计数」那条债）。

**证据**：`src/client/themes.ts`、`tests/theme.spec.ts`（注册两个 id、重复注册不抛、
dispose 后可重注册、跟随层 light/dark 各自取值）。

## 5. `overrideTokens`：跟随系统层

「跟随系统」= 官方偏好保持 `system` + 叠一层同时携带浅深两半的 token 覆盖层：

```ts
theme.overrideTokens('dsh-moonset', { [token]: { light, dark }, ... }) // 228 条，每条一对
```

- `FOLLOW_LAYER_SOURCE = 'dsh-moonset'`（= 插件 id），层身份只属于我们；撤层按 source 比较，
  不会误删别人的层（[compatibility.md](compatibility.md) 的 M7 第 4 条）。
- 偏好必须是 `system`：`light`/`dark` 会钉死 scheme，跟随层的 OS 半边永远不活。
  `follow` 选择因此先 `setTheme('system')` 再堆层；具体主题（light/dark）则**先撤层再
  `setTheme(moonset-*)`**，否则层会继续盖住主题刚设的 token。
- 层**同步 publish**：`overrideTokens` 在返回前就 publish，它返回的 disposer 在被调用时
  也同步 publish，所以在 `theme/change` 派发栈里重建/销毁层会重入这次派发
  （issue #36 约束 2）。
  `createFollowLayer` 用 `mutating` 窗口把这类重入记一条警告并忽略；正常调用点是
  点击、启动恢复这类应用代码，不是事件监听器。
- 层的生命周期归调用方：`enable()` / `disable()` 幂等，卸载时由 choice effect 的
  teardown 调 `follow.disable()`。

**证据**：`src/client/themes.ts`、`tests/theme.spec.ts`（单层 228 对、幂等、
重入被忽略、偏好留在 `system`、卸载后不残留）。

## 6. 自带设置区与持久化

**为什么不能只用官方主题偏好**：官方 `setTheme(id)` 只有 `id ∈ {light, dark, system}`
才写设置文档（0.2.2-rc.5 的 `client.js` 里是
`if(isThemePreference(id)) this.write(() => this.host.set('preference', id))`，
`THEME_PREFERENCES = ['light','dark','system']`）；第三方 id 只活在 runtime 的**内存**
偏好里，而 `adopt()` 每次回声都用文档值覆盖内存（§8）。所以 `moonset-*`
**记不住**，必须自带存储。

持久化的形状：

- Host 声明 `Config = { choice: volatile(union('off','light','dark','follow')).default('off') }`。
  `volatile()` 是 schemastery ≥ 3.18.3 的能力，`maybeVolatile` 做能力探测：
  老宿主上它是 no-op，插件退化成「没有条目表单」，而不是模块求值时抛错拖垮 boot。
- 设置服务把 volatile 字段投影成以**profile 条目 id** 命名的表单：
  `ctx.configForms.get('dsh-moonset')` → `{ choice }`。客户端只能通过
  `ctx.inject(['configForms'], …)` 晚绑定，绑定失败就退化为「本会话能切、重启会忘」，
  并在写入处打一条 warn。
- 写入是**意图队列**（`WRITE_DEBOUNCE_MS = 300`，尾沿、后值覆盖前值）：
  一次连点合成一次写入；`flush()` 立即落盘；`dispose()` 先 flush 再释放表单，
  所以卸载不会吞掉还没落盘的那次点击。
- 读取有**水位**：未落盘的意图优先于文档回声（`read()` 回答意图），
  已接受的快照 revision 之下的迟到回声直接丢弃。回声路径**永远不写回**。
- `off` 表示「没选过」：启动恢复**不重放** `off`（否则每次启动都会把用户的官方偏好
  写成 `system`）；只有 `light`/`dark`/`follow` 会重新 apply。
- 官方 Appearance 行的显式选择会被**镜像成 `off`**（`shouldMirrorOfficialPick`）：
  否则下一次启动会把用户自己的选择盖回来。镜像只写 `off` + 撤层，**不**调
  `applyChoice('off')`（那会 `setTheme('system')`，把用户刚选的 `dark` 翻回 `system`）。

**证据**：`src/index.ts`、`src/client/durable.ts`、`src/client/choice.ts`、
`tests/settings.spec.ts`、`tests/echo.spec.ts`；官方 `setTheme` 的窄化在
安装态 0.2.2-rc.5 的 `dsh-client-ui-theme/lib/client.js` 中可直接读到（该副本被压缩，
无行号可引，但字符串 `isThemePreference(id)` 与 `THEME_PREFERENCES` 都在）。

## 7. 首帧注入与撤表

Client 只能在其脚本加载**之后**才 `register`/`setTheme`，因此官方首帧先画自己的
画布（暗色 `#151517`）。Host 半区在 `webserver/index-inject` 里补两行：

| 行 | 位置 | 内容 |
|---|---|---|
| `html` | head | `<style data-dsh-moonset-boot>`：228 条声明 + 结尾 `background-color:var(--dsw-alias-bg-base)` |
| `script` | body | `document.body.toggleAttribute('data-ds-dark-theme', …)` 对齐属性 |

两个细节决定「首帧真的是月落色」，缺一个就退回官方观感：

1. **可见画布是 `body` 的背景**。首帧 `#root` 是空的，没人消费 `--dsw-*`；
   只有声明块末尾那条 `background-color` 才能盖掉官方 `#151517` / `#fff`。
2. **选择器要压过官方的暗色块**。`html body`（0,0,2）赢 `body`（0,0,1），
   但官方暗色表是 `body[data-ds-dark-theme]`（0,1,1），所以固定风味用
   **并列双选择器** `html body,html body[data-ds-dark-theme]`（后者 0,1,2），
   两个选择器带**同一套声明**——不管属性当前是什么，画布只画一种方案。
   `follow` 则是两份块：亮半 `html body,html body:not([data-ds-dark-theme])`，
   暗半放在 `@media (prefers-color-scheme: dark)` 内、同样并列双选择器。

顺序帮不上忙：宿主把 head 行插在 `<head>` 之后、同一组内按表序；官方主题用
`ctx.on('webserver/index-inject', …, { prepend: true })` 先推自己的行，所以我们
反而在后面。赢的是**特异性**，不是文档顺序。服务出来的索引页没有 CSP 头，
内联 style/script 合法（官方自己也这么做）。以上宿主行为取自
[`src/boot-palette.ts`](../src/boot-palette.ts) 的契约注释，该注释声明已对照安装态
0.2.2-rc.5 的源码复核；本仓库的单元测试只覆盖我们自己产出的行。

输出是**空**的合法情形：没有 config、`choice` 不是 volatile ref（老宿主的静态值
不可信）、`off`、以及任何不认识的值。值里出现 `<>\{};` 或控制字符的 token 会被
丢弃并 warn（当前 228 条全部通过正则）。

**另一条注入通道**：皮肤层（0.1.1）**不参与首帧**，它是 `html[data-moonset-skin]`
加一张 `<style data-dsh-moonset-skin>`，由 `src/client/skin.ts` 独占；规则白名单见
[§11](#11-css-注入白名单p5-例外登记)，token 侧的两个选中行覆盖见 §3 的 `TOKEN_OVERRIDES`。

**撤表**：`src/client/boot-cleanup.ts` 用 `style[data-dsh-moonset-boot]` 精确删除这张
表，调用点是启动恢复、用户点击、以及 choice effect 的 teardown。表必须死在这三个
时刻，否则它的双选择器会永远压住官方 token 块，之后**任何**主题切换都不生效。
客户端的 DOM 写只有「删除自己那张表」这一种，绝不写 `html.style` / `body.style`。

**证据**：`src/boot-palette.ts`、`src/client/boot-cleanup.ts`、`tests/boot.spec.ts`
（双选择器 + 228 条 + canvas、`off`/无 ref 空表、follow 两半、危险值丢弃、幂等撤表、
script 行）；`lib/index.js` 里可 grep 到 `webserver/index-inject`。

## 8. M5.2：adopt() 回声与再断言（必读）

用户实测：在设置里选浅色/深色会**闪一下、切回系统主题**。根因在官方 runtime，
不在我们的策略：**我们自己写设置这个动作，会触发 runtime 把偏好改回文档值**。

### 8.1 两个发生点

官方 `ThemeRuntime` 在构造时就订阅自己的设置作用域：

```js
// @deepseek-ai/dsh-client-ui-theme/lib/client.js:1681（0.2.1-rc.2 可读副本）
ctx.effect(() => host.subscribe(() => {
  this.adopt();
}), 'ui-theme: settings scope adoption');
```

`adopt()` 在 :1787，做的事是「把文档里的偏好抄进内存偏好，然后 publish」
（下面是节选，`...` 是省略掉的行，不是源码）：

```js
adopt() {
  if (this.pendingWrites > 0) return;
  const section = this.host.getSnapshot().value;
  if (section === void 0) return;
  ...
  if (this.preference === section.preference && ... ) return;
  this.preference = section.preference;   // ← 覆盖我们刚设置的内存偏好
  ...
  this.publish();
}
```

而行号归属要说清：:1681 / :1787 取自**本仓库 devDependency 的可读副本**
`@deepseek-ai/dsh-client-ui-theme@0.2.1-rc.2`；安装态桌面壳的 0.2.2-rc.5 副本被压缩成
3 行（113,336 B），同一构造仍在（`host.subscribe(()=>{this.adopt()})`、
`adopt(){…this.preference=section.preference…}`），但**没有行号可引**。

### 8.2 为什么会闪

1. 用户点「深色」→ 插件 `applyChoice('dark')` → `setTheme('moonset-dark')`：第三方 id
   只写内存偏好，**不写设置文档**，界面立刻变深。
2. 插件把选择写进**自己的**表单（`form.set('choice', 'dark')`，300ms 防抖后落盘）。
3. 设置服务接受这次写入后会重新派生作用域表单 → 触发 1681 的订阅 → `adopt()` 读到
   文档里的 `preference`（只能是 `system`/`light`/`dark`，我们从来没写进去）→
   把内存偏好改回那个内置值 → `publish()` → 主题瞬间弹回。

所以任何「用官方 seam 记住第三方主题」的做法都会撞上这一步；这正是
[已决 #4](plans/v0.1.0.md) 与自带 section 存在的原因。

### 8.3 修法：断言，不是写回

`theme/change` 监听里按存储的选择分派（`src/client/index.ts` 的 `handleThemeChange`）：

- `choice === 'off'`：什么都不做（没有选择要守）。
- `choice === 'follow'`：只镜像**显式**的官方 `light`/`dark`；`system` 是跟随模式自己的
  终态（也是 `adopt()` 抄回去的值），**不镜像也不再断言**。
- `choice === 'light' | 'dark'`：若偏好是**内置值**（`system`/`light`/`dark`），
  且距上次本地写入 `sinceLastWrite() <= RESTORE_WINDOW_MS`（1500ms），判定为
  **我们这次写入的回声** → 再断言；窗口外则是用户在官方 Appearance 的真实点击 →
  镜像成 `off`（M5.1）。第三方 id（含别人的）永远不满足「内置值」，直接忽略。

再断言本身（`scheduleReassert`）有四条纪律：

1. **必须延后**：用 `queueMicrotask`，绝不同步调用。回调运行在 `adopt() → publish()`
   的派发栈里，同步 `setTheme` 会被同一个 `adopt()` 再答一次（catppuccin 的
   `scheduleRestore` 用同一条边界）。
2. **同一 tick 合并**：`reassertScheduled` 置位，任意多条回声只产生一次
   `setTheme(ourId)`。
3. **有上限**：`REASSERT_LIMIT = 3`，按**波次**计数（用户点击会清零并撤销「停手」），
   到顶就打一条 warn 并停手——再断言与 `adopt()` 互相喂食是比闪一下更糟的 bug。
4. **卸载后不得开火**：teardown 里 `active = false`，排队的微任务直接返回。

再断言只恢复**偏好**，不重跑 `applyChoice`：具体主题的跟随层此时已经撤了，
每来一次回声都重发一次层变更只会制造额外 publish。

### 8.4 这条机制的已知盲区

- **1500ms 窗口**：用户若在窗口内真去官方 Appearance 点 light/dark/system，会被当成
  回声再断言掉，那一次点击不镜像成 `off`；自愈要等下一次任意设置写入，纯静置不自愈。
- **上限是每波次**：窗口内连续第 4 次被冲回就停手（实测不触发）。
- 两条都进 [backlog-v0.2.md](backlog-v0.2.md)，0.1.0 不修。

**证据**：`src/client/index.ts` 的 `setup` 注释与 `handleThemeChange` / `scheduleReassert`
实现、`src/client/durable.ts` 的 `RESTORE_WINDOW_MS`、`src/client/choice.ts` 的
`shouldMirrorOfficialPick`；`tests/echo.spec.ts` 21 条覆盖（含「被冲回后救回」
「派发栈外延后」「不产生无限循环」「窗口外官方 light 仍镜像成 off」）；
变异自检记录在 [计划看板 M5.2](plans/v0.1.0.md)。

## 9. 卸载与重载

所有注册都挂在 `ctx.effect`（或 `ctx.inject` 的 fiber）上，卸载即释放：两个主题注册、
皮肤表（`moonset: skin sheet`：摘根属性 + 删表）、字典、choice effect
（订阅 + 跟随层 + 表单 + 撤表）、设置区。释放顺序上 `dispose` 先 flush 再释放表单，
所以「点了但还没落盘」的选择不会丢。注册记忆化让重复安装的两份 fiber 共享一次注册，
**先释放的那次生效、后一次 no-op**（已记录的现场行为，见
[backlog-v0.2.md](backlog-v0.2.md)）。

## 10. 复核命令

在仓库根依次执行（都可离线）：

```powershell
node scripts/extract-dsw-tokens.mjs      # 读安装态 app.asar → themes/dsw-tokens.json
git checkout -- themes/dsw-tokens.json   # 该脚本非幂等：meta.extractedAt 每次都会变
node scripts/verify-tokens.mjs           # 期望 missing=0 retired=1 live=228
node scripts/generate-palettes.mjs       # 重生成 src/client/palettes.ts（应无 diff）
pnpm test                                # 132 passed / 9 files
node scripts/coexist-check.mjs           # 与 catppuccin 假宿主共存，6/6 PASS
```

`extract` 的 `meta.extractedAt` 每次重写都会让文件变脏，跑完审计要还原（M2 的记录债）。
`generate-palettes` 是幂等的：`tests/palettes.spec.ts` 直接用 `renderModule(buildPalettes())`
与已提交文件逐字比较，所以「不写盘也能证明可复现」。

## 11. CSS 注入白名单（P5 例外登记）

契约 §一 P5 是「token 优先，CSS 只补 token 表达不了的」。这一节登记的就是
**「表达不了」的那几件**，以及它们唯一的注入通道。判据只有一句：
**token 能表达的，写进 CSS 就是返工**；不在下表里的 CSS 改动，一律退回 token。

### 11.1 为什么允许 CSS（为什么 token 在这里失效）

`--dsw-*` 是自定义属性，只能落在**宿主已经用到的**地方。三类面天生没有座位：

- **文本选区**：`::selection` 是 UA 伪元素，浏览器直接画默认蓝；安装态 0.2.2-rc.5 的
  9 张主题样式表里 `::selection` **0 命中**，没有任何 token 被它消费。只改 `--dsw-*`
  不会让选区变紫——这就是「必须注入 CSS」的实测依据（契约 D2）。
- **地面渐变**：`body` 的多层 `background`（wash + 双光斑）是图层结构，不是单色，
  一个 token 装不下（0.1.2）。
- **材质面**：`backdrop-filter` 必须落在**背靠内容**的平面上，且按 P4 画在自有
  `::before` 上（0.1.3）。

### 11.2 通道：一个根属性 + 一张表（P2）

| 件 | 值 | 说明 |
|---|---|---|
| 根属性 | `html[data-moonset-skin]` | 布尔式（值为空串）；既是开关信号，也是将来按属性门控的选择器前缀 |
| 样式表 | `<style data-dsh-moonset-skin>` | **单表单例**；标识写在属性上，DevTools 里一眼可辨（M1 的「带标识」） |
| 写入口 | `src/client/skin.ts` | `mountSkin()` / `unmountSkin()`，此外没有第三处写 DOM |
| 表内容 | `skinCss()` | **纯函数**，不读 document / 时间 / 调色板，所以能逐字断言 |
| 生命周期 | `ctx.effect('moonset: skin sheet')` | 挂载与卸载同一次 effect；表不可能活得比插件久 |

`mountSkin()` 先写根属性、再做单例检查（已在就返回，绝不建第二张），然后
`head.appendChild`；`unmountSkin()` 先摘属性、再循环删掉所有带我们标识的表——包括
别人多塞的那张（热重载、第二份插件、手粘的节点），直到删不出为止。两者都幂等，
且在没有 `document` 的环境（Node 侧单元测试）里是静默 no-op，不抛。

**零常驻 JS（P1）**：`skin.ts` 里没有 `addEventListener` / `requestAnimationFrame` /
`ResizeObserver` / `setInterval`；全部登记只有两个时刻——插件激活与卸载。

### 11.3 白名单：允许的六类

| 类 | 形状 | 为什么 token 做不到 | 版本 |
|---|---|---|---|
| **选区** | `html body ::selection` | UA 伪元素，无 token 座位 | 0.1.1 |
| **选中项文字色** | 稳定属性钩子上的 `color`（见下表） | 宿主把选中容器的文字色直接写成 `--dsw-alias-label-primary`，值内联在规则里，**不能从一个 token 重新指向** | 0.1.1 |
| **地面渐变** | `html[data-moonset-skin] body { background: … }`（浅色三层）+ `… body[data-ds-dark-theme] { background: … }`（暗色四层，同一靛蓝色相） | 多层图层 + 视口固定 + 两套方案，单 token 装不下 | 0.1.2 / M3 |
| **地面可见性**（M2 起三档可调 + 底部遮罩带） | `#root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])` / `:has([data-composer-seat])` / `:has(> [data-slot='shell.bottom'])` / `[data-slot='main'] > div` / `[data-slot='sidebar'] > div` 上的 `background-color: transparent`；外加 `#root [data-composer-seat] { background-image: none }`（底部遮罩带） | 宿主把 `--dsw-alias-bg-base`（侧栏是 `--dsw-specific-sidebar-fill`）画在外壳链、三列与每个面板页根上，地面在它们**下面**；这些面没有稳定属性（类名按构建哈希，`data-global-panel` 只在面板打开时存在），只能靠结构 + 渲染器锚点。底部那条遮罩带更是 **image**（不是颜色），token 和 `background-color` 都改不到 | 0.1.2 M1.5 / M2 |
| **色相锚点** | `html[data-moonset-skin] { --dsh-moonset-night: #2563EB }` + 暗色 `body[data-ds-dark-theme]` 覆盖为 `#60A5FA`；只有 `nightBlue` 读它 | 228 键表里**没有可用的蓝**：`blue-500` = `#4F46E5`/`#818CF8`、`blue-600` = `#413BB9`/`#6B74CE` 全是靛，`deepseek-*` 就是强调色本身，`violet-400` 更紫，`sky`/`cyan` 家族根本不存在 | 0.1.2 M5 |
| **材质面** | 自有 `::before` 上的 `backdrop-filter` | P4：画在伪元素平面，容器本体零绘制 | 0.1.3 |

当前登记（0.1.2 + M1.5…M5，全表九条规则，55 行 / C 档 57 行）：

```css
/* dsh-moonset[0.1.2]: skin — P5 whitelist (selection, selected-item text, ground) */
html body ::selection {
  background: color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent);
  color: var(--dsw-static-deepseek-500);
}
/* selected items: stable attributes only, never a host class name. The root
   attribute gate is what outranks the host (0,2,2 vs .tab[data-active] 0,2,0). */
html[data-moonset-skin] body [aria-selected='true'],
html[data-moonset-skin] body [aria-current='page'],
html[data-moonset-skin] body [aria-current='true'],
html[data-moonset-skin] body [data-active='true'],
html[data-moonset-skin] body [aria-pressed='true'] {
  color: var(--dsw-static-deepseek-500);
}
/* the host draws the selected tab underline as a 2px ink bar; keep it the
   label colour. Only the plugins tab renders an ::after on such an element. */
html[data-moonset-skin] body [data-active='true']::after {
  background: var(--dsw-static-deepseek-500);
}
/* 0.1.2 hue anchor (M5): the 228-key table carries no usable blue, so the
   skin owns exactly ONE literal colour, used by the nightBlue option. */
html[data-moonset-skin] {
  --dsh-moonset-night: #2563EB;
}
html[data-moonset-skin] body[data-ds-dark-theme] {
  --dsh-moonset-night: #60A5FA;
}
/* 0.1.2 ground (light): canvas + wash + two spots in ONE declaration; the
   strength is resolved in JS, so every alpha below is a LITERAL percentage. */
html[data-moonset-skin] body {
  background:
    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--dsw-static-deepseek-500) 16%, transparent) 0%, transparent 62%),
    radial-gradient(ellipse at 97% 97%, color-mix(in srgb, var(--dsw-static-amber-500) 3%, transparent) 0%, transparent 46%),
    linear-gradient(165deg, color-mix(in srgb, var(--dsw-static-deepseek-500) 1.5%, transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);
}
/* 0.1.2 ground (dark): ONE indigo hue at three footprints (core, halo,
   bottom reflection) plus a thinner wash — depth without a second colour. */
html[data-moonset-skin] body[data-ds-dark-theme] {
  background:
    radial-gradient(circle at 34% 2%, color-mix(in srgb, var(--dsw-static-deepseek-400) 12%, transparent) 0%, transparent 26%),
    radial-gradient(ellipse at 50% -6%, color-mix(in srgb, var(--dsw-static-deepseek-400) 20%, transparent) 0%, transparent 70%),
    radial-gradient(ellipse at 50% 104%, color-mix(in srgb, var(--dsw-static-deepseek-400) 4%, transparent) 0%, transparent 55%),
    linear-gradient(160deg, color-mix(in srgb, var(--dsw-static-deepseek-400) 1%, transparent) 0%, transparent 75%) var(--dsw-alias-bg-base);
}
/* 0.1.2 visibility (scope: main): the host paints bg-base on these
   carriers; clear their COLOUR — cards, bubbles and menus keep theirs. */
html[data-moonset-skin] #root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar']),
html[data-moonset-skin] #root :has([data-composer-seat]),
html[data-moonset-skin] #root [data-slot='main'] > div {
  background-color: transparent;
}
/* 0.1.2 bottom band (M2): the composer seat's bg-base mask is an image. */
html[data-moonset-skin] #root [data-composer-seat] {
  background-image: none;
}
```

三个选择上的理由：

1. **强调色用 `--dsw-static-deepseek-500`，不是 `--dsw-alias-brand-primary`**。后者
   在官方表里是 `var(--dsw-static-neutral-bluish-1000)`（浅）/ `-50`（暗），即**中性
   墨色**，照抄进本表后依然是墨色；蓝紫强调在本调色板里是 `deepseek` 阶梯的 500
   （= 16 锚点的 `accent`：浅 `#4338CA` / 暗 `#818CF8`）。契约 §一 A 节写的
   `brand-primary` 在这里会画出一条灰选区，改用 accent 才是「紫」。
2. **文字也用同一个 accent**：文档站的配对是 `selection:bg-indigo-500/20` +
   `selection:text-indigo-700`，即「底是淡紫、字是紫」，所以这里用同一个 accent 而
   不是正文墨色。首验发出去的「紫底 + 墨字」看着像灰紫，问题就在这一条。实测选中文字
   对该选区底的对比度：浅 **5.25:1** / 暗 **4.55:1**（叠在 `bg-base` 上，均过 AA
   4.5:1；`tests/skin.spec.ts` 用调色板重算这两条，改锚点就会红）。
3. **选择器 `html body ::selection`（0,0,2）**：压过任何第三方 `::selection`
   （0,0,1）；表又是在宿主样式之后插入的，同特异性也赢。宿主 9 张表零命中，所以
   当前没有实战冲突（D2 的兜底留在这里）。

**地面渐变（0.1.2，第三条）**：`html[data-moonset-skin] body` 上**一条** `background`，
三层（顶→底）：靛蓝月晕 `radial-gradient(ellipse at 50% -10%, accent 16% → transparent 62%)`、
琥珀暖光 `radial-gradient(ellipse at 92% 88%, amber 10% → transparent 60%)`、wash
`linear-gradient(165deg, accent 1.5% → transparent 70%)`。最后一层的颜色是画布 token
`--dsw-alias-bg-base`——`background` 简写会把 `background-color` 重置成透明，地面必须
在同一条声明里带上底色，否则画布会漏底。颜色全部由 `--dsw-static-deepseek-500`
（accent）与 `--dsw-static-amber-500`（moon）同 `transparent` 混出，没有字面色。wash 的
左右两端横向差（1920×1080 视口）：浅 **1.34/255** / 暗 **1.62/255**，落在契约的
「≤2/255」带内；两枚光斑固定视口，多面板各读到不同切片（D1：接受，0.1.3 做玻璃时一起调，
本轮不加 blur、不加第二张表）。

**强度内联，不进中间变量**：每个 `color-mix()` 的 alpha 写成 `calc(16% * 1)`，`1` 是
M1 的常量 100%；M2 只要把 `1` 换成 `var(--dsh-moonset-glow-strength, 1)`，表达式形状
不变。把乘式预先算进一个中间 custom property 再让 `background` 引用是**错的**：
catppuccin 在 Chromium 上实测过「性质失效传播不重算」，旋钮会失灵（0.1.2 D2）。本仓库另用
Playwright Chromium 复核了同一内联形状——`calc(16% * var(--strength, 1))` 在 1→2 时计算值
从 alpha 0.16 变 0.32（`color-mix` 里允许 `calc()` 百分比），所以 M2 的代入路径成立。

**开关 = 整条规则消失**：地面在 `skinCss()` 里是独立一段（`GLOW_RULES`），
`skinCss({ glow: false })` 返回 0.1.1 那张 19 行的表——不是 alpha 归零（0 alpha 仍参与
合成，0.1.2 §一）。M2 只需把这个选项接到 `Config`，不用再拆规则。

**M2 / M3：地面范围（A/B/C）、开关与强度**：三个 volatile 字段（`glowScope` / `glow` /
`glowStrength`）与 `choice` 同一个表单、同一个 300 ms 写防抖；样式表在**控制变化后**
150 ms 重建（`SKIN_REBUILD_MS`，不是逐帧），走 `updateSkin()` 原地替换单例表的内容。
**默认档 M3 起是 B `main`**（真机对比后用户拍板：B 最协调），C 仍可选。三档是**嵌套**的，
各自清哪些承载层见 §11.3 上表：

| 档 | 额外清掉的承载层 | 侧栏 | 底部 |
|---|---|---|---|
| A `conversation` | — | 保留自己的面 | 保留 |
| B `main`（默认，M3 起） | 外壳与三列（`:has([main, sidebar, rightbar])`） | 保留 `sidebar-fill` 内层 | 保留 |
| C `all` | B + 侧栏内层 + 底部单元 | 透出地面 | 透出地面 |

**强度在 JS 里算，CSS 只收字面百分比**：`glowAlphas(strength)` / `darkGlowAlphas(strength)`
把 100% 那一行乘上系数再格式化成 `24%` / `2.25%` 这样的字面百分比，所以表里永远没有 `calc()`、
也没有「藏在中间 custom property 里」的值（0.1.2 D2 的教训）。开关关闭时整段（两套地面 + 清理 +
底部遮罩）一起消失，仍是 0.1.1 那张 19 行的表。

**M3：重新配比 + 暗色独立一套**。真机两轮反馈逼出来的三处改动：

1. **琥珀退成点缀（浅色）**：16% : 10% 时琥珀在近白底上最亮，用户要把它拖到 50% 才觉得紫是主角；
   改成 16% : 6% 仍「太抢」，最终 **16% : 3%**（≈5.3:1），并把椭圆压到 `97% 97%` 角上、
   `transparent` 收到 46%——它现在只是右下角一点暖意，碰不到画面中部。
2. **暗色不再单调，且只用一种靛蓝**：用户先嫌「深色太单调」，看到紫罗兰层后又说「不要紫罗兰那层」。
   最终暗色是**同一色相三层**（+ wash）：小而紧的**核心** `circle at 34% 2%`（`deepseek-400` 12%，
   `transparent 26%`）、它下面大而柔的**月晕** `ellipse at 50% -6%`（同 token 20%，`transparent 70%`）、
   以及底部极弱的**反光** `ellipse at 50% 104%`（同 token 4%，`transparent 55%`），wash 用 `deepseek-400` 1%。
   核心画在月晕之上，两者叠加处更亮，于是读成「月亮本体 + 外圈光」。暗色**不用琥珀**：底部反光已经
   让下半屏不发死黑，而暖色正是浅色反馈要求收掉的东西。四层都在**同一条 `background`** 里，颜色全部来自
   `--dsw-static-*` token。
3. **行数预算 40 → 60**：暗色多一层（四层 vs 三层），仍是单表、根属性门控、无 `calc()`、无 `!important`、
   无通配；`glow: false` 同时抹掉两套地面（有测试逐字比对 0.1.1 那张表）。

**强度表**（JS 按字面百分比拼，浅/暗各自一套）：浅色 0/50/100/150/200 → 月晕 0/8/16/24/32、琥珀
0/1.5/3/4.5/6、wash 0/0.75/1.5/2.25/3；暗色 → 月晕 0/10/20/30/40、核心 0/6/12/18/24、反光 0/2/4/6/8、
wash 0/0.5/1/1.5/2。

**M4：光晕色相（5 档，浅色与深色共用一个选择）**：`glowHue` 是第四个 volatile 字段，
默认 `accent`——它就是 0.1.2 已批准的那一对（浅 `deepseek-500` / 暗 `deepseek-400`），所以
加控件**不改变任何一个像素**，用户自己切。每一项给**每个方案各一个 token** 加一个 alpha 乘数：
乘数与 `glowStrength` 相乘后再在 JS 里格式化成字面百分比（`accentSoft` @100% = 8.96%，
@50% = 4.48%，取两位小数）。

| 值 | 按钮文案 | 浅色 token | 暗色 token | 乘数 |
|---|---|---|---|---|
| `accent`（默认） | 强调 · 浅 | `--dsw-static-deepseek-500` | `--dsw-static-deepseek-400` | 1 |
| `accentDark` | 强调 · 深 | `--dsw-static-deepseek-400` | `--dsw-static-deepseek-400` | 1 |
| `accentSoft` | 柔和 · 浅 | 同 `accent` | 同 `accent` | **0.56** |
| `accentSoftDark` | 柔和 · 深 | 同 `accentDark` | 同 `accentDark` | **0.75** |
| `nightBlue` | 夜空蓝 | `var(--dsh-moonset-night)` = `#2563EB` | `var(--dsh-moonset-night)` = `#60A5FA` | 1 |

暗色的三层（核心 / 月晕 / 反光）与 wash 一起换成所选 token，保持「**单色相多层**」；浅色只换
月晕与 wash，**右下角琥珀恒 3% 不受色相影响**（它是另一个角色，不是另一种色相）。

**`nightBlue` 为什么自带一个字面色（M5，§11.3 第五类）**：这张 228 键表里没有任何一处能当
「夜空蓝」用——`--dsw-static-blue-500` = `#4F46E5`（浅）/ `#818CF8`（暗）、`blue-600` =
`#413BB9` / `#6B74CE`，**全是靛**（官方阶梯被本调色板重新映射过）；`deepseek-*` 就是强调色
本身；`violet-400` 更紫；`sky` / `cyan` 家族在表里根本不存在。所以皮肤层自己带一个锚点：

```css
html[data-moonset-skin] { --dsh-moonset-night: #2563EB; }
html[data-moonset-skin] body[data-ds-dark-theme] { --dsh-moonset-night: #60A5FA; }
```

这是**整张皮肤表里唯一的两个字面色**，且**只被 `nightBlue` 消费**：两处声明之外，规则里出现
的任何颜色都必须是 token（`tests/skin.spec.ts` 的白名单断言：整张表恰好两个 `#` 字面量，
而且梯度里不许直接写它们）。锚点放在可关闭的地面段里，所以 `glow: false` 会连同它一起消失。
行数 47 → 55（两条 3 行的声明 + 2 行注释 + 空白），仍 ≤60。

**底部白带（M2 修）**：用户报 C 模式底部有一条亮带。定位到宿主在会话列底部画的遮罩带：
`ConversationRoot.module.css` 的 `.root[data-phase='active'] .composerSeat` 用
`linear-gradient(180deg, color-mix(bg-base 0%, transparent) 0px, bg-base 36px)` 把转写
淡出到 `bg-base`；地面透出来后它就成了横跨会话列的浅色带。承载它的元素正是
`ui-conversation` 渲染的 `className={…composerSeat}` + `data-composer-seat`（安装态
`dsh-client-ui-conversation/lib/client.js` 同一行内两个属性），所以能用稳定属性命中；
**只清它的 `background-image`**（band 本身是 image，`background-color` 清不掉它；而
`background` 简写会连色/阴影一起抹掉）。输入卡、正文、卡片一律不碰。

**地面可见性（0.1.2 M1.5，第三条的另一半）**：M1 把光晕画在 `body` 上，但真机「完全看不到」——因为宿主把 `--dsw-alias-bg-base` 画在它上面三层。安装态 0.2.2-rc.5 的 DOM 链（从 bundle 读出，不是按类名推测）：

```text
body
 > #root                    ← 壳的 React 容器（web-frontend bundle 里的 getElementById('root')）
 > div[data-slot='root']    ← display:contents，RootOutlet 的锚点
 > div.frame                ← background: bg-base（Windows 下是 sidebar-fill）
 > div.centerCol            ← [data-windows-titlebar] 下是 bg-base
 > div.mainPanel            ← 无背景
 > div[data-slot='main']    ← display:contents，SlotOutlet 的锚点
 > div.root                 ← background: bg-base，会话根
```

`html` 与 `#root` 都**没有**背景（宿主样式表零命中，也没有内联写入），所以 `body` 的背景会传播到画布、地面确实在画——只是被上面这些承载层盖住。规则只写 **`background-color: transparent`**（不是 `background` 简写：宿主可能在同一元素上放了 image 或阴影，简写会一并抹掉），且不碰任何布局属性。

**范围是用户拍板的「方案 C 全透」**：不只会话列。判据一条——**只清「铺满一列或一屏」的承载层，不清「包住一小块内容」的容器**。下表就是 C 模式下面面透的清单（也是「哪些面会透」的验收口径）：

选择器**不数层级**。锚点由**渲染器**发出：`dsh-client-ui-renderer/lib/client.js` 里 `SlotOutlet` 渲染 `{"data-slot": slotKey}`、`RootOutlet` 渲染 `{"data-slot": 'root'}`，两者都带 `ANCHOR_STYLE = { display: 'contents' }`；而 `ui-layout` 只调用 `renderSlot('main', …)`——**在 layout bundle 里 grep `data-slot` 是零命中，这不能证明 DOM 里没有**（M1.5 首版正是这么误判过一次，见 §八 证据日志）。两个 `display:contents` 锚点意味着深度是渲染器细节，随时可能多或少于一层包装，所以用**包含关系**取祖先：

| 面 | 宿主现在由谁画 | 清它的选择器 |
|---|---|---|
| 外壳 `.frame`、三列 `.sidebarCol` / `.centerCol` / `.rightbarCol`、主面板 `.mainPanel` | `bg-base`（Windows 下 `.frame` 是 `sidebar-fill`、`.centerCol` 是 `bg-base`；darwin 下 `.centerCol` / `.rightbarCol` 是 `bg-base`） | `:has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])` —— 包含任一外壳槽锚点的都是承载层 |
| 会话列（`.root` 及其容器） | `bg-base` | `:has([data-composer-seat])` + `[data-slot='main'] > div` |
| 侧栏 | `.sidebarCol` 与 `SidebarRoot` 的 `.root` **各画一层** `--dsw-specific-sidebar-fill` | 前者由外壳选择器覆盖，后者由 `[data-slot='sidebar'] > div` 清 |
| 底部栏 `.bottomRow` | `bg-base` | `:has(> [data-slot='shell.bottom'])`（该槽锚点是它的直接子节点） |
| 全局面板页（设置 / 插件 / 任务） | 面板 page 根画 `bg-base` | `[data-slot='main'] > div`；`[data-global-panel]` 只在面板打开时存在，不是稳定拼写，故不用它定位 |
| **不清**（内容面） | 卡片、消息气泡、代码块、输入卡、右栏内的终端/文件树等 pane、菜单弹层（menu 挂在 `body` 上，根本不在 `#root` 里） | — |

后代永远不可能是自己祖先的祖先，所以 `:has()` 那几条永远不会命中卡片、消息或代码块；两条 `> div` 只取锚点的**直接子节点**（承载根），也不再往下数层级。

**选中项文字色这一条的前因**：0.1.1 首验把选中行底色换成淡紫之后，文字仍是墨色
（宿主用 `--dsw-alias-label-primary` 写在选中容器上），观感是「紫底黑字」。任务列表、
设置项、插件页 tab 这类**文字**颜色不属于任何 `--dsw-*` 座位，只能用属性钩子补。

钩子只认**稳定属性**（ARIA / `data-*`），绝不碰按构建哈希的类名。逐个场景核对过安装态
源码：

| 场景 | 钩子（宿主源码） | 取值 |
|---|---|---|
| 会话列表行 / 搜索结果行 | `rows/Rows.tsx` 的 `role="treeitem" aria-selected={selected}` | `'true'` |
| 设置侧栏 | `SettingsRoot.tsx` 的 `aria-current={row.id === active ? 'true' : undefined}` | `'true'` |
| 主侧栏面板切换 | `SidebarRoot.tsx` 的 `aria-current={active ? 'page' : undefined}` | `'page'` |
| 插件页 tab | `PluginsSettingsSection.tsx` 的 `aria-selected={selected}` + `data-active={selected ? 'true' : undefined}` | `'true'` |
| 插件页 tab 下划线 | 宿主 `.tab[data-active='true']::after`（2px 墨条），用同一个 `data-active` 钩子重染 | `'true'` |
| 自动化任务页 filter chip | `TaskManagerPage.tsx` 的 `aria-pressed={statusFilter === value}` | `'true'` |
| 自动化任务页 detail tab | `TaskDetail.tsx` 的 `aria-selected={tab === value}` | `'true'`（宿主本来就是业务强调色） |

**「按下」也算选中**：自动化任务页的 filter chip 用的是 `aria-pressed`（不是
`aria-selected`），这类按钮在本 UI 里就是「选中 chip」，所以并入同一个门控块；代价是同一条
规则也会染到按下的 like/dislike 按钮——语义一致，接受。

**下划线也必须跟着走**：插件页 tab 的选中指示是宿主画的 2px 墨条
（`.tab[data-active='true']::after`），只染字会留下「紫字 + 墨条」，所以追加一条
`[data-active='true']::after { background: accent }`。选择器**没有**收窄到
`[role='tab']`：全量核对过安装态里 5 个产出 `data-active` 的组件，只有插件页 tab 在
`data-active` 元素上画 `::after`（重试行的小箭头是 `summary::after`，badge 与
反馈按钮没有 `::after`），所以宽选择器在实践中是精确的，也避免把规则写死在某一个
`role` 上。

**剩下一处没有稳定钩子**：自动化任务页的选中行只有 `aria-expanded`
（`TaskManagerPage.tsx`）+ `.selectedRow`。「展开」不是「选中」，且
`aria-expanded` 会命中所有菜单触发器/折叠区，副作用大于收益，因此**不纳入**白名单；
真机若要它变紫，需要宿主给 `data-selected` 之类的专用钩子（记 backlog）。

两个实现细节解释了这条规则为什么长这样：

1. **根属性门控不是装饰，是特异性**。`html body [data-active='true']` 是 (0,1,2)，输给
   宿主的 `.tab[data-active='true']`（0,2,0）——首验现实就是插件页 tab 的墨字压不下去；
   加上自家的 `html[data-moonset-skin]` 之后是 (0,2,2)，b 平、c 更大，赢。其余两处宿主
   规则是 (0,1,0)（`.sessionRow` / `.navCell` 的 `color`），本来也赢。全程没有
   `!important`。
2. **只染容器，不用 `*` 通配子树**。选中行的弱化信息（时间戳 `.meta`、搜索摘要
   `.searchResultSnippet`、自动化行的 `.rowSummary`）各自写了 `label-tertiary/caption`，
   继承被子规则覆盖，所以只有主标签变紫；加 `> *` 反而会把它们一起染紫，因此不需要。

对比度（紫字压在选中行的淡紫底上，底色 = `--dsw-alias-interactive-bg-hover` 叠
`bg-base`）：浅 **6.45:1** / 暗 **5.58:1**，均过 AA 4.5:1；`tests/skin.spec.ts` 用
调色板重算这一对。

**与 token 的分工**：选中 / 激活座位的**底色与描边**走 **token**，不进白名单——
它们是生成器 `TOKEN_OVERRIDES` 的**七个**条目（主座位是
`--dsw-alias-interactive-bg-hover` / `-active`，都是
`color-mix(in srgb, var(--dsw-static-deepseek-500) N%, var(--dsw-alias-bg-base))`，
见 §3；逐条的改前/改后值与命中分布见
[palette.md §2.1](palette.md#21-011-的七处-token-覆盖选中与激活座位)）。**文字色**没有
token 座位，才落在本白名单的第二条。两者不重叠：token 负责「底」，CSS 负责「字」。

### 11.4 禁止什么（写进来就是回退）

- **改布局**：`display` / `position` / `grid` / `flex` / 尺寸 / `margin` /
  `padding` / `overflow` 一律不许；
- **碰宿主 DOM 结构**：不增删宿主节点、不注入 `html.style` / `body.style`、不用
  结构性选择器「修」宿主组件；允许的 DOM 写只有两笔——根上摘挂一个属性、head 里
  增删一张表（`unmount` 之后零残留）。**唯一例外**是 §11.3 第四类「地面可见性」：
  结构性选择器只允许出现在那一条里，只允许用 `#root` 与 `[data-slot]` /
  `[data-composer-seat]` 定位（可直接取槽锚点的父/子一层，但不再往下数层级），
  只允许写 `background-color: transparent`（唯二例外是 M2 的底部遮罩带：允许一条
  `background-image: none`，因为它本身就是 image），范围止于「铺满一列或一屏」的
  承载层，并且随 `glow: false` 一并消失；借它改结构、尺寸或位置仍然是回退；
- **加常驻 JS**：不装 scroll / resize / rAF / observer 做视觉（P1）；
- **堆第二张表**：要扩就改 `skinCss()`，两处声明就是两份真相（P2）；
- **写死颜色**：白名单里的每个颜色必须由 `var(--dsw-*)` 混出，否则跟随/主题切换会掉队
  （P5）。**唯一例外**是 §11.3 第五类「色相锚点」的 `--dsh-moonset-night`：它只能出现在
  那两条声明里（浅 `#2563EB` / 暗 `#60A5FA`），只能被 `nightBlue` 以 `var()` 读取，地方一律
  不许出现 `#` 开头的字面颜色（有白名单断言钉住）；

### 11.5 新增一条白名单项的门槛

1. 先证明 token 做不到（贴出「为什么没有对应 `--dsw-*`」的证据，例如那 9 张表的检索结果）；
2. 全表 ≤ 40 行（0.1.2 起；单条新增仍 ≤ 20 行）、单选择器、无 `!important`、无 `@media`；
3. 颜色只从 token 混出；
4. 在 §11.3 的表里登记「类 + 形状 + 版本」；
5. `tests/skin.spec.ts` 同步：逐字断言 + 预算断言（行数 / 无布局属性 / 无字面色 / token 清单）。

**证据**：`src/client/skin.ts`、`tests/skin.spec.ts`（51 条：挂载、单例、逐字 CSS、
预算、装饰/地面色取自 token、地面双光斑与强度内联、可见性三条选择器与包含式祖先、
开关整条消失、卸载零残留、重复挂载、无 document 静默、`apply()` 挂载与 fiber teardown 卸载）；
`src/client/index.ts` 的
`moonset: skin sheet` effect；
生成器的 `TOKEN_OVERRIDES`（选中行 token 侧）；安装态 0.2.2-rc.5 的 9 张主题样式表
`::selection` 0 命中。
