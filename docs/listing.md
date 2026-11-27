# 上架记录：awesome-dsh-plugin 收录

> 市场的插件列表来自精选列表 [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，
> 所以「上架」= 向那个仓库提交一个 YAML 文件的 PR。本文记录提交了什么、为什么这么写、之后怎么维护。

## 1. 提交内容

一个文件：`data/plugins/aurasuisui__dsh-moonset-theme.yml`

```yaml
url: https://github.com/aurasuisui/dsh-moonset-theme
name: aurasuisui/dsh-moonset-theme
category: theme
icon: https://raw.githubusercontent.com/aurasuisui/dsh-moonset-theme/main/assets/icon-180.png
description:
  en: Light and dark themes covering all 228 --dsw-* tokens, plus a thin skin layer with ambient ground glow, frosted input card and conversation header, per-tool-type colours on work-step rows, and document-site surface colours. No resident JavaScript, no network access, no telemetry.
  zh: 覆盖全部 228 个 --dsw-* token 的浅/深双主题，外加一层轻皮肤：环境地面光晕、磨砂输入卡与会话顶栏、工作步骤行按类型分色、代码框与卡片的文档站表面色。零常驻 JS、不联网、无遥测。
```

**为什么是文件而不是改 README**：那个仓库的两个 README 由 `data/plugins/*.yml` 生成，
手工编辑会在 CI 里失败；一个插件一个文件，也让 PR 之间不会互相冲突。

## 2. 字段选择

| 字段 | 取值 | 理由 |
|---|---|---|
| `category` | `theme` | 与 `dsh-neo-skin`、`dsh-catppuccin` 等同类条目一致 |
| `name` | `aurasuisui/dsh-moonset-theme` | 仓库本身的 `owner/repo`（不是展示名） |
| `icon` | `assets/icon-180.png` 的 raw 链接 | 位图、托管在 GitHub 上；图案是配色来源站的紫色月牙 mark |
| `description.en` | 单行、句号结尾、**避开 `: `** | 含冒号+空格时 YAML 会当成嵌套键，整条解析失败 |
| `description.zh` | 同义中文 | 可选字段，但写了更完整 |

## 3. icon

`assets/icon-512.png`（512×512）与 `assets/icon-180.png`（180×180）都是从配色来源站
[unmbt/moonset-document](https://github.com/unmbt/moonset-document) 的 wordmark 里那颗月牙
（`doc-web/src/components/TopNav.tsx` 的 `viewBox="0 0 24 24"` 路径）重绘的：路径原样、
填充色 `#4F46E5`（靛蓝，与本主题的强调色同族），底是主题自己的浅色表面渐变。
**不是截图，是矢量重绘**，所以任何尺寸都清晰。

## 4. 提交步骤（复现用）

```powershell
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=false
gh repo clone aurasuisui/awesome-dsh-plugin $env:TEMP\awesome
cd $env:TEMP\awesome
# 写入 data/plugins/aurasuisui__dsh-moonset-theme.yml（内容见 §1）
npm ci; node scripts/generate-readme.mjs   # 本地自查：跑的就是 CI 那套条目校验
git checkout -b add-moonset-theme
git commit -am 'Add aurasuisui/dsh-moonset-theme (theme)'
git push -u origin add-moonset-theme
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --title 'Add aurasuisui/dsh-moonset-theme (theme)' --body-file PR.md
```

## 5. 维护约定

- **发新版本时不需要改这个条目**：条目指向仓库，版本由 npm `latest` 决定；
- **改名 / 迁仓库 / 换分类**才需要再来一次 PR；
- 若条目被移除（仓库失联或长期无维护），按本文 §1 重新提交即可；
- 收录 ≠ 背书：列表页对此有免责声明，我们不另作安全性声明。

## 6. 已知取舍

- 描述只写**已实现**的能力。侧栏不做玻璃、原生菜单不可主题化、导航轨有 38 px 位移这些边界
  **不写进列表描述**——那里只有一句话的位置，写边界会淹没重点；这些都在 README「已知边界」里。
- 没有提交 `tarball`：插件能从源码装（`prepare` 构建），不需要预构建包。