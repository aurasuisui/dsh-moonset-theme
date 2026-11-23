# 调色板与 token 契约

这份文档说明：16 个源色锚点是什么、228 个 `--dsw-*` 键怎么从官方表变成月落色、
22 条对比度契约的**实测值**是多少、以及怎么重新生成并为结果复核。

所有数字都可以在仓库里重算；复核命令见 [§5](#5-生成器用法与复核)。
回到总览：[README](../README.md) · [文档索引](README.md) · [架构](architecture.md)。

## 1. 16 个源色锚点

唯一的人工可编辑色源是 [`themes/moonset-palette.json`](../themes/moonset-palette.json)
（两个方案 × 16 个角色，全部 `#RRGGBB`）。其它所有颜色都是生成器从这 16 个值推导的。

| 角色 | Light | Dark | 用途 |
|---|---|---|---|
| `canvas` | `#FAFAFC` | `#08090E` | 底色 / 画布 |
| `elevated` | `#FFFFFF` | `#10121B` | 卡片 / 面板 |
| `subtle` | `#F2F4F8` | `#151824` | 代码块 / 引用 |
| `inkPrimary` | `#10131C` | `#EEF0F7` | 正文 |
| `inkSecondary` | `#4A5166` | `#A1A8BE` | 次要文字 |
| `inkMuted` | `#70788F` | `#6F7791` | 弱化文字（**4.22 / 4.47**，映射到标签层时提亮） |
| `accent` | `#4338CA` | `#818CF8` | 主强调（indigo-700 / indigo-400） |
| `accentUi` | `#4F46E5` | `#818CF8` | UI 链接（indigo-600） |
| `accentGlow` | `#6366F1` | `#6366F1` | 光斑 / 光束 |
| `borderHairline` | `#0F172A` | `#FFFFFF` | 发丝线（只给色相，α 用官方字面量） |
| `borderStrong` | `#0F172A` | `#FFFFFF` | 强描边（同上） |
| `success` | `#059669` | `#34D399` | 成功（emerald-600 / 400） |
| `warning` | `#D97706` | `#FBBF24` | 警告（amber-600 / 400） |
| `danger` | `#E11D48` | `#FB7185` | 危险（rose-600 / 400） |
| `info` | `#0284C7` | `#38BDF8` | 信息（sky-600 / 400） |
| `moon` | `#F59E0B` | `#F59E0B` | 琥珀月光；`amber-500` 的锚点，0.1.2 起也是右下暖光的色相来源（M3 起只作浅色右下角点缀） |

两点容易误会：

- `borderHairline` / `borderStrong` 在源板里**只有色相**（浅色 `#0F172A`、深色
  `#FFFFFF`），透明度来自官方字面量的 α（0.04–0.24 一档，逐条沿用），所以最终
  `--dsw-alias-border-l1` 这类 token 是 `rgba(16, 19, 28, 0.04)` 而不是纯色。
- `moon` 不是一个独立 token 族：它被钉在 `--dsw-static-amber-500` 上，因为官方
  自己也把 amber-500 用在月光/警告的共享位置上。它和官方同值 `#F59E0B` 属于
  **A 类锚点恰好同色**，不是 B3 回落（见 §2 的判定）。

0.1.2 的地面光晕不新增色源：靛蓝月晕混自 `--dsw-static-deepseek-500`（= `accent`），
右下琥珀暖光混自 `--dsw-static-amber-500`（= `moon`），两者都以固定百分比与
`transparent` 混出。**M3 起琥珀只是点缀**（16% : 3%，且椭圆收到右下角 46%），
**暗色则只用一种靛蓝**：三层同色 `--dsw-static-deepseek-400`（深一档）加一条更薄的 wash，
不再引入紫罗兰或琥珀——层次靠半径/位置/α 做，不靠加色相。**M4 起色相可选**（5 档：
`accent` / `accentDark` / `accentSoft` / `accentSoftDark` / `nightBlue`）：浅色换月晕与 wash、
暗色换三层 + wash，琥珀恒 3% 不跟着变；默认 `accent` 就是上面这两条 token，所以不改变现有观感。
**`nightBlue` 是唯一带字面色的一项**：本表里没有能当夜空蓝用的键（blue-500/600 全是靛、
`sky`/`cyan` 家族不存在），所以皮肤层自带 `--dsh-moonset-night`（浅 `#2563EB` / 暗 `#60A5FA`），
只给这一项用，登记在 architecture §11.3 第五类「色相锚点」。
规则形状与 alpha 数字见
[architecture §11](architecture.md#11-css-注入白名单p5-例外登记)。

**证据**：`themes/moonset-palette.json`；`tests/palettes.spec.ts` 的
「shapes … as 16 hex roles per scheme」与「pins every family 500 rung to its board anchor colour」。

## 2. 228 个键：分类规则 A / B1 / B2 / B3 / B4

生成器对官方 228 个值**逐值分类一次**，每类只有一条处理规则：

| 类 | 判定 | 处理 | light | dark |
|---|---|---|---|---|
| **A** | 键名以 `--dsw-static-` 开头（82 个原语） | 按家族阶梯重建：step 500 = 家族锚点，低于 500 靠浅端、高于 500 靠深端；浅色 00=canvas / 1000=ink，暗色端点对调（00=ink / 1000=canvas），方向恒定，所以官方 alias 层照旧生效 | 82 | 82 |
| **B1** | `var(--dsw-…)` 或 `color-mix(in srgb, …)` 表达式 | **逐字照抄**；被引用的 static 在同一张表里，所以它随 A 类一起变。0.1.1 起有七个显式覆盖（B1/B2/B3 键都可能有，见 [§2.1](#21-011-的七处-token-覆盖选中与激活座位)） | 109 | 110 |
| **B2** | 纯中性字面量：`rgba(0,0,0,a)`、`rgba(255,255,255,a)`、`#000`、`#fff`、`transparent` | α 保留，颜色换成**本方案自己的**端点（浅：黑→ink、白→canvas；暗：黑→canvas、白→ink）；暗色端点对调是有意的，照字面会把描边画成 canvas 叠 canvas | 14 | 16 |
| **B3** | 其它颜色字面量 | 逐条查 `CHROMA_LITERALS` 显式表（含 7 个 `--dsw-alias-json-tree-*`，keyword 与 number 分开列）；表里没有条目就拒绝生成 | 23 | 20 |
| **B4** | 兜底 | **不存在**：生成器打印该键并 exit 1，不写文件 | 0 | 0 |
| 合计 | | | **228** | **228** |

B1 被定义为「引用同表内 token 的表达式照抄」，不是「保留官方色」：
7 条 `var(--dsw-alias-…)` 和 1 条引用 alias 的 `color-mix` 按字面会被误判成 B4，
但引用对象都在同一张表里，解析后跟随 A 类。0.1.0 实测：两张表里 **0 条** var 引用悬空。

判定「有没有回落官方色」时测试用的是**字符串比较**（`.not.toBe`），而官方有的值写作
`rgb(…)`、我们写成 `#RRGGBB`：A 类里 `--dsw-static-amber-500` 就属于「同色不同串」，
这是整张表里唯一一处，已在 §4 明示；不要用「字符串不同」当「颜色不同」的证据。

**证据**：`scripts/generate-palettes.mjs` 的 `classify()` / `buildPalettes()`；
`src/client/palettes.ts` 的 `MOONSET_CLASSES`；`tests/palettes.spec.ts` 用**独立重写**的分类器
重算 82/109/14/23/0 与 82/110/16/20/0 并与文件比对。

### 2.1 0.1.1 的七处 token 覆盖（选中与激活座位）

0.1.1 起生成器里多了一张**显式覆盖表** `TOKEN_OVERRIDES`：官方值走中性阶梯、但月落
要求「淡紫底 + 紫字」的 token，在那里逐条列出。它的键可以是 **B1 / B2 / B3** 三类
（`interactive-bg-hover` / `-active` 官方在浅色是 rgba 字面量、暗色是纯中性字面量），
但**不改变分类计数**——计数按官方值所属的类统计，所以仍是 109/110、14/16、23/20。

覆盖值与命中分布（命中数来自安装态 app.asar 反查，见
[v0.1.1 计划 §二](plans/v0.1.1.md)）：

| token | 改前（官方，浅 / 暗） | 改后（月落） | 座位与命中 | 落地观感（浅 / 暗） |
|---|---|---|---|---|
| `--dsw-alias-interactive-bg-hover` | `rgba(38, 49, 72, .06)` / `rgba(255, 255, 255, .08)` | `color-mix(in srgb, var(--dsw-static-deepseek-500) 10%, var(--dsw-alias-bg-base))` | **主座位（14）**：`.rowActive`、`.badge[data-active]`、自动化 tab、会话行 | `#E8E7F7` / `#1A1D2E` |
| `--dsw-alias-interactive-bg-active` | `rgba(38, 49, 72, .10)` / `rgba(255, 255, 255, .14)` | 同族 **16%** | 按压态（7） | `#DDDBF4` / `#21253B` |
| `--dsw-alias-bg-module-platform` | `var(--dsw-static-neutral-bluish-60)` / `-800` | 同族 **12%** | `.cardActive` / `.selected` 面（2） | `#E4E3F6` / `#1D2032` |
| `--dsw-alias-button-ghost-active-fill` | `var(--dsw-static-neutral-bluish-100)` / `-750` | 同族 **18%** | 幽灵按钮选中格、时钟/日期选择器（2） | `#D9D7F3` / `#242740` |
| `--dsw-alias-border-selected` | `var(--dsw-static-neutral-bluish-400)` ×2 | `color-mix(in srgb, var(--dsw-static-deepseek-500) 40%, transparent)` | 选中描边（半透明，可贴任意面） | 叠 canvas `#B1ACE8` / `#3D4271` |
| `--dsw-specific-sidebar-nav-item-active` | `var(--dsw-static-neutral-bluish-100)` / `-750` | 同族 **10%** | 设置侧栏选中行（1） | `#E8E7F7` / `#1A1D2E` |
| `--dsw-specific-sidebar-nav-item-active-accent` | 浅 `deepseek-100` / 暗 `neutral-bluish-800` | `var(--dsw-static-deepseek-500)` | 选中行文字/图标（紫字） | `#4338CA`（**6.45:1**）/ `#818CF8`（**5.58:1**） |

为什么它们属于 **token** 而不是 CSS：选中/激活是宿主组件已有的 token 座位，改值就
能全局跟随；只有 token 装不下的东西才进
[架构 §11](architecture.md#11-css-注入白名单p5-例外登记) 的 CSS 注入白名单（0.1.1 的
文本选区、0.1.2 的地面渐变、0.1.3 的材质面）。所有覆盖值都引用同一张表里的 token，
所以浅深与主题切换自动跟随，没有第二份色源；具体是
`--dsw-static-deepseek-500`（= `deepseek` 阶梯 500 = 源板 `accent`：浅 `#4338CA` /
暗 `#818CF8`）和 `--dsw-alias-bg-base`（= 画布）。

两处**不覆盖**的说明：`--dsw-alias-state-business-primary` 本来就指向 `deepseek-500`/
`-400`（激活下划线已经是紫的）；`--dsw-alias-button-primary-fill` 走的是
`--dsw-alias-brand-primary`（本表里是中性墨色），chip 选中仍是墨色——真机四场景里若
露出来再进 backlog。

**文字色不在这张表里**：选中容器的 `color` 由宿主规则直接写成
`--dsw-alias-label-primary`，改 token 改不到它；它由 `skinCss()` 的属性钩子
（`aria-selected` / `aria-current` / `data-active` / `aria-pressed`，外加插件页 tab
的 `data-active::after` 下划线）补齐，登记在
[架构 §11](architecture.md#11-css-注入白名单p5-例外登记) 的「选中项文字色」一条。
也就是说：**底色/描边是 token，文字色是白名单**，两者不重叠。

守卫：`validateOverrides()` 对「未知键 / `--dsw-static-*` 键 / 与 `CHROMA_LITERALS` 撞车 /
引用表外 token / 与官方值相同」任一情形 exit 1，`buildPalettes()` 还拒绝未被消费的条目；
被覆盖的字面量必须从 `CHROMA_LITERALS` 里**移除**（一个 token 只能有一个所有者）。
覆盖过的名字导出为 `MOONSET_TOKEN_OVERRIDES`；测试侧 `tests/palettes.spec.ts` 断言
`OVERRIDDEN.size === 7`、七条覆盖各自的份额与形状、以及「值 ≠ 官方值」（其余 B1 表达式
照旧逐字比对、其余 B3 字面量照旧是字面量）；`tests/skin.spec.ts` 断言这些座位与选区
规则取自同一个 accent。

**证据**：`scripts/generate-palettes.mjs` 的 `TOKEN_OVERRIDES` / `validateOverrides()`；
`src/client/palettes.ts` 的 `MOONSET_TOKEN_OVERRIDES`；`tests/palettes.spec.ts` 的
「overrides every selected/active seat」「opaque accent surfaces」「only override family
with a translucent member」；`tests/skin.spec.ts` 的 `pairs with the token half`。

## 3. 22 条对比度契约（实测值）

测量口径与 `tests/palettes.spec.ts` 完全一致：`var(--dsw-*)` 在同一方案表内展开；
`color-mix(in srgb, …)` 按 CSS 规则合成（缺省百分比 = 100 − 另一侧）；半透明前景按
α 叠在背景上取直色；再用 WCAG 相对亮度算比值。也就是说，测的是**浏览器实际会画的
颜色**，不是表里的字符串。

11 条契约 × 2 个方案 = **22 条**，下表是实测值（低于下限即测试失败）：

| # | 契约（前景 / 背景） | 判定 | Light | Dark |
|---|---|---|---|---|
| 1 | `label-primary` / `bg-base` | ≥ 7 | **17.80** | **15.81** |
| 2 | `label-secondary` / `bg-base` | ≥ 4.5 | 8.62 | 9.32 |
| 3 | `label-tertiary` / `bg-base` | ≥ 4.5 | 6.11 | 6.82 |
| 4 | `link` / `bg-base` | ≥ 4.5 | 7.58 | 7.66 |
| 5 | `state-success-primary` / `bg-base` | ≥ 3 | 3.61 | 9.82 |
| 6 | `state-error-primary` / `bg-base` | ≥ 3 | 6.41 | 8.10 |
| 7 | `state-business-primary` / `bg-base` | ≥ 4.5 | 7.58 | 7.66 |
| 8 | `border-l1` / `bg-base` | ≤ 1.5（必须仍是发丝线） | 1.08 | 1.14 |
| 9 | `toast-label` / `toast-bg` | ≥ 4.5 | 11.88 | 10.25 |
| 10 | `label-document-preview` / `bg-document-preview` | ≥ 4.5 | 7.42 | 9.32 |
| 11 | `hovercard-label-secondary` / `hovercard-bg` | ≥ 4.5 | 7.54 | 7.82 |

离边界最近的两条：浅色的 `state-success-primary`（3.61，对 ≥3 的下限）与暗色的
`border-l1`（1.14，对 ≤1.5 的上限）。改锚点时先看它们。

标签层级另有单调性断言（严格递减，且 primary ≥ 7），实测：

| 层 | Light | Dark |
|---|---|---|
| primary | 17.80 | 15.81 |
| secondary | 8.62 | 9.32 |
| tertiary | 6.11 | 6.82 |
| caption | 2.54 | 2.83 |
| dimmed | 1.40 | 1.62 |

**没有进契约**的一对：`state-warn-primary` 叠在 `state-warn-tertiary` 上，浅色
**1.86:1**（上游 1.95:1）、暗色 6.28:1。warn 是指示色不是文字，0.1.0 按「不写入契约」
处理（记录在计划已知债里）。

**证据**：`tests/palettes.spec.ts` 的 `CONTRACTS` 表与 `contrastOn()`；上表数值可用
同一套解析器重算（见 §5 的复核脚本思路）。

## 4. 可复核结论

以下每条都能用仓库里的文件或命令重新得到，不依赖会话记录：

1. **两表各 228 键，键集合完全相同**：`MOONSET_LIGHT` / `MOONSET_DARK` 与
   `themes/dsw-tokens.json` 的同名键集合逐一对齐；`live` 首行看不出的浅深分叉由这条补上。
2. **B3 与官方原值重合 0 条**：43 条 B3（23+20）生成值全部 ≠ 官方值；B2 同样 0 条。
   A 类里只有**一条**与官方同色：`--dsw-static-amber-500`（官方 `rgb(245, 158, 11)`，
   我们 `#F59E0B`，只是序列化不同）——源板 `moon` 就是那个琥珀色，属 A 类同色，
   不是 B3 回落（计划已决 #3 的口径就是这么判的）。
3. **B1 之外处处改值**：`tests/palettes.spec.ts` 的「never falls back to an official value
   outside B1」逐字符串断言非 B1 token 与官方不同（检查了 >60 条）；唯一的同色例外就是
   §4.2 的 `--dsw-static-amber-500`（字符串仍不同）。
4. **var 引用全部可解析**：亮色 111 处引用、暗色 112 处，**悬空 0**；不同被引用 token
   亮 55 / 暗 45 个。
5. **退役键不会被生成**：`--dsw-specific-sidebar-nav-item-hover` 在两张表里都不存在
   （上游 0.2.2-rc.5 已删，`themes/retired-tokens.json` 记录了逐条证据）。
6. **0.2.2 新增的 5 个 static 原语有明确值**：`neutral-bluish-55/90/310`、`violet-400/600`
   都被家族规则覆盖，且都与官方值不同。
7. **生成可复现**：`renderModule(buildPalettes())` 与已提交的 `src/client/palettes.ts`
   逐字相等；文件按字母序、无时间戳、无 import/副作用。

## 5. 生成器用法与复核

```powershell
# 1. 改色：只编辑 16 个锚点
#    themes/moonset-palette.json

# 2. 重新生成两张 token 表（幂等，两次运行逐字节相同）
node scripts/generate-palettes.mjs
#   输出形如：
#     light A=82 B1=109 B2=14 B3=23 B4=0  total=228  keys=228
#     dark  A=82 B1=110 B2=16 B3=20 B4=0  total=228  keys=228

# 3. 契约与分类一起回归
pnpm test -- tests/palettes.spec.ts
```

注意事项（都是已记录的债，做法见 [backlog-v0.2.md](backlog-v0.2.md)）：

- **不要手改 `src/client/palettes.ts`**：文件头写明自动生成，测试会核对文件头与
  「纯数据」约束（无 import、无 `console`/`document`/`window`/`globalThis`）。
- 本机 `core.autocrlf=true`：`palettes.ts` 与 `themes/` 可能出现「内容相同、行尾不同」
  的幻影 M；测试已做行尾归一化，根治要等 `.gitattributes`。
- 暗色**描边 / 悬停 / 骨架**那档 α（`border-l1..l4`、`interactive-bg-*`、`bg-skeleton`，
  实测 0.06–0.24）沿用官方值，没按暗色观感调大；真机若觉得描边偏弱，调的是这档 α
  而不是锚点色（遮罩档 0.2–0.88 另算）。
- 浅色 `--dsw-menu-surface-fill` 是 `rgba(255,255,255,.7)`（源板 `elevated` 就是纯白），
  与官方 `rgba(252,253,254,.7)` 有 2–3 级差，属源板语义，不修。
