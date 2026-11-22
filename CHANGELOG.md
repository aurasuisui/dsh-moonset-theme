# 变更记录

本文件只记录**已交付的行为**；每条都能在仓库里找到实现与测试。
完整契约（里程碑、出口条件、已决、已知债）见
[docs/plans/v0.1.0.md](docs/plans/v0.1.0.md)；文档索引见 [docs/README.md](docs/README.md)。

## 0.1.0 — 2026-11-22

首个可用版本（0.1.0，private，不发 npm）。

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
