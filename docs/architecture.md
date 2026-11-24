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
| 材质根属性（0.1.4） | `html[data-moonset-glass]` | 第二个布尔属性，**独立门控材质**：关玻璃时它不挂，材质那两条规则就成了死文本（不是第二张表，P2）；皮肤本体照旧 |
| 行内自定义属性（0.1.4） | `html` 的 `--dsh-moonset-glass-blur` | 全插件**唯一**一处行内 style 写入：材质模糊半径（0–30px，默认 12）。表里只写 `var()`，所以滑块走的是「改一个值」，不是「重解析一张表」 |
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

### 11.3 白名单：允许的九类

| 类 | 形状 | 为什么 token 做不到 | 版本 |
|---|---|---|---|
| **选区** | `html body ::selection` | UA 伪元素，无 token 座位 | 0.1.1 |
| **选中项文字色** | 稳定属性钩子上的 `color`（见下表） | 宿主把选中容器的文字色直接写成 `--dsw-alias-label-primary`，值内联在规则里，**不能从一个 token 重新指向** | 0.1.1 |
| **地面渐变** | `html[data-moonset-skin] body { background: … }`（浅色三层）+ `… body[data-ds-dark-theme] { background: … }`（暗色四层，同一靛蓝色相） | 多层图层 + 视口固定 + 两套方案，单 token 装不下 | 0.1.2 / M3 |
| **地面可见性**（M2 起三档可调 + 底部遮罩带） | `#root :has([data-slot='main'], [data-slot='sidebar'], [data-slot='rightbar'])` / `:has([data-composer-seat])` / `:has(> [data-slot='shell.bottom'])` / `[data-slot='main'] > div` / `[data-slot='sidebar'] > div` 上的 `background-color: transparent`；外加 `#root [data-composer-seat] { background-image: none }`（底部遮罩带） | 宿主把 `--dsw-alias-bg-base`（侧栏是 `--dsw-specific-sidebar-fill`）画在外壳链、三列与每个面板页根上，地面在它们**下面**；这些面没有稳定属性（类名按构建哈希，`data-global-panel` 只在面板打开时存在），只能靠结构 + 渲染器锚点。底部那条遮罩带更是 **image**（不是颜色），token 和 `background-color` 都改不到 | 0.1.2 M1.5 / M2 |
| **色相锚点** | `html[data-moonset-skin] { --dsh-moonset-night: #2563EB }` + 暗色 `body[data-ds-dark-theme]` 覆盖为 `#60A5FA`；只有 `night` 色相读它 | 228 键表里**没有可用的蓝**：`blue-500` = `#4F46E5`/`#818CF8`、`blue-600` = `#413BB9`/`#6B74CE` 全是靛，`deepseek-*` 就是强调色本身，`violet-400` 更紫，`sky`/`cyan` 家族根本不存在 | 0.1.2 M5 |
| **轨迹步骤行**（按类型分色） | 两条格子规则 `html[data-moonset-skin] body [data-variant][data-state] :has(+ [data-shimmer-decoration])`（工具名）与 `… [data-shimmer-decoration] + *`（参数/路径），读行上发布的两个自定义属性 `--dsh-moonset-step-name/-args`；四条类声明 `… [data-variant='bash' \| 'read' \| 'write' \| 'edit' \| 'search' \| 'think'] { … }`；失败规则 `… [data-state='error']`（两格 + `~ [data-tone]` 胶囊，写在最后） | 步骤行的**工具名**与**参数/路径**两个格子都只有按构建哈希的 CSS Module 类名，没有 `data-*`；但行根有 `[data-variant][data-state]`（工具行还有 `[data-tool]`）、名字与参数之间那颗 `·` 有 `[data-shimmer-decoration]`、退出码胶囊是 `Tag` 的 `[data-tone]`。两格只能**相对那颗点**定位；「每类一个色相」又要**两套方案都成立**，所以色相用 `color-mix(family, label token)` 交给方案自适应，再由行上的自定义属性把「类 → 两格」接起来 | 0.1.3 M2b |
| **材质面**（0.1.4 M1 输入卡 / M2 顶栏 / M3 header / M4 header 悬浮；**侧栏 M6 起不做**） | 三面**共用一份材质**（`background: color-mix(bg-base 62%)` + `backdrop-filter: blur(var(--dsh-moonset-glass-blur)) saturate(1.15)` + `inset 0 1px 0` 近白高光），只换选择器：① `[data-composer-card]`（输入卡，宿主稳定属性，`InputBar.tsx:462`）；② `#root [data-slot='conversation.header'] > header`（会话 header：header 槽锚点 `display:contents`，其子元素就是 `ConversationHeader` 的 `<header>`，`ConversationHeader.tsx:18` / `ConversationMainPanel.tsx:39`；用槽键锚点而不是 `[data-window-drag]`，因为侧栏也有两行带这个拖动标记）；③ `html[data-windows-titlebar] … #root [data-slot='root'] > div::before`（Windows 标题条）。①② 用 `position: relative` / `isolation: isolate` / `background: transparent` 清底并托管 `::before` 平面（`content` / `position: absolute` / `inset: 0` / `z-index: -1` / `border-radius: inherit` / `pointer-events: none`）；③ 是**叶子平面**（本就无内容），材质直接画在它身上，几何全留宿主。header 额外在**平面上**画一条 `inset 0 -1px 0 var(--dsw-alias-border-l3)` 底边（宿主那条 0.5px `border-bottom` 一条字都不写、原样保留）。**侧栏自 2026-11-24 起不做材质**（用户决定「侧栏先不做玻璃材质了」）：材质段不再出现 `data-slot='sidebar'`，侧栏恢复宿主原样、由 `--dsw-specific-sidebar-fill` 自己画；M4 那档 tinted 底色随之一并删除。整表唯一的侧栏提及是 0.1.2 起的 **C 档地面规则**（`all` 这个「全透明」比较模式，非材质，默认 `main` 不碰侧栏）。 | P6：材质必须画在**背靠内容**的平面上——容器本体若也画，`backdrop-filter` 只会糊到自己；而「该有内容的平面却压在内容之下」则只透不糊。**面背后是什么**：输入卡与 header 背后都是正文（header 自 M4 起**悬浮**），顶栏背后是地面。**M5 的教训**：悬浮那条规则一度写成 `[data-phase='active'] #root …`，而 `#root` 是相位元素的**祖先**，真机上一字未匹配——header 没有 `z-index`、正文盖住它（点击失效、只透不糊、滑块无效），现由结构守卫测试锁住（任何选择器里 `#root` 必须在相位门之前）。**实测**：少了 `z-index:-1` 时平面按定位层绘制、盖在 in-flow 正文之上（M1，Chromium）；header 带右半段玻璃开时出现低至 19/255 的糊字像素、关玻璃最暗 223/255（M5）；侧栏两种配方的开/关均值差 浅 Δ5.4 / 暗 Δ7.6（共享材质）与 暗 Δ11.7（M4 tinted，已随 M6 移除）。 | 0.1.4 M1…M6 |
| **0.1.5 三处色彩条目**（回合改动卡 / `上下文注入` 行 / 浅色失败红） | ① 卡片：`html[data-moonset-skin] body [data-changed-files] { background-color: var(--dsw-alias-bg-module-platform); border-color: var(--dsw-alias-border-l2); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); --changes-fill: var(--dsw-alias-bg-module-platform) }`；② 上下文行：`… body [data-disclosure-row]:has([data-context-source], [data-context-summary]) { color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500)) }`（行色随继承落到 title，正文与两格旁注各写自己的色）；③ 浅色失败红：`… body:not([data-ds-dark-theme]) { --dsh-moonset-error: color-mix(… error-primary 70%, label-primary) }`，失败行那一格以宿主 token 作 fallback 读它 | ① 卡片的底与 60px header 的底是**两条**宿主规则里的字面 token（`ChangedFiles.module.css:2`：`background: var(--dsw-alias-bg-layer-1)` + `--changes-fill: var(--dsw-alias-card-fill)`），228 键表里没有「卡片底」这一格可以改指向，只能在卡片自己的属性钩子上重指。**R1 的教训**：第一版用 `bg-layer-2`，而浅色表里它**就是画布 token**（`bluish-00` = `#FAFAFC` = 页面），加上 `--changes-fill` 被一起改掉、宿主那条灰色 header 也没了，卡片在浅色下**整张消失**（fixture 实测 卡/页 1.000:1）；现在用 `bg-module-platform`（= 12% accent 叠在画布上，随方案翻转）作底、header 同层，并用 `border-l2` + 同 token 的 1px inset 环把边描出来：实测 卡/页 浅 1.214 / 暗 1.169、标题 14.65 / 13.52、文件行 5.04 / 5.84（都过 AA）；② `上下文注入` 行走的是 `DisclosureRow`，行根**没有** `[data-variant][data-state]`（`ContextInjectionRow.tsx:51`），0.1.3 那两条格子规则够不到；它唯一稳定的钩子是折叠内容上的 `data-context-source` / `data-context-summary`，而 title 是 TextShimmer 的 `color: inherit`，所以只能「钩行 → 继承给 title」；③ 失败色是**每条失败行同一格**，浅色下 `state-error-primary` = `#B31B3E` 过艳，而调色板里更浅的红（`red-400` `#E95F7E` = 3.14:1）与任何「向画布混」的 82% 混合（画布 4.78:1 但**胶囊底只有 3.94:1**）都过不了 D2，只有「向墨色混」既降彩度又保 AA（9.43 / 7.77），而它必须**只**在浅色生效（暗色保持 0.1.4 原色），所以是一条 `:not([data-ds-dark-theme])` 门 | 0.1.5 / R1 |
| **0.1.5 M2 回合导航轨**（回退成宿主形态 + 颜色渐变） | 四条规则，**只上色不上几何**：`… [data-conversation-scroll] nav[aria-label] { --dsh-moonset-rail-accent: …; background: linear-gradient(to bottom, color-mix(rail-accent 65%, transparent), color-mix(amber-500 65%, transparent)) no-repeat right 9px center / 2px 100% }`（轨道），`body[data-ds-dark-theme] … { --dsh-moonset-rail-accent: deepseek-400 }`（暗色换档），`… [data-index]::before { background: var(--dsh-moonset-rail-accent) }`（所有刻度 = accent），`… [data-index][aria-current='true']::before { background: var(--dsw-static-amber-500) }`（当前项 = 琥珀） | 宿主那根轨道本来就是**每回合一根 20×2px 的横刻度**（`.mark::before`，右对齐、10px 一档、按状态 `scaleX`），配色全写在按构建哈希的类规则里；状态只有 `aria-current` / `aria-busy` / `aria-describedby` 三个属性可稳定选中，**行根是 <nav aria-label>**（`TurnNavigator.tsx:233-235`），滚动容器里只有它一个 nav。**用户真机否掉了第一版的圆点形态**（「改回原来的形式，加上颜色渐变就可以了」），所以现在只换上色：轨道 = 一层 `2px × 100%` 的线性渐变（靛→琥珀），刻度 = accent，当前刻度 = 琥珀；刻度自己的 `scaleX`/`opacity` 状态全部保留。**真·沿轨道渐变不行**：`[data-index]` 的取值集是开集（虚拟化索引），纯 CSS 要逐 index 写规则，或用 canvas——所以退到「accent + 琥珀」两色。零几何改动（`position` / 尺寸 / `margin` / `padding` / `transform` 一个不写，测试逐条钉住；fixture 里 nav 与 9 根刻度的矩形两遍逐项相同）。 | 0.1.5 M2 |

当前登记（0.1.2 + M1.5…M6 + 0.1.3 M2b + 0.1.4 M1…M6 + 0.1.5 G1…G4 + R1 + M2 导航轨，全表三十条规则，169 行 / C 档 171 行）：

```css
/* dsh-moonset[0.1.4]: skin — P5 whitelist (selection, item text, ground, step
   rows, material) */
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
/* 0.1.3 M2: a step row reads as a terminal line, and each KIND of step carries
   its own hue (shell green, file blue-violet, search amber, reasoning violet;
   code and unknown tools keep the accent). Host hooks: [data-variant] on the
   row, [data-shimmer-decoration] the dot before the arguments. */
html[data-moonset-skin] body [data-variant][data-state] :has(+ [data-shimmer-decoration]) {
  color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500));
  font-family: var(--ds-font-family-code);
}
html[data-moonset-skin] body [data-variant][data-state] [data-shimmer-decoration] + * {
  color: var(--dsh-moonset-step-args, var(--dsw-alias-label-secondary));
  font-family: var(--ds-font-family-code);
}
html[data-moonset-skin] body [data-variant='bash'] {
  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-green-500) 65%, var(--dsw-alias-label-primary));
  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-green-500) 25%, var(--dsw-alias-label-secondary));
}
html[data-moonset-skin] body [data-variant='read'],
html[data-moonset-skin] body [data-variant='write'],
html[data-moonset-skin] body [data-variant='edit'] {
  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-deepseek-400) 65%, var(--dsw-alias-label-primary));
  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-deepseek-400) 25%, var(--dsw-alias-label-secondary));
}
html[data-moonset-skin] body [data-variant='search'] {
  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-amber-600) 65%, var(--dsw-alias-label-primary));
  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-amber-600) 25%, var(--dsw-alias-label-secondary));
}
html[data-moonset-skin] body [data-variant='think'] {
  --dsh-moonset-step-name: color-mix(in srgb, var(--dsw-static-violet-400) 65%, var(--dsw-alias-label-primary));
  --dsh-moonset-step-args: color-mix(in srgb, var(--dsw-static-violet-400) 25%, var(--dsw-alias-label-secondary));
}
/* failed step (exit != 0 / signal): the class hue loses to the error colour. */
html[data-moonset-skin] body [data-variant][data-state='error'] :has(+ [data-shimmer-decoration]),
html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] + *,
html[data-moonset-skin] body [data-variant][data-state='error'] [data-shimmer-decoration] ~ [data-tone] {
  color: var(--dsh-moonset-error, var(--dsw-alias-state-error-primary));
}
/* 0.1.2 hue anchor (M5): the 228-key table carries no usable blue, so the
   skin owns exactly ONE literal colour, read by the `night` hue. */
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
    radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--dsw-static-deepseek-500) 8.06%, transparent) 0%, transparent 62%),
    radial-gradient(ellipse at 97% 97%, color-mix(in srgb, var(--dsw-static-amber-500) 2.7%, transparent) 0%, transparent 46%),
    linear-gradient(165deg, color-mix(in srgb, var(--dsw-static-deepseek-500) 0.76%, transparent) 0%, transparent 70%) var(--dsw-alias-bg-base);
}
/* 0.1.2 ground (dark): ONE indigo hue at three footprints (core, halo,
   bottom reflection) plus a thinner wash — depth without a second colour. */
html[data-moonset-skin] body[data-ds-dark-theme] {
  background:
    radial-gradient(circle at 34% 2%, color-mix(in srgb, var(--dsh-moonset-night) 12%, transparent) 0%, transparent 26%),
    radial-gradient(ellipse at 50% -6%, color-mix(in srgb, var(--dsh-moonset-night) 20%, transparent) 0%, transparent 70%),
    radial-gradient(ellipse at 50% 104%, color-mix(in srgb, var(--dsh-moonset-night) 4%, transparent) 0%, transparent 55%),
    linear-gradient(160deg, color-mix(in srgb, var(--dsh-moonset-night) 1%, transparent) 0%, transparent 75%) var(--dsw-alias-bg-base);
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
/* 0.1.4 glass (M1 card, M2 top bar, M3 header; the sidebar left in M6): ONE
   material on three planes. P6: the face paints nothing and the material sits
   on its ::before, so the blur samples what is BEHIND the face; z-index -1
   plus isolation keeps it behind the face content. The top bar is the Windows
   caption strip, which is already the frame ::before. */
html[data-moonset-skin][data-moonset-glass] [data-composer-card]::before,
html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header::before {
  content: ''; position: absolute; inset: 0; z-index: -1;
  border-radius: inherit; pointer-events: none;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
  backdrop-filter: blur(var(--dsh-moonset-glass-blur)) saturate(1.15);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent);
}
/* M3: the header keeps the host 0.5px border-bottom and adds the material
   edge on the plane (a line under a 62% plane would be muted away). */
html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header::before {
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent), inset 0 -1px 0 var(--dsw-alias-border-l3);
}
html[data-windows-titlebar][data-moonset-skin][data-moonset-glass] #root [data-slot='root'] > div::before {
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
  backdrop-filter: blur(var(--dsh-moonset-glass-blur)) saturate(1.15);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 10%, transparent);
}
html[data-moonset-skin][data-moonset-glass] [data-composer-card],
html[data-moonset-skin][data-moonset-glass] #root [data-slot='conversation.header'] > header {
  position: relative; isolation: isolate; background: transparent;
}
/* M4: the header FLOATS over the transcript (the Catppuccin recipe): the
   scroll body slides up behind the glass and its padding starts the content
   below it, so messages scroll UNDER the header and stay visibly blurred
   instead of hard-clipping. --dsh-moonset-header-h is MEASURED by JS
   (bounded retries) into html.style; 76px is the host min-height fallback.
   z-index 8 clears the in-scroller chrome (banner 6, compaction + rail 7)
   and stays under the composer seat (9). */
html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-slot='conversation.header'] > header {
  z-index: 8;
}
html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-conversation-scroll] {
  position: relative; z-index: 0;
  margin-top: calc(-1 * var(--dsh-moonset-header-h, 76px));
  padding-top: calc(var(--dsh-moonset-header-h, 76px) + 12px);
}
/* M5/0.1.5 G1: the banner pins below the header. Chromium resolves a sticky
   offset against the scroller's CONTENT box, so the float's padding (header-h
   + 12) rides along: `top: H` landed at header-bottom + 12 + H (measured 88px
   at H=76). Give the 12px air back — `top: -12px` — and the gap is 0. */
html[data-moonset-skin][data-moonset-glass] [data-phase='active'] [data-conversation-scroll] :has(> [data-code-block-banner]) {
  top: -12px;
}
/* 0.1.5 G2/G3/G4: three colour-only entries — the turn-changes card, the
   context-injection row and the LIGHT failure red. No layout property. */
html[data-moonset-skin] body [data-changed-files] {
  background-color: var(--dsw-alias-bg-module-platform); border-color: var(--dsw-alias-border-l2);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); --changes-fill: var(--dsw-alias-bg-module-platform);
}
html[data-moonset-skin] body [data-disclosure-row]:has([data-context-source], [data-context-summary]) {
  color: var(--dsh-moonset-step-name, var(--dsw-static-deepseek-500));
}
html[data-moonset-skin] body:not([data-ds-dark-theme]) {
  --dsh-moonset-error: color-mix(in srgb, var(--dsw-alias-state-error-primary) 70%, var(--dsw-alias-label-primary));
}
/* 0.1.5 M2: the turn rail keeps the HOST ladder (20x2px ticks, 10px pitch)
   and gains the COLOUR: one hairline track (indigo -> amber) behind the ticks,
   the ticks in the accent, the CURRENT turn in amber. PAINT ONLY. */
html[data-moonset-skin] [data-conversation-scroll] nav[aria-label] {
  --dsh-moonset-rail-accent: var(--dsw-static-deepseek-500);
  background: linear-gradient(to bottom, color-mix(in srgb, var(--dsh-moonset-rail-accent) 65%, transparent), color-mix(in srgb, var(--dsw-static-amber-500) 65%, transparent)) no-repeat right 9px center / 2px 100%;
}
html[data-moonset-skin] body[data-ds-dark-theme] [data-conversation-scroll] nav[aria-label] {
  --dsh-moonset-rail-accent: var(--dsw-static-deepseek-400);
}
html[data-moonset-skin] [data-conversation-scroll] nav[aria-label] [data-index]::before {
  background: var(--dsh-moonset-rail-accent);
}
html[data-moonset-skin] [data-conversation-scroll] nav[aria-label] [data-index][aria-current='true']::before {
  background: var(--dsw-static-amber-500);
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

**轨迹步骤行（0.1.3 M2b，第六条）**：消息流里的工作步骤行（`代码 · …` / `思考 · …` /
`读取 · path` / `运行命令 · … • 退出码 1` / `搜索文件内容 · …`）在安装态由**四个**实现渲染，
但它们发布同一组稳定钩子（源码证据见 §11.7）：行根 `[data-variant][data-state]`
（`ToolRow.tsx:460` / `bash-sample.tsx:97-108` / `ReasoningRow.tsx:87-93` /
`GenericCommandCard.tsx:55`）、名字与参数之间那颗 `·` 是 `[data-shimmer-decoration]`、退出码
胶囊是 `Tag` 的 `[data-tone]`。工具名与参数格子**自身没有稳定属性**（只有哈希类名），所以
规则相对那颗点定位：`:has(+ [data-shimmer-decoration])` 是名字，`+ *` 是参数。表里唯一的
通配选择器就是那个 `+ *`——单个兄弟位置，不是「整棵子树扫一遍」；展开后的正文是
`[data-disclosure-row]` 的**兄弟**，天然在规则之外，正文 `p` / `pre` / `code` 根本不在步骤行里。

**按类型分色**是这一版的重点。色相不写在格子规则里，而是由**类声明块**发布到行上：
`--dsh-moonset-step-name` 与 `-args` 各一支，两条格子规则读它们（`var(…, 兜底)`），所以
「加一类」是加一个声明块，不是加两条格子规则。`data-variant` 是**闭集**（`ToolRowVariant`
七值 + 聊天行的 `think`），`code` 与 `others` 不声明色相、落到格子规则的兜底值——那也正是
**未知 `data-tool`** 的颜色，因为 `classifyTool()` 一定把它归到某个 variant。

| 类 | `data-variant` | 家族 token | 名字（浅/暗） | 参数（浅/暗） | 对比度 名字 / 参数 | 名字↔参数 色差（浅/暗） |
|---|---|---|---|---|---|---|
| 运行命令 | `bash` | `--dsw-static-green-500` | `#09684E` / `#73DBB8` | `#345C5D` / `#92BDBB` | 6.48 / 11.32 · 7.09 / 9.20 | **46.7 / 43.1** |
| 读取·写入·编辑 | `read` `write` `edit` | `--dsw-static-deepseek-400` | `#555197` / `#B2B9F6` | `#515379` / `#AAB0D3` | 6.71 / 10.03 · 7.02 / 8.86 | **30.2 / 37.4** |
| 搜索 | `search` | `--dsw-static-amber-600` | `#764611` / `#D8B969` | `#5E4F46` / `#B9B09D` | 7.61 / 9.93 · 7.53 / 8.76 | **58.7 / 60.5** |
| 思考 | `think` | `--dsw-static-violet-400` | `#6366A8` / `#A2A5F2` | `#565B80` / `#A4A8D1` | 5.06 / 8.25 · 6.27 / 8.19 | **43.9 / 33.2** |
| 代码·其它·未知 | `code` `others` | 兜底：`--dsw-static-deepseek-500` / `label-secondary` | `#4338CA` / `#818CF8` | `#434959` / `#B1B6C6` | 7.58 / 6.33 · 8.62 / 9.32 | 114.3 / 81.0 |
| 失败 | 任意 + `data-state='error'` | `--dsw-alias-state-error-primary` | `#B31B3E` / `#F9889A` | 同 | 6.41 / 8.10（胶囊底上 5.28 / 6.93） | — |

每支色相都是 `color-mix(in srgb, <家族> N%, <label token>)`：label token 随方案翻转，所以
**一条声明同时成立两套方案**（浅色往墨色压暗、暗色往浅色提亮），与 §11.6 的 G1 同一条判据。
名字取 65%、参数取 **25%**：40% 时真机反馈「参数和工具名一样绿」（`files`/浅色只有 14.3 个
sRGB 单位），25% 之后每类名字↔参数至少差 **30.2** 个单位、参数仍保留≥15.5 个单位的色相（不是
纯灰）。失败规则写在段末，色相输了、错误色赢，而且**只上色不加粗**（首版的 500 字重被真机
否掉，全表不再写 `font-weight`）。等宽用主题层
`base.css` 在 `:root` 上定义的 `--ds-font-family-code`（宿主自己的 diff 合计也读它），这是
本表第一个**非 `--dsw-`** 的 token 引用（字体不是颜色，P5 的颜色判据不适用）。用户截图里的
六种行有五种命中（`代码` / `读取` / `搜索文件内容` / `运行命令` / `思考`）；`上下文注入` 那一行
连行状态都没有，见 §11.7 缺口 3。**调色板限制**：228 键表里没有 `sky` / `cyan` 家族，
`blue-*` 又整体重映射到靛蓝梯度，所以「文件蓝」只能用 `deepseek-400`（与强调色的 500 同族、
差一档亮度）；真正拉得开色相的只有绿 / 琥珀 / 紫三支。

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

**强度在 JS 里算，CSS 只收字面百分比**：`glowAlphas(strength, hue)` / `darkGlowAlphas(strength, hue)`
把 100% 那一行乘上系数（强度 × 色相乘数）再格式化成 `24%` / `2.25%` 这样的字面百分比，所以表里
永远没有 `calc()`、也没有「藏在中间 custom property 里」的值（0.1.2 D2 的教训）。开关关闭时整段
（两套地面 + 清理 + 底部遮罩 + 锚点）一起消失，仍是 0.1.1 那张 19 行的表。

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

**M6：深/浅两套光晕（当前形态）**。真机最终结论：**浅色 = 柔和 @ 90%**、**深色 = 夜空蓝 @ 100%**。
用户在同一套色相的两个方案之间看不出区别，所以色相与强度都拆成浅/深各一个 volatile 字段：

| 字段 | 取值 | 默认 |
|---|---|---|
| `glowHueLight` | `accent` / `soft` / `night` | **`soft`** |
| `glowStrengthLight` | 0–200 | **90** |
| `glowHueDark` | `accent` / `soft` / `night` | **`night`** |
| `glowStrengthDark` | 0–200 | **100** |

**三档色相**（M4 的五档删掉两档：`accentDark` / `accentSoftDark` 在两个方案里像素级重复，
用户判为冗余）：

| 值 | 按钮文案 | 浅色 token | 暗色 token | alpha 乘数 |
|---|---|---|---|---|
| `accent` | 强调 | `--dsw-static-deepseek-500` | `--dsw-static-deepseek-400` | 1 |
| `soft` | 柔和 | 同 `accent` | 同 `accent` | **0.56** |
| `night` | 夜空蓝 | `var(--dsh-moonset-night)` = `#2563EB` | `var(--dsh-moonset-night)` = `#60A5FA` | 1 |

**渲染规则**：浅色地面 = `glowHueLight × glowStrengthLight`（100% 基准：月晕 16%（M3 起）、wash 1.5%、
琥珀 3%）；深色地面 = `glowHueDark × glowStrengthDark`（100% 基准：月核 12 / 月晕 20 / 底部反光 4 /
wash 1）。两套**完全独立**：动其中一套的任何一个旋钮，另一套的规则文本一个字都不变（有测试逐字
比对）。琥珀只出现在浅色、只随 `glowStrengthLight` 缩放；色相乘数只作用于色相层（浅色月晕 + wash、
暗色三层 + wash）。设置区是两行分组（浅色光晕 / 深色光晕），每组三个色相按钮 + 一个 0–200 的滑块
（step 10，右侧百分比）。行数仍是 55（只换 token 名与 alpha 字面量）。

**`night` 为什么自带一个字面色（M5，§11.3 第五类）**：这张 228 键表里没有任何一处能当
「夜空蓝」用——`--dsw-static-blue-500` = `#4F46E5`（浅）/ `#818CF8`（暗）、`blue-600` =
`#413BB9` / `#6B74CE`，**全是靛**（官方阶梯被本调色板重新映射过）；`deepseek-*` 就是强调色
本身；`violet-400` 更紫；`sky` / `cyan` 家族在表里根本不存在。所以皮肤层自己带一个锚点：

```css
html[data-moonset-skin] { --dsh-moonset-night: #2563EB; }
html[data-moonset-skin] body[data-ds-dark-theme] { --dsh-moonset-night: #60A5FA; }
```

这是**整张皮肤表里唯一的两个字面色**，且**只被 `night` 消费**：两处声明之外，规则里出现的任何
颜色都必须是 token（`tests/skin.spec.ts` 的白名单断言：整张表恰好两个 `#` 字面量，梯度里不许
直接写它们）。锚点放在可关闭的地面段里，所以 `glow: false` 会连同它一起消失。

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
  `padding` / `overflow` 一律不许。**唯一例外**是 §11.3 第七类「材质面」的两条：
  `position: relative`（`::before` 的定位宿主，宿主自己本来也是 `position: relative`，
  写它只是不让配方依赖宿主）与 `inset: 0`（平面满铺）。两者都在材质那一段里被逐条列举，
  `tests/skin.spec.ts` 的预算断言要求材质段之外仍然零布局属性，材质段内也只允许这两条；
- **碰宿主 DOM 结构**：不增删宿主节点、不写宿主的布局/颜色行内样式、不用
  结构性选择器「修」宿主组件；允许的 DOM 写只有三笔——根上摘挂**两个**布尔属性
  （`data-moonset-skin` / `data-moonset-glass`）、`<html>` 上写**一个**自定义属性
  （`--dsh-moonset-glass-blur`，0.1.4）、head 里增删一张表（`unmount` 之后零残留）。
  **只有两处例外**：
  ① §11.3 第四类「地面可见性」：结构性选择器只允许出现在那一条里，只允许用 `#root` 与
  `[data-slot]` / `[data-composer-seat]` 定位（可直接取槽锚点的父/子一层，但不再往下数层级），
  只允许写 `background-color: transparent`（唯二例外是 M2 的底部遮罩带：允许一条
  `background-image: none`，因为它本身就是 image），范围止于「铺满一列或一屏」的
  承载层，并且随 `glow: false` 一并消失；
  ② §11.3 第六类「轨迹步骤行」：只允许主选择器上的「相对那颗点」的三种位置写法
  （`:has(+ [data-shimmer-decoration])` / `[data-shimmer-decoration] + *` /
  `~ [data-tone]`）与按 `[data-variant='…']` 的**类声明块**；格子规则只允许写 `color` /
  `font-family`（**不写字重**：首版的 `font-weight: 500` 被真机否掉），类声明块只允许写 `--dsh-moonset-step-name` /
  `--dsh-moonset-step-args` 两个自定义属性（值必须由 `color-mix()` 从 token 混出），
  不得在选择器里出现 `p` / `pre` / `code` 或 `[data-disclosure-row]`（展开正文是它的兄弟），
  也不得再往下数层级；
  ③ §11.3 第八类「0.1.5 三处色彩条目」：只允许 `background-color` / `border-color` /
  `color` / 一个自定义属性，**零布局属性**（那一段仍受预算断言的全零约束）。卡片那条只写
  `background-color`、不写 `background` 简写（宿主的圆角与 `overflow` 原样保留），且
  `--changes-fill` **只在这张卡上**重指，不写全局 `bg-layer` 覆盖（D3）；上下文行那条借的结构
  止于两个稳定属性 + 一条 `:has()`（不写类选择器、不数层级、不碰展开正文——正文是行根的同级兄弟），
  色值读第六类那同一个 `--dsh-moonset-step-name`；浅色失败红只是一条 `body:not([data-ds-dark-theme])`
  门里的一个自定义属性，失败格仍只有一条 `color`；
  ④ §11.3 第九类「0.1.5 M2 回合导航轨」：**只允许外观**——`background`（含它自带的
  `position`/`size`/`repeat` 子值，那是画的位置与大小，不是盒子的）、
  `border`、`border-radius`、`box-shadow`、`opacity`、`color`，
  以及自定义属性；`position` / `inset` / `top` / `right` / `left` /
  `width` / `height` / `margin` / `padding` / `display` /
  `flex` / `grid` / `overflow` / `transform` / `contain` /
  `z-index` 一个都不许写（0.1.4 已经为「改布局」付过一次代价）。**宿主形态必须保留**：
  第一版把刻度换成圆点（清掉 `.mark::before`、在按钮上画径向渐变），真机被否；现在只允许改
  刻度自己的 `background`（经 `::before` 上色），刻度的 `scaleX`/`opacity` 状态转换一行不碰。
  这条是四条例外里唯一 **纯装饰** 的：它不改任何宿主面的位置与尺寸，只换画法；
  这些例外只借结构、或只换画法；借它改结构、尺寸或位置仍然是回退；
- **加常驻 JS**：不装 scroll / resize / rAF / observer 做视觉（P1）；
- **堆第二张表**：要扩就改 `skinCss()`，两处声明就是两份真相（P2）；
- **写死颜色**：白名单里的每个颜色必须由 `var(--dsw-*)` 混出，否则跟随/主题切换会掉队
  （P5）。**唯一例外**是 §11.3 第五类「色相锚点」的 `--dsh-moonset-night`：它只能出现在
  那两条声明里（浅 `#2563EB` / 暗 `#60A5FA`），只能被 `nightBlue` 以 `var()` 读取，地方一律
  不许出现 `#` 开头的字面颜色（有白名单断言钉住）；

### 11.5 新增一条白名单项的门槛

1. 先证明 token 做不到（贴出「为什么没有对应 `--dsw-*`」的证据，例如那 9 张表的检索结果）；
2. 全表 ≤ **172** 行（0.1.5 M2 定稿起；M2 第一版曾抬到 175、实测 171，回退掉圆点后 **169 / C 档 171**；0.1.5 前 155、实测 152 / C 档 154；0.1.4 M6 时 141、M5 时 151、M4 时 143、M3 时 127、M2 时 114、M1 时 115、0.1.3 M2b 时 95、M2 首版 75、0.1.2 时 60、0.1.1 时 40；**单条新增仍 ≤ 20 行**——导航轨定稿 16 行）、无
   `!important`、无 `@media`、无 `@supports`；
3. 颜色只从 token 混出（字体例外：字体不是颜色，允许读主题层的 `--ds-*`，见第六类）；
4. 在 §11.3 的表里登记「类 + 形状 + 版本」；
5. `tests/skin.spec.ts` 同步：逐字断言 + 预算断言（行数 / 无布局属性 / 无字面色 / token 清单）。

**证据**：`src/client/skin.ts`、`tests/skin.spec.ts`（103 条：挂载、单例、逐字 CSS、
预算、装饰/地面色取自 token、地面双光斑与强度内联、可见性三条选择器与包含式祖先、
开关整条消失、卸载零残留、重复挂载、无 document 静默、`apply()` 挂载与 fiber teardown 卸载；
0.1.3 M2 增 6 条：两格规则逐字、失败行逐字、不出步骤行、等宽只读 `--ds-font-family-code`、
三个角色在两套方案下均过 AA、成功侧无落点（把这条缺口也钉成断言）；
0.1.4 M1 增 8 条：材质段逐字 + 稳定属性 `[data-composer-card]` 而非数层级、
卡片只清底色且平面在 `z-index:-1` 之后、底与高光全部来自 token（高光是
`--dsw-static-neutral-bluish-00` 10%，两套方案都 ≥ #C8 近白）、半径走行内属性所以任何
半径的字节相同、脏半径归一到 0–30、关掉材质**只**掉材质那两条、挂载/改值/关闭/卸载
四态的门控与行内属性、`off` 选择把材质随表一起摘掉；
0.1.4 M6 改 2 条：hooks 用例改为「材质段不出现 `data-slot='sidebar'`」、方案拆分用例改为
「侧栏完全不在材质里」并钉住整表唯一那处侧栏提及属于 C 档地面（默认 `main` 不碰侧栏）；
0.1.4 M5 增 1 条（其 banner 断言的正文 0.1.5 再改）：M4 的选择器反写（`#root` 出现在相位门之后）
被结构守卫挡住；代码块 banner 那条从「写死 header 高」改成「写浮层空气的负值」，并把空气量**从
padding 公式里解析出来**再断言 `top` = −空气，公式一改就红；
0.1.5 增 4 条：卡片的三个声明 + 「层 token 只出现在这张卡里」（D3）+ 两套方案下两个 token 都在；
上下文行的两个钩子 + 只染行不染格 + 失败态优先级不变；浅色失败红的逐字混合 + 两套方案 × 两个面
（画布 / 胶囊）的 AA 复算（含「更浅的红为什么不行」的反证）；三处条目在四种开关组合下字节相同且零布局；
0.1.5 M2 增 5 条（R2 回退后改 2 条、其余保留）：轨道钩子是 `nav[aria-label]` + `[data-index]`（且全表只出现
这四处 `nav`）、渐变只由 `rail-accent` 与 `amber-500` 混出且层几何 `right 9px / 2px 100%` 的
中心 10px 正好是宿主刻度（`right:0; width:20px`）的中心、**宿主刻度保留并被上色**（`[data-index]::before` =
accent，`[aria-current]::before` = 琥珀，`scaleX` 状态不碰）、浅 `deepseek-500` / 暗 `deepseek-400`
换档且两套方案都过 3:1 非文本对比、**逐条断言该段只用外观属性**、四种开关组合字节相同且不吃
`[data-moonset-glass]`；
0.1.5 R1 增 1 条并改 1 条：卡片的底**不能等于画布 token**、必须是 accent 叠画布的 `color-mix`、两套方案
下 卡/页 ≥ 1.15:1、标题与文件行都过 4.5:1、header 与卡同层（不再有灰色 band）、边是 border-l2 + 1px
inset 环——这一条就是「卡片消失」的回归守卫；
0.1.4 M4 增 5 条：悬浮两条只剩两项声明且 padding = |margin| + 12（公式自洽）、header 只写
`z-index` 一条、实测高度写/重写/零高度的拒绝、四次有界重试读到即停且卸载取消、
关玻璃与卸载把 `--dsh-moonset-header-h` 一起清掉；
0.1.4 M3 增 4 条：header 进共享平面 + 只清底色且**一字不写 border**、header 底边画在
平面上并复用共享高光与 `border-l3`、侧栏自成一档底色（只 1 条声明、不动 blur 与高光）、
四面共用同一个模糊变量（两处发射、值集合只有 1）；
0.1.4 M2 增 4 条：顶栏**必须**挂在 `html[data-windows-titlebar]`、且那条规则只写材质
（`inset`/`position`/`content`/`height` 一条不许出现，否则条会盖满整帧）、三面材质
**逐字相同**（从表里解析回来比较，不重写一份）、每面只借一个稳定钩子且 `>` 最多一跳、
`backdrop-filter` 只准出现在叶子平面上（恰好两处，且都带 `::before` 与 `[data-moonset-glass]`））；
`src/client/index.ts` 的
`moonset: skin sheet` effect；
生成器的 `TOKEN_OVERRIDES`（选中行 token 侧）；安装态 0.2.2-rc.5 的 9 张主题样式表
`::selection` 0 命中。

### 11.6 0.1.3 M1 的两条边界（记录，不是新白名单）

M1 的两处文字修复都不扩白名单，但各留下一条「为什么」和一条「改不到」，记在这里，
免得下一个里程碑重新推一遍。

**G1：active 按钮的底与字走 token，不进本表。** 设置区是我们自己的组件，选中态写在
`src/client/settings-section.tsx` 的内联样式里，所以底 / 描边 / 字三件都由 `--dsw-*`
表达（四处共用同一个 `ACTIVE_BUTTON_STYLE`：主题三按钮、地面范围三按钮、两组色相各一个、
再加环境光晕开关，一次改动覆盖全部 active 座位）。这里同时也是 §11.3 第一类的**反向
证据**：0.1.2 的 active 底用了 `--dsw-alias-brand-primary`，而它是本调色板的**墨色**——
浅 `var(--dsw-static-neutral-bluish-1000)` = `#10131C`、暗 `var(--dsw-static-neutral-bluish-50)`
= `#E8EBF2`（`src/client/palettes.ts:75` / `:307`），字是 `--dsw-alias-label-on-color`
（`#FAFAFC` / `#EEF0F7`，两边都近白），暗色实测 **1.05:1**，就是用户看到的「白底白字」
（浅色 17.8:1，反而掩盖了问题）。改法取 accent 阶梯里**还能压住深色字**的那一档：

| active 底 / 字 | 浅色 | 暗色 | 结论 |
|---|---|---|---|
| `-600` / `label-on-color`（白） | 9.47:1 | 3.68:1 | 暗色不过 AA |
| `-500` / `label-on-color` | 7.58:1 | 2.62:1 | 暗色不过 AA |
| **`-400` / `neutral-bluish-1000`** | **4.63:1** | **8.07:1** | 过 AA，0.1.3 采用 |

两个字色细节值得记住：中性阶梯的 00→1000 方向**两套方案一致**（生成器 class A），所以
`neutral-bluish-1000` 浅 `#10131C` / 暗 `#08090E`，**两边都是深色**；而所有 `label-*`
别名都跟着方案翻转，拿它当强调底上的字就会重新变成白字。底取 `-400` 同理：accent 阶梯
在暗色整体更亮（`-500` 是 `#818CF8`），只有 400 这一档还能让深字过 AA。这对 token 在
官方表下也成立（`#7AAAFF` on `#0F1115` = 8.12:1），所以换官方主题不掉队；
`tests/live.spec.ts` 从 `MOONSET_LIGHT` / `MOONSET_DARK` 重算全部数字，改调色板就红。

**G2：选中会话行的时间戳没有稳定钩子，CSS 改不到，记为宿主缺口。** 行标题能变紫，是因为
行容器本身带 `aria-selected`——那是 §11.3 第二类的合法钩子；时间戳则不行。安装态
0.2.2-rc.5 的 `@deepseek-ai/dsh-client-ui-workspace` 源码里它是：

```
src/client/rows/Rows.tsx:736   <span className={css.rowResting}>
src/client/rows/Rows.tsx:738     <span className={clsx(css.time, primaryStatus.trailingLabel === undefined && css.timestamp)}
                                    aria-hidden={primaryStatus.trailingLabel === undefined ? undefined : true}>
```

——`<span>`，不是 `<time>`（整个 `lib/client.js` 里 `datetime` **0 命中**），没有 `data-*`、
没有 `title`，类名是按构建哈希的 CSS Module；而 `.time`（`Rows.module.css:238`，`color`
在第 242 行）与 `.rowResting`（301 行，`color` 在第 306 行）各写了一次
`var(--dsw-alias-label-tertiary)`，行容器上的继承被这两条一起挡住。按 P5 / §11.4，
`[class*=time]` 与数层级的结构选择器都不许写，所以 0.1.3 只做 G1；等宿主给出
`<time datetime>` 或 `data-*` 钩子，G2 也只是本表第二类的一条 `color`，不需要新白名单类。

### 11.7 0.1.3 M2 的钩子证据与两条缺口

**四个实现，同一组钩子**（安装态 0.2.2-rc.5；源码随包发布在 `app.asar` 里，行号即包内行号）：

| 行 | 行根 | 名字/参数之间的点 | 退出胶囊 |
|---|---|---|---|
| 通用工具行 `ToolRow` | `div[data-variant][data-tool][data-state]`（`dsh-client-ui-tool/src/client/tool/components/ToolRow.tsx:460`） | `span.sep[data-shimmer-decoration]`（同文件 `:262`） | `ExitCodeBadge` 的 `Tag`（`:320`；`components/ExitCodeBadge.tsx:12`） |
| 运行命令 `BashRow` | `div[data-sample='bash'][data-variant='bash'][data-state]`（`toolviews/bash-sample.tsx:97-108`） | `span.sep[data-shimmer-decoration]`（`:113`） | 同文件 `:121` |
| 思考 `ReasoningRow` | `div[data-variant='think'][data-state]`（`dsh-client-ui-chat/src/client/chat/ReasoningRow.tsx:87-93`） | `span.separator[data-shimmer-decoration]`（`:70`） | 无 |
| 通用命令 `GenericCommandCard` | `div[data-variant='others'][data-state]`（同目录 `GenericCommandCard.tsx:55`） | `span.separator[data-shimmer-decoration]`（`:45`） | 无 |

`[data-variant][data-state]` 只出现在这四个行根上：88 个 `lib/client.js` 全文检索里
`data-variant` 只命中 tool / chat / attachment 三包，而 attachment 的图片按钮没有
`data-state`。所以这个组合既是作用域，也是「这是一条步骤行」的判据。

**`data-variant` 的全集（闭集，八个）**：`search` / `read` / `bash` / `write` / `edit` /
`code` / `others`（`tool-call-model.ts:17` 的 `ToolRowVariant`）+ `think`
（`ReasoningRow.tsx:89`）。`data-tool` 则是**开集**——它是原始工具名，插件 / MCP 工具随时能
加值——但 `classifyTool()`（同文件 `:135`）一定把它折到上面八个之一：`bash` "bash"、
`pwsh` "bash"、`read` "read"、`read_image` "read"、`web_fetch` "read"、
`cordis_*_inspect` "read"、`web_search` / `grep` / `glob` "search"、`write` "write"、
`edit` / `apply_patch` "edit"、`run_code` "code"、其余 "others"（含全部 keyed toolview 工具：
`create_goal` / `schedule_*` / `session_*` / `subagent*` / `job_*` / `terminal_*` /
`team_task_*` / `ask_user_question` / `todo_write` / `office_*` 与任何未知名）。所以兜底不需要
枚举：`code` / `others` 不声明色相，落格子规则的兜底值就是「未知工具」的颜色。

`data-tool` 本身也可以用来细分（例如 `grep` 与 `glob` 都归 `search`，两者 UI 名分别是
「搜索文件内容」/「查找文件」），但**颜色按类而不是按工具**：类只有八个、跨版本稳定，
而 `data-tool` 会随插件增长。

**缺口 1：工具名与参数格子没有自己的钩子。** 两者都由 primitives 的 `DisclosureRow` 渲染
成 `TextShimmer` 根 `span`，只带按构建哈希的 CSS Module 类名——没有 `data-*`、没有
`title`、没有 `<time>`。唯一稳定的是名字与参数之间那颗点，所以规则用相对位置
（`:has(+ …)` / `+ *`）。代价：summary 为空的工具行（`ToolRow.tsx:258` 在
`summaryText !== ''` 时才渲染那颗点）匹配不到名字规则，那一行的名字停在行色
（`label-tertiary`）。这是「相对定位」的已知边界。

**缺口 2：成功 / 退出码 0 没有可染的元素。** `terminalExitLabel()` 只在
`terminalFailed()` 为真时返回标签（`dsh-client-ui-tool/src/client/tool/models/terminal-card-model.ts:96-112`），
而 `ExitCodeBadge` 的 `Tag` **永远**是 `tone="neutral"`（`components/ExitCodeBadge.tsx:12`）——
退出码 0 根本不渲染胶囊；唯一的成功信号是行根上的 `[data-state='ok']`，把它染绿等于把
整条轨迹的每条成功步骤都染绿。另外 `--dsw-alias-state-success-primary` 在浅色画布上只有
**3.61:1**（它是点/描边的 token，不是文字色）。因此 0.1.3 M2 **只做失败侧**：
`[data-state='error']` 的 summary 与 `[data-tone]` 胶囊取 `--dsw-alias-state-error-primary`
（只上色，不加粗）。等宿主给出「成功胶囊」或 `data-exit` / `data-status` 这类钩子，再补绿色
那一半（`tests/skin.spec.ts` 里那条「paints nothing for a successful exit」把缺口本身钉成断言）。

**缺口 3：`上下文注入` 那一行的行状态钩子。** 它走的是另一条路：`ContextInjectionRow`
（`dsh-client-ui-chat/src/client/chat/ContextInjectionRow.tsx:51-76`）直接渲染 `DisclosureRow`，
**没有** `[data-variant][data-state]` 行根，名字与参数之间那颗点也只有 `aria-hidden`（没有
`data-shimmer-decoration`），所以上面两条格子规则够不到它。0.1.3 因此不为它开规则。

**0.1.5 G3 把行色补上了，但没有并进第六类**：这一行唯一稳定的钩子是折叠内容上的
`data-context-source`（`:69`）与 `data-context-summary`（`:73`），而 title 是
`DisclosureRow` 里 TextShimmer 的 `color: inherit`（见 §11.8），所以做法是「钩到行 → 让 title
继承」，不需要去碰那两个只有哈希类名的格子；色相读的就是第六类发布的 `--dsh-moonset-step-name`，
兜底即强调色（= 未知工具的颜色），将来要给这一行单独一个色相，只是多一个声明块。
**残留缺口**：`toolBlocks` 那个变体（同一行渲染成「已添加工具 …」）的折叠内容**两个属性都没有**
（`ContextInjectionRow.tsx:58-62`：只有 `.sep` 与一个无属性的 `.summary`），所以那一种形态
仍然停在行默认色；等宿主给它一个行属性（或把 `data-context-summary` 补到那个分支）再收口。

### 11.8 0.1.5 三处反查证据与 G1 的落差公式

**G1：粘附参照是滚动容器的 CONTENT box。** 宿主把 banner 包装层写成
`position: sticky; top: 0; z-index: 6`（`._bannerWrap_kjs70_24{position:sticky;top:0;z-index:6}`，
从安装态前端 bundle `dsh-web-frontend/dist/assets/index-Ciz7DZxv.js` +
`index-CSAdOBx6.css` 读回；`CodeBlock.module.css` 本体不随包发布，这是它编译后的规则）。
0.1.4 的 `margin-top: -H` 把滚动体顶边抬到 header 顶，而 `padding-top: H + 12` 让它的
**content box** 落在 header 底下 12px，Chromium 又正是按 content box 定位 sticky——于是
`top: H` 的真实落点是 `header 底 + 12 + H`。headless Chromium fixture（复刻
header 76 + 浮层 + 宿主代码块，滚动到 banner 已粘住）实测：

| fixture 的 `top` | 空气 12px（0.1.4 的 padding） | 空气 0（对照） |
|---|---|---|
| `var(--dsh-moonset-header-h)`（0.1.4 发行版） | **88px** | 76px |
| `0` | 12px | **0px** |
| `calc(var(--dsh-moonset-header-h) - 12px)` | 76px | — |
| **`-12px`（0.1.5 采用）** | **0px** | — |

公式：`gap = 空气 + top`。H 在推导里**整项相消**（同一 fixture 把量到的 H 从 76 换成 96、
真实 header 仍是 76，`top: -12px` 依旧 0px），所以量错高度不会把 banner 挪走——0.1.4 那条缝
与 H 无关，它就是「空气 + H」里的 H。反过来，空气改成 0 后 `top: H` 仍留 76px：缝来自
padding 与 top 的叠加，不是来自 H。真机复核脚本见 `docs/probes/v0.1.5-banner-probe.js`。

**G2：卡片钩子（含 R1 回归）。** `ChangedFiles.tsx:69` 在卡片根上渲染 `data-changed-files`；宿主样式
`ChangedFiles.module.css:2`（与安装态 `dsh-client-ui-deliverables/lib/client.js` 里的
`.HOHHba_card{--changes-fill:var(--dsw-alias-card-fill);…;background:var(--dsw-alias-bg-layer-1)}`
逐字一致）。暗色下 `bg-layer-1` = `neutral-bluish-875`（近黑）、`card-fill` =
`neutral-850`（**中性灰**，就是「黑灰」的来源）——**但 0.1.5 第一版换成的 `bg-layer-2` 是错的**：
浅色表里 `bg-layer-2` = `bluish-00` = `#FAFAFC` = `--dsw-alias-bg-base`（同一个 token），
而 `--changes-fill` 又被一起改掉、宿主那条 60px 灰色 header 也没了，于是**卡片在浅色下整张消失**。
faithful fixture（宿主 CSS 逐条抄自 `ChangedFiles.module.css`，DOM 按 `ChangedFiles.tsx`，token 取
浅/暗两张表）量到：

| 方案 | 卡片底 | header 底 | 卡/页 对比 | 标题/卡 | 文件行/卡 |
|---|---|---|---|---|---|
| 浅 宿主 | `#FAFAFC` | `#F2F2F5` | 卡片 1.000 / header 1.072 | 17.80 | 6.11 |
| 浅 0.1.5 第一版 | `#FAFAFC` | `#FAFAFC` | **1.000 / 1.000** | 17.80 | 6.11 |
| **浅 R1** | **`#E4E3F6`** | 同层 | **1.214** | **14.65** | **5.04** |
| 暗 宿主 | `#1B1D26` | `#2B2E36` | 1.124 / **1.390** | 14.07 | 6.07 |
| 暗 0.1.5 第一版 | `#20222C` | `#20222C` | 1.192 / 1.192 | 13.27 | 5.72 |
| **暗 R1** | **`#1D2032`** | 同层 | **1.169** | **13.52** | **5.84** |

卡片的 `getBoundingClientRect()` 在「只有宿主」与「宿主 + 皮肤」两遍里**逐项相同**（`[178, 40, 620, 197]`、
header `618×60`），所以第 3 个猜测（规则把别的元素挤走）排除：卡片一直在，是**颜色**把它弄没了。
R1 的修法：底换成 `bg-module-platform`（= 12% accent 叠画布，随方案翻转的**靛族**面），header 与底同层
（`--changes-fill` 同 token），边沿用 `border-l2` 再加一圈同 token 的 `inset 0 0 0 1px` 环——
即使底色在暗色里只差 1.17，1.5px 宽的描边也把框显出来。

**G3：上下文行钩子。** 行根是 `DisclosureRow` 的 `[data-disclosure-row]`（无
`data-variant`），钩子只有折叠内容上的 `[data-context-source]`（`:69`）与
`[data-context-summary]`（`:73`）。发行表里 `._row_l4nv8_26` 自己写了
`color: var(--dsw-alias-label-tertiary)`（外加一条 hover 的 `label-secondary`），
title 外层 TextShimmer 的 `root/text` 则是 `color: inherit`——所以在行根上写一条
`color`（私有化后特指度 0,4,x 对 0,1,0 / 0,2,0）就能把 title 染色，而 `.source` /
`.summary` / `.chevron` 各自写 label 色、展开正文写自己的色，都不受影响。
残留缺口见 §11.7 缺口 3。

**G4：浅色失败红的实测数字**（浅/暗各两个面；D2 要求都 ≥ 4.5:1）：

| 方案 | 颜色 | 画布 `bg-base` | 退出胶囊 `bg-module-platform` |
|---|---|---|---|
| 浅 0.1.4 | `#B31B3E`（`red-600`） | 6.41:1 | 5.28:1 |
| **浅 0.1.5** | **`#821934`**（70% `red-600` + 30% `label-primary`） | **9.43:1** | **7.77:1** |
| 暗（不变） | `#F9889A`（`red-400`） | 8.10:1 | 6.93:1 |

**为什么不是「更浅的红」**：`red-400` 在浅色画布只有 3.14:1；向画布混到 82% 时画布 4.78:1，但
**胶囊底只有 3.94:1**（胶囊底 = 12% accent 叠在画布上，比画布更暗，亮字先在那里掉出 AA）。向墨色混
是唯一既降彩度又保住两个面 AA 的做法（对比反而抬到 2 倍 AA 有余）；暗色不声明该属性、走宿主 token
的 fallback，所以暗色的字节与 0.1.4 完全一致。

### 11.9 0.1.5 M2 回合导航轨：钩子、几何证明与缺口

**宿主（安装态 0.2.2-rc.5，源码在 `app.asar` 里；行号为包内行号）**

| 件 | 是什么 | 稳定钩子 |
|---|---|---|
| 轨道根 | `TurnNavigator.tsx:234-243`：`div.slot`（absolute/sticky，`height: 0`，`z-index: 7`）> `nav.frame`（`aria-label` = `chat.turnNavigation.label`，宽 28px、`translateY(-50%)`、`contain: layout`） | **`nav[aria-label]`**（语义标签 + 无障碍标签；会话滚动容器 `[data-conversation-scroll]` 内**只有它一个 nav**——header 的面包屑 nav 与侧栏 nav 都在滚动容器之外） |
| 每根刻度 | `TurnNavigator.tsx:61-71`：`button.mark`，`data-index`，由虚拟化器用行内 `transform: translateY(...)` 摆位 | **`[data-index]`** |
| 当前项 | 同上 + `aria-current='true'`（`:70`） | **`[aria-current='true']`** |
| 忙碌项 / 预览项 | `aria-busy='true'`（`:71`）/ `aria-describedby`（`:72`） | 已登记，本版未单独上色 |
| 刻度本体 | `TurnNavigator.module.css:97-109`：`.mark::before` = 20×2px 圆角横条，右对齐，按状态 `scaleX` / `opacity` | **无属性**（只有哈希类名）→ 用 `[data-index]::before` **只改 `background`**（形态与状态转换全留给宿主） |

**结论**：**不需要 `[class*=]` 例外**。轨道有语义 `<nav aria-label>`、刻度有 `data-index`、
当前项有 `aria-current`，三者都是宿主为无障碍/虚拟化写下的**契约属性**，与 0.1.3 的
`[data-variant]`、0.1.5 的 `[data-context-source]` 同一档。

**几何零改动（实测）**：headless Chromium fixture 复刻整条链（scrollport > slot > nav.frame > scroller >
marks > 9 根 `button[data-index]`，其中一根 `aria-current`；fixture 用真表的
`background` 画法，只有宿主 CSS 是照抄的），**同一页跑「只有宿主」与「宿主 + 皮肤表」两遍**，
量 `getBoundingClientRect()`：

| 量 | 只有宿主 | 宿主 + 皮肤 | 结论 |
|---|---|---|---|
| `nav.frame` | `[1106, 279, 28, 90]` | `[1106, 279, 28, 90]` | 同 |
| 9 根刻度的 9 个矩形 | 全部 `x/y/w/h` | 逐项相同 | 同 |
| `.mark::before` 盒子 | `20px × 2px`、`matrix(0.6,0,0,1,0,-1)`、宿主 `border-l4` | 同一盒子与同一变换，仅 `background` 换色（accent / 琥珀） | 同 |

浅/暗两套方案各跑一遍，两列数字**逐字节相同**。测试侧的同一条证明是
`tests/skin.spec.ts` 的「is paint-only」：该段每一条声明的属性名必须在
`{background, border, border-radius, box-shadow, opacity, color}` 或自定义属性里，且
`position / inset / top / right / left / width / height / margin / padding / display / flex /
grid / overflow / transform / contain / z-index` 一个都不能以 `名字:` 的形式出现；长度字面量
（`2px`、`7px`、`100%`）只能出现在 `background` 里——那是**画**的尺寸，不是盒子的。

**画法对齐**：轨道层 `right 9px / 2px 100%` → 中心在轨道框右缘内 10px；宿主刻度是
`right: 0; width: 20px` → 中心也是 10px。轨道正好穿过刻度中心，测试用算术钉住
（`9 + 2/2 = 20/2 = 10`）。**回退记录**：第一版把刻度换成 7×7 径向渐变圆点（清掉
`::before`、在按钮上画点），真机被否（「改回原来的形式，加上颜色渐变就可以了」），
定稿只保留上色；"逐 index 沿轨道渐变" 需要每个 `data-index` 一条规则（开集）或 canvas，
纯 CSS 表达不了，所以采用契约允许的退路——**所有刻度 = accent，当前项 = 琥珀**。

**缺口（一条，已随 R2 收窄）**：`.markUnloaded`（该回合的正文还没加载进来）**没有属性**——
`TurnNavigator.tsx:55-59` 只往 `className` 里塞 `css.markUnloaded`，没有 `data-*`。回退成宿主形态后，
「未加载」刻度仍然保留宿主自己的 `scaleX(0.4) + opacity .6`、只是颜色随 accent 走，所以这一档的
区分**没有丢**；若要再给它一个独立颜色（例如更淡的 accent），等宿主补一个 `data-unloaded` 之类的
属性即可，不需要新白名单类。

**命名偏差**：契约里写的 `--dsw-static-rose-500` / `--dsw-static-emerald-500` 在 228 键表里
**不存在**（`rose` / `emerald` 是 Tailwind 名，本平台只有 `red` / `green` 家族）。失败侧改用
宿主自己也在用的 `--dsw-alias-state-error-primary`（浅 `red-600` `#B31B3E` / 暗 `red-400`
`#F9889A`），它天生随方案翻转——与 §11.6 的 G1 同一条判据。
