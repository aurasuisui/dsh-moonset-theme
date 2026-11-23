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

它**只做配色**：不改布局、不挂全局钩子、不写 `--dsh-*`，也不做毛玻璃材质或环境光晕
（用户想要，但那是独立插件，见 [docs/backlog-v0.2.md](docs/backlog-v0.2.md)）。
版本 `0.1.0`；许可证 MIT。

细节文档：[文档索引](docs/README.md) · [架构](docs/architecture.md) ·
[调色板](docs/palette.md) · [与 catppuccin 的兼容性](docs/compatibility.md) ·
[0.1.0 契约存档](docs/plans/v0.1.0.md) · [变更记录](CHANGELOG.md)。

## 怎么装

### 从 npm 安装（推荐，0.1.0 起可用）

`@aurasuisui/dsh-moonset-theme` 已发布到 npm，产物（`lib/`、`cordis.patch.yml`、
sourcemap、截图）都在包里，安装时不需要构建：

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

## 已知边界

以下每条都有仓库内的证据；没有真机证据的会如实标注。

- **真机复验：已通过（2026-11-22，桌面壳）。** 三态各选一次并各停留观察，状态行读数：
  ① `浅色 · 官方偏好 moonset-light · 当前方案 浅色 · 覆盖层 未挂载`；
  ② `跟随系统 · 官方偏好 system · 当前方案 深色 · 覆盖层 已挂载`；
  ③ `深色 · 官方偏好 moonset-dark · 当前方案 深色 · 覆盖层 未挂载`。
  截图见 [assets/previews/](assets/previews/)（`01-light.png` / `02-follow.png` / `03-dark.png`）。
  插件以 junction + `link:` 装入 `profiles/desktop`，catppuccin 在该 profile 里已 `disabled: true`。
  自动化侧是 **117 个单元测试**（8 个文件）与 **假宿主共存 6/6**（后者用实装 0.7.5 产物跑）。
- **只做配色。** 没有毛玻璃材质、没有环境光晕、正文颜色不可调——这三项是 v0.2 的独立
  插件/功能，见 [docs/backlog-v0.2.md](docs/backlog-v0.2.md)。
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
