# dsh-moonset-theme

Moonset（月落）是 DeepSeek Harness Web GUI 的一套浅色/深色主题：向官方主题系统注册
`moonset-light` 与 `moonset-dark`，覆盖安装态桌面壳里的全部 `--dsw-*` 颜色 token。
0.1.0 的交付口径是四件事：**能选、能记住、重启恢复、首帧不闪**。

## 是什么

- **两个主题**：`moonset-light`（`colorScheme: light`）与 `moonset-dark`（`dark`），
  各自是一张 **228 键**的 `--dsw-*` 表，不是"一个主题两种色"。
- **跟随系统**：把浅深两半同时塞进一个 `overrideTokens` 覆盖层，官方偏好保持
  `system`，由操作系统决定现在用哪一半。
- **自己的设置区**：设置里出现「Moonset 主题」，三个按钮——浅色 / 深色 / 跟随系统。
  选择存在**插件自己的**设置字段里（第三方主题 id 写不进官方偏好文档），重启后自动恢复。
- **首帧不闪**：Host 半区在首页渲染时注入一张 <style>，让第一帧就是月落色；
  客户端接管后立刻把这张表删掉，避免它压住后续切换。

**主题 + 轻皮肤**：0.1.1 起管选中态与文本选区，0.1.2 起有一层地面光晕（wash + 光斑，三档地面范围、深浅各一套色相与强度）。
还没有毛玻璃（排 0.1.4），不改布局、不写 `--dsh-*`、零常驻 JS。
版本 `0.1.2`；许可证 MIT。

细节文档：[文档索引](docs/README.md) · [架构](docs/architecture.md) ·
[调色板](docs/palette.md) · [与 catppuccin 的兼容性](docs/compatibility.md) ·
[0.1.0 契约存档](docs/plans/v0.1.0.md) · [变更记录](CHANGELOG.md)。

## 怎么装

### 从 npm 安装（推荐，0.1.0 起可用）

`@aurasuisui/dsh-moonset-theme@0.1.0` 已发布到 npm
（[npm](https://www.npmjs.com/package/@aurasuisui/dsh-moonset-theme) ·
[GitHub](https://github.com/aurasuisui/dsh-moonset-theme) ·
[tag `v0.1.0`](https://github.com/aurasuisui/dsh-moonset-theme/releases/tag/v0.1.0)）。
产物（`lib/`、`cordis.patch.yml`、sourcemap、截图）都在包里，安装时不需要构建：

```powershell
# 桌面壳的 profile 只能由桌面壳自带的 CLI 管理（npm 全局的 dsh 会拒绝 desktop）。
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add @aurasuisui/dsh-moonset-theme
```

**先完全退出桌面壳**再执行（profile 的 `package.json` 有文件锁）。装完重开桌面壳，
设置里就会出现「Moonset 主题」。web profile 用同一条命令，把 `--profile desktop`
换掉即可。

卸载：`& $dsh plugin --profile desktop remove @aurasuisui/dsh-moonset-theme`。

### 从本地仓库安装（开发用）

**必须先构建**：`link:` 指向的是工作副本，仓库不提交 `lib/`。
（`npm publish` 和 `dsh plugin add git+https://…` 走 `prepare` 钩子自动构建，本地 link 不走。）

```powershell
# 0) 在仓库根构建产物（lib/index.js 与 lib/client.js）
pnpm install
pnpm build

# 1) 把仓库挂进目标 profile 的 plugins/ 目录（junction，Windows）
$repo    = 'C:\Users\<you>\Desktop\Anything\dsh-moonset-theme'
$profile = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
New-Item -ItemType Directory -Force (Join-Path $profile 'plugins') | Out-Null
New-Item -ItemType Junction -Path (Join-Path $profile 'plugins\dsh-moonset-theme') -Target $repo

# 2) 备份 profile 的 package.json（文件名带时间戳，便于回滚）
Copy-Item (Join-Path $profile 'package.json') (Join-Path $profile ('package.json.bak-moonset-' + (Get-Date -Format 'yyyyMMddHHmmss')))

# 3) profile 里要有这三处（本机 0.1.0 落盘后的实际位置）：
#      package.json  dependencies   "@aurasuisui/dsh-moonset-theme": "link:plugins/dsh-moonset-theme"
#      package.json  dsh.profile.bundles 末尾  "@aurasuisui/dsh-moonset-theme"
#      cordis.patch.yml  - id: dsh-moonset / name: '@aurasuisui/dsh-moonset-theme'
#                        这条 insert 行由本仓库的 bundle patch（cordis.patch.yml）提供

# 4) 让 profile 解析这条 link，然后重启桌面壳
Push-Location $profile; pnpm install; Pop-Location
```

步骤 1–4 就是 0.1.0 实际落盘的方式（2026-11-22，备份名 `*.bak-moonset-20261122123511`）。
`cordis.patch.yml` 顶部注释里也写了官方插件形态
`dsh plugin --profile <name> add <path-or-git-url>`；0.1.0 **没有**用这条 CLI 路径，
要不要用请先在临时 profile 里试。

**回滚**（三步，做完重启）：

1. 用备份覆盖回 `package.json`（`Copy-Item package.json.bak-moonset-<时间戳> package.json`；
   或手动删掉那条依赖与 bundles 条目）；
2. 删除 junction：`Remove-Item (Join-Path $profile 'plugins\dsh-moonset-theme')`
   （目标仓库本身不动）；
3. 在 profile 里 `pnpm install`，重启桌面壳。设置里不再出现「Moonset 主题」即回滚成功。

想只关不卸：在 profile 的插件配置里把该条目设成 `disabled: true` 即可（用户就是这么把
catppuccin 关掉的），重启后插件不激活，仓库和 link 都还在。

## 怎么用

1. 打开 **设置**，找到「Moonset 主题」（排在官方设置与其它主题插件之后，`order: 40`）。
2. 点 **浅色** / **深色** → 立刻切换，并把选择存进插件自己的设置；重启后自动恢复。
3. 点 **跟随系统** → 官方偏好被设为「跟随系统」，Moonset 的浅深两半由系统决定；
   此时官方 Appearance 里显示的是「跟随系统」，不是 `moonset-*`。
4. **回到官方主题**：去官方 Appearance 选 light/dark/system。插件看到这次显式选择后会把
   自己的记录镜像成"未选择"，所以下次启动不会把你选的主题盖回来。
5. **重装/升级**：重新 `pnpm build`，重启桌面壳即可（`link:` 指向仓库，不需要重装）。

几个不带意外的行为：

- `off`（未选择）是默认值，插件不会在启动时替你写官方偏好；只有你选过
  light/dark/follow 才会恢复。
- 选「跟随系统」会把官方 Appearance 的偏好设成「跟随系统」——这是让跟随层生效的前提，
  属于你选择的语义，不是插件自作主张。
- **与 catppuccin 同时装**时，同一时刻只能有一方掌权：切到另一方的主题前，先把这一方关掉。
  原因与源码位置见 [docs/compatibility.md](docs/compatibility.md)。


**工作步骤行**（代码 / 读取 / 运行命令 / 搜索 / 思考）按类型着色：运行命令=绿、文件类=蓝紫、搜索=琥珀、思考=紫、
代码与未知工具=强调色；失败行（退出码非 0）只上色不加粗。正文与代码块不受影响。
### 0.1.2 起的环境光晕

设置里「Moonset 主题」下方还有一组地面控件：

| 控件 | 选项 | 默认 |
|---|---|---|
| **地面范围** | 会话区（只透会话列）/ 主区（外壳+三列，侧栏保留自己的面）/ 全透（连侧栏与底栏） | **主区** |
| **浅色光晕** | 色相：强调 / 柔和 / 夜空蓝；强度 0–200% | **柔和 90%** |
| **深色光晕** | 同上 | **夜空蓝 100%** |

强度 0 等于只剩底色；把「环境光晕」关掉会整段移除（含夜空蓝锚点），回到 0.1.1 的纯色地面。

### 0.1.4 起的玻璃材质（M1：输入卡）

再往下是一组「玻璃材质」：

| 控件 | 取值 | 默认 |
|---|---|---|
| **玻璃材质** | 开 / 关 | **开** |
| **模糊** | 0–30px（步长 2） | **12px** |

材质 = 画布色 62% 的半透明底 + 背景模糊 + 1px 顶部内高光，三面共用同一份配方：
**输入卡**、**会话 header**、**Windows 标题栏条**。

> **侧栏不做玻璃材质**（用户 2026-11-24 决定「侧栏先不做玻璃材质了」）：它保持宿主的
> `--dsw-specific-sidebar-fill`，我们的材质段完全不碰它。
- **header 悬浮**：header 抬到正文之上（`z-index: 8`），滚动体整体上移一个 header 高度、
  正文起点再用 padding 推回 header 下沿 12px 处 —— 于是消息会从 header **背后滚过去**，
  被 `backdrop-filter` 糊住但仍隐约可见。header 高度是运行时**实测**的（mount 后有限次重试），
  所以标签换行、语言变化都不会让偏移失真；实测失败时回退到宿主的最小高度 76px，而且
  偏移公式里 padding 抵消 margin，**内容起点永远只由 header 高度决定**，量错也不会遮住正文。
  滚动体另给了 `position: relative; z-index: 0`，header 的层级不再靠运气；代码块的 sticky
  banner 用宿主自己的 `:has(> [data-code-block-banner])` 钩子把粘附偏移抬到 header 高度，
  于是它粘在 header **下沿**而不是钻进 header 背后。

模糊 0 只剩半透明底（老显卡或 compositing 不可用时就是这个保底）；关掉开关则三面一起回到
宿主原样、滚动体也回到宿主布局。菜单/弹层不做。
## 已知边界

以下每条都有仓库内的证据；没有真机证据的会如实标注。

- **真机复验：已通过（2026-11-22，桌面壳）。** 三态各选一次并各停留观察，状态行读数：
  ① `浅色 · 官方偏好 moonset-light · 当前方案 浅色 · 覆盖层 未挂载`；
  ② `跟随系统 · 官方偏好 system · 当前方案 深色 · 覆盖层 已挂载`；
  ③ `深色 · 官方偏好 moonset-dark · 当前方案 深色 · 覆盖层 未挂载`。
  截图见 [assets/previews/](assets/previews/)（`01-light.png` / `02-follow.png` / `03-dark.png`）。
  插件以 junction + `link:` 装入 `profiles/desktop`，catppuccin 在该 profile 里已 `disabled: true`。
  自动化侧是 **117 个单元测试**（8 个文件）与 **假宿主共存 6/6**（后者用实装 0.7.5 产物跑）。
- **毛玻璃只做三面**（0.1.4 M1 + M2 + M3 + M6：输入卡、Windows 标题栏条、会话 header）：
  header 自 M4 起悬浮在正文之上，因此真的能透出被糊掉的消息；**侧栏自 M6 起不做**（用户
  决定）。菜单/弹层不做（浮层的 backdrop root 与固定定位耦合最深，留待评估）。
- **滚动体上移的副作用（未修，需决策）**：回合导航轨的可见位置由宿主的
  `--dsh-conversation-viewport-height`（滚动体的 `clientHeight`）算出，滚动体上移后它高了
  76px，导航轨因此上移 **38px**（= 76/2）；开关玻璃时能直接看到这 38px 的跳动。导航轨只有
  哈希类名、没有稳定钩子，按 §11.4「不用 `[class*=]`」我们不硬改 —— 要消掉它只有两条路：
  给宿主加稳定属性，或把「悬浮 header」做成默认关的设置项。置顶的压缩行开关同样会粘在
  header 背后（糊影），同理待定。
  侧栏滚动区底部那条 24px 渐隐（`scrollFade`）仍是宿主的不透明渐变——它没有稳定钩子，
  按 §11.4 不做脆弱选择器，实测与材质底差 ≤ 8/255，见 architecture §11.3。正文颜色可调排在
  更后面。见 [docs/backlog-v0.2.md](docs/backlog-v0.2.md)。
- **与 catppuccin 互斥掌权。** 可同装（注册表、层、卸载互不影响，已用实装 0.7.5 产物
  验过），但它会回弹第三方主题 id；同一时刻只让一方掌权。见
  [docs/compatibility.md](docs/compatibility.md)。
- **`:root{color-scheme}` 没发。** 官方唯一的 `color-scheme` 设置点在它自己的首帧行里，
  我们没带；若官方偏好与所选 Moonset 主题明暗相反，UA 控件/滚动条可能短暂按官方方案画。
  真机若看得见再补（一行的事），已记为已知债。
- **macOS 未验证。** 样式表里有 9 个名字只在 `html[data-platform='darwin'] body` 层出现，
  其特异性高过我们的选择器；本机是 Windows，这一项没验。
- **多窗口不同步。** 一个窗口改了设置，另一个窗口的按钮不会自动刷新（下次读取才采纳）。
- **1500ms 窗口。** 写完设置后 1.5 秒内若去官方 Appearance 点 light/dark/system，
  会被当成回声再断言一次，那次点击不会被记成"回到官方主题"；下一次任意设置写入后自愈。
- **官方 Appearance 里显示裸 id。** 官方注册表不存第三方主题的 label，那里会显示
  `moonset-light` / `moonset-dark`；插件自己的设置区显示的是正常文案。
- **没做像素级 A/B。** 与其它主题插件同时生效时"谁的 `--dsw-*` 赢"由内联样式顺序决定，
  0.1.0 只验证了功能，不验证逐像素观感。

装坏了怎么回：见上面「怎么装」的回滚三步；只需要 `Remove-Item` 一个 junction 并还原
`package.json` 备份，仓库本身不会被改动。
