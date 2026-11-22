# 与 catppuccin 的兼容性：事实记录

**结论一句话：两者可以同时安装，但同一时刻只让一方掌权。切到另一方的主题前，
先把这一方关掉。**

这不是我们的偏好，是 catppuccin 的既有行为（它对第三方主题 id 会主动回弹），
0.1.0 既不改它也不对抗它，只把事实记下来，免得用户以为插件坏了。

关联文档：[架构](architecture.md)（我们的 adopt/再断言机制） ·
[backlog](backlog-v0.2.md) · [计划已决 #13](plans/v0.1.0.md)。

## 1. 可以同时安装（结构性共存）

`scripts/coexist-check.mjs` 把**两个真实构建产物**装进同一个假宿主（共享 theme 注册表、
slots、locale、configForms、effect，并且**真会抛错**：重复注册抛
`theme "…" is already registered`、未注册 id 的 `setTheme` 抛 `… is not registered`、
重复槽位抛 `… already has an entry`），跑注册、切换、卸载。6 条检查：

| # | 检查 | 结果 |
|---|---|---|
| 1 | 双产物 apply 后注册表恰好 6 个插件 id（4 × `catppuccin-*` + 2 × `moonset-*`） | PASS |
| 2 | 两边各自再 apply 一次：不抛、注册表仍是 6（tolerant 生效） | PASS |
| 3 | 6 个主题逐个 `setTheme`，`preference` 跟随且每次触发 `theme/change` | PASS |
| 4 | 跟随层互不误删（我方 source `dsh-moonset` 228 条，它方 `@nonamelego/dsh-catppuccin` 201 条） | PASS |
| 5 | 只卸载 moonset → 注册表剩 4 个 catppuccin，它的层仍在 | PASS |
| 6 | 两边 require 集合只含 `react*` / `@deepseek-ai/*` | PASS |

**实测（2026-11-22 本轮复跑）**：

- 对**实装 0.7.5 产物**（`~/.dsh/profiles/desktop/node_modules/@nonamelego/dsh-catppuccin/lib/client.js`，
  290,532 B，sha256 `393A63F5801E979F7431925459BF0F8F5E2777C795ED7E2715A436E015C19A81`）：
  6/6 PASS，exit 0。
- 对参考仓库工作树产物（0.7.6-beta.0）：同样 6/6 PASS。

假宿主还记录了两条旁证：`document.body.dataset.dshGlass` 为 `undefined`、html/body 上
没有任何 `data-dsh-glass*` 属性（我们从不写这类全局钩子）；`setTheme` 期间两边
DOM 写 0 条。

## 2. 互斥掌权：它会回弹第三方 id

源码位置（参考仓库 `dsh-catppuccin-theme`，行号为工作树 `0.7.6-beta.0`）：

| 位置 | 内容 |
|---|---|
| `src/client/index.ts:463-469` | `builtinPickWins(preference, livePick)`：只有「本次会话里用户显式挑的 `light`/`dark`」才获胜；`system` 永不获胜，别处 adopt 来的值（`livePick` 为 null）也不获胜 |
| `src/client/index.ts:951-972` | 它**包装** `theme.setTheme`（`restoreGuardSetTheme`），只有外部调用才记录 `liveBuiltinPick`；自己的恢复走 `commitTheme(id, false)`，不记为用户行为 |
| `src/client/index.ts:1035-1064` | `scheduleRestore(desired)`：在 `queueMicrotask` 里再检查一次 `builtinPickWins`，然后 `setTheme` 回它自己的风味 |
| `src/client/index.ts:1343-1349` | 卸载时只在 `theme.setTheme` 仍是它自己的包装时才还原（R1） |

行为链条：存着 `catppuccin-mocha` 时调 `setTheme('moonset-dark')` →

1. 同步生效（内存偏好变 `moonset-dark`，界面立刻是月落暗色）；
2. 一次 `theme/change` 到达它的 `applyDesired`；
3. `builtinPickWins('moonset-dark', …)` 为 false（第三方 id 不是内置值，永远不获胜）；
4. `scheduleRestore('catppuccin-mocha')` 在微任务里把偏好改回 `catppuccin-mocha`。

我们的 M5.2 再断言与它互不冲突、但也互不救场：它回弹的是它自己存的风味，
我们回弹的是我们存的主题，两个插件同时掌权就会互相拉锯。

**实测（同一次 coexist 运行的「观测」节，原文保留）**：
存了 `catppuccin-mocha` 时 `setTheme("moonset-dark")`：同步 `moonset-dark` →
settle 后 `catppuccin-mocha`。这条**不计入**上面 6 条检查，是单列出来的现场证据。

## 3. 它惰性注册：别用「注册表里有几条」当验收

`src/client/index.ts:520-559`（源码注释自称 item JJ）：

- 只有**当前风味**会被 `registerThemeFor` 注册；选别的风味时由
  `ensureThemeRegistered` 按需注册。
- 新装完、没选过风味时，它的注册表里可能有 **0 条**。

后果：任何「Appearance 里应该列出 6 项」「registry 应该有 4 条 catppuccin」的验收口径
都不成立。0.1.0 的 M7 检查因此改成「经它自己的设置行逐个选中 4 个风味后，
注册表恰好 6 个插件 id」，而真机验收的指标也换成了「`preference` 3 秒后仍等于所选值」
（计划已决 #14）。

## 4. 它会包装 `theme.setTheme`

同一个 fiber 里 `theme.setTheme = restoreGuardSetTheme`（`:951-972`）。两个 fiber
会链式包装；卸载时按身份还原（`:1343-1349`），不会把别人的包装也拆了。

对我们的实际影响：

- 功能上没问题，我们的 `setTheme` 只是穿过它的一层，能落到 runtime；
- 读调用栈时会看到它的函数名，排错时别误判成「我们的调用被吃了」；
- 它包装里还会清掉它自己的 pre-paint 表，这是它的事，不是我们的。

## 5. 同装时的层叠与清晰度边界

- 两边都只写 `--dsw-*` 别名层；我们不写 `--dsh-*`、不挂任何 `data-` 全局钩子
  （唯一的属性是我们自己那张首帧 `<style data-dsh-moonset-boot>`，撤表时删掉）。
- 同时生效时「谁的 `--dsw-*` 赢」由内联样式的插入顺序决定；0.1.0 **只做功能验证**，
  没做像素级 A/B。真机上应当只保留一方掌权，这条限制也就不会浮现。

## 6. 版本与 profile 事实

- `~/.dsh/profiles/desktop/package.json`：`@nonamelego/dsh-catppuccin: "0.7.5"`（精确版本，
  在 `bundles` 里），这就是用户实际在用的桌面壳；同一 profile 里
  `dsh-moonset-theme: "link:plugins/dsh-moonset-theme"`，且它在 `bundles` 末位。
- `~/.dsh/profiles/web/package.json` 声明 `^0.6.0`、实装 0.7.0，且该 profile 当前
  不服务任何界面——**不能**拿它当「用户环境」的证据。
- M7.1 真机自验时用户已把 catppuccin 以 `disabled: true` 关掉，只让 moonset 掌权。
  该 profile 被桌面壳独占（`dsh` CLI 会硬拒 `--profile desktop`），无法脚本化起停。

## 7. 怎么自己复核

```powershell
# 用实装的 0.7.5 产物复核（路径按本机实际情况替换）
node scripts/coexist-check.mjs --catppuccin "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@nonamelego\dsh-catppuccin\lib\client.js"
# 期望：6/6 PASS，exit 0
```

`--catppuccin` 缺省会找同级目录 `../dsh-catppuccin-theme/lib/client.js`；两个产物都必须
是**已构建**的（先各自 `pnpm build`），否则脚本会按「产物不存在」exit 2 退出。
