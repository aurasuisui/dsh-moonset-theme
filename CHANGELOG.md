# 变更记录

本文件只记录**已交付的行为**；每条都能在仓库里找到实现与测试。
完整契约（里程碑、出口条件、已决、已知债）见
[docs/plans/v0.1.0.md](docs/plans/v0.1.0.md)；文档索引见 [docs/README.md](docs/README.md)。

## 0.1.8 — 2026-11-26

预览图全部重拍，并补上配色来源的署名。运行时行为零改动。

### 变更

- **预览图重拍为 8 张成对截图**（左浅右深）：整窗、输入卡玻璃、工作步骤行配色、表面色、
  代码框、回合导航轨、选中会话行。整窗图裁掉了侧栏（工作区名不进入公开仓库），宽度压到 1600 px 并做 256 色调色板量化。
- **补上配色出处**：配色来自 MoonBit 社区作者 [Wyatex](https://github.com/Wyatex) 的文档站
  [unmbt/moonset-document](https://github.com/unmbt/moonset-document)，作者授权「拿去抄」。
  README 新增「致谢 · 配色来源」小节，`docs/palette.md`、`docs/market-submission.md` 同步，
  `package.json` 增加 `contributors`，新增 `NOTICE` 文件说明衍生关系（仓库不含该站源码）。
- `package.json` 的 `description` 更新为当前定位（主题 + 轻皮肤），并注明配色作者。
## 0.1.7 — 2026-11-26

纯文档与元数据：README 重写 + 插件市场上架材料。**运行时行为零改动。**

### 新增

- **README 重写**：从「开发期流水账」改成独立插件说明书——简介 / 特性 / 预览 / 安装 / 使用 / 已知边界 / 开发 / 致谢八节，
  版本与功能全面对齐 0.1.6；删掉与另一款主题插件的兼容讨论（只在「已知边界」留一句「互斥掌权」并链到技术档案）。
- **真机预览图五张**（`assets/previews/01-05`）：浅色、深色、玻璃、工作步骤行、编辑卡表面色，替换 0.1.0 时代的三张旧图。
- **上架提报材料** [docs/market-submission.md](docs/market-submission.md)：一句话简介、详细描述、特性清单、截图清单、
  权限与外部访问（无网络、无遥测、只写三笔 DOM）、兼容矩阵（DSH / Node / 平台 / profile）、版本与发布、已知限制、提交检查表。

### 校正

- README 里过期的说法（「0.1.0 的交付口径是四件事」「版本 0.1.2」「毛玻璃排 0.1.4」「只做配色」）全部清除；
  当前只剩 0.1.6 相关表述，与 `package.json`、测试计数、皮肤表行数逐一核对过。
- 文档索引补 `market-submission.md`，`docs/plans/v0.1.7.md` 与各版计划的状态同步。
## 0.1.6 — 2026-11-25

按文档站的**确切色值**对齐代码框与两类卡片；修窗口按钮带与卡片悬停。

### 新增

- **surface 双变量**（皮肤自有，四个精确 hex）：浅 `#FDFDFE` / `#F7F8FC`，深 `#121420` / `#0D0F17`。
  这是白名单第 10 类「surface 锚点」——228 键表里没有这么精确的近白/近黑，按用户要求与文档站逐字一致。
- **代码框**：头部 `[data-code-block-banner]` = surface-head，代码体（框根，经 `:has(> [data-code-block-content])`）= surface-body；
  用宿主自己的 `--dsl-code-block-background` 通道，两种头部变体共用同一钩子。
- **交付文件卡** `[data-presented-file]`：底 = surface-body，hover = `interactive-bg-hover`（与编辑卡同一片靛族）。

### 修复

- **浅色窗控按钮旁的发灰**：顶栏材质底原为 `bg-base 62%`，与按钮带 `--dsw-specific-sidebar-fill` 差 3.72/255；
  改为 `sidebar-fill 62%` 后与原生按钮带**逐通道 0/255**。按钮 hover 由 Windows 自绘，仍为系统色。
- **编辑卡标题悬停发灰**：宿主的 `--changes-hover` 指向中性的 `card-fill-hover`，而内容行用的是 `interactive-bg-hover`——
  现在两者统一为同一 accent 面（浅 `#E8E7F7` / 暗 `#1A1D2E`）。

### 已知边界

- **「应用 / 编辑」下拉菜单无法主题化**：它是 Electron 原生菜单（`main.js` 的 `Menu.buildFromTemplate().popup()`），不吃 CSS，
  也不随第三方主题的 `data-ds-theme-source` 变化。按钮本身是 HTML、已随调色板。记为 backlog **B28**。
- 窗口按钮的 hover/按下由 Windows 自绘，改不到。
## 0.1.5 — 2026-11-24

五处观感修正：banner 间距、编辑卡配色、上下文注入上色、浅色失败色、回合导航轨染色。

### 新增

- **回合导航轨染色**：保留宿主刻度（20×2、`scaleX` 状态全在），只改颜色——所有刻度 accent、
  **当前项琥珀 + 4px 光晕**、前后各两项 55% / 28% 过渡；**悬停预览**（`aria-describedby`）用同一套。
  宿主的 140ms 过渡被**扩写**（`transform` + `background-color` + `box-shadow`），不是替换。
- **编辑卡「已编辑 N 个文件」上色**：`bg-module-platform` 底 + `border-l2` 边 + 1px inset 环（浅 1.214 / 暗 1.169）。
- **`上下文注入` 行上色**：复用步骤行的 `--dsh-moonset-step-name` 机制，不再是灰。

### 修复

- **代码块 banner 与 header 的 88px 缝**（0.1.4 回归）：Chromium 的 sticky 偏移算在**滚动容器的 content box** 上，
  而浮层有 `padding-top: H+12` → `top: H` 的实际落点是 `header 底 + 12 + H`。改为 `top: -12px`，实测 gap = 0。
- **浅色失败色过艳**：`#B31B3E → #821934`（70% error + 30% 墨色），画布 9.43:1、胶囊 7.77:1，既更淡又更稳。

### 已回退 / 已知边界

- **导航轨的「文档站时间轴」形态已回退**：细竖线 + 圆点的方案在真机上「亮暗割裂」，改为宿主形态 + 局部染色。
- **编辑卡曾因误判回退**：它是宿主内存里「本轮改动摘要」的实时投影，重启后消失属正常行为，非皮肤问题；现已恢复上色。
- **侧栏不做玻璃**（0.1.4 决定，沿用）。
## 0.1.4 — 2026-11-24

玻璃材质（三面）：输入卡、会话 header、Windows 标题条。默认开、可关、模糊强度可调。

### 新增

- **三面玻璃**：材质画在 `::before` 平面上（`z-index:-1` + `isolation:isolate`），容器本体不绘制，
  所以 `backdrop-filter` 采样到的是**面之后**的内容；材质底 = 62% 画布 + 38% 地面。
- **header 悬浮**：`margin-top: -H` + `padding-top: H+12`（H 由 JS 实测 header 高度写入 `--dsh-moonset-header-h`），
  正文从 header 背后滚过并被糊住 —— 实测 header 带最暗像素由 19 变 241（糊开）。
- **设置**：`glass`（默认开）+ `glassBlur`（0–30px，默认 12），与既有控件同一张表单、同一套持久化。

### 修复

- **M4 选择器反写**：`[data-phase='active'] #root …` 把祖先写成了后代，一字未匹配，导致
  「文字穿过但不糊 / 点不动 header / 模糊滑块无效」三个症状；改回 `[data-phase='active'] [data-slot='conversation.header'] > header`
  并加结构守卫测试（`#root` 必须出现在相位门之前）。
- **点击穿透**：滚动体加 `position: relative; z-index: 0`，header 保持 `z-index: 8`，`elementFromPoint` 命中 header。
- **代码块 banner**：悬浮后它粘在滚动体顶部会被玻璃盖住，改为粘在 header 下沿
  （`[data-conversation-scroll] :has(> [data-code-block-banner]) { top: var(--dsh-moonset-header-h) }`）。

### 已知边界

- **侧栏不做材质**（用户 2026-11-24 决定）：恢复宿主 `sidebar-fill`。
- **导航轨 38px 位移**：悬浮使滚动体 clientHeight +H，宿主 observer 据此定位的回合导航轨上移 H/2；
  只在切换玻璃开关时可见，常开无跳动；彻底修需宿主给稳定属性。
- **代码块 banner 的修法只有部分实测**（`CodeBlock.module.css` 未随 asar 发布），需真机复测。
## 0.1.3 — 2026-11-23

设置区可读性、轨迹步骤行的终端配色，以及一批失效文档的订正。

### 新增

- **工作步骤行按类型分色**：宿主 `data-variant` 是闭集 8 个（`bash`/`read`/`write`/`edit`/`search`/`think`/`code`/`others`），
  据此给六类色相——运行命令=绿、文件类=蓝紫、搜索=琥珀、思考=紫、代码/未知=强调色兜底、失败=粉红；
  工具名与参数**各自有色**（参数按同色相 25% 混次色），等宽只用于名字与参数；失败行**只上色、不加粗**。
- **皮肤层第 6 类白名单**：轨迹步骤行，仍走稳定属性 + 根属性门控，零 JS。

### 修复

- **深色设置区「白底白字」**：active 按钮原先用 `--dsw-alias-brand-primary`（官方语义是墨色，暗色下近白）当底、
  配 `label-on-color` 白字。改用 `deepseek-400` 底 + `neutral-bluish-1000` 深字：浅 **4.63:1** / 暗 **8.07:1**。
- **强度滑块白轨**：`accentColor` 同源问题，改为同一支强调色。
- **文档失效**：README 仍写「只做配色、没有环境光晕」、计划索引把 0.1.1/0.1.2 都标成「当前」、backlog 索引仍说玻璃是独立包——已全部订正。

### 已知边界

- **选中会话行的时间戳不染色**：宿主 `Rows.tsx` 用裸 `<span className={css.time}>`，无 `<time>`/`data-*`，
  类名按构建哈希；按用户决定不做脆弱选择器（0.1.3 关闭此债）。
- **成功态（退出码 0）不上色**：`ExitCodeBadge` 恒 `neutral`，只有失败才渲染胶囊；整行 `data-state='ok'` 染绿会波及其他轨迹。
- **「上下文注入」行**没有 `data-variant`/`data-state`，六种行里唯一未覆盖。
- **没有真正的「文件蓝」**：228 键表无 `sky`/`cyan`，`blue-*` 被重映射为靛，文件类用 `deepseek-400`（与强调色同族差一档）。
## 0.1.2 — 2026-11-23

环境光晕（地面）：整屏一层低对比渐变 + 光斑，让「月落」有空间感。零 JS、零动画、单张样式表。

### 新增

- **地面光晕**：浅色 = 顶部靛蓝月晕 + 右下角琥珀点缀（16:3）+ 165° wash；深色 = **同一支夜空蓝的三层**
  （月核 12% / 外圈 20% / 底部反光 4%）+ wash，不引入第二个色相。
- **地面范围 A/B/C**：会话区 / 主区（默认）/ 全透。A 只透会话列，B 额外清外壳与三列（侧栏仍有自己的面），
  C 连侧栏内层与底部栏一起清；三档是嵌套关系（A ⊂ B ⊂ C）。
- **浅/深各一套色相与强度**：`glowHueLight` / `glowStrengthLight`（默认 柔和 @90%）、
  `glowHueDark` / `glowStrengthDark`（默认 夜空蓝 @100%）。三档色相：强调 / 柔和 / 夜空蓝。
- **夜空蓝锚点**：`--dsh-moonset-night` = `#2563EB`（浅）/ `#60A5FA`（暗）——228 键表里没有可用的蓝，
  这是皮肤层**唯一允许的字面色**，且只被 `night` 使用（白名单测试钉住「整表恰好两个 #」）。

### 修复

- **地面被面板遮住**（首版真机「完全看不到光晕」）：宿主在 `.frame` / 三列 / 会话根上刷不透明 `bg-base`；
  现在按 `[data-slot]` / `[data-composer-seat]` 等**稳定属性**、用包含关系清掉那些承载层的 `background-color`，
  不动布局，也不动内容面（卡片 / 气泡 / 菜单保持实底）。
- **底部白带**：会话根 `.composerSeat` 上那条 `transparent → bg-base` 是 `background-image`，
  用 `[data-composer-seat]` 单独关掉（只清 image，不抹颜色与阴影）。

### 已知边界

- 深色下本主题设置区的**选中按钮**是「白底白字」（active 底用了 `brand-primary`，暗色下接近白），排 0.1.3。
- **选中会话行的时间戳**仍是原色（`.meta` 自带 `label-tertiary`），排 0.1.3。
- 输入框上方 36px 渐隐遮罩被移除后是硬切；底部反光 4% 若显空可提到 6–8%。
## 0.1.1 — 2026-11-23

皮肤层第一版：选中态与文本选区统一成月落的紫。**默认随插件激活生效**，选「官方主题」时自动撤除。

### 新增

- **选中态配色（7 个 token 覆盖）**：`--dsw-alias-interactive-bg-hover/-active`、`--dsw-alias-bg-module-platform`、
  `--dsw-alias-button-ghost-active-fill`、`--dsw-alias-border-selected`、`--dsw-specific-sidebar-nav-item-active(-accent)`，
  全部由 accent 混出（10–18% 底 / 40% 描边），会话列表、设置侧栏、插件页、自动化任务页四处一致。
- **选中项紫字**：`aria-selected` / `aria-current` / `data-active` / `aria-pressed` 四类**稳定属性**钩子 +
  根属性 `html[data-moonset-skin]` 门控（0,2,2 特异性，压过宿主 `.tab[data-active]` 的 0,2,0）；无 `!important`、无通配子树。
- **文本选区**：`::selection` = accent 22% 底 + accent 字（对齐文档站 `selection:bg-indigo-500/20 text-indigo-700`）；
  实测选中文字对比度 浅 5.25:1 / 暗 4.55:1。
- **皮肤层基础设施**：单张样式表 + 根属性；`off`（官方主题）即摘除，卸载零残留；零常驻 JS（P1）。

### 修复

- 0.1.1 首轮真机失败：只覆盖了 `sidebar-nav-item-active` 一个座位（1/22 命中），会话行/插件页/自动化页仍为灰。
  根因与命中分布记入 [docs/plans/v0.1.1.md](docs/plans/v0.1.1.md) §二。

### 已知边界

- 自动化任务页的**选中行**未覆盖：宿主只给 `aria-expanded`（语义是"展开"，会误染菜单），等宿主提供专用钩子。
- detail tab 暗色下文字（`deepseek-500`）与宿主下划线（`business-primary` = `deepseek-400`）差一级。

## 0.1.0 — 2026-11-22

首个可用版本。

**发布形态**：以 `@aurasuisui/dsh-moonset-theme@0.1.0` 发布到 npm
（`publishConfig.access = public`；`prepare` 钩子构建，`files` 含 `lib/`、
`cordis.patch.yml`、README、LICENSE、CHANGELOG、`assets/` 与 sourcemap）。
为了让这个包真的能被装进 profile，0.1.0 相比开发期落盘版本改了三处身份：

- 包名 `dsh-moonset-theme` → `@aurasuisui/dsh-moonset-theme`，并去掉 `private`；
- `cordis.patch.yml` 的 insert 行 `name` 改为 scoped 包名——宿主用这个 specifier
  去 profile 里解析，写成短名会解析不到；
- 客户端 bundle（`tsdown.config.ts`）的 `__ModuleLoader__` id 改成同一个 scoped 名——
  `dsh-client-modules` 以包名为键，id 漂移会抛
  `bundle <url> loaded without registering "<name>"`。

这三处一致性现在由 `tests/smoke.spec.ts` 断言。插件 row id 仍是 `dsh-moonset`，
主题 id 仍是 `moonset-light` / `moonset-dark`，都不随包名变化。

### 新增

- **双主题**：向官方 ThemeRuntime 注册 `moonset-light`（`colorScheme: light`）与
  `moonset-dark`（`dark`）两个主题定义；重复 id 走容错注册（跳过而不是让整条 web boot 失败）。
- **228 键整表覆盖**：两张表各 228 个 `--dsw-*` 颜色 token，取自安装态桌面壳
  （runtime `0.2.2-rc.5`）的 `design-platform.css`；分类 A/B1/B2/B3 = 82/109/14/23
  （暗色 82/110/16/20），未分类 0；22 条对比度契约（11 × 2 方案）全部满足。
- **跟随系统**：走 `overrideTokens('dsh-moonset', …)` 的 228 条 `{light, dark}` 覆盖层，
  官方偏好保持 `system`，由操作系统决定当前用哪一半。
- **设置区**：插件自己的 `settings.section`（浅色 / 深色 / 跟随系统 三个按钮，zh + en），
  选择存进插件自己的 `Config.choice`（volatile 字段），重启后自动恢复；官方 Appearance
  的显式选择会被镜像成"未选择"，避免下次启动盖回用户的选择。
- **首帧注入**：Host 半区在 `webserver/index-inject` 注入一张 head `<style>`
  （228 条声明 + 画布 `background-color`，并列双选择器）与一条 body script 对齐
  `data-ds-dark-theme`；`follow` 模式发浅深两块 + 媒体查询。客户端在主题真正接管时撤表。

### 修复

- **设置回声导致主题弹回**（0.1.0 阻断项）：官方 `ThemeRuntime` 在构造时订阅设置作用域
  （`dsh-client-ui-theme/lib/client.js:1681`），`adopt()`（同文件 `:1787`）会用设置文档里的
  内置偏好在每次写入后覆盖内存偏好，于是"选浅色/深色会闪一下切回系统主题"。
  修法是在本地写入窗口（1500ms）内把内置偏好判定为回声，用延后的**再断言**
  （`queueMicrotask` 合并 + 每波次上限 3 次）恢复所选主题；窗口外的官方点击仍按原规则
  镜像成 `off`。详见 [docs/architecture.md](docs/architecture.md) §8。

- **设置区即时反馈与跟随自愈**：设置区订阅「持久化 + `theme/change`」双来源，点击即高亮；
  `follow` 下若覆盖层掉线会重挂、若 `system` 被回声钉成内置值会再断言（同一套延后/合并/上限纪律）。
- **状态行**：设置区显示 `选择 · 官方偏好 X · 当前方案 Y · 覆盖层 已挂载/未挂载`，
  把「跟随为什么不跟」的分歧点直接摆在用户面前（判别树见
  [docs/plans/v0.1.0.md](docs/plans/v0.1.0.md) 已决 #21）。

### 验证

- **自动化**：117 个单元测试（8 个文件）+ 假宿主共存 6/6（对实装 catppuccin **0.7.5** 产物跑的）。
- **真机（2026-11-22，桌面壳）**：三态各选一次，状态行读数分别为
  `浅色 · 官方偏好 moonset-light · 当前方案 浅色 · 覆盖层 未挂载`、
  `跟随系统 · 官方偏好 system · 当前方案 深色 · 覆盖层 已挂载`、
  `深色 · 官方偏好 moonset-dark · 当前方案 深色 · 覆盖层 未挂载`；
  截图 [assets/previews/](assets/previews/)。

### 已知边界

与 catppuccin 同装时**同一时刻只让一方掌权**（它会回弹第三方主题 id）；其余边界（`:root{color-scheme}`
未发、macOS 未验、多窗口不同步、1500ms 窗口等）见 [docs/compatibility.md](docs/compatibility.md)
与 [README「已知边界」](README.md#已知边界)。
