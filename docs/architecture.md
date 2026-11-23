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

所有注册都挂在 `ctx.effect`（或 `ctx.inject` 的 fiber）上，卸载即释放：两个主题注册、字典、choice effect
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
pnpm test                                # 105 passed / 7 files
node scripts/coexist-check.mjs           # 与 catppuccin 假宿主共存，6/6 PASS
```

`extract` 的 `meta.extractedAt` 每次重写都会让文件变脏，跑完审计要还原（M2 的记录债）。
`generate-palettes` 是幂等的：`tests/palettes.spec.ts` 直接用 `renderModule(buildPalettes())`
与已提交文件逐字比较，所以「不写盘也能证明可复现」。
